// Real Pi InteractiveMode, widget containers and native WorkingStatusIndicator. The faux response is held by
// a promise so every layout assertion runs in one turn, without timer races or polling.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
	createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices,
	type ExtensionAPI, initTheme, InteractiveMode, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";

const STATUSBAR = resolve(dirname(fileURLToPath(import.meta.url)), "../index.ts");
const ACTIVITY_KEY = "rqw-statusbar-activity";
const TITLE_KEY = "rqw-statusbar-title";
const strip = (row: string) => stripVTControlCharacters(row.replace(/\x1b_[^\x07]*\x07/g, ""));

class Terminal {
	start() {} stop() {} async drainInput() {} write(_data: string) {}
	get columns() { return 100; }
	get rows() { return 40; }
	get kittyProtocolActive() { return false; }
	moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {}
	setTitle() {} setProgress() {} setProgramStatus() {}
}

interface Component { render(width: number): string[] }
interface ModeInternals {
	ui: Component;
	statusContainer: Component;
	widgetContainerAbove: Component;
	extensionWidgetsAbove: Map<string, Component>;
	editor: Component & { embedWorkingStatus: boolean };
	activeStatusIndicator?: Component & { kind: string; frames: string[]; intervalMs: number };
}

it("Pi hides its native Working row, keeping only activity with exact gaps and the title border", async () => {
	const root = mkdtempSync(join(tmpdir(), "rqw-native-working-"));
	const savedEnv = { ...process.env };
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.PI_OFFLINE = "1";
	mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
	initTheme("dark", false);
	let release!: () => void;
	let entered!: () => void;
	const responseGate = new Promise<void>((done) => { release = done; });
	const responseStarted = new Promise<void>((done) => { entered = done; });
	const faux = fauxProvider({ api: "faux-statusbar-layout", provider: "faux-statusbar-layout", models: [{ id: "m" }] });
	faux.setResponses([async () => { entered(); await responseGate; return fauxAssistantMessage("done"); }]);
	faux.provider.auth.apiKey = { name: "Fake key", resolve: async () => ({ auth: { apiKey: "fake" } }) };
	const modelRuntime = await ModelRuntime.create({ authPath: join(root, "agent/auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey("faux-statusbar-layout", "fake");
	const manager = SessionManager.inMemory(root);
	manager.appendSessionInfo("Layout fixture");
	const listeners = new Set<(counts: { agents: number }) => void>();
	let agents = 0;
	const push = (value: number) => {
		agents = value;
		for (const listener of listeners) listener({ agents });
	};
	const producer = (pi: ExtensionAPI) => {
		pi.events.on("rqw:running-counts:request", (request) => {
			(request as { reply(source: unknown): void }).reply({
				version: 1,
				snapshot: () => ({ agents }),
				subscribe(listener: (counts: { agents: number }) => void) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
			});
		});
	};
	const runtime = await createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd, agentDir: join(root, "agent"), modelRuntime,
			settingsManager: SettingsManager.inMemory({
				quietStartup: true, retry: { enabled: false }, compaction: { enabled: false }, cacheWarming: "off", tuiMode: "regular",
			}),
			resourceLoaderOptions: {
				additionalExtensionPaths: [STATUSBAR], extensionFactories: [{ name: "counts-fixture", factory: producer }],
				noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			},
		});
		const session = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel("m"), thinkingLevel: "off" });
		return { ...session, services, diagnostics: services.diagnostics };
	}, { cwd: root, agentDir: join(root, "agent"), sessionManager: manager });
	const mode = new InteractiveMode(runtime, { terminal: new Terminal() as never });
	const actual = mode as unknown as ModeInternals;
	let prompt: Promise<void> | undefined;
	try {
		await mode.init();
		assert.deepEqual(runtime.session.resourceLoader.getExtensions().errors, []);
		assert.equal(actual.editor.embedWorkingStatus, true);
		assert.deepEqual(actual.widgetContainerAbove.render(100), [""], "Pi alone supplies its normal idle spacer");
		assert.equal(actual.extensionWidgetsAbove.has(TITLE_KEY), false);
		assert.deepEqual([...actual.extensionWidgetsAbove.keys()], [ACTIVITY_KEY]);
		const initialBorder = actual.editor.render(100)[0];
		assert.match(strip(initialBorder), /^── Layout fixture /);

		prompt = runtime.session.prompt("hold the response");
		await responseStarted;
		const indicator = actual.activeStatusIndicator!;
		assert.equal(indicator.kind, "working");
		assert.deepEqual(indicator.frames, [], "our editor suppresses Pi's native spinner as before 081d914");
		assert.deepEqual(actual.statusContainer.render(100), [], "no separate native row or spacer");
		assert.deepEqual(actual.widgetContainerAbove.render(100).map(strip), ["", " Planning next moves", ""]);
		const screen = actual.ui.render(100).map(strip);
		assert.equal(screen.some((row) => /Working/.test(row)), false, "no native Working row in the mounted Pi tree");
		const activityRow = screen.findIndex((row) => /Planning next moves/.test(row));
		assert.ok(activityRow >= 0);
		assert.deepEqual(screen.slice(activityRow - 1, activityRow + 3), ["", " Planning next moves", "", strip(initialBorder)],
			"one blank above and below activity, one left space and the title in the border");
		const renderDir = process.platform === "win32" ? tmpdir() : "/tmp";
		writeFileSync(join(renderDir, "statusbar-working.txt"), `${screen.slice(activityRow - 1).join("\n")}\n`);

		assert.equal(listeners.size, 1, "the extension adopted the real event-bus counts source");
		push(2);
		assert.equal(actual.activeStatusIndicator, indicator, "activity never replaces the native indicator");
		assert.deepEqual(actual.statusContainer.render(100), [], "activity updates do not bring back the native row");
		assert.deepEqual(actual.widgetContainerAbove.render(100).map(strip), ["", " Planning next moves · 2 agents", ""]);
		push(0);
		// Drive only extension chrome; no model call or real compaction is needed for this representative render.
		await runtime.session.extensionRunner!.emit({
			type: "session_before_compact", reason: "manual", willRetry: false,
			preparation: {} as never, branchEntries: [], signal: new AbortController().signal,
		});
		const compactionScreen = actual.ui.render(100).map(strip);
		assert.equal(compactionScreen.some((row) => /Working/.test(row)), false);
		const compactingRow = compactionScreen.findIndex((row) => /Compacting context/.test(row));
		assert.ok(compactingRow >= 0);
		assert.deepEqual(compactionScreen.slice(compactingRow - 1, compactingRow + 3),
			["", " Compacting context", "", strip(initialBorder)]);
		writeFileSync(join(renderDir, "statusbar-compaction.txt"), `${compactionScreen.slice(compactingRow - 1).join("\n")}\n`);
		await runtime.session.extensionRunner!.emit({
			type: "session_compact", reason: "manual", willRetry: false, fromExtension: false, compactionEntry: {} as never,
		});
		assert.deepEqual(actual.widgetContainerAbove.render(100).map(strip), ["", " Planning next moves", ""]);
		release();
		await prompt;
		assert.deepEqual(actual.extensionWidgetsAbove.get(ACTIVITY_KEY)!.render(100), []);
		assert.deepEqual(actual.widgetContainerAbove.render(100), [""], "idle removes both activity rows, keeping only Pi's original spacer");
		const idleScreen = actual.ui.render(100).map(strip);
		assert.equal(idleScreen.some((row) => /Working|Planning next moves/.test(row)), false);
		assert.equal(idleScreen.filter((row) => row.includes("Layout fixture")).length, 1);
		assert.equal(actual.editor.render(100)[0], initialBorder, "ordinary activity leaves the title border unchanged");
		assert.equal(actual.extensionWidgetsAbove.has(TITLE_KEY), false);
	} finally {
		release();
		if (prompt) await prompt;
		mode.stop();
		await runtime.dispose();
		process.env = savedEnv;
		rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});
