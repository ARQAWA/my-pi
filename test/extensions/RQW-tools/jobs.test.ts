import assert from "node:assert/strict";
import test from "node:test";
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

test("kill aborts a process job without a completion notification", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
	const notifications: unknown[] = [];
	const jobs = createJobs({ backgroundAfterMs: 12, notify: (notification) => notifications.push(notification) });
	const pending = jobs.run(spec, (job) => new Promise((_resolve, reject) => {
		job.signal.addEventListener("abort", () => reject(new Error("Operation aborted")));
	}));
	t.mock.timers.tick(12);
	await pending;
	jobs.watch(["job#1"], 1000, 20);
	const killed: any = await jobs.kill("job#1");
	assert.equal(killed.state, "killed");
	await Promise.resolve();
	assert.equal(notifications.length, 0, "kill returns the result itself");
});

test("completion wait notifies once with the result", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
	let now = 0;
	t.mock.method(performance, "now", () => now);
	const notifications: any[] = [];
	const jobs = createJobs({ backgroundAfterMs: 12, notify: (notification) => notifications.push(notification) });
	let finish!: () => void;
	const pending = jobs.run(spec, () => new Promise((resolve) => { finish = () => resolve(result("done")); }));
	t.mock.timers.tick(12);
	await pending;
	assert.equal(jobs.watch(["job#1"], 1000, 20).waiting, true);
	finish();
	await jobs.settled("job#1");
	assert.equal(notifications.length, 1);
	assert.equal(notifications[0].details.reason, "exit");
	assert.equal(notifications[0].details.results[0].result, "done");
	assert.equal(jobs.watch(["job#1"], 1000, 20).waiting, false);
	now = 1000;
	t.mock.timers.tick(1000);
	assert.equal(notifications.length, 1);
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
