import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { queryObjects } from "node:v8";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { createFauxCore, fauxAssistantMessage, fauxProvider, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { AgentSession, createEventBus, SessionManager, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { formatProgramStatus, ProcessTerminal } from "@earendil-works/pi-tui";
import { registerHerdrActivity } from "../../../extensions/RQW-agent/herdr-state.ts";
import { registerRunningCounts } from "../../../extensions/RQW-agent/running-counts.ts";
import { registerTerminalActivity } from "../../../extensions/RQW-agent/terminal-progress.ts";
import { Activity, headTail } from "../../../extensions/RQW-agent/activity.ts";
import { Coordinator } from "../../../extensions/RQW-agent/coordinator.ts";
import { createCountsProducer, type CountsOffer, type RunningCounts } from "../../../extensions/RQW-agent/counts.ts";
import { fastGpt, inheritedFastGpt } from "../../../extensions/RQW-agent/fast-gpt.ts";
import { createChildManager, openChildManager, recordDelivery, repairInterrupted, retainedChildManager } from "../../../extensions/RQW-agent/persistence.ts";
import { ProfileCatalogue } from "../../../extensions/RQW-agent/profiles.ts";
import { CONTEXT_FORK, ProgressReports, type ContextForkRequest } from "../../../extensions/RQW-agent/progress.ts";
import { appendUserMessages, loadPromptFile } from "../../../extensions/RQW-agent/prompt-files.ts";
import { childRecord, collectExtensionFactories, mergeSaved, registerSessionRuntime } from "../../../extensions/RQW-agent/index.ts";

async function temp(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "rqw-agent-unit-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

class FakeSession {
	listener?: (event: AgentSessionEvent) => void;
	messages: unknown[] = [];
	isStreaming = false;
	model = { provider: "test", id: "model" };
	stats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
	subscribe(listener: (event: AgentSessionEvent) => void) {
		this.listener = listener;
		return () => { this.listener = undefined; };
	}
	getSessionStats() { return { tokens: this.stats }; }
	emit(event: Record<string, unknown>) { this.listener?.(event as AgentSessionEvent); }
}

function activityFixture() {
	const session = new FakeSession();
	const activity = new Activity(session as unknown as AgentSession);
	return { session, activity, snapshot: () => activity.snapshot() as any };
}

const usage = (input: number) => ({
	input, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: input,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});
const assistant = (input: number) => ({
	role: "assistant", content: [], timestamp: 1, provider: "test", model: "model",
	usage: usage(input), stopReason: "stop",
});

test("headTail returns bounded previews without splitting a surrogate pair", () => {
	assert.deepEqual(headTail("short", 20), { text: "short", truncated: false, length: 5 });
	const result = headTail(`${"a".repeat(49)}😀${"b".repeat(100)}`, 100);
	assert.equal(result.truncated, true);
	assert.equal(result.length, 151);
	assert.ok(result.text.length <= 100);
	assert.doesNotMatch(result.text, /[\ud800-\udbff]$/);
});

test("Activity returns running and completed tool snapshots", () => {
	const f = activityFixture();
	f.activity.startRun();
	f.session.emit({ type: "agent_start" });
	f.session.emit({ type: "tool_execution_start", toolCallId: "call", toolName: "read", args: { path: "a" } });
	assert.equal(f.snapshot().state, "running_tool");
	assert.equal(f.snapshot().current_tools[0].args_preview, '{"path":"a"}');
	f.session.emit({ type: "tool_execution_end", toolCallId: "call", toolName: "read", result: "ok", isError: false });
	assert.equal(f.snapshot().current_tools_total, 0);
	assert.equal(f.snapshot().last_tool.is_error, false);
	f.activity.endRun("completed");
	assert.equal(f.snapshot().outcome, "completed");
	f.activity.close();
});

// Regression for b4177cf: core resume must not invent complete provider usage.
test("Activity keeps missing usage incomplete after core resume settlement", () => {
	const f = activityFixture();
	for (const input of [0, 1]) {
		f.activity.startRun();
		f.session.emit({ type: "agent_start" });
		f.session.emit({ type: "message_end", message: assistant(input) });
		f.session.emit({ type: "agent_end" });
		f.activity.endRun("completed", true);
		assert.equal(f.snapshot().usage_complete, input === 1);
	}
	f.activity.close();
});

test("counts producer offers snapshots, changes and shutdown", () => {
	let running: RunningCounts = { agents: 0, reviews: 0 };
	const offers: CountsOffer[] = [];
	const events = { emit: (_name: string, value: CountsOffer) => offers.push(value) };
	const producer = createCountsProducer(() => ({ ...running }), events as never);
	producer.start();
	const source = offers[0].source;
	const seen: (RunningCounts | null)[] = [];
	source.subscribe(value => seen.push(value));
	running = { agents: 1, reviews: 0 };
	producer.refresh();
	assert.deepEqual(source.snapshot(), running);
	assert.deepEqual(seen, [running]);
	producer.stop();
	assert.deepEqual(source.snapshot(), { agents: 0, reviews: 0 });
	assert.deepEqual(seen, [running, null]);
});

test("GPT Fast inherits its setting and decorates only Codex requests", () => {
	assert.equal(inheritedFastGpt({ emit: (_name: string, query: any) => { query.fastGpt = true; } } as never), true);
	assert.equal(inheritedFastGpt({ emit: () => {} } as never), false);
	let handler: any;
	fastGpt({ on: (name: string, hook: unknown) => { if (name === "before_provider_request") handler = hook; } } as never, () => true);
	const payload = { model: "model", input: [] };
	assert.deepEqual(handler({ payload }, { model: { provider: "openai-codex", id: "model" } }), { ...payload, service_tier: "priority" });
	assert.equal(handler({ payload }, { model: { provider: "anthropic", id: "model" } }), undefined);
});

test("a child receives an explicitly offered inline extension factory", () => {
	const events = createEventBus();
	let registered = false;
	const factory = (child: any) => { child.on("session_start", () => { registered = true; }); };
	events.on("rqw-agent:subagent-extension-factories", request => (request as any).offer(factory));
	const [offered] = collectExtensionFactories(events);
	let hook: () => void;
	offered({ on: (_name: string, value: () => void) => { hook = value; } } as never);
	hook!();
	assert.equal(registered, true);
});

test("prompt files preserve exact text and return byte provenance", async t => {
	const root = await temp(t);
	const text = "\uFEFFexact\r\nprompt\n";
	await writeFile(join(root, "prompt.txt"), text);
	const loaded = await loadPromptFile("system", "prompt.txt", root);
	assert.equal(loaded.text, text);
	assert.deepEqual(loaded.file, { kind: "system", path: join(root, "prompt.txt"), sha256: createHash("sha256").update(text).digest("hex") });
});

test("appendUserMessages appends only user text in branch order", () => {
	const branch = [
		{ type: "message", message: { role: "user", content: "first" } },
		{ type: "message", message: { role: "assistant", content: "ignored" } },
		{ type: "message", message: { role: "user", content: [{ type: "text", text: "second" }, { type: "image", data: "AA==", mimeType: "image/png" }] } },
	];
	assert.equal(appendUserMessages("task", branch as never), "task\n\n<user_messages>\nfirst\nsecond\n</user_messages>");
});

test("profile catalogue loads native metadata and exact provenance", async t => {
	const root = await temp(t);
	const cwd = join(root, "repo");
	const agentDir = join(root, "pi");
	await mkdir(join(cwd, ".git"), { recursive: true });
	const text = 'name = "scout"\ndescription = "Search"\nmodel = "model"\nmodel_reasoning_effort = "low"\ndeveloper_instructions = " instructions "\n';
	const path = join(agentDir, "agents", "scout.toml");
	await mkdir(join(agentDir, "agents"), { recursive: true });
	await writeFile(path, text);
	const catalogue = new ProfileCatalogue();
	const profiles = await catalogue.refresh({ cwd, agentDir, codexHome: join(root, "codex"), extensionPaths: [] });
	// Codex's built-in default and worker roles come with every catalogue; explorer does not.
	assert.deepEqual(profiles.filter(profile => !profile.path.startsWith("builtin:")).map(profile => ({ name: profile.name, description: profile.description, model: profile.model, effort: profile.model_reasoning_effort })),
		[{ name: "scout", description: "Search", model: "model", effort: "low" }]);
	assert.deepEqual(profiles.map(profile => profile.name), ["default", "scout", "worker"]);
	assert.equal(catalogue.get("scout")?.sha256, createHash("sha256").update(text).digest("hex"));
});

function progressFixture(reasoning: "low" | undefined) {
	const events = createEventBus();
	const requests: ContextForkRequest[] = [];
	const delivered = Promise.withResolvers<any>();
	events.on(CONTEXT_FORK, value => {
		const request = value as ContextForkRequest;
		requests.push(request);
		request.offer(async () => fauxAssistantMessage("summary"));
	});
	const progress = new ProgressReports(events, "agent#1", "child", message => delivered.resolve(message));
	const model = fauxProvider({ provider: "progress", models: [{ id: "model" }] }).getModel("model")!;
	progress.capture(model, { messages: [{ role: "user", content: "task", timestamp: 1 }] } as never);
	const response = fauxAssistantMessage([fauxToolCall("read", { path: "a" })], { stopReason: "toolUse" });
	for (let i = 0; i < 50; i++) progress.response(response, reasoning);
	return { progress, requests, delivered: delivered.promise };
}

test("progress reports after 50 tool responses with the request effort", async () => {
	const f = progressFixture("low");
	assert.equal(f.progress.steps, 50);
	assert.equal(f.requests.length, 1);
	assert.equal(f.requests[0].reasoning, "low");
	assert.equal(f.requests[0].sessionId, "child");
	const notice = await f.delivered;
	assert.equal(notice.customType, "agent_progress");
	assert.deepEqual(notice.details, { id: "agent#1", steps: 50, continues: true });
	f.progress.invalidate();
});

// Regression for fd01c9c: absent routed effort must not inherit selected effort.
test("progress leaves unavailable request effort absent", () => {
	const f = progressFixture(undefined);
	assert.equal(f.requests[0].reasoning, undefined);
	f.progress.invalidate();
});

const FOLLOW_UP = "Perform any necessary follow-up actions in response to the subagent completion above. If no follow-up work is needed, no further action is required. Don't repeat the same confirmation every time.";

function coordinatorFixture(t: TestContext, busy = false, sessionFile?: string) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	t.mock.method(performance, "now", () => 0);
	const hooks = new Map<string, ((event: any, context: any) => unknown)[]>();
	const sent: { message: any; options: any }[] = [];
	const branch: any[] = [];
	const context = { isIdle: () => !busy, sessionManager: { getBranch: () => branch, getSessionFile: () => sessionFile }, signal: new AbortController().signal };
	const pi = { on(name: string, hook: any) { hooks.set(name, [...hooks.get(name) ?? [], hook]); } };
	const coordinator = new Coordinator(pi as never, (message, options) => sent.push({ message, options }));
	const emit = (name: string, event: any = {}) => {
		let result: unknown;
		for (const hook of hooks.get(name) ?? []) result = hook(event, context);
		return result;
	};
	let live = true;
	const target = { id: "agent#1", run: "run", active: () => live, snapshot: () => ({ state: live ? "running" : "idle" }) };
	coordinator.add(target);
	return { coordinator, sent, branch, emit,
		finish: (title?: string) => { live = false; coordinator.publish(target.id, target.run, "answer", "completed", undefined, title); } };
}

test("a wait answer carries only id, title, outcome and text, never statuses", async t => {
	const f = coordinatorFixture(t);
	const waiting = f.coordinator.wait(["agent#1"], 100, new AbortController().signal, "call");
	f.finish("Scout");
	const result = await waiting;
	const body = JSON.parse(result.content[0].text);
	assert.deepEqual(Object.keys(body), ["results"]);
	assert.deepEqual(Object.keys(body.results[0]), ["id", "title", "outcome", "text"]);
	assert.equal(body.results[0].title, "Scout");
	assert.equal("statuses" in result.details, false);
});

test("coordinator wait returns a completed child result", async t => {
	const f = coordinatorFixture(t);
	const waiting = f.coordinator.wait(["agent#1"], 100, new AbortController().signal, "call");
	f.finish();
	const result = await waiting;
	assert.equal(result.details.reason, "result");
	assert.deepEqual((result.details.results as any[]).map((item: any) => [item.id, item.text, item.outcome]), [["agent#1", `answer\n\n${FOLLOW_UP}`, "completed"]]);
});

test("the model-visible wait text carries the follow-up once, a repeat wait does not", async t => {
	const f = coordinatorFixture(t);
	const waited = f.coordinator.wait(["agent#1"], 100, new AbortController().signal, "call");
	f.finish();
	const result = await waited;
	assert.equal(JSON.parse(result.content[0].text).results[0].text, `answer\n\n${FOLLOW_UP}`);
	assert.ok(Array.isArray(result.details.results));
	assert.equal(result.details.results[0].text, `answer\n\n${FOLLOW_UP}`);
	const repeated = await f.coordinator.wait(["agent#1"], 100, new AbortController().signal, "again");
	assert.doesNotMatch(repeated.content[0].text, /follow-up actions/);
});

test("receipt write failure still commits a wait result", async t => {
	const root = await temp(t);
	const sessionFile = join(root, "parent.jsonl");
	await writeFile(sessionFile, "");
	// A directory at the receipt filename makes the real filesystem reject appending.
	await mkdir(`${sessionFile}.children/delivered`, { recursive: true });
	const f = coordinatorFixture(t, false, sessionFile);
	const waiting = f.coordinator.wait(["agent#1"], 100, new AbortController().signal, "call");
	f.finish();
	const result = await waiting;
	assert.equal((result.details.results as any[])[0].text, `answer\n\n${FOLLOW_UP}`);
	f.branch.push({ type: "message", message: { role: "toolResult", toolCallId: "call", isError: false, content: result.content, details: result.details } });
	f.emit("turn_end");
	const repeated = await f.coordinator.wait(["agent#1"], 100, new AbortController().signal, "again");
	assert.equal(repeated.details.reason, "receipt");
	assert.equal(repeated.content[0].text, "no new answer, already delivered: agent#1; nothing running");
	assert.deepEqual(repeated.details.results, []);
	assert.equal((repeated.details.receipts as any[])[0].delivered_via, "wait");
});

test("child sessions persist below their parent and reopen", async t => {
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const child = createChildManager(parent, root, "agent", 1);
	child.appendMessage({ role: "user", content: "child", timestamp: 2 });
	const reopened = openChildManager(parent, child.getSessionFile()!, root, "agent", 1);
	assert.deepEqual(reopened.buildSessionContext(), child.buildSessionContext());
	assert.equal(reopened.getHeader()?.parentSession, parent.getSessionFile());
});

test("interrupted tool calls receive durable error results without replay", async t => {
	const root = await temp(t);
	const manager = SessionManager.inMemory(root);
	manager.appendMessage({ role: "user", content: "task", timestamp: 1 });
	manager.appendMessage(fauxAssistantMessage([fauxToolCall("write", { path: "a" }, { id: "call" })], { stopReason: "aborted" }));
	const agent = new Agent({ streamFn: () => { throw new Error("no model call"); } });
	assert.equal(repairInterrupted({ agent, sessionManager: manager } as AgentSession), true);
	const messages = manager.buildSessionContext().messages;
	assert.deepEqual(messages.map(message => message.role), ["user", "assistant", "toolResult"]);
	const result = messages.at(-1);
	assert.ok(result?.role === "toolResult" && result.isError);
	assert.match(JSON.stringify(result.content), /Interrupted before a durable result/);
});

function runtimeFixture(parent: SessionManager, cwd: string, response: (context: any, options: any) => string | ReturnType<typeof fauxAssistantMessage> | Promise<string | ReturnType<typeof fauxAssistantMessage>> = () => "answer", responses = 8, codemode = false, setup?: (events: ReturnType<typeof createEventBus>) => void) {
	const hooks = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	const events = createEventBus();
	setup?.(events);
	const core = createFauxCore({ provider: "persist-test", models: [{ id: "model" }, { id: "other" }] });
	const model = core.getModel("model")!;
	const other = core.getModel("other")!;
	const requests: any[] = [];
	const requestModels: string[] = [];
	core.setResponses(Array.from({ length: responses }, () => async (context: any, options: any) => {
		requests.push(context);
		const answer = await response(context, options);
		return typeof answer === "string" ? fauxAssistantMessage(answer, { timestamp: 1 }) : answer;
	}));
	const modelRuntime = {
		getModel: () => model, getPhysicalModel: () => model,
		hasConfiguredAuth: () => true, getAuth: async () => ({ apiKey: "fake" }),
		checkAuth: async () => ({}), isUsingOAuth: () => false,
		getAvailableSnapshot: () => [model, other], getRegisteredProviderIds: () => [],
		streamSimple: (selected: any, context: any, options: any) => { requestModels.push(selected.id); return core.streamSimple(selected, context, options); },
	};
	let definition: any;
	const notices: string[] = [];
	const ctx: any = {
		cwd, sessionManager: parent, model, modelRegistry: { runtime: modelRuntime, find: (_provider: string, id: string) => id === "other" ? other : model, hasConfiguredAuth: () => true },
		isIdle: () => true, isProjectTrusted: () => true, getSystemPrompt: () => "original prompt",
		signal: new AbortController().signal, mode: "tui", ui: { notify: (message: string) => { notices.push(message); } },
	};
	const pi: any = {
		events, on: (name: string, hook: any) => hooks.set(name, [...hooks.get(name) ?? [], hook]),
		registerTool: (tool: any) => { definition = tool; },
		appendEntry: (name: string, data: any) => parent.appendCustomEntry(name, data),
		getSettings: () => ({ retry: { enabled: false }, compaction: { enabled: false } }),
		getThinkingLevel: () => "off", getActiveTools: () => codemode ? ["codemode"] : [],
		sendMessage: (message: any) => parent.appendCustomMessageEntry(message.customType, message.content, message.display, message.details),
	};
	const runtime = registerSessionRuntime(pi, pi.events, false, undefined, undefined, undefined, undefined, undefined, "", undefined);
	return { runtime, requests, requestModels, ctx, events, notices, parameters: () => definition.parameters, description: () => definition.description as string, async emit(name: string, event: any = {}) { let result: unknown; for (const hook of hooks.get(name) ?? []) result = await hook(event, ctx); return result; },
		execute: (params: any, callId = "call", signal = new AbortController().signal) => definition.execute(callId, params, signal, undefined, ctx) };
}

async function commitWait(live: ReturnType<typeof runtimeFixture>, parent: SessionManager, id = "agent#1") {
	const result = await live.execute({ action: "wait", ids: [id] });
	parent.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "agent", content: result.content, details: result.details, isError: false, timestamp: 1 });
	await live.emit("turn_end");
	return result;
}

