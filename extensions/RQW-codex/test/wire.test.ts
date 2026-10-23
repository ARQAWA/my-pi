import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeContext } from "@earendil-works/pi-ai";
import type { Api, Context, Model, Tool } from "@earendil-works/pi-ai";
import { NAMESPACE_OID, uuidV5, type CodexIdentity } from "../metadata.ts";
import { readFileSync } from "node:fs";
import { additionalToolsItem, buildRequest, grammarToolInputProperties, prefixContext, sanitizeText, toolWireFlags, transcriptItems, validateFinalRequest, windowEffortPin, type WireModelInfo, type WireOptions, type WireItem } from "../wire.ts";

// Fake native ModelInfo records shaped like codex-rs protocol/src/openai_models.rs:408-498 fields.
const STABLE: WireModelInfo = {
	slug: "gpt-test-sol",
	use_responses_lite: false,
	default_reasoning_level: "medium",
	supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
	supports_reasoning_summary_parameter: true,
	default_reasoning_summary: "auto",
	support_verbosity: true,
	default_verbosity: "low",
	service_tiers: [{ id: "priority", name: "Fast", description: "fake" }],
	input_modalities: ["text", "image"],
	supports_reasoning_effort_updates: true,
};
const LITE: WireModelInfo = { ...STABLE, use_responses_lite: true };

const model = {
	id: "gpt-test-sol",
	name: "fake",
	api: "openai-codex-responses",
	provider: "openai-codex",
	input: ["text", "image"],
	reasoning: true,
	thinkingLevelMap: { high: "high", minimal: null },
} as unknown as Model<Api>;

const identity: CodexIdentity = {
	installationId: "00000000-0000-4000-8000-000000000001",
	windowId: "019e0000-0000-7000-8000-000000000002",
	rootSessionId: "root-session-fake",
	threadId: "thread-fake-1",
	turnId: "turn-1",
};

const TOOL: Tool = { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } as never };
const SYSTEM = "You are the fake assistant.";

function ctx(messages: Context["messages"], tools: Tool[] = [TOOL], systemPrompt: string | undefined = SYSTEM): Context {
	return { systemPrompt, messages, tools };
}

const USER = { role: "user" as const, content: "hello", timestamp: 1 };

function build(overrides: { context?: Context; options?: WireOptions; capabilities?: WireModelInfo; history?: Parameters<typeof buildRequest>[0]["history"]; kind?: "turn" | "prewarm" | "compaction" | "memory" } = {}) {
	return buildRequest({
		model,
		context: overrides.context ?? ctx([USER]),
		options: overrides.options,
		capabilities: overrides.capabilities ?? STABLE,
		identity,
		history: overrides.history,
		requestKind: overrides.kind,
	});
}

const threadNs = uuidV5(NAMESPACE_OID, identity.threadId);

describe("stable non-Lite request", () => {
	it("matches the native top-level shape and order, with no instructions, temperature or caps", () => {
		const body = build() as unknown as Record<string, unknown>;
		assert.deepEqual(Object.keys(body), ["model", "stream", "input", "tools", "tool_choice", "parallel_tool_calls", "reasoning", "store", "include", "prompt_cache_key", "text", "client_metadata"]);
		assert.equal(body.model, "gpt-test-sol");
		assert.equal(body.stream, true);
		assert.equal(body.store, false);
		assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
		assert.equal(body.tool_choice, "auto");
		assert.equal(body.parallel_tool_calls, true);
		assert.equal(body.instructions, undefined);
		assert.equal(body.temperature, undefined);
		assert.equal(body.max_output_tokens, undefined);
		assert.equal(body.service_tier, undefined);
	});

	it("puts the base prompt first as a developer item with a payload-derived UUIDv5 id", () => {
		const input = (build().input) as WireItem[];
		assert.deepEqual(input[0], {
			type: "message",
			id: `msg_${uuidV5(threadNs, SYSTEM)}`,
			role: "developer",
			content: [{ type: "input_text", text: SYSTEM }],
			internal_chat_message_metadata_passthrough: { content_item_kinds: ["model.base_instructions"] },
		});
		assert.equal(input[1].role, "user");
		assert.deepEqual(input[1].content, [{ type: "input_text", text: "hello" }]);
	});

	it("keeps top-level function tools with exact native field order and strict false", () => {
		const body = build() as unknown as { tools: unknown[] };
		assert.deepEqual(body.tools, [{ type: "function", name: "read", description: "Read a file", strict: false, parameters: TOOL.parameters }]);
	});

	it("sends an explicit top-level empty tools array when Pi has no tools", () => {
		const body = build({ context: ctx([USER], []) }) as unknown as Record<string, unknown>;
		assert.deepEqual(body.tools, []);
		assert.ok("tools" in body);
	});

	it("resolves default effort and summary from the native record", () => {
		const body = build() as unknown as { reasoning: unknown };
		assert.deepEqual(body.reasoning, { effort: "medium", summary: "auto" });
	});

	it("omits the summary when the native default is none", () => {
		const body = build({ capabilities: { ...STABLE, default_reasoning_summary: "none" } }) as unknown as { reasoning: unknown };
		assert.deepEqual(body.reasoning, { effort: "medium" });
	});

	it("sends verbosity only when the model supports it", () => {
		assert.deepEqual((build() as unknown as { text: unknown }).text, { verbosity: "low" });
		const body = build({ capabilities: { ...STABLE, support_verbosity: false } }) as unknown as Record<string, unknown>;
		assert.equal(body.text, undefined);
	});

	it("is deterministic: the same inputs give the same bytes and IDs", () => {
		assert.equal(JSON.stringify(build()), JSON.stringify(build()));
	});

	it("rejects a Pi model whose id is not the native slug", () => {
		assert.throws(() => buildRequest({ model: { ...model, id: "other" } as Model<Api>, context: ctx([USER]), capabilities: STABLE, identity }), /does not match/);
	});
});

