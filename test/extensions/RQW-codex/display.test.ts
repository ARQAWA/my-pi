// Deterministic equivalence of the pinned display parser (extensions/RQW-codex/display.mjs) with the official
// @earendil-works/pi-ai 1.4.0 processResponsesStream (npm export, used here only as the oracle), on synthetic Responses SSE events.
// Provenance: display.mjs ports openai-responses-shared.js and constrained-sampling.js of pi-ai 1.4.0 (MIT); the source
// SHA-256 pins below are checked whenever the installed pi-ai is 1.4.0. No network, no auth, no Pi session.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { processResponsesStream as nativeProcessResponsesStream } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { processResponsesStream as localProcessResponsesStream } from "../../../extensions/RQW-codex/display.mjs";

const PI_AI_VERSION = "1.4.0";
const SOURCE_SHA256 = {
	"dist/api/openai-responses-shared.js": "eed025a4821b1e017dd024b930caf8fa11c7fe053a81efe11bd7d846fdc641d3",
	"dist/api/constrained-sampling.js": "3364d03ce8f7ef17ac336e35a134bf3b3b7582430a3841ac78bbf5ca216010d0",
};
const PI_AI_DIR = fileURLToPath(new URL("../../../node_modules/@earendil-works/pi-ai/", import.meta.url));

type Native = Record<string, any>;
type Impl = typeof localProcessResponsesStream;

const MODEL = {
	id: "gpt-6-luna",
	name: "GPT-6-Luna",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "",
	reasoning: true,
	input: ["text"],
	cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 },
	contextWindow: 100000,
	maxTokens: 4000,
} as const;

function freshOutput(): Native {
	return {
		role: "assistant",
		content: [],
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: 0,
	};
}

function recordingStream(): { events: Native[]; push(event: Native): void } {
	const events: Native[] = [];
	return { events, push: (event) => void events.push(JSON.parse(JSON.stringify(event))) };
}

function serviceTierOptions(): Native {
	return {
		serviceTier: "priority",
		resolveServiceTier: (responseTier: unknown, requestTier: unknown) => (responseTier ?? requestTier) as unknown,
		applyServiceTierPricing: (usage: Native, tier: unknown) => {
			if (tier === "priority") {
				usage.cost.total *= 2;
				usage.cost.input *= 2;
			}
		},
	};
}

async function run(impl: Impl, events: Native[], options?: Native) {
	const output = freshOutput();
	const stream = recordingStream();
	const seen: Native[] = [];
	const opts = {
		...(options ?? {}),
		onProviderStreamEvent: (event: Native) => {
			seen.push(JSON.parse(JSON.stringify(event)));
		},
	};
	let error: string | undefined;
	try {
		await impl(
			(async function* () {
				for (const event of events) yield event;
			})() as any,
			output as any,
			stream as any,
			MODEL as any,
			opts as any,
		);
	} catch (caught) {
		error = (caught as Error).message;
	}
	return { error, output: JSON.parse(JSON.stringify(output)), events: stream.events, seen };
}

async function assertSame(events: Native[], options?: Native) {
	const native = await run(nativeProcessResponsesStream as Impl, events, options);
	const local = await run(localProcessResponsesStream, events, options);
	assert.deepStrictEqual(local, native);
	return local;
}

const usage = {
	input_tokens: 100,
	output_tokens: 10,
	total_tokens: 110,
	input_tokens_details: { cached_tokens: 20, cache_write_tokens: 5 },
	output_tokens_details: { reasoning_tokens: 3 },
};