function steeringSession(manager: SessionManager) {
	const listeners = new Set<(event: any) => void>();
	const session = Object.assign(Object.create(AgentSession.prototype), {
		sessionManager: manager, agent: { steeringQueue: { messages: [] } },
		getSteeringMessages: () => messages,
		subscribe: (listener: (event: any) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
	});
	const messages: string[] = [];
	return { session, messages, emit: (event: any) => { for (const listener of listeners) listener(event); }, listeners };
}

test("registered agent wait wakes for queued and newly enqueued steering without losing held results", async t => {
	const root = await temp(t);
	const manager = SessionManager.inMemory(root);
	const pending = Promise.withResolvers<string>();
	const live = runtimeFixture(manager, root, context => context.messages.some((message: any) => JSON.stringify(message.content).includes("slow")) ? pending.promise : "first answer");
	t.after(() => live.runtime.close());
	const source = steeringSession(manager);
	live.ctx.isIdle = () => source.session.isIdle;
	await live.execute({ action: "start", task: "first" });
	await live.execute({ action: "start", task: "slow" });
	await live.execute({ action: "wait", ids: ["agent#1"] });
	source.messages.push("already queued");
	const queued = await live.execute({ action: "wait", ids: ["agent#2"] });
	assert.equal(queued.details.reason, "steered");
	source.messages.length = 0;
	source.session.agent.steeringQueue.messages.push({ role: "custom", customType: "service", content: "notice" });
	let settled = false;
	const waiting = live.execute({ action: "wait", ids: ["agent#2"] }).then((value: any) => { settled = true; return value; });
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(settled, false);
	source.emit({ type: "queue_update", steering: [], followUp: ["service"] });
	source.messages.push("next");
	source.emit({ type: "queue_update", steering: [...source.messages], followUp: [] });
	source.session.agent.steeringQueue.messages.push({ role: "user", content: "next" });
	assert.equal((await waiting).details.reason, "steered");
	assert.equal(source.listeners.size, 0);
	assert.equal((await live.execute({ action: "status", ids: ["agent#2"] })).details.statuses[0].state !== "completed", true);
	pending.resolve("slow answer");
	source.messages.length = 0;
	source.session.agent.steeringQueue.messages.length = 0;
	const result = await live.execute({ action: "wait", ids: ["agent#2"] });
	assert.match(result.details.results[0].text, /slow answer/);
});

/** The assistant message that announces a batch of tool calls, as Pi persists it before the tools run. */
function announceBatch(manager: SessionManager, ...calls: object[]) {
	manager.appendMessage({ role: "assistant", content: calls.map(call => ({ type: "toolCall", ...call })), stopReason: "toolUse", timestamp: 1 } as any);
}
const agentWait = (id: string, target = "agent#1") => ({ id, name: "agent", arguments: { action: "wait", ids: [target] } });
const bashCall = { id: "bash", name: "bash", arguments: { command: "make" } };

test("an agent wait in a batch with other work returns work_pending at once and consumes nothing", async t => {
	const root = await temp(t);
	const manager = SessionManager.inMemory(root);
	const live = runtimeFixture(manager, root);
	t.after(() => live.runtime.close());
	const announced: unknown[] = [];
	live.events.on("rqw:waiting:v1", (event: unknown) => announced.push(event));
	await live.execute({ action: "start", task: "first" });
	for (const calls of [[agentWait("w"), bashCall], [bashCall, agentWait("w")]]) {
		announceBatch(manager, ...calls);
		const outcome: any = await Promise.race([live.execute({ action: "wait", ids: ["agent#1"] }, "w"), new Promise(resolve => setImmediate(() => resolve("blocked")))]);
		assert.notEqual(outcome, "blocked", "the wait must not hold the other call of its batch");
		assert.equal(outcome.details.reason, "work_pending");
		assert.deepEqual(outcome.details.results, []);
	}
	assert.deepEqual(announced, []);
	announceBatch(manager, agentWait("again"));
	const result = await live.execute({ action: "wait", ids: ["agent#1"] }, "again");
	assert.match(result.details.results[0].text, /answer/);
});

test("codemode agent wait returns immediately without consuming the child answer", async t => {
	const root = await temp(t);
	const manager = SessionManager.inMemory(root);
	const pending = Promise.withResolvers<string>();
	const live = runtimeFixture(manager, root, () => pending.promise);
	t.after(() => live.runtime.close());
	await live.execute({ action: "start", task: "slow" });
	announceBatch(manager, { id: "script", name: "codemode", arguments: {} });
	announceBatch(manager, { id: "later", name: "bash", arguments: {} });
	const result: any = await Promise.race([live.execute({ action: "wait", ids: ["agent#1"] }, "script/1"), new Promise(resolve => setImmediate(() => resolve("blocked")))]);
	assert.notEqual(result, "blocked");
	assert.equal(result.details.reason, "direct_wait_required");
	assert.deepEqual(result.details.results, []);
	announceBatch(manager, agentWait("direct"));
	const direct = live.execute({ action: "wait", ids: ["agent#1"] }, "direct");
	await new Promise(resolve => setImmediate(resolve));
	pending.resolve("answer");
	assert.match((await direct).details.results[0].text, /answer/);
});

test("in Pi's sequential batch an agent wait before bash yields, so bash runs while the child goes on", async t => {
	const root = await temp(t);
	const manager = SessionManager.inMemory(root);
	const pending = Promise.withResolvers<string>();
	const live = runtimeFixture(manager, root, () => pending.promise);
	t.after(() => live.runtime.close());
	await live.execute({ action: "start", task: "slow" });
	const core = createFauxCore({ provider: "sequential", models: [{ id: "model" }] });
	core.setResponses([
		() => fauxAssistantMessage([fauxToolCall("agent", { action: "wait", ids: ["agent#1"] }, { id: "w" }), fauxToolCall("probe", {}, { id: "p" })], { stopReason: "toolUse", timestamp: 1 }),
		() => fauxAssistantMessage("done", { timestamp: 1 }),
	]);
	const ran: string[] = [];
	const wait = { name: "agent", label: "agent", description: "agent", parameters: live.parameters(), execute: (id: string, params: any, signal: AbortSignal) => live.execute(params, id, signal) };
	const probe = { name: "probe", label: "probe", description: "bash stand-in", parameters: { type: "object", properties: {} }, executionMode: "sequential", execute: async () => { ran.push("probe"); return { content: [{ type: "text", text: "ran" }], details: {} }; } };
	const agent = new Agent({ streamFn: core.streamSimple, getApiKey: () => "key", initialState: { model: core.getModel("model")!, tools: [wait, probe] as any } });
	// Pi persists the assistant message before its tools run.
	agent.subscribe(event => { if (event.type === "message_end" && event.message.role === "assistant") manager.appendMessage(event.message); });
	t.after(() => agent.abort());
	void agent.prompt("go");
	for (let turn = 0; turn < 10 && !ran.length; turn++) await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(ran, ["probe"]);
	pending.resolve("late");
});

test("a real open wait keeps both activity indicators busy until it closes", async t => {
	const env = process.env.HERDR_ENV; process.env.HERDR_ENV = "1";
	t.after(() => { if (env === undefined) delete process.env.HERDR_ENV; else process.env.HERDR_ENV = env; });
	const writes: string[] = [];
	t.mock.method(process.stdout, "write", (chunk: string) => { writes.push(String(chunk)); return true; });
	const root = await temp(t);
	const manager = SessionManager.inMemory(root);
	const pending = Promise.withResolvers<string>();
	const live = runtimeFixture(manager, root, () => pending.promise);
	t.after(() => live.runtime.close());
	await live.execute({ action: "start", task: "slow" });
	const core = createFauxCore({ provider: "waiting-main", models: [{ id: "model" }] });
	core.setResponses([
		() => fauxAssistantMessage([fauxToolCall("agent", { action: "wait", ids: ["agent#1"] }, { id: "wait" })], { stopReason: "toolUse", timestamp: 1 }),
		() => fauxAssistantMessage("done", { timestamp: 2 }),
	]);
	const wait = { name: "agent", label: "agent", description: "agent", parameters: live.parameters(), execute: (id: string, params: any, signal: AbortSignal) => live.execute(params, id, signal) };
	const main = new Agent({ streamFn: core.streamSimple, getApiKey: () => "key", initialState: { model: core.getModel("model")!, tools: [wait] as any } });
	const states: string[] = [];
	const herdr = { path: "herdr-agent-state.ts", handlers: new Map<string, Function[]>([
		["agent_start", [() => states.push("working")]],
		["agent_settled", [(_event: unknown, ctx: any) => { if (ctx.isIdle()) states.push("idle"); }]],
	]) };
	const session: any = Object.assign(Object.create(AgentSession.prototype), { sessionManager: manager, agent: main, _extensionRunner: { extensions: [herdr] }, getSteeringMessages: () => [], subscribe: () => () => {} });
	Object.defineProperty(session, "_isAgentRunActive", { get: () => main.state.isStreaming });
	const ctx: any = { mode: "tui", sessionManager: manager, isIdle: () => session.isIdle };
	live.ctx.isIdle = ctx.isIdle;
	const hooks = new Map<string, Function[]>();
	const pi: any = { events: live.events, on(name: string, fn: Function) { hooks.set(name, [...hooks.get(name) ?? [], fn]); } };
	const counts = registerRunningCounts(pi);
	registerHerdrActivity(pi, counts); registerTerminalActivity(pi, counts);
	for (const hook of hooks.get("session_start") ?? []) hook({}, ctx);
	const term = new ProcessTerminal(); (term as any).programStatusSupported = true;
	const reporterPath = new URL("./modes/interactive/program-status-reporter.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
	const { ProgramStatusReporter } = await import(reporterPath.href);
	const reporter = new ProgramStatusReporter(() => term, () => undefined);
	t.after(() => { for (const hook of hooks.get("session_shutdown") ?? []) hook({}, ctx); (term as any).clearProgressInterval(); main.abort(); });
	const opened = Promise.withResolvers<void>();
	live.events.on("rqw:waiting:v1", (event: any) => { if (event.call === "wait" && event.open) opened.resolve(); });
	main.subscribe(event => {
		reporter.handleEvent(event);
		if (event.type === "agent_start") {
			for (const hook of herdr.handlers.get("agent_start")!) hook(event, ctx);
		}
		if (event.type === "turn_start") term.setProgress(true);
		if (event.type === "agent_end") term.setProgress(false);
		if (event.type === "message_end" && event.message.role === "assistant") manager.appendMessage(event.message);
	});
	const run = main.prompt("go");
	await opened.promise;
	assert.equal(main.state.isStreaming, true);
	assert.deepEqual(states, ["working"]);
	assert.equal((term as any).programStatus.state, "working");
	assert.ok(writes.includes(formatProgramStatus({ state: "working", app: "pi" })));
	pending.resolve("answer");
	await run;
	reporter.handleEvent({ type: "agent_settled", aborted: false });
	for (const hook of herdr.handlers.get("agent_settled")!) hook({}, ctx);
	assert.equal(main.state.isStreaming, false);
	assert.deepEqual(states, ["working", "idle"]);
	assert.equal((term as any).programStatus.state, "done");
});

test("an agent wait alone announces itself open until it returns", async t => {
	const root = await temp(t);
	const manager = SessionManager.inMemory(root);
	const pending = Promise.withResolvers<string>();
	const live = runtimeFixture(manager, root, () => pending.promise);
	t.after(() => live.runtime.close());
	const announced: unknown[] = [];
	live.events.on("rqw:waiting:v1", (event: unknown) => announced.push(event));
	await live.execute({ action: "start", task: "slow" });
	announceBatch(manager, agentWait("w"), { id: "j", name: "job", arguments: { action: "wait", ids: ["job#1"] } });
	const waiting = live.execute({ action: "wait", ids: ["agent#1"] }, "w");
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(announced, [{ sessionId: manager.getSessionId(), call: "w", open: true }]);
	pending.resolve("late answer");
	assert.equal((await waiting).details.reason, "result");
	assert.deepEqual(announced.at(-1), { sessionId: manager.getSessionId(), call: "w", open: false });
});

test("send wakes a restored child core waiting for its own child", async t => {
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const initial = runtimeFixture(parent, root, () => "seed done");
	await initial.execute({ action: "start", task: "seed", tools: [] });
	await initial.runtime.wait(new AbortController().signal);
	initial.runtime.close();
	const reopened = SessionManager.open(parent.getSessionFile()!);
	const nested = Promise.withResolvers<string>();
	const waiting = Promise.withResolvers<void>();
	const redirected = Promise.withResolvers<any>();
	const live = runtimeFixture(reopened, root, context => {
		const messages = context.messages;
		if (messages.some((message: any) => message.role === "user" && JSON.stringify(message.content).includes("nested task"))) return nested.promise;
		if (messages.some((message: any) => message.role === "user" && JSON.stringify(message.content).includes("new direction"))) { redirected.resolve(context); return "steered answer"; }
		if (messages.some((message: any) => message.role === "toolResult" && message.toolCallId === "start-nested"))
			return fauxAssistantMessage([fauxToolCall("agent", { action: "wait", ids: ["agent#1"] }, { id: "nested-wait" })], { stopReason: "toolUse" });
		return fauxAssistantMessage([fauxToolCall("agent", { action: "start", task: "nested task", tools: [] }, { id: "start-nested" })], { stopReason: "toolUse" });
	}, 20);
	live.events.on("rqw-codex:session-policy", (request: any) => {
		request.session.subscribe((event: any) => {
			if (event.type === "tool_execution_start" && event.toolCallId === "nested-wait") waiting.resolve();
		});
	});
	try {
		await live.execute({ action: "send", id: "agent#1", task: "start nested" });
		await waiting.promise;
		await live.execute({ action: "send", id: "agent#1", task: "new direction" });
		const request = await redirected.promise;
		const waitResult = request.messages.find((message: any) => message.role === "toolResult" && message.toolCallId === "nested-wait");
		assert.match(waitResult.content[0].text, /^interrupted; still running: agent#1$/);
		nested.resolve("nested done");
		await live.runtime.wait(new AbortController().signal);
	} finally {
		nested.resolve("nested done");
		live.runtime.close();
	}
});

const catalog = {
	names: ["rqw_readfile", "bash", "edit", "write", "rqw_rg", "rqw_glob"],
	aliases: { read: "rqw_readfile", grep: "rqw_rg", find: "rqw_glob" },
};

function offerCatalog(events: ReturnType<typeof createEventBus>) {
	events.on("rqw-tools:subagent-tools", (request: any) => request.offer(() => catalog.names.map(name => ({
		name, label: name, description: name, parameters: { type: "object", properties: {} },
		execute: async () => ({ content: [{ type: "text", text: name }], details: {} }),
	})), catalog));
}

test("only ordinary children send automatic progress after 50 tool responses", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	for (const fork of [false, true]) {
		const parent = SessionManager.create(root, join(root, fork ? "fork" : "ordinary"));
		parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
		let steps = 0;
		let summaries = 0;
		const live = runtimeFixture(parent, root, () => ++steps <= 50
			? fauxAssistantMessage([fauxToolCall("read", {}, { id: `read-${steps}` })], { stopReason: "toolUse" }) : "done", 52, false, offerCatalog);
		live.events.on("rqw:context-fork:v1", (request: any) => { summaries++; request.offer(async () => fauxAssistantMessage("progress")); });
		await live.execute({ action: "start", task: "work", tools: ["read"], ...(fork ? { fork_turns: "all" } : {}) });
		await live.runtime.wait(new AbortController().signal);
		assert.equal(summaries, fork ? 0 : 1);
		assert.equal(parent.getBranch().filter((entry: any) => entry.customType === "agent_progress").length, fork ? 0 : 1);
		live.runtime.close();
	}
});

test("a progress notice received by a busy caller gets one continuation", async t => {
	const root = await temp(t);
	const parent = SessionManager.inMemory(root);
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const gate = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
	let steps = 0;
	const live = runtimeFixture(parent, root, () => ++steps <= 50
		? fauxAssistantMessage([fauxToolCall("read", {}, { id: `read-${steps}` })], { stopReason: "toolUse" }) : gate.promise, 52, false, offerCatalog);
	t.after(() => { gate.resolve(fauxAssistantMessage("done")); live.runtime.close(); });
	live.ctx.isIdle = () => false;
	live.events.on("rqw:context-fork:v1", (request: any) => request.offer(async () => fauxAssistantMessage("progress")));
	await live.execute({ action: "start", task: "work", tools: ["read"] });
	await until(() => parent.getBranch().some((entry: any) => entry.customType === "agent_progress"));
	assert.deepEqual(await live.emit("agent_before_settle"), { continue: true });
	parent.appendMessage(fauxAssistantMessage("seen"));
	assert.equal(await live.emit("agent_before_settle"), undefined);
});

test("nested progress wakes its idle parent after its final", async t => {
	const root = await temp(t);
	const parent = SessionManager.inMemory(root);
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const report = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
	const childGate = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
	const live = runtimeFixture(parent, root, context => {
		const task = userTexts(context)[0];
		const results = context.messages.filter((message: any) => message.role === "toolResult");
		if (task === "nested") return results.length < 50
			? fauxAssistantMessage([fauxToolCall("rqw_readfile", {}, { id: `nested-${results.length}` })], { stopReason: "toolUse" }) : childGate.promise;
		if (JSON.stringify(context.messages).includes("has worked 50 tool-call steps")) return "saw progress";
		if (results.length) return "parent final";
		return fauxAssistantMessage([fauxToolCall("agent", { action: "start", task: "nested", tools: ["rqw_readfile"] }, { id: "delegate" })], { stopReason: "toolUse" });
	}, 60, false, offerCatalog);
	t.after(() => { report.resolve(fauxAssistantMessage("progress")); childGate.resolve(fauxAssistantMessage("done")); live.runtime.close(); });
	live.events.on("rqw:context-fork:v1", (request: any) => request.offer(() => report.promise));
	await live.execute({ action: "start", task: "outer", tools: ["rqw_readfile"] });
	const final = await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.match(final.details.results[0].text, /^parent final/);
	await until(() => live.requests.some((request: any) => userTexts(request)[0] === "nested" && request.messages.filter((message: any) => message.role === "toolResult").length === 50));
	report.resolve(fauxAssistantMessage("progress"));
	await until(() => live.requests.some((request: any) => JSON.stringify(request.messages).includes("has worked 50 tool-call steps")));
});

test("old result inbox records stay historical when a child resumes", async t => {
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root);
	await first.execute({ action: "start", task: "first", tools: [] });
	await first.runtime.wait(new AbortController().signal);
	const child = retainedChildManager(parent, "agent", 1)!;
	for (const type of ["agent", "child_wait", "job"]) {
		child.appendCustomEntry("rqw-agent-inbox", { version: 1, id: type, message: { customType: type, content: `old ${type}`, display: true } });
	}
	first.runtime.close();
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	await restored.execute({ action: "send", id: "agent#1", task: "continue" });
	await restored.runtime.wait(new AbortController().signal);
	assert.doesNotMatch(JSON.stringify(restored.requests), /old (agent|child_wait|job)/);
	restored.runtime.close();
});

test("an old inbox receipt is delivered only after its message reaches the branch", async t => {
	const root = await temp(t);
	for (const scenario of ["unseen", "seen", "other-branch", "earlier-call", "sibling-inbox"]) {
		const parent = SessionManager.create(root, join(root, scenario));
		parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
		const first = runtimeFixture(parent, root);
		await first.execute({ action: "start", task: "task", tools: [] });
		await first.runtime.wait(new AbortController().signal);
		const saved = (parent.getBranch() as any[]).findLast(entry => entry.customType === "rqw-agent-child" && entry.data.result).data.result;
		const details = { results: [{ run: saved.run, delivery: saved.delivery }] };
		const beforeInbox = parent.getLeafId()!;
		parent.appendCustomEntry("rqw-agent-inbox", { version: 1, id: "old", message: { customType: "child_wait", content: "old", display: true, details } });
		if (scenario === "sibling-inbox") parent.branch(beforeInbox);
		if (scenario === "seen") parent.appendCustomMessageEntry("child_wait", "old", true, { ...details, rqw_agent_inbox: "old" });
		if (scenario === "other-branch" || scenario === "earlier-call") {
			const inbox = parent.getLeafId()!;
			const accept = () => parent.appendCustomEntry("rqw-agent-accept", { version: 1, ok: true, root: "same-call", results: [{ run: saved.run, delivery: saved.delivery }] });
			const unrelated = () => parent.appendMessage({ role: "toolResult", toolCallId: "same-call", toolName: "codemode", content: [{ type: "text", text: "unrelated" }], isError: false, timestamp: 1 });
			if (scenario === "other-branch") { accept(); parent.branch(inbox); unrelated(); parent.branch(inbox); }
			else { unrelated(); accept(); }
		}
		recordDelivery(parent, saved.run);
		first.runtime.close();
		const manager = SessionManager.open(parent.getSessionFile()!);
		const inboxBranch = manager.getLeafId()!;
		const restored = runtimeFixture(manager, root);
		const result = await commitWait(restored, manager);
		assert.equal(result.details.results.length, scenario === "seen" ? 0 : 1);
		if (scenario !== "seen") {
			assert.equal(result.details.results[0].delivery, saved.delivery);
			manager.branch(inboxBranch);
			await restored.emit("session_tree");
			const repeated = await restored.execute({ action: "wait", ids: ["agent#1"] }, "repeat");
			assert.deepEqual(repeated.details.results, []);
		}
		restored.runtime.close();
	}
});

test("a fork of an in-memory caller stays in memory", async t => {
	const root = await temp(t);
	const parent = SessionManager.inMemory(root);
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root);
	await live.execute({ action: "start", fork_turns: "all", task: "check" });
	await live.runtime.wait(new AbortController().signal);
	const fork = retainedChildManager(parent, "agent", 1)!;
	assert.equal(fork.getSessionFile(), undefined);
	assert.match(JSON.stringify(fork.buildSessionContext()), /parent/);
	live.runtime.close();
});

