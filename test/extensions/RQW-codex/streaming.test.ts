// Deterministic tests for the live Responses pump and the completed-item handoff (extensions/RQW-codex/streaming.ts).
// Fake bounded producers, a real temporary Pi AgentSession with a fake provider (not the Codex index), no network, no auth homes.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { Api, AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream, Context, Model } from "@earendil-works/pi-ai";
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
	addUsage,
	BoundedAsyncQueue,
	completedContent,
	decidePartialHandoff,
	emptyUsage,
	LIVE_QUEUE_LIMIT,
	LiveResponsesPump,
	PARTIAL_HANDOFF_DIAGNOSTIC,
	PendingErrorGate,
	toPiUsage,
} from "../../../extensions/RQW-codex/streaming.ts";
import { CodexError, classifyEvent, normalizeUsage, type CodexUsage } from "../../../extensions/RQW-codex/errors.ts";
import { CODEX_RETRY_OWNED_DIAGNOSTIC } from "../../../extensions/RQW-codex/retry.ts";

type Native = Record<string, unknown>;

const MODEL = {
	id: "gpt-6-luna",
	name: "GPT-6-Luna",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100000,
	maxTokens: 8000,
} as unknown as Model<Api>;

let root: string;
before(async () => { root = await mkdtemp(join(tmpdir(), "rqw-codex-streaming-")); });
after(async () => { await rm(root, { recursive: true, force: true }); });

function withTimeout<T>(promise: Promise<T>, label: string, ms = 2000): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
	});
	return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** Consumes the outer stream from the start, recording every event in order. */
function observe(stream: AssistantMessageEventStream): { events: AssistantMessageEvent[]; done: Promise<void> } {
	const events: AssistantMessageEvent[] = [];
	const done = (async () => {
		for await (const event of stream) events.push(event);
	})();
	return { events, done };
}

const usageRaw = (input: number, cached: number, output: number, reasoning = 0) => ({
	input_tokens: input,
	output_tokens: output,
	total_tokens: input + output,
	input_tokens_details: { cached_tokens: cached },
	output_tokens_details: { reasoning_tokens: reasoning },
});

const created = (id = "resp_1"): Native => ({ type: "response.created", response: { id } });
const added = (outputIndex: number, item: Native): Native => ({ type: "response.output_item.added", output_index: outputIndex, item });
const done = (outputIndex: number, item: Native): Native => ({ type: "response.output_item.done", output_index: outputIndex, item });
const textDelta = (outputIndex: number, itemId: string, delta: string): Native => ({
	type: "response.output_text.delta", output_index: outputIndex, item_id: itemId, content_index: 0, delta,
});
const argsDelta = (outputIndex: number, itemId: string, delta: string): Native => ({
	type: "response.function_call_arguments.delta", output_index: outputIndex, item_id: itemId, delta,
});
const failed = (usage?: unknown): Native => ({ type: "response.failed", response: { id: "resp_1", status: "failed", ...(usage ? { usage } : {}) } });
const completed = (usage = usageRaw(10, 0, 5)): Native => ({ type: "response.completed", response: { id: "resp_1", status: "completed", usage, output: [] } });

const messageItem = (id: string, text: string, phase = "final_answer"): Native => ({
	type: "message", id, role: "assistant", phase, status: "completed", content: [{ type: "output_text", text, annotations: [] }],
});
const callItem = (id: string, callId: string, args: string): Native => ({
	type: "function_call", id, call_id: callId, name: "count", arguments: args, status: "completed",
});
const reasoningItem = (id: string): Native => ({ type: "reasoning", id, summary: [], encrypted_content: "ENC+/==opaque" });

function pumpFor(stream = createAssistantMessageEventStream(), queueLimit?: number) {
	return { stream, pump: new LiveResponsesPump({ model: MODEL, stream, ...(queueLimit ? { queueLimit } : {}) }) };
}

