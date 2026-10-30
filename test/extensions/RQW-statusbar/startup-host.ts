// Real Pi init, theme controller, editor, footer, UI-context copy and fullscreen renderer.
// The session/provider, process tools, filesystem and terminal are controlled external boundaries.
import { mkdtempSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { EventEmitter } from "node:events";
import { ExtensionRunner, InteractiveMode, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type Terminal } from "@earendil-works/pi-tui";
import statusbar from "../../../extensions/RQW-statusbar/index.ts";

export function deferred<T = void>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

export function startupHost(t: TestContext, options: { loaded?: boolean; slowGit?: boolean; earlyNotice?: boolean } = {}) {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
	t.mock.method(performance, "now", () => 0);
	const dir = mkdtempSync(join(tmpdir(), "rqw-startup-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	t.after(() => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	});
	t.mock.method(childProcess, "spawnSync", () => ({ status: 0, stdout: "tool 1.0", error: undefined }));
	const gitLookup = deferred();
	let gitPending = false;
	const files: { stat(path: string): Promise<any> } = { async stat() {
		if (options.slowGit) { gitPending = true; await gitLookup.promise; gitPending = false; }
		throw Object.assign(new Error("missing"), { code: "ENOENT" });
	} };
	t.mock.method(fs, "stat", (path: string) => files.stat(path));
	t.after(() => gitLookup.resolve());
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	const handlers = new Map<string, Function[]>();
	const commands = new Map<string, any>();
	const bus = new EventEmitter();
	const pi = {
		events: { on(name: string, fn: (...args: any[]) => void) { bus.on(name, fn); return () => { bus.off(name, fn); }; }, emit: bus.emit.bind(bus) },
		getSettings: () => ({}), getSessionName: () => manager.getSessionName(), getThinkingLevel: () => "medium",
		registerCommand(name: string, command: unknown) { commands.set(name, command); },
		on(name: string, handler: Function) { const list = handlers.get(name) ?? []; list.push((...args: unknown[]) => handler(...args)); handlers.set(name, list); },
	};
	if (options.loaded !== false) statusbar(pi as never);
	const settings = SettingsManager.inMemory({ quietStartup: true, theme: "dark", tui: { mode: "fullscreen" } } as never);
	const manager = SessionManager.inMemory(dir);
	const model = { id: "test-model", name: "Test model", provider: "fixture", reasoning: true, contextWindow: 100000 };
	const session: any = {
		settingsManager: settings, sessionManager: manager, scopedModels: [], model, thinkingLevel: "medium", state: { model, thinkingLevel: "medium" },
		autoCompactionEnabled: true, isStreaming: false, isCompacting: false,
		modelRuntime: { getAvailableSnapshot: () => [], isUsingSubscription: () => false },
		resourceLoader: { getThemes: () => ({ themes: [] }), getExtensions: () => ({ extensions: [{ handlers, commands }] }) },
		getContextUsage: () => undefined,
	};
	const runtime = { session, setBeforeSessionInvalidate() {}, setRebindSession() {} };
	const chunks: string[] = [];
	let input = (_text: string) => {};
	const terminal = {
		columns: 120, rows: 30, kittyProtocolActive: false,
		start(onInput: (text: string) => void) { input = onInput; }, stop() {}, async drainInput() {},
		write(text: string) { chunks.push(text); },
		moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {},
		setTitle() {}, setProgress() {}, setProgramStatus() {},
	} as unknown as Terminal;
	const host: any = new InteractiveMode(runtime as never, { terminal, tuiMode: "fullscreen" });
	// These unrelated Pi services are outside the startup chrome being tested.
	for (const name of ["registerSignalHandlers", "ensurePngTranscoder", "setupKeyHandlers", "setupEditorSubmitHandler", "setupAutocompleteProvider", "setupExtensionShortcuts", "showLoadedResources", "showStartupNoticesIfNeeded"])
		t.mock.method(host, name, () => {});
	t.mock.method(host, "getChangelogForDisplay", () => undefined);
	const entered = deferred();
	const proceed = deferred();
	const startCalled = deferred();
	const runner: any = new ExtensionRunner([{ handlers, commands, path: "fixture" }] as never, {} as never, dir, manager, {} as never);
	runner.getModel = () => model;
	runner.getScopedModels = () => [];
	runner.isIdleFn = () => true;
	runner.getContextUsageFn = () => undefined;
	let ctx: any;
	session.extensionRunner = runner;
	session.subscribe = () => () => {};
	const startHandlers = handlers.get("session_start") ?? [];
	startHandlers.unshift(async (_event: unknown, context: any) => {
		if (options.earlyNotice) context.ui.notify("STARTUP NOTICE", "warning");
		entered.resolve();
		await proceed.promise;
	});
	handlers.set("session_start", startHandlers);
	session.bindExtensions = async ({ uiContext }: any) => {
		runner.setUIContext(uiContext, "tui");
		ctx = runner.createContext();
		await runner.emit({ type: "session_start", reason: "start" });
		startCalled.resolve();
	};
	t.after(async () => {
		for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx ?? { mode: "print" });
		host.isInitialized = false;
		host.stop();
		host.themeController.dispose();
		host.customFooter?.dispose?.();
		host.footerDataProvider.dispose();
		host.renderer.stop();
	});
	return {
		host, chunks, handlers, commands, session, runner, entered, proceed, startCalled, gitLookup, files, dir,
		renew(manager: any, beforeBind?: Promise<void>) {
			handlers.clear(); commands.clear(); statusbar(pi as never);
			runner.sessionManager = manager;
			return { ...session, sessionManager: manager, async bindExtensions(options: any) {
				if (beforeBind) await beforeBind;
				await session.bindExtensions(options);
			} };
		},
		get gitPending() { return gitPending; },
		async reload() {
			for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx);
			handlers.clear(); commands.clear();
			statusbar(pi as never);
			await host.rebindCurrentSession();
		},
		get ctx() { return ctx; },
		input(text: string) { input(text); },
		frames() { return chunks.filter(text => text.includes("\x1b[?2026h")).map(stripTerminalSequences); },
		async pending() {
			const init = host.init();
			// Exercise the synchronous render path as well as Pi's queued paint.
			host.renderer.renderNow();
			t.mock.timers.tick(100);
			await entered.promise;
			host.renderer.renderNow();
			return { init };
		},
	};
}
