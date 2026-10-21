import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { fauxAssistantMessage, fauxProvider, getSupportedThinkingLevels, type Model, type FauxProviderHandle } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext, type SessionStartEvent } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { matchesKey, setKittyProtocolActive, type KeyId } from "@earendil-works/pi-tui";
import extension, { FAMILIES, familyOf, levelsFor, pickerModels } from "../index.ts";

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const ORIGINAL_ARGV = process.argv;
const model = (id: string, provider = "anthropic", map: Record<string, string | null> = { xhigh: "xhigh", max: "max" }): Model<string> => ({
	id, provider, api: "test", name: id, baseUrl: "https://invalid.test", reasoning: true, input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8000, thinkingLevelMap: map,
});
const SIX = FAMILIES.map((id) => model(id, id.startsWith("gpt") ? "openai-codex" : "anthropic"));

type Shortcut = Parameters<ExtensionAPI["registerShortcut"]>[1];
type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
type StartHandler = (event: SessionStartEvent, ctx: ExtensionContext) => void | Promise<void>;

function harness(models = SIX, initial = SIX[0], initialLevel: ThinkingLevel = "medium", flags: string[] = []) {
	const shortcuts = new Map<KeyId, Shortcut>();
	const commands = new Map<string, Command>();
	const events = new Map<string, StartHandler>();
	const selected: string[] = [];
	const warnings: string[] = [];
	let current = initial;
	let thinking = initialLevel;
	let branch: { type: string }[] = [];
	let choice: string | undefined;
	let offered: string[] = [];
	let hasUI = true;
	let allowSet = true;
	const context = {
		get model() { return current; }, get hasUI() { return hasUI; },
		modelRegistry: { getAvailable: () => models }, sessionManager: { getBranch: () => branch },
		ui: { notify: (text: string) => warnings.push(text), select: async (_title: string, labels: string[]) => { offered = labels; return choice; } },
	};
	// Test double implements only the context and API surface used by this extension.
	const ctx = context as unknown as ExtensionCommandContext;
	const pi = {
		registerShortcut: (key: KeyId, options: Shortcut) => shortcuts.set(key, options),
		registerCommand: (key: string, options: Command) => commands.set(key, options),
		on: (name: string, fn: StartHandler) => events.set(name, fn),
		getThinkingLevel: () => thinking,
		setThinkingLevel: (level: ThinkingLevel) => { thinking = level; },
		setModel: async (next: Model<string>) => {
			await Promise.resolve();
			if (!allowSet) return false;
			current = next; thinking = "low"; selected.push(`${next.provider}/${next.id}`); return true;
		},
	};
	process.argv = [...ORIGINAL_ARGV.slice(0, 2), ...flags];
	extension(pi as unknown as ExtensionAPI);
	// Pi supplies a lazy event context before it enables snapshot-based TUI shortcuts.
	void events.get("session_start")!({ type: "session_start", reason: "reload" }, ctx);
	return {
		shortcuts, commands, selected, warnings,
		get current() { return current; }, get thinking() { return thinking; }, get offered() { return offered; },
		set branch(value: { type: string }[]) { branch = value; }, set choice(value: string | undefined) { choice = value; },
		set hasUI(value: boolean) { hasUI = value; }, set allowSet(value: boolean) { allowSet = value; },
		press: (key: KeyId) => shortcuts.get(key)!.handler({ ...context } as unknown as ExtensionContext),
		start: (reason: SessionStartEvent["reason"] = "startup") => events.get("session_start")!({ type: "session_start", reason }, ctx),
		pick: () => commands.get("rqw-models")!.handler("", ctx),
	};
}

after(() => { process.argv = ORIGINAL_ARGV; setKittyProtocolActive(false); });