function countTypes(events: AssistantMessageEvent[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
	return counts;
}

function assertBalanced(events: AssistantMessageEvent[]): void {
	const counts = countTypes(events);
	for (const kind of ["text", "thinking", "toolcall"]) {
		assert.equal(counts[`${kind}_start`] ?? 0, counts[`${kind}_end`] ?? 0, `${kind} start/end balanced`);
	}
	const terminals = events.filter((e) => e.type === "done" || e.type === "error");
	assert.equal(terminals.length, 1, "exactly one outer terminal");
	assert.equal(events[events.length - 1], terminals[0], "terminal is last");
}

describe("BoundedAsyncQueue", () => {
	it("holds at most its limit, resumes producers as the consumer takes items, and cancel leaks nothing", async () => {
		const queue = new BoundedAsyncQueue<number>(2);
		await queue.push(1);
		await queue.push(2);
		let third = false;
		const pending = queue.push(3).then(() => { third = true; });
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(third, false, "third push waits at the limit");
		assert.equal(queue.size, 2);
		const iterator = queue[Symbol.asyncIterator]();
		assert.equal((await iterator.next()).value, 1);
		await withTimeout(pending, "producer resumes");
		assert.equal(third, true);
		assert.equal(queue.size, 2);

		const cancelled = new BoundedAsyncQueue<number>(1);
		await cancelled.push(1);
		const blocked = cancelled.push(2);
		cancelled.cancel(new Error("stop"));
		await assert.rejects(blocked, /event queue closed/);
		assert.equal(cancelled.size, 0, "cancel drops queued items");
		await assert.rejects(cancelled[Symbol.asyncIterator]().next(), /stop/);
	});

	it("uses the 128-event default bound of the pump queue", () => {
		assert.equal(LIVE_QUEUE_LIMIT, 128);
		assert.throws(() => new BoundedAsyncQueue(0), RangeError);
	});
});

describe("LiveResponsesPump live delivery", () => {
	it("the first text delta reaches the stream before the upstream completion is released", async () => {
		const { stream, pump } = pumpFor();
		const seen: string[] = [];
		let resolveFirstDelta: () => void = () => {};
		const firstDelta = new Promise<void>((resolve) => { resolveFirstDelta = resolve; });
		const consumer = (async () => {
			for await (const event of stream) {
				seen.push(event.type);
				if (event.type === "text_delta") resolveFirstDelta();
				if (event.type === "done" || event.type === "error") break;
			}
		})();

		const upstream = (async () => {
			await pump.push(created());
			await pump.push(added(0, messageItem("msg_1", "")));
			await pump.push(textDelta(0, "msg_1", "Hel"));
			// Fake bounded producer: the completion is released only after the consumer observed the delta.
			await withTimeout(firstDelta, "first delta observed while upstream still open");
			seen.push("upstream-completion-released");
			await pump.push(done(0, messageItem("msg_1", "Hello")));
			await pump.push(completed());
			await pump.finish({ reason: "stop" });
		})();

		await withTimeout(upstream, "upstream");
		await withTimeout(consumer, "consumer");
		const deltaAt = seen.indexOf("text_delta");
		assert.ok(deltaAt >= 0 && deltaAt < seen.indexOf("upstream-completion-released"), "delta before release");
		assert.equal(pump.output.content[0]?.type, "text");
		assert.equal((pump.output.content[0] as { text: string }).text, "Hello");
	});

	it("a full queue backpressures the producer (push waits) and every event still arrives in order", async () => {
		const { stream, pump } = pumpFor(undefined, 4);
		const { events, done: drained } = observe(stream);
		await pump.push(created());
		await pump.push(added(0, messageItem("msg_1", "")));
		for (let i = 0; i < 40; i++) await pump.push(textDelta(0, "msg_1", "x"));
		await pump.push(done(0, messageItem("msg_1", "x".repeat(40))));
		await pump.push(completed());
		await pump.finish({ reason: "stop" });
		await withTimeout(drained, "drain");
		assert.equal(events.filter((e) => e.type === "text_delta").length, 40);
		assertBalanced(events);
	});

	it("after finish nothing else is pushed, and the outer terminal is pushed exactly once", async () => {
		const { stream, pump } = pumpFor();
		const { events, done: drained } = observe(stream);
		await pump.push(created());
		await pump.push(added(0, messageItem("msg_1", "")));
		await pump.push(textDelta(0, "msg_1", "Hi"));
		const first = await pump.finish({ reason: "aborted" });
		const again = await pump.finish({ reason: "stop" });
		assert.equal(again, first);
		await assert.rejects(pump.push(textDelta(0, "msg_1", "late")), /after finish/);
		await withTimeout(drained, "drain");
		assertBalanced(events);
		const terminal = events[events.length - 1] as { type: string; reason: string; error: AssistantMessage };
		assert.equal(terminal.type, "error");
		assert.equal(terminal.reason, "aborted");
		assert.equal(terminal.error.stopReason, "aborted");
		assert.equal(terminal.error.diagnostics, undefined, "cancel is not a retry-owned failure");
	});
});

describe("LiveResponsesPump ledger, retry boundary and duplicates", () => {
	it("keeps completed raw items exactly (arguments string, encrypted reasoning) and shows each completed item once across a retry", async () => {
		const { stream, pump } = pumpFor();
		const { events, done: drained } = observe(stream);

		await pump.push(created());
		await pump.push(added(0, callItem("fc_a", "call_a", '{"value":  "one"}')));
		await pump.push(done(0, callItem("fc_a", "call_a", '{"value":  "one"}')));
		await pump.push(added(1, reasoningItem("rs_1")));
		await pump.push(done(1, reasoningItem("rs_1")));
		await pump.push(added(2, callItem("fc_open", "call_open", "")));
		await pump.push(argsDelta(2, "fc_open", '{"val'));
		await pump.push(failed(usageRaw(100, 30, 20, 5)));
		await pump.retryBoundary();

		// Attempt 2 replays the completed items (same backend ids) and then completes the response.
		await pump.push(created("resp_2"));
		await pump.push(added(0, callItem("fc_a", "call_a", '{"value":  "one"}')));
		await pump.push(argsDelta(0, "fc_a", '{"value":  "one"}'));
		await pump.push(done(0, callItem("fc_a", "call_a", '{"value":  "one"}')));
		await pump.push(added(1, callItem("fc_b", "call_b", '{"value":"two"}')));
		await pump.push(done(1, callItem("fc_b", "call_b", '{"value":"two"}')));
		await pump.push(completed());
		await pump.finish({ reason: "toolUse" });
		await withTimeout(drained, "drain");

		const starts = events.filter((e) => e.type === "toolcall_start");
		assert.equal(starts.length, 3, "fc_a once, fc_open once (dropped), fc_b once");
		assert.equal(pump.duplicateCount, 2, "fc_a replayed as added and done");
		assert.equal(pump.droppedToolCallCount, 1);
		assertBalanced(events);

		const raw = pump.completedRawItems as Native[];
		assert.deepEqual(raw.map((item) => item.id), ["fc_a", "rs_1", "fc_b"]);
		assert.equal(raw[0]?.arguments, '{"value":  "one"}', "arguments kept as the exact string");
		assert.equal(raw[1]?.encrypted_content, "ENC+/==opaque", "encrypted reasoning kept exactly");
	});

	it("an unfinished tool call is closed with a balanced dropped end event, is never completed and is not handed off", async () => {
		const { stream, pump } = pumpFor();
		const { events, done: drained } = observe(stream);
		await pump.push(created());
		await pump.push(added(0, callItem("fc_open", "call_open", "")));
		await pump.push(argsDelta(0, "fc_open", '{"va'));
		await pump.push(failed());
		await pump.retryBoundary();
		await pump.finish({ error: new CodexError({ kind: "stream" }) });
		await withTimeout(drained, "drain");

		assertBalanced(events);
		const end = events.find((e) => e.type === "toolcall_end") as { toolCall: { argumentsError?: string } } | undefined;
		assert.ok(end?.toolCall.argumentsError?.includes("never executed"));
		assert.equal(pump.completedRawItems.length, 0);
		assert.equal(pump.output.content.length, 0, "dropped block is not part of the final message");
	});

	it("text retry without completed calls is a plain retry decision; no completed items means nothing is handed off", () => {
		const decision = decidePartialHandoff({ completedItems: [], error: new CodexError({ kind: "stream" }), context: { api: MODEL.api, provider: MODEL.provider, model: MODEL.id } });
		assert.equal(decision.action, "retry");
	});
});

describe("decidePartialHandoff", () => {
	it("completed call and text hand off to Pi's tool loop with only those blocks, honest diagnostic and actual usage", async () => {
		const { pump } = pumpFor();
		await pump.push(created());
		await pump.push(added(0, messageItem("msg_1", "")));
		await pump.push(textDelta(0, "msg_1", "Let me count."));
		await pump.push(done(0, messageItem("msg_1", "Let me count.")));
		await pump.push(added(1, reasoningItem("rs_1")));
		await pump.push(done(1, reasoningItem("rs_1")));
		await pump.push(added(2, callItem("fc_a", "call_a", '{"value":"one"}')));
		await pump.push(done(2, callItem("fc_a", "call_a", '{"value":"one"}')));
		await pump.push(added(3, callItem("fc_open", "call_open", "")));
		await pump.push(argsDelta(3, "fc_open", '{"va'));
		await pump.push(failed(usageRaw(100, 30, 20, 5)));
		await pump.retryBoundary();

		const error = new CodexError({ kind: "stream_failed" });
		const decision = decidePartialHandoff({
			completedItems: pump.completedRawItems,
			error,
			context: { api: MODEL.api, provider: MODEL.provider, model: MODEL.id, usage: pump.usage },
			unfinishedToolCalls: pump.droppedToolCallCount,
			now: 1000,
		});
		assert.equal(decision.action, "tool_handoff");
		if (decision.action !== "tool_handoff") return;
		assert.equal(decision.pendingError, undefined, "retryable failure: no pending error");
		const message = decision.message;
		assert.equal(message.stopReason, "toolUse");
		assert.deepEqual(message.content.map((b) => b.type), ["text", "toolCall"]);
		assert.equal((message.content[1] as { id: string }).id, "call_a|fc_a");
		assert.deepEqual((message.content[1] as { arguments: unknown }).arguments, { value: "one" });
		assert.deepEqual(message.usage, { input: 70, output: 20, cacheRead: 30, cacheWrite: 0, reasoning: 5, totalTokens: 120, cost: emptyUsage().cost });
		assert.equal(message.diagnostics?.[0]?.type, PARTIAL_HANDOFF_DIAGNOSTIC);
		assert.deepEqual(message.diagnostics?.[0]?.details, {
			errorKind: "stream_failed", completedCalls: 1, completedText: 1, unfinishedToolCalls: 1, pendingError: false,
		});
		assert.equal(message.diagnostics?.some((d) => d.type === CODEX_RETRY_OWNED_DIAGNOSTIC), false, "not an error message");
		assert.equal(message.content.some((b) => b.type === "thinking"), false);
	});

	it("a terminal quota error after a completed call yields a handoff with a pending error that is surfaced once, with no request", () => {
		const quota = classifyEvent({ type: "response.failed", response: { status: "failed", error: { code: "insufficient_quota", message: "no" } } });
		assert.ok(quota, "quota classified");
		assert.equal(quota.retryable, false);
		const decision = decidePartialHandoff({
			completedItems: [callItem("fc_a", "call_a", '{"value":"one"}')],
			error: quota,
			context: { api: MODEL.api, provider: MODEL.provider, model: MODEL.id },
		});
		assert.equal(decision.action, "tool_handoff");
		if (decision.action !== "tool_handoff") return;
		assert.equal(decision.pendingError, quota);
		const gate = new PendingErrorGate(decision.pendingError);
		assert.equal(gate.takeBeforeRequest(), quota, "surfaced before any request");
		assert.equal(gate.takeBeforeRequest(), undefined, "surfaced once");
	});

	it("no completed call and not retryable is a final failure: completed text kept, retry-owned marker, usage kept", () => {
		const usage = normalizeForTest({ input_tokens: 9, output_tokens: 3, total_tokens: 12 });
		const error = new CodexError({ kind: "usage_limit_reached", usage });
		const decision = decidePartialHandoff({
			completedItems: [messageItem("msg_1", "partial answer")],
			error,
			context: { api: MODEL.api, provider: MODEL.provider, model: MODEL.id, timestamp: 5 },
		});
		assert.equal(decision.action, "fail");
		if (decision.action !== "fail") return;
		assert.equal(decision.message.stopReason, "error");
		assert.equal(decision.message.errorMessage, error.message);
		assert.deepEqual(decision.message.content, [{ type: "text", text: "partial answer", textSignature: '{"v":1,"id":"msg_1","phase":"final_answer"}' }]);
		assert.deepEqual(decision.message.diagnostics, [{ type: CODEX_RETRY_OWNED_DIAGNOSTIC, timestamp: 5 }]);
		assert.equal(decision.message.usage.totalTokens, 12, "usage of the failed attempt kept, not estimated");
	});

	it("malformed completed tool JSON stays visible as argumentsError instead of silent {}", () => {
		const [block] = completedContent([callItem("fc_bad", "call_bad", '{"a":')]);
		assert.equal(block?.type, "toolCall");
		assert.ok((block as { argumentsError?: string }).argumentsError, "argumentsError set");
	});

	it("usage helpers sum actual attempts without estimates", () => {
		const a = toPiUsage(normalizeForTest(usageRaw(10, 4, 2)));
		const sum = addUsage(a, a);
		assert.equal(sum.input, 12);
		assert.equal(sum.cacheRead, 8);
		assert.equal(sum.totalTokens, 24);
		assert.equal(sum.cost.total, 0);
	});
});

describe("LiveResponsesPump control events", () => {
	it("response.failed is control, not display: no error text is displayed, the classified error terminal carries usage and retry-owned marker", async () => {
		const { stream, pump } = pumpFor();
		const { events, done: drained } = observe(stream);
		await pump.push(created());
		await pump.push(failed(usageRaw(50, 0, 7)));
		await pump.retryBoundary();
		await pump.finish({ error: new CodexError({ kind: "rate_limit_exceeded", usage: normalizeForTest(usageRaw(50, 0, 7)) }) });
		await withTimeout(drained, "drain");
		assertBalanced(events);
		const terminal = events[events.length - 1] as { error: AssistantMessage };
		assert.equal(terminal.error.usage.totalTokens, 57);
		assert.equal(terminal.error.diagnostics?.[0]?.type, CODEX_RETRY_OWNED_DIAGNOSTIC);
		assert.equal(events.some((e) => e.type === "text_start"), false);
	});

	it("an event after a failed terminal in the same attempt is rejected, not silently displayed", async () => {
		const { pump } = pumpFor();
		await pump.push(created());
		await pump.push(failed());
		await assert.rejects(pump.push(textDelta(0, "msg_1", "late")), /after failed terminal/);
		await pump.finish({ error: new CodexError({ kind: "stream" }) });
	});
});

// ---- real AgentSession with a fake provider that uses the pump and the handoff helper ----------------------------

function normalizeForTest(raw: Record<string, unknown>): CodexUsage | undefined {
	return normalizeUsage(raw);
}

describe("tool handoff inside a real Pi AgentSession", () => {
	it("completed call runs exactly once in Pi's tool loop, unfinished call never runs, recovered request pairs call and output", async () => {
		const dir = join(root, "session-handoff");
		await mkdir(dir, { recursive: true });
		const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
		await writeFile(join(dir, "auth.json"), "{}");

		let toolRuns: string[] = [];
		const requests: Context[] = [];
		const requestInputs: unknown[][] = [];
		const providerApi = "rqw-live-handoff-api";
		const providerName = "rqw-live-handoff";
		let call = 0;

		const streamSimple = (model: Model<Api>, context: Context): AssistantMessageEventStream => {
			call++;
			const current = call;
			requests.push(context);
			const stream = createAssistantMessageEventStream();
			(async () => {
				const pump = new LiveResponsesPump({ model, stream });
				try {
					if (current === 1) {
						await pump.push(created("resp_a"));
						await pump.push(added(0, callItem("fc_done", "call_done", '{"value":"one"}')));
						await pump.push(done(0, callItem("fc_done", "call_done", '{"value":"one"}')));
						await pump.push(added(1, callItem("fc_open", "call_open", "")));
						await pump.push(argsDelta(1, "fc_open", '{"val'));
						await pump.push(failed(usageRaw(40, 0, 8)));
						await pump.retryBoundary();
						const decision = decidePartialHandoff({
							completedItems: pump.completedRawItems,
							error: new CodexError({ kind: "stream_failed", usage: normalizeForTest(usageRaw(40, 0, 8)) }),
							context: { api: model.api, provider: model.provider, model: model.id, usage: pump.usage },
							unfinishedToolCalls: pump.droppedToolCallCount,
						});
						if (decision.action !== "tool_handoff") throw new Error(`unexpected ${decision.action}`);
						await pump.finish({ handoff: decision.message });
					} else {
						requestInputs.push(convertResponsesMessages(model, context, new Set([model.provider])) as unknown[]);
						await pump.push(created("resp_b"));
						await pump.push(added(0, messageItem("msg_final", "")));
						await pump.push(textDelta(0, "msg_final", "Counted once."));
						await pump.push(done(0, messageItem("msg_final", "Counted once.")));
						await pump.push(completed());
						await pump.finish({ reason: "stop" });
					}
				} catch (error) {
					await pump.finish({ error });
				}
			})();
			return stream;
		};

		const count: ToolDefinition = {
			name: "count",
			label: "count",
			description: "Counts one item.",
			parameters: Type.Object({ value: Type.String() }),
			async execute(_id, args) {
				toolRuns.push(args.value);
				return { content: [{ type: "text", text: `counted ${args.value}` }], details: {} };
			},
		} as unknown as ToolDefinition;

		runtime.registerProvider(providerName, {
			api: providerApi,
			apiKey: "test-key",
			baseUrl: "https://fake.invalid", // never requested: streamSimple below is local
			streamSimple: streamSimple as never,
			models: [{ id: "live", name: "Live", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100000, maxTokens: 8000 }] as never,
		});
		const model = runtime.getModel(providerName, "live");
		assert.ok(model, "fake model registered");

		const { session } = await createAgentSession({
			cwd: dir, agentDir: dir, modelRuntime: runtime, model, thinkingLevel: "off",
			customTools: [count], sessionManager: SessionManager.inMemory(dir),
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
		});
		try {
			await session.prompt("count the items");
		} finally {
			session.dispose();
		}

		assert.equal(call, 2, "exactly one recovered backend request after the handoff");
		assert.deepEqual(toolRuns, ["one"], "completed call ran once, unfinished call never ran");
		const inputs = requestInputs[0] as Array<Record<string, unknown>>;
		const calls = inputs.filter((i) => i.type === "function_call").map((i) => i.call_id);
		const outputs = inputs.filter((i) => i.type === "function_call_output").map((i) => i.call_id);
		assert.deepEqual(calls, ["call_done"]);
		assert.deepEqual(outputs, ["call_done"], "every function_call has its output, no call without output");
		assert.equal(JSON.stringify(inputs).includes("call_open"), false, "unfinished call absent from the recovered request");
		assert.ok(requests[1]!.messages.some((m) => m.role === "toolResult"), "Pi appended the tool result");
	});
});

// ---- text signature (Pi textSignature port) and response.incomplete classification ---------------------------------

const incomplete = (reason: string, usage?: unknown): Native => ({
	type: "response.incomplete",
	response: { id: "resp_1", status: "incomplete", incomplete_details: { reason }, output: [], ...(usage ? { usage } : {}) },
});

describe("completed text items carry a Pi-compatible textSignature", () => {
	it("serializes id and phase to the literal Pi v1 signature", () => {
		const items = completedContent([messageItem("msg_1", "Hi", "commentary")]);
		assert.deepEqual(items, [{ type: "text", text: "Hi", textSignature: '{"v":1,"id":"msg_1","phase":"commentary"}' }]);
	});

	it("omits phase when the item has none", () => {
		const items = completedContent([{ type: "message", id: "msg_2", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Yo", annotations: [] }] }]);
		assert.deepEqual(items, [{ type: "text", text: "Yo", textSignature: '{"v":1,"id":"msg_2"}' }]);
	});

	it("survives Pi's own replay: convertResponsesMessages gives the same message id and phase back", () => {
		const [block] = completedContent([messageItem("msg_1", "Hi", "commentary")]);
		const context = {
			messages: [
				{ role: "user", content: "go", timestamp: 0 },
				{
					role: "assistant",
					content: [block],
					api: MODEL.api,
					provider: MODEL.provider,
					model: MODEL.id,
					usage: emptyUsage(),
					stopReason: "toolUse",
					timestamp: 0,
				},
			],
		} as unknown as Context;
		const input = convertResponsesMessages(MODEL, context, new Set([MODEL.provider])) as Native[];
		const replayed = input.find((item) => item.type === "message" && item.role === "assistant");
		assert.equal(replayed?.id, "msg_1");
		assert.equal(replayed?.phase, "commentary");
	});
});

describe("LiveResponsesPump response.incomplete", () => {
	it("content_filter is a typed retryable error with the actual usage; one error terminal, no done", async () => {
		const { stream, pump } = pumpFor();
		const { events, done: drained } = observe(stream);
		await pump.push(created());
		await pump.push(incomplete("content_filter", usageRaw(30, 0, 4)));
		assert.ok(pump.failure instanceof CodexError);
		assert.equal(pump.failure.kind, "content_filter");
		assert.equal(pump.failure.retryable, true);
		assert.equal(pump.failure.usage?.totalTokens, 34);
		assert.equal(pump.endTurn, undefined);
		const message = await pump.finish();
		await withTimeout(drained, "drain");
		assertBalanced(events);
		assert.equal(events.some((e) => e.type === "done"), false);
		assert.equal(message.stopReason, "error");
		assert.equal(message.usage.totalTokens, 34);
		assert.equal(message.diagnostics?.[0]?.type, CODEX_RETRY_OWNED_DIAGNOSTIC);
	});

	it("a non-interrupted reason is a terminal typed error (not retryable) with the response usage", async () => {
		const { stream, pump } = pumpFor();
		const { events, done: drained } = observe(stream);
		await pump.push(created());
		await pump.push(incomplete("max_tokens_custom", usageRaw(20, 0, 3)));
		assert.equal(pump.failure?.kind, "response_incomplete");
		assert.equal(pump.failure?.retryable, false);
		await pump.finish();
		await withTimeout(drained, "drain");
		assertBalanced(events);
		const terminal = events[events.length - 1] as { type: string; error: AssistantMessage };
		assert.equal(terminal.type, "error");
		assert.equal(terminal.error.usage.totalTokens, 23);
	});

	it("interrupted completes like a completed response with end_turn false, no error terminal", async () => {
		const { stream, pump } = pumpFor();
		const { events, done: drained } = observe(stream);
		await pump.push(created());
		await pump.push(added(0, messageItem("msg_1", "")));
		await pump.push(textDelta(0, "msg_1", "Partial"));
		await pump.push(done(0, messageItem("msg_1", "Partial")));
		await pump.push(incomplete("interrupted", usageRaw(10, 0, 5)));
		assert.equal(pump.failure, undefined);
		assert.equal(pump.endTurn, false);
		const message = await pump.finish();
		await withTimeout(drained, "drain");
		assertBalanced(events);
		const terminal = events[events.length - 1] as { type: string; reason: string };
		assert.equal(terminal.type, "done");
		assert.equal(terminal.reason, "stop");
		assert.equal(message.usage.totalTokens, 15);
		assert.deepEqual(message.content, [{ type: "text", text: "Partial", textSignature: '{"v":1,"id":"msg_1","phase":"final_answer"}' }]);
	});

	it("retryBoundary returns the typed failure, so the caller finishes once with it explicitly", async () => {
		const { stream, pump } = pumpFor();
		const { events, done: drained } = observe(stream);
		await pump.push(created());
		await pump.push(incomplete("content_filter", usageRaw(9, 0, 1)));
		const failure = await pump.retryBoundary();
		assert.ok(failure instanceof CodexError);
		assert.equal(failure.kind, "content_filter");
		await pump.finish({ error: failure });
		await withTimeout(drained, "drain");
		assertBalanced(events);
		assert.equal(events.filter((e) => e.type === "error").length, 1);
	});
});
