/**
 * The synthetic world: the real Pi 1.4.0 with every extension of package.json `pi.extensions`, in this process,
 * with the outside faked: model, terminal, network, processes, clock, credentials, home and project folders.
 * Tests drive it like a page in a browser: press keys, wait, look at the screen, read the session file.
 * See the design in my-pi-evidence/designs/synthetic-harness/DESIGN.md.
 *
 *   const w = await world(t, { model: "anthropic/claude-sonnet-5-5", thinking: "medium" });
 *   w.model.script(text("hello"));      // answers to model requests, one per request, in order
 *   w.model.when(isTask("x"), call("agent", { action: "status" }, "c1"), text("done")); // answers for matching requests
 *   const h = w.model.hold(isTask("x"));  h.reply(text("ok"));  // keeps a matching request open until answered
 *   steps: text, think, call(name, args, id?), fail(message), reply(...steps) for several parts in one answer
 *   w.requests;                         // every model request: model, context, options, background reason
 *   await w.submit("hi");               // type, Enter, settle
 *   w.see("hello");  w.notSee("oops");  // the current frame, escape codes removed
 *   w.press(keys.escape);  w.type("x"); // terminal input
 *   await w.settle();  await w.until(() => cond);  await w.tick(500); // explicit waits; time only moves by tick
 *   w.screen();  w.raw();  w.jsonl();    // frame lines, frame with colour codes, session file entries
 *   w.processes.reply(bashCommand("echo hi"), { stdout: "hi\n", code: 0 });   // fake spawn and spawnSync; all other calls are blocked
 *   const p = w.processes.hold(ripgrep);  p.finish({ stdout: "..." });          //   takes; the rest is blocked. calls: w.processes.calls
 *   const w2 = await w.restart();       // quit Pi, start a new one over the same folders and session file
 *   w.childFiles(1)                     // session files of subagent agent-1; read them with w.jsonl(file)
 *   w.events; w.errors; w.networkAttempts; w.processAttempts   // what happened outside the screen (attempts = blocked calls)
 *   w.session; w.host; w.settings; w.dirs                      // the real Pi objects and temp folders
 *
 * `world()` cleans up in t.after: prototypes, rqw globals, environment, mocks, temp folders, timers.
 * Built here, not shared: no state is kept between worlds, and every test builds its own.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	createEventBus,
	type ExtensionAPI,
	InteractiveMode,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { resetCapabilitiesCache, stripTerminalSequences, type Terminal } from "@earendil-works/pi-tui";
import { blockNetwork, fakeProcesses, guardProcess, patchedMembers, type ProcessCall, trapExit } from "./guard.ts";
import { createModel } from "./model.ts";

export { call, fail, isTask, reply, text, think } from "./model.ts";

/** A spawn of a shell whose command line contains `part` (a string) or matches it (a RegExp). */
export const bashCommand = (part: string | RegExp) => (call: ProcessCall): boolean => {
	const line = call.args.at(-1) ?? "";
	return typeof part === "string" ? line.includes(part) : part.test(line);
};

/** A spawn of ripgrep. */
export const ripgrep = (call: ProcessCall): boolean => /^rg(\.exe)?$/.test(basename(call.command));

/** Raw terminal input. */
export const keys = {
	enter: "\r",
	escape: "\x1b",
	tab: "\t",
	backspace: "\x7f",
	up: "\x1b[A",
	down: "\x1b[B",
	right: "\x1b[C",
	left: "\x1b[D",
	shiftUp: "\x1b[1;2A",
	shiftDown: "\x1b[1;2B",
	shiftRight: "\x1b[1;2C",
	shiftLeft: "\x1b[1;2D",
	ctrlC: "\x03",
	ctrlD: "\x04",
	ctrlE: "\x05",
	ctrlO: "\x0f",
	ctrlR: "\x12",
} as const;

const root = new URL("../../", import.meta.url);
const CHECK_LIMIT = 20000;
const START_TIME = Date.UTC(2026, 10, 2);
const FAR_FUTURE = 4_102_444_800_000;

export interface WorldOptions {
	/** `provider/id` of the starting model; default is Pi's own choice for the fake credentials. */
	model?: string;
	thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	/** Scenario settings, applied after the real first-start profile. */
	settings?: Record<string, unknown>;
}

type NamedFactory = { name: string; path?: string; factory: (pi: ExtensionAPI) => void };

/** The extensions of the manifest, imported once per process; the list is read, never hard-coded. */
let manifestExtensions: Promise<{ extensions: NamedFactory[]; theme: string }> | undefined;

