import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { queryObjects } from "node:v8";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { createFauxCore, fauxAssistantMessage, fauxProvider, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { createEventBus, SessionManager, type AgentSession, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { Activity, headTail } from "../../../extensions/RQW-agent/activity.ts";
import { Coordinator } from "../../../extensions/RQW-agent/coordinator.ts";
import { createCountsProducer, type CountsOffer, type RunningCounts } from "../../../extensions/RQW-agent/counts.ts";
import { fastGpt, inheritedFastGpt } from "../../../extensions/RQW-agent/fast-gpt.ts";
import { createChildManager, openChildManager, repairInterrupted } from "../../../extensions/RQW-agent/persistence.ts";
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
		finish: () => { live = false; coordinator.publish(target.id, target.run, "answer", "completed", () => {}); } };
}

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

function notified(t: TestContext, timeout = 100) {
	const f = coordinatorFixture(t, true);
	f.emit("before_agent_start");
	const receipt = f.coordinator.notificationWait(["agent#1"], timeout, new AbortController().signal, "call");
	f.branch.push({ type: "message", message: { role: "toolResult", toolCallId: "call", isError: false, content: receipt.content } });
	f.emit("turn_end");
	return { f, receipt };
}

test("a child_wait notification carries the follow-up, its waiting receipt does not", t => {
	const { f, receipt } = notified(t);
	assert.doesNotMatch(receipt.content[0].text, /follow-up actions/);
	f.finish();
	assert.equal(JSON.parse(f.sent[0].message.content).results[0].text, `answer\n\n${FOLLOW_UP}`);
});

test("a timed-out child_wait notification has no completed result and no follow-up", t => {
	const { f } = notified(t, 0);
	assert.equal(f.sent.length, 1);
	assert.deepEqual(JSON.parse(f.sent[0].message.content).results, []);
	assert.doesNotMatch(f.sent[0].message.content, /follow-up actions/);
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
	f.branch.push({ type: "message", message: { role: "toolResult", toolCallId: "call", isError: false, content: result.content } });
	f.emit("turn_end");
	const repeated = await f.coordinator.wait(["agent#1"], 100, new AbortController().signal, "again");
	assert.equal(repeated.details.reason, "receipt");
	assert.deepEqual(repeated.details.results, []);
	assert.equal((repeated.details.receipts as any[])[0].delivered_via, "wait");
});

