import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import agent from "../../../extensions/RQW-agent/index.ts";
import { PROGRESS_INTERVAL_MS } from "../../../extensions/RQW-agent/progress.ts";

const MINUTE = 60 * 1000;

/** One agent tool in a synthetic session; `responses` script the child's model requests. */
async function world(t: TestContext, responses: (gate: Promise<any>) => (() => unknown)[], timers = false) {
	if (timers) t.mock.timers.enable({ apis: ["setTimeout"] });
	const root = await mkdtemp(join(tmpdir(), "auto-wait-progress-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const hooks = new Map<string, Function[]>(), events = createEventBus(), manager = SessionManager.inMemory(root);
	const core = createFauxCore({ provider: "fake", models: [{ id: "model" }] }), model = core.getModel("model")!;
	const gate = Promise.withResolvers<any>(), entered = Promise.withResolvers<void>();
	core.setResponses([...responses(gate.promise), () => { entered.resolve(); return gate.promise; }] as never);
	const runtime = { getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true,
		getAuth: async () => ({ apiKey: "fake" }), checkAuth: async () => ({}), isUsingOAuth: () => false,
		getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [], stream: core.streamSimple, streamSimple: core.streamSimple };
	const ctx: any = { cwd: root, sessionManager: manager, model, modelRegistry: { runtime, find: () => model, hasConfiguredAuth: () => true },
		isIdle: () => true, isProjectTrusted: () => true, getSystemPrompt: () => "prompt", signal: new AbortController().signal, mode: "test", ui: { notify() {} } };
	let definition: any;
	const sent: any[] = [];
	const forks: any[] = [];
	const pi: any = { events, on: (name: string, fn: Function) => hooks.set(name, [...hooks.get(name) ?? [], fn]),
		registerTool: (tool: any) => { definition = tool; }, registerCommand() {}, registerEntryRenderer() {},
		appendEntry: (type: string, data: unknown) => manager.appendCustomEntry(type, data),
		getSettings: () => ({ retry: { enabled: false }, compaction: { enabled: false } }), getThinkingLevel: () => "off", getActiveTools: () => [],
		sendMessage: (message: any, options: any) => { sent.push({ message, options }); } };
	events.on("rqw:context-fork:v1", (request: any) => { forks.push(request); request.offer(async () => fauxAssistantMessage("progress", { timestamp: 1 })); });
	agent(pi);
	const emit = async (name: string) => { for (const fn of hooks.get(name) ?? []) await fn({}, ctx); };
	await emit("session_start");
	t.after(async () => { gate.resolve(fauxAssistantMessage("done", { timestamp: 1 })); await emit("session_shutdown"); });
	const run = (params: object) => definition.execute("call", params, new AbortController().signal, undefined, ctx);
	return { run, emit, events, manager, sent, forks, entered: entered.promise, gate,
		settle: () => new Promise<void>(resolve => setImmediate(resolve)) };
}

const toolSteps = (count: number) => Array.from({ length: count }, (_, i) =>
	() => fauxAssistantMessage([fauxToolCall("agent", { action: "status", ids: ["agent#99"] }, { id: `call-${i}` })], { stopReason: "toolUse" }));

test("progress during auto-wait is held until input without waking the model", async t => {
	const w = await world(t, () => toolSteps(50));
	w.events.emit("rqw:auto-wait:state:v1", { sessionId: w.manager.getSessionId(), active: true });
	await w.run({ action: "start", task: "test", tools: [] });
	await w.entered;
	assert.equal(w.sent.length, 0);
	w.events.emit("rqw:auto-wait:state:v1", { sessionId: w.manager.getSessionId(), active: false });
	await w.emit("agent_settled");
	assert.equal(w.sent.length, 0);
	await w.emit("input");
	assert.equal(w.sent.length, 1);
	assert.equal(w.sent[0].message.customType, "agent_progress");
	assert.equal(w.sent[0].options.triggerTurn, false);
});

test("a first request that hangs without a tool call still gets one 30 minute report", async t => {
	const w = await world(t, () => [], true);
	await w.run({ action: "start", task: "test", tools: [] });
	await w.entered;
	t.mock.timers.tick(PROGRESS_INTERVAL_MS - 1);
	assert.equal(w.forks.length, 0);
	t.mock.timers.tick(1);
	await w.settle();
	assert.equal(w.forks.length, 1);
	assert.equal(w.sent.length, 1);
	assert.equal(w.sent[0].message.customType, "agent_progress");
	assert.match(w.sent[0].message.content, /has worked 30 minutes without communication/);
});

test("a status call does not move the 30 minute boundary", async t => {
	const w = await world(t, () => [], true);
	await w.run({ action: "start", task: "test", tools: [] });
	await w.entered;
	t.mock.timers.tick(20 * MINUTE);
	await w.run({ action: "status", ids: ["agent#1"] });
	t.mock.timers.tick(10 * MINUTE - 1);
	assert.equal(w.forks.length, 0);
	t.mock.timers.tick(1);
	await w.settle();
	assert.equal(w.forks.length, 1);
});

test("a successful send moves the 30 minute boundary", async t => {
	const w = await world(t, () => [], true);
	await w.run({ action: "start", task: "test", tools: [] });
	await w.entered;
	t.mock.timers.tick(25 * MINUTE);
	await w.run({ action: "send", id: "agent#1", task: "steer" });
	t.mock.timers.tick(PROGRESS_INTERVAL_MS - 1);
	assert.equal(w.forks.length, 0);
	t.mock.timers.tick(1);
	await w.settle();
	assert.equal(w.forks.length, 1);
	assert.equal(w.sent.length, 1);
});

test("an interrupting send starts its 30 minute limit even while the old run is still stopping", async t => {
	const w = await world(t, () => [], true);
	await w.run({ action: "start", task: "test", tools: [] });
	await w.entered;
	t.mock.timers.tick(25 * MINUTE);
	await w.run({ action: "send", id: "agent#1", task: "again", interrupt: true });
	t.mock.timers.tick(PROGRESS_INTERVAL_MS - 1);
	assert.equal(w.forks.length, 0);
	t.mock.timers.tick(1);
	await w.settle();
	assert.equal(w.forks.length, 1);
});

test("a background stop cancels the timer of a send queued behind a stopping run", async t => {
	const w = await world(t, () => [], true);
	await w.run({ action: "start", task: "test", tools: [] });
	await w.entered;
	await w.run({ action: "send", id: "agent#1", task: "again", interrupt: true });
	w.events.emit("rqw:stop-background:v1", { sessionId: w.manager.getSessionId(), reply() {} });
	t.mock.timers.tick(2 * PROGRESS_INTERVAL_MS);
	await w.settle();
	assert.equal(w.forks.length, 0);
});

test("a finished child has no 30 minute timer left", async t => {
	const done = await world(t, () => [], true);
	await done.run({ action: "start", task: "test", tools: [] });
	await done.entered;
	done.gate.resolve(fauxAssistantMessage("done", { timestamp: 1 }));
	await done.settle();
	t.mock.timers.tick(2 * PROGRESS_INTERVAL_MS);
	assert.equal(done.forks.length, 0);
});

test("a stopped child has no 30 minute timer left", async t => {
	const stopped = await world(t, () => [], true);
	await stopped.run({ action: "start", task: "test", tools: [] });
	await stopped.entered;
	await stopped.run({ action: "stop", id: "agent#1" });
	t.mock.timers.tick(2 * PROGRESS_INTERVAL_MS);
	assert.equal(stopped.forks.length, 0);
});
