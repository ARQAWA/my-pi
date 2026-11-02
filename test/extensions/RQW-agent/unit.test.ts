import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { queryObjects } from "node:v8";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { createFauxCore, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, getCurrentTools, validateToolArguments } from "@earendil-works/pi-ai";
import { AgentSession, createEventBus, SessionManager, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { Activity, headTail } from "../../../extensions/RQW-agent/activity.ts";
import { type AutoSource, takeBackground, untilBackgroundChange } from "../../../extensions/RQW-agent/background.ts";
import { takeFrom } from "./consumer.ts";
import { countSyncSessionReads } from "./fixture.ts";
import { Coordinator } from "../../../extensions/RQW-agent/coordinator.ts";
import { createCountsProducer, type CountsOffer, type RunningCounts } from "../../../extensions/RQW-agent/counts.ts";
import { fastGpt, inheritedFastGpt } from "../../../extensions/RQW-agent/fast-gpt.ts";
import { createChildManager, openChildManager, recordDelivery, repairInterrupted, retainedChildManager, savedHistoryMatches } from "../../../extensions/RQW-agent/persistence.ts";
import { ProfileCatalogue } from "../../../extensions/RQW-agent/profiles.ts";
import { CONTEXT_FORK, PROGRESS_INTERVAL_MS, ProgressReports, type ContextForkRequest } from "../../../extensions/RQW-agent/progress.ts";
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

/** A child's progress reports on controlled timers; each request is answered unless `offers` is false. */
function timerFixture(t: TestContext, offers = true) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const events = createEventBus();
	const requests: ContextForkRequest[] = [];
	const notices: any[] = [];
	events.on(CONTEXT_FORK, value => {
		const request = value as ContextForkRequest;
		requests.push(request);
		if (offers) request.offer(async () => fauxAssistantMessage("summary"));
	});
	const progress = new ProgressReports(events, "agent#7", "child", (message, current, delivered) => {
		notices.push(message);
		if (current()) delivered();
	});
	const model = fauxProvider({ provider: "progress", models: [{ id: "model" }] }).getModel("model")!;
	progress.capture(model, { messages: [{ role: "user", content: "task", timestamp: 1 }] } as never);
	const response = fauxAssistantMessage([fauxToolCall("read", { path: "a" }, { id: "progress-read" })], { stopReason: "toolUse" });
	t.after(() => progress.invalidate());
	return { progress, requests, notices, respond: (count = 1) => { for (let i = 0; i < count; i++) progress.response(response, "low"); },
		tick: (ms: number) => t.mock.timers.tick(ms), settle: () => new Promise<void>(resolve => setImmediate(resolve)) };
}

test("progress reports after 30 minutes since the last communication, without claiming 50 steps", async t => {
	const f = timerFixture(t);
	f.respond(3);
	f.tick(PROGRESS_INTERVAL_MS - 1);
	assert.equal(f.requests.length, 0);
	f.tick(1);
	assert.equal(f.requests.length, 1);
	assert.equal(f.requests[0].reasoning, "low");
	const asked = f.requests[0].context.messages.at(-1)!.content as string;
	assert.ok(!asked.includes("50") && asked.includes("Latest response"));
	await f.settle();
	assert.equal(f.notices.length, 1);
	assert.deepEqual(f.notices[0].details, { id: "agent#7", continues: true });
	assert.match(f.notices[0].content, /^\[notification\] agent#7 has worked 30 minutes without communication\.\nsummary\n/);
	assert.ok(!f.notices[0].content.includes("50"));
	// A delivered report resets both limits: the steps and a new 30 minutes.
	assert.equal(f.progress.steps, 0);
	f.tick(PROGRESS_INTERVAL_MS - 1);
	assert.equal(f.requests.length, 1);
	f.tick(1);
	assert.equal(f.requests.length, 2);
});

test("the 50th step wins when it comes first, and the timer then restarts", async t => {
	const f = timerFixture(t);
	f.respond(50);
	assert.equal(f.requests.length, 1);
	await f.settle();
	assert.deepEqual(f.notices.map(notice => notice.details.steps), [50]);
	assert.equal(f.progress.steps, 0);
	// The step report restarted the 30 minutes.
	f.respond(1);
	f.tick(PROGRESS_INTERVAL_MS - 1);
	assert.equal(f.requests.length, 1);
	f.tick(1);
	assert.equal(f.requests.length, 2);
});

test("two limits met together make one report", async t => {
	const f = timerFixture(t);
	f.respond(49);
	f.tick(PROGRESS_INTERVAL_MS);
	f.respond(1);
	assert.equal(f.requests.length, 1);
	await f.settle();
	assert.equal(f.notices.length, 1);
});

test("a communication reset moves the 30 minute limit", t => {
	const f = timerFixture(t);
	f.respond(1);
	f.tick(20 * 60 * 1000);
	f.progress.reset();
	f.tick(PROGRESS_INTERVAL_MS - 1);
	assert.equal(f.requests.length, 0);
	f.tick(1);
	assert.equal(f.requests.length, 1);
});

test("an idle child has no timer; end or invalidation stops a running one", t => {
	const f = timerFixture(t);
	f.progress.reset();
	f.tick(PROGRESS_INTERVAL_MS * 2);
	assert.equal(f.requests.length, 0);
	f.respond(1);
	f.progress.invalidate();
	f.tick(PROGRESS_INTERVAL_MS * 2);
	assert.equal(f.requests.length, 0);
	// The next tool-call response of a resumed run starts a new 30 minutes.
	f.respond(1);
	f.tick(PROGRESS_INTERVAL_MS);
	assert.equal(f.requests.length, 1);
});

test("compaction and a model change drop the snapshot but keep the 30 minute limit", t => {
	const f = timerFixture(t);
	f.respond(1);
	f.tick(29 * 60 * 1000);
	f.progress.discard();
	f.progress.capture(fauxProvider({ provider: "progress", models: [{ id: "other" }] }).getModel("other")!, { messages: [] } as never);
	f.tick(60 * 1000 - 1);
	assert.equal(f.requests.length, 0);
	f.tick(1);
	assert.equal(f.requests.length, 1);
});

/** A resumed child with a pending progress report and a running 30 minute limit. */
async function resumedProgressChild(t: TestContext) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await mkdtemp(join(tmpdir(), "rqw-agent-unit-"));
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	// The resumed run emits 50 tool responses, then stays live with its progress report pending.
	let requests = 0;
	const firstReady = Promise.withResolvers<void>();
	const resumedReady = Promise.withResolvers<void>();
	const respond = () => {
		requests++;
		if (requests === 1 || (requests >= 3 && requests <= 52)) return fauxAssistantMessage([fauxToolCall("read", { path: "missing.txt" }, { id: `call-${requests}` })], { stopReason: "toolUse" });
		(requests === 2 ? firstReady : resumedReady).resolve();
		return new Promise<never>(() => {});
	};
	const first = runtimeFixture(parent, root, respond);
	await first.execute({ action: "start", task: "long task", tools: ["read"] });
	await firstReady.promise;
	first.runtime.close();
	const forks: ContextForkRequest[] = [];
	const report = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root, respond, 60, false,
		events => { events.on(CONTEXT_FORK, value => {
			const request = value as ContextForkRequest;
			forks.push(request);
			request.offer(() => report.promise);
		}); });
	// Only a restored or resumed child binds the extension hooks; keep that session to raise their events.
	const bind = Object.getOwnPropertyDescriptor(AgentSession.prototype, "bindExtensions")!;
	let session: any;
	Object.defineProperty(AgentSession.prototype, "bindExtensions", { ...bind, value(this: AgentSession, ...args: unknown[]) { session = this; return bind.value.apply(this, args); } });
	t.after(async () => {
		restored.runtime.close();
		await rm(root, { recursive: true, force: true });
		Object.defineProperty(AgentSession.prototype, "bindExtensions", bind);
	});
	await restored.execute({ action: "resume", id: "agent#1" });
	await resumedReady.promise;
	assert.ok(session, "the resumed child binds its extension hooks");
	assert.equal(forks.length, 1);
	return { session, forks, report, parent: restored.ctx.sessionManager, other: restored.ctx.modelRegistry.find("persist-test", "other") };
}

test("a model change in a running child drops its snapshot but keeps the 30 minute deadline", async t => {
	const f = await resumedProgressChild(t);
	t.mock.timers.tick(10 * 60 * 1000);
	await f.session.setModel(f.other);
	assert.equal(f.forks[0].signal.aborted, true);
	f.report.resolve(fauxAssistantMessage("stale"));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(f.parent.getBranch().some((entry: any) => entry.customType === "agent_progress"), false);
	t.mock.timers.tick(20 * 60 * 1000 - 1);
	assert.equal(f.forks.length, 1);
	t.mock.timers.tick(1);
	assert.equal(f.forks.length, 2);
});