describe("reasoning effort resolution", () => {
	it("treats explicit native effort and simple thinking as the same request when equal", () => {
		const native = build({ options: { reasoningEffort: "high" } }) as unknown as { reasoning: unknown };
		const simple = build({ options: { reasoning: "high" } }) as unknown as { reasoning: unknown };
		assert.deepEqual(native.reasoning, { effort: "high", summary: "auto" });
		assert.deepEqual(simple.reasoning, native.reasoning);
	});

	it("rejects conflicting native and simple effort instead of choosing one silently", () => {
		assert.throws(() => build({ options: { reasoningEffort: "low", reasoning: "high" } }), /disagree/);
	});

	it("maps off to none and refuses a level the model marks unsupported", () => {
		const none = { ...STABLE, supported_reasoning_levels: [...(STABLE.supported_reasoning_levels ?? []), { effort: "none" }] };
		const off = build({ options: { reasoning: "off" }, capabilities: none }) as unknown as { reasoning: { effort: string } };
		assert.equal(off.reasoning.effort, "none");
		assert.throws(() => build({ options: { reasoning: "minimal" } }), /unsupported/);
	});

	it("refuses an effort absent from the native supported list when explicitly requested", () => {
		assert.throws(() => build({ options: { reasoningEffort: "xhigh" } }), /not supported/);
	});

	it("keeps configuration_update off by default even when the model supports updates", () => {
		const history = { effortPin: "low" };
		const body = build({ history, options: { reasoningEffort: "high" } }) as unknown as { input: WireItem[] };
		assert.equal(body.input.some((i) => i.type === "configuration_update"), false);
	});

	it("appends one configuration_update at the tail when the feature is on and the effort differs from the pin", () => {
		const history = { effortPin: "low" };
		const on = build({ history, options: { reasoningEffort: "high", reasoningEffortOverride: true } }) as unknown as { input: WireItem[] };
		assert.deepEqual(on.input.at(-1), { type: "configuration_update", reasoning: { effort: "high" } });
		const same = build({ history: { effortPin: "high" }, options: { reasoningEffort: "high", reasoningEffortOverride: true } }) as unknown as { input: WireItem[] };
		assert.equal(same.input.some((i) => i.type === "configuration_update"), false);
	});
});

describe("Responses Lite request", () => {
	it("puts additional_tools first with a functions namespace and omits top-level tools", () => {
		const body = build({ capabilities: LITE }) as unknown as Record<string, unknown> & { input: WireItem[]; reasoning: unknown; parallel_tool_calls: boolean };
		const expectedTools = [{ type: "namespace", name: "functions", description: "", tools: [{ type: "function", name: "read", description: "Read a file", strict: false, parameters: TOOL.parameters }] }];
		assert.equal(body.input[0].type, "additional_tools");
		assert.equal(body.input[0].role, "developer");
		assert.deepEqual(body.input[0].tools, expectedTools);
		// Golden: native tools are serde_json Values (BTreeMap key order), so the ID is over the recursively key-sorted compact
		// serialization; value computed independently with Python's uuid5 (json sort_keys, separators (",", ":")).
		assert.equal(body.input[0].id, "at_3ad30552-a401-5639-83e4-97552344a959");
		assert.equal(body.input[1].id, `msg_${uuidV5(threadNs, SYSTEM)}`);
		assert.equal(body.tools, undefined);
		assert.equal("tools" in body, false);
		assert.equal(body.parallel_tool_calls, false);
		assert.deepEqual(body.reasoning, { effort: "medium", summary: "auto", context: "all_turns" });
	});

	it("emits the canonical key order in the additional_tools declaration with every member kept, whatever the Pi schema order", () => {
		const shuffled: Tool = { name: "read", description: "Read a file", parameters: { required: ["path"], properties: { path: { type: "string" } }, type: "object" } as never };
		const body = build({ capabilities: LITE, context: ctx([USER], [shuffled]) }) as unknown as { input: WireItem[] };
		assert.equal(JSON.stringify(body.input[0].tools), '[{"description":"","name":"functions","tools":[{"description":"Read a file","name":"read","parameters":{"properties":{"path":{"type":"string"}},"required":["path"],"type":"object"},"strict":false,"type":"function"}],"type":"namespace"}]');
		assert.equal(body.input[0].id, "at_3ad30552-a401-5639-83e4-97552344a959");
	});

	it("canonicalizes the non-Lite top-level tools recursively and keeps every member", () => {
		const shuffled: Tool = { name: "read", description: "Read a file", parameters: { required: ["path"], properties: { path: { type: "string" } }, type: "object" } as never };
		const body = build({ context: ctx([USER], [shuffled]) }) as unknown as { tools: unknown[] };
		assert.equal(JSON.stringify(body.tools), '[{"description":"Read a file","name":"read","parameters":{"properties":{"path":{"type":"string"}},"required":["path"],"type":"object"},"strict":false,"type":"function"}]');
	});

	it("emits no additional_tools and no tools when Pi has no tools", () => {
		const body = build({ capabilities: LITE, context: ctx([USER], []) }) as unknown as { input: WireItem[] };
		assert.equal(body.input.some((i) => i.type === "additional_tools"), false);
		assert.equal("tools" in body, false);
	});
});

