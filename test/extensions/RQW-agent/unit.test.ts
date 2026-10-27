import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createEventBus, SessionManager, type AgentSession, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { Activity, headTail } from "../../../extensions/RQW-agent/activity.ts";
import { Coordinator } from "../../../extensions/RQW-agent/coordinator.ts";
import { createCountsProducer, type CountsOffer, type RunningCounts } from "../../../extensions/RQW-agent/counts.ts";
import { fastGpt, inheritedFastGpt } from "../../../extensions/RQW-agent/fast-gpt.ts";
import { createChildManager, openChildManager, repairInterrupted } from "../../../extensions/RQW-agent/persistence.ts";
import { ProfileCatalogue } from "../../../extensions/RQW-agent/profiles.ts";
import { CONTEXT_FORK, ProgressReports, type ContextForkRequest } from "../../../extensions/RQW-agent/progress.ts";
import { appendUserMessages, loadPromptFile } from "../../../extensions/RQW-agent/prompt-files.ts";
import { childRecord, collectExtensionFactories, mergeSaved } from "../../../extensions/RQW-agent/index.ts";

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

function coordinatorFixture(t: TestContext, busy = false) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	t.mock.method(performance, "now", () => 0);
	const hooks = new Map<string, ((event: any, context: any) => unknown)[]>();
	const sent: { message: any; options: any }[] = [];
	const branch: any[] = [];
	const context = { isIdle: () => !busy, sessionManager: { getBranch: () => branch }, signal: new AbortController().signal };
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
	assert.deepEqual((result.details.results as any[]).map((item: any) => [item.id, item.text, item.outcome]), [["agent#1", "answer", "completed"]]);
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
	assert.equal(f.sent[0].message.details.results[0].text, "answer");
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