describe("provenance", () => {
	it("pins the MIT source of pi-ai 1.4.0 that display.mjs ports", () => {
		const pkg = JSON.parse(readFileSync(`${PI_AI_DIR}package.json`, "utf8")) as { version: string };
		assert.equal(pkg.version, PI_AI_VERSION);
		for (const [file, sha] of Object.entries(SOURCE_SHA256)) {
			const actual = createHash("sha256").update(readFileSync(`${PI_AI_DIR}${file}`)).digest("hex");
			assert.equal(actual, sha, file);
		}
	});

	it("imports only the root public API of pi-ai", () => {
		const source = readFileSync(fileURLToPath(new URL("../../../extensions/RQW-codex/display.mjs", import.meta.url)), "utf8");
		const specifiers = [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gm)].map((match) => match[1]);
		assert.deepStrictEqual(specifiers, ["@earendil-works/pi-ai"]);
	});
});

describe("processResponsesStream equivalence with pi-ai 1.4.0", () => {
	it("text with commentary then final_answer phase, usage, cost and service tier pricing", async () => {
		const result = await assertSame(
			[
				{ type: "response.created", response: { id: "resp_1" } },
				{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_1", phase: "commentary" } },
				{ type: "response.output_text.delta", output_index: 0, delta: "Hel" },
				{ type: "response.output_text.delta", output_index: 0, delta: "lo" },
				{
					type: "response.output_item.done",
					output_index: 0,
					item: { type: "message", id: "msg_1", phase: "final_answer", content: [{ type: "output_text", text: "Hello" }] },
				},
				{ type: "response.completed", response: { id: "resp_1", status: "completed", usage, service_tier: "priority", output: [] } },
			],
			serviceTierOptions(),
		);
		assert.equal(result.error, undefined);
		assert.equal(result.output.stopReason, "stop");
		assert.equal(result.output.usage.cost.total > 0, true);
		assert.equal(result.events.map((event) => event.type).join(","), "text_start,text_delta,text_delta,text_end");
	});

	it("text with a refusal part and a text without phase", async () => {
		const result = await assertSame([
			{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_r" } },
			{ type: "response.refusal.delta", output_index: 0, delta: "No" },
			{
				type: "response.output_item.done",
				output_index: 0,
				item: { type: "message", id: "msg_r", content: [{ type: "refusal", refusal: "No" }] },
			},
			{ type: "response.completed", response: { id: "resp_r", status: "completed", output: [] } },
		]);
		assert.equal(result.output.content[0].textSignature, JSON.stringify({ v: 1, id: "msg_r" }));
	});

	it("reasoning with summary parts, encrypted content and Azure late backfill from the terminal response", async () => {
		const result = await assertSame([
			{ type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "rs_1" } },
			{ type: "response.reasoning_summary_text.delta", output_index: 0, delta: "think A" },
			{ type: "response.reasoning_summary_part.done", output_index: 0 },
			{ type: "response.reasoning_summary_text.delta", output_index: 0, delta: "think B" },
			{
				type: "response.output_item.done",
				output_index: 0,
				item: { type: "reasoning", id: "rs_1", summary: [{ text: "think A" }, { text: "think B" }] },
			},
			{ type: "response.output_item.added", output_index: 1, item: { type: "reasoning", id: "rs_2" } },
			{ type: "response.reasoning_text.delta", output_index: 1, delta: "raw" },
			{
				type: "response.output_item.done",
				output_index: 1,
				item: { type: "reasoning", id: "rs_2", content: [{ text: "raw" }], encrypted_content: "enc_own" },
			},
			{
				type: "response.completed",
				response: {
					id: "resp_2",
					status: "completed",
					output: [
						{ type: "reasoning", id: "rs_1", encrypted_content: "enc_late" },
						{ type: "reasoning", id: "rs_2", encrypted_content: "enc_other" },
					],
				},
			},
		]);
		assert.equal(result.output.content[0].thinking, "think A\n\nthink B");
		assert.equal(JSON.parse(result.output.content[0].thinkingSignature).encrypted_content, "enc_late");
		assert.equal(JSON.parse(result.output.content[1].thinkingSignature).encrypted_content, "enc_own");
	});

	it("interleaved function calls, one finished through function_call_arguments.done", async () => {
		const result = await assertSame([
			{ type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "fc_1", call_id: "call_a", name: "read", arguments: "" } },
			{ type: "response.output_item.added", output_index: 2, item: { type: "function_call", id: "fc_2", call_id: "call_b", name: "bash", arguments: '{"x":' } },
			{ type: "response.function_call_arguments.delta", output_index: 1, delta: '{"path":"a"' },
			{ type: "response.function_call_arguments.delta", output_index: 2, delta: "1" },
			{ type: "response.function_call_arguments.delta", output_index: 1, delta: "}" },
			{ type: "response.function_call_arguments.done", output_index: 1, arguments: '{"path":"a"}' },
			{ type: "response.function_call_arguments.delta", output_index: 9, delta: "orphan" },
			{ type: "response.function_call_arguments.delta", output_index: 2, delta: "}" },
			{
				type: "response.output_item.done",
				output_index: 2,
				item: { type: "function_call", id: "fc_2", call_id: "call_b", name: "bash", arguments: '{"x":1}', namespace: "shell" },
			},
			{ type: "response.output_item.done", output_index: 1, item: { type: "function_call", id: "fc_1", call_id: "call_a", name: "read", arguments: '{"path":"a"}' } },
			{ type: "response.completed", response: { id: "resp_3", status: "completed", output: [] } },
		]);
		assert.equal(result.output.stopReason, "toolUse");
		assert.deepStrictEqual(
			result.output.content.map((block: Native) => [block.id, block.arguments, block.namespace]),
			[
				["call_a|fc_1", { path: "a" }, undefined],
				["call_b|fc_2", { x: 1 }, "shell"],
			],
		);
	});

	it("custom tool call with grammar input property streams JSON deltas and finishes with the raw input", async () => {
		const result = await assertSame(
			[
				{ type: "response.output_item.added", output_index: 0, item: { type: "custom_tool_call", call_id: "c1", id: "ctc_1", name: "apply_patch", input: "" } },
				{ type: "response.custom_tool_call_input.delta", output_index: 0, delta: "*** Begin" },
				{ type: "response.custom_tool_call_input.delta", output_index: 0, delta: ' Patch "q"\n' },
				{ type: "response.custom_tool_call_input.done", output_index: 0, input: '*** Begin Patch "q"\n' },
				{ type: "response.custom_tool_call_input.done", output_index: 0, input: '*** Begin Patch "q"\n' },
				{
					type: "response.output_item.done",
					output_index: 0,
					item: { type: "custom_tool_call", call_id: "c1", id: "ctc_1", name: "apply_patch", input: '*** Begin Patch "q"\n' },
				},
				{ type: "response.completed", response: { id: "resp_4", status: "completed", output: [] } },
			],
			{ grammarToolInputProperties: new Map([["apply_patch", "input"]]) },
		);
		assert.equal(result.output.stopReason, "toolUse");
		assert.deepStrictEqual(result.output.content[0].arguments, { input: '*** Begin Patch "q"\n' });
		assert.equal(result.events.filter((event) => event.type === "toolcall_delta").length, 3);
	});

	it("custom tool call without a grammar property uses the default input key", async () => {
		await assertSame([
			{ type: "response.output_item.added", output_index: 0, item: { type: "custom_tool_call", call_id: "c2", id: "ctc_2", name: "raw", input: "x" } },
			{ type: "response.output_item.done", output_index: 0, item: { type: "custom_tool_call", call_id: "c2", id: "ctc_2", name: "raw", input: "x" } },
			{ type: "response.completed", response: { id: "resp_5", status: "completed", output: [] } },
		]);
	});

	it("malformed function arguments stay visible as argumentsError", async () => {
		const result = await assertSame([
			{ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_bad", call_id: "call_bad", name: "read", arguments: "" } },
			{ type: "response.function_call_arguments.delta", output_index: 0, delta: '{"a":' },
			{ type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc_bad", call_id: "call_bad", name: "read", arguments: '{"a":' } },
			{ type: "response.completed", response: { id: "resp_6", status: "completed", output: [] } },
		]);
		assert.equal(result.output.stopReason, "toolUse");
		assert.notEqual(result.output.content[0].argumentsError, undefined);
	});

	it("unfinished tool call at a completed response is refused", async () => {
		const result = await assertSame([
			{ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_u", call_id: "call_u", name: "read", arguments: '{"a"' } },
			{ type: "response.completed", response: { id: "resp_7", status: "completed", output: [] } },
		]);
		assert.match(result.error ?? "", /unfinished tool call: read \(call_u\|fc_u\)/);
	});

	it("max_output_tokens keeps length, other incomplete reasons become errors", async () => {
		const length = await assertSame([
			{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_l" } },
			{ type: "response.output_text.delta", output_index: 0, delta: "cut" },
			{ type: "response.incomplete", response: { id: "resp_8", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage, output: [] } },
		]);
		assert.equal(length.output.stopReason, "length");
		assert.equal(length.output.rawStopReason, "incomplete.max_output_tokens");

		const filtered = await assertSame([
			{ type: "response.incomplete", response: { id: "resp_9", status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] } },
		]);
		assert.equal(filtered.output.stopReason, "error");
		assert.equal(filtered.output.errorMessage, "Response incomplete: content_filter");
	});

	it("incomplete without a reason and a cancelled status", async () => {
		const bare = await assertSame([{ type: "response.incomplete", response: { id: "resp_10", status: "incomplete", output: [] } }]);
		assert.equal(bare.output.errorMessage, "Response incomplete without a provider reason");
		const cancelled = await assertSame([{ type: "response.completed", response: { id: "resp_11", status: "cancelled", output: [] } }]);
		assert.equal(cancelled.output.stopReason, "error");
		assert.equal(cancelled.output.errorMessage, undefined);
	});

	it("response.failed and error events throw the same messages", async () => {
		const failed = await assertSame([
			{ type: "response.failed", response: { id: "resp_12", status: "failed", error: { code: "server_error", message: "boom" } } },
		]);
		assert.equal(failed.error, "server_error: boom");
		const failedDetails = await assertSame([
			{ type: "response.failed", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } },
		]);
		assert.equal(failedDetails.error, "incomplete: max_output_tokens");
		const errorEvent = await assertSame([{ type: "error", code: "rate_limit", message: "slow down" }]);
		assert.equal(errorEvent.error, "Error Code rate_limit: slow down");
	});

	it("stream ending before a terminal event throws, and onProviderStreamEvent sees every event", async () => {
		const eof = await assertSame([
			{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_e" } },
			{ type: "response.output_text.delta", output_index: 0, delta: "partial" },
		]);
		assert.equal(eof.error, "OpenAI Responses stream ended before a terminal response event");
		assert.equal(eof.seen.length, 2);
	});

	it("deltas for an unknown output index are ignored", async () => {
		const result = await assertSame([
			{ type: "response.output_text.delta", output_index: 4, delta: "lost" },
			{ type: "response.reasoning_summary_part.done", output_index: 4 },
			{ type: "response.completed", response: { id: "resp_13", status: "completed", output: [] } },
		]);
		assert.deepStrictEqual(result.events, []);
		assert.equal(result.output.content.length, 0);
	});

	it("no terminal usage keeps zero usage and a bare completed response is stop", async () => {
		const result = await assertSame([{ type: "response.completed", response: { id: "resp_14", status: "completed", output: [] } }]);
		assert.equal(result.output.stopReason, "stop");
		assert.equal(result.output.responseId, "resp_14");
		assert.equal(result.output.usage.totalTokens, 0);
	});

	it("usage with cache write and missing details matches cost calculation", async () => {
		const result = await assertSame([
			{ type: "response.completed", response: { id: "resp_15", status: "in_progress", usage: { input_tokens: 7, output_tokens: 2 }, output: [] } },
		]);
		assert.equal(result.output.stopReason, "stop");
		assert.equal(result.output.usage.input, 7);
		assert.equal(result.output.usage.reasoning, 0);
	});
});
