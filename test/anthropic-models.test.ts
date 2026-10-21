// Package integration only: real Pi catalog/auth snapshots, fake secrets, no provider requests.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = join(ROOT, "extensions/RQW-models/index.ts");
const ADAPTER = join(ROOT, "extensions/RQW-anthropic/index.ts");
// Resolve Pi internals from its installed entrypoint; package exports do not expose this class.
const { InteractiveMode } = await import(new URL("./modes/interactive/interactive-mode.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

const PACKAGE: string[] = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")).pi.extensions.map((path: string) => join(ROOT, path));

for (const order of [[MODELS, ADAPTER], [ADAPTER, MODELS], PACKAGE]) {
	for (const authenticated of [false, true]) {
		it(`model picker startup: ${order === PACKAGE ? "full package" : order[0] === MODELS ? "models source first" : "adapter source first"}, auth ${authenticated}`, async () => {
			const dir = await mkdtemp(join(tmpdir(), "rqw-anthropic-models-"));
			const savedEnv = { ...process.env };
			for (const key of Object.keys(process.env)) if (/(?:_API_KEY|_TOKEN|_SECRET)$/.test(key)) delete process.env[key];
			const savedDir = process.env.PI_CODING_AGENT_DIR;
			const savedArgv = process.argv;
			const savedFetch = globalThis.fetch;
			process.env.PI_CODING_AGENT_DIR = dir;
			process.argv = savedArgv.slice(0, 2);
			let requests = 0;
			globalThis.fetch = async () => { requests++; throw new Error("Unexpected provider request"); };
			try {
				const authPath = join(dir, "auth.json");
				await writeFile(authPath, JSON.stringify(authenticated ? {
					anthropic: { type: "api_key", key: "fake-anthropic-key" },
					"openai-codex": { type: "api_key", key: "fake-codex-key" },
					openrouter: { type: "api_key", key: "fake-hidden-key" },
				} : {}));
				const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
				await runtime.getAvailable();
				const settingsFile = join(dir, "settings.json");
				const config = { compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" };
				await writeFile(settingsFile, JSON.stringify({ ...config, extensions: order }));
				const settings = SettingsManager.create(dir, dir);
				const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings,
					noSkills: true, noContextFiles: true, noThemes: true, noPromptTemplates: true });
				await loader.reload();
				assert.deepEqual(loader.getExtensions().errors, []);
				// Before bindCore registers the adapter, source loading must not hide unrelated runtimes.
				assert.ok(runtime.getProviders().length > 2);
				assert.equal(runtime.getRegisteredProviderConfig("anthropic"), undefined);
				const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime,
					resourceLoader: loader, settingsManager: settings, sessionManager: SessionManager.inMemory(dir),
					model: runtime.getModel("openai-codex", "gpt-6-sol")!, thinkingLevel: "high", noTools: "all" });
				const errors: string[] = [];
				try {
					await session.bindExtensions({ onError: error => errors.push(error.error) });
					assert.deepEqual(errors, []);
					assert.deepEqual(runtime.getProviders().map(provider => provider.id).sort(), ["anthropic", "openai-codex"]);
					const login = () => [...new Set<string>(InteractiveMode.prototype.getLoginProviderOptions.call({ session }).map((provider: { id: string }) => provider.id))].sort();
					assert.deepEqual(login(), ["anthropic", "openai-codex"]);
					assert.ok(session.extensionRunner.getRegisteredCommands().some(command => command.name === "rqw-models"));
					assert.equal(session.model?.id, authenticated ? "claude-opus-5-5" : "gpt-6-sol");
					assert.equal(session.thinkingLevel, "medium");
					const available = runtime.getAvailableSnapshot();
					assert.ok(available.every(model => ["anthropic", "openai-codex"].includes(model.provider)));
					assert.equal(available.some(model => model.id === "claude-opus-5-5"), authenticated);
					// Disable just the adapter: the independent model picker stays and stock provider visibility returns.
					await writeFile(settingsFile, JSON.stringify({ ...config, extensions: [MODELS] }));
					await session.reload();
					assert.deepEqual(errors, []);
					assert.deepEqual(loader.getExtensions().errors, []);
					assert.ok(runtime.getProviders().length > 2);
					assert.ok(login().includes("openrouter"));
					assert.equal(runtime.getRegisteredProviderConfig("anthropic"), undefined);
					assert.equal(session.model?.id, authenticated ? "claude-opus-5-5" : "gpt-6-sol");
					assert.equal(session.thinkingLevel, "medium");
					assert.equal(requests, 0);
				} finally { session.dispose(); }
			} finally {
				process.argv = savedArgv;
				globalThis.fetch = savedFetch;
				if (savedDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
				else process.env.PI_CODING_AGENT_DIR = savedDir;
				Object.assign(process.env, savedEnv);
				await rm(dir, { recursive: true, force: true });
			}
		});
	}
}