function loadManifest() {
	manifestExtensions ??= (async () => {
		const started = process.hrtime.bigint();
		const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as { pi: { extensions: string[]; themes: string[] } };
		const extensions = await Promise.all(manifest.pi.extensions.map(async (entry) => {
			const module = await import(pathToFileURL(fileURLToPath(new URL(entry, root))).href);
			return { name: basename(dirname(entry)), path: fileURLToPath(new URL(entry, root)), factory: module.default as NamedFactory["factory"] };
		}));
		importsMs = elapsedMs(started);
		return { extensions, theme: fileURLToPath(new URL(manifest.pi.themes[0], root)) };
	})();
	return manifestExtensions;
}

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Fake subscription logins that never expire; the codex token carries the account claim Pi reads. */
async function fakeCredentials() {
	const store = new InMemoryCredentialStore();
	const codexToken = `${base64url({ alg: "none" })}.${base64url({ exp: 4_000_000_000, "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })}.sig`;
	await store.modify("anthropic", async () => ({ type: "oauth", access: "fake-access", refresh: "fake-refresh", expires: FAR_FUTURE }) as never);
	await store.modify("openai-codex", async () => ({ type: "oauth", access: codexToken, refresh: "fake-refresh", expires: FAR_FUTURE, accountId: "acct" }) as never);
	return store;
}

function fakeTerminal() {
	let input = (_data: string) => {};
	const output: string[] = [];
	const terminal = {
		columns: 120, rows: 30, kittyProtocolActive: false,
		start(onInput: (data: string) => void) { input = onInput; }, stop() {}, async drainInput() {},
		write(data: string) { output.push(data); },
		moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {},
		setTitle() {}, setProgress() {}, setProgramStatus() {},
	} as unknown as Terminal;
	return { terminal, output, send: (data: string) => input(data) };
}

export interface Dirs {
	/** Everything below is inside this temporary folder. */
	base: string;
	home: string;
	agent: string;
	codex: string;
	project: string;
	sessions: string;
}

function makeDirs(): Dirs {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "rqw-world-")));
	const dirs = { base, home: join(base, "home"), agent: join(base, "agent"), codex: join(base, "codex"), project: join(base, "project"), sessions: join(base, "sessions") };
	for (const dir of [dirs.home, dirs.agent, dirs.codex, dirs.project, dirs.sessions]) mkdirSync(dir, { recursive: true });
	return dirs;
}

/** Wall time of the builds and scenarios by test file, from the real clock; printed by reportTimings(). */
type Timing = { boot: number[]; total: number[] };
const timings = new Map<string, Timing>();
let importsMs: number | undefined;
const elapsedMs = (from: bigint) => Number(process.hrtime.bigint() - from) / 1e6;

function timingOf(t: TestContext): Timing {
	const file = t.filePath ?? "";
	if (!timings.has(file)) timings.set(file, { boot: [], total: [] });
	return timings.get(file)!;
}

/** Prints one line for the scenarios of a test file: `after(() => reportTimings(import.meta.filename))`. */
export function reportTimings(file: string): void {
	const timing = timings.get(file) ?? { boot: [], total: [] };
	const boot = [...timing.boot].sort((a, b) => a - b);
	const median = boot.length ? boot[Math.floor(boot.length / 2)] : 0;
	const total = timing.total.reduce((sum, value) => sum + value, 0);
	const imports = importsMs === undefined ? "" : `, imports ${importsMs.toFixed(1)} ms (once)`;
	console.log(`synthetic: ${boot.length} scenarios, boot median ${median.toFixed(1)} ms, total ${total.toFixed(1)} ms${imports}`);
	importsMs = undefined;
	timings.delete(file);
}

/** A new world over fresh temporary folders. */
export function world(t: TestContext, options: WorldOptions = {}) {
	return build(t, options, { dirs: makeDirs(), start: START_TIME, created: undefined, resume: undefined });
}

/** What a restart hands on: the folders, the clock, the session file and the scenario's start. */
interface Handover {
	dirs: Dirs;
	start: number;
	created: bigint | undefined;
	resume: string | undefined;
}

