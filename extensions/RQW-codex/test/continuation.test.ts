import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Api, Context, Model, Tool } from "@earendil-works/pi-ai";
import { Continuation } from "../continuation.ts";
import type { CodexIdentity } from "../metadata.ts";
import { buildRequest, type WireItem, type WireModelInfo } from "../wire.ts";

const MODEL_INFO: WireModelInfo = {
	slug: "gpt-test-sol",
	use_responses_lite: false,
	default_reasoning_level: "medium",
	supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
	default_reasoning_summary: "auto",
	support_verbosity: true,
	default_verbosity: "low",
	service_tiers: [{ id: "priority", name: "Fast", description: "fake" }],
	input_modalities: ["text", "image"],
	supports_reasoning_effort_updates: true,
};
const model = { id: "gpt-test-sol", api: "openai-codex-responses", provider: "openai-codex", input: ["text", "image"], reasoning: true } as unknown as Model<Api>;
const TOOL: Tool = { name: "read", description: "Read", parameters: { type: "object" } as never };
const identity: CodexIdentity = {
	installationId: "00000000-0000-4000-8000-000000000001",
	windowId: "019e0000-0000-7000-8000-000000000002",
	rootSessionId: "root-session-fake",
	threadId: "thread-fake-1",
	turnId: "turn-1",
};
const USER = { role: "user" as const, content: "first", timestamp: 1 };

function context(messages: Context["messages"], extra: Partial<Context> = {}): Context {
	return { systemPrompt: "Base prompt fake.", messages, tools: [TOOL], ...extra };
}

function full(ctx: Context, options: Record<string, unknown> = {}, id: CodexIdentity = identity, history?: { rawOutputs?: ReadonlyMap<string, readonly WireItem[]> }): Record<string, unknown> {
	return buildRequest({ model, context: ctx, capabilities: MODEL_INFO, identity: id, options: options as never, history }) as unknown as Record<string, unknown>;
}

// Raw backend output items as received; includes encrypted reasoning, a custom call and an unknown item.
const RAW: WireItem[] = [
	{ type: "reasoning", id: "rs_1", summary: [], encrypted_content: "enc-fake-raw" },
	{ type: "custom_tool_call", id: "ct_1", call_id: "call_c", name: "apply", input: "*** fake patch" , future_field: { keep: [1, "two"] } },
	{ type: "function_call", id: "fc_1", call_id: "call_f", name: "read", arguments: "{ \"path\":  \"a\" }" },
];

const ASSISTANT_TURN_ONE = {
	role: "assistant" as const,
	responseId: "resp-fake-1",
	content: [{ type: "toolCall" as const, id: "call_f", name: "read", arguments: { path: "a" } }],
	api: "openai-codex-responses", provider: "openai-codex", model: "gpt-test-sol", usage: {} as never, stopReason: "toolUse" as const, timestamp: 2,
};
const TOOL_RESULT = { role: "toolResult" as const, toolCallId: "call_f", toolName: "read", content: [{ type: "text" as const, text: "file body" }], isError: false, timestamp: 3 };