test("lost fork history returns an error and preserves an already saved result", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	for (const completed of [false, true]) {
		const parent = SessionManager.create(root, join(root, completed ? "completed" : "running"));
		parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
		const first = runtimeFixture(parent, root, completed ? () => "finished result" : () => new Promise<never>(() => {}));
		await first.execute({ action: "start", fork_turns: "all", task: "check" });
		if (completed) await first.runtime.wait(new AbortController().signal);
		first.runtime.close();
		// Simulate records from the earlier in-memory fork implementation.
		const parentFile = parent.getSessionFile()!;
		const lines = (await readFile(parentFile, "utf8")).trimEnd().split("\n").map(line => {
			const entry = JSON.parse(line);
			if (entry.customType === "rqw-agent-child") delete entry.data.sessionFile;
			return JSON.stringify(entry);
		});
		await writeFile(parentFile, `${lines.join("\n")}\n`);
		const restored = runtimeFixture(SessionManager.open(parentFile), root);
		const result = await restored.execute({ action: "wait", ids: ["agent#1"] });
		const branch = restored.ctx.sessionManager.getBranch();
		const saved = branch.filter((entry: any) => entry.customType === "rqw-agent-child").at(-1).data.result;
		assert.match(saved.text, completed ? /finished result/ : /fork history was lost/);
		if (!completed) assert.match(JSON.stringify([result.details, branch]), /fork history was lost/);
		await assert.rejects(restored.execute({ action: "send", id: "agent#1", task: "continue" }), /fork history was lost/);
		assert.equal(restored.requests.length, 0);
		if (completed) {
			const find = restored.ctx.modelRegistry.find;
			restored.ctx.modelRegistry.find = (provider: string, id: string) => id === "model" ? undefined : find(provider, id);
		}
		await restored.execute({ action: "restart", id: "agent#1", task: "new task", ...(completed ? { model: "persist-test/other" } : {}) });
		await restored.runtime.wait(new AbortController().signal);
		assert.equal(restored.requestModels.at(-1), completed ? "other" : "model");
		const request = restored.requests.at(-1);
		assert.match(JSON.stringify(request.messages), /new task/);
		assert.doesNotMatch(JSON.stringify(request.messages.filter((message: any) => message.role !== "system")), /parent|fork history was lost/);
		first.runtime.close();
		restored.runtime.close();
	}
});

test("a persisted fork stores its reviewer beneath its own session", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root, context => {
		const messages = context.messages.filter((message: any) => message.role !== "system");
		if (messages.some((message: any) => message.role === "user" && JSON.stringify(message.content).includes("review task"))) return "review done";
		if (messages.some((message: any) => message.role === "toolResult")) return "fork done";
		return fauxAssistantMessage([fauxToolCall("agent", { action: "start", task: "review task" }, { id: "review" })], { stopReason: "toolUse" });
	}, 12);
	await live.execute({ action: "start", fork_turns: "all", task: "fork task" });
	await live.runtime.wait(new AbortController().signal);
	const forkDir = `${parent.getSessionFile()}.children/agent-1`;
	const forkFile = join(forkDir, (await readdir(forkDir)).find(file => file.endsWith(".jsonl"))!);
	const reviewDir = `${forkFile}.children/agent-1`;
	const reviewFile = join(reviewDir, (await readdir(reviewDir)).find(file => file.endsWith(".jsonl"))!);
	assert.equal(SessionManager.open(forkFile).getHeader()?.parentSession, parent.getSessionFile());
	assert.equal(SessionManager.open(reviewFile).getHeader()?.parentSession, forkFile);
	live.runtime.close();
});

test("a failed persisted fork resumes after reload with its copied branch", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "copied parent", timestamp: 1 });
	const first = runtimeFixture(parent, root, () => fauxAssistantMessage("failed", { stopReason: "error", errorMessage: "provider down" }));
	await first.execute({ action: "start", fork_turns: "all", task: "fork task" });
	await first.runtime.wait(new AbortController().signal);
	first.runtime.close();
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	await restored.execute({ action: "resume", id: "agent#1" });
	await restored.runtime.wait(new AbortController().signal);
	const messages = JSON.stringify(restored.requests.at(-1).messages);
	assert.match(messages, /copied parent/);
	assert.match(messages, /fork task/);
	assert.doesNotMatch(messages, /fork history was lost/);
	restored.runtime.close();
});

