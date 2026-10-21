// Package regression: production load order must not add a lifecycle wrapper on each /reload.
import "./no-network.mjs";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import * as library from "@earendil-works/pi-coding-agent";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle: typeof library = await import(new URL("./bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

for (const [label, sdk] of [["library", library], ["bundle", bundle]] as const) {
	it(`${label}: settings before anthropic has constant bind/dispose wrapper depth across 12 reloads`, async t => {
		const dir = await mkdtemp(join(tmpdir(), "rqw-cache-reload-"));
		const savedDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
		const stackLimit = Error.stackTraceLimit;
		Error.stackTraceLimit = 1000;
		const traces = new Map<string, { settings: number; anthropic: number }[]>();
		// Observe the actual call chain at the native method, not a registry's claimed wrapper count.
		for (const name of ["_bindExtensionCore", "dispose"]) {
			const original = (sdk.AgentSession.prototype as any)[name];
			traces.set(name, []);
			t.mock.method(sdk.AgentSession.prototype as any, name, function(this: library.AgentSession, ...args: unknown[]) {
				const stack = (new Error().stack ?? "").replaceAll("\\", "/").split("\n");
				traces.get(name)!.push({
					settings: stack.filter(line => line.includes("/RQW-settings/cache-warming.ts:")).length,
					anthropic: stack.filter(line => line.includes("/RQW-anthropic/lifecycle.ts:")).length,
				});
				return original.apply(this, args);
			});
		}
		let owner: library.AgentSession | undefined;
		try {
			const runtime = await sdk.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
			await runtime.refresh({ allowNetwork: false });
			const make = async (owning: boolean) => {
				const manager = sdk.SettingsManager.inMemory();
				const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: manager,
					extensionPathsOverride: [], additionalExtensionPaths: owning ? ["RQW-settings", "RQW-anthropic"]
						.map(name => join(ROOT, "extensions", name, "index.ts")) : [],
					noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
				await loader.reload();
				assert.deepEqual(loader.getExtensions().errors, []);
				return (await sdk.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime,
					model: runtime.getModel("anthropic", "claude-opus-5-5")!, resourceLoader: loader,
					settingsManager: manager, sessionManager: sdk.SessionManager.inMemory(dir) })).session;
			};
			owner = await make(true);
			const errors: string[] = [];
			await owner.bindExtensions({ onError: e => errors.push(e.error) });
			for (let reload = 0; reload <= 12; reload++) {
				if (reload) await owner.reload();
				assert.deepEqual(traces.get("_bindExtensionCore")!.at(-1), { settings: 1, anthropic: 1 }, `bind at reload ${reload}`);
				assert.equal(owner.settingsManager.getCacheWarmingMode(), "off");
				// Disposing an unowned shared-runtime child traverses the same prototype without releasing the owner.
				const child = await make(false);
				assert.equal(child.settingsManager.getCacheWarmingMode(), "streaming");
				child.dispose();
				assert.deepEqual(traces.get("dispose")!.at(-1), { settings: 1, anthropic: 1 }, `dispose at reload ${reload}`);
			}
			assert.deepEqual(errors, []);
			await owner.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			assert.equal(owner.settingsManager.getCacheWarmingMode(), "streaming");
		} finally {
			owner?.dispose();
			Error.stackTraceLimit = stackLimit;
			if (savedDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = savedDir;
			await rm(dir, { recursive: true, force: true });
		}
	});
}
