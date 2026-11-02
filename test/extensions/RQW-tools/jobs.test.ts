import { descriptions } from "./descriptions.ts";
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { Writable } from "node:stream";
import { createTools } from "../../../extensions/RQW-tools/index.ts";
import { createJobs } from "../../../extensions/RQW-tools/jobs.ts";
import { createCountsProducer } from "../../../extensions/RQW-tools/counts.ts";
import { validateToolArguments } from "@earendil-works/pi-ai";

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
	const tools = new Map(createTools(process.cwd(), () => ({}), { descriptions, jobs, codemode }).map((tool) => [tool.name, tool as any]));
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
	assert.deepEqual(JSON.parse(JSON.stringify(schema)).properties.action.enum, ["status", "kill"]);
	const tool = tools.get("job");
	const parse = (args: unknown) => validateToolArguments(tool, { type: "toolCall", id: "id", name: "job", arguments: args } as any);
	assert.deepEqual(parse({ action: "status", ids: "job#1", lines: "5", id: null }), { action: "status", ids: ["job#1"], lines: 5 });
	assert.throws(() => parse({ action: "wait" }), /Validation failed/);
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

test("kill signals a background file call and waits for its actual result", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
	const jobs = createJobs({ backgroundAfterMs: 12 });
	const write = Promise.withResolvers<any>();
	let signal!: AbortSignal;
	const pending = jobs.run({ tool: "write", command: "file", process: false }, async (handle) => {
		signal = handle.signal;
		return write.promise;
	});
	t.mock.timers.tick(12);
	await pending;
	const killing = jobs.kill("job#1");
	assert.equal(signal.aborted, true);
	assert.equal(jobs.status(["job#1"], 20)[0].state, "running");
	write.resolve(result("written"));
	assert.equal((await killing).state, "exited");
	const auto = jobs.autoSource();
	const claim = auto.source.claim()!;
	assert.equal(claim.results[0].text, "written");
	auto.source.commit(claim.token);
	assert.equal(auto.source.claim(), undefined);
	auto.close();
});

test("background stop cancels file work but not the already detached parent signal", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
	const jobs = createJobs({ backgroundAfterMs: 12 });
	const parent = new AbortController();
	let signal!: AbortSignal;
	let startedNext = false;
	const gate = Promise.withResolvers<void>();
	const pending = jobs.run({ tool: "edit", command: "file", process: false, signal: parent.signal }, async (handle) => {
		signal = handle.signal;
		await gate.promise;
		if (signal.aborted) throw new Error("Operation aborted");
		startedNext = true;
		return result("edited");
	});
	t.mock.timers.tick(12);
	await pending;
	parent.abort();
	assert.equal(signal.aborted, false);
	assert.deepEqual(jobs.stopBackground(), { backgroundProcesses: 1, unstoppable: 0 });
	assert.equal(signal.aborted, true);
	gate.resolve();
	await jobs.settled("job#1");
	assert.equal(startedNext, false);
	const auto = jobs.autoSource();
	const claim = auto.source.claim()!;
	assert.equal(claim.results[0].outcome, "killed");
	auto.source.commit(claim.token);
	assert.equal(auto.source.claim(), undefined);
	auto.close();
});

test("an aborted in-flight write warns that the file may have changed", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
	const jobs = createJobs({ backgroundAfterMs: 12 });
	const write = Promise.withResolvers<any>();
	const pending = jobs.run({ tool: "write", command: "file", process: false }, () => write.promise);
	t.mock.timers.tick(12);
	await pending;
	const killing = jobs.kill("job#1");
	write.reject(new Error("Operation aborted"));
	await killing;
	const auto = jobs.autoSource();
	const claim = auto.source.claim()!;
	assert.match(claim.results[0].text, /[Pp]ossibly changed/);
	assert.match(claim.results[0].text, /[Rr]ead.*before retry/);
	auto.source.commit(claim.token);
	auto.close();
});

test("a separate file error after abort remains a failure", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
	const jobs = createJobs({ backgroundAfterMs: 12 });
	const write = Promise.withResolvers<any>();
	const pending = jobs.run({ tool: "write", command: "file", process: false }, () => write.promise);
	t.mock.timers.tick(12);
	await pending;
	const killing = jobs.kill("job#1");
	write.reject(new Error("disk failed"));
	assert.equal((await killing).state, "failed");
});

