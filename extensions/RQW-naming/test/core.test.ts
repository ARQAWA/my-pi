import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type AssistantMessage, createFauxCore, fauxAssistantMessage, getSupportedThinkingLevels, type Model,
} from "@earendil-works/pi-ai";
import {
	generateSessionName, isValidSessionName, lowestReasoning, type NamingRegistry, parseCandidates, parseIndex,
} from "../core.ts";

type Call = { provider: string; id: string; reasoning: unknown; signal: AbortSignal | undefined; prompt: string; context: unknown };

/** Scripted registry over real pi-ai faux cores: one core per provider, a shared reply queue, and a call record. */
function fixture(options: { available: string[]; replies: (string | AssistantMessage)[]; haiku?: Model<any>; luna?: Model<any> }) {
	const replies = [...options.replies];
	const calls: Call[] = [];
	const haiku = createFauxCore({ provider: "anthropic", models: [{ id: "claude-haiku-5-5", reasoning: true }] });
	const luna = createFauxCore({ provider: "openai-codex", models: [{ id: "gpt-6-luna", reasoning: true }] });
	const cores = { anthropic: haiku, "openai-codex": luna };
	const script = () => {
		const next = replies.shift();
		if (next === undefined) throw new Error("no scripted reply left");
		return typeof next === "string" ? fauxAssistantMessage(next) : next;
	};
	for (const core of Object.values(cores)) core.setResponses(Array.from({ length: 20 }, () => (context, opts, _state, model) => {
		const text = context.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
		calls.push({ provider: model.provider, id: model.id, reasoning: opts?.reasoning, signal: opts?.signal, prompt: text, context });
		return script();
	}));
	const models = { anthropic: options.haiku ?? haiku.getModel("claude-haiku-5-5")!, "openai-codex": options.luna ?? luna.getModel("gpt-6-luna")! };
	const registry = {
		getAvailableOfType: async (_type: string, provider?: string) =>
			options.available.filter((p) => !provider || p === provider).map((p) => models[p as keyof typeof models]),
		streamSimple: (model: Model<any>, context: any, opts: any) => cores[model.provider as keyof typeof cores].streamSimple(model, context, opts),
	} as unknown as NamingRegistry;
	return { registry, calls, models };
}

const TEN = ["Alpha plan", "Beta notes", "Gamma trip", "Delta bug", "Epsilon ideas", "Zeta test", "Eta docs", "Theta refactor", "Iota review", "Kappa ship"];

describe("generation and selection", () => {
	it("requests exactly ten names, then selects by meaning rather than the first item", async () => {
		const f = fixture({ available: ["anthropic", "openai-codex"], replies: [JSON.stringify(TEN), "3"] });
		const name = await generateSessionName({ context: "user: plan a trip to Lisbon", registry: f.registry, signal: new AbortController().signal });
		assert.equal(name, "Delta bug");
		assert.equal(f.calls.length, 2);
		assert.match(f.calls[0].prompt, /exactly 10/);
		assert.match(f.calls[1].prompt, /3: Delta bug/);
		assert.doesNotMatch(f.calls[1].prompt, /prefer the first/i);
	});

	it("uses the complete context text in both model calls", async () => {
		const f = fixture({ available: ["anthropic"], replies: [JSON.stringify(TEN), "0"] });
		await generateSessionName({ context: "CONTEXT-MARKER-7f3 full transcript", registry: f.registry, signal: new AbortController().signal });
		assert.equal(f.calls.length, 2);
		for (const call of f.calls) assert.match(call.prompt, /CONTEXT-MARKER-7f3 full transcript/);
	});

	it("prefers anthropic/claude-haiku-5-5 when both providers are authenticated", async () => {
		const f = fixture({ available: ["openai-codex", "anthropic"], replies: [JSON.stringify(TEN), "0"] });
		await generateSessionName({ context: "x", registry: f.registry, signal: new AbortController().signal });
		assert.deepEqual(f.calls.map((c) => `${c.provider}/${c.id}`), ["anthropic/claude-haiku-5-5", "anthropic/claude-haiku-5-5"]);
	});

	it("falls back to openai-codex/gpt-6-luna when anthropic is not authenticated", async () => {
		const f = fixture({ available: ["openai-codex"], replies: [JSON.stringify(TEN), "0"] });
		await generateSessionName({ context: "x", registry: f.registry, signal: new AbortController().signal });
		assert.deepEqual(f.calls.map((c) => `${c.provider}/${c.id}`), ["openai-codex/gpt-6-luna", "openai-codex/gpt-6-luna"]);
	});

	it("rejects when no naming provider is authenticated", async () => {
		const f = fixture({ available: [], replies: [] });
		await assert.rejects(generateSessionName({ context: "x", registry: f.registry, signal: new AbortController().signal }), /No authenticated naming model/);
		assert.equal(f.calls.length, 0);
	});

	it("passes the lowest supported reasoning level, undefined for off, and the caller signal", async () => {
		const f = fixture({ available: ["anthropic"], replies: [JSON.stringify(TEN), "0"] });
		const controller = new AbortController();
		await generateSessionName({ context: "x", registry: f.registry, signal: controller.signal });
		const levels = getSupportedThinkingLevels(f.models.anthropic);
		const expected = levels[0] === "off" ? undefined : levels[0];
		assert.equal(lowestReasoning(f.models.anthropic), expected);
		for (const call of f.calls) {
			assert.equal(call.reasoning, expected);
			assert.equal(call.signal, controller.signal);
		}
	});

	it("passes minimal when off is unsupported", async () => {
		const model = { id: "claude-haiku-5-5", provider: "anthropic", reasoning: true, thinkingLevelMap: { off: null } } as unknown as Model<any>;
		const f = fixture({ available: ["anthropic"], haiku: model, replies: [JSON.stringify(TEN), "0"] });
		await generateSessionName({ context: "x", registry: f.registry, signal: new AbortController().signal });
		assert.deepEqual(f.calls.map((c) => c.reasoning), ["minimal", "minimal"]);
	});

	it("maps an off-only model to undefined reasoning", () => {
		const off = { id: "x", provider: "anthropic", reasoning: false, thinkingLevelMap: {} } as unknown as Model<any>;
		assert.equal(lowestReasoning(off), undefined);
	});
});

