// Child process of isolation.test.ts: one Pi session with one extension switched off via package settings.
// argv[2]: JSON { root, off?, reloadOff?, probeNetwork? }. Prints one JSON line.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { networkAttempts } from "./no-network.mjs";

// Test loading boundary: static Pi imports could initialize providers before the network guard.
const { fauxAssistantMessage, fauxProvider, fauxToolCall } = await import("@earendil-works/pi-ai");
const {
	createAgentSession,
	createCodemodeExtension,
	createToolSearchExtension,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} = await import("@earendil-works/pi-coding-agent");

const { root: PKG, off, reloadOff, probeNetwork } = JSON.parse(process.argv[2]) as {
	root: string; off?: string; reloadOff?: string; probeNetwork?: boolean;
};
if (probeNetwork) {
	// The reserved domain must never reach DNS or a transport, even if the caller catches the error.
	try { await fetch("https://isolation.invalid/"); } catch {}
	process.exit(0);
}
// An SDK model alone is not explicit CLI intent. Startup otherwise selects authenticated Opus;
// a previous Bun check actually attempted OpenRouter and received a 404.
process.argv.push("--model", "openai-codex/gpt-6.1-sol");
const entry = (name?: string) => (name ? { source: PKG, extensions: [`-extensions/${name}/index.ts`] } : PKG);
const folder = (p = "") => /[\\/]extensions[\\/]([^\\/]+)[\\/]/.exec(p)?.[1] ?? p;

const originalCwd = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), "rqw-isolation-"));
const agentDir = join(tmp, "agent");
const cwd = join(tmp, "work");
mkdirSync(agentDir, { recursive: true });
mkdirSync(cwd, { recursive: true });
writeFileSync(join(cwd, "f.txt"), "hello\n");
const settingsFile = join(agentDir, "settings.json");
writeFileSync(settingsFile, JSON.stringify({ packages: [entry(off)] }));
process.chdir(cwd);
process.env.PI_CODING_AGENT_DIR = agentDir;
// Profile discovery must not read or override package fixtures with the owner's ~/.codex/agents.
process.env.CODEX_HOME = join(tmp, "codex");
for (const key of Object.keys(process.env)) if (/(?:_API_KEY|_TOKEN|_SECRET)$/.test(key)) delete process.env[key];
// Keep the unrelated-provider poison, but no authenticated naming model: this tool-isolation fixture
// scripts only the main Sol model, not Haiku/Luna. The network guard remains active for every call.
process.env.OPENROUTER_API_KEY = "isolation-not-a-real-key";

// A 1M model, so the session window shows whether RQW-context acts. A listed RQW-models ID, since
// RQW-models refuses requests for any other model.
const faux = fauxProvider({ api: "faux-iso", provider: "openai-codex", models: [{ id: "gpt-6.1-sol", contextWindow: 1_000_000, maxTokens: 1000 }] });
faux.setResponses([
	fauxAssistantMessage([fauxToolCall("read", { path: "f.txt" }, { id: "c0" })], { stopReason: "toolUse" }),
	fauxAssistantMessage("done"),
]);
const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
faux.provider.auth.apiKey = { name: "Fake isolation key", resolve: async () => ({ auth: { apiKey: "fake-isolation-key" } }) };
modelRuntime.registerNativeProvider(faux.provider);
await modelRuntime.setRuntimeApiKey("openai-codex", "fake-isolation-key");
// Inspect the unfiltered catalog before RQW-anthropic hides OpenRouter.
await modelRuntime.refresh({ allowNetwork: false });
const availableOpus = (await modelRuntime.getAvailable()).filter((model) => /claude-opus-5[.-]5/.test(model.id))
	.map((model) => `${model.provider}/${model.id}`);

// The faux provider is API "faux-iso", outside the owned Codex wire profile (openai-codex-responses). The real Codex
// owner (RQW-codex, when loaded) replaces the openai-codex provider with its own transport at bind time. This inline
// fixture re-installs only the faux registration after that bind, at session_start, and removes only its own faux
// registration at session_shutdown, so a reload lets the owner rebind first. Its own focused tests cover the Codex wire.
const FAUX_PROVIDER = "openai-codex";
const FAUX_API = "faux-iso";
const fauxConfig = {
	api: FAUX_API,
	apiKey: "fake-isolation-key",
	streamSimple: faux.provider.streamSimple,
	models: faux.models.map((model) => ({
		id: model.id,
		name: model.name,
		api: FAUX_API,
		baseUrl: model.baseUrl,
		reasoning: model.reasoning,
		input: model.input,
		cost: model.cost,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
	})),
} as unknown as Parameters<ExtensionAPI["registerProvider"]>[1];
const fauxFixture = (pi: ExtensionAPI) => {
	pi.on("session_start", () => {
		pi.registerProvider(FAUX_PROVIDER, fauxConfig);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.modelRegistry.getRegisteredProviderConfig(FAUX_PROVIDER)?.api === FAUX_API) pi.unregisterProvider(FAUX_PROVIDER);
	});
};

const errors: string[] = [];
const resourceLoader = new DefaultResourceLoader({
	cwd,
	agentDir,
	// The CLI loads these two as built-ins; the SDK takes them as factories.
	extensionFactories: [
		{ name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true as const },
		{ name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true as const },
		{ name: "faux-iso", factory: fauxFixture },
	],
	noSkills: true,
	noPromptTemplates: true,
	noThemes: true,
	noContextFiles: true,
});
await resourceLoader.reload();
const { session } = await createAgentSession({
	cwd,
	agentDir,
	model: faux.getModel("gpt-6.1-sol"),
	thinkingLevel: "off",
	modelRuntime,
	resourceLoader,
	sessionManager: SessionManager.inMemory(cwd),
	settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
});
let out: unknown;
try {
	await session.bindExtensions({ mode: "rpc", onError: (e) => errors.push(`${e.event}: ${e.error}`) });
	if (reloadOff) {
		writeFileSync(settingsFile, JSON.stringify({ packages: [entry(reloadOff)] }));
		await session.reload();
	}
	errors.push(...resourceLoader.getExtensions().errors.map((e) => `load ${folder(e.path)}: ${e.error}`));

	const turn: string[] = [];
	session.subscribe((ev) => {
		if (ev.type === "tool_execution_end") turn.push(`${ev.toolName}:${ev.isError ? "error" : "ok"}`);
	});
	await session.prompt("go");
	const last = session.messages.at(-1) as { role?: string; stopReason?: string } | undefined;

	out = {
		loaded: resourceLoader.getExtensions().extensions.map((e) => folder(e.path)).filter((n) => n.startsWith("RQW-")),
		errors,
		// Every registered tool with the extension folder that registered it and its description.
		tools: session.getAllTools().map((t) => ({
			name: t.name,
			by: t.sourceInfo.source === "builtin" ? "builtin" : folder(t.sourceInfo.path),
			description: t.description,
		})),
		turn,
		selectedModel: `${session.model?.provider}/${session.model?.id}`,
		availableOpus,
		networkAttempts,
		finished: last?.role === "assistant" && last.stopReason === "stop",
		// What a fresh SettingsManager and the session model say for a 1M model: Pi's own values unless RQW-context is on.
		reserveFor1M: SettingsManager.inMemory().getCompactionSettings({ provider: "x", id: "y", contextWindow: 1_000_000 } as never).reserveTokens,
		sessionWindow: session.model?.contextWindow,
	};
} finally {
	try {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	} finally {
		session.dispose();
		process.chdir(originalCwd);
		rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
}
console.log(JSON.stringify(out));
process.exit(0);
