import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { CompactionSummaryMessageComponent, initTheme, InteractiveMode, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences, type Terminal } from "@earendil-works/pi-tui";
import { buildSession, makeFullscreen } from "./history-host.ts";

const root = new URL("../../../", import.meta.url);
const path = fileURLToPath(new URL("extensions/RQW-blocks/index.ts", root));
const loader = await import(new URL("node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js", root).href);
function session(question = "question") {
	const manager = SessionManager.inMemory("/w");
	const first = manager.appendMessage({ role: "user", content: question, timestamp: 0 });
	manager.appendCompaction("summary body", first, 1234);
	manager.branchWithSummary(manager.getLeafId(), "branch body");
	manager.appendMessage({ role: "bashExecution", command: "echo hi", output: "hello\n", exitCode: 0, cancelled: false, timestamp: 1 } as never);
	manager.appendMessage({ role: "assistant", content: [{ type: "thinking", thinking: "secret" }, { type: "text", text: "answer" }], api: "x", provider: "p", model: "m", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 } as never);
	return manager;
}

async function setup() {
	initTheme();
	const loaded = await loader.loadExtensions([path], fileURLToPath(root));
	assert.deepEqual(loaded.errors, []);
	const manager = session();
	const fx = makeFullscreen(manager, { rows: 30 });
	const host: any = fx.host;
	host.hideThinkingBlock = true;
	host.runtimeHost.session.resourceLoader = { getExtensions: () => loaded };
	Object.assign(host, { disposeActiveSelector() {}, clearExtensionTerminalInputListeners() {}, unregisterSignalHandlers() {}, footerDataProvider: { dispose() {} } });
	Object.assign(host.footer, { dispose() {} });
	Object.assign(host.themeController, { disableAutoSync() {} });
	Object.assign(host.runtimeHost.session.settingsManager, { getShowTerminalProgress: () => false });
	const handlers = loaded.extensions[0].handlers;
	const ctx = { hasUI: true, mode: "tui", sessionManager: manager, ui: { theme: host.createExtensionUIContext().theme, setWidget() {} } };
	const draw = () => { host.rebuildChatFromMessages(); fx.frame(); return host.chatContainer.render(60).map(stripTerminalSequences).join("\n"); };
	return { loaded, host, fx, ctx, handlers, draw, close: () => { host.isInitialized = false; host.stop("none"); fx.stop(); } };
}

it("styles a history frame during real init before session_start", async t => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
	t.mock.method(childProcess, "spawnSync", () => ({ status: 0, stdout: "tool 1.0", error: undefined }));
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	const loaded = await loader.loadExtensions([path], fileURLToPath(root));
	assert.deepEqual(loaded.errors, []);
	const manager = session();
	const settings = SettingsManager.inMemory({ quietStartup: true, tui: { mode: "fullscreen" } } as never);
	let enter!: () => void, proceed!: () => void;
	const entered = new Promise<void>(resolve => { enter = resolve; });
	const pending = new Promise<void>(resolve => { proceed = resolve; });
	const chunks: string[] = [];
	const terminal = {
		columns: 100, rows: 30, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {},
		write(text: string) { chunks.push(text); }, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {},
		clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
	} as unknown as Terminal;
	const sessionData: any = {
		settingsManager: settings, sessionManager: manager, scopedModels: [], thinkingLevel: "off", state: { model: undefined }, autoCompactionEnabled: true,
		getContextUsage: () => undefined,
		modelRuntime: { getAvailableSnapshot: () => [], isUsingSubscription: () => false },
		resourceLoader: { getThemes: () => ({ themes: [] }), getExtensions: () => loaded },
		extensionRunner: { getMarkdownTransformers: () => [], getMessageRenderer: () => undefined, resolveToolRenderers: (_n: string, next: () => unknown) => next() },
		getToolDefinition: () => undefined,
	};
	const runtime = { session: sessionData, setBeforeSessionInvalidate() {}, setRebindSession() {} };
	const host: any = new InteractiveMode(runtime as never, { terminal, tuiMode: "fullscreen" });
	for (const name of ["registerSignalHandlers", "unregisterSignalHandlers", "ensurePngTranscoder", "setupKeyHandlers", "setupEditorSubmitHandler", "applyRuntimeSettings", "subscribeToAgent", "setupAutocompleteProvider", "setupExtensionShortcuts", "showLoadedResources", "showStartupNoticesIfNeeded", "updateEditorBorderColor", "updateTerminalTitle"]) t.mock.method(host, name, () => {});
	t.mock.method(host, "getChangelogForDisplay", () => undefined);
	t.mock.method(host, "updateAvailableProviderCount", async () => {});
	t.mock.method(host.themeController, "waitForTerminalColors", async () => {});
	sessionData.bindExtensions = async () => {
		host.addMessageToChat({ role: "compactionSummary", summary: "startup summary", tokensBefore: 1234, timestamp: 0 });
		host.renderer.renderNow();
		enter();
		await pending;
		for (const fn of loaded.extensions[0].handlers.get("session_start") ?? []) await fn({}, { hasUI: true, mode: "tui", sessionManager: manager, ui: { theme: host.createExtensionUIContext().theme, setWidget() {} } });
	};
	let init: Promise<void> | undefined;
	try {
		init = host.init();
		await Promise.race([entered, init]);
		assert.match(chunks.map(stripTerminalSequences).join("\n"), /compaction · 1\.2k tokens/);
	} finally {
		proceed();
		try { await init; } finally { host.stop("none"); }
	}
});

