import { InteractiveMode, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const MARK = "rqw-commands:owner";
const STATE = Symbol.for("rqw-commands/patch");
const BUILTINS = ["settings", "model", "tree", "thinking", "scoped-models", "export", "import", "share", "bug", "copy", "name", "session", "changelog", "hotkeys", "fork", "clone", "trust", "login", "logout", "new", "compact", "resume", "reload", "quit"];
const REMOVED = new Set(["model", "thinking", "tree", "scoped-models", "share", "bug"]);
const SESSION_COMMAND = resolve(fileURLToPath(new URL("../RQW-session/index.ts", import.meta.url)));
const WARNING = "RQW-commands: incompatible Pi command internals; command cleanup is disabled.";

type Fn = (...args: any[]) => any;
type Owner = { token: object; live: () => boolean };
type Editor = { onSubmit?: Fn; setText(text: string): void; getText(): string; getExpandedText?(): string };
type Host = any;
type Wrapped = { editor: Editor; original: Fn; wrapper: Fn };
type Policy = { owner: Owner; wrappers: Wrapped[] };
type State = { owners: Set<Owner>; hosts: Map<Host, Policy>; descriptors: Map<string, PropertyDescriptor>; wrappers: Map<string, Fn> };

function isBuiltinLlama(command: any): boolean {
 return command?.sourceInfo?.source === "builtin" && command.sourceInfo.path === "builtin:llama.cpp";
}
function blocked(host: Host, input: string): boolean {
 const text = input.trim();
 if (["/tree", "/scoped-models", "/share"].includes(text)) return true;
 if (["/model", "/thinking", "/bug"].some(name => text === name || text.startsWith(name + " "))) return true;
 if (!text.startsWith("/")) return false;
 const name = text.slice(1).split(" ", 1)[0];
 return isBuiltinLlama(host.session.extensionRunner.getCommand(name));
}
function owns(host: Host, owner: Owner): boolean {
 try {
  return owner.live() && host.session.resourceLoader.getExtensions().extensions.some((ext: any) => ext.handlers.get(MARK)?.some((handler: Fn) => handler({ type: MARK }) === owner.token));
 } catch { return false; }
}
function current(state: State, host: Host): Policy | undefined {
 const policy = state.hosts.get(host);
 return policy && owns(host, policy.owner) ? policy : undefined;
}
function restore(policy: Policy) {
 for (const { editor, wrapper, original } of policy.wrappers) if (editor.onSubmit === wrapper) editor.onSubmit = original;
}
function warn(host: Host) { host.showWarning?.(WARNING); }
function reject(host: Host) { host.editor.setText(""); host.showWarning("This command is disabled."); }
function filtered(host: Host, provider: any): any[] | undefined {
 if (!(provider instanceof CombinedAutocompleteProvider)) return;
 const commands = (provider as any).commands;
 if (!Array.isArray(commands)) return;
 const templates = host.session.promptTemplates;
 const registered = host.session.extensionRunner.getRegisteredCommands();
 const skills = host.settingsManager.getEnableSkillCommands() ? host.session.resourceLoader.getSkills().skills : [];
 if (!Array.isArray(templates) || !Array.isArray(registered) || !Array.isArray(skills)) return;
 const extensions = registered.filter((entry: any) => !BUILTINS.includes(entry.name));
 const names = [...BUILTINS, ...templates.map((entry: any) => entry.name), ...extensions.map((entry: any) => entry.invocationName), ...skills.map((entry: any) => `skill:${entry.name}`)];
 if (commands.length !== names.length || names.some((name, i) => typeof name !== "string" || commands[i]?.name !== name)) return;
 const firstExtension = BUILTINS.length + templates.length;
 return commands.filter((_: unknown, i: number) => {
  if (i < BUILTINS.length) return !REMOVED.has(BUILTINS[i]);
  if (i < firstExtension || i >= firstExtension + extensions.length) return true;
  const entry = extensions[i - firstExtension];
  if (isBuiltinLlama(entry)) return false;
  return !(entry.name === "session-deleted" && typeof entry.sourceInfo?.path === "string" && resolve(entry.sourceInfo.path) === SESSION_COMMAND);
 });
}

export function installCommands(pi: ExtensionAPI, registerShutdown = true): () => void {
 if (VERSION !== "1.4.0") throw new Error(WARNING);
 const proto = InteractiveMode.prototype as any;
 let state = (proto as any)[STATE] as State | undefined;
 if (!state) {
  const names = ["createBaseAutocompleteProvider", "handleFollowUp"];
  const descriptors = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(proto, name)]));
  if (names.some(name => { const d = descriptors.get(name); return !d?.configurable || !d.writable || typeof d.value !== "function"; })) throw new Error(WARNING);
  state = { owners: new Set(), hosts: new Map(), descriptors: descriptors as Map<string, PropertyDescriptor>, wrappers: new Map() };
  const s = state;
  const factory = descriptors.get(names[0])!.value as Fn;
  const follow = descriptors.get(names[1])!.value as Fn;
  const factoryWrapper = function(this: Host, ...args: unknown[]) {
   const provider = factory.apply(this, args);
   const owner = [...s.owners].find(candidate => owns(this, candidate));
   const old = s.hosts.get(this);
   if (!owner) { if (old) { restore(old); s.hosts.delete(this); } return provider; }
   let pending: Policy | undefined;
   try {
    const commands = filtered(this, provider);
    const editors: Editor[] = [...new Set([this.defaultEditor, this.editor])] as Editor[];
    if (!commands || !Object.getOwnPropertyDescriptor(provider, "commands")?.writable || editors.some(editor => !editor || typeof editor.onSubmit !== "function" || typeof editor.setText !== "function" || typeof editor.getText !== "function" || Object.getOwnPropertyDescriptor(editor, "onSubmit")?.writable !== true) || typeof this.showWarning !== "function") throw new Error(WARNING);
    if (old && old.owner !== owner) { restore(old); s.hosts.delete(this); }
    const policy = s.hosts.get(this) ?? { owner, wrappers: [] };
    pending = policy;
    const byOriginal = new Map<Fn, Fn>();
    for (const record of policy.wrappers) byOriginal.set(record.original, record.wrapper);
    for (const editor of editors) {
     const original = editor.onSubmit!;
     if (policy.wrappers.some(record => record.editor === editor && record.wrapper === original)) continue;
     const shared = policy.wrappers.find(record => record.wrapper === original);
     if (shared) { policy.wrappers.push({ editor, original: shared.original, wrapper: shared.wrapper }); continue; }
     let wrapper = byOriginal.get(original);
     if (!wrapper) {
      wrapper = function(this: unknown, text: string, ...rest: unknown[]) {
       if (current(s, thisHost) === policy && blocked(thisHost, text)) { reject(thisHost); return; }
       return original.call(this, text, ...rest);
      };
      byOriginal.set(original, wrapper);
     }
     const thisHost = this;
     editor.onSubmit = wrapper;
     policy.wrappers.push({ editor, original, wrapper });
    }
    provider.commands = commands;
    s.hosts.set(this, policy);
   } catch {
    const policy = pending ?? s.hosts.get(this);
    if (policy) { restore(policy); s.hosts.delete(this); }
    warn(this);
   }
   return provider;
  };
  const followWrapper = function(this: Host, ...args: unknown[]) {
   if (current(s, this)) {
    const editor = this.editor as Editor;
    const text = editor.getExpandedText?.() ?? editor.getText();
    if (blocked(this, text)) { reject(this); return; }
   }
   return follow.apply(this, args);
  };
  s.wrappers.set(names[0], factoryWrapper); s.wrappers.set(names[1], followWrapper);
  for (const name of names) Object.defineProperty(proto, name, { ...descriptors.get(name), value: s.wrappers.get(name) });
  Object.defineProperty(proto, STATE, { configurable: true, value: s });
 }
 const s = state;
 const token = {};
 const marker = () => token;
 let stopped = false;
 const owner: Owner = { token, live: () => {
  if (stopped) return false;
  try { (pi.on("rqw-commands:probe" as "session_start", () => {}) as unknown as (() => void) | undefined)?.(); return true; } catch { return false; }
 } };
 s.owners.add(owner);
 pi.on(MARK as "session_start", marker as () => void);
 const dispose = () => {
  if (stopped) return;
  stopped = true; s.owners.delete(owner);
  for (const [host, policy] of s.hosts) if (policy.owner === owner) { restore(policy); s.hosts.delete(host); }
  if (s.owners.size === 0) {
   for (const [name, descriptor] of s.descriptors) if (Object.getOwnPropertyDescriptor(proto, name)?.value === s.wrappers.get(name)) Object.defineProperty(proto, name, descriptor);
   if (proto[STATE] === s) delete proto[STATE];
  }
 };
 if (registerShutdown) pi.on("session_shutdown", dispose);
 return dispose;
}
