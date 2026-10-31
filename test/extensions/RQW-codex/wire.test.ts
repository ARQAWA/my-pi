import assert from "node:assert/strict";
import { it } from "node:test";
import type { Api, Context, Model, Tool } from "@earendil-works/pi-ai";
import { codexModelCapabilities } from "../../../extensions/RQW-codex/profile.ts";
import { buildRequest, type WireItem, type WireModelInfo, type WireOptions } from "../../../extensions/RQW-codex/wire.ts";

const STABLE: WireModelInfo = {
	slug: "gpt-test-sol",
	use_responses_lite: false,
	default_reasoning_level: "medium",
	supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
	supports_reasoning_summary_parameter: true,
	default_reasoning_summary: "auto",
	input_modalities: ["text"],
	supports_reasoning_effort_updates: true,
};
const LITE = { ...STABLE, use_responses_lite: true };
const model = { id: STABLE.slug, provider: "openai-codex", api: "openai-codex-responses", input: ["text"] } as unknown as Model<Api>;
const identity = { installationId: "00000000-0000-4000-8000-000000000001", windowId: "019e0000-0000-7000-8000-000000000002", rootSessionId: "root-session-fake", threadId: "thread-fake-1", turnId: "turn-1" } as never;
const TOOL: Tool = { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } } as Tool;
const context = (tools: Tool[]): Context => ({ systemPrompt: "SYSTEM", messages: [{ role: "user", content: "hello", timestamp: 1 }], tools });
const build = (tools: Tool[] = [TOOL], options?: WireOptions) => buildRequest({ model, context: context(tools), options, capabilities: LITE, identity }) as unknown as Record<string, unknown>;

it("serializes tools into the Lite additional_tools declaration", () => {
	const body = build();
	const first = (body.input as WireItem[])[0];
	assert.equal(first.type, "additional_tools");
	assert.deepEqual(first.tools, [{ type: "namespace", name: "functions", description: "", tools: [{ type: "function", name: "read", description: "Read a file", strict: false, parameters: TOOL.parameters }] }]);
	assert.equal("tools" in body, false);
});

it("lite model request with tools sends parallel_tool_calls true", () => {
	assert.equal(build().parallel_tool_calls, true);
	assert.equal(buildRequest({ model, context: context([TOOL]), capabilities: STABLE, identity }).parallel_tool_calls, true);
});

it("resolves model defaults and explicit efforts", () => {
	assert.equal(codexModelCapabilities("gpt-6.1-sol").defaultReasoningLevel, "low");
	assert.deepEqual(build().reasoning, { effort: "medium", summary: "auto", context: "all_turns" });
	assert.deepEqual(build([TOOL], { reasoningEffort: "high" }).reasoning, { effort: "high", summary: "auto", context: "all_turns" });
});

it("regression: numeric additional_tools keys hash in native lexicographic order", () => {
	const numeric = JSON.parse('{"name":"numeric","description":"","parameters":{"type":"object","properties":{"10":{"type":"string"},"2":{"type":"string"}}}}') as Tool;
	const body = build([numeric]);
	const first = (body.input as WireItem[])[0];
	assert.equal(first.id, "at_e192b5bf-1b2c-556b-9fca-358c9f2c4de7");
});