describe("RQW model families and Pi thinking capabilities", () => {
	it("offers exactly six generations in omp order, no GPT 5.6 or old Claude", () => {
		const extra = [model("gpt-5.6-luna"), model("claude-opus-4-8"), model("claude-opus-5"), model("claude-sonnet-5-50"), model("gpt-6-astra")];
		assert.deepEqual(pickerModels([...extra, ...SIX.toReversed()]), SIX);
	});
	it("recognizes provider paths, dotted versions, dated aliases and Bedrock without inventing models", () => {
		for (const id of ["anthropic/claude-opus-5.5", "claude-opus-5-5-20261001", "us.anthropic.claude-opus-5-5-v1:0"]) assert.equal(familyOf(model(id, "proxy")), 0, id);
		assert.equal(familyOf(model("openai/gpt-6.1-sol", "proxy")), 2);
		assert.equal(familyOf(model("gpt-6.1-sol-fast")), -1);
		const alias = model("anthropic/claude-opus-5.5", "proxy");
		assert.deepEqual(pickerModels([alias, SIX[0]]), [SIX[0]]);
		assert.deepEqual(pickerModels([alias]), [alias]);
	});
	it("uses Pi support, omits off/minimal, never manufactures xhigh or max", () => {
		assert.deepEqual(levelsFor(model("test", "proxy", {})), ["low", "medium", "high"]);
		assert.deepEqual(levelsFor(model("test", "proxy", { low: null, xhigh: null, max: "max" })), ["medium", "high", "max"]);
		assert.deepEqual(levelsFor({ ...SIX[0], reasoning: false }), []);
		assert.deepEqual(levelsFor(undefined), []);
	});
});

describe("shortcuts and picker", () => {
	it("steps in both directions, clamps at ends like omp, enters from outside", async () => {
		const h = harness();
		await h.press("alt+-"); assert.equal(h.selected.length, 0);
		for (const expected of SIX.slice(1)) { await h.press("alt+="); assert.equal(h.current, expected); }
		await h.press("alt+="); assert.equal(h.selected.length, 5);
		await h.press("alt+-"); assert.equal(h.current, SIX[4]);
		const outside = model("other");
		const forward = harness(SIX, outside); await forward.press("alt+="); assert.equal(forward.current, SIX[0]);
		const backward = harness(SIX, outside); await backward.press("alt+-"); assert.equal(backward.current, SIX.at(-1));
	});
	it("recognizes the current family even when resume used another provider variant", async () => {
		const proxySonnet = model("anthropic/claude-sonnet-5.5", "proxy");
		const h = harness(SIX, proxySonnet);
		await h.press("alt+="); assert.equal(h.current, SIX[2]);
	});
	it("serializes quick model presses and preserves the pre-switch thinking level", async () => {
		const h = harness(SIX, SIX[0], "high");
		await Promise.all([h.press("alt+="), h.press("alt+="), h.press("alt+=")]);
		assert.equal(h.current, SIX[3]); assert.equal(h.thinking, "high");
		assert.deepEqual(h.selected, SIX.slice(1, 4).map((m) => `${m.provider}/${m.id}`));
	});
	it("queued reasoning reads the new model capabilities, not the keypress snapshot", async () => {
		const limitedOpus = model("claude-opus-5-5", "anthropic", {});
		const h = harness([limitedOpus, SIX[1]], limitedOpus, "high");
		await Promise.all([h.press("alt+="), h.press("alt+shift+=")]);
		assert.equal(h.current, SIX[1]); assert.equal(h.thinking, "xhigh");
	});
	it("switching lowers unsupported effort to nearest lower level, or lowest, not Pi's upward clamp", async () => {
		const limited = model("claude-sonnet-5-5", "anthropic", {});
		const h = harness([SIX[0], limited], SIX[0], "max");
		await h.press("alt+="); assert.equal(h.thinking, "high");
		const off = harness(SIX, SIX[0], "off"); await off.press("alt+="); assert.equal(off.thinking, "low");
	});
	it("cycles only supported reasoning, clamps both ends and handles off/minimal", async () => {
		const h = harness(SIX, SIX[0], "off");
		for (const expected of ["low", "medium", "high", "xhigh", "max", "max"]) { await h.press("alt+shift+="); assert.equal(h.thinking, expected); }
		for (const expected of ["xhigh", "high", "medium", "low", "low"]) { await h.press("alt+shift+-"); assert.equal(h.thinking, expected); }
		const minimal = harness(SIX, SIX[0], "minimal"); await minimal.press("alt+_"); assert.equal(minimal.thinking, "low");
		const noThinking = harness(SIX, { ...SIX[0], reasoning: false }, "off"); await noThinking.press("alt++"); assert.equal(noThinking.thinking, "off");
	});
	it("no models, auth lost and cancelled/headless pickers are harmless", async () => {
		const empty = harness([]); await empty.press("alt+="); await empty.pick(); assert.equal(empty.selected.length, 0); assert.equal(empty.warnings.length, 1);
		const lost = harness(); lost.allowSet = false; await lost.press("alt+="); assert.equal(lost.current, SIX[0]); assert.equal(lost.thinking, "medium"); assert.equal(lost.warnings.length, 1);
		const h = harness(); await h.pick(); assert.equal(h.offered.length, 6); assert.equal(h.selected.length, 0);
		h.choice = "openai-codex/gpt-6-sol"; await h.pick(); assert.equal(h.current, SIX[3]);
		h.hasUI = false; await h.pick(); assert.equal(h.selected.length, 1);
	});
});