test("nested fork inherits its direct caller branch, prompt and selected tools", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "root only", timestamp: 1 });
	const live = runtimeFixture(parent, root, context => {
		const messages = context.messages.filter((message: any) => message.role !== "system");
		if (messages.some((message: any) => message.role === "user" && JSON.stringify(message.content).includes("fork task"))) return "fork done";
		if (messages.some((message: any) => message.role === "toolResult")) return "outer done";
		return fauxAssistantMessage([fauxToolCall("agent", { action: "start", fork_turns: "all", task: "fork task" }, { id: "nested-fork" })], { stopReason: "toolUse" });
	}, 12, false, offerCatalog);
	await live.execute({ action: "start", task: "outer task", role: "outer role", model: "persist-test/other", tools: ["read"] });
	await live.runtime.wait(new AbortController().signal);
	const request = live.requests.find((item: any) => JSON.stringify(item.messages).includes("fork task"));
	assert.ok(request, "nested fork ran");
	assert.equal(live.requestModels[live.requests.indexOf(request)], "other");
	const text = JSON.stringify(request.messages);
	assert.match(text, /outer task/);
	assert.doesNotMatch(text, /root only/);
	assert.match(text, /outer role/);
	assert.deepEqual(getCurrentTools(request.messages.filter((message: any) => message.role === "system")).map((tool: any) => tool.name).sort(), ["agent", "rqw_readfile"]);
	const outerDir = `${parent.getSessionFile()}.children/agent-1`;
	const outerFile = join(outerDir, (await readdir(outerDir)).find(file => file.endsWith(".jsonl"))!);
	const nestedDir = `${outerFile}.children/agent-1`;
	const nestedFile = join(nestedDir, (await readdir(nestedDir)).find(file => file.endsWith(".jsonl"))!);
	assert.equal(SessionManager.open(nestedFile).getHeader()?.parentSession, outerFile);
	live.runtime.close();
});

test("a child without a tool subset gets the entire offered catalogue", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.inMemory(root);
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root, () => "answer", 8, false, offerCatalog);
	t.after(() => live.runtime.close());
	await live.execute({ action: "start", task: "default" });
	await live.runtime.wait(new AbortController().signal);
	const names = getCurrentTools(live.requests[0].messages.filter((message: any) => message.role === "system")).map((tool: any) => tool.name);
	assert.deepEqual(names.sort(), ["agent", "bash", "edit", "rqw_glob", "rqw_readfile", "rqw_rg", "write"].sort());
});

test("offered catalogue selects child tools and persists portable selectors", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root, () => "answer", 8, false, offerCatalog);
	assert.deepEqual(live.parameters().properties.tools.items.enum, catalog.names);
	await live.execute({ action: "start", task: "one", tools: ["read", "rqw_rg"] });
	await live.runtime.wait(new AbortController().signal);
	assert.deepEqual(getCurrentTools(live.requests[0].messages.filter((message: any) => message.role === "system")).map((tool: any) => tool.name).filter((name: string) => name !== "agent"), ["rqw_readfile", "rqw_rg"]);
	const record = parent.getBranch().find((entry: any) => entry.customType === "rqw-agent-child") as any;
	assert.deepEqual(record.data.config.tools, ["read", "grep"]);
	live.runtime.close();
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	await restored.execute({ action: "send", id: "agent#1", task: "again" });
	await restored.runtime.wait(new AbortController().signal);
	assert.deepEqual(getCurrentTools(restored.requests.at(-1).messages.filter((message: any) => message.role === "system")).map((tool: any) => tool.name).filter((name: string) => name !== "agent"), ["read", "grep"]);
	restored.runtime.close();
});

test("legacy saved subset resumes with the offered catalogue and restart preserves it", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root, () => fauxAssistantMessage("failed", { stopReason: "error", errorMessage: "failed" }));
	await first.execute({ action: "start", task: "old", tools: ["read", "find"] });
	await first.runtime.wait(new AbortController().signal);
	first.runtime.close();
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root, () => "answer", 8, false, offerCatalog);
	await restored.execute({ action: "resume", id: "agent#1" });
	await restored.runtime.wait(new AbortController().signal);
	const names = () => getCurrentTools(restored.requests.at(-1).messages.filter((message: any) => message.role === "system")).map((tool: any) => tool.name).filter((name: string) => name !== "agent");
	assert.deepEqual(names(), ["rqw_readfile", "rqw_glob"]);
	await restored.execute({ action: "restart", id: "agent#1", task: "new" });
	await restored.runtime.wait(new AbortController().signal);
	assert.deepEqual(names(), ["rqw_readfile", "rqw_glob"]);
	restored.runtime.close();
});

test("child codemode can call selected new names but not excluded names", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.inMemory(root);
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root, context => {
		if (context.messages.some((message: any) => message.role === "toolResult")) return "done";
		return fauxAssistantMessage([fauxToolCall("codemode", { code: 'text(await tools.rqw_readfile({})); text("rqw_rg" in tools); text("read" in tools);' }, { id: "code" })], { stopReason: "toolUse" });
	}, 8, true, offerCatalog);
	await live.execute({ action: "start", task: "run", tools: ["rqw_readfile"] });
	await live.runtime.wait(new AbortController().signal);
	const result = live.requests.at(-1).messages.find((message: any) => message.role === "toolResult");
	assert.match(JSON.stringify(result.content), /rqw_readfile/);
	assert.match(JSON.stringify(result.content), /false.*false/);
	live.runtime.close();
});

test("nested child codemode exposes exactly its selected tool subset", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.inMemory(root);
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root, context => {
		const task = context.messages.find((message: any) => message.role === "user")?.content?.[0]?.text;
		const results = context.messages.filter((message: any) => message.role === "toolResult");
		if (task === "outer" && results.length === 1) return fauxAssistantMessage([fauxToolCall("agent", { action: "wait", ids: ["agent#1"] }, { id: "wait-nested" })], { stopReason: "toolUse" });
		if (results.length) return "done";
		if (task === "outer") return fauxAssistantMessage([fauxToolCall("agent", { action: "start", task: "nested", tools: ["rqw_readfile"] }, { id: "delegate" })], { stopReason: "toolUse" });
		return fauxAssistantMessage([fauxToolCall("codemode", { code: "text(JSON.stringify(ALL_TOOLS.map(tool => tool.name).sort()));" }, { id: "nested-code" })], { stopReason: "toolUse" });
	}, 12, true, offerCatalog);
	t.after(() => live.runtime.close());
	await live.execute({ action: "start", task: "outer", tools: ["rqw_readfile"] });
	await live.runtime.wait(new AbortController().signal);
	const nested = live.requests.find((request: any) => request.messages.some((message: any) => message.role === "toolResult" && message.toolCallId === "nested-code"));
	assert.ok(nested, "nested child completed codemode");
	const result = nested.messages.find((message: any) => message.role === "toolResult" && message.toolCallId === "nested-code");
	const output = result.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("");
	const list = output.match(/\[[^\]]*\]/)?.[0];
	assert.ok(list, output);
	assert.deepEqual(JSON.parse(list), ["agent", "rqw_readfile"]);
});

test("a nested child continues after its parent's final and is collected by a later wait", async t => {
	const root = await temp(t);
	const parent = SessionManager.inMemory(root);
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const gate = Promise.withResolvers<string>();
	const entered = Promise.withResolvers<void>();
	const live = runtimeFixture(parent, root, context => {
		const messages = context.messages;
		const users = userTexts(context);
		if (users[0] === "nested") { entered.resolve(); return gate.promise; }
		const results = messages.filter((message: any) => message.role === "toolResult");
		if (users.includes("collect")) {
			if (results.some((message: any) => message.toolCallId === "collect-wait")) return "collected";
			return fauxAssistantMessage([fauxToolCall("agent", { action: "wait", ids: ["agent#1"] }, { id: "collect-wait" })], { stopReason: "toolUse" });
		}
		if (results.length) return "parent final";
		return fauxAssistantMessage([fauxToolCall("agent", { action: "start", task: "nested", tools: [] }, { id: "start-nested" })], { stopReason: "toolUse" });
	}, 12);
	t.after(() => { gate.resolve("nested answer"); live.runtime.close(); });
	await live.execute({ action: "start", task: "outer", tools: [] });
	await entered.promise;
	let first: any;
	void live.execute({ action: "wait", ids: ["agent#1"] }).then(result => { first = result; }).catch(() => {});
	await until(() => first !== undefined);
	assert.match(first.details.results[0].text, /^parent final/);
	assert.equal(live.runtime.runningCounts().agents, 1);
	await live.execute({ action: "send", id: "agent#1", task: "collect" });
	await until(() => live.requests.some((request: any) => userTexts(request).includes("collect")));
	gate.resolve("nested answer");
	const second = await live.execute({ action: "wait", ids: ["agent#1"] }, "second");
	assert.match(second.details.results[0].text, /^collected/);
	const request = live.requests.findLast((item: any) => item.messages.some((message: any) => message.role === "toolResult" && message.toolCallId === "collect-wait"));
	assert.match(JSON.stringify(request.messages), /nested answer/);
});

const REMINDER = "<subagent>\nYou are an agent in a team of agents collaborating to complete a task.\nWhen you provide your final answer, that content is immediately delivered back to your parent agent.\nIn addition, your final answer may be read by a human, so ensure it is legible.\nAny earlier instruction enabling proactive multi-agent delegation no longer applies. Do not spawn sub-agents unless the user, your task, role or system prompt, or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.\n</subagent>";
const CURSOR_REMINDER = "<subagent>\nYou are running as a subagent under a parent agent. Do not spawn additional subagents unless requested by the user or by your instructions.\n</subagent>";

test("send preserves an unread result across another run and restart", async t => {
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root, context => `answer ${userTexts(context).at(-1)}`);
	await live.execute({ action: "start", task: "one", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	await live.execute({ action: "send", id: "agent#1", task: "two" });
	await live.runtime.wait(new AbortController().signal);
	live.runtime.close();
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	t.after(() => restored.runtime.close());
	const first = await commitWait(restored, restored.ctx.sessionManager);
	assert.match(first.details.results[0].text, /^answer one/);
	const second = await commitWait(restored, restored.ctx.sessionManager);
	assert.match(second.details.results[0].text, /^answer two/);
	const repeat = await restored.execute({ action: "wait", ids: ["agent#1"] }, "repeat");
	assert.deepEqual(repeat.details.results, []);
});

test("a finished child is silent until an explicit wait", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root);
	await live.execute({ action: "start", task: "one", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	const pushed = parent.getEntries().filter((entry: any) => entry.type === "custom_message" && entry.customType === "agent") as any[];
	assert.deepEqual(pushed, []);
	const waited = await commitWait(live, parent);
	assert.equal(waited.details.results[0].text, `answer\n\n${FOLLOW_UP}`);
	const repeated = await live.execute({ action: "wait", ids: ["agent#1"] }, "repeat");
	assert.deepEqual(repeated.details.results, []);
	live.runtime.close();
});

const LEGACY_REMINDER = "<subagent>\nYou are running as a subagent: a caller agent started you through a tool and gave you your task.\nYour final answer goes to that caller, not to the user: answer it with what it asked for.\nInstructions above that address the main agent do not apply to you.\n</subagent>";

/** Starts a child, closes it, lets `edit` rewrite its saved prompt, restores it and returns the system prompt of its next request. */
async function restoredSystem(t: TestContext, start: Record<string, unknown>, edit: (system: string) => string) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const source = runtimeFixture(parent, root);
	await source.execute({ action: "start", task: "task", tools: [], ...start });
	await source.runtime.wait(new AbortController().signal);
	source.runtime.close();
	const full = parent.getBranch().find((entry: any) => entry.customType === "rqw-agent-child") as any;
	// An older record holds the whole prompt and its base inline, not a tail and a base ref.
	const config = full.data.config;
	config.base = "original prompt";
	delete config.base_ref;
	config.system = edit(config.system ?? `${config.base.trimEnd()}${config.system_tail}`);
	delete config.system_tail;
	const restored = runtimeFixture(parent, root);
	await restored.execute({ action: "send", id: "agent#1", task: "again" });
	await restored.runtime.wait(new AbortController().signal);
	const system = restored.requests.at(-1).messages.find((message: any) => message.role === "system").content;
	restored.runtime.close();
	return system;
}

test("an ordinary prompt is stored as its tail after base and restores byte for byte", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const source = runtimeFixture(parent, root);
	await source.execute({ action: "start", task: "task", tools: [], role: "R" });
	await source.runtime.wait(new AbortController().signal);
	source.runtime.close();
	const full = (parent.getBranch().find((entry: any) => entry.customType === "rqw-agent-child") as any).data.config;
	assert.equal(full.system, undefined);
	assert.equal(full.system_tail, `\n\n${REMINDER}\n\n<role>\nR\n</role>`);
	const restored = runtimeFixture(parent, root);
	await restored.execute({ action: "send", id: "agent#1", task: "again" });
	await restored.runtime.wait(new AbortController().signal);
	assert.equal(restored.requests.at(-1).messages.find((message: any) => message.role === "system").content,
		`original prompt\n\n${REMINDER}\n\n<role>\nR\n</role>`);
	restored.runtime.close();
});

// Regression: every child record repeated the whole main prompt as `base`, two thirds of a long session file.
test("children of one parent write the base prompt once and restore from it byte for byte", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const source = runtimeFixture(parent, root);
	await source.execute({ action: "start", task: "one", tools: [], role: "R" });
	await source.execute({ action: "start", task: "two", tools: [], role: "S" });
	await source.runtime.wait(new AbortController().signal);
	source.runtime.close();
	assert.equal((await readFile(parent.getSessionFile()!, "utf8")).split("original prompt").length - 1, 1);
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	await restored.execute({ action: "send", id: "agent#2", task: "again" });
	await restored.runtime.wait(new AbortController().signal);
	assert.equal(restored.requests.at(-1).messages.find((message: any) => message.role === "system").content,
		`original prompt\n\n${REMINDER}\n\n<role>\nS\n</role>`);
	restored.runtime.close();
});

test("a record from before base refs restores from its inline base", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const source = runtimeFixture(parent, root);
	await source.execute({ action: "start", task: "task", tools: [], role: "R" });
	await source.runtime.wait(new AbortController().signal);
	source.runtime.close();
	// The released format: `base` inline beside `system_tail`, no base entry.
	const config = (parent.getBranch().find((entry: any) => entry.customType === "rqw-agent-child") as any).data.config;
	config.base = "legacy base\n";
	delete config.base_ref;
	const restored = runtimeFixture(parent, root);
	await restored.execute({ action: "send", id: "agent#1", task: "again" });
	await restored.runtime.wait(new AbortController().signal);
	assert.equal(restored.requests.at(-1).messages.find((message: any) => message.role === "system").content,
		`legacy base\n\n${REMINDER}\n\n<role>\nR\n</role>`);
	restored.runtime.close();
});