describe("service tier and final validation", () => {
	it("maps Pi fast to native priority only when the record advertises it", () => {
		const body = build({ options: { serviceTier: "fast" } }) as unknown as Record<string, unknown>;
		assert.equal(body.service_tier, "priority");
		assert.throws(() => build({ options: { serviceTier: "fast" }, capabilities: { ...STABLE, service_tiers: [] } }), /not advertised/);
	});

	it("keeps flex without catalog support and drops only the explicit default tier", () => {
		assert.equal((build({ options: { serviceTier: "flex" } }) as unknown as { service_tier: string }).service_tier, "flex");
		assert.equal((build({ options: { serviceTier: "default" } }) as unknown as Record<string, unknown>).service_tier, undefined);
	});

	it("accepts a valid body and rejects a hook that erases Fast priority instead of silently sending without it", () => {
		const body = build({ options: { serviceTier: "fast" } }) as unknown as Record<string, unknown>;
		validateFinalRequest({ body, capabilities: STABLE, expectedServiceTier: "priority" });
		const erased = { ...body };
		delete erased.service_tier;
		assert.throws(() => validateFinalRequest({ body: erased, capabilities: STABLE, expectedServiceTier: "priority" }), /changed or removed/);
	});

	it("rejects fields that are not native Codex request fields, such as top-level instructions", () => {
		const body = { ...(build() as unknown as Record<string, unknown>), instructions: "x" };
		assert.throws(() => validateFinalRequest({ body, capabilities: STABLE }), /not a native Codex field/);
		const temp = { ...(build() as unknown as Record<string, unknown>), temperature: 0.2 };
		assert.throws(() => validateFinalRequest({ body: temp, capabilities: STABLE }), /temperature/);
	});
});

describe("transcript conversion", () => {
	it("preserves image parts as data URLs with native detail auto", () => {
		const body = build({ context: ctx([{ role: "user", content: [{ type: "text", text: "see" }, { type: "image", mimeType: "image/png", data: "AAAA" }], timestamp: 1 }]) }) as unknown as { input: WireItem[] };
		assert.deepEqual(body.input[1].content, [
			{ type: "input_text", text: "see" },
			{ type: "input_image", detail: "auto", image_url: "data:image/png;base64,AAAA" },
		]);
	});

	it("replays reconstructed function arguments as JSON text and keeps the call id split", () => {
		const assistant = {
			role: "assistant" as const,
			content: [{ type: "toolCall" as const, id: "call_1|fc_item_1", name: "read", arguments: { path: "a" } }],
			api: "openai-codex-responses", provider: "openai-codex", model: "gpt-test-sol", usage: {} as never, stopReason: "toolUse" as const, timestamp: 2,
		};
		const result = { role: "toolResult" as const, toolCallId: "call_1|fc_item_1", toolName: "read", content: [{ type: "text" as const, text: "ok" }], isError: false, timestamp: 3 };
		const input = (build({ context: ctx([USER, assistant as never, result as never]) }) as unknown as { input: WireItem[] }).input;
		assert.deepEqual(input[2], { type: "function_call", id: "fc_item_1", call_id: "call_1", name: "read", arguments: "{\"path\":\"a\"}" });
		assert.deepEqual(input[3], { type: "function_call_output", call_id: "call_1", output: "ok" });
	});

	it("uses raw backend output items verbatim in place of reconstructed ones when provenance is supplied", () => {
		const raw: WireItem[] = [
			{ type: "reasoning", id: "rs_1", summary: [], encrypted_content: "enc-fake" },
			{ type: "function_call", id: "fc_raw", call_id: "call_raw", name: "read", arguments: "{ \"path\":  \"a\" }" },
		];
		const assistant = {
			role: "assistant" as const,
			responseId: "resp-fake-1",
			content: [{ type: "toolCall" as const, id: "call_raw", name: "read", arguments: { path: "a" } }],
			api: "openai-codex-responses", provider: "openai-codex", model: "gpt-test-sol", usage: {} as never, stopReason: "toolUse" as const, timestamp: 2,
		};
		const input = (build({ context: ctx([USER, assistant as never]), history: { rawOutputs: new Map([["resp-fake-1", raw]]) } }) as unknown as { input: WireItem[] }).input;
		assert.deepEqual(input.slice(2), raw);
		assert.equal((input[3] as { arguments: string }).arguments, "{ \"path\":  \"a\" }");
	});

	it("replays Pi thinking only when its signature is a native reasoning item", () => {
		const signature = JSON.stringify({ type: "reasoning", id: "rs_2", summary: [], encrypted_content: "enc-fake-2" });
		const assistant = {
			role: "assistant" as const,
			content: [{ type: "thinking" as const, thinking: "", thinkingSignature: signature }, { type: "thinking" as const, thinking: "x", thinkingSignature: "not json" }, { type: "text" as const, text: "answer" }],
			api: "openai-codex-responses", provider: "openai-codex", model: "gpt-test-sol", usage: {} as never, stopReason: "stop" as const, timestamp: 2,
		};
		const input = (build({ context: ctx([USER, assistant as never]) }) as unknown as { input: WireItem[] }).input;
		assert.deepEqual(input[2], { type: "reasoning", id: "rs_2", summary: [], encrypted_content: "enc-fake-2" });
		assert.deepEqual(input[3], { type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }], status: "completed" });
		assert.equal(input.length, 4);
	});

	it("replaces lone surrogates with U+FFFD so the body is valid UTF-8, and escapes client metadata to ASCII", () => {
		assert.equal(sanitizeText("a\uD800b"), "a\uFFFDb");
		assert.equal(sanitizeText("😀"), "😀");
		const body = build({ context: ctx([{ role: "user", content: "x\uDC00", timestamp: 1 }]) }) as unknown as { input: WireItem[] };
		assert.deepEqual(body.input[1].content, [{ type: "input_text", text: "x\uFFFD" }]);
		const blob = build({ kind: "turn", context: ctx([USER]) }) as unknown as { client_metadata: Record<string, string> };
		assert.ok(/^[\x00-\x7f]*$/.test(blob.client_metadata["x-codex-turn-metadata"]));
	});

	it("changes the base prompt ID when the prompt changes", () => {
		const a = (build().input as WireItem[])[0].id;
		const b = (build({ context: ctx([USER], [TOOL], "Other prompt") }).input as WireItem[])[0].id;
		assert.notEqual(a, b);
	});
});

