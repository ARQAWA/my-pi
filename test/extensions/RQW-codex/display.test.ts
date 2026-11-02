import assert from "node:assert/strict";
import { it } from "node:test";
import type { Api, AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import { processResponsesStream } from "../../../extensions/RQW-codex/display.mjs";

type Event = Record<string, unknown> & { type: string };
const model = { cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Model<Api>;
const functionCall = (name: string, args = "") => ({ type: "function_call", id: `fc_${name}`, call_id: `call_${name}`, name, arguments: args });
const customCall = (name: string, input = "") => ({ type: "custom_tool_call", id: `ctc_${name}`, call_id: `call_${name}`, name, input });
const added = (index: number, item: object): Event => ({ type: "response.output_item.added", output_index: index, item });
const done = (index: number, item: object): Event => ({ type: "response.output_item.done", output_index: index, item });
const delta = (type: string, index: number, value: string): Event => ({ type, output_index: index, delta: value });
const completed: Event = { type: "response.completed", response: { id: "response", status: "completed", output: [] } };

function harness(events: Event[], options?: { grammarToolInputProperties: ReadonlyMap<string, string> }) {
	const output = {
		role: "assistant", content: [], stopReason: "stop", usage: {
			input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	} as unknown as AssistantMessage;
	const emitted: Array<Record<string, any>> = [];
	const stream = { push: (event: Record<string, any>) => emitted.push(structuredClone(event)) } as unknown as AssistantMessageEventStream;
	async function* source() { yield* events; }
	return { output, emitted, run: () => processResponsesStream(source(), output, stream, model, options) };
}

it("streams interleaved JSON calls independently and replaces final arguments", async () => {
	const h = harness([
		added(0, functionCall("first", '{"text":"a')),
		added(1, functionCall("second")),
		delta("response.function_call_arguments.delta", 1, '{"n":'),
		delta("response.function_call_arguments.delta", 0, '\n'),
		delta("response.function_call_arguments.delta", 1, '4}'),
		{ type: "response.function_call_arguments.done", output_index: 0, arguments: '{"text":"replaced"}' },
		done(1, functionCall("second", '{"n":4}')),
		done(0, functionCall("first", '{"text":"replaced"}')),
		completed,
	]);
	await h.run();
	assert.deepEqual(h.output.content, [
		{ type: "toolCall", id: "call_first|fc_first", name: "first", arguments: { text: "replaced" } },
		{ type: "toolCall", id: "call_second|fc_second", name: "second", arguments: { n: 4 } },
	]);
	const partial = h.emitted.find((e) => e.type === "toolcall_delta" && e.contentIndex === 0);
	assert.ok(partial);
	assert.equal(partial.partial.content[0].arguments.text, "a\n");
	assert.equal("partialJson" in partial.partial.content[0], false);
	assert.equal(h.output.stopReason, "toolUse");
});

it("emits the missing JSON suffix and preserves the tool namespace", async () => {
	const item = { ...functionCall("read"), namespace: "files" };
	const h = harness([
		added(0, item),
		delta("response.function_call_arguments.delta", 0, '{"path":'),
		{ type: "response.function_call_arguments.done", output_index: 0, arguments: '{"path":"x"}' },
		done(0, { ...item, arguments: '{"path":"x"}' }),
		completed,
	]);
	await h.run();
	const json = h.emitted.filter((e) => e.type === "toolcall_delta").map((e) => e.delta).join("");
	assert.deepEqual(JSON.parse(json), { path: "x" });
	assert.deepEqual(h.output.content[0], { type: "toolCall", id: "call_read|fc_read", name: "read", arguments: { path: "x" }, namespace: "files" });
});

it("streams initial grammar input and final suffix as escaped JSON", async () => {
	const item = customCall("write", 'a"');
	const h = harness([
		added(0, item),
		delta("response.custom_tool_call_input.delta", 0, "b\n"),
		{ type: "response.custom_tool_call_input.done", output_index: 0, input: 'a"b\nc' },
		done(0, customCall("write", 'a"b\nc')),
		completed,
	], { grammarToolInputProperties: new Map([["write", "code"]]) });
	await h.run();
	const json = h.emitted.filter((e) => e.type === "toolcall_delta").map((e) => e.delta).join("");
	assert.deepEqual(JSON.parse(json), { code: 'a"b\nc' });
	assert.deepEqual(h.output.content[0], { type: "toolCall", id: "call_write|ctc_write", name: "write", arguments: { code: 'a"b\nc' } });
});

it("closes grammar input from output_item.done when input.done is missing", async () => {
	const h = harness([added(0, customCall("write", "start")), done(0, customCall("write", "start end")), completed]);
	await h.run();
	const json = h.emitted.filter((e) => e.type === "toolcall_delta").map((e) => e.delta).join("");
	assert.deepEqual(JSON.parse(json), { input: "start end" });
});

it("rejects non-monotonic grammar completion", async () => {
	const h = harness([added(0, customCall("write", "start")), done(0, customCall("write", "changed")), completed]);
	await assert.rejects(h.run(), /changed non-monotonically/);
});

it("preserves malformed final JSON as an arguments error", async () => {
	const h = harness([added(0, functionCall("bad")), delta("response.function_call_arguments.delta", 0, '{"x":'), done(0, functionCall("bad", '{"x":')), completed]);
	await h.run();
	const call = h.output.content[0];
	assert.equal(call.type, "toolCall");
	if (call.type !== "toolCall") throw new Error("expected tool call");
	assert.deepEqual(call.arguments, {});
	assert.match(call.argumentsError ?? "", /Received arguments:\n\{"x":/);
});

it("rejects interrupted streams and calls missing output_item.done", async () => {
	const interrupted = harness([added(0, functionCall("cut")), delta("response.function_call_arguments.delta", 0, '{"x":1')]);
	await assert.rejects(interrupted.run(), /ended before a terminal response event/);
	const unfinished = harness([added(0, functionCall("cut")), completed]);
	await assert.rejects(unfinished.run(), /unfinished tool call: cut/);
	const mismatched = harness([added(0, functionCall("cut")), done(1, functionCall("other", "{}")), completed]);
	await assert.rejects(mismatched.run(), /unfinished tool call: cut/);
});