test("an own system prompt that begins with the base is still saved whole", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root);
	await live.execute({ action: "start", task: "task", tools: [], system: "original prompt and more" });
	await live.runtime.wait(new AbortController().signal);
	const config = (parent.getBranch().find((entry: any) => entry.customType === "rqw-agent-child") as any).data.config;
	assert.equal(config.system, `original prompt and more\n\n${REMINDER}`);
	assert.equal(config.system_tail, undefined);
	live.runtime.close();
});

for (const legacy of [LEGACY_REMINDER, CURSOR_REMINDER]) {
	test("a restored child replaces an old reminder in place, role bytes unchanged", async t => {
		const system = await restoredSystem(t, { role: "  R\n" }, text => text.replace(REMINDER, legacy));
		assert.equal(system, `original prompt\n\n${REMINDER}\n\n<role>\nR\n</role>`);
	});
}

test("a restored custom prompt saved without any reminder gets the reminder appended", async t => {
	assert.equal(await restoredSystem(t, { system: "CUSTOM" }, () => "CUSTOM"), `CUSTOM\n\n${REMINDER}`);
});

test("restoring a prompt that already has the reminder leaves it unchanged", async t => {
	assert.equal(await restoredSystem(t, { system: "CUSTOM" }, text => text), `CUSTOM\n\n${REMINDER}`);
});

test("a resumed failed child runs with the current reminder", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	let fail = true;
	const answer = (): any => fail ? fauxAssistantMessage("boom", { stopReason: "error", errorMessage: "provider down" }) : fauxAssistantMessage("fine");
	const source = runtimeFixture(parent, root, answer);
	await source.execute({ action: "start", task: "task", tools: [] });
	await source.runtime.wait(new AbortController().signal);
	source.runtime.close();
	(parent.getBranch().find((entry: any) => entry.customType === "rqw-agent-child") as any).data.config.system = LEGACY_REMINDER;
	fail = false;
	const restored = runtimeFixture(parent, root, answer);
	await restored.execute({ action: "resume", id: "agent#1" });
	await restored.runtime.wait(new AbortController().signal);
	assert.equal(restored.requests.at(-1).messages.find((message: any) => message.role === "system").content, REMINDER);
	restored.runtime.close();
});

async function resumedLive(t: TestContext, system: string) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	let fail = true;
	const live = runtimeFixture(parent, root, (): any => fail ? fauxAssistantMessage("boom", { stopReason: "error", errorMessage: "provider down" }) : fauxAssistantMessage("fine"));
	await live.execute({ action: "start", task: "task", tools: [], system });
	await live.runtime.wait(new AbortController().signal);
	fail = false;
	await live.execute({ action: "resume", id: "agent#1" });
	await live.runtime.wait(new AbortController().signal);
	const resumed = live.requests.at(-1).messages.find((message: any) => message.role === "system").content;
	live.runtime.close();
	return resumed;
}

// A live child never saves the legacy block itself, so the start prompt carries it as plain text beside the appended current reminder.
test("resuming a live failed child replaces the legacy block in place", async t => {
	assert.equal(await resumedLive(t, `CUSTOM\n\n${LEGACY_REMINDER}`), `CUSTOM\n\n${REMINDER}\n\n${REMINDER}`);
});

test("custom system and system_file prompts still get the subagent reminder last", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	await writeFile(join(root, "whole.txt"), "FROM FILE\n", "utf8");
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root);
	await live.execute({ action: "start", task: "one", tools: [], system: "CUSTOM" });
	await live.execute({ action: "start", task: "two", tools: [], system_file: "whole.txt" });
	await live.runtime.wait(new AbortController().signal);
	const systems = new Map(live.requests.map((request: any) => [request.messages.find((m: any) => m.role === "user").content[0].text, request.messages.find((m: any) => m.role === "system").content]));
	assert.equal(systems.get("one"), `CUSTOM\n\n${REMINDER}`);
	assert.equal(systems.get("two"), `FROM FILE\n\n\n${REMINDER}`);
	const description = live.parameters().properties.system.description;
	assert.match(description, /subagent reminder is still appended/);
	assert.doesNotMatch(description, /replacing the default \(your prompt, the subagent reminder/);
	live.runtime.close();
});

test("registered description and parameters carry adapted Codex guidance", async t => {
	const root = await temp(t);
	const live = runtimeFixture(SessionManager.create(root, join(root, "parent")), root);
	await live.emit("session_start");
	assert.match(live.description(), /\n\nAvailable roles:\n/);
	const properties = live.parameters().properties;
	assert.equal(properties.id.description, "Agent id to send a follow-up task to, resume, interrupt, stop or restart (from start): agent#N or N.");
	assert.equal(properties.ids.description, "Agent ids to wait on or to inspect with status: full direct child IDs agent#N. Pass multiple ids to wait for whichever finishes first.");
	assert.equal(properties.timeout_ms.description, "Timeout in milliseconds. Defaults to 300000, min 1, no max. Prefer longer waits (minutes) to avoid busy polling.");
	assert.equal(properties.messages.description, "Status peek length; default 8");
	assert.equal(properties.until.description, "wait: first terminal result (default), or hold results until all selected targets are terminal");
	assert.equal(properties.wake_on_alert.description, "wait: return one short line on a new structured alert without consuming a result; default false, alerts never wake a wait");
	assert.equal(properties.depth.description, "status: descendant generations to include, read-only; default 0");
	assert.equal(properties.alert_after_ms.description, "start/restart: long-turn alert threshold in milliseconds, positive safe integer; disabled by default, inherited on restart");
	assert.equal(properties.system.description, "Whole system prompt, replacing the default (your prompt and role); the subagent reminder is still appended after it; start, restart");
	assert.equal(properties.role.description, "Short role text added after the default prompt; start, restart");
	assert.equal(properties.system_file.description, "start, restart: UTF-8 whole-prompt file, relative to caller cwd; conflicts with system and either role option");
	assert.equal(properties.role_file.description, "start, restart: UTF-8 role file, relative to caller cwd; conflicts with role and either system option");
	assert.equal(properties.include.description, "start, restart: append verbatim user-role text from this caller's current session branch after the task");
	assert.equal(properties.title.description, "Short title, 3-5 words, shown in status and result headers; start, restart. Make it concrete and distinct, consider recent titles to avoid reuse.");
	assert.equal(properties.agent_type.description, "Agent type override for the new agent. Omit unless explicitly asked. Restart inherits and revalidates the selected agent_type. The roles are listed at the end of the tool description.");
	assert.equal(properties.task.description, "Initial plain-text task for the new agent, or the message text to send to the target agent with send or restart.");
	assert.equal(properties.model.description, "Model override for the new agent, as provider/id. Omit unless an explicit override is needed. If omitted: on restart, the previous model if it was given explicitly (a previous model that came from the agent_type profile is dropped and the profile is re-read); otherwise the agent_type profile's model, if it has one; otherwise the caller's model.");
	assert.equal(properties.thinking.description, "Reasoning effort override for the new agent. Omit to inherit the parent effort, unless the selected agent_type sets one.");
	assert.equal(properties.tools.description, "Base subset; default all. Recursive agent delegation stays available.");
	assert.equal(properties.fast_gpt.description, "GPT Fast for this child; default: inherit yours. false when the user forbids Fast for subagents; send and restart may change it");
	assert.equal(properties.interrupt.description, "send only: True interrupts the current task and starts this message as soon as the interrupted run has stopped; false or omitted queues it. A queued message reaches a running agent after its current tool call; an interrupt drops queued messages and keeps history.");
	live.runtime.close();
});

test("runtime persistence restores full-first short-later configuration and child history", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root);
	await first.execute({ action: "start", task: "original task", system: "saved prompt", tools: [], thinking: "off", title: "saved title", fast_gpt: true });
	await first.runtime.wait(new AbortController().signal);
	const records = parent.getBranch().filter((entry: any) => entry.customType === "rqw-agent-child") as any[];
	assert.equal(records[0].data.config.system, `saved prompt\n\n${REMINDER}`);
	assert.ok(records.slice(1).some(entry => entry.data.config === undefined && entry.data.task === undefined));
	first.runtime.close();
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	const status = await restored.execute({ action: "status", ids: ["agent#1"] });
	assert.equal(status.details.statuses[0].title, "saved title");
	await restored.execute({ action: "send", id: "agent#1", task: "follow-up" });
	await restored.runtime.wait(new AbortController().signal);
	const request = restored.requests.at(-1);
	assert.equal(request.messages.find((message: any) => message.role === "system").content, `saved prompt\n\n${REMINDER}`);
	assert.deepEqual(request.messages.filter((message: any) => message.role !== "system").map((message: any) => message.role), ["user", "assistant", "user"]);
	assert.deepEqual(request.messages.find((message: any) => message.role === "assistant").content, [{ type: "text", text: "answer" }]);
	assert.deepEqual(request.messages.filter((message: any) => message.role === "user").map((message: any) => message.content),
		[[{ type: "text", text: "original task" }], [{ type: "text", text: "follow-up" }]]);
	restored.runtime.close();
});

test("selected-branch fold isolates generations, corrupt siblings and genuine result delivery", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const source = runtimeFixture(parent, root);
	await source.execute({ action: "start", task: "task", tools: [], title: "branch A" });
	await source.runtime.wait(new AbortController().signal);
	source.runtime.close();
	const records = parent.getBranch().filter((entry: any) => entry.customType === "rqw-agent-child") as any[];
	const latest = mergeSaved(records[0].data, records.at(-1).data);
	const record = (data: any) => ({ type: "custom", customType: "rqw-agent-child", data });
	const base = parent.getBranch().find((entry: any) => entry.customType === "rqw-agent-base");
	const branchA: any[] = [records[0], record({ ...latest, config: undefined, task: undefined }),
		record({ ...latest, id: 2, epoch: "stopped", state: "stopped" }),
		record({ ...latest, id: 3, config: { ...latest.config, system: null } }),
		{ type: "message", message: { role: "assistant", content: latest.result.run } }, base];
	const branchB = branchA.map(entry => entry.data?.id === 1 ? record({ ...entry.data, title: "branch B" }) : entry);
	// A real result detail suppresses delivery, even though prose on A did not.
	branchB[4] = { type: "custom_message", details: { results: [{ run: latest.result.run }] } };
	parent.appendCustomEntry("rqw-agent-child", { ...latest, id: 9, state: "stopped" });
	let selected = branchA;
	t.mock.method(parent, "getBranch", () => selected);
	const restored = runtimeFixture(parent, root);
	restored.ctx.mode = "print";
	await restored.emit("agent_end");
	const first = await restored.execute({ action: "status", ids: ["agent#1", "agent#2", "agent#3"] });
	assert.deepEqual(first.details.statuses.map((status: any) => [status.id, status.title, status.state]),
		[["agent#1", "branch A", "idle"], ["agent#2", undefined, undefined], ["agent#3", undefined, "unavailable"]]);
	assert.match(first.details.statuses[1].error, /Unknown/);
	const result = await restored.execute({ action: "wait", ids: ["agent#1"] });
	assert.deepEqual(result.details.results.map((item: any) => [item.run, item.text]), [[latest.result.run, `answer\n\n${FOLLOW_UP}`]]);
	const repeated = await restored.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(repeated.details.results.length, 0);
	selected = branchB;
	await restored.emit("session_tree");
	const second = await restored.execute({ action: "status", ids: ["agent#1"] });
	assert.equal(second.details.statuses[0].title, "branch B");
	const delivered = await restored.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(delivered.details.results.length, 0);
	const allocated = await restored.execute({ action: "start", task: "new task", tools: [] });
	assert.equal(allocated.content[0].text, "agent#10 started");
	await restored.runtime.wait(new AbortController().signal);
	restored.runtime.close();
});

test("completed children wait without opening siblings and materialize only for send or exact status", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const source = runtimeFixture(parent, root);
	for (const task of ["task A", "task B"]) {
		await source.execute({ action: "start", task, tools: [], system: "saved prompt" });
		await source.runtime.wait(new AbortController().signal);
	}
	source.runtime.close();
	const lastB = parent.getBranch().findLast((entry: any) => entry.customType === "rqw-agent-child" && entry.data.id === 2) as any;
	await rm(lastB.data.sessionFile);
	const reopened = SessionManager.open(parent.getSessionFile()!);
	const branch = reopened.getBranch.bind(reopened);
	t.mock.method(reopened, "getBranch", () => branch().filter((entry: any) => entry.type !== "custom_message"));
	const restored = runtimeFixture(reopened, root);
	restored.ctx.mode = "print";
	await restored.emit("agent_end");
	const waiting = await restored.execute({ action: "wait", ids: ["agent#1", "agent#2"], until: "all" });
	// Both saved answers are usable even though B's transcript is unavailable.
	assert.deepEqual(waiting.details.results.map((result: any) => [result.id, result.text]), [["agent#1", `answer\n\n${FOLLOW_UP}`], ["agent#2", `answer\n\n${FOLLOW_UP}`]]);
	const repeated = await restored.execute({ action: "wait", ids: ["agent#1", "agent#2"], until: "all" });
	assert.equal(repeated.details.results.length, 0);
	assert.equal("statuses" in waiting.details, false);
	await restored.execute({ action: "send", id: "agent#1", task: "follow-up A" });
	await restored.runtime.wait(new AbortController().signal);
	const request = restored.requests.at(-1);
	assert.deepEqual(request.messages.filter((message: any) => message.role !== "system").map((message: any) => message.role), ["user", "assistant", "user"]);
	assert.deepEqual(request.messages.filter((message: any) => message.role === "user").map((message: any) => message.content),
		[[{ type: "text", text: "task A" }], [{ type: "text", text: "follow-up A" }]]);
	const status = await restored.execute({ action: "status", ids: ["agent#1", "agent#2"] });
	assert.ok(status.details.statuses[0].messages.some((message: any) => message.role === "assistant" && message.text === "answer"));
	assert.equal(status.details.statuses[1].state, "unavailable");
	assert.match(status.details.statuses[1].error, /ENOENT/);
	const stopped = await restored.execute({ action: "stop", id: "agent#2" });
	assert.equal(stopped.content[0].text, "agent#2 stopped");
	restored.runtime.close();
	const statusOnly = runtimeFixture(reopened, root);
	statusOnly.ctx.mode = "print";
	await statusOnly.emit("agent_end");
	const beforeStatus = await statusOnly.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(beforeStatus.details.results.length, 1);
	await statusOnly.execute({ action: "status", ids: ["agent#1"] });
	const afterStatus = await statusOnly.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(afterStatus.details.results.length, 1);
	assert.notEqual(afterStatus.details.results[0].run, beforeStatus.details.results[0].run);
	const repeatedStatus = await statusOnly.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(repeatedStatus.details.results.length, 0);
	statusOnly.runtime.close();
});