test("compaction in a running child drops its snapshot but keeps the 30 minute deadline", async t => {
	const f = await resumedProgressChild(t);
	t.mock.timers.tick(10 * 60 * 1000);
	f.session._emit({ type: "compaction_start", reason: "threshold" });
	assert.equal(f.forks[0].signal.aborted, true);
	f.report.resolve(fauxAssistantMessage("stale"));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(f.parent.getBranch().some((entry: any) => entry.customType === "agent_progress"), false);
	t.mock.timers.tick(20 * 60 * 1000 - 1);
	assert.equal(f.forks.length, 1);
	t.mock.timers.tick(1);
	assert.equal(f.forks.length, 2);
});

test("a failed summary is tried again only after another 30 minutes", t => {
	const f = timerFixture(t, false);
	f.respond(1);
	f.tick(PROGRESS_INTERVAL_MS);
	assert.equal(f.requests.length, 1);
	f.tick(PROGRESS_INTERVAL_MS - 1);
	assert.equal(f.requests.length, 1);
	f.tick(1);
	assert.equal(f.requests.length, 2);
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
	return { coordinator, sent, branch, emit, context,
		finish: (title?: string) => { live = false; coordinator.publish(target.id, target.run, "answer", "completed", undefined, title); } };
}

/** The automatic source of a coordinator fixture and its saved hidden messages. */
function autoOf(f: ReturnType<typeof coordinatorFixture>) {
	const saved: { content: string; details: unknown }[] = [];
	const { source } = f.coordinator.autoSource({ sessionManager: f.context.sessionManager } as never);
	return { saved, take: () => takeFrom(source, message => { saved.push(message); }) };
}

test("an automatic answer carries only id, title, outcome and text, never statuses", async t => {
	const f = coordinatorFixture(t);
	const auto = autoOf(f);
	const taking = auto.take();
	f.finish("Scout");
	const result = await taking;
	const body = JSON.parse(result.content[0].text);
	assert.deepEqual(Object.keys(body), ["results"]);
	assert.deepEqual(Object.keys(body.results[0]), ["id", "title", "outcome", "text"]);
	assert.equal(body.results[0].title, "Scout");
});

test("the source claims a completed child result with the follow-up text", async t => {
	const f = coordinatorFixture(t);
	const taking = autoOf(f).take();
	f.finish();
	const result = await taking;
	assert.deepEqual((result.details.results as any[]).map((item: any) => [item.id, item.text, item.outcome]), [["agent#1", `answer\n\n${FOLLOW_UP}`, "completed"]]);
});

test("the model-visible text carries the follow-up once, a repeat delivers nothing", async t => {
	const f = coordinatorFixture(t);
	const auto = autoOf(f);
	const taking = auto.take();
	f.finish();
	const result = await taking;
	assert.equal(JSON.parse(result.content[0].text).results[0].text, `answer\n\n${FOLLOW_UP}`);
	assert.equal(result.details.results[0].text, `answer\n\n${FOLLOW_UP}`);
	assert.deepEqual((await auto.take()).details.results, []);
});

test("receipt write failure still commits an automatic result", async t => {
	const root = await temp(t);
	const sessionFile = join(root, "parent.jsonl");
	await writeFile(sessionFile, "");
	// A directory at the receipt filename makes the real filesystem reject appending.
	await mkdir(`${sessionFile}.children/delivered`, { recursive: true });
	const f = coordinatorFixture(t, false, sessionFile);
	const auto = autoOf(f);
	const taking = auto.take();
	f.finish();
	const result = await taking;
	assert.equal((result.details.results as any[])[0].text, `answer\n\n${FOLLOW_UP}`);
	f.emit("turn_end");
	assert.deepEqual((await auto.take()).details.results, []);
	assert.equal(auto.saved.length, 1);
});

test("child sessions persist below their parent and reopen", async t => {
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const child = await createChildManager(parent, root, "agent", 1);
	child.appendMessage({ role: "user", content: "child", timestamp: 2 });
	const reopened = await openChildManager(parent, child.getSessionFile()!, root, "agent", 1);
	assert.deepEqual(reopened.buildSessionContext(), child.buildSessionContext());
	assert.equal(reopened.getHeader()?.parentSession, parent.getSessionFile());
});

test("an interrupted tool call is cut from the request and nothing is added to the saved history", async t => {
	const root = await temp(t);
	const manager = SessionManager.inMemory(root);
	manager.appendMessage({ role: "user", content: "task", timestamp: 1 });
	manager.appendMessage(fauxAssistantMessage([fauxToolCall("write", { path: "a" }, { id: "call" })], { stopReason: "aborted" }));
	const saved = manager.getEntries().length;
	const agent = new Agent({ streamFn: () => { throw new Error("no model call"); } });
	assert.equal(repairInterrupted({ agent, sessionManager: manager } as AgentSession), true);
	assert.deepEqual(agent.state.messages.map(message => message.role), ["user"]);
	assert.equal(manager.getEntries().length, saved);
});

test("a cut call that leaves an assistant message last adds the continue line to the request only", async t => {
	const root = await temp(t);
	const manager = SessionManager.inMemory(root);
	manager.appendMessage({ role: "user", content: "task", timestamp: 1 });
	manager.appendMessage(fauxAssistantMessage([fauxText("plan"), fauxToolCall("write", { path: "a" }, { id: "call" })], { stopReason: "toolUse" }));
	const saved = manager.getEntries().length;
	const agent = new Agent({ streamFn: () => { throw new Error("no model call"); } });
	assert.equal(repairInterrupted({ agent, sessionManager: manager } as AgentSession), true);
	const messages = agent.state.messages;
	assert.deepEqual(messages.map(message => message.role), ["user", "assistant", "user"]);
	assert.deepEqual((messages[1] as any).content.map((part: any) => part.type), ["text"]);
	assert.deepEqual((messages[2] as any).content, [{ type: "text", text: "continue; the removed call was not repeated" }]);
	assert.equal(manager.getEntries().length, saved);
});

test("a finished assistant message gets no continue line", async t => {
	const root = await temp(t);
	const manager = SessionManager.inMemory(root);
	manager.appendMessage({ role: "user", content: "task", timestamp: 1 });
	manager.appendMessage(fauxAssistantMessage("done"));
	const agent = new Agent({ streamFn: () => { throw new Error("no model call"); } });
	assert.equal(repairInterrupted({ agent, sessionManager: manager } as AgentSession), false);
	assert.deepEqual(agent.state.messages.map(message => message.role), ["user", "assistant"]);
});

test("an unanswered call before later conversation no longer blocks recovery", async t => {
	const root = await temp(t);
	const manager = SessionManager.inMemory(root);
	manager.appendMessage({ role: "user", content: "task", timestamp: 1 });
	manager.appendMessage(fauxAssistantMessage([fauxToolCall("write", { path: "a" }, { id: "call" })], { stopReason: "toolUse" }));
	manager.appendMessage({ role: "user", content: "next", timestamp: 2 });
	const agent = new Agent({ streamFn: () => { throw new Error("no model call"); } });
	assert.equal(repairInterrupted({ agent, sessionManager: manager } as AgentSession), true);
	assert.deepEqual(agent.state.messages.map(message => message.role), ["user", "user"]);
});

function runtimeFixture(parent: SessionManager, cwd: string, response: (context: any, options: any) => string | ReturnType<typeof fauxAssistantMessage> | Promise<string | ReturnType<typeof fauxAssistantMessage>> = () => "answer", responses = 8, codemode = false, setup?: (events: ReturnType<typeof createEventBus>) => void, onRunning?: () => void) {
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
		stream: core.streamSimple,
		streamSimple: (selected: any, context: any, options: any) => { requestModels.push(selected.id); return core.streamSimple(selected, context, options); },
	};
	let definition: any;
	const notices: string[] = [];
	const sent: { customType: string; triggerTurn: boolean | undefined }[] = [];
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
		sendMessage: (message: any, options?: { triggerTurn?: boolean }) => {
			sent.push({ customType: message.customType, triggerTurn: options?.triggerTurn });
			parent.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
		},
	};
	const runtime = registerSessionRuntime(pi, pi.events, false, undefined, undefined, onRunning, undefined, "", undefined);
	let started = false;
	return { runtime, requests, requestModels, ctx, events, notices, sent, parameters: () => definition.parameters, description: () => definition.description as string, async emit(name: string, event: any = {}) { let result: unknown; for (const hook of hooks.get(name) ?? []) result = await hook(event, ctx); return result; },
		execute: (params: any, callId = "call", signal = new AbortController().signal) => definition.execute(callId, params, signal, undefined, ctx),
		/** The results of this caller's children as the automatic consumer delivers them, see takeFrom. */
		takeAnswers: async (save = true) => {
			// As Pi starts the caller's session: it adopts the session, and the saved children publish their answers.
			if (!started) {
				started = true;
				for (const hook of hooks.get("session_start") ?? []) await hook({}, ctx);
				await runtime.resume!(new AbortController().signal, true);
			}
			return takeFrom(runtime.autoSource!()!, message => { if (save) parent.appendCustomMessageEntry("rqw-auto-wait-results", message.content, false, message.details); });
		} };
}