describe("real terminal byte sequences through Pi's key matcher", () => {
	it("legacy ESC prefix, Kitty physical/shifted symbols, CSI-u and xterm modifyOtherKeys dispatch once", async () => {
		const rows: [boolean, string, KeyId][] = [
			[false, "\x1b=", "alt+="], [false, "\x1b-", "alt+-"],
			[false, "\x1b+", "alt++"], [false, "\x1b_", "alt+_"],
			[true, "\x1b[61;3u", "alt+="], [true, "\x1b[45;3u", "alt+-"],
			[true, "\x1b[61:43;4u", "alt+shift+="], [true, "\x1b[45:95;4u", "alt+shift+-"],
			[true, "\x1b[43;4u", "alt+shift++"], [true, "\x1b[95;4u", "alt+shift+_"],
			[false, "\x1b[27;3;61~", "alt+="], [false, "\x1b[27;3;45~", "alt+-"],
			[false, "\x1b[27;4;43~", "alt++"], [false, "\x1b[27;4;95~", "alt+_"],
		];
		for (const [kitty, bytes, key] of rows) {
			setKittyProtocolActive(kitty);
			const h = harness();
			// InteractiveMode takes the first matching registered shortcut, then returns true.
			const actual = [...h.shortcuts.keys()].find((candidate) => matchesKey(bytes, candidate));
			assert.equal(actual, key, JSON.stringify(bytes));
			await h.press(actual!);
			assert.equal(h.selected.length, key === "alt+=" ? 1 : 0);
			if (key !== "alt+=" && key !== "alt+-") assert.equal(h.thinking, key.includes("_") || key.endsWith("+-") ? "low" : "high");
		}
		setKittyProtocolActive(false);
		for (const bytes of ["=", "-", "+", "_", "\x1b[A", "\x1b[B"]) assert.equal([...harness().shortcuts.keys()].some((key) => matchesKey(bytes, key)), false);
	});
});

