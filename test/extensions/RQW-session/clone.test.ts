import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { InteractiveMode, SessionManager, SessionSelectorComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeybindings, setKeybindings } from "@earendil-works/pi-tui";
import { installClone } from "../../../extensions/RQW-session/clone.ts";

const { TuiBase } = await import(new URL("./tui.js", import.meta.resolve("@earendil-works/pi-tui")).href);
const { KeybindingsManager } = await import(new URL("./core/keybindings.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const { initTheme } = await import(new URL("./modes/interactive/theme/theme.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const cloneKey = "\u001b[100;6u";

function fixture(path: string, active: SessionManager, outcome: { cancelled: boolean } = { cancelled: false }, incompatible = false) {
 const proto: any = InteractiveMode.prototype;
 const factory = Object.getOwnPropertyDescriptor(proto, "createBaseAutocompleteProvider")!;
 const selector = Object.getOwnPropertyDescriptor(proto, "showSelector")!;
 Object.defineProperty(proto, "createBaseAutocompleteProvider", { ...factory, value() { return {}; } });
 Object.defineProperty(proto, "showSelector", { ...selector, value(create: Function) { this.created = create(() => { this.closed = true; }); } });
 const handlers = new Map<string, Function[]>();
 const pi = { on(name: string, fn: Function) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); } } as unknown as ExtensionAPI;
 const dispose = installClone(pi);
 const host: any = Object.create(proto);
 let debug = 0;
 host.ui = { onDebug: () => debug++, requestRender() {} };
 host.runtimeHost = { session: { resourceLoader: { getExtensions: () => ({ extensions: [{ handlers }] }) }, sessionManager: active } };
 host.resumed = [];
 host.warnings = [];
 host.showWarning = (warning: string) => { host.warnings.push(warning); };
 host.handleResumeSession = async (file: string) => { host.resumed.push(file); return outcome; };
 host.createBaseAutocompleteProvider();
 assert.equal(host.ui.onDebug, undefined, "debug binding must be removed");
 const info = { path, id: "id", cwd: active.getCwd(), created: new Date(0), modified: new Date(0), messageCount: 1, firstMessage: "test", allMessagesText: "" };
 host.showSelector((done: Function) => {
  const component = new SessionSelectorComponent(async () => [info], async () => [info], () => done(), () => done(), () => {}, () => {}, { keybindings: new KeybindingsManager() });
  const focus = component.getSessionList();
  if (incompatible) Object.defineProperty(component, "getSessionList", { value: undefined });
  return { component, focus };
 });
 return { host, handlers, debug: () => debug, dispose() { dispose(); Object.defineProperty(proto, "createBaseAutocompleteProvider", factory); Object.defineProperty(proto, "showSelector", selector); } };
}

async function loaded() { await Promise.resolve(); await Promise.resolve(); }
function user(text: string) { return { role: "user" as const, content: [{ type: "text" as const, text }], timestamp: 1 }; }

test("clone key copies only the current branch and opens it without touching the source", async () => {
 const dir = mkdtempSync(join(tmpdir(), "rqw-clone-test-")); const oldKeys = getKeybindings();
 try {
  setKeybindings(new KeybindingsManager()); initTheme("dark");
  const source = SessionManager.create(dir, dir); const root = source.appendMessage(user("root"));
  source.appendMessage(user("abandoned")); source.branch(root); source.appendMessage(user("current"));
  const path = source.getSessionFile()!; const before = readFileSync(path);
  const active = SessionManager.inMemory(dir); const f = fixture(path, active);
  try {
   await loaded(); const component: any = f.host.created.component; const list: any = component.getSessionList();
   assert.match(component.render(140).join("\n"), /Ctrl\+Shift\+D clone/);
   const tui: any = new TuiBase({} as any); tui.onDebug = f.host.ui.onDebug; tui.focusedComponent = list; tui.requestImmediateRender = () => {};
   tui.handleTerminalInput(cloneKey); await loaded();
   assert.equal(f.debug(), 0); assert.equal(f.host.closed, true); assert.equal(f.host.resumed.length, 1);
   const clone = SessionManager.open(f.host.resumed[0]);
   assert.notEqual(clone.getSessionId(), source.getSessionId());
   assert.deepEqual(clone.getBranch().filter((e: any) => e.type === "message").map((e: any) => e.message.content[0].text), ["root", "current"]);
   assert.deepEqual(readFileSync(path), before);
  } finally { f.dispose(); }
 } finally { setKeybindings(oldKeys); rmSync(dir, { recursive: true, force: true }); }
});

