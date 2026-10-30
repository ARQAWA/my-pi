import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { InteractiveMode, SettingsManager } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { assistant, call, load, makeHost, makeScreen, result, Session, text, user } from "./fold-host.ts";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

// The normal rebind and history methods are real Pi. The session's bind is the controlled external boundary.
function configure(host: any, loaded: ReturnType<typeof load>, gate: ReturnType<typeof deferred>) {
	const session = host.runtimeHost.session;
	session.resourceLoader.getThemes = () => ({ themes: [] });
	session.bindExtensions = async () => {
		await gate.promise;
		loaded.start(session.sessionManager);
	};
	host.programStatus = { reset() {} };
	host.applyRuntimeSettings = () => {};
	host.subscribeToAgent = () => {};
	host.setupAutocompleteProvider = () => {};
	host.setupExtensionShortcuts = () => {};
	host.showLoadedResources = () => {};
	host.showStartupNoticesIfNeeded = () => {};
	host.updateAvailableProviderCount = async () => {};
	host.updateTerminalTitle = () => {};
	host.pendingMessagesContainer = { clear() {} };
}

it("draws folded history before session_start and keeps it while the runtime changes", async () => {
	const old = new Session();
	const first = load();
	const screen = makeScreen(100, 60);
	const host: any = makeHost(old.manager, first, screen.screen);
	screen.screen.addChild(host.chatContainer);
	screen.screen.start();
	const gate = deferred();
	try {
		const kept = old.add(user("prompt 1", 0), 0);
		old.add(assistant([text("update 1"), call("c1", "f1.ts")], "toolUse", 1), 1);
		old.add(result("c1", "body 1\n".repeat(30), 2), 2);
		old.add(assistant([text("answer 1")], "stop", 3), 42_000);
		old.compact(kept, 43_000);
		old.add(user("unfinished owner", 44_000), 44_000);
		old.add(assistant([text("unfinished work"), call("tail", "tail.ts")], "toolUse", 45_000), 45_000);
		old.add(result("tail", "long unfinished result", 46_000), 46_000);
		configure(host, first, gate);
		const binding = host.rebindCurrentSession({ renderBeforeBind: true });
		const rows = () => screen.frame().join("\n");
		const before = rows();
		assert.match(before, /worked for 42s ›/);
		assert.match(before, /unfinished work/);
		assert.match(before, /Read 1 file/);
		assert.match(before, /read tail\.ts/);
		assert.doesNotMatch(before, /body 1/);
		const foreign = load();
		assert.equal(rows(), before);
		foreign.shutdown();
		gate.resolve();
		await binding;
		assert.equal(rows(), before);
		first.shutdown();
		assert.match(rows(), /Read 1 file/);
		assert.match(rows(), /read tail\.ts/);
		assert.equal(rows(), before);

		const second = load();
		old.manager.newSession();
		old.turn(2, 100_000, 7);
		const nextHost: any = makeHost(old.manager, second, screen.screen);
		host.runtimeHost.session = nextHost.runtimeHost.session;
		const nextGate = deferred();
		configure(host, second, nextGate);
		const next = host.rebindCurrentSession({ renderBeforeBind: true });
		const fresh = rows();
		assert.match(fresh, /worked for 7s ›/);
		assert.match(fresh, /answer 2/);
		assert.doesNotMatch(fresh, /unfinished owner|answer 1|body 1/);
		nextGate.resolve();
		await next;
		assert.equal(rows(), fresh);
		second.shutdown();
	} finally {
		first.shutdown();
		old.end();
		screen.stop();
	}
});