describe("content item kinds", () => {
	it("is on by default: the base instruction carries model.base_instructions passthrough", () => {
		const base = (build().input as WireItem[])[0] as Record<string, unknown>;
		assert.deepEqual(base.internal_chat_message_metadata_passthrough, { content_item_kinds: ["model.base_instructions"] });
	});

	it("clears kinds from the base instruction and replayed items only when explicitly disabled", () => {
		const off = build({ options: { contentItemKindsEnabled: false } }).input as WireItem[];
		assert.equal("internal_chat_message_metadata_passthrough" in off[0], false);
		const raw: WireItem[] = [{ type: "message", id: "msg_raw", role: "assistant", content: [], internal_chat_message_metadata_passthrough: { content_item_kinds: ["x"], turn_id: "t" } }];
		const assistant = { role: "assistant" as const, responseId: "r1", content: [], api: "openai-codex-responses", provider: "openai-codex", model: "gpt-test-sol", usage: {} as never, stopReason: "stop" as const, timestamp: 2 };
		const input = build({ context: ctx([USER, assistant as never]), options: { contentItemKindsEnabled: false }, history: { rawOutputs: new Map([["r1", raw]]) } }).input as WireItem[];
		assert.deepEqual(input[2], { type: "message", id: "msg_raw", role: "assistant", content: [], internal_chat_message_metadata_passthrough: { turn_id: "t" } });
		const kept = build({ context: ctx([USER, assistant as never]), history: { rawOutputs: new Map([["r1", raw]]) } }).input as WireItem[];
		assert.deepEqual(kept[2], raw[0]);
	});
});

describe("tool changes", () => {
	const EXTRA: Tool = { name: "grep", description: "Search", parameters: { type: "object", properties: {} } as never };
	const SYS_CHANGE = (extra: Partial<{ toolsAdded: Tool[]; toolsRemoved: { name: string }[] }>) => ({ role: "system" as const, content: "", timestamp: 2, ...extra });

	it("stable: later additions and removals are replayed into the top-level tool list", () => {
		const body = build({ context: ctx([USER, SYS_CHANGE({ toolsAdded: [EXTRA], toolsRemoved: [{ name: "read" }] }) as never]) }) as unknown as { tools: { name: string }[]; input: WireItem[] };
		assert.deepEqual(body.tools.map((t) => t.name), ["grep"]);
		assert.equal(body.input.some((i) => i.type === "additional_tools"), false);
	});

	it("lite with incremental_tools on: a later addition becomes an incremental additional_tools item at its position, with the native hint", () => {
		const body = build({ capabilities: LITE, options: { incrementalTools: true }, context: ctx([USER, SYS_CHANGE({ toolsAdded: [EXTRA] }) as never]) }) as unknown as { input: WireItem[] };
		const at = body.input.findIndex((i) => i.type === "additional_tools" && i.id === undefined);
		assert.ok(at > 0);
		assert.deepEqual(body.input[at], {
			type: "additional_tools",
			role: "developer",
			tools: [{ type: "namespace", name: "functions", description: "", tools: [{ type: "function", name: "grep", description: "Search", strict: false, parameters: EXTRA.parameters }] }],
		});
		assert.equal(body.input[at - 1].type, "message");
		assert.deepEqual((body.input[at - 1] as Record<string, unknown>).internal_chat_message_metadata_passthrough, { content_item_kinds: ["tools.incremental_update"] });
	});

	it("lite with incremental_tools on: a later removal is announced by the native removal notice naming the qualified member", () => {
		const body = build({ capabilities: LITE, options: { incrementalTools: true }, context: ctx([USER, SYS_CHANGE({ toolsRemoved: [{ name: "read" }] }) as never], [TOOL, EXTRA]) }) as unknown as { input: WireItem[] };
		const notice = body.input.at(-1) as Record<string, unknown>;
		assert.deepEqual(notice.content, [{ type: "input_text", text: "The following tools are no longer available. Do not call them:\n- functions.read" }]);
		assert.deepEqual(notice.internal_chat_message_metadata_passthrough, { content_item_kinds: ["tools.removed_definition"] });
	});

	it("lite with incremental_tools on: removing the last tool announces the namespace, not its members", () => {
		const body = build({ capabilities: LITE, options: { incrementalTools: true }, context: ctx([USER, SYS_CHANGE({ toolsRemoved: [{ name: "read" }] }) as never], [TOOL]) }) as unknown as { input: WireItem[] };
		const text = (body.input.at(-1) as { content: { text: string }[] }).content[0].text;
		assert.equal(text, "The following namespaces are no longer available. Do not call tools in them unless those tools are declared in a later update:\n- functions");
	});

	it("lite with incremental_tools on: keeps a same-name redefinition as an addition, not a removal", () => {
		const redefined: Tool = { ...TOOL, description: "new" };
		const body = build({ capabilities: LITE, options: { incrementalTools: true }, context: ctx([USER, SYS_CHANGE({ toolsRemoved: [{ name: "read" }], toolsAdded: [redefined] }) as never]) }) as unknown as { input: WireItem[] };
		assert.equal(body.input.some((i) => i.type === "message" && JSON.stringify(i).includes("no longer available")), false);
		assert.ok(body.input.some((i) => i.type === "additional_tools" && JSON.stringify(i).includes('"description":"new"')));
	});

	it("lite with incremental_tools off (stable default): no mid-transcript tool item or notice, only the current catalog prefix", () => {
		const body = build({ capabilities: LITE, context: ctx([USER, SYS_CHANGE({ toolsAdded: [EXTRA] }) as never, USER, SYS_CHANGE({ toolsRemoved: [{ name: "read" }] }) as never], [TOOL]) }) as unknown as { input: WireItem[] };
		assert.deepEqual(body.input.map((i) => i.type), ["additional_tools", "message", "message", "message"]);
		assert.equal(body.input.some((i) => JSON.stringify(i).includes("incremental") || JSON.stringify(i).includes("no longer available")), false);
	});

	it("golden stable sequence (incremental_tools off): add then remove keeps the current catalog as the first prefix and adds no fabricated items", () => {
		// Lite: prefix is the CURRENT catalog after both changes (read removed, grep added); transcript items are the user turns only.
		const messages = [USER, SYS_CHANGE({ toolsAdded: [EXTRA] }) as never, { ...USER, content: "next", timestamp: 3 }, SYS_CHANGE({ toolsRemoved: [{ name: "read" }] }) as never];
		const lite = build({ capabilities: LITE, context: ctx(messages as never, [TOOL]) }) as unknown as { input: WireItem[] };
		// Golden over the key-sorted serialization (Python uuid5, computed independently of this builder).
		assert.deepEqual(lite.input[0], { type: "additional_tools", id: "at_ee5e3717-b1ef-5c8e-bea5-10a6e06e0b35", role: "developer", tools: [{ type: "namespace", name: "functions", description: "", tools: [{ type: "function", name: "grep", description: "Search", strict: false, parameters: EXTRA.parameters }] }] });
		assert.deepEqual(lite.input.slice(1).map((i) => i.type), ["message", "message", "message"]);
		assert.equal("tools" in lite, false);
		// Non-Lite: top-level tools are the current catalog; the same transcript adds no items.
		const stable = build({ context: ctx(messages as never, [TOOL]) }) as unknown as { tools: { name: string }[]; input: WireItem[] };
		assert.deepEqual(stable.tools.map((t) => t.name), ["grep"]);
		assert.deepEqual(stable.input.map((i) => i.type), ["message", "message", "message"]);
	});
});

