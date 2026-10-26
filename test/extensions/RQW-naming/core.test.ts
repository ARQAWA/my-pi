import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateSessionName, isValidSessionName, parseCandidates, parseIndex, type NamingRegistry } from "../../../extensions/RQW-naming/core.ts";

const TEN = ["Alpha plan", "Beta notes", "Gamma trip", "Delta bug", "Epsilon ideas", "Zeta test", "Eta docs", "Theta refactor", "Iota review", "Kappa ship"];

function registry(replies: string[], available = true) {
	const calls: { model: string; reasoning: unknown; prompt: string }[] = [];
	const value = {
		getAvailableOfType: async () => available ? [{ id: "kimi-for-coding", provider: "kimi-coding" }] : [],
		streamSimple: (model: { id: string }, context: any, options: any) => {
			calls.push({ model: model.id, reasoning: options.reasoning, prompt: context.messages[0].content });
			const text = replies.shift();
			return { result: async () => ({ stopReason: "stop", content: [{ type: "text", text }] }) };
		},
	} as unknown as NamingRegistry;
	return { value, calls };
}

describe("RQW-naming public core", () => {
	it("generates ten candidates and returns the selected valid name", async () => {
		const fake = registry([JSON.stringify(TEN), "3"]);
		const name = await generateSessionName({ context: "Plan a Lisbon trip", registry: fake.value, signal: new AbortController().signal });
		assert.equal(name, "Delta bug");
		assert.equal(fake.calls.length, 2);
		assert.deepEqual(fake.calls.map((call) => [call.model, call.reasoning]), [["kimi-for-coding", "low"], ["kimi-for-coding", "low"]]);
		assert.match(fake.calls[1].prompt, /3: Delta bug/);
	});

	it("enforces name boundaries and rejects invalid replies without fallback", async () => {
		assert.equal(isValidSessionName("one two three four"), true);
		assert.equal(isValidSessionName("one two three four five"), false);
		assert.equal(isValidSessionName("😀".repeat(32)), true);
		assert.equal(isValidSessionName("😀".repeat(33)), false);
		assert.deepEqual(parseCandidates(JSON.stringify(["  Trim me  ", ...TEN.slice(1)])), TEN.with(0, "Trim me"));
		assert.throws(() => parseCandidates(JSON.stringify(TEN.slice(1))), /exactly ten/);
		assert.equal(parseIndex("2", 3), 2);
		assert.throws(() => parseIndex("3", 3));
		const unavailable = registry([], false);
		await assert.rejects(generateSessionName({ context: "x", registry: unavailable.value, signal: new AbortController().signal }), /No authenticated naming model/);
		assert.equal(unavailable.calls.length, 0);
	});
});