test("hot completed sends keep their session and branch changes fence late restore", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const hot = runtimeFixture(parent, root);
	hot.ctx.mode = "print";
	let serial = 0;
	hot.events.on("rqw-codex:session-policy", (request: any) => {
		const provider = createFauxCore({ provider: "persist-test", models: [{ id: "model" }] });
		const text = `session ${++serial}`;
		provider.setResponses([fauxAssistantMessage(text), fauxAssistantMessage(text)]);
		request.session.agent.streamFunction = provider.streamSimple;
	});
	await hot.emit("agent_end");
	await hot.execute({ action: "start", task: "original", tools: [] });
	await hot.runtime.wait(new AbortController().signal);
	const first = await hot.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(first.details.results[0].text, `session 1\n\n${FOLLOW_UP}`);
	await hot.execute({ action: "send", id: "agent#1", task: "next" });
	await hot.runtime.wait(new AbortController().signal);
	const second = await hot.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(second.details.results[0].text, `session 1\n\n${FOLLOW_UP}`);
	hot.runtime.close();
	const reopened = SessionManager.open(parent.getSessionFile()!);
	const restored = runtimeFixture(reopened, root);
	restored.events.on("rqw-codex:session-policy", () => {
		const last = reopened.getBranch().findLast((entry: any) => entry.customType === "rqw-agent-child") as any;
		reopened.appendCustomEntry("rqw-agent-child", { ...last.data, state: "stopped" });
		void restored.emit("session_tree");
	});
	await assert.rejects(restored.execute({ action: "send", id: "agent#1", task: "must not run" }), /changed its session branch/);
	const status = await restored.execute({ action: "status", ids: ["agent#1"] });
	assert.equal(status.details.statuses[0].error, "Unknown or closed child ID", JSON.stringify(status.details));
	restored.runtime.close();
});

test("five finished idle minutes release a session and send wakes the same history", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let now = 0;
	t.mock.method(performance, "now", () => now);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	let released = false;
	const live = runtimeFixture(parent, root, (context: any, options: any) => JSON.stringify({
		released, sessionId: options.sessionId,
		roles: context.messages.filter((message: any) => message.role !== "system").map((message: any) => message.role),
		users: context.messages.filter((message: any) => message.role === "user").map((message: any) => message.content),
		system: context.messages.find((message: any) => message.role === "system").content,
	}));
	live.events.on("rqw-codex:session-policy", (request: any) => { request.release = () => { released = true; }; });
	await live.execute({ action: "start", task: "original task", tools: [], system: "saved prompt" });
	await live.runtime.wait(new AbortController().signal);
	const initial = await live.execute({ action: "status", ids: ["agent#1"] });
	const original = JSON.parse(initial.details.statuses[0].messages.find((message: any) => message.role === "assistant").text);
	await commitWait(live, parent);
	now = 299999;
	t.mock.timers.tick(299999);
	await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(released, false);
	// The parent's wait rearms the full grace period.
	now = 300000;
	t.mock.timers.tick(1);
	await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(released, false);
	now = 540000;
	t.mock.timers.tick(240000);
	const interrupted = await live.execute({ action: "interrupt", id: "agent#1" });
	assert.equal(interrupted.content[0].text, "agent#1 is idle");
	now = 600000;
	t.mock.timers.tick(60000);
	await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(released, false);
	now = 900000;
	t.mock.timers.tick(300000);
	await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(released, true);
	live.ctx.mode = "print";
	await live.emit("agent_end");
	await live.execute({ action: "send", id: "agent#1", task: "wake task" });
	await live.runtime.wait(new AbortController().signal);
	const wake = await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.deepEqual(JSON.parse(wake.details.results[0].text.split("\n\n")[0]), {
		released: true, sessionId: original.sessionId, roles: ["user", "assistant", "user"],
		users: [[{ type: "text", text: "original task" }], [{ type: "text", text: "wake task" }]], system: `saved prompt\n\n${REMINDER}`,
	});
	live.runtime.close();
});

test("direct wait after codemode survives five-minute hibernation and wake", async t => {
	const nested = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let now = 0;
	t.mock.method(performance, "now", () => now);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root, (context: any) => {
		const task = context.messages.find((message: any) => message.role === "user")?.content?.[0]?.text;
		const tools = context.messages.filter((message: any) => message.role === "toolResult");
		if (task === "delegate" && tools.length === 0)
			return fauxAssistantMessage([fauxToolCall("codemode", { code: 'await tools.agent({ action: "start", task: "nested", tools: [] }); text(await tools.agent({ action: "wait", ids: ["agent#1"] })); await tools.read({ path: "release-model" });' }, { id: "outer/filtered" })], { stopReason: "toolUse" });
		if (task === "delegate" && tools.length === 1) {
			if (!JSON.stringify(tools[0].content).includes("direct_wait_required")) return "missing direct wait reason";
			return fauxAssistantMessage([fauxToolCall("agent", { action: "wait", ids: ["agent#1"] }, { id: "wake/wait" })], { stopReason: "toolUse" });
		}
		if (task === "delegate" && tools.length === 2 && !context.messages.some((message: any) => message.role === "user" && message.content?.[0]?.text === "wake"))
			return JSON.stringify(tools[1].content).includes("nested answer") ? "received" : "missing";
		if (task === "delegate" && tools.length === 2 && context.messages.some((message: any) => message.role === "user" && message.content?.[0]?.text === "wake"))
			return fauxAssistantMessage([fauxToolCall("agent", { action: "wait", ids: ["agent#1"] }, { id: "wake/again" })], { stopReason: "toolUse" });
		return task === "nested" ? nested.promise : JSON.stringify(context.messages.filter((message: any) => message.role !== "system" && message.role !== "assistant" && JSON.stringify(message.content).includes("nested answer")).length);
	}, 16, true);
	live.events.on("rqw-tools:subagent-tools", (request: any) => request.offer(() => [{
		name: "read", label: "Read", description: "Release fake model", parameters: { type: "object", properties: { path: { type: "string" } } },
		execute: async () => { nested.resolve(fauxAssistantMessage("nested answer")); return { content: [{ type: "text", text: "released" }], details: {} }; },
	}]));
	let released = false;
	live.events.on("rqw-codex:session-policy", (request: any) => { request.release = () => { released = true; }; });
	await live.execute({ action: "start", task: "delegate", tools: ["read"] });
	await live.runtime.wait(new AbortController().signal);
	await commitWait(live, parent);
	const beforeSleep = await live.execute({ action: "status", ids: ["agent#1"] });
	assert.ok(beforeSleep.details.statuses[0].messages.some((message: any) => message.role === "assistant" && message.text === "received"));
	now = 300000;
	t.mock.timers.tick(300000);
	await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(released, true);
	live.ctx.mode = "print";
	await live.emit("agent_end");
	await live.execute({ action: "send", id: "agent#1", task: "wake" });
	await live.runtime.wait(new AbortController().signal);
	const wake = await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(wake.details.results[0].text, `1\n\n${FOLLOW_UP}`);
	live.runtime.close();
});

test("an uncommitted answer blocks sleep until its wait result is saved", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let now = 0;
	t.mock.method(performance, "now", () => now);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root);
	let options: any;
	live.events.on("rqw-tools:subagent-tools", (request: any) => request.offer((_cwd: string, _settings: any, value: any) => {
		options = value;
		return [];
	}));
	let released = false;
	live.events.on("rqw-codex:session-policy", (request: any) => { request.release = () => { released = true; }; });
	await live.execute({ action: "start", task: "task", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	assert.equal("notify" in options, false);
	assert.equal("retain" in options, false);
	now = 300000;
	t.mock.timers.tick(300000);
	const waiting = await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(released, false);
	assert.match(waiting.details.results[0].text, /answer/);
	parent.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "agent", content: waiting.content, details: waiting.details, isError: false, timestamp: 1 });
	await live.emit("turn_end");
	now = 600000;
	t.mock.timers.tick(300000);
	await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(released, true);
	live.runtime.close();
});