async function commitWait(live: ReturnType<typeof runtimeFixture>, _parent: SessionManager, _id = "agent#1") {
	const result = await live.takeAnswers();
	await live.emit("turn_end");
	return result;
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

test("core settlement preserves whether a progress notification may start a turn", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	for (const aborted of [false, true]) {
		const parent = SessionManager.inMemory(root);
		parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
		let steps = 0;
		const gate = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
		const live = runtimeFixture(parent, root, () => ++steps <= 50
			? fauxAssistantMessage([fauxToolCall("read", {}, { id: `read-${steps}` })], { stopReason: "toolUse" }) : gate.promise, 52, false, offerCatalog);
		live.events.on("rqw:context-fork:v1", request => (request as ContextForkRequest).offer(async () => fauxAssistantMessage("progress")));
		try {
			await live.emit("session_start");
			live.runtime.settle!(aborted);
			await live.execute({ action: "start", task: "work", tools: ["read"] });
			await until(() => live.sent.some(message => message.customType === "agent_progress"));
			assert.equal(live.sent.find(message => message.customType === "agent_progress")?.triggerTurn, !aborted);
		} finally {
			gate.resolve(fauxAssistantMessage("done"));
			live.runtime.close();
			await settle();
		}
	}
});

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

test("nested progress wakes its waiting parent", async t => {
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
		if (results.length) return "parent waits";
		return fauxAssistantMessage([fauxToolCall("agent", { action: "start", task: "nested", tools: ["rqw_readfile"] }, { id: "delegate" })], { stopReason: "toolUse" });
	}, 60, false, offerCatalog);
	t.after(() => { report.resolve(fauxAssistantMessage("progress")); childGate.resolve(fauxAssistantMessage("done")); live.runtime.close(); });
	live.events.on("rqw:context-fork:v1", (request: any) => request.offer(() => report.promise));
	await live.execute({ action: "start", task: "outer", tools: ["rqw_readfile"] });
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
	assert.ok(restored.requests.some((request: any) => userTexts(request).includes("continue")));
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
			const repeated = await restored.takeAnswers();
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
		const result = await restored.takeAnswers();
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

const settle = async (ticks = 40) => { for (let i = 0; i < ticks; i++) await new Promise(resolve => setImmediate(resolve)); };
const outerRequests = (live: { requests: any[] }) => live.requests.filter((request: any) => userTexts(request)[0] === "outer");

/** An outer child that starts one gated helper and ends its turn; the helper's answer is "nested answer". */
async function outerWithHelper(t: TestContext, outerReply: (context: any, results: number) => string | ReturnType<typeof fauxAssistantMessage> | Promise<never>, persisted = false) {
	const root = await temp(t);
	const parent = persisted ? SessionManager.create(root, join(root, "parent")) : SessionManager.inMemory(root);
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const gate = Promise.withResolvers<string>();
	const entered = Promise.withResolvers<void>();
	const live = runtimeFixture(parent, root, context => {
		if (userTexts(context)[0] === "nested") { entered.resolve(); return gate.promise; }
		const results = context.messages.filter((message: any) => message.role === "toolResult").length;
		if (!results && !JSON.stringify(context.messages).includes("nested answer"))
			return fauxAssistantMessage([fauxToolCall("agent", { action: "start", task: "nested", tools: [] }, { id: "start-nested" })], { stopReason: "toolUse" });
		return outerReply(context, results);
	}, 16);
	t.after(() => { gate.resolve("nested answer"); if (!persisted) live.runtime.close(); });
	await live.execute({ action: "start", task: "outer", tools: [] });
	await entered.promise;
	return { live, gate, parent };
}

const waitingReply = (context: any) => JSON.stringify(context.messages).includes("nested answer") ? "all done" : "started it, waiting";

test("a child whose helper still runs gives its parent no final; the helper's answer wakes it once", async t => {
	const { live, gate } = await outerWithHelper(t, waitingReply);
	let finished = false;
	const waiting = live.takeAnswers();
	void waiting.then(() => { finished = true; });
	await settle();
	assert.equal(finished, false, "the intermediate answer is not a final");
	assert.equal(outerRequests(live).length, 2, "waiting for the helper makes no model request");
	assert.equal(live.runtime.runningCounts().agents, 2);
	gate.resolve("nested answer");
	await until(() => finished);
	const waited = await waiting;
	assert.equal(outerRequests(live).length, 3);
	assert.deepEqual(waited.details.results.map(item => item.text.split("\n\n")[0]), ["all done"]);
	const woken = outerRequests(live).at(-1).messages.filter((message: any) => JSON.stringify(message.content).includes("nested answer"));
	assert.equal(woken.length, 1);
});

test("send wakes a waiting child at once and keeps its run open", async t => {
	const { live, gate } = await outerWithHelper(t, (context, results) => {
		if (JSON.stringify(context.messages).includes("nested answer")) return "all done";
		if (userTexts(context).includes("stop it") && results === 1) return fauxAssistantMessage([fauxToolCall("agent", { action: "stop", id: "agent#1" }, { id: "stop-nested" })], { stopReason: "toolUse" });
		return userTexts(context).includes("stop it") ? "stopped it" : "started it, waiting";
	});
	let finished = false;
	const waiting = live.takeAnswers();
	void waiting.then(() => { finished = true; });
	await settle();
	await live.execute({ action: "send", id: "agent#1", task: "stop it" });
	await until(() => finished);
	const waited = await waiting;
	assert.equal(outerRequests(live).filter((request: any) => userTexts(request).includes("stop it")).length, 2, "one turn for the send, one after the stop");
	assert.deepEqual(waited.details.results.map(item => item.text.split("\n\n")[0]), ["stopped it"]);
	gate.resolve("nested answer");
});

function readySource(id: string, log: string[], ready = true): AutoSource {
	let pending = ready;
	return {
		version: 1, snapshot: () => ({ targets: [], ready: pending }), subscribe: () => () => {},
		claim: () => { if (!pending) return undefined; pending = false; return { token: id, results: [{ id, run: `${id}:1`, delivery: `${id}:d`, outcome: "completed", text: `${id} done` }] }; },
		commit: token => { log.push(`commit ${token}`); }, release: token => { log.push(`release ${token}`); },
	};
}

test("results of several sources that are ready together make one inbox message, committed after it is saved", () => {
	const log: string[] = [];
	const messages: any[] = [];
	const taken = takeBackground([readySource("agent#1", log), readySource("job#1", log), readySource("agent#2", log, false)], message => { log.push("saved"); messages.push(message); });
	assert.equal(taken, true);
	assert.equal(messages.length, 1);
	assert.equal(messages[0].customType, "rqw-auto-wait-results");
	assert.deepEqual(JSON.parse(messages[0].content).results.map((item: any) => item.id), ["agent#1", "job#1"]);
	assert.deepEqual(log, ["saved", "commit agent#1", "commit job#1"]);
	assert.equal(takeBackground([readySource("agent#3", log, false)], () => assert.fail("nothing is ready")), false);
});

test("a failed inbox write gives the claimed results back instead of committing them", () => {
	const log: string[] = [];
	assert.throws(() => takeBackground([readySource("agent#1", log)], () => { throw new Error("disk full"); }), /disk full/);
	assert.deepEqual(log, ["release agent#1"]);
});

test("a result that became ready before the sleep subscribed ends the sleep at once", async () => {
	const source = readySource("agent#1", []);
	const log: string[] = [];
	await untilBackgroundChange({ sources: [source], subscribe: () => () => { log.push("unsubscribed"); }, settled: () => false, signal: new AbortController().signal });
	assert.deepEqual(log, ["unsubscribed"]);
});

