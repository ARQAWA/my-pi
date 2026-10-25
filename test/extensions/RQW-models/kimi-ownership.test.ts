import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { fauxProvider } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";

const EXTENSION = fileURLToPath(new URL("../../../extensions/RQW-models/index.ts", import.meta.url));
const originalArgv = process.argv;
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
let root: string;
let requests = 0;
let serial = 0;
before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-models-kimi-ownership-"));
	for (const key of Object.keys(process.env)) if (/(?:_API_KEY|_TOKEN|_SECRET)$/.test(key)) delete process.env[key];
	process.env.PI_OFFLINE = "1";
	process.env.PI_CODING_AGENT_DIR = root;
	globalThis.fetch = async () => { requests++; throw new Error("Network forbidden in Kimi ownership regression"); };
});
after(async () => {
	process.argv = originalArgv;
	globalThis.fetch = originalFetch;
	for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
	Object.assign(process.env, originalEnv);
	await rm(root, { recursive: true, force: true });
});

async function sharedRuntime() {
	const runtime = await ModelRuntime.create({ authPath: join(root, `auth-${serial++}.json`), modelsPath: null, refreshOnCreate: false });
	for (const [provider, ids] of [
		["anthropic", ["claude-opus-5-5"]],
		["openai-codex", ["gpt-6-sol", "gpt-5.3-codex-spark"]],
	] as const) {
		const faux = fauxProvider({ provider, models: ids.map((id) => ({ id, reasoning: true })) });
		faux.provider.auth.apiKey = { name: "Faux ownership test", resolve: async () => ({ auth: { apiKey: "faux-test-key" } }) };
		runtime.registerNativeProvider(faux.provider);
		await runtime.setRuntimeApiKey(provider, "faux-test-key");
	}
	await runtime.setRuntimeApiKey("kimi-coding", "faux-test-key");
	await runtime.getAvailable();
	return runtime;
}

async function owner(runtime: ModelRuntime, explicit = false) {
	process.argv = [...originalArgv.slice(0, 2), ...(explicit ? ["--model", "gpt-6-sol"] : [])];
	const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" });
	const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager: settings, additionalExtensionPaths: [EXTENSION], noSkills: true, noContextFiles: true, noThemes: true, noPromptTemplates: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	let enabled = true;
	const reload = loader.reload.bind(loader);
	loader.reload = async () => { if (enabled) await reload(); else loader.getExtensions().extensions.length = 0; };
	const { session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime, resourceLoader: loader, settingsManager: settings, sessionManager: SessionManager.inMemory(root), model: runtime.getModel("openai-codex", "gpt-6-sol"), thinkingLevel: "high", noTools: "all" });
	const errors: string[] = [];
	const notes: string[] = [];
	let choice: string | undefined;
	let offered: string[] = [];
	await session.bindExtensions({ uiContext: {
		notify: (text) => notes.push(text),
		select: async (_title, labels) => { offered = labels; return choice; },
	} as ExtensionUIContext, onError: (error) => errors.push(error.error) });
	assert.deepEqual(errors, []);
	return {
		session, errors, notes,
		get offered() { return offered; },
		disable: async () => { enabled = false; await session.reload(); },
		pick: async (id: string) => {
			choice = runtime.getModel("kimi-coding", id)!.name;
			await session.extensionRunner.getCommand("rqw-models")!.handler("", session.extensionRunner.createCommandContext());
		},
	};
}