describe("reasoning effort ultra", () => {
	it("accepts ultra when the native record advertises it, as the pinned gpt-6.1-sol and gpt-6 catalogs do", () => {
		const capabilities = { ...STABLE, supported_reasoning_levels: [{ effort: "high" }, { effort: "ultra" }] };
		const body = build({ capabilities, options: { reasoningEffort: "ultra" } }) as unknown as { reasoning: { effort: string } };
		assert.equal(body.reasoning.effort, "ultra");
	});

	it("still refuses ultra when the native record does not advertise it", () => {
		assert.throws(() => build({ options: { reasoningEffort: "ultra" } }), /not supported/);
	});
});

describe("configuration_update ledger", () => {
	const CU = (effort: string): WireItem => ({ type: "configuration_update", reasoning: { effort } });
	const ON = { reasoningEffortOverride: true };
	const many = { role: "user" as const, content: "again", timestamp: 4 };
	const messages = [USER, { ...USER, content: "mid", timestamp: 3 }, many];

	it("preserves every trusted historical update at its own position, not one tail replacement", () => {
		const history = { configurationUpdates: [{ beforeMessage: 1, item: CU("low") }, { beforeMessage: 3, item: CU("high") }] };
		const input = build({ context: ctx(messages as never), history, options: { reasoningEffort: "high", ...ON } }).input as WireItem[];
		const kinds = input.map((i) => (i.type === "configuration_update" ? `cu:${(i.reasoning as { effort: string }).effort}` : i.type));
		assert.deepEqual(kinds, ["message", "message", "cu:low", "message", "message", "cu:high"]);
	});

	it("appends only an actual change relative to the latest trusted update", () => {
		const history = { effortPin: "low", configurationUpdates: [{ beforeMessage: 1, item: CU("high") }] };
		const same = build({ context: ctx(messages as never), history, options: { reasoningEffort: "high", ...ON } }).input as WireItem[];
		assert.equal(same.filter((i) => i.type === "configuration_update").length, 1);
		const changed = build({ context: ctx(messages as never), history, options: { reasoningEffort: "medium", ...ON } }).input as WireItem[];
		assert.deepEqual(changed.at(-1), CU("medium"));
		assert.equal(changed.filter((i) => i.type === "configuration_update").length, 2);
	});

	it("drops every ledger item from the request copy when the feature is off, and never mutates the ledger", () => {
		const ledger = [{ beforeMessage: 1, item: CU("low") }];
		const snapshot = JSON.stringify(ledger);
		const input = build({ context: ctx(messages as never), history: { configurationUpdates: ledger }, options: { reasoningEffort: "high" } }).input as WireItem[];
		assert.equal(input.some((i) => i.type === "configuration_update"), false);
		assert.equal(JSON.stringify(ledger), snapshot);
	});

	it("refuses a ledger position outside the transcript instead of dropping it", () => {
		assert.throws(() => build({ context: ctx(messages as never), history: { configurationUpdates: [{ beforeMessage: 9, item: CU("low") }] }, options: ON }), /outside the transcript/);
	});

	it("windowEffortPin keeps the caller pin and otherwise pins the request's own effort", () => {
		assert.equal(windowEffortPin({ history: { effortPin: "low" }, requestEffort: "high" }), "low");
		assert.equal(windowEffortPin({ requestEffort: "high" }), "high");
	});
});

