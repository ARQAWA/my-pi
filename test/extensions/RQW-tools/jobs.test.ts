import assert from "node:assert/strict";
import test from "node:test";
import { createTools } from "../../../extensions/RQW-tools/index.ts";
import { createJobs } from "../../../extensions/RQW-tools/jobs.ts";
import { createCountsProducer } from "../../../extensions/RQW-tools/counts.ts";

const spec = { tool: "bash", command: "work", process: true };
const result = (text: string) => ({ content: [{ type: "text", text }] });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A handed-off job#1 behind the registered `job` tool; `control` ends or updates the work behind it. */
async function handedOff(t: any) {
	t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
	let now = 0;
	t.mock.method(performance, "now", () => now);
	const jobs = createJobs({ backgroundAfterMs: 12 });
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
	const handoff: any = await pending;
	const job = (params: Record<string, unknown>) => tools.get("job").execute("job-call", params, undefined, undefined, undefined);
	const statusOf = async (id = "job#1") => JSON.parse((await job({ action: "status", ids: [id] })).content[0].text).statuses[0];
	return { jobs, control, job, statusOf, tools, handoff, advance: (ms: number) => { now += ms; t.mock.timers.tick(ms); } };
}

test("a slow call hands off with a message that says its result arrives automatically", async (t) => {
	const { handoff, statusOf } = await handedOff(t);
	const text: string = handoff.content[0].text;
	assert.match(text, /job#1/);
	assert.match(text, /arrives automatically/);
	assert.doesNotMatch(text, /wait/i);
	assert.equal((await statusOf()).state, "running");
});

test("the job tool schema offers status and kill only", async (t) => {
	const { tools } = await handedOff(t);
	const schema = tools.get("job").parameters;
	assert.deepEqual(schema.properties.action.enum, ["status", "kill"]);
	for (const removed of ["timeout_ms", "until"]) assert.equal(schema.properties[removed], undefined, `${removed} is gone`);
	assert.ok(schema.properties.ids, "ids stays for status");
	assert.doesNotMatch(tools.get("job").description, /\bwait|timeout_ms|\buntil\b/i);
});

test("an old wait call is refused and consumes nothing", async (t) => {
	const { job, control, jobs, statusOf } = await handedOff(t);
	await assert.rejects(job({ action: "wait", ids: ["job#1"] }), /Unknown action: wait/);
	control.finish("done");
	await jobs.settled("job#1");
	assert.equal((await statusOf()).result_delivery, "pending");
});

test("a finished job shows as undelivered in status until the automatic source commits its result", async (t) => {
	const { jobs, control, statusOf } = await handedOff(t);
	assert.equal((await statusOf()).result_delivery, undefined, "a running job has no delivery state");
	control.finish("done");
	await jobs.settled("job#1");
	const finished = await statusOf();
	assert.equal(finished.state, "exited");
	assert.equal(finished.result_delivery, "pending");
	const auto = jobs.autoSource();
	const claim = auto.source.claim()!;
	assert.deepEqual(claim.results.map((item: any) => [item.id, item.outcome, item.text]), [["job#1", "exited", "done"]]);
	assert.equal((await statusOf()).result_delivery, "claimed");
	assert.equal(auto.source.claim(), undefined, "a claimed result is not offered twice");
	auto.source.commit(claim.token);
	assert.equal((await statusOf()).result_delivery, "delivered");
	assert.equal(auto.source.claim(), undefined, "a delivered result never comes back");
	assert.equal(jobs.undelivered(), 0);
	auto.close();
});

test("a released claim makes the finished result deliverable again, once", async (t) => {
	const { jobs, control, statusOf } = await handedOff(t);
	control.finish("late result");
	await jobs.settled("job#1");
	const auto = jobs.autoSource();
	const first = auto.source.claim()!;
	auto.source.release(first.token);
	assert.equal((await statusOf()).result_delivery, "pending");
	const second = auto.source.claim()!;
	assert.equal(second.results[0].text, "late result");
	auto.source.commit(second.token);
	assert.equal(auto.source.claim(), undefined);
	auto.close();
});

test("jobs that finish together arrive in one claim", async (t) => {
	const { jobs, control, advance } = await handedOff(t);
	let finishSecond!: () => void;
	const second = jobs.run(spec, () => new Promise(resolve => { finishSecond = () => resolve(result("second")); }));
	advance(12);
	await second;
	const auto = jobs.autoSource();
	assert.deepEqual(auto.source.snapshot().targets, ["job#1", "job#2"]);
	control.finish("first");
	finishSecond();
	await jobs.settled("job#1");
	await jobs.settled("job#2");
	const claim = auto.source.claim()!;
	assert.deepEqual(claim.results.map((item: any) => item.text), ["first", "second"]);
	auto.source.commit(claim.token);
	assert.equal(auto.source.claim(), undefined);
	auto.close();
});

test("the source wakes its subscriber when a running job ends", async (t) => {
	const { jobs, control } = await handedOff(t);
	const auto = jobs.autoSource();
	const woken = Promise.withResolvers<void>();
	auto.source.subscribe(() => { if (auto.source.snapshot().ready) woken.resolve(); });
	assert.equal(auto.source.snapshot().ready, false);
	control.finish("done");
	await woken.promise;
	assert.deepEqual(auto.source.snapshot().targets, []);
	auto.close();
});

test("kill aborts a process job and returns the result itself", async (t) => {
	const { job } = await handedOff(t);
	const killed = await job({ action: "kill", id: "job#1" });
	assert.equal(killed.details.state, "killed");
	await flush();
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

const ownerOf = (jobs: any) => (createTools(process.cwd(), () => ({}), { jobs }).find(tool => tool.name === "job") as any).jobs;

test("the job tool hands its owner a running count, a result source and a hold only while a job runs or is undelivered", async (t) => {
	const { jobs, control } = await handedOff(t);
	const owner = ownerOf(jobs);
	assert.equal(owner.backgroundCount(), 1);
	assert.equal(owner.hasJobs(), true);
	const auto = owner.autoSource();
	assert.deepEqual(auto.source.snapshot().targets, ["job#1"]);
	control.finish("done");
	await jobs.settled("job#1");
	assert.equal(owner.backgroundCount(), 0);
	assert.equal(owner.hasJobs(), true, "a finished job's result is not delivered yet");
	const claim = auto.source.claim();
	assert.equal(claim.results[0].text, "done");
	auto.source.commit(claim.token);
	assert.equal(owner.hasJobs(), false);
	auto.close();
});
