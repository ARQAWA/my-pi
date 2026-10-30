import assert from "node:assert/strict";
import { test } from "node:test";
import { CustomEditor, ExtensionRunner, InteractiveMode, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import commands from "../extensions/RQW-commands/index.ts";
import { ContextEditor } from "../extensions/RQW-statusbar/editor.ts";

const { KeybindingsManager } = await import(new URL("./core/keybindings.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

test("commands guard both Pi and statusbar editors and survives replacing the editor", async () => {
 const handlers = new Map<string, Function[]>();
 const pi = { on(name: string, handler: Function) {
  const registered = (...args: unknown[]) => handler(...args); const list = handlers.get(name) ?? []; handlers.set(name, list); list.push(registered);
  return () => { const at = list.indexOf(registered); if (at >= 0) list.splice(at, 1); };
 } } as unknown as ExtensionAPI;
 commands(pi);
 try {
  const extensions = [{ handlers, commands: new Map() }];
  const runner = new ExtensionRunner(extensions as any, {} as any, "/", {} as any, {} as any);
  const host: any = Object.create(InteractiveMode.prototype);
  const ui = { requestRender() {} }; const theme = { borderColor: (s: string) => s } as any; const keys = new KeybindingsManager();
  host.ui = ui; host.keybindings = keys; host.defaultEditor = new CustomEditor(ui as any, theme, keys);
  host.editor = new ContextEditor(ui as any, theme, keys, () => undefined);
  host.runtimeHost = { session: { extensionRunner: runner, promptTemplates: [], resourceLoader: { getExtensions: () => ({ extensions }), getSkills: () => ({ skills: [] }) },
   scopedModels: [], modelRuntime: { getAvailableSnapshot: () => [] }, settingsManager: { getEnableSkillCommands: () => true }, sessionManager: { getCwd: () => "/" } } };
  host.skillCommands = new Map(); const warnings: string[] = []; host.showWarning = (text: string) => warnings.push(text);
  host.setupEditorSubmitHandler(); host.editor.onSubmit = host.defaultEditor.onSubmit;
  host.createBaseAutocompleteProvider();
  const statusbar = host.editor;
  for (const editor of [host.defaultEditor, statusbar]) { host.editor = editor; editor.setText("/tree"); await editor.onSubmit("/tree"); assert.equal(editor.getText(), ""); }
  assert.deepEqual(warnings, ["This command is disabled.", "This command is disabled."]);
  assert.deepEqual(keys.getKeys("app.model.select"), []);
  const replacement = new CustomEditor(ui as any, theme, keys); replacement.onSubmit = host.defaultEditor.onSubmit; host.editor = replacement;
  replacement.setText("/tree"); await replacement.onSubmit!("/tree"); assert.deepEqual(warnings, Array(3).fill("This command is disabled.")); assert.equal(replacement.getText(), "");
 } finally { for (const handler of handlers.get("session_shutdown") ?? []) handler(); }
});