test("a sleeping child loop ends on abort and leaves no subscription behind", async () => {
	const controller = new AbortController();
	let subscribers = 0;
	const source: AutoSource = { ...readySource("agent#1", [], false), snapshot: () => ({ targets: ["agent#1"], ready: false }),
		subscribe: () => { subscribers++; return () => { subscribers--; }; } };
	const sleeping = untilBackgroundChange({ sources: [source], subscribe: () => () => {}, settled: () => false, signal: controller.signal });
	assert.equal(subscribers, 1);
	controller.abort(new Error("stop"));
	await assert.rejects(sleeping, /stop/);
	assert.equal(subscribers, 0);
});

test("a helper stopped without an answer does not leave the child waiting", async t => {
	const { live } = await outerWithHelper(t, (context, results) => {
		if (userTexts(context).includes("stop it") && results === 1) return fauxAssistantMessage([fauxToolCall("agent", { action: "stop", id: "agent#1" }, { id: "stop-nested" })], { stopReason: "toolUse" });
		return userTexts(context).includes("stop it") ? "stopped it" : "started it, waiting";
	});
	await live.execute({ action: "send", id: "agent#1", task: "stop it" });
	const waited = await live.takeAnswers();
	assert.deepEqual(waited.details.results.map((item: any) => item.text.split("\n\n")[0]), ["stopped it"]);
	assert.equal(live.runtime.runningCounts().agents, 0);
});

test("interrupting a waiting child stops its helper and yields no answer", async t => {
	const { live, parent } = await outerWithHelper(t, waitingReply);
	await live.execute({ action: "interrupt", id: "agent#1" });
	await live.runtime.wait(new AbortController().signal);
	await until(() => live.runtime.runningCounts().agents === 0);
	const records = parent.getBranch().filter((entry: any) => entry.customType === "rqw-agent-child").map((entry: any) => entry.data);
	assert.equal(records.at(-1).state, "paused");
	assert.equal(records.at(-1).result, undefined);
});

test("a helper error turn is not a final while the helper runs; the last turn's text is the answer", async t => {
	const { live, gate } = await outerWithHelper(t, (context, results) => JSON.stringify(context.messages).includes("nested answer") ? "recovered"
		: fauxAssistantMessage("", { stopReason: "error", errorMessage: `boom ${results}` }));
	let finished = false;
	const waiting = live.takeAnswers();
	void waiting.then(() => { finished = true; });
	await settle();
	assert.equal(finished, false);
	gate.resolve("nested answer");
	await until(() => finished);
	const waited = await waiting;
	assert.equal(waited.details.results[0].outcome, "completed");
	assert.match(waited.details.results[0].text, /^recovered/);
});