test("a finished child keeps its job registry through the idle deadline", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let now = 0;
	t.mock.method(performance, "now", () => now);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	let disposed = false;
	let factories = 0;
	const job = Promise.withResolvers<string>();
	const live = runtimeFixture(parent, root, context => {
		const users = userTexts(context);
		const results = context.messages.filter((message: any) => message.role === "toolResult");
		if (!users.includes("collect")) return "final";
		if (results.some((result: any) => result.toolCallId === "collect-job")) return "collected";
		return fauxAssistantMessage([fauxToolCall("job", {}, { id: "collect-job" })], { stopReason: "toolUse" });
	});
	live.events.on("rqw-tools:subagent-tools", (request: any) => request.offer(() => {
		factories++;
		return [{
			name: "job", label: "Job", description: "Job control", parameters: { type: "object", properties: {} },
			jobs: { abortAll() {}, dispose() { disposed = true; }, hasJobs: () => true },
			execute: async () => ({ content: [{ type: "text", text: await job.promise }], details: {} }),
		}];
	}));
	await live.execute({ action: "start", task: "task", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	await commitWait(live, parent);
	now = 300000;
	t.mock.timers.tick(300000);
	await live.execute({ action: "send", id: "agent#1", task: "collect" });
	job.resolve("late result");
	await live.runtime.wait(new AbortController().signal);
	const collected = live.requests.at(-1).messages.find((message: any) => message.role === "toolResult" && message.toolCallId === "collect-job");
	assert.match(JSON.stringify(collected), /late result/);
	assert.equal(factories, 1);
	assert.equal(disposed, false);
	live.runtime.close();
});

test("a running child's queued progress notice does not hold a finished sibling awake", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let now = 0;
	t.mock.method(performance, "now", () => now);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const entered = Promise.withResolvers<void>();
	const response = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
	const sessions: AgentSession[] = [];
	const live = runtimeFixture(parent, root, (context: any) => {
		const task = context.messages.find((message: any) => message.role === "user")?.content?.[0]?.text;
		if (task === "sleep sibling") return "answer";
		const tools = context.messages.filter((message: any) => message.role === "toolResult").length;
		if (tools === 50) { entered.resolve(); return response.promise; }
		return fauxAssistantMessage([fauxToolCall("read", { path: "fixed" }, { id: `read-${tools}` })], { stopReason: "toolUse" });
	}, 64);
	let released = false;
	live.events.on("rqw-codex:session-policy", (request: any) => { sessions.push(request.session); request.release = () => { released = true; }; });
	live.events.on("rqw:context-fork:v1", (request: any) => request.offer(async () => fauxAssistantMessage("progress")));
	live.events.on("rqw-tools:subagent-tools", (request: any) => request.offer(() => [{
		name: "read", label: "Read", description: "Fake external file", parameters: { type: "object", properties: { path: { type: "string" } } },
		execute: async () => ({ content: [{ type: "text", text: "fixed" }], details: {} }),
	}]));
	await live.execute({ action: "start", task: "sleep sibling", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	await commitWait(live, parent);
	await live.emit("agent_end");
	await live.execute({ action: "start", task: "work", tools: ["read"] });
	await entered.promise;
	now = 300000;
	t.mock.timers.tick(300000);
	await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(released, true);
	await live.execute({ action: "stop", id: "agent#2" });
	response.resolve(fauxAssistantMessage("done"));
	await Promise.all(sessions.map(session => session.waitForIdle()));
	live.runtime.close();
});

test("stop releases only recoverable durable child history and preserves older branches", async t => {
	const root = await temp(t);
	for (const durable of [true, false]) {
		const parent = durable ? SessionManager.create(root, join(root, "parent")) : SessionManager.inMemory(root);
		parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
		const live = runtimeFixture(parent, root);
		await live.execute({ action: "start", task: "first task", tools: [] });
		await live.runtime.wait(new AbortController().signal);
		const beforeStop = parent.getLeafId()!;
		assert.ok(retainedChildManager(parent, "agent", 1));
		await live.execute({ action: "stop", id: "agent#1" });
		if (durable) await until(() => !retainedChildManager(parent, "agent", 1));
		else assert.ok(retainedChildManager(parent, "agent", 1));
		parent.branch(beforeStop);
		await live.emit("session_tree");
		await live.execute({ action: "send", id: "agent#1", task: "second task" });
		await live.runtime.wait(new AbortController().signal);
		assert.deepEqual(userTexts(live.requests.at(-1)), ["first task", "second task"]);
		live.runtime.close();
	}
});

test("stop releases a running child after its durable history settles", async t => {
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const entered = Promise.withResolvers<void>();
	const response = Promise.withResolvers<string>();
	const live = runtimeFixture(parent, root, async () => { entered.resolve(); return response.promise; });
	await live.execute({ action: "start", task: "first task", tools: [] });
	await entered.promise;
	await live.execute({ action: "stop", id: "agent#1" });
	response.resolve("answer");
	await until(() => !retainedChildManager(parent, "agent", 1));
	live.runtime.close();
});

test("stop retains history when an intermediate saved entry is malformed", async t => {
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root);
	let session: AgentSession | undefined;
	live.events.on("rqw-codex:session-policy", (request: any) => { session = request.session; });
	await live.execute({ action: "start", task: "first task", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	const disposed = Promise.withResolvers<void>();
	const dispose = session!.dispose.bind(session);
	t.mock.method(session!, "dispose", () => { dispose(); disposed.resolve(); });
	const manager = retainedChildManager(parent, "agent", 1)!;
	const file = manager.getSessionFile()!;
	const lines = (await readFile(file, "utf8")).split("\n");
	const user = lines.findIndex(line => line.includes('"role":"user"'));
	assert.ok(user > 0 && user < lines.length - 2);
	lines[user] = "malformed";
	await writeFile(file, lines.join("\n"));
	await live.execute({ action: "stop", id: "agent#1" });
	await disposed.promise;
	assert.equal(retainedChildManager(parent, "agent", 1), manager);
	live.runtime.close();
});

test("stop keeps an unflushed durable child available to its earlier branch", async t => {
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root);
	await live.execute({ action: "start", task: "old task", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	await live.execute({ action: "restart", id: "agent#1", tools: [] });
	const beforeStop = parent.getLeafId()!;
	await live.execute({ action: "stop", id: "agent#1" });
	assert.ok(retainedChildManager(parent, "agent", 1));
	parent.branch(beforeStop);
	await live.emit("session_tree");
	await live.execute({ action: "send", id: "agent#1", task: "first task" });
	await live.runtime.wait(new AbortController().signal);
	assert.deepEqual(userTexts(live.requests.at(-1)), ["first task"]);
	live.runtime.close();
});

test("a replaced generation and a parent with running descendants stay safe at old deadlines", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let now = 0;
	t.mock.method(performance, "now", () => now);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root);
	await live.execute({ action: "start", task: "old task", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	await live.execute({ action: "wait", ids: ["agent#1"] });
	const original = await live.execute({ action: "status", ids: ["agent#1"] });
	now = 240000;
	t.mock.timers.tick(240000);
	await live.execute({ action: "restart", id: "agent#1", task: "new task", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	now = 300000;
	t.mock.timers.tick(60000);
	await live.execute({ action: "wait", ids: ["agent#1"] });
	const current = await live.execute({ action: "status", ids: ["agent#1"] });
	assert.equal(current.details.statuses[0].run_id, 1);
	assert.notEqual(current.details.statuses[0].run, original.details.statuses[0].run);
	const restarted = await live.execute({ action: "status", ids: ["agent#1"] });
	assert.deepEqual(restarted.details.statuses[0].messages.filter((message: any) => message.role === "user").map((message: any) => message.text), ["new task"]);
	await live.execute({ action: "stop", id: "agent#1" });
	now = 600000;
	t.mock.timers.tick(300000);
	const stopped = await live.execute({ action: "status", ids: ["agent#1"] });
	assert.match(stopped.details.statuses[0].error, /Unknown/);
	live.runtime.close();

	const entered = Promise.withResolvers<void>();
	const response = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
	const sessions: AgentSession[] = [];
	const tree = runtimeFixture(parent, root, (context: any) => {
		const lastUser = context.messages.findLast((message: any) => message.role === "user");
		const task = lastUser?.content?.[0]?.text;
		if (task === "child waits") { entered.resolve(); return response.promise; }
		if (task === "seed") return "seed done";
		if (context.messages.some((message: any) => message.role === "toolResult")) return "parent done";
		return fauxAssistantMessage([fauxToolCall("agent", { action: "start", task: "child waits", tools: [] }, { id: "delegate" })], { stopReason: "toolUse" });
	});
	tree.events.on("rqw-codex:session-policy", (request: any) => { sessions.push(request.session); });
	await tree.execute({ action: "start", task: "seed", tools: [] });
	await tree.runtime.wait(new AbortController().signal);
	// A fake external Pi host starts native activity after the logical assignment settled.
	const native = sessions[0].prompt("delegate");
	await entered.promise;
	await native;
	now = 900000;
	t.mock.timers.tick(300000);
	const active = await tree.execute({ action: "status", ids: ["agent#2"], depth: 1 });
	assert.equal(active.details.statuses[0].run_active, false);
	assert.equal(active.details.statuses[0].children[0].run_active, true);
	response.resolve(fauxAssistantMessage("child done"));
	await Promise.all(sessions.map(session => session.waitForIdle()));
	tree.runtime.close();
	const memory = runtimeFixture(SessionManager.inMemory(root), root);
	await memory.execute({ action: "start", task: "in-memory task", tools: [] });
	await memory.runtime.wait(new AbortController().signal);
	now = 1200000;
	t.mock.timers.tick(300000);
	await memory.execute({ action: "wait", ids: ["agent#1"] });
	const retained = await memory.execute({ action: "status", ids: ["agent#1"] });
	assert.equal(retained.details.statuses[0].run_id, 1);
	memory.runtime.close();
});

// Regression: every child state change rewrote config and task, growing the parent session to gigabytes.
test("child records write config and task once and restore them from the full record", () => {
	const a = {};
	const record = (state: string, task = "task") => ({ id: 1, state, config: { system: "prompt" }, task });
	const first = childRecord(a, record("running"));
	const second = childRecord(a, record("completed"));
	assert.deepEqual(second, { id: 1, state: "completed" });
	assert.deepEqual(mergeSaved(mergeSaved(undefined, first as never), second as never), record("completed"));
	assert.deepEqual(childRecord(a, record("running", "next")), record("running", "next"));
});

test("restore and resume without changes write only short child records", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	// The first request ends in a tool call so that Pi flushes the history; the second one never answers.
	const first = runtimeFixture(parent, root, (context: any) => context.messages.some((message: any) => message.role === "toolResult")
		? new Promise<never>(() => {}) : fauxAssistantMessage([fauxToolCall("read", { path: "missing.txt" }, { id: "call" })], { stopReason: "toolUse" }));
	await first.execute({ action: "start", task: "long task", tools: ["read"] });
	await new Promise(resolve => setImmediate(resolve));
	first.runtime.close();
	const reopened = SessionManager.open(parent.getSessionFile()!);
	const records = () => reopened.getBranch().filter((entry: any) => entry.customType === "rqw-agent-child") as any[];
	const before = records().length;
	const restored = runtimeFixture(reopened, root);
	await restored.execute({ action: "resume", id: "agent#1" });
	await restored.runtime.wait(new AbortController().signal);
	const fresh = records().slice(before);
	assert.ok(fresh.length > 0);
	assert.deepEqual(fresh.map(entry => [entry.data.config, entry.data.task]), fresh.map(() => [undefined, undefined]));
	restored.runtime.close();
});

test("a child that calls a tool writes no tool-intent entry to its file", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root, (context: any) => context.messages.some((message: any) => message.role === "toolResult")
		? "done" : fauxAssistantMessage([fauxToolCall("read", { path: "missing.txt" }, { id: "call" })], { stopReason: "toolUse" }));
	await live.execute({ action: "start", task: "read it", tools: ["read"] });
	await live.runtime.wait(new AbortController().signal);
	const directory = `${parent.getSessionFile()}.children/agent-1`;
	const [file] = await readdir(directory);
	const text = await readFile(join(directory, file), "utf8");
	assert.match(text, /"toolName":"read"/);
	assert.doesNotMatch(text, /rqw-agent-tool-intent/);
	live.runtime.close();
});

test("accepted steering commands are saved in order and an interrupt clears them", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await live.execute({ action: "start", task: "long task", tools: [] });
	await new Promise(resolve => setImmediate(resolve));
	await live.execute({ action: "send", id: "agent#1", task: "first" });
	await live.execute({ action: "send", id: "agent#1", task: "second" });
	const latest = () => (parent.getBranch().filter((entry: any) => entry.customType === "rqw-agent-child").at(-1) as any).data;
	assert.deepEqual(latest().pending_sends, [{ n: 2, tasks: ["first"] }, { n: 3, tasks: ["second"] }]);
	await live.execute({ action: "interrupt", id: "agent#1" });
	assert.equal(latest().pending_sends, undefined);
	assert.equal(latest().state, "paused");
	live.runtime.close();
});

async function until(done: () => boolean) {
	for (let i = 0; i < 200 && !done(); i++) await new Promise(resolve => setImmediate(resolve));
	assert.ok(done());
}
const userTexts = (request: any) => request.messages.filter((message: any) => message.role === "user").map((message: any) => message.content[0].text);

test("after a crash only the commands missing from the history are sent, once and in order", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const gate = Promise.withResolvers<void>();
	// The first request waits for both commands, then calls a tool; the second one never answers: the crash.
	const first = runtimeFixture(parent, root, async (context: any) => {
		if (context.messages.some((message: any) => message.role === "toolResult")) return new Promise<never>(() => {});
		await gate.promise;
		return fauxAssistantMessage([fauxToolCall("read", { path: "missing.txt" }, { id: "call" })], { stopReason: "toolUse" });
	});
	await first.execute({ action: "start", task: "long task", tools: ["read"] });
	await until(() => parent.getBranch().length > 0 && first.requests.length === 1);
	await first.execute({ action: "send", id: "agent#1", task: "same" });
	await first.execute({ action: "send", id: "agent#1", task: "same" });
	gate.resolve();
	await until(() => first.requests.length === 2);
	assert.deepEqual(userTexts(first.requests[1]), ["long task", "same"]);
	first.runtime.close();
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	await restored.runtime.resume!(new AbortController().signal, true);
	await restored.runtime.wait(new AbortController().signal);
	assert.deepEqual(userTexts(restored.requests.at(-1)), ["long task", "same", "same"]);
	restored.runtime.close();
});

test("a paused child with an accepted command starts it by itself, queued commands as one message", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await first.execute({ action: "start", task: "long task", tools: [] });
	await until(() => first.requests.length === 1);
	await first.execute({ action: "send", id: "agent#1", task: "one", interrupt: true });
	await first.execute({ action: "send", id: "agent#1", task: "two", interrupt: true });
	first.runtime.close();
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	await restored.runtime.resume!(new AbortController().signal, true);
	await restored.runtime.wait(new AbortController().signal);
	assert.deepEqual(userTexts(restored.requests.at(-1)), ["long task", "one\n\ntwo"]);
	restored.runtime.close();
});

/** A child started and the process died before its history reached the file: only the start record survives. */
async function crashedAtStart(t: TestContext, history: boolean, keepSends = true) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await first.execute({ action: "start", task: "long task", tools: [] });
	first.runtime.close();
	const file = parent.getSessionFile()!;
	let seen = false;
	const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(entry => {
		if (entry.customType !== "rqw-agent-child") return true;
		if (seen) return false;
		seen = entry.data.history = history;
		if (!keepSends) delete entry.data.pending_sends;
		return true;
	});
	await writeFile(file, `${lines.map(entry => JSON.stringify(entry)).join("\n")}\n`);
	await rm(`${file}.children/agent-1`, { recursive: true });
	return runtimeFixture(SessionManager.open(file), root);
}

test("a child whose history never reached its file restarts with its one accepted task", async t => {
	const restored = await crashedAtStart(t, false);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	await restored.runtime.resume!(new AbortController().signal, true);
	await restored.runtime.wait(new AbortController().signal);
	assert.deepEqual(userTexts(restored.requests.at(-1)), ["long task"]);
	restored.runtime.close();
});

test("a child with a saved history but no file is still a recovery error", async t => {
	const restored = await crashedAtStart(t, true);
	const status = await restored.execute({ action: "status", ids: ["agent#1"] });
	assert.match(status.details.statuses[0].error, /ENOENT/);
	restored.runtime.close();
});

/** The wait of an older version, as it stands in a saved session: its opening record, then the outer tool result carrying the `waiting` receipt. */
function savedWait(parent: SessionManager, callId: string, timeout = 60000, withResult = true) {
	const child = (parent.getBranch() as any[]).findLast(entry => entry.customType === "rqw-agent-child").data;
	const waitId = `wait-${callId}`;
	parent.appendCustomEntry("rqw-agent-wait", { version: 1, wait_id: waitId, open: true, call: callId, deadline_at: Date.now() + timeout, until: "first", wake_on_alert: true,
		targets: [{ id: "agent#1", run: child.result?.run ?? `${child.epoch}:${child.runNumber}` }] });
	if (withResult) parent.appendMessage({ role: "toolResult", toolCallId: callId, toolName: "agent", content: [{ type: "text", text: JSON.stringify({ reason: "waiting", wait_id: waitId }) }], isError: false, timestamp: 1 });
	return waitId;
}

/** A child waits on its first request and a saved notification wait of an older version is open; then the process dies (the first runtime is abandoned). */
async function crashedDuringWait(t: TestContext, restoredAt = 1000, restoredResponse?: () => Promise<never>, before?: (file: string, waitId: string) => Promise<void>) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const clock = { now: 1000 };
	t.mock.method(Date, "now", () => clock.now);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await first.execute({ action: "start", task: "long task", tools: [] });
	await until(() => first.requests.length === 1);
	const id = savedWait(parent, "call1");
	clock.now = restoredAt;
	await before?.(parent.getSessionFile()!, id);
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root, restoredResponse);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	const sent = (): { wait_id: string; reason: string; timed_out: boolean; changed: { change: string }[]; results: { text: string }[] }[] => restored.ctx.sessionManager.getBranch().filter((entry: any) => entry.customType === "child_wait").map((entry: any) => entry.details);
	return { id, root, clock, restored, sent, plain: () => restored.ctx.sessionManager.getBranch().filter((entry: any) => entry.type === "custom_message" && entry.customType === "agent") };
}

test("an old open wait is not restored and its resumed answer remains available", async t => {
	const crash = await crashedDuringWait(t);
	const before = crash.restored.ctx.sessionManager.getBranch().filter((entry: any) => entry.customType === "rqw-agent-wait").length;
	await crash.restored.runtime.resume!(new AbortController().signal, true);
	await crash.restored.runtime.wait(new AbortController().signal);
	assert.equal(crash.sent().length, 0);
	assert.equal(crash.plain().length, 0);
	assert.equal(crash.restored.ctx.sessionManager.getBranch().filter((entry: any) => entry.customType === "rqw-agent-wait").length, before);
	const answer = await crash.restored.execute({ action: "wait", ids: ["agent#1"] });
	assert.match(answer.details.results[0].text, /^answer/);
	const again = await crash.restored.execute({ action: "wait", ids: ["agent#1"] }, "again");
	assert.deepEqual(again.details.results, []);
	crash.restored.runtime.close();
});

test("a saved answer remains available after a crash with the same delivery id", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root);
	await first.execute({ action: "start", task: "task", tools: [] });
	await first.runtime.wait(new AbortController().signal);
	const file = parent.getSessionFile()!;
	const entries = (await readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
	// The id the child's saved answer holds: the record is the outbox.
	const saved = entries.filter(entry => entry.customType === "rqw-agent-child" && entry.data.result).at(-1).data.result.delivery;
	assert.equal(typeof saved, "string");
	// The crash came before the message was persisted.
	const lost = entries.map(entry => entry.type === "custom_message" && entry.customType === "agent" ? { type: "custom", id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp, customType: "unrelated", data: {} } : entry);
	await writeFile(file, `${lost.map(entry => JSON.stringify(entry)).join("\n")}\n`);
	const restored = runtimeFixture(SessionManager.open(file), root);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	const pushed = restored.ctx.sessionManager.getBranch().filter((entry: any) => entry.type === "custom_message" && entry.customType === "agent") as any[];
	assert.deepEqual(pushed, []);
	const answer = await restored.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(answer.details.results[0].delivery, saved);
	restored.runtime.close();
});

/** A child's answer is taken by a wait inside a codemode script; the process dies before the turn ends and writes the receipt. */
async function crashedInsideCodemode(t: TestContext, waitFailed: boolean, outerFailed = false) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const gate = Promise.withResolvers<void>();
	const first = runtimeFixture(parent, root, async () => { await gate.promise; return "answer"; });
	await first.execute({ action: "start", task: "task", tools: [] });
	await until(() => first.requests.length === 1);
	await first.emit("tool_call", { toolCallId: "outer/inner", parentToolCallId: "outer", input: {} });
	const waiting = first.execute({ action: "wait", ids: ["agent#1"] }, "outer/inner");
	gate.resolve();
	await waiting;
	await first.emit("tool_execution_end", { toolCallId: "outer/inner", isError: waitFailed });
	// The script caught the wait's error or used its result; either way its own result is saved.
	parent.appendMessage({ role: "toolResult", toolCallId: "outer", toolName: "codemode", content: [{ type: "text", text: "ok" }], isError: outerFailed, timestamp: 1 });
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	const answer = await restored.execute({ action: "wait", ids: ["agent#1"] });
	const count = answer.details.results.length;
	restored.runtime.close();
	first.runtime.close();
	return count;
}

test("an answer a codemode wait took is not sent again after a crash before its receipt", async t => {
	assert.equal(await crashedInsideCodemode(t, false), 0);
});

test("an answer is sent again when the codemode call that took it failed", async t => {
	assert.equal(await crashedInsideCodemode(t, false, true), 1);
});

test("an answer is sent again when the wait inside codemode ended with a caught error", async t => {
	assert.equal(await crashedInsideCodemode(t, true), 1);
});