test("cloning the active session follows its unpersisted leaf", async () => {
 const dir = mkdtempSync(join(tmpdir(), "rqw-clone-test-")); const oldKeys = getKeybindings();
 try {
  setKeybindings(new KeybindingsManager()); initTheme("dark");
  const source = SessionManager.create(dir, dir); const root = source.appendMessage(user("root"));
  source.appendMessage(user("later")); source.branch(root);
  const path = source.getSessionFile()!; const before = readFileSync(path);
  const f = fixture(path, source);
  try {
   await loaded(); f.host.created.component.getSessionList().handleInput(cloneKey); await loaded();
   const clone = SessionManager.open(f.host.resumed[0]);
   assert.deepEqual(clone.getBranch().filter((e: any) => e.type === "message").map((e: any) => e.message.content[0].text), ["root"]);
   assert.deepEqual(readFileSync(path), before); assert.equal(source.getLeafId(), root);
  } finally { f.dispose(); }
 } finally { setKeybindings(oldKeys); rmSync(dir, { recursive: true, force: true }); }
});

test("an incompatible selector stays stock", async () => {
 const dir = mkdtempSync(join(tmpdir(), "rqw-clone-test-")); const oldKeys = getKeybindings();
 try {
  setKeybindings(new KeybindingsManager()); initTheme("dark");
  const source = SessionManager.create(dir, dir); source.appendMessage(user("hello"));
  const f = fixture(source.getSessionFile()!, SessionManager.inMemory(dir), { cancelled: false }, true);
  try {
   await loaded();
   assert.match(f.host.warnings[0], /incompatible Pi selector/);
   f.host.created.focus.handleInput(cloneKey);
   assert.equal(f.host.resumed.length, 0);
  } finally { f.dispose(); }
 } finally { setKeybindings(oldKeys); rmSync(dir, { recursive: true, force: true }); }
});

test("delete, cancel, clone error and prototype restoration keep stock behavior", async () => {
 const dir = mkdtempSync(join(tmpdir(), "rqw-clone-test-")); const oldKeys = getKeybindings();
 try {
  setKeybindings(new KeybindingsManager()); initTheme("dark");
  const source = SessionManager.create(dir, dir); source.appendMessage(user("hello")); const path = source.getSessionFile()!;
  const original = (InteractiveMode.prototype as any).showSelector;
  const f = fixture(path, SessionManager.inMemory(dir), { cancelled: true });
  try {
   await loaded(); const list: any = f.host.created.component.getSessionList();
   list.handleInput("\u0004"); assert.equal(list.confirmingDeletePath, path);
   list.handleInput(cloneKey); assert.equal(f.host.resumed.length, 0);
   list.handleInput("\u001b"); assert.equal(list.confirmingDeletePath, null);
   list.handleInput(cloneKey); await loaded(); assert.equal(f.host.resumed.length, 1);
   assert.throws(() => readFileSync(f.host.resumed[0])); assert.ok(readFileSync(path));
  } finally { f.dispose(); }
  assert.equal((InteractiveMode.prototype as any).showSelector, original);
  const g = fixture(path, SessionManager.inMemory(dir));
  try {
   await loaded(); unlinkSync(path); const list: any = g.host.created.component.getSessionList();
   let error = ""; list.onError = (message: string) => { error = message; };
   list.handleInput(cloneKey); assert.match(error, /Failed to clone/); assert.equal(g.host.resumed.length, 0);
  } finally { g.dispose(); }
 } finally { setKeybindings(oldKeys); rmSync(dir, { recursive: true, force: true }); }
});