/** What RQW-tools' job registry offers a child: a source of job results, a running count and hasJobs. */
function fakeJobs(initiallyRunning = 1) {
	const listeners = new Set<(value: true | null) => void>();
	const activity = new Set<() => void>();
	const committed: string[] = [];
	let running = initiallyRunning;
	let ready: { id: string; outcome: string; text: string } | undefined;
	const source = {
		version: 1 as const,
		snapshot: () => ({ targets: running ? ["job#1"] : [], ready: !!ready }),
		subscribe: (listener: (value: true | null) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		claim: () => { const result = ready; ready = undefined; return result ? { token: "claim", results: [result] } : undefined; },
		commit: (token: string) => { committed.push(token); },
		release() {},
	};
	return { committed, hasJobs: () => running > 0 || !!ready,
		control: { abortAll() {}, dispose() {}, hasJobs: () => running > 0 || !!ready, backgroundCount: () => running, subscribeActivity: (listener: () => void) => { activity.add(listener); return () => activity.delete(listener); }, autoSource: () => ({ source, close() {} }) },
		finish(text: string) { running = 0; ready = { id: "job#1", outcome: "exited", text }; for (const listener of [...listeners]) listener(true); for (const listener of [...activity]) listener(); } };
}

/** Offers a child the `bash` that "starts a job" and the `job` tool of this registry, as RQW-tools would. */
function offerJobs(live: { events: ReturnType<typeof createEventBus> }, jobs: ReturnType<typeof fakeJobs>) {
	live.events.on("rqw-tools:subagent-tools", (request: any) => request.offer(() => [{
		name: "bash", label: "bash", description: "slow", parameters: { type: "object", properties: {} },
		execute: async () => ({ content: [{ type: "text", text: "job#1 runs in the background" }], details: {} }),
	}, { name: "job", label: "job", description: "job", parameters: { type: "object", properties: {} }, jobs: jobs.control, execute: async () => ({ content: [], details: {} }) }]));
}

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
	assert.deepEqual(first.details.results.map((result: any) => result.text.split("\n\n")[0]), ["answer one", "answer two"]);
	const repeat = await restored.takeAnswers();
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
	const repeated = await live.takeAnswers();
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

test("Pi extension loader retains enum schemas for agent, todo and job", async t => {
	const root = fileURLToPath(new URL("../../../", import.meta.url));
	const cwd = await temp(t);
	const loader = await import(new URL("node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js", new URL("../../../", import.meta.url)).href);
	const methods = ["bindExtensions", "_refreshToolRegistry", "_setActiveTools"];
	const originals = methods.map(name => Object.getOwnPropertyDescriptor(AgentSession.prototype, name));
	const loaded = await loader.loadExtensions(["RQW-agent", "RQW-todo", "RQW-tools"].map(name => join(root, "extensions", name, "index.ts")), cwd);
	try {
		assert.deepEqual(loaded.errors, []);
		const tool = (name: string) => loaded.extensions.flatMap((extension: any) => [...extension.tools.values()]).find((entry: any) => entry.definition.name === name).definition;
		assert.deepEqual(tool("agent").parameters.properties.action.enum, ["start", "status", "send", "resume", "interrupt", "stop", "restart"]);
		assert.deepEqual(tool("todo").parameters.properties.items.items.properties.status.enum, ["pending", "active", "done", "dropped", "blocked"]);
		assert.deepEqual(tool("job").parameters.properties.action.enum, ["status", "kill"]);
	} finally {
		const tools = loaded.extensions.find((extension: any) => extension.tools.has("job"));
		for (const handler of tools?.handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown", reason: "quit" }, { sessionManager: {} });
	}
	assert.deepEqual(methods.map(name => Object.getOwnPropertyDescriptor(AgentSession.prototype, name)), originals);
});

test("agent enum schema validates and coerces Pi 1.5 tool arguments", async t => {
	const root = await temp(t);
	const live = runtimeFixture(SessionManager.create(root, join(root, "parent")), root);
	const tool: any = { name: "agent", parameters: live.parameters() };
	const parse = (args: unknown) => validateToolArguments(tool, { type: "toolCall", id: "id", name: "agent", arguments: args } as any);
	assert.deepEqual(JSON.parse(JSON.stringify(tool.parameters)).properties.action.enum, ["start", "status", "send", "resume", "interrupt", "stop", "restart"]);
	assert.deepEqual(parse({ action: "status", ids: "agent#1", messages: "5", thinking: null }), { action: "status", ids: ["agent#1"], messages: 5 });
	assert.throws(() => parse({ action: "invalid" }), /Validation failed/);
	live.runtime.close();
});

test("child keeps Pi summary identity and custom SDK auth", async t => {
	const root = await temp(t);
	const live = runtimeFixture(SessionManager.create(root, join(root, "parent")), root);
	let child: any;
	let nativeStream: any;
	let afterChildHook: any;
	live.ctx.modelRegistry.runtime.getAuth = async () => ({ auth: { apiKey: "explicit-key" }, env: {} });
	live.events.on("rqw-codex:session-policy", (request: any) => {
		child = request.session;
		nativeStream = child.agent.streamFunction;
		queueMicrotask(() => { afterChildHook = child.agent.streamFunction; });
	});
	try {
		await live.execute({ action: "start", task: "task" });
		await live.runtime.wait(new AbortController().signal);
		assert.equal(afterChildHook, nativeStream);
		const original = child.agent.streamFunction;
		assert.equal(child.agent.streamFunction, nativeStream);
		const summary = await child._getSummarizationRequestAuth(child.model, new AbortController().signal);
		assert.equal(summary.apiKey, undefined);
		child.agent.streamFunction = () => { throw new Error("custom stream"); };
		const custom = await child._getSummarizationRequestAuth(child.model, new AbortController().signal);
		assert.equal(custom.apiKey, "explicit-key");
		child.agent.streamFunction = original;
	} finally { live.runtime.close(); }
});

test("child virtual routing repairs once and keeps parent and cache replay untouched", async t => {
	const root = await temp(t);
	const live = runtimeFixture(SessionManager.create(root, join(root, "parent")), root);
	const runtime = live.ctx.modelRegistry.runtime;
	const original = runtime.streamSimple;
	const seen: { context: any; options: any }[] = [];
	let childId = "";
	live.events.on("rqw-codex:session-policy", (request: any) => { childId = request.session.sessionManager.getSessionId(); });
	runtime.streamSimple = (model: any, context: any, options: any) => {
		if (model.api === "pi-virtual") return runtime.streamSimple({ ...model, api: "anthropic-messages" }, context, options);
		seen.push({ context, options });
		return original(model, context, options);
	};
	try {
		await live.execute({ action: "start", task: "task" });
		await live.runtime.wait(new AbortController().signal);
		const model = { ...live.ctx.model, api: "pi-virtual" };
		const context = { messages: [{ role: "user", content: "task", timestamp: 1 },
			{ role: "toolResult", toolCallId: "orphan", toolName: "read", content: [], isError: false, timestamp: 1 }] };
		const owner = Symbol.for("rqw:request-owner:v1");
		await runtime.streamSimple(model, context, { sessionId: childId, cacheRetention: "long" }).result();
		const child = seen.at(-1)!;
		assert.equal(child.options.cacheRetention, "short");
		assert.deepEqual(child.options[owner], { sessionId: childId, kind: "request" });
		assert.deepEqual(child.context.messages.map((message: any) => message.role), ["user"]);
		const replay = { sessionId: childId, cacheRetention: "long", [owner]: { sessionId: childId, kind: "cache-replay" } };
		await runtime.streamSimple(model, context, replay).result();
		assert.equal(seen.at(-1)!.options, replay);
		assert.equal(seen.at(-1)!.context, context);
		const parent = { sessionId: live.ctx.sessionManager.getSessionId(), cacheRetention: "long" };
		await runtime.streamSimple(model, context, parent).result();
		assert.equal(seen.at(-1)!.options, parent);
		assert.equal(seen.at(-1)!.context, context);
	} finally { live.runtime.close(); }
});

test("child runtime hooks release out of order without retaining inactive layers", async t => {
	const root = await temp(t);
	const live = runtimeFixture(SessionManager.create(root, join(root, "parent")), root);
	const runtime = live.ctx.modelRegistry.runtime;
	const original = runtime.streamSimple;
	try {
		await live.execute({ action: "start", task: "one" });
		await live.runtime.wait(new AbortController().signal);
		await live.execute({ action: "start", task: "two" });
		await live.runtime.wait(new AbortController().signal);
		await live.execute({ action: "stop", id: "agent#1" });
		await live.execute({ action: "stop", id: "agent#2" });
		assert.equal(runtime.streamSimple, original);
	} finally { live.runtime.close(); }
});

test("registered description and parameters carry adapted Codex guidance", async t => {
	const root = await temp(t);
	const live = runtimeFixture(SessionManager.create(root, join(root, "parent")), root);
	await live.emit("session_start");
	assert.match(live.description(), /\n\nAvailable roles:\n/);
	const properties = live.parameters().properties;
	assert.equal(properties.id.description, "Agent id to send a follow-up task to, resume, interrupt, stop or restart (from start): agent#N or N.");
	assert.equal(properties.ids.description, "Agent ids to inspect with status: full direct child IDs agent#N.");
	for (const name of ["timeout_ms", "until", "wake_on_alert"]) assert.equal(name in properties, false, `${name} belongs to the removed wait`);
	assert.equal(live.parameters().properties.action.enum.includes("wait"), false);
	assert.equal(properties.messages.description, "Status peek length; default 8");
	assert.doesNotMatch(live.description(), /call wait|wait:|direct_wait_required/);
	assert.match(live.description(), /End your turn\. Their final results arrive automatically in one message/);
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
	// The source delivers every child of the caller; this test follows agent#1.
	const result = { details: { results: (await restored.takeAnswers()).details.results.filter((item: any) => item.id === "agent#1") } };
	assert.deepEqual(result.details.results.map((item: any) => [item.run, item.text]), [[latest.result.run, `answer\n\n${FOLLOW_UP}`]]);
	const repeated = await restored.takeAnswers();
	assert.equal(repeated.details.results.length, 0);
	selected = branchB;
	await restored.emit("session_tree");
	const second = await restored.execute({ action: "status", ids: ["agent#1"] });
	assert.equal(second.details.statuses[0].title, "branch B");
	const delivered = await restored.takeAnswers();
	assert.equal(delivered.details.results.length, 0);
	const allocated = await restored.execute({ action: "start", task: "new task", tools: [] });
	assert.equal(allocated.content[0].text, "agent#10 started");
	await restored.runtime.wait(new AbortController().signal);
	restored.runtime.close();
});

test("completed children deliver without opening siblings and materialize only for send or exact status", async t => {
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
	const waiting = await restored.takeAnswers(false);
	// Both saved answers are usable even though B's transcript is unavailable.
	assert.deepEqual(waiting.details.results.map((result: any) => [result.id, result.text]), [["agent#1", `answer\n\n${FOLLOW_UP}`], ["agent#2", `answer\n\n${FOLLOW_UP}`]]);
	const repeated = await restored.takeAnswers(false);
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
	const first = await hot.takeAnswers();
	assert.equal(first.details.results[0].text, `session 1\n\n${FOLLOW_UP}`);
	await hot.execute({ action: "send", id: "agent#1", task: "next" });
	await hot.runtime.wait(new AbortController().signal);
	const second = await hot.takeAnswers();
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
	assert.equal(released, false);
	now = 300000;
	t.mock.timers.tick(1);
	// The release checks the saved files asynchronously first.
	await until(() => released);
	live.ctx.mode = "print";
	await live.emit("agent_end");
	await live.execute({ action: "send", id: "agent#1", task: "wake task" });
	await live.runtime.wait(new AbortController().signal);
	const wake = await live.takeAnswers();
	assert.deepEqual(JSON.parse(wake.details.results[0].text.split("\n\n")[0]), {
		released: true, sessionId: original.sessionId, roles: ["user", "assistant", "user"],
		users: [[{ type: "text", text: "original task" }], [{ type: "text", text: "wake task" }]], system: `saved prompt\n\n${REMINDER}`,
	});
	live.runtime.close();
});

for (const action of ["status", "send"]) {
	test(`waking a released child by ${action} reads its file without a synchronous reopen`, async t => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		let now = 0;
		t.mock.method(performance, "now", () => now);
		const root = await temp(t);
		const parent = SessionManager.create(root, join(root, "parent"));
		parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
		let released = false;
		const live = runtimeFixture(parent, root);
		live.events.on("rqw-codex:session-policy", (request: any) => { request.release = () => { released = true; }; });
		await live.execute({ action: "start", task: "original task", tools: [] });
		await live.runtime.wait(new AbortController().signal);
		await commitWait(live, parent);
		const before = structuredClone(retainedChildManager(parent, "agent", 1)!.getEntries());
		now = 300000;
		t.mock.timers.tick(300000);
		await until(() => released);
		assert.equal(retainedChildManager(parent, "agent", 1), undefined);
		live.ctx.mode = "print";
		await live.emit("agent_end");
		const reads = countSyncSessionReads(t);
		await live.execute(action === "status" ? { action, ids: ["agent#1"] } : { action, id: "agent#1", task: "wake task" });
		const synchronous = reads.count();
		reads.stop();
		assert.equal(synchronous, 0);
		if (action === "send") await live.runtime.wait(new AbortController().signal);
		const woke = retainedChildManager(parent, "agent", 1)!;
		assert.deepEqual(woke.getEntries().slice(0, before.length), before);
		live.runtime.close();
	});
}

test("a reopened child file follows Pi's own reading rules", async t => {
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const child = await createChildManager(parent, root, "agent", 1);
	child.appendMessage({ role: "user", content: "task", timestamp: 1 });
	const leaf = child.appendMessage(fauxAssistantMessage("answer", { timestamp: 1 }));
	const file = child.getSessionFile()!;
	// A malformed line, a blank line and a last line without its newline.
	const tail = { type: "custom", id: "tail", parentId: leaf, timestamp: "x", customType: "x" };
	await writeFile(file, `${await readFile(file, "utf8")}not json\n\n${JSON.stringify(tail)}`);
	const copy = join(root, "stock.jsonl");
	await writeFile(copy, await readFile(file));
	const stock = SessionManager.open(copy, root, root);
	const reopened = await openChildManager(parent, file, root, "agent", 1);
	assert.deepEqual(reopened.getEntries(), stock.getEntries());
	assert.equal(reopened.getEntries().at(-1)?.id, "tail");
	assert.equal((await readFile(file, "utf8")).endsWith("\n"), true);
	const foreign = join(dirname(file), "foreign.jsonl");
	await writeFile(foreign, `${JSON.stringify({ type: "custom", id: "x" })}\n`);
	await assert.rejects(openChildManager(parent, foreign, root, "agent", 1), /not a valid/);
});

test("a child file of an older format is migrated without a synchronous rewrite", async t => {
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const child = await createChildManager(parent, root, "agent", 1);
	child.appendMessage({ role: "user", content: "task", timestamp: 1 });
	child.appendMessage(fauxAssistantMessage("answer", { timestamp: 1 }));
	const file = child.getSessionFile()!;
	// Version 2 holds a role that version 3 renames.
	const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
	lines[0].version = 2;
	lines[1].message.role = "hookMessage";
	await writeFile(file, `${lines.map(line => JSON.stringify(line)).join("\n")}\n`);
	await writeFile(`${file}.migrating`, "left by an interrupted migration");
	const reads = countSyncSessionReads(t);
	const reopened = await openChildManager(parent, file, root, "agent", 1);
	const synchronous = reads.count();
	reads.stop();
	assert.equal(synchronous, 0);
	assert.equal((reopened.getEntries()[0] as any).message.role, "custom");
	const saved = (await readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
	assert.equal(saved[0].version, 3);
	assert.equal(saved[1].message.role, "custom");
	assert.deepEqual(saved.slice(1), reopened.getEntries());
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
	const waiting = await live.takeAnswers();
	assert.equal(released, false);
	assert.match(waiting.details.results[0].text, /answer/);
	parent.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "agent", content: waiting.content.map(part => ({ ...part, type: "text" as const })), details: waiting.details, isError: false, timestamp: 1 });
	await live.emit("turn_end");
	now = 600000;
	t.mock.timers.tick(300000);
	await live.takeAnswers();
	await until(() => released);
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
	await until(() => released);
	await live.execute({ action: "stop", id: "agent#2" });
	response.resolve(fauxAssistantMessage("done"));
	await Promise.all(sessions.map(session => session.waitForIdle()));
	live.runtime.close();
});

