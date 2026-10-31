import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { AgentSession, createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerSessionRuntime } from "../extensions/RQW-agent/index.ts";
import { CodexThreadTransport } from "../extensions/RQW-codex/transport.ts";
import { world } from "./extensions/RQW-agent/fixture.ts";

const model: any = { id: "gpt-6.1-terra", name: "Terra", api: "openai-codex-responses", provider: "openai-codex", baseUrl: "https://chatgpt.com/backend-api", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 500000, maxTokens: 100000, thinkingLevelMap: {} };
const identity = { installationId: "11111111-2222-4333-8444-555555555555", windowId: "11111111-2222-4333-8444-555555555555:0", rootSessionId: "root-session", threadId: "parent" };
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const access = `${b64({ alg: "none" })}.${b64({ exp: 4_000_000_000, "https://api.openai.com/auth": { chatgpt_account_id: "test" } })}.sig`;
const completed = (id: string) => ({ type: "response.completed", response: { id, status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
function answer(id: string) {
	return [{ type: "response.created", response: { id } }, { type: "response.output_item.added", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", content: [], status: "in_progress" } },
		{ type: "response.output_text.delta", item_id: `msg_${id}`, output_index: 0, content_index: 0, delta: "ok" },
		{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", content: [{ type: "output_text", text: "ok", annotations: [] }], status: "completed" } }, completed(id)];
}
function calls() {
	const events: any[] = [{ type: "response.created", response: { id: "resp_tools" } }];
	for (const [index, name] of ["z_tool", "bash"].entries()) {
		const item = { type: "function_call", id: `fc_${index}`, call_id: `call_${index}`, name, arguments: "{}" };
		events.push({ type: "response.output_item.added", output_index: index, item }, { type: "response.output_item.done", output_index: index, item });
	}
	events.push(completed("resp_tools"));
	return events;
}

test("Codex fork sends the caller's prepared prefix with isolated tool execution", async t => {
	const w = await world(t);
	const parent = SessionManager.inMemory(w.cwd);
	parent.appendMessage({ role: "user", content: "caller message", timestamp: 1 });
	const store = new InMemoryCredentialStore();
	await store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "refresh", expires: 4_000_000_000_000, accountId: "test" }) as never);
	const sent: Array<{ thread: string; body: any }> = [];
	const executed: string[] = [];
	const transports: CodexThreadTransport[] = [];
	function transport(thread: string) {
		const value = new CodexThreadTransport({ identity: { ...identity, threadId: thread }, store, dependencies: {
			clock: { now: () => 1_000_000 }, random: () => 0.5, sleep: async () => {},
			connect: async () => {
				let current: any[] = [];
				return { isOpen: true, socketIdentity: `socket-${thread}`, async send(body: any) {
					sent.push({ thread, body: structuredClone(body) });
					current = thread !== "parent" && sent.filter(item => item.thread === thread).length === 1 ? calls() : answer(`resp_${sent.length}`);
				}, events: () => (async function* () { for (const item of current) yield { text: JSON.stringify(item), value: item }; })(), async close() {}, async interrupt() { return { acknowledged: true, completed: false }; } } as any;
			},
		} });
		transports.push(value);
		return value;
	}
	const rootTransport = transport("parent");
	const children = new Map<string, CodexThreadTransport>();
	const root = Object.create(AgentSession.prototype);
	root.sessionManager = parent;
	root.agent = { streamFunction: (m: any, context: any, options: any) => rootTransport.stream(m, context, options) };
	const runtime = { getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true, getAuth: async () => ({ apiKey: "fake" }), checkAuth: async () => ({}), isUsingOAuth: () => true, getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [],
		streamSimple: (m: any, context: any, options: any) => { const id = options.sessionId; if (!children.has(id)) children.set(id, transport(id)); return children.get(id)!.stream(m, context, options); } };
	const ctx: any = { cwd: w.cwd, sessionManager: parent, model, modelRegistry: { runtime, find: () => model, hasConfiguredAuth: () => true }, isIdle: () => root.isIdle, isProjectTrusted: () => true, getSystemPrompt: () => "caller system", signal: new AbortController().signal, mode: "tui" };
	const hooks = new Map<string, any[]>();
	const events = createEventBus();
	let definition: any;
	events.on("rqw-tools:subagent-tools", (request: any) => request.offer(() => ["bash", "z_tool"].map(name => ({ name, label: name, description: name, parameters: Type.Object({}), execute: async () => { executed.push(name); return { content: [{ type: "text", text: `${name} executed` }], details: {} }; } })), { names: ["bash", "z_tool"], aliases: {} }));
	const pi: any = { events, on: (name: string, hook: any) => hooks.set(name, [...hooks.get(name) ?? [], hook]), registerTool: (tool: any) => { definition = tool; }, appendEntry: (name: string, data: any) => parent.appendCustomEntry(name, data), getSettings: () => ({ retry: { enabled: false }, compaction: { enabled: false } }), getThinkingLevel: () => "low", getActiveTools: () => ["bash"], sendMessage: (message: any) => parent.appendCustomMessageEntry(message.customType, message.content, message.display, message.details) };
	const live = registerSessionRuntime(pi, events, false, undefined, undefined, undefined, undefined, undefined, "", undefined);
	try {
		for (const hook of hooks.get("session_start") ?? []) await hook({}, ctx);
		const execute = (params: any) => definition.execute("call", params, new AbortController().signal, undefined, ctx);
		await assert.rejects(async () => execute({ action: "start", fork_turns: "all", task: "fork task" }), /last provider payload is unavailable/);
		const tools = ["z_tool", "a_tool", "bash"].map(name => ({ name, description: name, parameters: { type: "object", properties: {} } }));
		const context: any = { systemPrompt: "caller system", tools, messages: [{ role: "user", content: "caller message", timestamp: 1 }] };
		await root.agent.streamFunction(model, context, { sessionId: parent.getSessionId(), reasoning: "high", serviceTier: "priority", onPayload(body: any) { body.parallel_tool_calls = false; body.input.push({ type: "message", role: "developer", content: [{ type: "input_text", text: "after hook" }] }); return body; } }).result();
		await execute({ action: "start", fork_turns: "all", task: "fork task", tools: ["bash"] });
		await live.wait(new AbortController().signal);
		assert.equal(sent.length, 3, JSON.stringify(sent));
		const [source, fork, followup] = sent;
		assert.notEqual(fork.thread, source.thread);
		assert.equal(fork.body.previous_response_id, undefined);
		const expected = structuredClone(source.body);
		expected.input.push({ type: "message", role: "user", content: [{ type: "input_text", text: "fork task" }] });
		assert.deepEqual(fork.body, expected);
		assert.deepEqual(executed, ["bash"]);
		assert.match(JSON.stringify(followup.body), /Tool z_tool not found/);
		assert.match(JSON.stringify(followup.body), /bash executed/);
	} finally { live.close(); for (const transport of transports) transport.dispose(); }
});