describe("candidate validity", () => {
	it("counts Unicode code points, not UTF-16 units, for the 32 limit", () => {
		assert.equal(isValidSessionName("a".repeat(32)), true);
		assert.equal(isValidSessionName("a".repeat(33)), false);
		assert.equal(isValidSessionName("😀".repeat(32)), true); // 64 UTF-16 units, 32 code points
		assert.equal(isValidSessionName("😀".repeat(33)), false);
	});

	it("limits whitespace-separated words to four", () => {
		assert.equal(isValidSessionName("one two three four"), true);
		assert.equal(isValidSessionName("one two three four five"), false);
	});

	it("rejects empty, control-character and newline names", () => {
		assert.equal(isValidSessionName("   "), false);
		assert.equal(isValidSessionName("a\nb"), false);
		assert.equal(isValidSessionName("a\tb"), false);
		assert.equal(isValidSessionName("a\u0007b"), false);
	});

	it("trims valid names and drops non-strings without truncating", () => {
		assert.deepEqual(parseCandidates(JSON.stringify(["  Trip plan  ", 42, "a".repeat(33), "ok", "", "", "", "", "", ""])), ["Trip plan", "ok"]);
	});

	it("rejects a batch that does not have exactly ten candidate slots", () => {
		assert.throws(() => parseCandidates(JSON.stringify(TEN.slice(1))));
		assert.throws(() => parseCandidates(JSON.stringify([...TEN, "extra"])));
	});

	it("rejects a non-array generation reply", () => {
		assert.throws(() => parseCandidates('{"a":1}'));
		assert.throws(() => parseCandidates("not json"));
	});
});

describe("selection reply", () => {
	it("returns the chosen exact trimmed candidate, dropping invalid candidates before indexing", async () => {
		const batch = ["   ", "a".repeat(33), "Real one", "Second  ", "x\ny", "", "", "", "", ""];
		const f = fixture({ available: ["anthropic"], replies: [JSON.stringify(batch), "1"] });
		const name = await generateSessionName({ context: "x", registry: f.registry, signal: new AbortController().signal });
		assert.equal(name, "Second");
		assert.doesNotMatch(f.calls[1].prompt, /a{33}/);
		assert.match(f.calls[1].prompt, /0: Real one\n1: Second/);
	});

	it("does not spend the selection call when no candidate is valid", async () => {
		const f = fixture({ available: ["anthropic"], replies: [JSON.stringify(Array(10).fill("a".repeat(40)))] });
		await assert.rejects(generateSessionName({ context: "x", registry: f.registry, signal: new AbortController().signal }), /No valid session names/);
		assert.equal(f.calls.length, 1);
	});

	it("rejects malformed selections", async () => {
		for (const reply of ["not json", "10", "-1", "1.5", '"0"', "null"]) {
			const f = fixture({ available: ["anthropic"], replies: [JSON.stringify(TEN), reply] });
			await assert.rejects(generateSessionName({ context: "x", registry: f.registry, signal: new AbortController().signal }), undefined, reply);
		}
		assert.equal(parseIndex("2", 3), 2);
		assert.throws(() => parseIndex("3", 3));
	});

	it("fails the attempt on an error or aborted assistant message", async () => {
		for (const stopReason of ["error", "aborted"] as const) {
			const bad = fauxAssistantMessage("", { stopReason, errorMessage: "provider exploded" });
			const f = fixture({ available: ["anthropic"], replies: [bad] });
			await assert.rejects(generateSessionName({ context: "x", registry: f.registry, signal: new AbortController().signal }), /Naming model call failed/);
		}
	});

	it("rejects immediately when the signal is already aborted", async () => {
		const f = fixture({ available: ["anthropic"], replies: [] });
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(generateSessionName({ context: "x", registry: f.registry, signal: controller.signal }));
		assert.equal(f.calls.length, 0);
	});
});
