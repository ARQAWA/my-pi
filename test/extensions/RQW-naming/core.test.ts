import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateSessionName, selectNamingModel, type NamingRegistry } from "../../../extensions/RQW-naming/core.ts";

function registry(reply = '["Lisbon trip", "Travel plans"]') {
	const models = [
		{ provider: "anthropic", id: "claude-haiku-5-5" },
		{ provider: "openai-codex", id: "gpt-5.6-luna" },
	];
	let requests = 0;
	return {
		getAvailableOfType: async (_type: string, provider: string) => models.filter((model) => model.provider === provider),
		streamSimple: () => {
			if (++requests > 1) throw new Error("Only one naming request allowed");
			return { result: async () => ({ stopReason: "stop", content: [{ type: "text", text: reply }] }) };
		},
	} as unknown as NamingRegistry;
}

describe("RQW-naming public core", () => {
	it("returns the best valid name from one request", async () => {
		const name = await generateSessionName({ context: "Plan a Lisbon trip", provider: "anthropic", registry: registry(), signal: new AbortController().signal });
		assert.equal(name, "Lisbon trip");
	});

	it("returns the name when the model provides exactly one candidate", async () => {
		const name = await generateSessionName({ context: "Plan a Lisbon trip", provider: "anthropic", registry: registry('["Lisbon trip"]'), signal: new AbortController().signal });
		assert.equal(name, "Lisbon trip");
	});

	for (const [provider, id] of [
		["anthropic", "claude-haiku-5-5"],
		["openai-codex", "gpt-5.6-luna"],
	]) {
		it(`uses the low naming model for ${provider}`, async () => {
			const selected = await selectNamingModel(registry(), new AbortController().signal, provider);
			assert.deepEqual(selected, { model: { provider, id }, reasoning: "low" });
		});
	}
});
