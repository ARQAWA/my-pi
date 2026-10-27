import assert from "node:assert/strict";
import { it } from "node:test";
import { installVisibility } from "../../../extensions/RQW-providers/index.ts";

const models = [
	{ id: "claude", provider: "anthropic" },
	{ id: "kimi", provider: "kimi-coding" },
	{ id: "codex", provider: "openai-codex" },
	{ id: "other", provider: "openrouter" },
	{ id: "alias", provider: "constructor" },
];
class Runtime {
	getProviders() { return models.map(model => ({ id: model.provider })); }
	getModels() { return models; }
	getAvailableSnapshot() { return models; }
	async getAvailable() { return models; }
}
class Session {
	modelRuntime = new Runtime();
	entries = models.map(model => ({ model }));
	get scopedModels() { return this.entries; }
	_bindExtensionCore() {}
	dispose() {}
}

// The prototype-named provider also covers the exact-filter regression from 2bfdc8b.
it("returns only allowed providers while owned and restores all results on release", async () => {
	const visibility = installVisibility(Runtime as never, Session as never);
	const session = new Session();
	visibility.own(session as never, () => true);
	const allowed = ["anthropic", "kimi-coding", "openai-codex"];
	assert.deepEqual(session.modelRuntime.getProviders().map(provider => provider.id), allowed);
	for (const list of [session.modelRuntime.getModels(), session.modelRuntime.getAvailableSnapshot(), await session.modelRuntime.getAvailable()]) {
		assert.deepEqual(list.map(model => model.provider), allowed);
	}
	assert.deepEqual(session.scopedModels.map(entry => entry.model.provider), allowed);
	visibility.release();
	assert.equal(session.modelRuntime.getModels().length, models.length);
	assert.equal(session.scopedModels.length, models.length);
});