describe("constrained tool mechanics", () => {
	const OPTIONAL_SCHEMA = { type: "object", properties: { path: { type: "string" }, limit: { type: "integer" } }, required: ["path"] } as never;
	const PREFER: Tool = { name: "read", description: "Read", parameters: OPTIONAL_SCHEMA, constrainedSampling: { type: "json_schema", strict: "prefer" } };
	const REQUIRE: Tool = { name: "read", description: "Read", parameters: OPTIONAL_SCHEMA, constrainedSampling: { type: "json_schema", strict: "require" } };
	const UNSUPPORTED = { type: "object", properties: { path: { $ref: "#/x" } }, required: ["path"] } as never;
	const CODE_SCHEMA = { type: "object", properties: { code: { type: "string" } }, required: ["code"] } as never;
	const LARK: Tool = { name: "exec", description: "Run", parameters: CODE_SCHEMA, constrainedSampling: { type: "grammar", variants: { openai_lark: "start: /.+/" } } };
	const GRAMMAR_MODEL = { ...model, compat: { supportsOpenAIGrammarTools: true } } as unknown as Model<Api>;

	it("ordinary tools stay strict false with the original parameters", () => {
		const body = build() as unknown as { tools: { strict: boolean; parameters: unknown }[] };
		assert.equal(body.tools[0].strict, false);
		assert.deepEqual(body.tools[0].parameters, TOOL.parameters);
	});

	it("json_schema prefer is sent strict with the strict-converted parameters", () => {
		const body = build({ context: ctx([USER], [PREFER]) }) as unknown as { tools: { strict: boolean; parameters: { additionalProperties: boolean; required: string[] } }[] };
		assert.equal(body.tools[0].strict, true);
		assert.equal(body.tools[0].parameters.additionalProperties, false);
		assert.deepEqual(body.tools[0].parameters.required, ["path", "limit"]);
	});

	it("json_schema prefer with an unsupported keyword falls back to strict false, parameters unchanged", () => {
		const tool: Tool = { name: "read", description: "Read", parameters: UNSUPPORTED, constrainedSampling: { type: "json_schema", strict: "prefer" } };
		const body = build({ context: ctx([USER], [tool]) }) as unknown as { tools: { strict: boolean; parameters: unknown }[] };
		assert.equal(body.tools[0].strict, false);
		assert.deepEqual(body.tools[0].parameters, UNSUPPORTED);
	});

	it("json_schema require is strict when supported", () => {
		const body = build({ context: ctx([USER], [REQUIRE]) }) as unknown as { tools: { strict: boolean }[] };
		assert.equal(body.tools[0].strict, true);
	});

	it("json_schema require with an unsupported keyword throws locally before any send", () => {
		const tool: Tool = { name: "read", description: "Read", parameters: UNSUPPORTED, constrainedSampling: { type: "json_schema", strict: "require" } };
		assert.throws(() => build({ context: ctx([USER], [tool]) }), /requires JSON-schema constrained sampling, but \$ref schemas are unsupported/);
	});

	it("constrainedSampling false is an ordinary tool", () => {
		const tool: Tool = { ...TOOL, constrainedSampling: false };
		const body = build({ context: ctx([USER], [tool]) }) as unknown as { tools: { strict: boolean }[] };
		assert.equal(body.tools[0].strict, false);
	});

	it("a grammar tool is a native custom tool with a lark grammar format when the model record supports grammar tools", () => {
		const body = buildRequest({ model: GRAMMAR_MODEL, context: ctx([USER], [LARK]), capabilities: STABLE, identity }) as unknown as { tools: unknown[] };
		assert.deepEqual(body.tools, [{ type: "custom", name: "exec", description: "Run", format: { type: "grammar", syntax: "lark", definition: "start: /.+/" } }]);
	});

	it("without grammar support the same grammar tool falls back to an ordinary function tool", () => {
		const body = build({ context: ctx([USER], [LARK]) }) as unknown as { tools: { type: string; strict: boolean }[] };
		assert.equal(body.tools[0].type, "function");
		assert.equal(body.tools[0].strict, false);
	});

	it("lite groups custom and function tools together inside the functions namespace", () => {
		const body = buildRequest({ model: GRAMMAR_MODEL, context: ctx([USER], [TOOL, LARK]), capabilities: LITE, identity }) as unknown as { input: WireItem[] };
		const at = body.input[0] as unknown as { tools: unknown[] };
		assert.deepEqual(at.tools, [{ type: "namespace", name: "functions", description: "", tools: [
			{ type: "function", name: "read", description: "Read a file", strict: false, parameters: TOOL.parameters },
			{ type: "custom", name: "exec", description: "Run", format: { type: "grammar", syntax: "lark", definition: "start: /.+/" } },
		] }]);
	});

	it("grammar tool support is explicit on the model record; without it Pi's default is false", () => {
		assert.equal(toolWireFlags(GRAMMAR_MODEL).supportsOpenAIGrammarTools, true);
		assert.equal(toolWireFlags(model).supportsOpenAIGrammarTools, false);
	});

	it("grammarToolInputProperties maps the grammar tool to its own input property", () => {
		const map = grammarToolInputProperties(GRAMMAR_MODEL, ctx([USER], [LARK, TOOL]));
		assert.deepEqual([...map.entries()], [["exec", "code"]]);
		assert.equal(grammarToolInputProperties(model, ctx([USER], [LARK])).size, 0);
	});

	it("a raw custom call is paired with custom_tool_call_output; a function output stays function_call_output", () => {
		const responseId = "resp-custom";
		const raw = [{ type: "custom_tool_call", id: "ctc_1", call_id: "call_c", name: "exec", input: "echo 1" }];
		const context = ctx([
			USER,
			{ role: "assistant", content: [{ type: "toolCall", id: "call_c|ctc_1", name: "exec", arguments: { code: "echo 1" } }], api: "openai-codex-responses", provider: "openai-codex", model: "gpt-test-sol", usage: {} as never, stopReason: "toolUse", timestamp: 2, responseId } as never,
			{ role: "toolResult", toolCallId: "call_c|ctc_1", toolName: "exec", content: [{ type: "text", text: "1" }], isError: false, timestamp: 3 } as never,
		], [LARK]);
		const body = buildRequest({ model: GRAMMAR_MODEL, context, capabilities: STABLE, identity, history: { rawOutputs: new Map([[responseId, raw]]) } }) as unknown as { input: WireItem[] };
		assert.deepEqual(body.input.slice(-2), [raw[0], { type: "custom_tool_call_output", call_id: "call_c", output: "1" }]);
	});

	it("a call without a raw item follows the grammar map: custom_tool_call with its raw input, paired output", () => {
		const context = ctx([
			USER,
			{ role: "assistant", content: [{ type: "toolCall", id: "call_d|ctc_9", name: "exec", arguments: { code: "ls -la" } }], api: "openai-codex-responses", provider: "openai-codex", model: "gpt-test-sol", usage: {} as never, stopReason: "toolUse", timestamp: 2 } as never,
			{ role: "toolResult", toolCallId: "call_d|ctc_9", toolName: "exec", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 3 } as never,
		], [LARK]);
		const body = buildRequest({ model: GRAMMAR_MODEL, context, capabilities: STABLE, identity }) as unknown as { input: WireItem[] };
		assert.deepEqual(body.input.slice(-2), [
			{ type: "custom_tool_call", id: "ctc_9", call_id: "call_d", name: "exec", input: "ls -la" },
			{ type: "custom_tool_call_output", call_id: "call_d", output: "ok" },
		]);
	});

	it("a raw function call keeps function_call_output even when the current catalog has a grammar tool of that name", () => {
		const responseId = "resp-fn";
		const raw = [{ type: "function_call", id: "fc_1", call_id: "call_f", name: "exec", arguments: "{}" }];
		const context = ctx([
			USER,
			{ role: "assistant", content: [{ type: "toolCall", id: "call_f|fc_1", name: "exec", arguments: {} }], api: "openai-codex-responses", provider: "openai-codex", model: "gpt-test-sol", usage: {} as never, stopReason: "toolUse", timestamp: 2, responseId } as never,
			{ role: "toolResult", toolCallId: "call_f|fc_1", toolName: "exec", content: [{ type: "text", text: "x" }], isError: false, timestamp: 3 } as never,
		], [LARK]);
		const body = buildRequest({ model: GRAMMAR_MODEL, context, capabilities: STABLE, identity, history: { rawOutputs: new Map([[responseId, raw]]) } }) as unknown as { input: WireItem[] };
		assert.equal(body.input.at(-1)?.type, "function_call_output");
	});

	it("additionalToolsItem keeps every native declaration (custom, namespace, hosted) with canonical key order", () => {
		const native = [
			{ type: "namespace", name: "functions", description: "", tools: [{ type: "custom", name: "exec", description: "d", format: { type: "text" } }] },
			{ type: "tool_search", description: "s", execution: "client", parameters: { type: "object" } },
		];
		const item = additionalToolsItem(identity.threadId, native);
		assert.deepEqual(Object.keys(item), ["type", "id", "role", "tools"]);
		assert.deepEqual(item.tools, native);
		assert.equal(JSON.stringify(item.tools), '[{"description":"","name":"functions","tools":[{"description":"d","format":{"type":"text"},"name":"exec","type":"custom"}],"type":"namespace"},{"description":"s","execution":"client","parameters":{"type":"object"},"type":"tool_search"}]');
		assert.equal(item.id, "at_fdbe7ea7-2cda-5c2e-9b78-515261ff17b1");
	});
});