test("stop and idle release check child history without reopening any session file", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let now = 0;
	t.mock.method(performance, "now", () => now);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root);
	await live.execute({ action: "start", task: "sleeper", tools: [] });
	await live.execute({ action: "start", task: "stopped", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	await commitWait(live, parent);
	// A synchronous reopen of a long main session froze the UI for seconds.
	const open = t.mock.method(SessionManager, "open");
	await live.execute({ action: "stop", id: "agent#2" });
	await until(() => !retainedChildManager(parent, "agent", 2));
	now = 300000;
	t.mock.timers.tick(300000);
	await until(() => !retainedChildManager(parent, "agent", 1));
	assert.equal(open.mock.callCount(), 0);
	live.runtime.close();
});

test("an idle child stays awake when the parent file no longer holds its record", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let now = 0;
	t.mock.method(performance, "now", () => now);
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root);
	await live.execute({ action: "start", task: "task", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	await commitWait(live, parent);
	await rm(parent.getSessionFile()!);
	now = 300000;
	t.mock.timers.tick(300000);
	// status runs in the same queue after the idle check has finished.
	await live.execute({ action: "status", ids: ["agent#1"] });
	assert.ok(retainedChildManager(parent, "agent", 1));
	live.runtime.close();
});

test("a child file matches only the exact saved history of its own session", async t => {
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const child = await createChildManager(parent, root, "agent", 1);
	child.appendMessage({ role: "user", content: "task", timestamp: 1 });
	child.appendMessage(fauxAssistantMessage("answer", { timestamp: 1 }));
	const file = child.getSessionFile()!;
	assert.equal(await savedHistoryMatches(parent, file, "agent", 1, child), true);
	const other = await createChildManager(parent, root, "agent", 2);
	assert.equal(await savedHistoryMatches(parent, file, "agent", 1, other), false, "another session's history");
	await writeFile(file, `${await readFile(file, "utf8")}${JSON.stringify({ type: "custom", id: "foreign", parentId: null, timestamp: "x", customType: "x" })}\n`);
	assert.equal(await savedHistoryMatches(parent, file, "agent", 1, child), false, "a line the history lacks");
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
	await live.takeAnswers();
	const original = await live.execute({ action: "status", ids: ["agent#1"] });
	now = 240000;
	t.mock.timers.tick(240000);
	await live.execute({ action: "restart", id: "agent#1", task: "new task", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	now = 300000;
	t.mock.timers.tick(60000);
	await live.takeAnswers();
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
	await memory.takeAnswers();
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
	// Persisted sessions write files between the steps, so a slow disk needs many turns of the loop; no clock is involved.
	// Each turn also awaits a real file call, so a slow runner's pending writes finish; setImmediate alone spins past them.
	for (let i = 0; i < 20000 && !done(); i++) {
		await new Promise(resolve => setImmediate(resolve));
		await stat(".");
	}
	assert.ok(done());
}
const roles = (messages: any[]) => messages.filter(message => message.role !== "system").map(message => message.role);
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
	const answer = await crash.restored.takeAnswers();
	assert.match(answer.details.results[0].text, /^answer/);
	const again = await crash.restored.takeAnswers();
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
	const answer = await restored.takeAnswers();
	assert.equal(answer.details.results[0].delivery, saved);
	restored.runtime.close();
});

/** A session written by an older version: its codemode script took the child's answer with an explicit wait and saved an `rqw-agent-accept` record. */
async function oldAcceptRecord(t: TestContext, waitFailed: boolean, outerFailed = false) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root);
	await first.execute({ action: "start", task: "task", tools: [] });
	await first.runtime.wait(new AbortController().signal);
	const saved = (parent.getBranch() as any[]).findLast(entry => entry.customType === "rqw-agent-child" && entry.data.result).data.result;
	parent.appendCustomEntry("rqw-agent-accept", { version: 1, call: "outer/inner", root: "outer", ok: !waitFailed, results: [{ run: saved.run, delivery: saved.delivery }] });
	// The script caught the wait's error or used its result; either way its own result is saved.
	parent.appendMessage({ role: "toolResult", toolCallId: "outer", toolName: "codemode", content: [{ type: "text", text: "ok" }], isError: outerFailed, timestamp: 1 });
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	const answer = await restored.takeAnswers();
	const count = answer.details.results.length;
	restored.runtime.close();
	first.runtime.close();
	return count;
}

test("an old accept record of a codemode wait keeps its answer from being sent again", async t => {
	assert.equal(await oldAcceptRecord(t, false), 0);
});

test("an old accept record of a failed wait leaves the answer to be delivered", async t => {
	assert.equal(await oldAcceptRecord(t, true), 1);
});

test("an old accept record whose script result failed leaves the answer to be delivered", async t => {
	assert.equal(await oldAcceptRecord(t, false, true), 1);
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
	await live.takeAnswers();
	await until(() => !retainedChildManager(parent, "agent", 1));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(managers(), before);
	live.runtime.close();
});

test("a tool call cut off by a crash is cut from the request when the child is recovered, and is not run again", async t => {
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
	const messages = restored.requests.at(-1).messages;
	assert.deepEqual(roles(messages), ["user"]);
	assert.equal(runs, 1);
	restored.runtime.close();
});

async function crashedChild(t: TestContext, history: (child: SessionManager) => void) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await first.execute({ action: "start", task: "task", tools: [] });
	await until(() => first.requests.length === 1);
	first.runtime.close();
	const directory = `${parent.getSessionFile()}.children/agent-1`;
	const [name] = await readdir(directory);
	const file = join(directory, name);
	history(SessionManager.open(file));
	return { root, parent, file, saved: await readFile(file, "utf8") };
}

