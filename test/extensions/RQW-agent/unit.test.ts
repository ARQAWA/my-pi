import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { createFauxCore, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
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
	assert.deepEqual(profiles.map(profile => ({ name: profile.name, description: profile.description, model: profile.model, effort: profile.model_reasoning_effort })),
		[{ name: "scout", description: "Search", model: "model", effort: "low" }]);
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

function runtimeFixture(parent: SessionManager, cwd: string, response: (context: any, options: any) => string | ReturnType<typeof fauxAssistantMessage> | Promise<ReturnType<typeof fauxAssistantMessage>> = () => "answer", responses = 8, codemode = false) {
	const hooks = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	const events = createEventBus();
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
	const ctx: any = {
		cwd, sessionManager: parent, model, modelRegistry: { runtime: modelRuntime, find: () => model, hasConfiguredAuth: () => true },
		isIdle: () => true, isProjectTrusted: () => true, getSystemPrompt: () => "original prompt",
		signal: new AbortController().signal, mode: "tui",
	};
	const pi: any = {
		events, on: (name: string, hook: any) => hooks.set(name, [...hooks.get(name) ?? [], hook]),
		registerTool: (tool: any) => { definition = tool; },
		appendEntry: (name: string, data: any) => parent.appendCustomEntry(name, data),
		getSettings: () => ({ retry: { enabled: false }, compaction: { enabled: false } }),
		getThinkingLevel: () => "off", getActiveTools: () => codemode ? ["codemode"] : [],
		sendMessage: (message: any) => parent.appendCustomMessageEntry(message.customType, message.content, message.display, message.details),
	};
	const runtime = registerSessionRuntime(pi);
	return { runtime, requests, ctx, events, parameters: () => definition.parameters, description: () => definition.description as string, async emit(name: string, event: any = {}) { for (const hook of hooks.get(name) ?? []) await hook(event, ctx); },
		execute: (params: any) => definition.execute("call", params, new AbortController().signal, undefined, ctx) };
}

const REMINDER = "<subagent>\nYou are running as a subagent under a parent agent. Do not spawn additional subagents unless requested by the user or by your instructions.\n</subagent>";

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
	full.data.config.system = edit(full.data.config.system);
	const restored = runtimeFixture(parent, root);
	await restored.execute({ action: "send", id: "agent#1", task: "again" });
	await restored.runtime.wait(new AbortController().signal);
	const system = restored.requests.at(-1).messages.find((message: any) => message.role === "system").content;
	restored.runtime.close();
	return system;
}

test("a restored child with the legacy reminder gets the new one in place, role bytes unchanged", async t => {
	const system = await restoredSystem(t, { role: "  R\n" }, text => text.replace(REMINDER, LEGACY_REMINDER));
	assert.equal(system, `original prompt\n\n${REMINDER}\n\n<role>\nR\n</role>`);
});

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

test("registered description ends with Cursor's profile-list header and parameters carry Cursor guidance", async t => {
	const root = await temp(t);
	const live = runtimeFixture(SessionManager.create(root, join(root, "parent")), root);
	await live.emit("session_start");
	assert.match(live.description(), /\n\nAvailable agent_types and a quick description of what they do:\n/);
	assert.doesNotMatch(live.description(), /Agent types:/);
	const { title, interrupt, model } = live.parameters().properties;
	assert.ok(title.description.endsWith("Make it concrete and distinct, consider recent titles to avoid reuse."));
	assert.ok(interrupt.description.endsWith("Only use when the user explicitly asks to interrupt or change what the running agent is doing."));
	assert.equal(model.description, "provider/id. If omitted: on restart, the previous model if it was given explicitly (a previous model that came from the agent_type profile is dropped and the profile is re-read); otherwise the agent_type profile's model, if it has one; otherwise the caller's model. Omit model unless the user explicitly requested another model.");
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
	const branchA: any[] = [records[0], record({ ...latest, config: undefined, task: undefined }),
		record({ ...latest, id: 2, epoch: "stopped", state: "stopped" }),
		record({ ...latest, id: 3, config: { ...latest.config, system: null } }),
		{ type: "message", message: { role: "assistant", content: latest.result.run } }];
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
	const config = { system: "prompt" } as never;
	const a = { config, task: "task" };
	const record = (state: string) => ({ id: 1, state, config: { system: "prompt" }, task: "task" });
	const first = childRecord(a, record("running"));
	const second = childRecord(a, record("completed"));
	assert.deepEqual(second, { id: 1, state: "completed" });
	assert.deepEqual(mergeSaved(mergeSaved(undefined, first as never), second as never), record("completed"));
	assert.deepEqual(childRecord({ ...a, task: "next" }, record("running")), record("running"));
});
