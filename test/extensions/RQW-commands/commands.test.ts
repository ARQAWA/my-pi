import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentSession, CustomEditor, ExtensionRunner, InteractiveMode, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import commands from "../../../extensions/RQW-commands/index.ts";

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
 host.ui = ui; host.defaultEditor = editor; host.editor = editor;
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