it("retains events arriving during real init before the first history", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "rqw-tool-start-"));
	const previousDir = process.env.PI_CODING_AGENT_DIR;
	const previousOffline = process.env.PI_OFFLINE;
	process.env.PI_CODING_AGENT_DIR = dir;
	process.env.PI_OFFLINE = "1";
	t.mock.method(childProcess, "spawnSync", () => ({ status: 0, stdout: "tool 1.0", error: undefined }));
	syncBuiltinESMExports();
	const saved = new Session();
	const loaded = load();
	const screen = makeScreen();
	const entered = deferred();
	const gate = deferred();
	const settings = SettingsManager.inMemory({ quietStartup: true, theme: "dark", tui: { mode: "fullscreen" } } as never);
	const fixture: any = makeHost(saved.manager, loaded, screen.screen);
	const session = fixture.runtimeHost.session;
	Object.assign(session, { settingsManager: settings, scopedModels: [], modelRuntime: { getAvailableSnapshot: () => [] }, getContextUsage: () => undefined, state: {} });
	session.resourceLoader.getThemes = () => ({ themes: [] });
	const runtime = { session, setBeforeSessionInvalidate() {}, setRebindSession() {} };
	const host: any = new InteractiveMode(runtime as never, { terminal: screen.terminal as never, tuiMode: "fullscreen" });
	try {
		saved.turn(1, 0, 42);
		saved.add(user("early prompt", 50_000), 50_000);
		saved.add(assistant([call("early", "early.ts")], "toolUse", 51_000), 51_000);
		const pending = host.pendingMessagesContainer;
		configure(host, loaded, gate);
		host.pendingMessagesContainer = pending;
		host.programStatus = { reset() {}, report() {} };
		host.registerSignalHandlers = () => {};
		host.ensurePngTranscoder = () => {};
		host.setupKeyHandlers = () => {};
		host.setupEditorSubmitHandler = () => {};
		host.getChangelogForDisplay = () => undefined;
		host.renderProjectTrustWarningIfNeeded = () => {};
		host.themeController.waitForTerminalColors = async () => {};
		session.bindExtensions = async () => {
			loaded.handlers.get("tool_execution_start")!({ toolCallId: "early", toolName: "read", args: { path: "early.ts" } });
			loaded.handlers.get("tool_execution_update")!({ toolCallId: "early", partialResult: { content: [text("early event output")] } });
			entered.resolve();
			await gate.promise;
			loaded.start(saved.manager);
		};
		const init = host.init();
		await entered.promise;
		host.renderInitialMessages();
		const rows = () => host.chatContainer.render(100).map(stripTerminalSequences).join("\n");
		assert.match(rows(), /worked for 42s ›/);
		assert.doesNotMatch(rows(), /update 1/);
		assert.doesNotMatch(rows(), /body 1/);
		assert.match(rows(), /early event output/);
		gate.resolve();
		await init;
		assert.match(rows(), /early event output/);
	} finally {
		gate.resolve();
		loaded.shutdown();
		try { host.stop("none"); } catch {}
		host.themeController.dispose();
		saved.end();
		screen.stop();
		t.mock.restoreAll();
		syncBuiltinESMExports();
		if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir;
		if (previousOffline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previousOffline;
		rmSync(dir, { recursive: true, force: true });
	}
});

for (const mode of ["disabled", "incompatible", "reload"] as const) it(`handles ${mode} at a new history build`, () => {
	const s = new Session();
	const first = load();
	const screen = makeScreen();
	const host: any = makeHost(s.manager, first, screen.screen);
	try {
		s.turn(1, 0, 42);
		host.renderInitialMessages();
		assert.match(host.chatContainer.render(80).map(stripTerminalSequences).join("\n"), /worked for 42s ›/);
		first.shutdown();
		const next = mode === "disabled" ? undefined : load();
		const replacement: any = makeHost(s.manager, next, screen.screen);
		if (mode === "incompatible") replacement.runtimeHost.session.resourceLoader.getExtensions = () => ({ extensions: [] });
		if (mode === "reload") {
			const session = host.runtimeHost.session;
			const runtime = {};
			session.resourceLoader.getExtensions = () => ({ runtime, extensions: [{ toolRenderers: [next!.resolver()] }] });
			session.extensionRunner = replacement.runtimeHost.session.extensionRunner;
		} else host.runtimeHost.session = replacement.runtimeHost.session;
		host.chatContainer.clear();
		host.renderInitialMessages();
		const rows = host.chatContainer.render(80).map(stripTerminalSequences).join("\n");
		if (mode === "reload") assert.match(rows, /worked for 42s ›/);
		else { assert.doesNotMatch(rows, /worked for/); assert.match(rows, /update 1/); assert.match(rows, /read f1\.ts/); }
		next?.shutdown();
	} finally { first.shutdown(); s.end(); screen.stop(); }
});