describe("initial selection and explicit choices", () => {
	it("new main session starts Opus medium, including /new", async () => {
		for (const reason of ["startup", "new"] as const) { const h = harness(SIX, SIX[3], "high"); await h.start(reason); assert.equal(h.current, SIX[0]); assert.equal(h.thinking, "medium"); }
	});
	it("respects --model, --thinking, model suffix and explicit off/minimal", async () => {
		for (const [flags, expectedModel, level] of [
			[["--model", "gpt-6-sol"], SIX[3], "high"],
			[["--model", "gpt-6-sol:high"], SIX[3], "high"],
			[["--models", "gpt-6-sol:high,gpt-6-luna:low"], SIX[3], "high"],
			[["--model", "gpt-6-sol", "--thinking", "off"], SIX[3], "off"],
			[["--thinking", "minimal"], SIX[0], "minimal"],
			[["--thinking", "low", "--thinking", "high"], SIX[0], "high"],
		] as const) {
			for (const reason of ["startup", "new"] as const) {
				const h = harness(SIX, SIX[3], level, [...flags]); await h.start(reason); assert.equal(h.current, expectedModel); assert.equal(h.thinking, level);
			}
		}
	});
	it("applies explicit thinking to Opus even when Pi clamped the initial non-reasoning model to off", async () => {
		const h = harness(SIX, { ...SIX[3], reasoning: false }, "off", ["--thinking", "high"]);
		await h.start(); assert.equal(h.current, SIX[0]); assert.equal(h.thinking, "high");
	});
	it("does not reset resume, fork, reload, CLI continuation or a startup with history", async () => {
		for (const reason of ["resume", "fork", "reload"] as const) { const h = harness(SIX, SIX[4], "max"); await h.start(reason); assert.equal(h.current, SIX[4]); assert.equal(h.thinking, "max"); }
		for (const flags of [["-c"], ["--continue"], ["--resume"], ["-r"], ["--session", "file"]]) { const h = harness(SIX, SIX[4], "max", flags); await h.start(); assert.equal(h.selected.length, 0); assert.equal(h.thinking, "max"); }
		const h = harness(SIX, SIX[3], "high"); h.branch = [{ type: "message" }]; await h.start(); assert.equal(h.selected.length, 0); assert.equal(h.thinking, "high");
	});
	it("no Opus leaves Pi's model, while authenticated proxy Opus is usable", async () => {
		const noOpus = harness(SIX.slice(1), SIX[2], "high"); await noOpus.start(); assert.equal(noOpus.current, SIX[2]); assert.equal(noOpus.thinking, "medium");
		const proxy = model("anthropic/claude-opus-5.5", "proxy"); const h = harness([proxy], SIX[3]); await h.start(); assert.equal(h.current, proxy);
	});
});

let root: string;
let runtime: ModelRuntime;
let anthropic: FauxProviderHandle;
let codex: FauxProviderHandle;
const catalogue = new Map<string, Model<string>>();
before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-models-"));
	runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
	for (const m of SIX) catalogue.set(m.id, runtime.getModel(m.provider, m.id)!);
	anthropic = fauxProvider({ provider: "anthropic", models: SIX.filter((m) => m.provider === "anthropic") });
	codex = fauxProvider({ provider: "openai-codex", models: SIX.filter((m) => m.provider === "openai-codex") });
	for (const faux of [anthropic, codex]) {
		for (const m of faux.models) m.thinkingLevelMap = catalogue.get(m.id)!.thinkingLevelMap;
		faux.provider.auth.apiKey = { name: "Faux test", resolve: async () => ({ auth: { apiKey: "faux-test-key" } }) };
		runtime.registerNativeProvider(faux.provider);
		await runtime.setRuntimeApiKey(faux.provider.id, "faux-test-key");
	}
	await runtime.getAvailable();
	assert.ok(runtime.hasConfiguredAuth("anthropic"));
	assert.ok(runtime.hasConfiguredAuth("openai-codex"));
});
after(async () => { await rm(root, { recursive: true, force: true }); });

