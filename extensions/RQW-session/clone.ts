import { copyFileSync, existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { InteractiveMode, SessionManager, SessionSelectorComponent, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const MARK = "rqw-session:clone-owner";
const STATE = Symbol.for("rqw-session/clone");
const RESTORE = Symbol.for("rqw-session/clone-restore");
const WARNING = "RQW-session: incompatible Pi selector internals; session cloning is disabled.";
type Fn = (...args: any[]) => any;
type Owner = { token: object; live: () => boolean };
type State = { owners: Set<Owner>; hosts: Map<any, { owner: Owner; debug: Fn }>; descriptors: Map<string, PropertyDescriptor>; wrappers: Map<string, Fn> };

function owns(host: any, owner: Owner): boolean {
 try { return owner.live() && host.session.resourceLoader.getExtensions().extensions.some((ext: any) => ext.handlers.get(MARK)?.some((fn: Fn) => fn({ type: MARK }) === owner.token)); }
 catch { return false; }
}

function cloneBranch(path: string, host: any): string {
 // Opening an old Pi file can migrate it. Load a temporary copy so the source is never rewritten.
 const temp = mkdtempSync(join(tmpdir(), "rqw-session-clone-"));
 try {
  const copy = join(temp, "source.jsonl");
  copyFileSync(path, copy);
  const manager: any = SessionManager.open(copy, dirname(path));
  if (typeof manager.getLeafId !== "function" || typeof manager.createBranchedSession !== "function" || typeof manager.sessionFile !== "string") throw new Error(WARNING);
  const active = host.sessionManager;
  const leaf = active.getSessionFile() && resolve(active.getSessionFile()) === resolve(path) ? active.getLeafId() : manager.getLeafId();
  if (!leaf) throw new Error("Session has no branch to clone");
  manager.sessionFile = path;
  const cloned = manager.createBranchedSession(leaf);
  if (!cloned || !existsSync(cloned)) throw new Error("Session branch has no conversation to clone");
  return cloned;
 } finally { rmSync(temp, { recursive: true, force: true }); }
}

export function installClone(pi: ExtensionAPI): () => void {
 if (VERSION !== "1.4.0") throw new Error(WARNING);
 const proto = InteractiveMode.prototype as any;
 let state = proto[STATE] as State | undefined;
 if (!state) {
  const names = ["createBaseAutocompleteProvider", "showSelector"];
  const descriptors = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(proto, name)]));
  if (names.some(name => { const d = descriptors.get(name); return !d?.configurable || !d.writable || typeof d.value !== "function"; })) throw new Error(WARNING);
  state = { owners: new Set(), hosts: new Map(), descriptors: descriptors as Map<string, PropertyDescriptor>, wrappers: new Map() };
  const s = state;
  const factory = descriptors.get(names[0])!.value as Fn;
  const selector = descriptors.get(names[1])!.value as Fn;
  s.wrappers.set(names[0], function(this: any, ...args: unknown[]) {
   const result = factory.apply(this, args);
   const owner = [...s.owners].find(candidate => owns(this, candidate));
   const previous = s.hosts.get(this);
   if (previous && (!owner || previous.owner !== owner)) {
    if (this.ui.onDebug === undefined) this.ui.onDebug = previous.debug;
    s.hosts.delete(this);
   }
   if (owner && !s.hosts.has(this)) {
    if (typeof this.ui?.onDebug !== "function") { this.showWarning?.(WARNING); return result; }
    s.hosts.set(this, { owner, debug: this.ui.onDebug });
    this.ui.onDebug = undefined;
   }
   return result;
  });
  s.wrappers.set(names[1], function(this: any, create: Fn) {
   const policy = s.hosts.get(this);
   if (!policy || !owns(this, policy.owner)) return selector.call(this, create);
   const host = this;
   return selector.call(this, (done: Fn) => {
    const created = create(done);
    if (!(created?.component instanceof SessionSelectorComponent)) return created;
    const component: any = created.component;
    if (typeof component.getSessionList !== "function") { host.showWarning?.(WARNING); return created; }
    const list: any = component.getSessionList();
    if (!list || typeof list.handleInput !== "function" || typeof list.getSelectedSessionPath !== "function" || typeof list.onSelect !== "function" || typeof host.handleResumeSession !== "function" || typeof component.cancelLoads !== "function" || typeof component.header?.render !== "function") {
     host.showWarning?.(WARNING); return created;
    }
    const original = list.handleInput;
    list.handleInput = function(data: string) {
     if (!owns(host, policy.owner) || !matchesKey(data, "ctrl+shift+d") || component.mode !== "list" || list.confirmingDeletePath !== null) return original.call(this, data);
     const path = list.getSelectedSessionPath();
     if (!path) return;
     let cloned: string;
     try { cloned = cloneBranch(path, host); }
     catch (error) { list.onError?.(`Failed to clone: ${error instanceof Error ? error.message : String(error)}`); return; }
     component.cancelLoads();
     done();
     void (async () => {
      try {
       const result = await host.handleResumeSession(cloned);
       if (result?.cancelled && existsSync(cloned)) unlinkSync(cloned);
      } catch (error) {
       host.showError?.(`Failed to clone: ${error instanceof Error ? error.message : String(error)}`);
      }
     })();
    };
    const render = component.header.render;
    component.header.render = function(width: number) {
     const lines = render.call(this, width);
     if (owns(host, policy.owner) && component.mode === "list" && list.confirmingDeletePath === null && !this.statusMessage) lines[1] = truncateToWidth(`Ctrl+Shift+D clone · ${lines[1]}`, width, "…");
     return lines;
    };
    return created;
   });
  });
  for (const name of names) Object.defineProperty(proto, name, { ...descriptors.get(name), value: s.wrappers.get(name) });
  Object.defineProperty(proto, STATE, { configurable: true, value: s });
  Object.defineProperty(proto, RESTORE, { configurable: true, value: () => {
   if (s.owners.size || [...s.wrappers].some(([name, wrapper]) => Object.getOwnPropertyDescriptor(proto, name)?.value !== wrapper)) return;
   for (const [name, descriptor] of s.descriptors) Object.defineProperty(proto, name, descriptor);
   if (proto[STATE] === s) delete proto[STATE];
   delete proto[RESTORE];
  } });
 }
 const s = state;
 const token = {};
 let stopped = false;
 const owner: Owner = { token, live: () => {
  if (stopped) return false;
  try { (pi.on("rqw-session:clone-probe" as "session_start", () => {}) as unknown as (() => void) | undefined)?.(); return true; } catch { return false; }
 } };
 s.owners.add(owner);
 pi.on(MARK as "session_start", (() => token) as () => void);
 const dispose = () => {
  if (stopped) return;
  stopped = true; s.owners.delete(owner);
  for (const [host, policy] of s.hosts) if (policy.owner === owner) {
   if (host.ui.onDebug === undefined) host.ui.onDebug = policy.debug;
   s.hosts.delete(host);
  }
  if (!s.owners.size) proto[RESTORE]?.();
 };
 return dispose;
}
