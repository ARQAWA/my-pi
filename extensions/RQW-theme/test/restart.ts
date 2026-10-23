// Shared setup for selection.test.ts and the restart child. Run directly with `--child`, this file starts one fresh
// interactive session on the isolated agent dir from the environment, prints what the inline reporter saw and exits on
// its own. It never imports the node:test definitions, so the child cannot rerun them.
import { copyFileSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	type ExtensionAPI,
	type ExtensionContext,
	initTheme,
	InteractiveMode,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSET = join(HERE, "..", "theme.json");
export const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

/** A temporary agent dir and package that declares the asset through pi.themes, as the repository will. */
export function makeFixture(root: string, seedTheme: string) {
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	const pkg = join(root, "pkg");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	mkdirSync(pkg, { recursive: true });
	copyFileSync(ASSET, join(pkg, "theme.json"));
	writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "rqw-theme-fixture", version: "0.0.0", pi: { themes: ["./theme.json"] } }));
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [pkg], theme: seedTheme, quietStartup: true, lastChangelogVersion: "1.4.0" }, null, 2));
	return { agentDir, cwd, pkg };
}

/** Points Pi at the isolated dir. Pi reads settings and keybindings from here, never from the owner's ~/.pi. */
export function isolateEnv(agentDir: string) {
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_OFFLINE = "1";
}

/** Local tripwire: any fetch in the test process is recorded and refused. Pi's classes are not touched. */
export const netCalls: string[] = [];
export function installNetworkTripwire() {
	globalThis.fetch = (async (input: unknown) => {
		netCalls.push(String(input));
		throw new Error("network disabled in theme tests");
	}) as typeof fetch;
}

export class ScriptedTerminal {
	onInput: ((data: string) => void) | undefined;
	output = "";
	start(onInput: (data: string) => void) { this.onInput = onInput; }
	stop() {}
	async drainInput() {}
	write(data: string) { this.output += data; }
	get columns() { return 100; }
	get rows() { return 40; }
	get kittyProtocolActive() { return false; }
	moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {}
	setTitle() {} setProgress() {} setProgramStatus() {}
	type(text: string) { for (const ch of text) this.onInput!(ch); }
	key(data: string) { this.onInput!(data); }
	plain() { return this.output.replace(ANSI, ""); }
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

export async function until(what: string, check: () => boolean, ms = 10_000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

export type Session = {
	mode: InteractiveMode; terminal: ScriptedTerminal; runtime: AgentSessionRuntime; session: AgentSession;
	themeSeen: string[]; themeNow: () => string; allThemes: () => string[]; stop(): Promise<void>;
};

/** Pi's interactive mode on the isolated agent dir. The only inline extension just reports `ctx.ui.theme.name`. */
export const SIGNAL_EVENTS = ["SIGINT", "SIGTERM", "uncaughtException"] as const;
const listenerCounts = () => SIGNAL_EVENTS.map((event) => process.listeners(event as never).length);

export async function startSession(agentDir: string, cwd: string): Promise<Session> {
	const baseline = listenerCounts();
	const faux = fauxProvider({ api: "faux-rqw-theme", provider: "faux-rqw-theme", models: [{ id: "m" }] });
	faux.setResponses([() => fauxAssistantMessage("unused")]);
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	faux.provider.auth.apiKey = { name: "Fake key", resolve: async () => ({ auth: { apiKey: "fake" } }) };
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey("faux-rqw-theme", "fake");
	const themeSeen: string[] = [];
	let ctxRef: ExtensionContext | undefined;
	const reporter = (pi: ExtensionAPI) => {
		pi.on("session_start", (_event, ctx) => { ctxRef = ctx; themeSeen.push(ctx.ui.theme.name ?? "?"); });
	};
	const runtime = await createAgentSessionRuntime(async ({ cwd: c, sessionManager, sessionStartEvent }) => {
		const services = await createAgentSessionServices({
			cwd: c, agentDir, modelRuntime,
			settingsManager: SettingsManager.create(c, agentDir),
			resourceLoaderOptions: {
				extensionFactories: [{ name: "theme-reporter", factory: reporter }],
				noExtensions: false, noSkills: true, noPromptTemplates: true, noContextFiles: true,
			},
		});
		const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel("m"), thinkingLevel: "off" });
		return { ...created, services, diagnostics: services.diagnostics };
	}, { cwd, agentDir, sessionManager: SessionManager.inMemory(cwd) });
	const terminal = new ScriptedTerminal();
	const mode = new InteractiveMode(runtime, { terminal: terminal as never });
	await mode.init();
	return {
		mode, terminal, runtime, session: runtime.session, themeSeen,
		themeNow: () => ctxRef!.ui.theme.name ?? "?",
		allThemes: () => ctxRef!.ui.getAllThemes().map((t) => t.name),
		async stop() {
			try {
				mode.stop();
			} finally {
				await runtime.dispose();
			}
			const after = listenerCounts();
			if (after.some((count, i) => count !== baseline[i])) {
				throw new Error(`signal listeners changed: ${SIGNAL_EVENTS.map((e, i) => `${e} ${baseline[i]}->${after[i]}`).join(", ")}`);
			}
		},
	};
}

// Child entry: a fresh process, same isolated dir, no test definitions.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === "--child") {
	const agentDir = process.env.RQW_THEME_AGENT_DIR!;
	const cwd = process.env.RQW_THEME_CWD!;
	isolateEnv(agentDir);
	installNetworkTripwire();
	initTheme("dark", false); // the child's global theme starts as dark; only the saved setting can move it
	const s = await startSession(agentDir, cwd);
	await until("startup theme in child", () => s.themeSeen.length > 0 && s.themeNow() === "RQW-theme");
	const result = { seen: s.themeSeen, now: s.themeNow(), saved: JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).theme, net: netCalls.length };
	await s.stop();
	process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
}
