import assert from "node:assert/strict";
import test from "node:test";
import { createTools } from "../../../extensions/RQW-tools/index.ts";
import { createJobs } from "../../../extensions/RQW-tools/jobs.ts";
import { createCountsProducer } from "../../../extensions/RQW-tools/counts.ts";

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
	const tools = new Map(createTools(process.cwd(), () => ({}), { jobs, codemode }).map((tool) => [tool.name, tool as any]));
	const pending = tools.get("codemode").execute("call", { code: "work" }, undefined, undefined, undefined);
	t.mock.timers.tick(12);
	await pending;
	const job = (params: Record<string, unknown>, signal?: AbortSignal) => tools.get("job").execute("wait", params, signal);
	return { jobs, control, job, notifications, advance: (ms: number) => { now += ms; t.mock.timers.tick(ms); } };
}

test("wait returns the exit result itself and sends no later notification", async (t) => {
	const { jobs, control, job, notifications } = await handedOff(t);
	const waiting = job({ action: "wait", ids: ["job#1"] });
	await flush();
	control.finish("done");
	const outcome = await waiting;
	assert.equal(outcome.details.reason, "exit");
	assert.equal(outcome.details.results[0].result, "done");
	assert.equal(outcome.details.results[0].state, "exited");
	assert.equal(outcome.terminate, undefined);
	await jobs.settled("job#1");
	assert.deepEqual(notifications, []);
});

test("wait times out with the job still running and sends no later notification", async (t) => {
	const { jobs, control, job, notifications, advance } = await handedOff(t);
	const waiting = job({ action: "wait", ids: ["job#1"], timeout_ms: 1000 });
	await flush();
	advance(1000);
	const outcome = await waiting;
	assert.equal(outcome.details.reason, "timeout");
	assert.equal(outcome.details.timed_out, true);
	assert.equal(outcome.details.statuses[0].state, "running");
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
	assert.equal(outcome.details.matched[0].id, "job#1");
	assert.equal(outcome.details.statuses[0].state, "running");
	control.finish("done");
	await jobs.settled("job#1");
	assert.deepEqual(notifications, []);
});

test("an aborted wait rejects, leaves the job running and sends no notification", async (t) => {
	const { jobs, control, job, notifications } = await handedOff(t);
	const controller = new AbortController();
	const waiting = job({ action: "wait", ids: ["job#1"] }, controller.signal);
	await flush();
	controller.abort();
	await assert.rejects(waiting, /abort/i);
	assert.equal(jobs.status(["job#1"], 20)[0].state, "running");
	control.finish("done");
	await jobs.settled("job#1");
	assert.deepEqual(notifications, []);
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
