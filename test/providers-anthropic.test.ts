// RQW-providers and RQW-anthropic together in one process. Both patch AgentSession's `_bindExtensionCore` and `dispose`,
// and RQW-anthropic's lifecycle restores Pi's own methods when its last owner leaves; the hiding must survive that for
// later sessions. Real Pi library, fake credentials, no network. Each extension's own tests load only that extension.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, AgentSession, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

// Pi hides its credential store behind package exports; resolve the installed internal entrypoint.
const { AuthStorage } = await import(new URL("./core/auth-storage.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ANTHROPIC = join(ROOT, "extensions/RQW-anthropic/index.ts");
const PROVIDERS = join(ROOT, "extensions/RQW-providers/index.ts");
const KEPT = ["anthropic", "kimi-coding", "openai-codex"];
const credential = { type: "oauth" as const, access: "sk-ant-oat01-fake-pair", refresh: "fake-refresh", expires: Date.now() + 3600_000 };
const other = { type: "api_key" as const, key: "fake-other" };
const SLOTS = ["dispose", "_bindExtensionCore", "scopedModels"];
const native = SLOTS.map(name => Object.getOwnPropertyDescriptor(AgentSession.prototype, name));
const slots = () => SLOTS.map(name => Object.getOwnPropertyDescriptor(AgentSession.prototype, name));

const savedFetch = globalThis.fetch;
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
let root: string;
before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-providers-anthropic-"));
	process.env.PI_CODING_AGENT_DIR = root;
	globalThis.fetch = async () => { throw new Error("Unexpected external network request in offline test"); };
});
after(async () => {
	globalThis.fetch = savedFetch;
	if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
	await rm(root, { recursive: true, force: true });
});

async function session(extensions: string[]) {
	const dir = await mkdtemp(join(root, "session-"));
	const store = AuthStorage.inMemory({ anthropic: credential, "openai-codex": { ...credential }, openrouter: other });
	const runtime = await ModelRuntime.create({ credentials: store, modelsPath: null, refreshOnCreate: false });
	await runtime.refresh({ allowNetwork: false });
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir: root, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		extensionPathsOverride: [], additionalExtensionPaths: extensions });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: dir, agentDir: root, modelRuntime: runtime, model: runtime.getModels("anthropic")[0],
		resourceLoader: loader, sessionManager: SessionManager.inMemory(dir), settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, cacheWarming: "off" }) });
	await session.bindExtensions({ onError: () => {} });
	return { session, runtime };
}
const ids = (runtime: ModelRuntime) => runtime.getProviders().map(provider => provider.id).sort();

describe("RQW-providers with RQW-anthropic", () => {
	it("SDK dispose without session_shutdown, then a new session in the same process: only the kept providers", async () => {
		const first = await session([ANTHROPIC, PROVIDERS]);
		assert.deepEqual(ids(first.runtime), KEPT);
		first.session.dispose();
		assert.deepEqual(slots(), native, "both extensions released and Pi's own methods are back");
		const second = await session([ANTHROPIC, PROVIDERS]);
		try {
			assert.deepEqual(ids(second.runtime), KEPT);
			assert.equal(second.session.scopedModels.length, 0);
		} finally { second.session.dispose(); }
		assert.deepEqual(slots(), native);
	});

	it("RQW-anthropic's last owner disposes while a providers-only session lives: that session and later ones stay covered", async () => {
		const both = await session([ANTHROPIC, PROVIDERS]);
		const providersOnly = await session([PROVIDERS]);
		both.session.dispose();
		assert.deepEqual(ids(providersOnly.runtime), KEPT);
		const later = await session([PROVIDERS]);
		try {
			assert.deepEqual(ids(later.runtime), KEPT, "a session bound after RQW-anthropic restored Pi's methods");
			assert.deepEqual(ids(providersOnly.runtime), KEPT);
		} finally { later.session.dispose(); providersOnly.session.dispose(); }
		assert.deepEqual(slots(), native);
	});

	it("RQW-anthropic switched off while RQW-providers stays on: the transport is gone, the hiding stays", async () => {
		const first = await session([ANTHROPIC, PROVIDERS]);
		try {
			assert.ok(first.runtime.getRegisteredProviderConfig("anthropic"));
			const without = await session([PROVIDERS]);
			try {
				assert.equal(without.runtime.getRegisteredProviderConfig("anthropic"), undefined);
				assert.deepEqual(ids(without.runtime), KEPT);
			} finally { without.session.dispose(); }
			assert.deepEqual(ids(first.runtime), KEPT);
		} finally { first.session.dispose(); }
		assert.deepEqual(slots(), native);
	});

	it("RQW-providers switched off while RQW-anthropic stays on: the transport works and nothing is hidden", async () => {
		const alone = await session([ANTHROPIC]);
		try {
			assert.ok(alone.runtime.getRegisteredProviderConfig("anthropic"));
			assert.ok(alone.runtime.getProviders().length > 2);
			assert.equal(alone.session.scopedModels.length, 0);
		} finally { alone.session.dispose(); }
		assert.deepEqual(slots(), native);
	});
});