async function realSession(options: { enabled?: boolean; manager?: SessionManager; reason?: SessionStartEvent["reason"]; model?: Model<string>; flags?: string[]; thinking?: ThinkingLevel } = {}) {
	process.argv = [...ORIGINAL_ARGV.slice(0, 2), ...(options.flags ?? [])];
	const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" });
	const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager: settings, additionalExtensionPaths: options.enabled === false ? [] : [EXTENSION], noSkills: true, noContextFiles: true, noThemes: true, noPromptTemplates: true });
	await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime, resourceLoader: loader, settingsManager: settings, sessionManager: options.manager ?? SessionManager.inMemory(root), model: options.manager ? undefined : options.model ?? codex.getModel("gpt-6-sol"), thinkingLevel: options.manager ? undefined : options.thinking ?? "high", sessionStartEvent: { type: "session_start", reason: options.reason ?? "startup" }, noTools: "all" });
	const errors: string[] = [];
	await session.bindExtensions({ onError: (error) => errors.push(error.error) }); assert.deepEqual(errors, []);
	return session;
}
async function press(session: AgentSession, key: KeyId) {
	const runner = session.extensionRunner;
	const shortcuts = runner.getShortcuts({});
	assert.ok(shortcuts.has(key));
	await shortcuts.get(key)!.handler({ ...runner.createContext() });
}

describe("real Pi SDK and faux providers only", () => {
	it("loads standalone, defaults to Opus medium, uses Pi's actual maps and calls only faux", async () => {
		const session = await realSession();
		try {
			assert.equal(session.model?.id, "claude-opus-5-5"); assert.equal(session.thinkingLevel, "medium");
			for (const m of SIX) assert.deepEqual(levelsFor(catalogue.get(m.id)), getSupportedThinkingLevels(catalogue.get(m.id)!).filter((level) => level !== "off" && level !== "minimal"));
			anthropic.setResponses([fauxAssistantMessage("faux only")]); await session.prompt("hello"); assert.equal(session.getLastAssistantText(), "faux only");
			await press(session, "alt+="); assert.equal(session.model?.id, "claude-sonnet-5-5"); assert.equal(session.thinkingLevel, "medium");
			await press(session, "alt+shift+="); assert.equal(session.thinkingLevel, "high");
			const saved = session.settingsManager.getSettings(); assert.equal(saved.defaultModel, undefined); assert.equal(saved.defaultThinkingLevel, undefined);
		} finally { session.dispose(); }
	});
	it("rapid snapshot-context presses advance Opus to Sonnet to GPT6.1 to GPT6", async () => {
		const session = await realSession();
		try {
			await Promise.all([press(session, "alt+="), press(session, "alt+="), press(session, "alt+=")]);
			const changes = session.sessionManager.getBranch().filter((entry) => entry.type === "model_change");
			assert.deepEqual(changes.slice(-3).map((entry) => entry.modelId), FAMILIES.slice(1, 4));
			assert.equal(session.model?.id, "gpt-6-sol"); assert.equal(session.thinkingLevel, "medium");
		} finally { session.dispose(); }
	});
	it("disabled extension adds no shortcut or default override", async () => {
		const session = await realSession({ enabled: false });
		try { assert.equal(session.model?.id, "gpt-6-sol"); assert.equal(session.thinkingLevel, "high"); assert.equal(session.extensionRunner.getShortcuts({}).size, 0); }
		finally { session.dispose(); }
	});
	it("explicit CLI model/thinking remains Pi's native clamped selection", async () => {
		const session = await realSession({ flags: ["--model", "gpt-6-sol", "--thinking", "off"], thinking: "off" });
		try { assert.equal(session.model?.id, "gpt-6-sol"); assert.equal(session.thinkingLevel, "off"); }
		finally { session.dispose(); }
	});
	it("reload and resumed history retain selected model and reasoning", async () => {
		const manager = SessionManager.inMemory(root);
		const session = await realSession({ manager, reason: "new" });
		try {
			await press(session, "alt+="); await press(session, "alt+="); await press(session, "alt+shift+=");
			codex.setResponses([fauxAssistantMessage("saved")]); await session.prompt("save history");
			await session.reload(); assert.equal(session.model?.id, "gpt-6.1-sol"); assert.equal(session.thinkingLevel, "high");
		} finally { session.dispose(); }
		const resumed = await realSession({ manager });
		try { assert.equal(resumed.model?.id, "gpt-6.1-sol"); assert.equal(resumed.thinkingLevel, "high"); }
		finally { resumed.dispose(); }
	});
});

