// Pi's real InteractiveMode on a scripted terminal: Ctrl+D and a double Ctrl+C both run Pi's shutdown, which emits
// session_shutdown with reason "quit" and so releases the coordinator lock; a single Ctrl+C does not. `process.exit`
// is stubbed so the test process survives. No network, isolated agent folder.
import "./no-network.mjs";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, it } from "node:test";
import { fauxProvider } from "@earendil-works/pi-ai";
import { getKeybindings } from "@earendil-works/pi-tui";
import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	initTheme,
	InteractiveMode,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const SKIP = process.platform === "darwin" ? false : "the coordinator lock is macOS only; elsewhere the guard has no lock";

const ROOT = join(import.meta.dirname, "..");
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "coordinator-lock-keys-")));
const savedEnv = { ...process.env };
const realExit = process.exit;
before(() => {
	process.env.PI_CODING_AGENT_DIR = join(TMP, "agent");
	process.env.PI_OFFLINE = "1";
	mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
	initTheme("dark", false);
});
after(() => {
	process.env = savedEnv;
	rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
afterEach(() => {
	process.exit = realExit;
});

class ScriptedTerminal {
	onInput: ((data: string) => void) | undefined;
	start(onInput: (data: string) => void) { this.onInput = onInput; }
	stop() {}
	async drainInput() {}
	write() {}
	get columns() { return 100; }
	get rows() { return 40; }
	get kittyProtocolActive() { return false; }
	moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {}
	setTitle() {} setProgress() {} setProgramStatus() {}
	key(data: string) { this.onInput!(data); }
}

const copy = (from: string, to: string) => {
	mkdirSync(join(to, ".."), { recursive: true });
	writeFileSync(to, readFileSync(from));
};
const GUARD = join(ROOT, ".pi", "extensions", "coordinator-guard");

let n = 0;
async function open() {
	const cwd = join(TMP, `repo${n++}`);
	mkdirSync(join(cwd, ".git"), { recursive: true });
	for (const file of readdirSync(GUARD)) copy(join(GUARD, file), join(cwd, ".pi", "extensions", "coordinator-guard", file));
	copy(join(ROOT, "scripts", "owner-quotes.mjs"), join(cwd, "scripts", "owner-quotes.mjs"));
	copy(join(ROOT, "PROCESS.md"), join(cwd, "PROCESS.md"));
	const agentDir = process.env.PI_CODING_AGENT_DIR!;
	const name = `faux-keys-${n}`;
	const faux = fauxProvider({ api: name, provider: name, models: [{ id: "m" }] });
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	faux.provider.auth.apiKey = { name: "Fake key", resolve: async () => ({ auth: { apiKey: "fake" } }) };
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey(name, "fake");
	const runtime = await createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd, agentDir, modelRuntime,
			settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, quietStartup: true }),
			resourceLoaderOptions: {
				additionalExtensionPaths: [join(cwd, ".pi", "extensions", "coordinator-guard", "index.ts")],
				noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			},
		});
		const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel("m"), thinkingLevel: "off" });
		return { ...created, services, diagnostics: services.diagnostics };
	}, { cwd, agentDir, sessionManager: SessionManager.inMemory(cwd) });
	const terminal = new ScriptedTerminal();
	const mode = new InteractiveMode(runtime, { terminal: terminal as never });
	await mode.init();
	assert.deepEqual(runtime.session.resourceLoader.getExtensions().errors, []);
	const exits: unknown[] = [];
	process.exit = ((code?: number) => void exits.push(code)) as never;
	return { cwd, lock: join(cwd, ".git", "coordinator.lock"), terminal, mode, runtime, exits };
}

const until = async (what: string, check: () => boolean, ms = 10_000) => {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
};

it("the keys are Pi's defaults: Ctrl+D is app.exit, Ctrl+C is app.clear", { skip: SKIP }, async () => {
	const h = await open();
	try {
		assert.ok(getKeybindings().matches("\x04", "app.exit"));
		assert.ok(getKeybindings().matches("\x03", "app.clear"));
	} finally {
		h.mode.stop();
		await h.runtime.dispose();
	}
});

it("Ctrl+D on an empty editor shuts Pi down with reason quit and releases the lock", { skip: SKIP }, async () => {
	const h = await open();
	assert.equal(JSON.parse(readFileSync(h.lock, "utf8")).pid, process.pid, "the chat took the lock at start");
	h.terminal.key("\x04");
	await until("Pi's shutdown to finish", () => h.exits.length > 0);
	assert.deepEqual(h.exits, [0]);
	assert.equal(existsSync(h.lock), false, "the quit released the lock");
});

it("a double Ctrl+C shuts Pi down the same way; a single Ctrl+C does not", { skip: SKIP }, async () => {
	const single = await open();
	single.terminal.key("\x03");
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.deepEqual(single.exits, [], "one Ctrl+C only clears the editor");
	assert.equal(existsSync(single.lock), true, "and keeps the lock");
	single.mode.stop();
	await single.runtime.dispose();

	const double = await open();
	assert.equal(existsSync(double.lock), true);
	double.terminal.key("\x03");
	double.terminal.key("\x03");
	await until("Pi's shutdown to finish", () => double.exits.length > 0);
	assert.deepEqual(double.exits, [0]);
	assert.equal(existsSync(double.lock), false, "the quit released the lock");
});
