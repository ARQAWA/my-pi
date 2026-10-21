import "./recovery-offline.mjs";
import assert from "node:assert/strict";
import { it } from "node:test";
import { entries } from "./pi-entrypoints.ts";
import { setup, credential, context, textEvents, finish, response } from "./recovery-fixtures.ts";

for (const [label, entry] of entries) {
	it(`${label}: disposing unowned native generic and reviewer children keeps the main subscription transport alive`, async () => {
		const active = await setup(undefined, entry);
		const overlay = active.runtime.getRegisteredProviderConfig("anthropic")!.streamSimple;
		try {
			for (const role of ["generic", "reviewer"]) {
				const dir = process.env.PI_CODING_AGENT_DIR!;
				const resourceLoader = new entry.DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true,
					noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
				await resourceLoader.reload();
				const { session: child } = await entry.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: active.runtime,
					model: active.session.model, resourceLoader, sessionManager: entry.SessionManager.inMemory(dir),
					settingsManager: entry.SettingsManager.inMemory({ compaction: { enabled: false } }),
					...(role === "reviewer" ? { tools: ["read", "grep", "find"] } : {}) });
				assert.equal(child.modelRuntime, active.runtime);
				assert.equal(child.resourceLoader.getExtensions().extensions.length, 0);
				child.dispose(); child.dispose();
				assert.equal(active.runtime.getRegisteredProviderConfig("anthropic")!.streamSimple, overlay);
				assert.deepEqual(active.runtime.getProviders().map(provider => provider.id).sort(), ["anthropic", "openai-codex"]);
				let calls = 0;
				const result = await active.runtime.completeSimple(active.session.model!, context, { fetch: async (_input, init) => {
					calls++; assert.ok(String(init?.body).includes("cc_entrypoint=cli;"));
					return response([...textEvents, ...finish]);
				} });
				assert.equal(calls, 1); assert.equal(result.stopReason, "stop");
			}
			assert.deepEqual(await active.store.read("anthropic"), credential);
		} finally { active.session.dispose(); }
		assert.equal(active.runtime.getRegisteredProviderConfig("anthropic"), undefined);
		assert.ok(active.runtime.getProviders().length > 2);
	});

	it(`${label}: an old disposed session cannot release a new owner reusing its session manager`, async () => {
		const first = await setup(undefined, entry);
		first.session.dispose();
		const second = await setup(undefined, entry, first);
		try {
			assert.equal(second.runtime, first.runtime);
			assert.equal(second.session.sessionManager, first.session.sessionManager);
			assert.notEqual(second.session, first.session);
			first.session.dispose(); first.session.dispose();
			assert.ok(second.runtime.getRegisteredProviderConfig("anthropic"));
			let calls = 0;
			const result = await second.runtime.completeSimple(second.session.model!, context, { fetch: async () => {
				calls++; return response([...textEvents, ...finish]);
			} });
			assert.equal(calls, 1); assert.equal(result.stopReason, "stop");
		} finally { second.session.dispose(); }
		assert.equal(second.runtime.getRegisteredProviderConfig("anthropic"), undefined);
	});
}