test("resume repairs a broken history in the request, keeps the file and asks the model once to continue", async t => {
	const { root, parent, file, saved } = await crashedChild(t, child => {
		child.appendMessage(fauxAssistantMessage([fauxText("plan"), fauxToolCall("read", {}, { id: "lost" }), fauxToolCall("read", {}, { id: "kept" })], { stopReason: "toolUse" }));
		child.appendMessage({ role: "toolResult", toolCallId: "kept", toolName: "read", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 2 });
		child.appendMessage({ role: "toolResult", toolCallId: "kept", toolName: "read", content: [{ type: "text", text: "again" }], isError: false, timestamp: 3 });
		child.appendMessage({ role: "toolResult", toolCallId: "stray", toolName: "read", content: [{ type: "text", text: "stray" }], isError: false, timestamp: 4 });
		child.appendMessage(fauxAssistantMessage([fauxText("half"), fauxToolCall("read", {}, { id: "cut" })], { stopReason: "toolUse" }));
	});
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	await restored.execute({ action: "resume", id: "agent#1" });
	await restored.runtime.wait(new AbortController().signal);
	const messages = restored.requests.at(-1).messages.filter((message: any) => message.role !== "system");
	assert.deepEqual(roles(messages), ["user", "assistant", "toolResult", "assistant", "user"]);
	assert.deepEqual(messages[1].content.map((part: any) => part.id ?? part.type), ["text", "kept"]);
	assert.deepEqual(messages[2].content, [{ type: "text", text: "ok" }]);
	assert.deepEqual(messages[3].content.map((part: any) => part.type), ["text"]);
	assert.deepEqual(userTexts(restored.requests.at(-1)), ["task", "continue; the removed call was not repeated"]);
	assert.equal(restored.requests.length, 1);
	// The file only grew by the model's new answer; no broken line was removed and no continue line was written.
	const after = await readFile(file, "utf8");
	assert.ok(after.startsWith(saved));
	assert.doesNotMatch(after, /removed call was not repeated/);
	restored.runtime.close();
});

test("send to a restored child repairs the broken history in its request", async t => {
	const { root, parent } = await crashedChild(t, child => {
		child.appendMessage(fauxAssistantMessage("first answer"));
		child.appendMessage({ role: "toolResult", toolCallId: "stray", toolName: "read", content: [{ type: "text", text: "stray" }], isError: false, timestamp: 2 });
		child.appendMessage(fauxAssistantMessage([fauxToolCall("read", {}, { id: "lost" })], { stopReason: "toolUse" }));
		child.appendMessage({ role: "user", content: [{ type: "text", text: "after" }], timestamp: 3 });
		child.appendMessage(fauxAssistantMessage("second answer"));
	});
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	await restored.execute({ action: "send", id: "agent#1", task: "more" });
	await restored.runtime.wait(new AbortController().signal);
	const messages = restored.requests.at(-1).messages;
	assert.deepEqual(roles(messages), ["user", "assistant", "user", "assistant", "user"]);
	assert.deepEqual(userTexts(restored.requests.at(-1)), ["task", "after", "more"]);
	restored.runtime.close();
});

test("resume removes results of aborted assistant tool calls from the provider request", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root, () => new Promise<never>(() => {}));
	await first.execute({ action: "start", task: "task", tools: [] });
	await until(() => first.requests.length === 1);
	first.runtime.close();
	const directory = `${parent.getSessionFile()}.children/agent-1`;
	const [file] = await readdir(directory);
	const child = SessionManager.open(join(directory, file));
	child.appendMessage(fauxAssistantMessage([fauxToolCall("read", {}, { id: "valid-call" })], { stopReason: "toolUse" }));
	child.appendMessage({ role: "toolResult", toolCallId: "valid-call", toolName: "read", content: [{ type: "text", text: "completed" }], isError: false, timestamp: 2 });
	child.appendMessage(fauxAssistantMessage([fauxToolCall("read", {}, { id: "aborted-call" })], { stopReason: "aborted" }));
	child.appendMessage({ role: "toolResult", toolCallId: "aborted-call", toolName: "read", content: [{ type: "text", text: "interrupted" }], isError: true, timestamp: 2 });
	child.appendMessage(fauxAssistantMessage([], { stopReason: "error" }));
	child.appendMessage({ role: "user", content: [{ type: "text", text: "continue" }], timestamp: 3 });
	child.appendMessage(fauxAssistantMessage([], { stopReason: "error" }));
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root);
	await restored.execute({ action: "resume", id: "agent#1" });
	await restored.runtime.wait(new AbortController().signal);
	const messages = restored.requests.at(-1).messages;
	assert.deepEqual(userTexts(restored.requests.at(-1)), ["task", "continue"]);
	assert.equal(messages.some((message: any) => message.role === "assistant" && message.content.some((part: any) => part.type === "toolCall" && part.id === "valid-call")), true);
	assert.equal(messages.some((message: any) => message.role === "toolResult" && message.toolCallId === "valid-call"), true);
	assert.equal(messages.some((message: any) => message.role === "toolResult" && message.toolCallId === "aborted-call"), false);
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
	assert.deepEqual(live.notices, ["Wait for the agents to finish.", "Wait for the agents to finish."]);
	gate.resolve();
	await live.runtime.wait(new AbortController().signal);
	assert.equal(await live.emit("session_before_switch", event), undefined);
	assert.equal(await live.emit("session_before_fork", { type: "session_before_fork", entryId: "e1" }), undefined);
	live.runtime.close();
});


/** The child session file of agent#1 and its entries; the tests cut it to the state a crash leaves behind. */
async function childLines(parent: SessionManager) {
	const record = (parent.getBranch() as any[]).findLast(entry => entry.customType === "rqw-agent-child").data;
	const file: string = record.sessionFile;
	return { file, lines: (await readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line)) };
}

/** Keeps the child file up to and including the first entry that `last` accepts, and forgets its delivery receipts. */
async function crashAfter(parent: SessionManager, last: (entry: any) => boolean) {
	const { file, lines } = await childLines(parent);
	const at = lines.findIndex(last);
	assert.ok(at > 0, "the entry the crash follows");
	await writeFile(file, `${lines.slice(0, at + 1).map(entry => JSON.stringify(entry)).join("\n")}\n`);
	await rm(`${file}.children/delivered`, { force: true });
}

const nestedDone = (entry: any) => entry.customType === "rqw-agent-child" && entry.data?.id === 1 && entry.data.result;
const inboxEntry = (entry: any) => entry.customType === "rqw-agent-inbox" && entry.data.message.customType === "rqw-auto-wait-results";
const stuckAfterAnswer = (context: any) => JSON.stringify(context.messages).includes("nested answer") ? new Promise<never>(() => {}) : "started it, waiting";
const afterRestart = (context: any) => JSON.stringify(context.messages).includes("lost") ? "restarted it" : JSON.stringify(context.messages).includes("nested answer") ? "all done" : "started it, waiting";

/** The runtime after a restart: the same files, a reply of its own and, optionally, the job registry of the new process. */
async function restarted(parent: SessionManager, root: string, reply: (context: any) => string | Promise<never>, jobs?: ReturnType<typeof fakeJobs>) {
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root, context => reply(context), 8);
	if (jobs) offerJobs(restored, jobs);
	await restored.execute({ action: "status", ids: ["agent#1"] });
	await restored.runtime.resume!(new AbortController().signal, true);
	return restored;
}

const textsMentioning = (request: any, text: string) => request.messages.filter((message: any) => JSON.stringify(message.content).includes(text)).length;

test("after a restart a ready answer of the child's helper wakes it instead of ending it", async t => {
	const { live, gate, parent } = await outerWithHelper(t, stuckAfterAnswer, true);
	gate.resolve("nested answer");
	await until(() => outerRequests(live).length === 3);
	await crashAfter(parent, nestedDone);
	const restored = await restarted(parent, parent.getSessionFile()!.replace(/\/[^/]+$/, ""), afterRestart);
	const answer = await restored.takeAnswers();
	assert.deepEqual(answer.details.results.map((item: any) => item.text.split("\n\n")[0]), ["all done"]);
	assert.equal(restored.requests.length, 1);
	assert.equal(textsMentioning(restored.requests[0], "nested answer"), 1);
	restored.runtime.close(); live.runtime.close();
	await settle();
});

test("a helper answer saved in the inbox before the crash is delivered from there, once", async t => {
	const { live, gate, parent } = await outerWithHelper(t, stuckAfterAnswer, true);
	gate.resolve("nested answer");
	await until(() => outerRequests(live).length === 3);
	await crashAfter(parent, inboxEntry);
	const restored = await restarted(parent, parent.getSessionFile()!.replace(/\/[^/]+$/, ""), afterRestart);
	const answer = await restored.takeAnswers();
	assert.deepEqual(answer.details.results.map((item: any) => item.text.split("\n\n")[0]), ["all done"]);
	assert.equal(restored.requests.length, 1, "the answer is not delivered a second time");
	assert.equal(textsMentioning(restored.requests[0], "nested answer"), 1);
	restored.runtime.close(); live.runtime.close();
	await settle();
});