async function ownershipScenario(exit: "reload" | "dispose", departing: number) {
	const runtime = await sharedRuntime();
	const builtin = runtime.getProvider("kimi-coding")!;
	const originalModels = builtin.getModels();
	assert.equal(runtime.getRegisteredProviderConfig("kimi-coding"), undefined);
	assert.equal(runtime.getModel("kimi-coding", "k3.1-pro"), undefined);
	const a = await owner(runtime);
	const b = await owner(runtime, true);
	const owners = [a, b];
	try {
		// Unchanged controls: Opus startup, explicit selection, and stock-list masks.
		assert.equal(a.session.model?.id, "claude-opus-5-5");
		assert.equal(a.session.thinkingLevel, "medium");
		assert.equal(b.session.model?.id, "gpt-6-sol");
		assert.equal(b.session.thinkingLevel, "high");
		assert.deepEqual(runtime.getAvailableSnapshot(), []);
		await runtime.getAvailable();
		a.session.setThinkingLevel("low");
		await a.pick("k3.1-pro");
		assert.equal(b.session.model?.id, "gpt-6-sol");
		assert.equal(b.session.thinkingLevel, "high");
		await b.pick("k3.1-pro-highspeed");
		assert.equal(a.session.model?.id, "k3.1-pro");
		assert.equal(a.session.thinkingLevel, "low");
		assert.equal(b.session.model?.id, "k3.1-pro-highspeed");
		assert.equal(b.session.thinkingLevel, "high");
		assert.deepEqual(b.offered, ["Kimi K2.7 Code Highspeed", "Kimi K2.8 Preview", "Kimi K3.1 Pro Highspeed", "Kimi K3.1 Pro", "anthropic/claude-opus-5-5", "openai-codex/gpt-6-sol"]);
		const gone = owners[departing];
		const survivor = owners[1 - departing];
		const goneModel = gone.session.model;
		const goneEffort = gone.session.thinkingLevel;
		const survivorModel = survivor.session.model;
		const survivorEffort = survivor.session.thinkingLevel;
		const survivorEntries = survivor.session.sessionManager.getBranch().length;
		if (exit === "reload") await gone.disable();
		else gone.session.dispose();
		assert.ok(runtime.getModel("kimi-coding", "k3.1-pro"));
		assert.ok(runtime.getModel("kimi-coding", "k3.1-pro-highspeed"));
		assert.ok(runtime.getRegisteredProviderConfig("kimi-coding"));
		assert.deepEqual(runtime.getAvailableSnapshot(), []);
		assert.deepEqual(survivor.session.scopedModels, []);
		assert.ok(survivor.session.extensionRunner.getCommand("rqw-models"));
		assert.equal(survivor.session.model, survivorModel);
		assert.equal(survivor.session.thinkingLevel, survivorEffort);
		assert.equal(survivor.session.sessionManager.getBranch().length, survivorEntries);
		await assert.rejects(survivor.session.setModel(runtime.getModel("openai-codex", "gpt-5.3-codex-spark")!), /not in the RQW models list/);
		await runtime.getAvailable();
		await survivor.pick(departing === 0 ? "k3.1-pro" : "k3.1-pro-highspeed");
		assert.equal(survivor.session.model?.id, departing === 0 ? "k3.1-pro" : "k3.1-pro-highspeed");
		assert.equal(survivor.session.thinkingLevel, survivorEffort);
		assert.equal(gone.session.model, goneModel);
		assert.equal(gone.session.thinkingLevel, goneEffort);
		if (exit === "reload") {
			assert.equal(gone.session.extensionRunner.getCommand("rqw-models"), undefined);
			assert.equal(gone.session.extensionRunner.getShortcuts({}).size, 0);
			await gone.session.setModel(runtime.getModel("openai-codex", "gpt-5.3-codex-spark")!);
			assert.equal(survivor.session.model?.provider, "kimi-coding");
			await survivor.disable();
		} else survivor.session.dispose();
		assert.equal(runtime.getModel("kimi-coding", "k3.1-pro"), undefined);
		assert.equal(runtime.getModel("kimi-coding", "k3.1-pro-highspeed"), undefined);
		assert.equal(runtime.getRegisteredProviderConfig("kimi-coding"), undefined);
		assert.deepEqual(runtime.getProvider("kimi-coding")!.getModels(), originalModels);
		assert.deepEqual(runtime.getProvider("kimi-coding")!.auth.oauth, builtin.auth.oauth);
		assert.equal(Object.getOwnPropertySymbols(runtime).some((key) => key.description?.startsWith("rqw-models")), false);
		assert.ok(runtime.getAvailableSnapshot().length > 0);
		assert.deepEqual(a.errors, []);
		assert.deepEqual(b.errors, []);
		assert.equal(requests, 0);
	} finally {
		for (const current of owners) current.session.dispose();
	}
}

describe("shared Kimi ownership with the real Pi SDK", () => {
	it("keeps either survivor's catalog and selection when the other session reloads off; the last reload restores stock", async () => {
		for (const departing of [0, 1]) await ownershipScenario("reload", departing);
	});
	it("keeps either survivor on SDK dispose without shutdown; the last dispose releases the Kimi registration", async () => {
		for (const departing of [0, 1]) await ownershipScenario("dispose", departing);
	});
});
