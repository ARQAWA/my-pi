import assert from "node:assert/strict";
import { test } from "node:test";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { AgentSession, createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerSessionRuntime } from "../../../extensions/RQW-agent/index.ts";
import { retainedChildManager } from "../../../extensions/RQW-agent/persistence.ts";
import { world } from "./fixture.ts";

const provider = builtinProviders().find(item => item.id === "anthropic")!;
const model = provider.getModels().find(item => item.reasoning)!;

function response(kind: "answer" | "summary" | "tools") {
	const events: any[] = [{ type: "message_start", message: { id: "fake", model: model.id, usage: { input_tokens: 1, output_tokens: 0 } } }];
	if (kind === "summary") events.push(
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "new compaction summary" } },
		{ type: "content_block_stop", index: 0 },
	);
	if (kind === "tools") for (const [index, name] of ["z_tool", "bash"].entries()) events.push(
		{ type: "content_block_start", index, content_block: { type: "tool_use", id: `tool-${index}`, name, input: {} } },
		{ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: "{}" } },
		{ type: "content_block_stop", index },
	);
	events.push({ type: "message_delta", delta: { stop_reason: kind === "tools" ? "tool_use" : "end_turn" }, usage: { output_tokens: 1 } }, { type: "message_stop" });
	return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

for (const compact of [false, true]) test(`Anthropic fork preserves payload and tool access${compact ? " after compaction" : ""}`, async t => {
	const w = await world(t);
	const parent = SessionManager.inMemory(w.cwd);
	const initial = parent.appendMessage({ role: "user", content: "caller message", timestamp: 1 });
	if (compact) {
		parent.appendCompaction("old compaction summary", initial, 100);
		for (let i = 0; i < 4; i++) {
			parent.appendMessage({ role: "user", content: `question ${i} ${"x".repeat(400)}`, timestamp: 4_102_444_800_000 + i * 2 });
			parent.appendMessage({ role: "assistant", content: [{ type: "text", text: `answer ${i} ${"y".repeat(400)}` }], api: model.api,
				provider: model.provider, model: model.id, stopReason: "stop", timestamp: 4_102_444_800_001 + i * 2,
				usage: { input: model.contextWindow, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: model.contextWindow + 1,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
		}
	}
	const sent: any[] = [];
	const calls: string[] = [];
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const request = new Request(input, init);
		const body = JSON.parse(await request.text());
		sent.push(body);
		const messages = JSON.stringify(body.messages);
		if (compact && sent.length > 1 && /<conversation>|# Conversation/.test(messages)) return response("summary");
		const last = JSON.stringify(body.messages.at(-1));
		return response(sent.length > 1 && last.includes("fork task") ? "tools" : "answer");
	};
	const root = Object.create(AgentSession.prototype);
	root.sessionManager = parent;
	root.agent = { streamFunction: (m: any, context: any, options: any) => provider.streamSimple(m, context, { ...options, fetch }) };
	const modelRuntime = {
		getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true,
		getAuth: async () => ({ auth: { apiKey: "sk-test" }, env: {} }), checkAuth: async () => ({}), isUsingOAuth: () => false,
		getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [],
		streamSimple: (m: any, context: any, options: any) => provider.streamSimple(m, context, { ...options, apiKey: "sk-test", fetch }),
	};
	const ctx: any = {
		cwd: w.cwd, sessionManager: parent, model, modelRegistry: { runtime: modelRuntime, find: () => model, hasConfiguredAuth: () => true },
		isIdle: () => root.isIdle, isProjectTrusted: () => true, getSystemPrompt: () => "caller system", signal: new AbortController().signal, mode: "tui",
	};
	const hooks = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	let definition: any;
	const events = createEventBus();
	events.on("rqw-tools:subagent-tools", (request: any) => request.offer(() => ["bash", "z_tool"].map(name => ({
		name, label: name, description: name, parameters: Type.Object({}),
		execute: async () => { calls.push(name); return { content: [{ type: "text", text: `${name} executed` }], details: {} }; },
	})), { names: ["bash", "z_tool"], aliases: {} }));
	const pi: any = {
		events, on: (name: string, hook: any) => hooks.set(name, [...hooks.get(name) ?? [], hook]),
		registerTool: (tool: any) => { definition = tool; }, appendEntry: (name: string, data: any) => parent.appendCustomEntry(name, data),
		getSettings: () => ({ retry: { enabled: false }, compaction: { enabled: compact, keepRecentTokens: 10 } }), getThinkingLevel: () => "low", getActiveTools: () => ["bash"],
		sendMessage: (message: any) => parent.appendCustomMessageEntry(message.customType, message.content, message.display, message.details),
	};
	const live = registerSessionRuntime(pi, pi.events, false, undefined, undefined, undefined, undefined, undefined, "", undefined);
	try {
		for (const hook of hooks.get("session_start") ?? []) await hook({}, ctx);
		await assert.rejects(async () => definition.execute("missing", { action: "start", fork_turns: "all", task: "fork task" }, new AbortController().signal, undefined, ctx), /last provider payload is unavailable/);
		assert.ok(!parent.getBranch().some(entry => entry.type === "custom" && entry.customType === "agent"));
		const context: any = { messages: [
			{ role: "system", content: "caller system", timestamp: 1, toolsAdded: [
				{ name: "z_tool", description: "first tool", parameters: { type: "object", properties: {} } },
				{ name: "a_tool", description: "second tool", parameters: { type: "object", properties: {} } },
				{ name: "bash", description: "available tool", parameters: { type: "object", properties: {} } },
			] },
			{ role: "user", content: [{ type: "text", text: "caller message" }], timestamp: 1 },
		] };
		await root.agent.streamFunction(model, context, { apiKey: "sk-test", sessionId: parent.getSessionId(), reasoning: "low", cacheRetention: "long",
			onPayload(payload: any) { payload.system[0].text += " after hook"; return payload; },
		}).result();
		await definition.execute("call", { action: "start", fork_turns: "all", task: "fork task", tools: ["bash"] }, new AbortController().signal, undefined, ctx);
		await live.wait(new AbortController().signal);
		const taskIndex = sent.findIndex((body, index) => index > 0 && JSON.stringify(body.messages.at(-1)).includes("fork task"));
		assert.ok(taskIndex > 0);
		assert.equal(sent.length, taskIndex + 2, JSON.stringify(parent.getBranch()));
		if (compact) {
			assert.match(JSON.stringify(sent[1].messages), /<previous-summary>\\nold compaction summary/);
			assert.doesNotMatch(JSON.stringify(sent[1].messages), /fork task/);
			const branch = retainedChildManager(parent, "agent", 1)!.getBranch();
			const status = await definition.execute("status", { action: "status", ids: ["agent#1"] }, new AbortController().signal, undefined, ctx);
			assert.ok(branch.some(entry => entry.type === "compaction" && entry.summary.includes("new compaction summary")), JSON.stringify(status.details));
		}
		assert.match(JSON.stringify(sent[0].system), /caller system after hook/);
		assert.match(JSON.stringify(sent[0]), /"cache_control":\{"type":"ephemeral","ttl":"1h"\}/);
		assert.deepEqual(sent[0].tools.slice(0, 2).map((tool: any) => tool.name), ["z_tool", "a_tool"]);
		const expected = structuredClone(sent[0]);
		expected.messages.push({ role: "user", content: [{ type: "text", text: "fork task" }] });
		assert.deepEqual(sent[taskIndex], expected);
		assert.deepEqual(calls, ["bash"]);
		assert.match(JSON.stringify(sent[taskIndex + 1].messages), /Tool z_tool not found/);
		assert.match(JSON.stringify(sent[taskIndex + 1].messages), /"is_error":true/);
		assert.match(JSON.stringify(sent[taskIndex + 1].messages), /bash executed/);
		await definition.execute("call-2", { action: "send", id: "agent#1", task: "follow up" }, new AbortController().signal, undefined, ctx);
		await live.wait(new AbortController().signal);
		assert.match(JSON.stringify(sent.at(-1).messages), /follow up/);
	} finally { live.close(); }
});