describe("Continuation", () => {
	it("sends the first request in full and reports no previous response", () => {
		const c = new Continuation();
		const prepared = c.prepare(full(context([USER])), "socket-a");
		assert.equal(prepared.mode, "full");
		assert.equal(prepared.reason, "no_previous_response");
		assert.equal("previous_response_id" in prepared.body, false);
	});

	it("sends only the suffix after the previous full input and raw outputs, with previous_response_id", () => {
		const c = new Continuation();
		const first = full(context([USER]));
		c.acceptCompleted(first, "resp-fake-1", RAW, "socket-a");
		// Raw backend items are supplied as provenance, so the replayed assistant turn is byte-identical to the baseline.
		const second = full(context([USER, ASSISTANT_TURN_ONE as never, TOOL_RESULT as never]), {}, identity, { rawOutputs: new Map([["resp-fake-1", RAW]]) });
		const prepared = c.prepare(second, "socket-a");
		assert.equal(prepared.mode, "incremental");
		if (prepared.mode !== "incremental") return;
		assert.equal(prepared.previousResponseId, "resp-fake-1");
		assert.deepEqual(prepared.suffix, [{ type: "function_call_output", call_id: "call_f", output: "file body" }]);
		assert.equal(prepared.body.previous_response_id, "resp-fake-1");
		assert.deepEqual(Object.keys(prepared.body).slice(0, 4), ["model", "stream", "previous_response_id", "input"]);
	});

	it("accepts an empty delta when the input equals the baseline exactly", () => {
		const c = new Continuation();
		const first = full(context([USER]));
		c.acceptCompleted(first, "resp-fake-1", RAW, "socket-a");
		const baseline = [...(first.input as WireItem[]), ...RAW];
		const same = { ...first, input: baseline };
		const prepared = c.prepare(same, "socket-a");
		assert.equal(prepared.mode, "incremental");
		assert.deepEqual(prepared.body.input, []);
	});

	it("keeps raw items unmodified: encrypted reasoning, custom and unknown fields replay exactly", () => {
		const c = new Continuation();
		const first = full(context([USER]));
		const golden = structuredClone(RAW);
		const items = structuredClone(RAW);
		c.acceptCompleted(first, "resp-fake-1", items, "socket-a");
		// Caller mutation after acceptance must not change the stored baseline.
		items.length = 0;
		(items as unknown as Record<string, unknown>[])[0] = {};
		const prepared = c.prepare({ ...first, input: [...(first.input as WireItem[]), ...golden] }, "socket-a");
		assert.equal(prepared.mode, "incremental");
		assert.deepEqual(prepared.body.input, []);
	});

	it("keeps the raw argument string when the input replays it and does not parse it into JSON", () => {
		const c = new Continuation();
		const first = full(context([USER]));
		c.acceptCompleted(first, "resp-fake-1", RAW, "socket-a");
		const exact = { ...first, input: [...(first.input as WireItem[]), ...RAW.map((r) => structuredClone(r))] };
		const prepared = c.prepare(exact, "socket-a") as { mode: string; suffix: WireItem[] };
		assert.equal(prepared.mode, "incremental");
		const reparsed = { ...first, input: [...(first.input as WireItem[]), { ...RAW[2], arguments: JSON.stringify({ path: "a" }) }] };
		assert.equal((c.prepare(reparsed, "socket-a") as { mode: string }).mode, "full");
	});

	it("ignores client_metadata, stream_options and access_programs changes", () => {
		const c = new Continuation();
		const first = full(context([USER]));
		c.acceptCompleted(first, "resp-fake-1", RAW, "socket-a");
		const baseline = [...(first.input as WireItem[]), ...RAW];
		const next = {
			...first,
			input: baseline,
			client_metadata: { ...(first.client_metadata as object), turn_id: "turn-2", "x-codex-turn-metadata": "{\"turn_id\":\"turn-2\"}" },
			stream_options: { reasoning_summary_delivery: "sequential_cutoff" },
			access_programs: { cyber: "standard" },
		};
		assert.equal((c.prepare(next, "socket-a") as { mode: string }).mode, "incremental");
	});

	it("sends full for each non-input change: model, tier, tools, prompt, reasoning and store", () => {
		const cases: [string, Record<string, unknown>, string][] = [
			["model_changed", { model: "other-model" }, "model_changed"],
			["service_tier_changed", { service_tier: "priority" }, "service_tier_changed"],
			["tools_changed", { tools: [{ type: "function", name: "other" }] }, "tools_changed"],
			["reasoning_changed", { reasoning: { effort: "low" } }, "reasoning_changed"],
			["store_changed", { store: true }, "store_changed"],
		];
		for (const [label, patch, reason] of cases) {
			const c = new Continuation();
			const first = full(context([USER]));
			c.acceptCompleted(first, "resp-fake-1", RAW, "socket-a");
			const baseline = [...(first.input as WireItem[]), ...RAW];
			const prepared = c.prepare({ ...first, ...patch, input: baseline }, "socket-a");
			assert.equal(prepared.mode, "full", label);
			assert.equal(prepared.reason, reason, label);
			assert.equal("previous_response_id" in prepared.body, false, label);
		}
	});

	it("sends full when the base prompt or any earlier item changes, and when the input is shortened", () => {
		const c = new Continuation();
		const first = full(context([USER]));
		c.acceptCompleted(first, "resp-fake-1", RAW, "socket-a");
		const baseline = [...(first.input as WireItem[]), ...RAW];
		const changedPrompt = full(context([USER], { systemPrompt: "Different prompt." }));
		assert.equal((c.prepare({ ...changedPrompt, input: [...(changedPrompt.input as WireItem[]), ...RAW] }, "socket-a") as { reason: string }).reason, "input_not_extended");
		assert.equal((c.prepare({ ...first, input: baseline.slice(0, -1) }, "socket-a") as { reason: string }).reason, "input_not_extended");
		const edited = [...baseline];
		edited[1] = { ...edited[1], content: [{ type: "input_text", text: "edited" }] } as WireItem;
		assert.equal((c.prepare({ ...first, input: edited }, "socket-a") as { reason: string }).reason, "input_not_extended");
	});

	it("never reuses a response ID across sockets, and invalidate clears state", () => {
		const c = new Continuation();
		const first = full(context([USER]));
		c.acceptCompleted(first, "resp-fake-1", RAW, "socket-a");
		const baseline = { ...first, input: [...(first.input as WireItem[]), ...RAW] };
		assert.equal((c.prepare(baseline, "socket-b") as { mode: string }).mode, "full");
		assert.equal((c.prepare(baseline, "socket-a") as { mode: string }).mode, "incremental");
		c.invalidate("socket-a");
		assert.equal((c.prepare(baseline, "socket-a") as { reason: string }).reason, "no_previous_response");
		c.acceptCompleted(first, "resp-fake-2", RAW, "socket-b");
		c.invalidate();
		assert.equal(c.size, 0);
	});

	it("refuses to record a completed response without an id", () => {
		assert.throws(() => new Continuation().acceptCompleted(full(context([USER])), "", RAW, "socket-a"), /no id/);
	});

	it("never mutates the request it was given", () => {
		const c = new Continuation();
		const first = full(context([USER]));
		const snapshot = JSON.stringify(first);
		c.acceptCompleted(first, "resp-fake-1", RAW, "socket-a");
		c.prepare({ ...first, input: [...(first.input as WireItem[]), ...RAW] }, "socket-a");
		assert.equal(JSON.stringify(first), snapshot);
	});
});