describe("native prefix golden", () => {
	const golden = JSON.parse(readFileSync(new URL("./fixtures/native-prefix.json", import.meta.url), "utf8")) as {
		threadId: string; baseInstructions: string; expectedMsgID: string; tools: unknown[]; expectedAtID: string;
	};

	it("reproduces the independent Codex 0.163.0 capture's additional_tools ID and base-instructions message ID", () => {
		const ns = uuidV5(NAMESPACE_OID, golden.threadId);
		assert.equal(`at_${uuidV5(ns, JSON.stringify(golden.tools))}`, golden.expectedAtID);
		assert.equal(`msg_${uuidV5(ns, golden.baseInstructions)}`, golden.expectedMsgID);
		assert.equal(additionalToolsItem(golden.threadId, golden.tools).id, golden.expectedAtID);
	});
});

describe("structured transcript prefix (Pi normalized form, leading system message)", () => {
	const EXTRA: Tool = { name: "grep", description: "Search", parameters: { type: "object", properties: {} } as never };
	/** Pi's normalized transcript after an accepted compaction: no systemPrompt/tools fields, the prompt leads as a system message. */
	const leading = (extra: Record<string, unknown> = {}) => ({ role: "system" as const, content: SYSTEM, timestamp: 0, toolsAdded: [TOOL], ...extra });
	const structured = (messages: Context["messages"]): Context => ({ messages }) as Context;
	const names = (body: { tools?: unknown }) => ((body.tools ?? []) as { name: string }[]).map((t) => t.name);

	it("public shorthand and its normalizeContext form build the same native request (ids, tools, base)", () => {
		const shorthand = ctx([USER]);
		const normalized = structured(normalizeContext(shorthand).messages as Context["messages"]);
		assert.deepEqual(build({ context: normalized }), build({ context: shorthand }));
		assert.deepEqual(build({ context: normalized, capabilities: LITE, options: { incrementalTools: true } }), build({ context: shorthand, capabilities: LITE, options: { incrementalTools: true } }));
		const base = (build({ context: normalized }).input as WireItem[])[0] as Record<string, unknown>;
		assert.equal(base.id, `msg_${uuidV5(threadNs, SYSTEM)}`);
	});

	it("explicit empty prompt sends no base item; a custom prompt is the base item", () => {
		const empty = build({ context: ctx([USER], [TOOL], "") }).input as WireItem[];
		assert.equal(empty[0].role, "user");
		const custom = build({ context: ctx([USER], [TOOL], "CUSTOM") }).input as WireItem[];
		assert.deepEqual((custom[0] as { content: unknown }).content, [{ type: "input_text", text: "CUSTOM" }]);
	});

	it("sections of the leading message are part of the base; later section updates and removals render as Pi's update text", () => {
		const update = `Updated system prompt section "rules":\n\nR2\n\nRemoved system prompt section "extra".`;
		const context = structured([leading({ sections: { rules: "R1", extra: "E" } }), USER, { role: "system", content: "", timestamp: 2, sections: { rules: "R2", extra: null } } as never]);
		const input = build({ context }).input as WireItem[];
		assert.deepEqual((input[0] as { content: unknown }).content, [{ type: "input_text", text: `${SYSTEM}\n\nR1\n\nE` }]);
		const rendered = input.find((item) => JSON.stringify(item).includes("Removed system prompt section"));
		assert.deepEqual((rendered as { content: unknown }).content, [{ type: "input_text", text: update }]);
		assert.equal(input.filter((item) => JSON.stringify(item).includes(SYSTEM)).length, 1, "the leading prompt is sent once");
	});

	it("stable top-level tools are the current catalog after later structured system changes", () => {
		const context = structured([leading(), USER, { role: "system", content: "", timestamp: 2, toolsAdded: [EXTRA], toolsRemoved: [{ name: "read" }] } as never]);
		const body = build({ context }) as unknown as { tools: { name: string }[]; input: WireItem[] };
		assert.deepEqual(names(body), ["grep"]);
		assert.equal(body.input.some((i) => i.type === "additional_tools"), false);
	});

	it("prefixContext of an after-compaction transcript: the prefix is the head of the full request, once, and nothing is mutated", () => {
		const after = structured([leading(), USER]);
		const before = JSON.stringify(after);
		const prefixed = prefixContext(after);
		assert.equal(JSON.stringify(after), before, "the input is not mutated");
		assert.deepEqual(prefixed, { systemPrompt: SYSTEM, tools: [TOOL], messages: [] });
		const prefix = buildRequest({ model, context: prefixed, options: {}, capabilities: STABLE, identity }).input as WireItem[];
		const full = build({ context: after }).input as WireItem[];
		assert.equal(prefix.length, 1);
		assert.deepEqual(full.slice(0, prefix.length), prefix);
		assert.equal(full.filter((i) => JSON.stringify(i) === JSON.stringify(prefix[0])).length, 1);
	});

	it("prefixContext keeps explicit empty, custom and forced prompts and the current catalog", () => {
		assert.deepEqual(prefixContext({ systemPrompt: "", tools: [TOOL], messages: [] }), { systemPrompt: "", tools: [TOOL], messages: [] });
		assert.deepEqual(prefixContext({ systemPrompt: "FORCED", messages: [] }), { systemPrompt: "FORCED", tools: [], messages: [] });
	});

	it("prefixContext incremental tools: the initial catalog for Lite with incremental_tools, the current one otherwise", () => {
		const context = structured([leading(), USER, { role: "system", content: "", timestamp: 2, toolsAdded: [EXTRA] } as never]);
		assert.deepEqual(prefixContext(context).tools?.map((t) => t.name), ["read", "grep"]);
		assert.deepEqual(prefixContext(context, true).tools?.map((t) => t.name), ["read"]);
	});

	it("a pending system entry at position 0 is rendered as an update, and keeps the prior tool catalog for its removals", () => {
		const entry = { role: "system", content: "Changed.", timestamp: 3, toolsRemoved: [{ name: "read" }] };
		const items = transcriptItems({
			context: { messages: [entry], tools: [TOOL] } as unknown as Context,
			model,
			capabilities: LITE,
			overrideEnabled: false,
			incrementalToolsEnabled: true,
			initialSystemAsUpdate: true,
		});
		assert.equal(items.length, 2);
		assert.deepEqual((items[0] as { content: unknown }).content, [{ type: "input_text", text: "Changed." }]);
		assert.equal((items[1] as { content: { text: string }[] }).content[0].text.startsWith("The following namespaces are no longer available."), true);
	});

	it("the leading system message is the base, not a transcript item, unless the caller asks for it as an update", () => {
		const message = { role: "system" as const, content: "Base.", timestamp: 0 };
		assert.equal(transcriptItems({ context: { messages: [message] } as unknown as Context, model, capabilities: STABLE, overrideEnabled: false, incrementalToolsEnabled: false }).length, 0);
		assert.equal(transcriptItems({ context: { messages: [message] } as unknown as Context, model, capabilities: STABLE, overrideEnabled: false, incrementalToolsEnabled: false, initialSystemAsUpdate: true }).length, 1);
	});
});
