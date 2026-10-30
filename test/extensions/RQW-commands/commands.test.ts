import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { AgentSession, AgentSessionRuntime, SessionManager, CustomEditor, ExtensionRunner, InteractiveMode, SettingsSelectorComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeybindings, setKeybindings } from "@earendil-works/pi-tui";
import commands from "../../../extensions/RQW-commands/index.ts";

const { KeybindingsManager } = await import(new URL("./core/keybindings.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const { initTheme } = await import(new URL("./modes/interactive/theme/theme.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

const root = fileURLToPath(new URL("../../../", import.meta.url));
const source = (path: string, source = "local") => ({ path, source, scope: "project" });
const command = (name: string, path: string, origin = "local") => ({ name, description: name, sourceInfo: source(path, origin), handler() {} });
function fixture(options: { own?: boolean; duplicateLlama?: boolean; bad?: boolean } = {}) {
 const handlers = new Map<string, Function[]>();
 let live = true;
 const pi = { on(name: string, handler: Function) {
  if (!live) throw new Error("stale");
  const registered = (...args: unknown[]) => handler(...args);
  const list = handlers.get(name) ?? []; handlers.set(name, list); list.push(registered);
  return () => { const at = list.indexOf(registered); if (at >= 0) list.splice(at, 1); };
 } } as unknown as ExtensionAPI;
 commands(pi);
 const builtin = { handlers: new Map(), commands: new Map([["llama", command("llama", "builtin:llama.cpp", "builtin")]]) };
 const others = { handlers: new Map(), commands: new Map([
  ["session-deleted", command("session-deleted", resolve(root, "extensions/RQW-session/index.ts"))],
  ["mcp", command("mcp", "/third/mcp.ts")], ["model", command("model", "/third/model.ts")],
 ]) };
 const third = { handlers: new Map(), commands: new Map([
  ["session-deleted", command("session-deleted", "/third/session.ts")],
  ...(options.duplicateLlama ? [["llama", command("llama", "/third/llama.ts")] as const] : []),
 ]) };
 const own = { handlers: options.own === false ? new Map() : handlers, commands: new Map() };
 const extensions = [builtin, others, third, own];
 const runner = new ExtensionRunner(extensions as any, {} as any, "/", {} as any, {} as any);
 const host: any = Object.create(InteractiveMode.prototype);
 const ui = { requestRender() {} };
 const makeEditor = () => new CustomEditor(ui as any, { borderColor: (s: string) => s } as any, { matches: () => false } as any);
 const editor = makeEditor();
 const warnings: string[] = []; const pending: string[] = []; const prompts: string[] = [];
 host.ui = ui; host.defaultEditor = editor; host.editor = editor; host.keybindings = new KeybindingsManager();
 host.runtimeHost = { session: { promptTemplates: [{ name: "model", description: "template" }], extensionRunner: runner,
  resourceLoader: { getExtensions: () => ({ extensions }), getSkills: () => ({ skills: [{ name: "sample", filePath: "/skill", description: "skill" }] }) },
  scopedModels: [], modelRuntime: { getAvailableSnapshot: () => [] }, prompt: async (text: string) => { prompts.push(text); }, isCompacting: false, isStreaming: false,
  settingsManager: { getEnableSkillCommands: () => true }, sessionManager: { getCwd: () => "/" } } };
 host.skillCommands = new Map();
 host.showWarning = (message: string) => warnings.push(message); host.flushPendingBashComponents = () => {}; host.pendingUserInputs = pending;
 host.updatePendingMessagesDisplay = () => {};
 host.setupEditorSubmitHandler();
 if (options.bad) { let calls = 0; host.session.promptTemplates = [{ get name() { return calls++ === 0 ? "first" : "second"; } }]; }
 const shutdown = () => { live = false; for (const handler of handlers.get("session_shutdown") ?? []) handler(); };
 return { host, editor, runner, warnings, pending, prompts, shutdown, makeEditor, handlers, others, third, builtin };
}
async function suggestions(provider: any) {
 return (await provider.getSuggestions(["/"], 0, 1, { force: false }))?.items.map((item: any) => item.value) as string[];
}

test("filters only the selected sources in Pi's real completion provider", async () => {
 const f = fixture({ duplicateLlama: true });
 try {
  const provider = f.host.createBaseAutocompleteProvider(); const names = await suggestions(provider);
  for (const name of ["tree", "thinking", "scoped-models", "share", "bug", "llama:1", "session-deleted:1"]) assert.ok(!names.includes(name), name);
  for (const name of ["model", "settings", "export", "import", "copy", "name", "session", "changelog", "hotkeys", "fork", "clone", "trust", "login", "logout", "new", "compact", "resume", "reload", "quit", "mcp", "skill:sample", "llama:2", "session-deleted:2"]) assert.ok(names.includes(name), name);
  assert.equal(f.warnings.length, 0);
 } finally { f.shutdown(); }
});

test("model completion removes the built-in but keeps a same-name template", async () => {
 const f = fixture();
 try {
  f.host.session.promptTemplates = [];
  assert.ok(!(await suggestions(f.host.createBaseAutocompleteProvider())).includes("model"));
  f.host.session.promptTemplates = [{ name: "model", description: "template" }];
  const names = await suggestions(f.host.createBaseAutocompleteProvider());
  assert.equal(names.filter(name => name === "model").length, 1);
 } finally { f.shutdown(); }
});

test("normal submit and follow-up reject commands in every state", async () => {
 const f = fixture({ duplicateLlama: true });
 try {
  f.host.createBaseAutocompleteProvider();
  for (const text of ["/model x", "/thinking high", "/tree", "/scoped-models", "/share", "/bug x", "/llama:1 x"]) {
   for (const state of ["idle", "streaming", "compaction"]) {
    f.host.session.isStreaming = state === "streaming"; f.host.session.isCompacting = state === "compaction";
    f.editor.setText(text); const count = f.warnings.length; await f.editor.onSubmit!(text); assert.equal(f.editor.getText(), ""); assert.equal(f.warnings.length, count + 1);
    f.editor.setText(text); await f.host.handleFollowUp(); assert.equal(f.editor.getText(), ""); assert.equal(f.warnings.length, count + 2);
   }
  }
  assert.deepEqual(f.pending, []); assert.deepEqual(f.prompts, []);
  f.host.session.isCompacting = false; f.host.session.isStreaming = false;
  for (const text of ["/modelx", "/llama:2", "/session-deleted:1", "hello"]) await f.editor.onSubmit!(text);
  assert.deepEqual(f.pending, ["/modelx", "/llama:2", "/session-deleted:1", "hello"]);
 } finally { f.shutdown(); }
});

test("third-party llama and the hidden service command execute through Pi's dispatcher", async () => {
 const f = fixture({ duplicateLlama: true });
 try {
  const executed: string[] = [];
  f.others.commands.get("session-deleted")!.handler = () => { executed.push("service"); };
  f.third.commands.get("llama")!.handler = () => { executed.push("third-party llama"); };
  f.builtin.commands.get("llama")!.handler = () => { executed.push("built-in llama"); };
  const dispatch = (AgentSession.prototype as any)._tryExecuteExtensionCommand;
  f.host.session.prompt = (text: string) => dispatch.call({ _extensionRunner: f.runner }, text);
  f.host.session.isStreaming = true;
  f.host.createBaseAutocompleteProvider();
  for (const text of ["/llama:1", "/llama:2", "/session-deleted:1"]) await f.editor.onSubmit!(text);
  assert.deepEqual(executed, ["third-party llama", "service"]); assert.equal(f.warnings.length, 1);
 } finally { f.shutdown(); }
});

test("reload, editor replacement, independent session and shutdown", async () => {
 const f = fixture();
 try {
  f.host.createBaseAutocompleteProvider(); const first = f.editor.onSubmit;
  f.host.createBaseAutocompleteProvider(); assert.equal(f.editor.onSubmit, first);
  const second = f.makeEditor();
  second.onSubmit = f.editor.onSubmit; f.host.editor = second;
  f.host.createBaseAutocompleteProvider(); assert.equal(second.onSubmit, first); await second.onSubmit!("/tree"); assert.equal(f.warnings.length, 1);
  const plain = fixture({ own: false });
  try { const names = await suggestions(plain.host.createBaseAutocompleteProvider()); assert.ok(names.includes("tree")); } finally { plain.shutdown(); }
  f.shutdown(); assert.ok((await suggestions(f.host.createBaseAutocompleteProvider())).includes("tree"));
  let opened = 0; f.host.showTreeSelector = () => { opened++; };
  second.setText("/tree"); await second.onSubmit!("/tree"); assert.equal(opened, 1); assert.equal(second.getText(), "");
 } finally { f.shutdown(); }
});

test("kept commands reach their normal handlers", async () => {
 const f = fixture();
 try {
  f.host.createBaseAutocompleteProvider(); const called: string[] = [];
  f.host.showUserMessageSelector = () => called.push("fork");
  f.host.handleCloneCommand = () => called.push("clone");
  f.host.handleDebugCommand = () => called.push("debug");
  f.host.handleArminSaysHi = () => called.push("arminsayshi");
  f.host.handleDementedDelves = () => called.push("dementedelves");
  for (const name of ["fork", "clone", "debug", "arminsayshi", "dementedelves"]) await f.editor.onSubmit!(`/${name}`);
  assert.deepEqual(called, ["fork", "clone", "debug", "arminsayshi", "dementedelves"]);
 } finally { f.shutdown(); }
});

test("a later editor wrapper survives shutdown and delegates normally", async () => {
 const f = fixture();
 try {
  const original = f.editor.onSubmit; f.host.createBaseAutocompleteProvider(); const inner = f.editor.onSubmit!; assert.notEqual(inner, original); let calls = 0;
  const foreign = (text: string) => { calls++; return inner(text); }; f.editor.onSubmit = foreign;
  f.shutdown(); assert.equal(f.editor.onSubmit, foreign);
  await f.editor.onSubmit("ordinary text"); assert.equal(calls, 1); assert.deepEqual(f.pending, ["ordinary text"]);
 } finally { f.shutdown(); }
});

test("a reloaded owner replaces a stale guard without removing another wrapper", async () => {
 const first = fixture(); let second: ReturnType<typeof fixture> | undefined;
 try {
  first.host.createBaseAutocompleteProvider(); const oldGuard = first.editor.onSubmit!; let forwarded = 0;
  const foreign = (text: string) => { forwarded++; return oldGuard(text); }; first.editor.onSubmit = foreign;
  first.shutdown(); second = fixture(); first.host.runtimeHost.session = second.host.session;
  first.host.createBaseAutocompleteProvider(); await first.editor.onSubmit!("/tree");
  assert.equal(first.warnings.length, 1); assert.equal(forwarded, 0);
  await first.editor.onSubmit!("hello"); assert.equal(forwarded, 1); assert.deepEqual(first.pending, ["hello"]);
  second.shutdown(); assert.equal(first.editor.onSubmit, foreign);
 } finally { first.shutdown(); second?.shutdown(); }
});

test("incompatible autocomplete group leaves submissions and suggestions stock", async () => {
 const f = fixture({ bad: true });
 try {
  const old = f.editor.onSubmit; const provider = f.host.createBaseAutocompleteProvider();
  assert.equal(f.editor.onSubmit, old); assert.ok((await suggestions(provider)).includes("tree")); assert.match(f.warnings[0], /incompatible.*command/i);
 } finally { f.shutdown(); }
});

const disabledActions = ["app.thinking.cycle", "app.model.select", "app.model.cycleForward", "app.model.cycleBackward"];
test("real editor blocks disabled actions, including custom and Windows bindings, without blocking other actions", () => {
 const f = fixture();
 try {
  const kb = f.host.keybindings;
  f.host.createBaseAutocompleteProvider();
  const editor = new CustomEditor({ requestRender() {} } as any, { borderColor: (s: string) => s } as any, kb);
  const seen: string[] = [];
  for (const id of [...disabledActions, "app.thinking.toggle"]) editor.onAction(id as any, () => seen.push(id));
  for (const input of ["\u001b[Z", "\u000c", "\u0010", "\u001b[112;6u"]) editor.handleInput(input);
  kb.setUserBindings({ "app.thinking.cycle": "ctrl+g", "app.model.select": "ctrl+l", "app.model.cycleForward": "ctrl+p", "app.model.cycleBackward": "alt+p" });
  for (const input of ["\u0007", "\u000c", "\u0010", "\u001bp", "\u0014"]) editor.handleInput(input);
  assert.deepEqual(seen, ["app.thinking.toggle"]);
  let arrows = 0; editor.onExtensionShortcut = data => { if (data === "\u001b[1;2A") { arrows++; return true; } return false; };
  editor.handleInput("\u001b[1;2A"); assert.equal(arrows, 1);
  kb.rebuild(); for (const id of disabledActions) assert.deepEqual(kb.getKeys(id), []);
  f.shutdown(); assert.deepEqual(kb.getKeys("app.thinking.cycle"), ["ctrl+g"]);
 } finally { f.shutdown(); }
});

test("Windows default Alt+P is disabled in the real editor", async () => {
 const original = Object.getOwnPropertyDescriptor(process, "platform")!;
 let WindowsManager: typeof KeybindingsManager;
 try {
  Object.defineProperty(process, "platform", { value: "win32" });
  const url = new URL("./core/keybindings.js?rqw-windows-test", import.meta.resolve("@earendil-works/pi-coding-agent"));
  WindowsManager = (await import(url.href)).KeybindingsManager;
 } finally { Object.defineProperty(process, "platform", original); }
 const kb = new WindowsManager();
 assert.deepEqual(kb.getKeys("app.model.cycleBackward"), ["alt+p"]);
 const f = fixture();
 try {
  f.host.keybindings = kb; f.host.createBaseAutocompleteProvider();
  const editor = new CustomEditor({ requestRender() {} } as any, { borderColor: (s: string) => s } as any, kb);
  let changes = 0; editor.onAction("app.model.cycleBackward", () => changes++);
  editor.handleInput("\u001bp"); assert.equal(changes, 0);
  f.shutdown(); editor.handleInput("\u001bp"); assert.equal(changes, 1);
 } finally { f.shutdown(); }
});

test("hotkeys command displays empty cells for disabled actions", async () => {
 const f = fixture(); const previous = getKeybindings();
 try {
  f.host.createBaseAutocompleteProvider(); setKeybindings(f.host.keybindings); initTheme("dark");
  for (const extension of f.host.session.resourceLoader.getExtensions().extensions) extension.shortcuts = new Map();
  const children: any[] = []; f.host.chatContainer = { addChild: (child: any) => children.push(child) };
  f.host.getMarkdownThemeWithSettings = () => ({});
  await f.editor.onSubmit!("/hotkeys");
  const text = children.find(child => typeof child.text === "string" && child.text.includes("Cycle thinking level"))?.text;
  assert.match(text, /\| `` \| Cycle thinking level \|/);
  assert.match(text, /\| `` \/ `` \| Cycle models \|/);
  assert.match(text, /\| `` \| Open model selector \|/);
 } finally { f.shutdown(); setKeybindings(previous); }
 assert.equal(getKeybindings(), previous);
});

test("settings selector filters items and search through the real component", async () => {
 const f = fixture(); const previous = getKeybindings();
 try {
  f.host.createBaseAutocompleteProvider(); setKeybindings(f.host.keybindings); initTheme("dark");
  const settings = new Proxy({ getEnableSkillCommands: () => true, getAllModelThinkingLevels: () => ({}), getWarnings: () => ({}), getHttpIdleTimeoutMs: () => 0, getCacheWarmingMode: () => "off" }, { get(target: any, key: string) { return target[key] ?? (() => false); } });
  f.host.session.settingsManager = settings;
  f.host.session.modelRuntime.getAvailableSnapshot = () => [];
  f.host.themeController = { getThemeSelection: () => "", getTerminalTheme: () => undefined };
  let component: any;
  f.host.editorContainer = { clear() {}, addChild(child: any) { component = child; } };
  f.host.ui.setFocus = () => {};
  await f.editor.onSubmit!("/settings");
  const firstScreen = component.render(100).join("\n");
  for (const label of ["Cache warming", "Default thinking level per model", "Double-escape action", "Tree filter mode"]) assert.ok(!firstScreen.includes(label), label);
  const list: any = component.getSettingsList();
  const ids = list.items.map((item: any) => item.id);
  for (const id of ["cache-warming-mode", "model-thinking", "double-escape-action", "tree-filter-mode"]) assert.ok(!ids.includes(id), id);
  assert.ok(ids.includes("theme"));
  list.handleInput("c"); list.handleInput("a"); list.handleInput("c"); list.handleInput("h"); list.handleInput("e");
  assert.ok(!list.filteredItems.some((item: any) => item.id === "cache-warming-mode"));
  assert.ok(component.render(100).length > 0);
 } finally { f.shutdown(); setKeybindings(previous); }
 assert.equal(getKeybindings(), previous);
});

test("incompatible settings list leaves all items stock and restores keys", async () => {
 const f = fixture(); const original = SettingsSelectorComponent.prototype.getSettingsList; const previous = getKeybindings();
 try {
  f.host.createBaseAutocompleteProvider(); setKeybindings(f.host.keybindings); initTheme("dark");
  f.host.session.settingsManager = new Proxy({ getEnableSkillCommands: () => true, getAllModelThinkingLevels: () => ({}), getWarnings: () => ({}), getHttpIdleTimeoutMs: () => 0 }, { get(target: any, key: string) { return target[key] ?? (() => false); } });
  f.host.session.modelRuntime.getAvailableSnapshot = () => []; f.host.themeController = { getThemeSelection: () => "", getTerminalTheme: () => undefined };
  let component: any; f.host.editorContainer = { clear() {}, addChild(child: any) { component = child; } }; f.host.ui.setFocus = () => {};
  SettingsSelectorComponent.prototype.getSettingsList = function() { const list = original.call(this); Object.defineProperty(list, "items", { writable: false }); return list; };
  await f.editor.onSubmit!("/settings");
  const list: any = original.call(component);
  assert.ok(list.items.some((item: any) => item.id === "cache-warming-mode"));
  assert.ok(f.host.keybindings.getKeys("app.model.select").length > 0);
  assert.match(f.warnings[0], /incompatible.*controls/i);
 } finally { SettingsSelectorComponent.prototype.getSettingsList = original; f.shutdown(); setKeybindings(previous); }
 assert.equal(getKeybindings(), previous);
});

test("logout selector shows only currently visible provider credentials", async () => {
 const f = fixture(); const previous = getKeybindings();
 try {
  f.host.createBaseAutocompleteProvider();
  const credentials = ["anthropic", "openai-codex", "hidden"].map(providerId => ({ providerId, type: "oauth" }));
  const removed: string[] = [];
  f.host.session.modelRuntime = { listCredentials: async () => credentials, getProvider: (id: string) => ({ id, name: id, auth: {} }), getProviders: () => [{ id: "anthropic" }, { id: "openai-codex" }], logout: async (id: string) => { removed.push(id); } };
  f.host.updateAvailableProviderCount = async () => {}; f.host.showStatus = () => {};
  initTheme("dark"); setKeybindings(f.host.keybindings);
  let component: any; f.host.editorContainer = { clear() {}, addChild(child: any) { component = child; } }; f.host.ui.setFocus = () => {};
  await f.editor.onSubmit!("/logout"); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(component.allProviders.map((item: any) => item.id), ["anthropic", "openai-codex"]);
  assert.equal(credentials.length, 3);
  component.handleInput("\r"); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(removed, ["anthropic"]);
  f.shutdown(); assert.equal((await f.host.getLogoutProviderOptions()).length, 3);
 } finally { f.shutdown(); setKeybindings(previous); }
 assert.equal(getKeybindings(), previous);
});

test("reload installs the new owner while an unrelated session stays stock", () => {
 const first = fixture(); const plain = fixture({ own: false }); let next: ReturnType<typeof fixture> | undefined;
 try {
  first.host.createBaseAutocompleteProvider(); plain.host.createBaseAutocompleteProvider();
  assert.deepEqual(first.host.keybindings.getKeys("app.model.select"), []);
  assert.ok(plain.host.keybindings.getKeys("app.model.select").length > 0);
  first.shutdown(); next = fixture(); first.host.runtimeHost.session = next.host.session;
  first.host.createBaseAutocompleteProvider(); first.host.keybindings.rebuild();
  assert.deepEqual(first.host.keybindings.getKeys("app.model.select"), []);
  next.shutdown(); assert.ok(first.host.keybindings.getKeys("app.model.select").length > 0);
 } finally { first.shutdown(); plain.shutdown(); next?.shutdown(); }
});

test("new session and resume events rebind controls to each owner", async () => {
 const dir = mkdtempSync(join(tmpdir(), "rqw-command-session-"));
 const first = fixture(); const owners = [first]; const events: string[] = [];
 try {
  const resume = SessionManager.create(dir, dir);
  resume.appendMessage({ role: "user", content: [{ type: "text", text: "resume" }], timestamp: 1 });
  const path = resume.getSessionFile()!;
  const prepare = (f: ReturnType<typeof fixture>, manager: any) => {
   f.host.session.sessionManager = manager; f.host.session.sessionFile = manager.getSessionFile();
   f.host.session.abort = async () => {}; f.host.session.dispose = () => {};
   return f.host.session;
  };
  const initial = prepare(first, SessionManager.inMemory(dir));
  const runtime: any = new AgentSessionRuntime(initial, { cwd: dir, agentDir: dir } as any, async (options: any) => {
   const next = fixture(); owners.push(next);
   next.handlers.set("session_start", [(event: any) => events.push(event.reason)]);
   const session = prepare(next, options.sessionManager);
   await session.extensionRunner.emit(options.sessionStartEvent);
   return { session, services: { cwd: dir, agentDir: dir }, diagnostics: [] } as any;
  });
  first.host.runtimeHost = runtime; first.host.autocompleteProviderWrappers = [];
  runtime.setRebindSession(async () => { first.host.setupAutocompleteProvider(); });
  first.host.setupAutocompleteProvider();
  assert.deepEqual(first.host.keybindings.getKeys("app.model.select"), []);
  await runtime.newSession();
  assert.deepEqual(first.host.keybindings.getKeys("app.model.select"), []);
  await runtime.switchSession(path);
  assert.deepEqual(first.host.keybindings.getKeys("app.model.select"), []);
  assert.deepEqual(events, ["new", "resume"]);
  owners.at(-1)!.shutdown();
  assert.ok(first.host.keybindings.getKeys("app.model.select").length > 0);
 } finally { for (const owner of owners) owner.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test("incompatible manager falls back to stock with a controls warning", () => {
 const f = fixture();
 try {
  f.host.keybindings.keysById = null;
  const original = f.host.keybindings.rebuild;
  f.host.createBaseAutocompleteProvider();
  assert.equal(f.host.keybindings.rebuild, original);
  assert.match(f.warnings[0], /incompatible.*controls/i);
 } finally { f.shutdown(); }
});

test("shutdown restores both nested prototype patches", () => {
 const original = Object.getOwnPropertyDescriptor(InteractiveMode.prototype, "createBaseAutocompleteProvider")!.value;
 const f = fixture();
 try {
  f.host.createBaseAutocompleteProvider();
  assert.notEqual(Object.getOwnPropertyDescriptor(InteractiveMode.prototype, "createBaseAutocompleteProvider")!.value, original);
  f.shutdown();
  assert.equal(Object.getOwnPropertyDescriptor(InteractiveMode.prototype, "createBaseAutocompleteProvider")!.value, original);
 } finally { f.shutdown(); }
});

test("a foreign rebuild wrapper survives removal and stock bindings return", () => {
 const f = fixture();
 try {
  f.host.createBaseAutocompleteProvider(); const kb = f.host.keybindings; const inner = kb.rebuild; let calls = 0;
  const foreign = function(this: unknown) { calls++; return inner.call(this); }; kb.rebuild = foreign;
  f.shutdown(); assert.equal(kb.rebuild, foreign); assert.ok(calls > 0); assert.ok(kb.getKeys("app.model.select").length > 0);
 } finally { f.shutdown(); }
});
