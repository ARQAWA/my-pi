import assert from "node:assert/strict";
import test from "node:test";
import { createTools } from "../../../extensions/RQW-tools/index.ts";
import { createJobs } from "../../../extensions/RQW-tools/jobs.ts";
import { createCountsProducer } from "../../../extensions/RQW-tools/counts.ts";
import { AgentSession, createEventBus } from "@earendil-works/pi-coding-agent";
import { Agent } from "@earendil-works/pi-agent-core";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";

const spec = { tool: "bash", command: "work", process: true };
const result = (text: string) => ({ content: [{ type: "text", text }] });

test("a slow call hands off, reports status and returns through wait", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
	const jobs = createJobs({ backgroundAfterMs: 12 });
	let finish!: () => void;
	const pending = jobs.run(spec, () => new Promise((resolve) => { finish = () => resolve(result("done")); }));
	t.mock.timers.tick(12);
	const handedOff: any = await pending;
	assert.match(handedOff.content[0].text, /job#1/);
	assert.equal(jobs.status(undefined, 20)[0].state, "running");
	finish();
	const completed: any = await jobs.wait(["job#1"], 1000, 20);
	assert.equal(completed.reason, "exit");
	assert.equal(completed.results[0].result, "done");
});

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A handed-off job#1 behind the registered `job` tool; `notifications` collects what an old-style subscriber would get. */
async function handedOff(t: any) {
	t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
	let now = 0;
	t.mock.method(performance, "now", () => now);
	const notifications: unknown[] = [];
	const jobs = createJobs({ backgroundAfterMs: 12, notify: (notification: unknown) => notifications.push(notification) } as any);
	const control: { finish(text: string): void; update(text: string): void } = { finish() {}, update() {} };
	const codemode: any = {
		name: "codemode",
		label: "codemode",
		description: "fake",
		parameters: { type: "object", properties: {} },
		execute: (_id: string, _params: unknown, signal: AbortSignal, onUpdate: (update: unknown) => void) => new Promise((resolve, reject) => {
			control.finish = (text) => resolve(result(text));
			control.update = (text) => onUpdate(result(text));
			signal.addEventListener("abort", () => reject(new Error("Operation aborted")));
		}),
	};
	const events = createEventBus();
	// The branch as the wait reads it: the assistant message that announced the calls of a batch is the newest entry.
	const entries: any[] = [];
	const manager = { getSessionId: () => "session", getLeafEntry: () => entries.at(-1), getEntry: (id: string) => entries.find((entry) => entry.id === id) };
	const announce = (...calls: object[]) => entries.push({ id: `e${entries.length}`, parentId: entries.at(-1)?.id ?? null, type: "message", message: { role: "assistant", content: calls.map((call) => ({ type: "toolCall", ...call })) } });
	const listeners = new Set<(event: any) => void>();
	const messages: string[] = [];
	const session = Object.assign(Object.create(AgentSession.prototype), {
		sessionManager: manager, agent: { steeringQueue: { messages: [] } },
		getSteeringMessages: () => messages,
		subscribe: (listener: (event: any) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
	});
	const ctx = { sessionManager: manager, isIdle: () => session.isIdle };
	const tools = new Map(createTools(process.cwd(), () => ({}), { jobs, codemode, events }).map((tool) => [tool.name, tool as any]));
	const pending = tools.get("codemode").execute("call", { code: "work" }, undefined, undefined, undefined);
	t.mock.timers.tick(12);
	await pending;
	const job = (params: Record<string, unknown>, signal?: AbortSignal, call = "wait") => tools.get("job").execute(call, params, signal, undefined, ctx);
	const wrap = (name: string) => ({ ...tools.get(name), execute: (id: string, params: unknown, signal: AbortSignal, update: unknown) => tools.get(name).execute(id, params, signal, update, ctx) });
	return { entries, wrap, announce, jobs, control, job, notifications, events, messages, session, listeners, emit: (event: any) => { for (const listener of listeners) listener(event); }, advance: (ms: number) => { now += ms; t.mock.timers.tick(ms); } };
}

test("the child registry retains a background job and its result after final", async (t) => {
	const { jobs, control, job, wrap, notifications } = await handedOff(t);
	const core = createFauxCore({ provider: "final", models: [{ id: "model" }] });
	core.setResponses([
		() => fauxAssistantMessage("final", { timestamp: 1 }),
		() => fauxAssistantMessage([fauxToolCall("job", { action: "wait", ids: ["job#1"] }, { id: "collect" })], { stopReason: "toolUse" }),
		() => fauxAssistantMessage("collected", { timestamp: 2 }),
	]);
	const agent = new Agent({ streamFn: core.streamSimple, getApiKey: () => "key", initialState: { model: core.getModel("model")!, tools: [wrap("job")] as any } });
	const waiting = Promise.withResolvers<void>();
	agent.subscribe(event => { if (event.type === "tool_execution_start" && event.toolCallId === "collect") waiting.resolve(); });
	await agent.prompt("finish");
	assert.equal(jobs.status(["job#1"], 20)[0].state, "running");
	assert.equal(wrap("job").jobs.hasJobs(), true);
	const next = agent.prompt("collect");
	await waiting.promise;
	control.finish("late result");
	await next;
	assert.equal(wrap("job").jobs.hasJobs(), true);
	assert.deepEqual(notifications, []);
	const toolResult = agent.state.messages.find((message: any) => message.role === "toolResult" && message.toolCallId === "collect") as any;
	assert.equal(toolResult.details.results[0].result, "late result");
	assert.equal((await job({ action: "wait", ids: ["job#1"] })).details.results[0].result, "late result");
});

test("wait returns the exit result itself and sends no later notification", async (t) => {
	const { jobs, control, job, notifications } = await handedOff(t);
	const waiting = job({ action: "wait", ids: ["job#1"] });
	await flush();
	control.finish("done");
	const outcome = await waiting;
	assert.equal(outcome.details.reason, "exit");
	assert.equal(outcome.details.results[0].result, "done");
	assert.equal(outcome.details.results[0].state, "exited");
	assert.deepEqual(JSON.parse(outcome.content[0].text), [{ id: "job#1", state: "exited", result: "done" }]);
	assert.equal(outcome.terminate, undefined);
	await jobs.settled("job#1");
	assert.deepEqual(notifications, []);
});

test("wait returns only finished results while another job runs", async (t) => {
	const { jobs, control, job, advance } = await handedOff(t);
	let finishSecond!: () => void;
	const second = jobs.run(spec, () => new Promise(resolve => { finishSecond = () => resolve(result("second")); }));
	advance(12);
	await second;
	control.finish("first");
	await jobs.settled("job#1");
	const outcome = await job({ action: "wait", ids: ["job#1", "job#2"] });
	assert.deepEqual(JSON.parse(outcome.content[0].text), [{ id: "job#1", state: "exited", result: "first" }]);
	finishSecond();
	await jobs.settled("job#2");
});

test("wait times out with the job still running and sends no later notification", async (t) => {
	const { jobs, control, job, notifications, advance } = await handedOff(t);
	control.update("progress");
	const waiting = job({ action: "wait", ids: ["job#1"], timeout_ms: 1000 });
	await flush();
	advance(1000);
	const outcome = await waiting;
	assert.equal(outcome.details.reason, "timeout");
	assert.equal(outcome.details.timed_out, true);
	assert.equal(outcome.content[0].text, "timeout; still running: job#1");
	const status = JSON.parse((await job({ action: "status", ids: ["job#1"] })).content[0].text).statuses[0];
	assert.equal(status.state, "running");
	assert.equal(status.command, "work");
	assert.equal(status.elapsed_seconds, 1);
	assert.equal(status.tail, "progress");
	assert.ok(status.output_path);
	control.finish("late");
	await jobs.settled("job#1");
	assert.equal(jobs.status(["job#1"], 20)[0].state, "exited");
	assert.deepEqual(notifications, []);
});

test("wait returns when the output matches until and the job keeps running", async (t) => {
	const { jobs, control, job, notifications } = await handedOff(t);
	const waiting = job({ action: "wait", ids: ["job#1"], until: "ready" });
	await flush();
	control.update("booting");
	control.update("server ready");
	const outcome = await waiting;
	assert.equal(outcome.details.reason, "match");
	assert.equal(outcome.content[0].text, "match; still running: job#1");
	control.finish("done");
	await jobs.settled("job#1");
	assert.deepEqual(notifications, []);
});

test("an aborted wait returns a short line, leaves the job running and sends no notification", async (t) => {
	const { jobs, control, job, notifications } = await handedOff(t);
	const controller = new AbortController();
	const waiting = job({ action: "wait", ids: ["job#1"] }, controller.signal);
	await flush();
	controller.abort();
	assert.equal((await waiting).content[0].text, "interrupted; still running: job#1");
	assert.equal(jobs.status(["job#1"], 20)[0].state, "running");
	control.finish("done");
	await jobs.settled("job#1");
	assert.deepEqual(notifications, []);
});

test("registered job wait responds to user steering but ignores service messages", async (t) => {
	const { jobs, control, job, messages, session, listeners, emit } = await handedOff(t);
	messages.push("already queued");
	assert.equal((await job({ action: "wait", ids: ["job#1"] })).content[0].text, "steered; still running: job#1");
	messages.length = 0;
	session.agent.steeringQueue.messages.push({ role: "custom", customType: "service", content: "notice" });
	let settled = false;
	const waiting = job({ action: "wait", ids: ["job#1"] }).then((value: any) => { settled = true; return value; });
	emit({ type: "queue_update", steering: [], followUp: ["service"] });
	await Promise.resolve();
	assert.equal(settled, false);
	messages.push("new");
	emit({ type: "queue_update", steering: [...messages], followUp: [] });
	session.agent.steeringQueue.messages.push({ role: "user", content: "new" });
	assert.equal((await waiting).content[0].text, "steered; still running: job#1");
	assert.equal(listeners.size, 0);
	assert.equal(jobs.status(["job#1"], 20)[0].state, "running");
	messages.length = 0;
	session.agent.steeringQueue.messages.length = 0;
	control.finish("done");
	await jobs.settled("job#1");
	messages.push("queued after completion");
	assert.equal((await job({ action: "wait", ids: ["job#1"] })).details.results[0].result, "done");
});

test("explicit child-core wake is scoped to its own job wait", async (t) => {
	const { jobs, control, job, events } = await handedOff(t);
	let settled = false;
	const waiting = job({ action: "wait", ids: ["job#1"] }).then((value: any) => { settled = true; return value; });
	events.emit("rqw:wait-steer:v1", { sessionId: "other" });
	await Promise.resolve();
	assert.equal(settled, false);
	events.emit("rqw:wait-steer:v1", { sessionId: "session" });
	assert.equal((await waiting).details.reason, "steered");
	control.finish("done");
	await jobs.settled("job#1");
	assert.equal((await job({ action: "wait", ids: ["job#1"] })).details.results[0].result, "done");
});

const waitCall = (id: string) => ({ id, name: "job", arguments: { action: "wait", ids: ["job#1"] } });
const bashCall = { id: "bash", name: "bash", arguments: { command: "make" } };

test("a wait in a batch with other work returns work_pending at once, before or after the other call", async (t) => {
	const { jobs, control, job, events, announce } = await handedOff(t);
	const announced: unknown[] = [];
	events.on("rqw:waiting:v1", (event: unknown) => announced.push(event));
	for (const calls of [[waitCall("w"), bashCall], [bashCall, waitCall("w")]]) {
		announce(...calls);
		const outcome: any = await Promise.race([job({ action: "wait", ids: ["job#1"] }, undefined, "w"), flush().then(() => "blocked")]);
		assert.notEqual(outcome, "blocked", "the wait must not hold the other call of its batch");
		assert.equal(outcome.details.reason, "work_pending");
		assert.equal(outcome.content[0].text, "work_pending; still running: job#1");
	}
	assert.deepEqual(announced, []);
	control.finish("done");
	await jobs.settled("job#1");
	announce(waitCall("again"));
	assert.equal((await job({ action: "wait", ids: ["job#1"] }, undefined, "again")).details.results[0].result, "done");
});

test("in Pi's sequential batch a wait before bash yields, so bash runs while the job goes on", async (t) => {
	const { jobs, control, entries, wrap } = await handedOff(t);
	const core = createFauxCore({ provider: "sequential", models: [{ id: "model" }] });
	core.setResponses([
		() => fauxAssistantMessage([fauxToolCall("job", { action: "wait", ids: ["job#1"] }, { id: "w" }), fauxToolCall("probe", {}, { id: "p" })], { stopReason: "toolUse", timestamp: 1 }),
		() => fauxAssistantMessage("done", { timestamp: 1 }),
	]);
	const ran: string[] = [];
	const probe = { name: "probe", label: "probe", description: "bash stand-in", parameters: { type: "object", properties: {} }, executionMode: "sequential", execute: async () => { ran.push("probe"); return result("ran"); } };
	const agent = new Agent({ streamFn: core.streamSimple, getApiKey: () => "key", initialState: { model: core.getModel("model")!, tools: [wrap("job"), probe] as any } });
	// Pi persists the assistant message before its tools run.
	agent.subscribe((event) => { if (event.type === "message_end" && event.message.role === "assistant") entries.push({ id: `e${entries.length}`, parentId: entries.at(-1)?.id ?? null, type: "message", message: event.message }); });
	t.after(() => agent.abort());
	void agent.prompt("go");
	for (let turn = 0; turn < 10 && !ran.length; turn++) await flush();
	assert.deepEqual(ran, ["probe"]);
	assert.equal(jobs.status(["job#1"], 20)[0].state, "running");
	control.finish("done");
});

test("a wait alone, or with other waits, announces itself open until it returns", async (t) => {
	const { jobs, control, job, events, announce } = await handedOff(t);
	const announced: unknown[] = [];
	events.on("rqw:waiting:v1", (event: unknown) => announced.push(event));
	announce(waitCall("w"), { id: "a", name: "agent", arguments: { action: "wait", ids: ["agent#1"] } });
	const waiting = job({ action: "wait", ids: ["job#1"] }, undefined, "w");
	await flush();
	assert.deepEqual(announced, [{ sessionId: "session", call: "w", open: true }]);
	control.finish("done");
	assert.equal((await waiting).details.reason, "exit");
	assert.deepEqual(announced.at(-1), { sessionId: "session", call: "w", open: false });
	await jobs.settled("job#1");
});

test("kill aborts a process job and returns the result itself", async (t) => {
	const { job, notifications } = await handedOff(t);
	const killed = await job({ action: "kill", id: "job#1" });
	assert.equal(killed.details.state, "killed");
	await flush();
	assert.deepEqual(notifications, []);
});

test("counts follow a handed-off job until it ends", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
	const jobs = createJobs({ backgroundAfterMs: 12 });
	const listeners = new Map<string, (event: any) => void>();
	const events = { on: (name: string, fn: any) => { listeners.set(name, fn); return () => listeners.delete(name); }, emit: (name: string, event: any) => listeners.get(name)?.(event) };
	const counts = createCountsProducer(jobs, events as any);
	counts.start();
	let source: any;
	events.emit("rqw:running-counts:request", { version: 1, reply: (value: any) => { source = value; } });
	let finish!: () => void;
	const pending = jobs.run(spec, () => new Promise((resolve) => { finish = () => resolve(result("done")); }));
	t.mock.timers.tick(12);
	await pending;
	assert.equal(source.snapshot().backgroundProcesses, 1);
	finish();
	await jobs.settled("job#1");
	assert.equal(source.snapshot().backgroundProcesses, 0);
	counts.stop();
});