// Regression for a66f2c7: busy-parent notifications survive queue clearing and continue once.
test("busy notification is retained and does not wake the parent repeatedly", t => {
	const f = coordinatorFixture(t, true);
	f.emit("before_agent_start");
	const receipt = f.coordinator.notificationWait(["agent#1"], 100, new AbortController().signal, "call");
	f.branch.push({ type: "message", message: { role: "toolResult", toolCallId: "call", isError: false,
		content: [{ type: "text", text: JSON.stringify(receipt) }] } });
	f.emit("turn_end");
	f.finish();
	assert.equal(f.sent.length, 1);
	assert.equal(f.sent[0].options.triggerTurn, false);
	assert.equal(f.sent[0].message.details.results[0].text, `answer\n\n${FOLLOW_UP}`);
	assert.deepEqual(f.emit("agent_before_settle"), { continue: true });
	f.branch.push(
		{ type: "custom_message", customType: "child_wait", details: { wait_id: receipt.details.wait_id } },
		{ type: "message", message: { role: "assistant", content: "seen" } },
	);
	assert.equal(f.emit("agent_before_settle"), undefined);
	assert.equal(f.sent.length, 1);
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
	const model = createFauxCore({ provider: "persist-test", models: [{ id: "model" }] }).getModel();
	const requests: any[] = [];
	const core = createFauxCore({ provider: "persist-test", models: [{ id: "model" }] });
	core.setResponses(Array.from({ length: responses }, () => async (context: any, options: any) => {
		requests.push(context);
		const answer = await response(context, options);
		return typeof answer === "string" ? fauxAssistantMessage(answer, { timestamp: 1 }) : answer;
	}));
	const modelRuntime = {
		getModel: () => model, getPhysicalModel: () => model,
		hasConfiguredAuth: () => true, getAuth: async () => ({ apiKey: "fake" }),
		checkAuth: async () => ({}), isUsingOAuth: () => false,
		getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [],
		streamSimple: core.streamSimple,
	};
	let definition: any;
	const notices: string[] = [];
	const ctx: any = {
		cwd, sessionManager: parent, model, modelRegistry: { runtime: modelRuntime, find: () => model, hasConfiguredAuth: () => true },
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
	return { runtime, requests, ctx, events, notices, parameters: () => definition.parameters, description: () => definition.description as string, async emit(name: string, event: any = {}) { let result: unknown; for (const hook of hooks.get(name) ?? []) result = await hook(event, ctx); return result; },
		execute: (params: any, callId = "call") => definition.execute(callId, params, new AbortController().signal, undefined, ctx) };
}

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
		if (context.messages.some((message: any) => message.role === "toolResult")) return "done";
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

const REMINDER = "<subagent>\nYou are an agent in a team of agents collaborating to complete a task.\nWhen you provide your final answer, that content is immediately delivered back to your parent agent.\nIn addition, your final answer may be read by a human, so ensure it is legible.\nAny earlier instruction enabling proactive multi-agent delegation no longer applies. Do not spawn sub-agents unless the user, your task, role or system prompt, or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.\n</subagent>";
const CURSOR_REMINDER = "<subagent>\nYou are running as a subagent under a parent agent. Do not spawn additional subagents unless requested by the user or by your instructions.\n</subagent>";

test("a finished child's pushed result message ends with the follow-up", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root);
	await live.execute({ action: "start", task: "one", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	const pushed = parent.getEntries().filter((entry: any) => entry.type === "custom_message" && entry.customType === "agent") as any[];
	assert.deepEqual(pushed.map(entry => entry.content), [`[agent#1] answer\n\n${FOLLOW_UP}`]);
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
	assert.equal(properties.wake_on_alert.description, "wait: return on a new structured alert without consuming a result; default true");
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
	assert.deepEqual(waiting.details.statuses.map((status: any) => [status.id, status.state, status.error]),
		[["agent#1", "idle", undefined], ["agent#2", "idle", undefined]]);
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
	assert.equal(afterStatus.details.results.length, 0);
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
	now = 299999;
	t.mock.timers.tick(299999);
	const awake = await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(awake.details.statuses[0].run_id, 1);
	// The parent's wait rearms the full grace period.
	now = 300000;
	t.mock.timers.tick(1);
	const rearmed = await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(rearmed.details.statuses[0].run_id, 1);
	now = 540000;
	t.mock.timers.tick(240000);
	const interrupted = await live.execute({ action: "interrupt", id: "agent#1" });
	assert.equal(interrupted.content[0].text, "agent#1 is idle");
	now = 600000;
	t.mock.timers.tick(60000);
	const afterInterrupt = await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(afterInterrupt.details.statuses[0].run_id, 1);
	now = 900000;
	t.mock.timers.tick(300000);
	const asleep = await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(asleep.details.statuses[0].state, "idle");
	assert.equal(asleep.details.statuses[0].run_id, undefined);
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

test("filtered nested delivery survives five-minute hibernation and wake", async t => {
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
			return fauxAssistantMessage([fauxToolCall("codemode", { code: 'await tools.agent({ action: "start", task: "nested", tools: [] }); const waiting = tools.agent({ action: "wait", ids: ["agent#1"] }); await tools.agent({ action: "status", ids: ["agent#1"] }); await tools.read({ path: "release-model" }); text(JSON.parse(await waiting).results[0]?.text === ' + JSON.stringify(`nested answer\n\n${FOLLOW_UP}`) + ' ? "consumed" : "missing");' }, { id: "outer/filtered" })], { stopReason: "toolUse" });
		if (task === "delegate" && tools.length === 1 && context.messages.some((message: any) => message.role === "user" && message.content?.[0]?.text === "wake"))
			return fauxAssistantMessage([fauxToolCall("agent", { action: "wait", ids: ["agent#1"] }, { id: "wake/wait" })], { stopReason: "toolUse" });
		if (task === "delegate" && tools.length === 1)
			return tools[0].content.some((part: any) => part.text === "consumed") ? "consumed" : "missing";
		return task === "nested" ? nested.promise : JSON.stringify(context.messages.filter((message: any) => message.role !== "system" && message.role !== "assistant" && JSON.stringify(message.content).includes("nested answer")).length);
	}, 16, true);
	live.events.on("rqw-tools:subagent-tools", (request: any) => request.offer(() => [{
		name: "read", label: "Read", description: "Release fake model", parameters: { type: "object", properties: { path: { type: "string" } } },
		execute: async () => { nested.resolve(fauxAssistantMessage("nested answer")); return { content: [{ type: "text", text: "released" }], details: {} }; },
	}]));
	await live.execute({ action: "start", task: "delegate", tools: ["read"] });
	await live.runtime.wait(new AbortController().signal);
	await live.execute({ action: "wait", ids: ["agent#1"] });
	const beforeSleep = await live.execute({ action: "status", ids: ["agent#1"] });
	assert.ok(beforeSleep.details.statuses[0].messages.some((message: any) => message.role === "assistant" && message.text === "consumed"));
	now = 300000;
	t.mock.timers.tick(300000);
	const result = await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(result.details.statuses[0].run_id, undefined);
	live.ctx.mode = "print";
	await live.emit("agent_end");
	await live.execute({ action: "send", id: "agent#1", task: "wake" });
	await live.runtime.wait(new AbortController().signal);
	const wake = await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(wake.details.results[0].text, `0\n\n${FOLLOW_UP}`);
	live.runtime.close();
});

test("background holds and uncommitted notifications block overdue sleep until settlement", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let now = 0;
	t.mock.method(performance, "now", () => now);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root);
	let retain!: () => () => void;
	live.events.on("rqw-tools:subagent-tools", (request: any) => request.offer((_cwd: string, _settings: any, options: any) => {
		retain = options.retain;
		return [];
	}));
	await live.execute({ action: "start", task: "task", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	const release = retain();
	now = 300000;
	t.mock.timers.tick(300000);
	const held = await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(held.details.statuses[0].run_id, 1);
	release();
	now = 600000;
	t.mock.timers.tick(300000);
	const released = await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(released.details.statuses[0].run_id, undefined);
	live.runtime.close();

	const pending = runtimeFixture(parent, root);
	pending.ctx.mode = "print";
	await pending.emit("agent_end");
	await pending.execute({ action: "start", task: "pending task", tools: [] });
	await pending.runtime.wait(new AbortController().signal);
	now = 900000;
	t.mock.timers.tick(300000);
	await pending.emit("tool_call", { toolCallId: "call", parentToolCallId: "outer" });
	const waiting = await pending.execute({ action: "wait", ids: ["agent#2"] });
	assert.equal(waiting.details.statuses[0].run_id, 1);
	assert.equal(waiting.details.results[0].text, `answer\n\n${FOLLOW_UP}`);
	parent.appendMessage({ role: "toolResult", toolCallId: "outer", toolName: "codemode", content: [{ type: "text", text: "filtered answer" }], details: {}, isError: false, timestamp: 1 });
	await pending.emit("turn_end");
	now = 1200000;
	t.mock.timers.tick(300000);
	const settled = await pending.execute({ action: "wait", ids: ["agent#2"] });
	assert.equal(settled.details.statuses[0].run_id, undefined);
	pending.runtime.close();
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
	live.events.on("rqw-codex:session-policy", (request: any) => { sessions.push(request.session); });
	live.events.on("rqw:context-fork:v1", (request: any) => request.offer(async () => fauxAssistantMessage("progress")));
	live.events.on("rqw-tools:subagent-tools", (request: any) => request.offer(() => [{
		name: "read", label: "Read", description: "Fake external file", parameters: { type: "object", properties: { path: { type: "string" } } },
		execute: async () => ({ content: [{ type: "text", text: "fixed" }], details: {} }),
	}]));
	await live.execute({ action: "start", task: "sleep sibling", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	await live.emit("agent_end");
	await live.execute({ action: "start", task: "work", tools: ["read"] });
	await entered.promise;
	now = 300000;
	t.mock.timers.tick(300000);
	const sibling = await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(sibling.details.statuses[0].run_id, undefined);
	assert.equal(sibling.details.statuses[0].state, "idle");
	await live.execute({ action: "stop", id: "agent#2" });
	response.resolve(fauxAssistantMessage("done"));
	await Promise.all(sessions.map(session => session.waitForIdle()));
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
	const original = await live.execute({ action: "wait", ids: ["agent#1"] });
	now = 240000;
	t.mock.timers.tick(240000);
	await live.execute({ action: "restart", id: "agent#1", task: "new task", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	now = 300000;
	t.mock.timers.tick(60000);
	const current = await live.execute({ action: "wait", ids: ["agent#1"] });
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
	const retained = await memory.execute({ action: "wait", ids: ["agent#1"] });
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

/** Calls `wait` and commits its `waiting` receipt the way Pi does: an outer tool result in the branch, then the turn's end. */
async function acceptedWait(live: ReturnType<typeof runtimeFixture>, parent: SessionManager, callId: string, timeout = 60000, turnEnd = true) {
	const receipt = await live.execute({ action: "wait", ids: ["agent#1"], timeout_ms: timeout }, callId);
	parent.appendMessage({ role: "toolResult", toolCallId: callId, toolName: "agent", content: [{ type: "text", text: JSON.stringify(receipt.details) }], isError: false, timestamp: 1 });
	if (turnEnd) await live.emit("turn_end");
	return receipt.details.wait_id as string;
}
const waitRecords = (parent: SessionManager) => parent.getBranch().filter((entry: any) => entry.customType === "rqw-agent-wait").map((entry: any) => entry.data);

test("an accepted wait is saved, and a replacement or a sent child_wait closes it", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	t.mock.method(Date, "now", () => 1000);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await live.execute({ action: "start", task: "long task", tools: [] });
	await until(() => live.requests.length === 1);
	const one = await acceptedWait(live, parent, "call1");
	assert.deepEqual(waitRecords(parent), [{ version: 1, wait_id: one, open: true, call: "call1", deadline_at: 61000, until: "first", wake_on_alert: true,
		targets: [{ id: "agent#1", run: waitRecords(parent)[0].targets[0].run }] }]);
	assert.match(waitRecords(parent)[0].targets[0].run, /:1$/);
	const two = await acceptedWait(live, parent, "call2");
	assert.deepEqual(waitRecords(parent).map(record => [record.wait_id, record.open]), [[one, true], [two, true], [one, false]]);
	await live.execute({ action: "interrupt", id: "agent#1" });
	const sent = parent.getBranch().filter((entry: any) => entry.customType === "child_wait") as any[];
	assert.deepEqual(sent.map(entry => [entry.details.wait_id, entry.details.reason]), [[two, "target_changed"]]);
	// Sent, but not yet seen persisted by the turn's end: the wait is still open.
	const ofTwo = () => waitRecords(parent).filter(record => record.wait_id === two);
	assert.equal(ofTwo().at(-1).open, true);
	await live.emit("turn_end");
	assert.deepEqual(ofTwo().at(-1), { version: 1, wait_id: two, open: false });
	live.runtime.close();
});

/** A child waits on its first request and a notification wait is accepted; then the process dies (the first runtime is abandoned). */
async function crashedDuringWait(t: TestContext, restoredAt = 1000, restoredResponse?: () => Promise<never>, before?: (file: string, waitId: string) => Promise<void>, turnEnd = true) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const clock = { now: 1000 };
	t.mock.method(Date, "now", () => clock.now);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await first.execute({ action: "start", task: "long task", tools: [] });
	await until(() => first.requests.length === 1);
	const id = await acceptedWait(first, parent, "call1", 60000, turnEnd);
	clock.now = restoredAt;
	await before?.(parent.getSessionFile()!, id);
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root, restoredResponse);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	const sent = (): { wait_id: string; reason: string; timed_out: boolean; changed: { change: string }[]; results: { text: string }[] }[] => restored.ctx.sessionManager.getBranch().filter((entry: any) => entry.customType === "child_wait").map((entry: any) => entry.details);
	return { id, root, clock, restored, sent, plain: () => restored.ctx.sessionManager.getBranch().filter((entry: any) => entry.type === "custom_message" && entry.customType === "agent") };
}

test("a wait open at the crash delivers one child_wait with the answer of the resumed run", async t => {
	const crash = await crashedDuringWait(t);
	assert.equal(crash.sent().length, 0);
	await crash.restored.runtime.resume!(new AbortController().signal, true);
	await crash.restored.runtime.wait(new AbortController().signal);
	const [sent, ...more] = crash.sent();
	assert.equal(more.length, 0);
	assert.deepEqual([sent.wait_id, sent.reason, sent.results[0].text.split("\n\n")[0]], [crash.id, "result", "answer"]);
	assert.equal(crash.plain().length, 0);
	crash.restored.runtime.close();
});

test("a restored wait ends with target_changed when its child is restarted", async t => {
	const crash = await crashedDuringWait(t);
	assert.equal(crash.sent().length, 0);
	await crash.restored.execute({ action: "restart", id: "agent#1" });
	assert.deepEqual(crash.sent().map(sent => [sent.wait_id, sent.reason]), [[crash.id, "target_changed"]]);
	crash.restored.runtime.close();
});

test("a wait whose deadline passed during the crash times out at once", async t => {
	const crash = await crashedDuringWait(t, 70000);
	assert.deepEqual(crash.sent().map(sent => [sent.wait_id, sent.reason, sent.timed_out]), [[crash.id, "timeout", true]]);
	crash.restored.runtime.close();
});

/** A child's answer is taken by an accepted wait in the first runtime, which then dies before any turn ends. */
async function crashedAfterChildWait(t: TestContext) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	t.mock.method(Date, "now", () => 1000);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const gate = Promise.withResolvers<void>();
	const first = runtimeFixture(parent, root, async () => { await gate.promise; return "answer"; });
	await first.execute({ action: "start", task: "long task", tools: [] });
	await until(() => first.requests.length === 1);
	const id = await acceptedWait(first, parent, "call1");
	gate.resolve();
	await first.runtime.wait(new AbortController().signal);
	assert.deepEqual(waitRecords(parent).map(record => [record.wait_id, record.open]), [[id, true]]);
	return { id, parent, root, file: parent.getSessionFile()!, branch: (manager: SessionManager) => manager.getBranch() as any[] };
}

test("a wait whose child_wait was persisted before the crash is not raised again", async t => {
	const crash = await crashedAfterChildWait(t);
	const restored = runtimeFixture(SessionManager.open(crash.file), crash.root);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	const branch = crash.branch(restored.ctx.sessionManager);
	assert.equal(branch.filter(entry => entry.customType === "child_wait").length, 1);
	assert.equal(branch.filter(entry => entry.type === "custom_message" && entry.customType === "agent").length, 0);
	restored.runtime.close();
});

test("a wait whose child_wait was not persisted before the crash is raised again", async t => {
	const crash = await crashedAfterChildWait(t);
	const lines = (await readFile(crash.file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line))
		.map(entry => entry.customType === "child_wait" ? { type: "custom", id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp, customType: "unrelated", data: {} } : entry);
	await writeFile(crash.file, `${lines.map(entry => JSON.stringify(entry)).join("\n")}\n`);
	const restored = runtimeFixture(SessionManager.open(crash.file), crash.root);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	const sent = crash.branch(restored.ctx.sessionManager);
	// The saved answer is registered before the wait judges its target, so the wait takes it and nothing is sent twice.
	assert.deepEqual(sent.filter(entry => entry.customType === "child_wait").map(entry => [entry.details.wait_id, entry.details.reason, entry.details.results[0].text.split("\n\n")[0]]), [[crash.id, "result", "answer"]]);
	assert.equal(sent.filter(entry => entry.type === "custom_message" && entry.customType === "agent").length, 0);
	restored.runtime.close();
});

test("a saved answer that was not delivered before the crash is sent with the same delivery id", async t => {
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
	assert.deepEqual(pushed.map(entry => entry.details.delivery), [saved]);
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
	return (restored.ctx.sessionManager.getBranch() as any[]).filter(entry => entry.type === "custom_message" && entry.customType === "agent").length;
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
	now = 300000;
	t.mock.timers.tick(300000);
	const asleep = await live.execute({ action: "wait", ids: ["agent#1"] });
	assert.equal(asleep.details.statuses[0].run_id, undefined);
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

test("interrupting a child that waits for its recovery wakes its restored wait and keeps it paused", async t => {
	const crash = await crashedDuringWait(t);
	await crash.restored.execute({ action: "interrupt", id: "agent#1" });
	assert.deepEqual(crash.sent().map(sent => [sent.wait_id, sent.reason, sent.changed[0].change]), [[crash.id, "target_changed", "interrupt"]]);
	await crash.restored.runtime.resume!(new AbortController().signal, true);
	assert.equal(crash.restored.requests.length, 0);
	crash.restored.runtime.close();
});

test("a restored wait still follows its child after a second crash", async t => {
	const crash = await crashedDuringWait(t, 1000, () => new Promise<never>(() => {}));
	await crash.restored.runtime.resume!(new AbortController().signal, true);
	await until(() => crash.restored.requests.length === 1);
	const second = runtimeFixture(SessionManager.open(crash.restored.ctx.sessionManager.getSessionFile()!), crash.root);
	await second.execute({ action: "status", ids: ["agent#1"] });
	await second.runtime.resume!(new AbortController().signal, true);
	await second.runtime.wait(new AbortController().signal);
	const sent = (second.ctx.sessionManager.getBranch() as any[]).filter(entry => entry.customType === "child_wait");
	assert.deepEqual(sent.map(entry => [entry.details.wait_id, entry.details.reason]), [[crash.id, "result"]]);
	second.runtime.close();
});

test("a wait whose tool result was saved before the crash, but not the turn's end, is restored", async t => {
	const crash = await crashedDuringWait(t, 1000, undefined, undefined, false);
	await crash.restored.runtime.resume!(new AbortController().signal, true);
	await crash.restored.runtime.wait(new AbortController().signal);
	assert.deepEqual(crash.sent().map(sent => [sent.wait_id, sent.reason]), [[crash.id, "result"]]);
	crash.restored.runtime.close();
});

test("a wait whose tool result was never saved is not raised after a crash", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await first.execute({ action: "start", task: "long task", tools: [] });
	await until(() => first.requests.length === 1);
	await first.execute({ action: "wait", ids: ["agent#1"] }, "call1");
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	await restored.runtime.resume!(new AbortController().signal, true);
	await restored.runtime.wait(new AbortController().signal);
	const branch = restored.ctx.sessionManager.getBranch() as any[];
	assert.equal(branch.filter(entry => entry.customType === "child_wait").length, 0);
	assert.equal(branch.filter(entry => entry.type === "custom_message" && entry.customType === "agent").length, 1);
	restored.runtime.close();
});

/** The child record already holds the next run, written as crash recovery or as an ordinary run; the wait still names the earlier one. */
async function waitBehindChild(t: TestContext, recovery: boolean) {
	const bump = async (file: string) => {
		const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
		for (const entry of lines) if (entry.customType === "rqw-agent-child") {
			if (recovery) entry.data.recovers = `${entry.data.epoch}:${entry.data.runNumber}`;
			entry.data.runNumber++;
		}
		await writeFile(file, `${lines.map(entry => JSON.stringify(entry)).join("\n")}\n`);
	};
	const crash = await crashedDuringWait(t, 1000, undefined, bump);
	await crash.restored.runtime.resume!(new AbortController().signal, true);
	await crash.restored.runtime.wait(new AbortController().signal);
	const reasons = crash.sent().map(sent => [sent.wait_id, sent.reason]);
	crash.restored.runtime.close();
	return { crash, reasons };
}

test("a wait keeps following its child when the crash came between the child's record and the wait's", async t => {
	const { crash, reasons } = await waitBehindChild(t, true);
	assert.deepEqual(reasons, [[crash.id, "result"]]);
});

test("a wait ends with target_changed when the child's next run is not a crash recovery", async t => {
	const { crash, reasons } = await waitBehindChild(t, false);
	assert.deepEqual(reasons, [[crash.id, "target_changed"]]);
});

test("a wait whose opening record cannot be saved is not accepted", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await live.execute({ action: "start", task: "long task", tools: [] });
	await until(() => live.requests.length === 1);
	const append = parent.appendCustomEntry.bind(parent);
	t.mock.method(parent, "appendCustomEntry", (type: string, data: unknown) => {
		if (type === "rqw-agent-wait") throw new Error("disk full");
		return append(type, data);
	});
	await assert.rejects(live.execute({ action: "wait", ids: ["agent#1"] }, "call1"), /disk full/);
	await live.execute({ action: "interrupt", id: "agent#1" });
	assert.equal((parent.getBranch() as any[]).filter(entry => entry.customType === "child_wait").length, 0);
	live.runtime.close();
});

/** A first wait is accepted; then saving wait records fails for `failing`, and a second wait on the same child is asked for. */
async function replacementWithFailingJournal(t: TestContext, failing: (data: any) => boolean) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await live.execute({ action: "start", task: "long task", tools: [] });
	await until(() => live.requests.length === 1);
	const one = await acceptedWait(live, parent, "call1");
	const append = parent.appendCustomEntry.bind(parent);
	t.mock.method(parent, "appendCustomEntry", (type: string, data: any) => {
		if (type === "rqw-agent-wait" && failing(data)) throw new Error("disk full");
		return append(type, data);
	});
	await assert.rejects(live.execute({ action: "wait", ids: ["agent#1"] }, "call2"), /disk full/);
	// The old wait is still the accepted one: it gets the interruption.
	await live.execute({ action: "interrupt", id: "agent#1" });
	const sent = (parent.getBranch() as any[]).filter(entry => entry.customType === "child_wait").map(entry => entry.details.wait_id);
	live.runtime.close();
	return { one, sent, records: waitRecords(parent) };
}

test("a replacement that cannot save its opening record leaves the old wait open and accepted", async t => {
	const { one, sent, records } = await replacementWithFailingJournal(t, () => true);
	assert.deepEqual(sent, [one]);
	assert.deepEqual(records.filter(record => record.wait_id === one).map(record => record.open), [true]);
});

test("a replacement fails when the old wait's closing record cannot be saved, and the old wait stays accepted", async t => {
	const { one, sent } = await replacementWithFailingJournal(t, data => data.open === false);
	assert.deepEqual(sent, [one]);
});

test("a child_wait saved in a nested caller's durable inbox ends its wait on restore", async t => {
	const inbox = async (file: string, waitId: string) => {
		const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
		const last = JSON.parse(lines.at(-1)!);
		const entry = { type: "custom", id: "inbox001", parentId: last.id, timestamp: last.timestamp, customType: "rqw-agent-inbox",
			data: { version: 1, id: "message-1", message: { customType: "child_wait", content: "{}", display: true, details: { wait_id: waitId } } } };
		await writeFile(file, `${lines.join("\n")}\n${JSON.stringify(entry)}\n`);
	};
	const crash = await crashedDuringWait(t, 1000, undefined, inbox);
	await crash.restored.runtime.resume!(new AbortController().signal, true);
	await crash.restored.runtime.wait(new AbortController().signal);
	assert.equal(crash.sent().length, 0);
	crash.restored.runtime.close();
});

test("a wait whose closing record cannot be saved on cancellation stays accepted and is closed on the next try", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await live.execute({ action: "start", task: "long task", tools: [] });
	await until(() => live.requests.length === 1);
	let failing = true;
	const append = parent.appendCustomEntry.bind(parent);
	t.mock.method(parent, "appendCustomEntry", (type: string, data: any) => {
		if (failing && type === "rqw-agent-wait" && data.open === false) throw new Error("disk full");
		return append(type, data);
	});
	const receipt = await live.execute({ action: "wait", ids: ["agent#1"] }, "call1");
	// Its tool result failed: the wait is canceled, but the closing entry cannot be written.
	parent.appendMessage({ role: "toolResult", toolCallId: "call1", toolName: "agent", content: [{ type: "text", text: "failed" }], isError: true, timestamp: 1 });
	await live.emit("turn_end");
	assert.deepEqual(waitRecords(parent).map(record => record.open), [true]);
	failing = false;
	await live.emit("turn_end");
	assert.deepEqual(waitRecords(parent).map(record => [record.wait_id, record.open]), [[receipt.details.wait_id, true], [receipt.details.wait_id, false]]);
	live.runtime.close();
});

test("a replaced wait is restored when the replacing wait never got its tool result saved", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await first.execute({ action: "start", task: "long task", tools: [] });
	await until(() => first.requests.length === 1);
	const one = await acceptedWait(first, parent, "call1");
	// The replacing wait closed the first one; the crash came before its own tool result was saved.
	await first.execute({ action: "wait", ids: ["agent#1"] }, "call2");
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	await restored.runtime.resume!(new AbortController().signal, true);
	await restored.runtime.wait(new AbortController().signal);
	const sent = (restored.ctx.sessionManager.getBranch() as any[]).filter(entry => entry.customType === "child_wait");
	assert.deepEqual(sent.map(entry => [entry.details.wait_id, entry.details.reason]), [[one, "result"]]);
	restored.runtime.close();
});

test("a recovery that already completed before the crash still ends its restored wait with the result", async t => {
	// The child record holds a finished run that continued the one the wait recorded; its answer is saved.
	const finished = async (file: string) => {
		const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
		for (const entry of lines) if (entry.customType === "rqw-agent-child") {
			const data = entry.data;
			data.recovers = `${data.epoch}:${data.runNumber}`;
			data.runNumber++;
			data.state = "completed";
			data.result = { run: `${data.epoch}:${data.runNumber}`, text: "answer", outcome: "completed", meta: { model: "persist-test/model", stop: "stop" }, delivery: "saved-delivery" };
		}
		await writeFile(file, `${lines.map(entry => JSON.stringify(entry)).join("\n")}\n`);
	};
	const crash = await crashedDuringWait(t, 1000, undefined, finished);
	assert.deepEqual(crash.sent().map(sent => [sent.wait_id, sent.reason, sent.results[0].text.split("\n\n")[0]]), [[crash.id, "result", "answer"]]);
	crash.restored.runtime.close();
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

test("a wait accepted before an ordinary shutdown is restored with the reopened session", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	t.mock.method(Date, "now", () => 1000);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await first.execute({ action: "start", task: "long task", tools: [] });
	await until(() => first.requests.length === 1);
	const id = await acceptedWait(first, parent, "call1");
	await first.emit("session_shutdown");
	assert.deepEqual(waitRecords(parent).map(record => [record.wait_id, record.open]), [[id, true]]);
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	await restored.runtime.resume!(new AbortController().signal, true);
	await restored.runtime.wait(new AbortController().signal);
	const sent = (restored.ctx.sessionManager.getBranch() as any[]).filter(entry => entry.customType === "child_wait");
	assert.deepEqual(sent.map(entry => [entry.details.wait_id, entry.details.reason]), [[id, "result"]]);
	restored.runtime.close();
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

test("an ordinary shutdown does not deliver an answer a wait for all targets was holding", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const gate = Promise.withResolvers<void>();
	const first = runtimeFixture(parent, root, async (context: any) => {
		if (userTexts(context)[0] === "quick") { await gate.promise; return "answer"; }
		return new Promise<never>(() => {});
	});
	await first.execute({ action: "start", task: "quick", tools: [] });
	await first.execute({ action: "start", task: "slow", tools: [] });
	await until(() => first.requests.length === 2);
	const receipt = await first.execute({ action: "wait", ids: ["agent#1", "agent#2"], until: "all" }, "call1");
	parent.appendMessage({ role: "toolResult", toolCallId: "call1", toolName: "agent", content: [{ type: "text", text: JSON.stringify(receipt.details) }], isError: false, timestamp: 1 });
	await first.emit("turn_end");
	gate.resolve();
	await until(() => first.runtime.ids().length === 1);
	await first.emit("session_shutdown");
	assert.equal((parent.getBranch() as any[]).filter(entry => entry.type === "custom_message" && entry.customType === "agent").length, 0);
	first.runtime.close();
});