test("a delayed log write leaves other work free to run", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
	const writeGate = Promise.withResolvers<void>();
	const chunks: string[] = [];
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			if (chunk.length) chunks.push(chunk.toString());
			void writeGate.promise.then(() => callback());
		},
	});
	const closed = new Promise<void>((resolve) => stream.once("close", resolve));
	t.mock.method(fs, "createWriteStream", () => stream as any);
	for (const name of ["writeFileSync", "appendFileSync", "rmSync"] as const) {
		t.mock.method(fs, name, () => { throw new Error("synchronous log I/O"); });
	}
	syncBuiltinESMExports();
	try {
		const jobs = createJobs({ backgroundAfterMs: 12 });
		const finish = Promise.withResolvers<void>();
		const pending = jobs.run(spec, async (handle) => {
			handle.data("before\n");
			await finish.promise;
			handle.data("after\n");
			return result("done");
		});
		t.mock.timers.tick(12);
		const handoff: any = await pending;
		assert.match(handoff.content[0].text, /log is written asynchronously/);
		let otherRan = false;
		await Promise.resolve().then(() => { otherRan = true; });
		assert.equal(otherRan, true);
		finish.resolve();
		await flush();
		const auto = jobs.autoSource();
		const claim = auto.source.claim()!;
		assert.equal(claim.results[0].text, "done");
		assert.equal(claim.results[0].output_status, "writing");
		assert.equal(jobs.status(["job#1"], 20)[0].output_status, "writing");
		auto.source.commit(claim.token);
		auto.close();
		writeGate.resolve();
		await closed;
		await flush();
		assert.equal(jobs.status(["job#1"], 20)[0].output_status, "ready");
		assert.deepEqual(chunks, ["before\n", "after\n"]);
	} finally {
		writeGate.resolve();
		t.mock.restoreAll();
		syncBuiltinESMExports();
	}
});

test("a background log keeps chunks in order in the temporary file", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
	const create = fs.createWriteStream;
	const closed = Promise.withResolvers<void>();
	t.mock.method(fs, "createWriteStream", ((path: fs.PathLike, options: any) => {
		const stream = create(path, options);
		stream.once("close", () => closed.resolve());
		return stream;
	}) as typeof fs.createWriteStream);
	syncBuiltinESMExports();
	let path = "";
	try {
		const jobs = createJobs({ backgroundAfterMs: 12 });
		const finish = Promise.withResolvers<void>();
		let data!: (chunk: string) => void;
		const pending = jobs.run(spec, async (handle) => {
			data = handle.data;
			data("first\n");
			await finish.promise;
			data("third\n");
			return result("done");
		});
		t.mock.timers.tick(12);
		const handoff: any = await pending;
		path = handoff.details.job.output_path;
		data("second\n");
		finish.resolve();
		await closed.promise;
		assert.equal(await fsPromises.readFile(path, "utf8"), "first\nsecond\nthird\n");
	} finally {
		t.mock.restoreAll();
		syncBuiltinESMExports();
		if (path) await fsPromises.rm(path, { force: true });
	}
});

test("a foreground call removes its temporary log without synchronous I/O", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
	const create = fs.createWriteStream;
	const remove = fsPromises.rm;
	const closed = Promise.withResolvers<void>();
	let removal: Promise<void> | undefined;
	let logPath = "";
	let synchronousRemovals = 0;
	t.mock.method(fs, "createWriteStream", ((path: fs.PathLike, options: any) => {
		logPath = String(path);
		const stream = create(path, options);
		stream.once("close", () => closed.resolve());
		return stream;
	}) as typeof fs.createWriteStream);
	t.mock.method(fs, "rmSync", () => { synchronousRemovals++; });
	t.mock.method(fsPromises, "rm", ((path: fs.PathLike, options: any) => {
		removal = remove(path, options);
		return removal;
	}) as typeof fsPromises.rm);
	syncBuiltinESMExports();
	try {
		const jobs = createJobs({ backgroundAfterMs: 12 });
		await jobs.run(spec, async (handle) => {
			handle.data("x".repeat(1024 * 1024 + 1));
			return result("done");
		});
		await closed.promise;
		await flush();
		assert.equal(synchronousRemovals, 0);
		assert.ok(removal, "the temporary log is removed");
		await removal;
		await assert.rejects(fsPromises.stat(logPath), { code: "ENOENT" });
	} finally {
		t.mock.restoreAll();
		syncBuiltinESMExports();
	}
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

const ownerOf = (jobs: any) => (createTools(process.cwd(), () => ({}), { descriptions, jobs }).find(tool => tool.name === "job") as any).jobs;

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

test("the job tool hands its owner a subscription to job changes", async (t) => {
	const { jobs, control } = await handedOff(t);
	let changes = 0;
	const unsubscribe = ownerOf(jobs).subscribeActivity(() => { changes++; });
	control.finish("done");
	await jobs.settled("job#1");
	assert.ok(changes > 0);
	const seen = changes;
	unsubscribe();
	jobs.dispose();
	assert.equal(changes, seen);
});
