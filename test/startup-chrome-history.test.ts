import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { ExtensionRunner, InteractiveMode, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type Terminal } from "@earendil-works/pi-tui";

const root = new URL("../", import.meta.url);
const loader = await import(new URL("node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js", root).href);
const paths = ["RQW-statusbar", "RQW-tool-ui", "RQW-blocks", "RQW-skill-dollar"].map(name => fileURLToPath(new URL(`extensions/${name}/index.ts`, root)));
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const skill = '<skill name="example" location="/s/example/SKILL.md">\nReferences are relative to /s/example.\nskill secret body\n</skill>';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

it("the first startup and switched frames contain final history and the current input history", async t => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
	t.mock.method(childProcess, "spawnSync", () => ({ status: 0, stdout: "tool 1.0", error: undefined }));
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	const settings = SettingsManager.inMemory({ quietStartup: true, theme: "dark", tui: { mode: "fullscreen" } } as never);
	const create = async (label: string) => {
		const loaded = await loader.loadExtensions(paths, "/tmp");
		assert.deepEqual(loaded.errors, []);
		const manager = SessionManager.inMemory("/tmp");
		const add = (message: unknown, time: number) => { t.mock.timers.setTime(time); return manager.appendMessage(message as never); };
		const first = add({ role: "user", content: `${skill}\n\n${label} request`, timestamp: 0 }, 0);
		add({ role: "assistant", content: [{ type: "text", text: `${label} intermediate` }, { type: "toolCall", id: `${label}-id`, name: "read", arguments: { path: "sample.ts" } }], api: "x", provider: "p", model: "m", usage, stopReason: "toolUse", timestamp: 1 }, 1000);
		add({ role: "toolResult", toolCallId: `${label}-id`, toolName: "read", content: [{ type: "text", text: `${label} secret tool output` }], isError: false, timestamp: 2 }, 2000);
		add({ role: "assistant", content: [{ type: "text", text: `${label} answer` }], api: "x", provider: "p", model: "m", usage, stopReason: "stop", timestamp: 3 }, 42000);
		manager.appendCompaction(`${label} summary`, first, 1234);
		add({ role: "user", content: `${label} previous`, timestamp: 4 }, 43000);
		add({ role: "user", content: `${label} latest`, timestamp: 5 }, 44000);
		Object.assign(loaded.runtime, { getSettings: () => ({}), getSessionName: () => "", getThinkingLevel: () => "off" });
		const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, "/tmp", manager, {} as never);
		const errors: string[] = [];
		runner.onError(error => errors.push(error.error));
		const gate = deferred(), entered = deferred();
		const session: any = {
			settingsManager: settings, sessionManager: manager, scopedModels: [], thinkingLevel: "off", state: { model: undefined }, autoCompactionEnabled: true,
			getContextUsage: () => undefined, modelRuntime: { getAvailableSnapshot: () => [], isUsingSubscription: () => false },
			resourceLoader: { getThemes: () => ({ themes: [] }), getExtensions: () => loaded }, extensionRunner: runner,
			getToolDefinition: () => undefined, subscribe() { return () => {}; },
			async bindExtensions({ uiContext }: any) { runner.setUIContext(uiContext, "tui"); entered.resolve(); await gate.promise; await runner.emit({ type: "session_start", reason: "startup" }); },
		};
		return { session, manager, runner, gate, entered, errors };
	};
	const old = await create("old");
	let first = "";
	const terminal = {
		columns: 100, rows: 40, kittyProtocolActive: false,
		start() { first = host.chatContainer.render(100).map(stripTerminalSequences).join("\n"); },
		stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
	} as unknown as Terminal;
	const runtime: any = { session: old.session, setBeforeSessionInvalidate() {}, setRebindSession() {} };
	const host: any = new InteractiveMode(runtime, { terminal, tuiMode: "fullscreen" });
	for (const name of ["registerSignalHandlers", "unregisterSignalHandlers", "ensurePngTranscoder", "setupKeyHandlers", "setupEditorSubmitHandler", "applyRuntimeSettings", "setupAutocompleteProvider", "setupExtensionShortcuts", "showLoadedResources", "showStartupNoticesIfNeeded", "updateEditorBorderColor", "updateTerminalTitle"]) t.mock.method(host, name, () => {});
	t.mock.method(host, "getChangelogForDisplay", () => undefined);
	t.mock.method(host, "updateAvailableProviderCount", async () => {});
	t.mock.method(host.themeController, "waitForTerminalColors", async () => {});
	const visible = () => host.chatContainer.render(100).map(stripTerminalSequences).join("\n");
	const check = (text: string, label: string) => {
		assert.match(text, new RegExp(`${label} latest`));
		assert.match(text, /worked for 42s ›/);
		assert.match(text, /└ skill\s+example/);
		assert.match(text, /compaction · 1\.2k tokens/);
		assert.doesNotMatch(text, /intermediate|secret tool output|skill secret body/);
	};
	let init: Promise<void> | undefined;
	let next: Awaited<ReturnType<typeof create>> | undefined;
	try {
		init = host.init();
		await Promise.race([old.entered.promise, init]);
		check(first, "old");
		host.renderer.renderNow();
		const oldScreen = host.renderer.getScreenLines().map(stripTerminalSequences).join("\n");
		assert.match(oldScreen, /worked for 42s ›/);
		assert.ok(oldScreen.includes(old.manager.getSessionId()));
		assert.doesNotMatch(oldScreen, /\(auto\)|\$0\.000/);
		old.gate.resolve(); await init;
		assert.deepEqual(old.errors, []);
		assert.equal(visible(), first);
		await old.runner.emit({ type: "session_shutdown", reason: "resume" });
		next = await create("new");
		runtime.session = next.session;
		const binding = host.rebindCurrentSession({ renderBeforeBind: true });
		await next.entered.promise;
		const frame = visible();
		check(frame, "new");
		assert.doesNotMatch(frame, /old request|old latest|old answer/);
		host.renderer.renderNow();
		const newScreen = host.renderer.getScreenLines().map(stripTerminalSequences).join("\n");
		assert.ok(newScreen.includes(next.manager.getSessionId()));
		assert.doesNotMatch(newScreen, /\(auto\)|\$0\.000/);
		next.gate.resolve(); await binding;
		assert.deepEqual(next.errors, []);
		assert.equal(visible(), frame);
		host.editor.handleInput("\x1b[A"); assert.equal(host.editor.getText(), "new latest");
		host.editor.handleInput("\x1b[A"); assert.equal(host.editor.getText(), "new previous");
		host.editor.handleInput("\x1b[B"); assert.equal(host.editor.getText(), "new latest");
	} finally {
		old.gate.resolve(); next?.gate.resolve();
		if (init) await init.catch(() => {});
		if (next) await next.runner.emit({ type: "session_shutdown", reason: "quit" });
		host.stop("none");
	}
});
