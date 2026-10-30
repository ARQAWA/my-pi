import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { InteractiveMode, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type Terminal } from "@earendil-works/pi-tui";

const root = new URL("../../../", import.meta.url);
const path = fileURLToPath(new URL("extensions/RQW-blocks/index.ts", root));
const loader = await import(new URL("node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js", root).href);

for (const mode of ["normal", "switch", "disabled", "error", "incompatible"] as const) it(`early history startup: ${mode}`, async t => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
	t.mock.method(childProcess, "spawnSync", () => ({ status: 0, stdout: "tool 1.0", error: undefined }));
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	const loaded = await loader.loadExtensions([path], fileURLToPath(root));
	assert.deepEqual(loaded.errors, []);
	const manager = SessionManager.inMemory("/w");
	manager.appendMessage({ role: "user", content: "old prompt", timestamp: 0 });
	const kept = manager.appendMessage({ role: "user", content: "kept prompt", timestamp: 1 });
	manager.appendCompaction("summary", kept, 1234);
	manager.appendMessage({ role: "user", content: "latest prompt", timestamp: 2 });
	const nextManager = SessionManager.inMemory("/next");
	nextManager.appendMessage({ role: "user", content: "new previous prompt", timestamp: 3 });
	nextManager.appendMessage({ role: "user", content: "new session prompt", timestamp: 4 });
	const settings = SettingsManager.inMemory({ quietStartup: true, tui: { mode: "fullscreen" } } as never);
	let entered!: () => void, proceed!: () => void;
	const waiting = new Promise<void>(resolve => { entered = resolve; });
	const pending = new Promise<void>(resolve => { proceed = resolve; });
	let first = "";
	const terminal = {
		columns: 100, rows: 30, kittyProtocolActive: false,
		start() { first = host.chatContainer.render(100).map(stripTerminalSequences).join("\n"); },
		stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {},
		clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
	} as unknown as Terminal;
	let subscriber: ((event: unknown) => Promise<void>) | undefined;
	const sessionData: any = {
		settingsManager: settings, sessionManager: manager, scopedModels: [], thinkingLevel: "off", state: { model: undefined }, autoCompactionEnabled: true,
		getContextUsage: () => undefined, modelRuntime: { getAvailableSnapshot: () => [], isUsingSubscription: () => false },
		resourceLoader: { getThemes: () => ({ themes: [] }), getExtensions: () => loaded },
		extensionRunner: { getMarkdownTransformers: () => [], getMessageRenderer: () => undefined, resolveToolRenderers: (_n: string, next: () => unknown) => next() },
		getToolDefinition: () => undefined,
		subscribe(fn: typeof subscriber) { subscriber = fn; return () => { subscriber = undefined; }; },
	};
	const runtime: any = { session: sessionData, setBeforeSessionInvalidate() {}, setRebindSession() {} };
	const host: any = new InteractiveMode(runtime, { terminal, tuiMode: "fullscreen" });
	for (const name of ["registerSignalHandlers", "unregisterSignalHandlers", "ensurePngTranscoder", "setupKeyHandlers", "setupEditorSubmitHandler", "applyRuntimeSettings", "setupAutocompleteProvider", "setupExtensionShortcuts", "showLoadedResources", "showStartupNoticesIfNeeded", "updateEditorBorderColor", "updateTerminalTitle"]) t.mock.method(host, name, () => {});
	t.mock.method(host, "getChangelogForDisplay", () => undefined);
	t.mock.method(host, "updateAvailableProviderCount", async () => {});
	t.mock.method(host.themeController, "waitForTerminalColors", async () => {});
	if (mode === "incompatible") Object.defineProperty(host, "renderCurrentSessionState", { configurable: true, value: undefined });
	let binds = 0;
	sessionData.bindExtensions = async () => {
		if (++binds > 1) return;
		entered();
		await pending;
		if (mode === "error") throw new Error("startup handler failed");
		if (mode === "switch") {
			runtime.session = { ...sessionData, sessionManager: nextManager };
			host.createExtensionUIContext().setEditorComponent((tui: any, theme: any, keys: any) => new host.defaultEditor.constructor(tui, theme, keys));
			host.editor.handleInput("\x1b[A");
			assert.equal(host.editor.getText(), "", "the new editor must not receive the old session's input history");
			await host.rebindCurrentSession({ renderBeforeBind: true });
		} else if (mode === "normal") {
			assert.ok(subscriber);
			for (const text of ["handler one", "handler two"]) await subscriber!({ type: "message_start", message: { role: "custom", customType: "test", content: text, display: true, timestamp: 4 } });
			host.createExtensionUIContext().notify("startup notice", "warning");
		}
		const ui = host.createExtensionUIContext();
		ui.setEditorComponent((tui: any, theme: any, keys: any) => new host.defaultEditor.constructor(tui, theme, keys));
		for (const fn of loaded.extensions[0].handlers.get("session_start") ?? []) await fn({}, { hasUI: true, mode: "tui", sessionManager: runtime.session.sessionManager, ui });
	};
	const text = () => host.chatContainer.render(100).map(stripTerminalSequences).join("\n");
	let init: Promise<void> | undefined;
	try {
		init = host.init();
		await Promise.race([waiting, init]);
		if (mode === "incompatible") assert.doesNotMatch(first, /latest prompt/);
		else {
			assert.match(first, /latest prompt/);
			assert.match(first, /compaction · 1\.2k tokens/);
			assert.doesNotMatch(first, /old prompt/);
			host.renderer.renderNow();
			const screen = host.renderer.getScreenLines().map(stripTerminalSequences).join("\n");
			assert.match(screen, /latest prompt/);
			assert.match(screen, /compaction · 1\.2k tokens/);
		}
		proceed();
		if (mode === "error") {
			await assert.rejects(init!, /startup handler failed/);
			host.rebuildChatFromMessages();
			assert.match(text(), /latest prompt/);
			return;
		}
		await init;
		if (mode === "switch") {
			assert.match(text(), /new session prompt/);
			assert.doesNotMatch(text(), /old prompt|latest prompt/);
			host.editor.handleInput("\x1b[A"); assert.equal(host.editor.getText(), "new session prompt");
			host.editor.handleInput("\x1b[A"); assert.equal(host.editor.getText(), "new previous prompt");
			host.editor.handleInput("\x1b[A"); assert.equal(host.editor.getText(), "new previous prompt");
			host.editor.handleInput("\x1b[B"); assert.equal(host.editor.getText(), "new session prompt");
			host.editor.handleInput("\x1b[B"); assert.equal(host.editor.getText(), "");
		} else if (mode === "disabled") {
			const disabled = { ...loaded, extensions: [] };
			runtime.session = { ...sessionData, sessionManager: nextManager, resourceLoader: { ...sessionData.resourceLoader, getExtensions: () => disabled },
				bindExtensions: async () => host.createExtensionUIContext().setEditorComponent((tui: any, theme: any, keys: any) => new host.defaultEditor.constructor(tui, theme, keys)) };
			await host.rebindCurrentSession({ renderBeforeBind: true });
			host.editor.handleInput("\x1b[A"); assert.equal(host.editor.getText(), "", "disabled blocks must leave the replacement editor stock");
		} else if (mode === "normal") {
			const output = text();
			for (const value of ["latest prompt", "handler one", "handler two", "startup notice"]) assert.equal(output.split(value).length - 1, 1, value);
			host.editor.handleInput("\x1b[A"); assert.equal(host.editor.getText(), "latest prompt");
			host.editor.handleInput("\x1b[A"); assert.equal(host.editor.getText(), "kept prompt");
			host.editor.handleInput("\x1b[A"); assert.equal(host.editor.getText(), "old prompt");
			host.editor.handleInput("\x1b[B"); assert.equal(host.editor.getText(), "kept prompt");
			host.transcriptScrollView.scrollToStart();
			assert.match(text(), /old prompt/);
			host.rebuildChatFromMessages();
			assert.match(text(), /latest prompt/);
		}
	} finally {
		proceed();
		if (init) await init.catch(() => {});
		host.stop("none");
	}
});