test("a helper that could not be restored comes back to its waiting child as lost", async t => {
	const { live, parent } = await outerWithHelper(t, waitingReply, true);
	await until(() => outerRequests(live).length === 2);
	await settle();
	// The helper's saved configuration is invalid, so it cannot be restored.
	const { file, lines } = await childLines(parent);
	for (const entry of lines) if (entry.customType === "rqw-agent-child" && entry.data?.id === 1 && entry.data.config) entry.data.config.tools = ["not-a-tool"];
	await writeFile(file, `${lines.map(entry => JSON.stringify(entry)).join("\n")}\n`);
	const restored = await restarted(parent, parent.getSessionFile()!.replace(/\/[^/]+$/, ""), afterRestart);
	const answer = await restored.takeAnswers();
	assert.deepEqual(answer.details.results.map((item: any) => item.text.split("\n\n")[0]), ["restarted it"]);
	assert.equal(textsMentioning(restored.requests[0], "lost"), 1);
	restored.runtime.close(); live.runtime.close();
	await settle();
});

/** An outer child that started a job through the offered job tool and ended its turn to wait for it. */
async function outerWithJob(t: TestContext, jobs: ReturnType<typeof fakeJobs>, reply: (context: any) => string | Promise<never>) {
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root, context => context.messages.some((message: any) => message.role === "toolResult") ? reply(context)
		: fauxAssistantMessage([fauxToolCall("bash", {}, { id: "slow" })], { stopReason: "toolUse" }), 8);
	offerJobs(live, jobs);
	await live.execute({ action: "start", task: "outer", tools: ["bash"] });
	await until(() => live.requests.length === 2);
	await settle();
	return { live, parent, root };
}

test("after a restart a child that waited for a job gets the job back as lost, not as a final answer", async t => {
	const { live, parent, root } = await outerWithJob(t, fakeJobs(), () => "started the job, waiting");
	const restored = await restarted(parent, root, afterRestart, fakeJobs(0));
	const answer = await restored.takeAnswers();
	assert.deepEqual(answer.details.results.map((item: any) => item.text.split("\n\n")[0]), ["restarted it"]);
	assert.equal(textsMentioning(restored.requests[0], "lost"), 1);
	restored.runtime.close(); live.runtime.close();
	await settle();
});

test("a job result saved in the inbox before the crash comes back as that result, not as lost", async t => {
	const jobs = fakeJobs();
	const { live, parent, root } = await outerWithJob(t, jobs, context => JSON.stringify(context.messages).includes("job answer") ? new Promise<never>(() => {}) : "started the job, waiting");
	jobs.finish("job answer");
	await until(() => live.requests.length === 3);
	await crashAfter(parent, inboxEntry);
	const restored = await restarted(parent, root, context => JSON.stringify(context.messages).includes("lost") ? "wrongly lost" : "got it", fakeJobs(0));
	const answer = await restored.takeAnswers();
	assert.deepEqual(answer.details.results.map((item: any) => item.text.split("\n\n")[0]), ["got it"]);
	assert.equal(textsMentioning(restored.requests[0], "job answer"), 1);
	restored.runtime.close(); live.runtime.close();
	await settle();
});

test("an automatic result in the inbox of another branch does not hide the ready answer of the selected one", async t => {
	const { live, gate, parent } = await outerWithHelper(t, stuckAfterAnswer, true);
	gate.resolve("nested answer");
	await until(() => outerRequests(live).length === 3);
	await crashAfter(parent, nestedDone);
	const { file, lines } = await childLines(parent);
	const done = lines.find(nestedDone);
	// The same result sits in the inbox of a sibling branch that the session does not select.
	const sibling = { type: "custom", id: "sibling-inbox", parentId: lines[0].id, timestamp: done.timestamp, customType: "rqw-agent-inbox",
		data: { version: 1, id: "sibling", message: { customType: "rqw-auto-wait-results", content: "{}", display: false, details: { batch: "sibling", results: [{ id: "agent#1", run: done.data.result.run }] } } } };
	// Pi selects the last entry of the file as the leaf, so the sibling goes before it.
	await writeFile(file, `${[...lines.slice(0, -1), sibling, lines.at(-1)].map(entry => JSON.stringify(entry)).join("\n")}\n`);
	const restored = await restarted(parent, parent.getSessionFile()!.replace(/\/[^/]+$/, ""), afterRestart);
	const answer = await restored.takeAnswers();
	assert.deepEqual(answer.details.results.map((item: any) => item.text.split("\n\n")[0]), ["all done"]);
	assert.equal(textsMentioning(restored.requests[0], "nested answer"), 1);
	restored.runtime.close(); live.runtime.close();
	await settle();
});

test("a job result that an explicit wait returned before the crash is not reported as lost", async t => {
	const { live, parent, root } = await outerWithJob(t, fakeJobs(), () => "started the job, waiting");
	const { file, lines } = await childLines(parent);
	const last = lines.at(-1);
	const waited = { type: "message", id: "job-wait-result", parentId: last.id, timestamp: last.timestamp,
		message: { role: "toolResult", toolCallId: "job-wait", toolName: "job", isError: false, timestamp: 1,
			content: [{ type: "text", text: "job#1 exited" }], details: { results: [{ id: "job#1", state: "exited", result: "job answer" }] } } };
	await writeFile(file, `${[...lines, waited].map(entry => JSON.stringify(entry)).join("\n")}\n`);
	const restored = await restarted(parent, root, () => "wrongly lost", fakeJobs(0));
	await restored.execute({ action: "status", ids: ["agent#1"] });
	await settle();
	assert.equal(restored.requests.length, 0, "nothing is lost, so the child is not woken");
	restored.runtime.close(); live.runtime.close();
	await settle();
});

test("a waiting child and its working helper count as agents, finished ones as idle", async t => {
	const { live, gate } = await outerWithHelper(t, waitingReply);
	await settle();
	const counts = live.runtime.runningCounts();
	assert.equal(counts.agents, 2);
	assert.equal(counts.idleAgents, undefined);
	gate.resolve("nested answer");
	await live.takeAnswers();
	const done = live.runtime.runningCounts();
	assert.equal(done.agents, 0);
	assert.equal(done.idleAgents, 2);
});

test("an interrupted waiting child counts as idle", async t => {
	const { live, gate } = await outerWithHelper(t, waitingReply);
	await live.execute({ action: "interrupt", id: "agent#1" });
	await live.runtime.wait(new AbortController().signal);
	await until(() => live.runtime.runningCounts().agents === 0);
	assert.equal(live.runtime.runningCounts().idleAgents, 1);
	gate.resolve("nested answer");
});

test("a finished child counts as one idle agent", async t => {
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const live = runtimeFixture(parent, root);
	await live.execute({ action: "start", task: "one", title: "Audit", tools: [] });
	await live.runtime.wait(new AbortController().signal);
	assert.equal(live.runtime.runningCounts().idleAgents, 1);
	live.runtime.close();
});

test("a child's background process counts, its change reaches the counts and a finished one drops out", async t => {
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const jobs = fakeJobs();
	let changes = 0;
	const live = runtimeFixture(parent, root, context => context.messages.some((message: any) => message.role === "toolResult") ? "started the job, waiting"
		: fauxAssistantMessage([fauxToolCall("bash", {}, { id: "slow" })], { stopReason: "toolUse" }), 8, false, undefined, () => { changes++; });
	offerJobs(live, jobs);
	await live.execute({ action: "start", task: "outer", tools: ["bash"] });
	await until(() => live.requests.length === 2);
	await settle();
	try {
		assert.equal(live.runtime.runningCounts().backgroundProcesses, 1);
		assert.equal(live.runtime.runningCounts().agents, 1);
		changes = 0;
		jobs.finish("done");
		assert.ok(changes > 0, "a job change reaches the counts producer");
		assert.equal(live.runtime.runningCounts().backgroundProcesses, undefined);
	} finally {
		live.runtime.close();
		await settle();
	}
});

test("stopping a sleeping child drops it from the idle count at once", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await temp(t);
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const first = runtimeFixture(parent, root);
	await first.execute({ action: "start", task: "one", title: "Old", tools: [] });
	await first.runtime.wait(new AbortController().signal);
	first.runtime.close();
	let changes = 0;
	const restored = runtimeFixture(SessionManager.open(parent.getSessionFile()!), root, undefined, 8, false, undefined, () => { changes++; });
	t.after(() => restored.runtime.close());
	await commitWait(restored, restored.ctx.sessionManager);
	assert.equal(restored.runtime.runningCounts().idleAgents, 1);
	changes = 0;
	await restored.execute({ action: "stop", id: "agent#1" });
	assert.ok(changes > 0, "the stop reaches the counts producer");
	assert.equal(restored.runtime.runningCounts().idleAgents, undefined);
});