async function build(t: TestContext, options: WorldOptions, from: Handover) {
	const { extensions, theme } = await loadManifest();
	const created = from.created ?? process.hrtime.bigint();
	const dirs = from.dirs;
	const guard = guardProcess();

	// A restart passes the folders and the scenario's clock on: the old world neither removes them nor counts itself.
	const handover = { done: false };
	const giveBack = () => {
		guard.restore();
		resetCapabilitiesCache();
		t.mock.restoreAll();
		t.mock.timers.reset();
		syncBuiltinESMExports();
		if (!handover.done) rmSync(dirs.base, { recursive: true, force: true });
	};
	// Until dispose() is registered, a failing setup still gives everything back.
	let registered = false;
	t.after(() => { if (!registered) giveBack(); });

	const clock = { elapsed: 0 };
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: from.start });
	t.mock.method(performance, "now", () => clock.elapsed);
	process.env.HOME = dirs.home;
	process.env.USERPROFILE = dirs.home;
	process.env.CODEX_HOME = dirs.codex;
	process.env.PI_CODING_AGENT_DIR = dirs.agent;
	process.env.PI_OFFLINE = "1";
	process.env.PI_SKIP_VERSION_CHECK = "1";
	for (const name of ["TMUX", "HERDR_ENV"]) delete process.env[name];
	// Colours must not depend on the machine's terminal: a CI runner has no COLORTERM and Pi would draw 256 colours.
	process.env.COLORTERM = "truecolor";
	resetCapabilitiesCache();

	const networkAttempts: string[] = [];
	const processAttempts: string[] = [];
	const exitCodes: number[] = [];
	blockNetwork(t, networkAttempts);
	const processes = fakeProcesses(t, processAttempts);
	trapExit(t, exitCodes);
	syncBuiltinESMExports();

	const settingsPath = join(dirs.agent, "settings.json");
	let applyScenarioSettings = !existsSync(settingsPath);
	if (applyScenarioSettings) writeFileSync(settingsPath, JSON.stringify(options.settings ?? {}));

	const model = createModel();
	const modelRuntimeClass = ModelRuntime.prototype as unknown as { streamSimple: unknown };
	modelRuntimeClass.streamSimple = function (modelArg: never, context: never, requestOptions: never) {
		return model.streamSimple(modelArg, context, requestOptions);
	};

	const events: { channel: string; data: unknown }[] = [];
	const bus = createEventBus();
	const emit = bus.emit;
	bus.emit = (channel, data) => { events.push({ channel, data }); emit(channel, data); };

	// A turn has begun when agent_start came; it has settled at agent_settled.
	const turn = { begun: false, settled: false };
	const probe: NamedFactory = {
		name: "world-probe",
		factory: (pi) => {
			pi.on("agent_start", () => { turn.begun = true; turn.settled = false; });
			pi.on("agent_settled", () => { turn.settled = true; });
		},
	};

	const credentials = await fakeCredentials();
	const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
	const sessionManager = from.resume ? SessionManager.open(from.resume, dirs.sessions, dirs.project) : SessionManager.create(dirs.project, dirs.sessions);
	const createRuntime = async ({ cwd, agentDir, sessionManager: manager, sessionStartEvent }: { cwd: string; agentDir: string; sessionManager: SessionManager; sessionStartEvent?: unknown }) => {
		const settingsManager = SettingsManager.create(cwd, agentDir);
		const services = await createAgentSessionServices({
			cwd, agentDir, settingsManager, modelRuntime,
			resourceLoaderOptions: {
				eventBus: bus, noExtensions: true, noPromptTemplates: true, noContextFiles: true,
				additionalThemePaths: [theme],
				extensionFactories: [...extensions.map(({ name, factory }) => ({ name, factory })), probe] as never,
				extensionsOverride: (result: any) => {
					for (const extension of result.extensions) {
						const entry = extensions.find(({ name }) => extension.path === `<inline:${name}>`);
						if (entry?.path) extension.path = extension.resolvedPath = entry.path;
					}
					return result;
				},
			},
		});
		if (applyScenarioSettings && options.settings) {
			const settings = SettingsManager.inMemory(JSON.parse(readFileSync(settingsPath, "utf8")));
			settings.applyOverrides(SettingsManager.inMemory(options.settings).getGlobalSettings());
			writeFileSync(settingsPath, JSON.stringify(settings.getSettings()));
			await settingsManager.reload();
		}
		applyScenarioSettings = false;
		const picked = options.model ? modelRuntime.getModel(...(options.model.split("/", 2) as [string, string])) : undefined;
		const created = await createAgentSessionFromServices({
			services, sessionManager: manager, sessionStartEvent: sessionStartEvent as never,
			model: picked as never, thinkingLevel: options.thinking as never,
		});
		return { ...created, services, diagnostics: services.diagnostics };
	};
	const runtime = await createAgentSessionRuntime(createRuntime as never, { cwd: dirs.project, agentDir: dirs.agent, sessionManager });

	const screenOf = fakeTerminal();
	const host: any = new InteractiveMode(runtime, { terminal: screenOf.terminal, tuiMode: "fullscreen" });
	// Pi services that touch the process or only wait: signal handlers (process wide) and the terminal colour query (it waits for a reply no terminal gives).
	for (const name of ["registerSignalHandlers", "unregisterSignalHandlers"]) host[name] = () => {};
	host.themeController.waitForTerminalColors = async () => {};

	const errors = (): string[] => runtime.services.resourceLoader.getExtensions().errors.map(({ path, error }) => `${path}: ${error}`);

	const screen = (): string[] => {
		host.renderer.renderNow();
		return host.renderer.getScreenLines().map(stripTerminalSequences);
	};

	/** Waits for `done`, checked after one round of turns and time-0 timers; the round runs even when `done` is true at once. */
	async function until(done: () => boolean, label = "until"): Promise<void> {
		for (let attempt = 0; attempt < CHECK_LIMIT; attempt++) {
			await nextTurn();
			t.mock.timers.tick(0);
			if (done()) return;
		}
		assert.fail(`synthetic world: ${label} not reached after ${CHECK_LIMIT} checks\n${screen().join("\n")}`);
	}

	const settled = () => {
		const session = runtime.session;
		return !session.isStreaming && !session.isCompacting && model.idle() && (!turn.begun || turn.settled);
	};
	async function settle(): Promise<void> {
		await until(settled, "settle");
		turn.begun = false;
	}

	let disposed = false;
	async function dispose(): Promise<void> {
		if (disposed) return;
		disposed = true;
		if (!handover.done) timingOf(t).total.push(elapsedMs(created));
		model.release();
		processes.release();
		try {
			host.stop();
			await runtime.dispose();
			host.themeController.dispose?.();
		} finally {
			giveBack();
		}
	}
	t.after(dispose);
	registered = true;

	await host.init();
	void host.run().catch(() => {});
	await until(() => true, "start");
	if (!from.resume) timingOf(t).boot.push(elapsedMs(created));

	return {
		dirs, host, model: model.api, requests: model.requests, processes, networkAttempts, processAttempts, exitCodes, events,
		get runtime() { return runtime; },
		get session() { return runtime.session; },
		get settings() { return runtime.services.settingsManager; },
		get errors() { return errors(); },
		get output() { return screenOf.output; },
		get sessionFile() { return runtime.session.sessionManager.getSessionFile(); },
		get loadedExtensions() { return extensions.map(({ name }) => name); },
		bootMs: elapsedMs(created),

		press: (key: string) => screenOf.send(key),
		type: (value: string) => { for (const char of value) screenOf.send(char); },
		async submit(value: string) {
			for (const char of value) screenOf.send(char);
			screenOf.send(keys.enter);
			await settle();
		},
		settle, until,
		async tick(ms: number) {
			clock.elapsed += ms;
			t.mock.timers.tick(ms);
			await until(() => true, "tick");
		},

		screen,
		/** The frame with its colour codes, for checks on the theme. */
		raw: (): string[] => { host.renderer.renderNow(); return host.renderer.getScreenLines(); },
		see(value: string) { assert.ok(screen().join("\n").includes(value), `synthetic world: screen lacks "${value}"\n${screen().join("\n")}`); },
		notSee(value: string) { assert.ok(!screen().join("\n").includes(value), `synthetic world: screen shows "${value}"\n${screen().join("\n")}`); },
		/** The entries of a session file; the current session when no file is given. */
		jsonl(file = runtime.session.sessionManager.getSessionFile()!) {
			return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as any);
		},
		/** Session files of subagent `agent-<id>` of the current session. */
		childFiles(id: number): string[] {
			const directory = `${runtime.session.sessionManager.getSessionFile()}.children/agent-${id}`;
			return existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".jsonl")).sort().map((name) => join(directory, name)) : [];
		},
		/** Quits this Pi and starts a new one over the same folders and session file, like restarting Pi. */
		async restart() {
			const next = { dirs, start: Date.now(), created, resume: runtime.session.sessionManager.getSessionFile() };
			handover.done = true;
			await dispose();
			return build(t, options, next);
		},
		/** Names of the Pi members that differ from stock right now. */
		patched: () => patchedMembers(guard.snapshot),
		dispose,
	};
}

export type World = Awaited<ReturnType<typeof world>>;