it("styles the first history and keeps it during a session change", async () => {
	const s = await setup();
	try {
		const first = s.draw();
		assert.match(first, /compaction · 1\.2k tokens/);
		assert.match(first, /branch summary/);
		assert.match(first, /\$ echo hi/);
		assert.match(first, /✓/);
		assert.match(first, /hello/);
		assert.match(first, /answer/);
		assert.doesNotMatch(first, /Thinking|secret|summary body|branch body/);
		for (const fn of s.handlers.get("session_start") ?? []) await fn({}, s.ctx);
		assert.equal(s.draw(), first);
		for (const fn of s.handlers.get("session_shutdown") ?? []) await fn({ reason: "switch" }, s.ctx);
		assert.equal(s.host.chatContainer.render(60).map(stripTerminalSequences).join("\n"), first);
		const next = await loader.loadExtensions([path], fileURLToPath(root));
		assert.equal(s.host.chatContainer.render(60).map(stripTerminalSequences).join("\n"), first);
		let proceed!: () => void;
		const pending = new Promise<void>(resolve => { proceed = resolve; });
		s.host.runtimeHost.session = {
			...s.host.runtimeHost.session, sessionManager: session("new question"),
			resourceLoader: { getExtensions: () => next, getThemes: () => ({ themes: [] }) },
			async bindExtensions() {
				await pending;
				for (const fn of next.extensions[0].handlers.get("session_start") ?? []) await fn({}, { ...s.ctx, sessionManager: s.host.sessionManager });
			},
		};
		Object.assign(s.host, {
			pendingMessagesContainer: new Container(), programStatus: { reset() {} },
			applyRuntimeSettings() {}, subscribeToAgent() {}, setupAutocompleteProvider() {}, setupExtensionShortcuts() {},
			showLoadedResources() {}, showStartupNoticesIfNeeded() {}, async updateAvailableProviderCount() {}, updateTerminalTitle() {},
		});
		const rebind = s.host.rebindCurrentSession({ renderBeforeBind: true });
		s.fx.frame();
		const nextFrame = s.host.chatContainer.render(60).map(stripTerminalSequences).join("\n");
		assert.match(nextFrame, /new question/);
		assert.doesNotMatch(nextFrame, /^ question\s*$/m);
		assert.match(nextFrame, /compaction · 1\.2k tokens/);
		proceed();
		await rebind;
		assert.equal(s.host.chatContainer.render(60).map(stripTerminalSequences).join("\n"), nextFrame);
	} finally { s.close(); }
});

it("releases styles when disabled and ignores a foreign host", async () => {
	const s = await setup();
	try {
		const first = s.draw();
		const foreign = makeFullscreen(SessionManager.inMemory("/foreign"));
		try { foreign.host.renderSessionEntries([]); assert.equal(s.draw(), first); } finally { foreign.stop(); }
		for (const result of [{ extensions: [], runtime: {} }, { extensions: null, runtime: {} }]) {
			s.host.runtimeHost.session.resourceLoader = { getExtensions: () => result };
			assert.doesNotMatch(s.draw(), /compaction · 1\.2k tokens/);
		}
		const again = await loader.loadExtensions([path], fileURLToPath(root));
		s.host.runtimeHost.session.resourceLoader = { getExtensions: () => again };
		assert.match(s.draw(), /compaction · 1\.2k tokens/);
	} finally { s.close(); }
});

it("leaves Pi unchanged for an incompatible component", async () => {
	const proto = CompactionSummaryMessageComponent.prototype as any;
	const original = Object.getOwnPropertyDescriptor(proto, "render");
	Object.defineProperty(proto, "render", { configurable: true, writable: false, value: proto.render });
	try {
		const s = await setup();
		try {
			const rows = s.draw();
			assert.doesNotMatch(rows, /compaction · 1\.2k tokens/);
			assert.match(rows, /branch summary/);
			assert.match(rows, /✓/);
			assert.doesNotMatch(rows, /Thinking|secret/);
			const manager = buildSession(6, 2, 1).manager;
			s.host.runtimeHost.session.sessionManager = manager;
			s.host.chatContainer.clear();
			s.host.renderInitialMessages();
			assert.doesNotMatch(s.host.chatContainer.render(60).map(stripTerminalSequences).join("\n"), /prompt 0/);
			s.fx.frame(); s.fx.view.scrollToStart();
			assert.match(s.host.chatContainer.render(60).map(stripTerminalSequences).join("\n"), /prompt 2/);
		} finally { s.close(); }
	} finally { if (original) Object.defineProperty(proto, "render", original); else delete proto.render; }
});