test("resuming an empty history without an accepted command is an error, not a replay of the task", async t => {
	const restored = await crashedAtStart(t, false, false);
	await assert.rejects(restored.execute({ action: "resume", id: "agent#1" }), /no saved request to resume/);
	assert.equal(restored.requests.length, 0);
	restored.runtime.close();
});

test("a child that went to sleep leaves no live session manager behind", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let now = 0;
	// Not t.mock.method: a mock keeps the stack of every call, and its frames hold the objects they ran on.
	const realNow = performance.now;
	performance.now = () => now;
	t.after(() => { performance.now = realNow; });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root);
	// queryObjects collects garbage first, so it counts only managers still reachable.
	const managers = () => queryObjects(SessionManager) as number;
	const before = managers();
	await live.execute({ action: "start", task: "task", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	assert.ok(managers() > before);
	await commitWait(live, parent);
	now = 300000;
	t.mock.timers.tick(300000);
	await live.execute({ action: "wait", ids: ["agent#1"] });
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(managers(), before);
	live.runtime.close();
});

test("a tool call cut off by a crash gets an error result when the child is recovered, and is not run again", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	let runs = 0;
	const first = runtimeFixture(parent, root, () => fauxAssistantMessage([fauxToolCall("read", { path: "x" }, { id: "call" })], { stopReason: "toolUse" }));
	const hanging = () => [{ name: "read", label: "Read", description: "Never ends", parameters: { type: "object", properties: { path: { type: "string" } } },
		execute: () => { runs++; return new Promise<never>(() => {}); } }];
	first.events.on("rqw-tools:subagent-tools", (request: any) => request.offer(hanging));
	await first.execute({ action: "start", task: "task", tools: ["read"] });
	await until(() => runs === 1);
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	restored.events.on("rqw-tools:subagent-tools", (request: any) => request.offer(hanging));
	await restored.execute({ action: "status", ids: ["agent#1"] });
	await restored.runtime.resume!(new AbortController().signal, true);
	await restored.runtime.wait(new AbortController().signal);
	const result = restored.requests.at(-1).messages.find((message: any) => message.role === "toolResult");
	assert.equal(result.isError, true);
	assert.match(JSON.stringify(result.content), /Interrupted before a durable result/);
	assert.equal(runs, 1);
	restored.runtime.close();
});

test("a joined batch that is already in the history is not sent again", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await first.execute({ action: "start", task: "long task", tools: [] });
	await until(() => first.requests.length === 1);
	await first.execute({ action: "send", id: "agent#1", task: "one", interrupt: true });
	await first.execute({ action: "send", id: "agent#1", task: "two", interrupt: true });
	first.runtime.close();
	// The joined message reached the child's file, but the crash came before its record was pruned.
	const directory = `${parent.getSessionFile()}.children/agent-1`;
	const [file] = await readdir(directory);
	SessionManager.open(join(directory, file)).appendMessage({ role: "user", content: [{ type: "text", text: "one\n\ntwo" }], timestamp: 2 });
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	await restored.execute({ action: "resume", id: "agent#1" });
	await restored.runtime.wait(new AbortController().signal);
	assert.deepEqual(userTexts(restored.requests.at(-1)), ["long task", "one\n\ntwo"]);
	restored.runtime.close();
});

test("a restarted child whose history never reached its file restarts with its one accepted task", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await first.execute({ action: "start", task: "old task", tools: [] });
	await first.execute({ action: "restart", id: "agent#1", task: "long task", tools: [] });
	await until(() => first.requests.length > 0);
	// The crash: the new history never reached its file.
	const file = parent.getSessionFile()!;
	await rm(`${file}.children/agent-1`, { recursive: true });
	const restored = runtimeFixture(SessionManager.open(file), root);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	await restored.runtime.resume!(new AbortController().signal, true);
	await restored.runtime.wait(new AbortController().signal);
	assert.deepEqual(userTexts(restored.requests.at(-1)), ["long task"]);
	restored.runtime.close();
});

/** An older version's wait took the answer of a finished child; its `agent` message was never persisted. `sent` tells whether its `child_wait` was. */
async function crashedAfterChildAnswer(t: TestContext, sent: boolean) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	t.mock.method(Date, "now", () => 1000);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root);
	await first.execute({ action: "start", task: "task", tools: [] });
	await first.runtime.wait(new AbortController().signal);
	const id = savedWait(parent, "call1");
	if (sent) {
		const run = (parent.getBranch() as any[]).findLast(entry => entry.customType === "rqw-agent-child").data.result.run;
		parent.appendCustomMessageEntry("child_wait", "{}", true, { wait_id: id, reason: "result", results: [{ run }] });
	}
	const file = parent.getSessionFile()!;
	const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line))
		.map(entry => entry.type === "custom_message" && entry.customType === "agent" ? { type: "custom", id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp, customType: "unrelated", data: {} } : entry);
	await writeFile(file, `${lines.map(entry => JSON.stringify(entry)).join("\n")}\n`);
	const restored = runtimeFixture(SessionManager.open(file), root);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	const branch = restored.ctx.sessionManager.getBranch() as any[];
	restored.runtime.close();
	return { id, waits: branch.filter(entry => entry.customType === "child_wait"), plain: branch.filter(entry => entry.type === "custom_message" && entry.customType === "agent") };
}

test("a saved wait whose child_wait was persisted before the crash is not raised again", async t => {
	const crash = await crashedAfterChildAnswer(t, true);
	assert.equal(crash.waits.length, 1);
	assert.equal(crash.plain.length, 0);
});

test("a saved wait whose child_wait was not persisted does not wake on restore", async t => {
	const crash = await crashedAfterChildAnswer(t, false);
	assert.deepEqual(crash.waits, []);
	assert.equal(crash.plain.length, 0);
});

/** Two children held by gates named after their tasks; `now` is the monotonic clock the wait deadlines and alerts read. */
async function gatedChildren(t: TestContext, tasks: string[], alertAfter?: number) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const clock = { now: 0 };
	t.mock.method(performance, "now", () => clock.now);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const gates = new Map(tasks.map(task => [task, Promise.withResolvers<void>()]));
	const live = runtimeFixture(parent, root, async (context: any) => { const task = userTexts(context)[0]; await gates.get(task)!.promise; return `answer of ${task}`; });
	for (const task of tasks) await live.execute({ action: "start", task, tools: [], ...(alertAfter ? { alert_after_ms: alertAfter } : {}) });
	await until(() => live.requests.length === tasks.length);
	const settle = () => new Promise(resolve => setImmediate(resolve));
	return { live, parent, clock, settle, release: (task: string) => gates.get(task)!.resolve() };
}
const resultTexts = (details: any) => details.results.map((item: any) => [item.id, item.text.split("\n\n")[0]]);

test("a direct wait stays open and returns the first finished child by itself", async t => {
	const f = await gatedChildren(t, ["a", "b"]);
	const waiting = f.live.execute({ action: "wait", ids: ["agent#1", "agent#2"] });
	let settled = false;
	void waiting.then(() => { settled = true; });
	await f.settle();
	assert.equal(settled, false);
	f.release("b");
	const result = await waiting;
	assert.equal(result.details.reason, "result");
	assert.deepEqual(resultTexts(result.details), [["agent#2", "answer of b"]]);
	assert.equal(result.terminate, undefined);
	f.release("a");
	f.live.runtime.close();
});

test("steering releases a wait-all's held answer and leaves both children available", async t => {
	const f = await gatedChildren(t, ["a", "b"]);
	const source = steeringSession(f.parent);
	f.live.ctx.isIdle = () => source.session.isIdle;
	const waiting = f.live.execute({ action: "wait", ids: ["agent#1", "agent#2"], until: "all" });
	let settled = false;
	void waiting.then(() => { settled = true; });
	f.release("a");
	await f.settle();
	source.emit({ type: "queue_update", steering: [], followUp: ["service"] });
	await Promise.resolve();
	assert.equal(settled, false);
	source.messages.push("new direction");
	source.emit({ type: "queue_update", steering: [...source.messages], followUp: [] });
	source.session.agent.steeringQueue.messages.push({ role: "user" });
	const steered = await waiting;
	assert.equal(steered.details.reason, "steered");
	assert.equal(steered.content[0].text, "interrupted; still running: agent#2");
	assert.equal("statuses" in steered.details, false);
	source.messages.length = 0;
	source.session.agent.steeringQueue.messages.length = 0;
	const first = await f.live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(first.details.results.length + first.details.receipts.length, 1);
	f.release("b");
	const second = await f.live.execute({ action: "wait", ids: ["agent#2"] });
	assert.deepEqual(resultTexts(second.details), [["agent#2", "answer of b"]]);
	f.live.runtime.close();
});

test("a direct wait for all returns only when every child has finished", async t => {
	const f = await gatedChildren(t, ["a", "b"]);
	const waiting = f.live.execute({ action: "wait", ids: ["agent#1", "agent#2"], until: "all" });
	let settled = false;
	void waiting.then(() => { settled = true; });
	f.release("a");
	await f.settle();
	assert.equal(settled, false);
	f.release("b");
	const result = await waiting;
	assert.equal(result.details.reason, "result");
	assert.deepEqual(resultTexts(result.details).sort(), [["agent#1", "answer of a"], ["agent#2", "answer of b"]]);
	f.live.runtime.close();
});

test("a direct wait times out without stopping the child, and a later wait gets its answer", async t => {
	const f = await gatedChildren(t, ["a"]);
	const waiting = f.live.execute({ action: "wait", ids: ["agent#1"], timeout_ms: 1000 });
	await f.settle();
	f.clock.now = 1000;
	t.mock.timers.tick(1000);
	const timedOut = await waiting;
	assert.deepEqual([timedOut.details.reason, timedOut.details.timed_out, timedOut.details.results], ["timeout", true, []]);
	assert.equal(timedOut.content[0].text, "timeout; still running: agent#1");
	assert.equal("statuses" in timedOut.details, false);
	const again = f.live.execute({ action: "wait", ids: ["agent#1"] });
	f.release("a");
	assert.deepEqual(resultTexts((await again).details), [["agent#1", "answer of a"]]);
	f.live.runtime.close();
});

test("an alert of the child does not wake a wait by default", async t => {
	const f = await gatedChildren(t, ["a"], 100);
	const waiting = f.live.execute({ action: "wait", ids: ["agent#1"], timeout_ms: 1000 });
	let settled = false;
	void waiting.then(() => { settled = true; });
	await f.settle();
	f.clock.now = 100;
	t.mock.timers.tick(100);
	await f.settle();
	assert.equal(settled, false);
	f.clock.now = 1000;
	t.mock.timers.tick(1000);
	assert.equal((await waiting).details.reason, "timeout");
	f.release("a");
	f.live.runtime.close();
});

test("a wait with wake_on_alert returns one short line on an alert of its child", async t => {
	const f = await gatedChildren(t, ["a"], 100);
	const waiting = f.live.execute({ action: "wait", ids: ["agent#1"], wake_on_alert: true });
	await f.settle();
	f.clock.now = 100;
	t.mock.timers.tick(100);
	const result = await waiting;
	assert.equal(result.details.reason, "alert");
	assert.deepEqual(result.details.results, []);
	assert.equal(result.content[0].text, "alert; still running: agent#1");
	assert.equal("statuses" in result.details, false);
	f.release("a");
	f.live.runtime.close();
});

test("a direct wait ends with target_changed when its child is interrupted", async t => {
	const f = await gatedChildren(t, ["a"]);
	const waiting = f.live.execute({ action: "wait", ids: ["agent#1"] });
	await f.live.execute({ action: "interrupt", id: "agent#1" });
	const result = await waiting;
	assert.equal(result.details.reason, "target_changed");
	assert.equal(result.details.changed[0].id, "agent#1");
	f.release("a");
	f.live.runtime.close();
});

test("an aborted direct wait leaves the answer for a later wait", async t => {
	const f = await gatedChildren(t, ["a"]);
	const controller = new AbortController();
	const waiting = f.live.execute({ action: "wait", ids: ["agent#1"] }, "call", controller.signal);
	await f.settle();
	controller.abort(new Error("canceled"));
	await assert.rejects(waiting, /canceled/);
	f.release("a");
	await f.live.runtime.wait(new AbortController().signal);
	const plain = (f.parent.getBranch() as any[]).filter(entry => entry.type === "custom_message" && entry.customType === "agent");
	assert.equal(plain.length, 0);
	const result = await f.live.execute({ action: "wait", ids: ["agent#1"] });
	assert.match(result.details.results[0].text, /answer of a/);
	f.live.runtime.close();
});

test("an error tool result with wait details does not lose the answer after restart", async t => {
	const f = await gatedChildren(t, ["a"]);
	const waiting = f.live.execute({ action: "wait", ids: ["agent#1"] });
	f.release("a");
	const result = await waiting;
	f.parent.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "agent", content: result.content, details: result.details, isError: true, timestamp: 1 });
	f.live.runtime.close();
	const restored = runtimeFixture(SessionManager.open(f.parent.getSessionFile()!), f.live.ctx.cwd);
	t.after(() => restored.runtime.close());
	const again = await restored.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(again.details.results[0].delivery, result.details.results[0].delivery);
});

test("an answer a direct wait returned remains available when its tool result is lost", async t => {
	const f = await gatedChildren(t, ["a"]);
	const waiting = f.live.execute({ action: "wait", ids: ["agent#1"] });
	f.release("a");
	const result = await waiting;
	assert.equal(result.details.reason, "result");
	// A failed tool result releases the answer for another wait.
	f.parent.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "agent", content: [{ type: "text", text: "failed" }], isError: true, timestamp: 1 });
	await f.live.emit("turn_end");
	const plain = (f.parent.getBranch() as any[]).filter(entry => entry.type === "custom_message" && entry.customType === "agent");
	assert.deepEqual(plain, []);
	const again = await f.live.execute({ action: "wait", ids: ["agent#1"] }, "again");
	assert.equal(again.details.results[0].delivery, result.details.results[0].delivery);
	f.live.runtime.close();
});

test("switching or forking the session is refused while a child runs and allowed once it ended", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const gate = Promise.withResolvers<void>();
	const live = runtimeFixture(parent, root, async () => { await gate.promise; return "answer"; });
	const event = { type: "session_before_switch", reason: "new" };
	assert.equal(await live.emit("session_before_switch", event), undefined);
	await live.execute({ action: "start", task: "long task", tools: [] });
	await until(() => live.requests.length === 1);
	assert.deepEqual(await live.emit("session_before_switch", event), { cancel: true });
	assert.deepEqual(await live.emit("session_before_fork", { type: "session_before_fork", entryId: "e1" }), { cancel: true });
	assert.deepEqual(live.notices, ["дождись сабагентов", "дождись сабагентов"]);
	gate.resolve();
	await live.runtime.wait(new AbortController().signal);
	assert.equal(await live.emit("session_before_switch", event), undefined);
	assert.equal(await live.emit("session_before_fork", { type: "session_before_fork", entryId: "e1" }), undefined);
	live.runtime.close();
});