const exec = promisify(execFile);
const CLI = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")).replace(/dist[\\/]index\.js$/, "dist/cli.js");
const FAUX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "faux.ts");
let cliCounter = 0;
async function cli(flags: string[], noAnthropic = false, settings?: Record<string, unknown>) {
	const dir = join(root, `cli-${cliCounter++}`);
	await mkdir(dir);
	// Seed auth before native-provider registration starts its asynchronous snapshot refreshes.
	await writeFile(join(dir, "models.json"), JSON.stringify({ providers: { "openai-codex": { apiKey: "faux-only" } } }));
	if (settings) await writeFile(join(dir, "settings.json"), JSON.stringify(settings));
	const child = exec(process.execPath, [CLI, "--extension", FAUX, "--extension", EXTENSION,
		"--no-tools", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-mcp", "--no-session", "--print", ...flags, "faux probe"], {
		cwd: dir, timeout: 20000,
		env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
			TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP, HOME: dir, USERPROFILE: dir,
			PI_CODING_AGENT_DIR: dir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", RQW_TEST_NO_ANTHROPIC: noAnthropic ? "1" : "" },
	});
	child.child.stdin?.end();
	const { stdout, stderr } = await child;
	assert.doesNotMatch(stderr, /Failed to load|Extension error/);
	return JSON.parse(stdout.trim());
}
describe("real Pi CLI, no network and faux transport", () => {
	it("starts Opus medium through the actual CLI", async () => {
		assert.deepEqual(await cli([]), { provider: "anthropic", model: "claude-opus-5-5", thinking: "medium" });
	});
	it("respects real --model/--thinking and model thinking suffix", async () => {
		assert.deepEqual(await cli(["--model", "openai-codex/gpt-6-sol", "--thinking", "off"]), { provider: "openai-codex", model: "gpt-6-sol", thinking: "off" });
		assert.deepEqual(await cli(["--model", "openai-codex/gpt-6-luna:high"]), { provider: "openai-codex", model: "gpt-6-luna", thinking: "high" });
	});
	it("preserves Pi-resolved --models efforts and mixed scoped suffixes", async () => {
		assert.deepEqual(await cli(["--models", "openai-codex/gpt-6-sol:high"]), { provider: "openai-codex", model: "gpt-6-sol", thinking: "high" });
		const mixed = ["--models", "openai-codex/gpt-6-luna:low,openai-codex/gpt-6-sol:high"];
		assert.deepEqual(await cli(mixed), { provider: "openai-codex", model: "gpt-6-luna", thinking: "low" });
		assert.deepEqual(await cli(mixed, false, { defaultProvider: "openai-codex", defaultModel: "gpt-6-sol" }), { provider: "openai-codex", model: "gpt-6-sol", thinking: "high" });
		assert.deepEqual(await cli([...mixed, "--thinking", "off"]), { provider: "openai-codex", model: "gpt-6-luna", thinking: "off" });
	});
	it("keeps Pi settings effort for an explicit model without a suffix", async () => {
		assert.deepEqual(await cli(["--model", "openai-codex/gpt-6-sol"], false, { defaultThinkingLevel: "low" }), { provider: "openai-codex", model: "gpt-6-sol", thinking: "low" });
	});
	it("does not select Opus without auth and preserves explicit model outside the picker", async () => {
		assert.deepEqual(await cli(["--model", "openai-codex/gpt-5.6-luna", "--thinking", "minimal"], true), { provider: "openai-codex", model: "gpt-5.6-luna", thinking: "minimal" });
		const result = await cli([], true);
		assert.deepEqual(result, { provider: "openai-codex", model: "gpt-6.1-sol", thinking: "medium" });
		// A saved default is not an explicit CLI choice: keep it without Opus, but apply medium.
		assert.deepEqual(await cli([], true, { defaultProvider: "openai-codex", defaultModel: "gpt-5.6-luna", defaultThinkingLevel: "high" }),
			{ provider: "openai-codex", model: "gpt-5.6-luna", thinking: "medium" });
	});
});
