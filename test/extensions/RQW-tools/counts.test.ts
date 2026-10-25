import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { it } from "node:test";
import { createCountsProducer, COUNTS_OFFER, COUNTS_REQUEST, type CountsSource } from "../../../extensions/RQW-tools/counts.ts";
import { createJobs } from "../../../extensions/RQW-tools/jobs.ts";
import { createTools } from "../../../extensions/RQW-tools/index.ts";

function bus() {
	const emitter = new EventEmitter();
	return {
		on(name: string, listener: (data: any) => void) { emitter.on(name, listener); return () => { emitter.off(name, listener); }; },
		emit(name: string, data: any) { emitter.emit(name, data); },
	};
}

it("counts handed-off running and queued jobs once, independent of waits and result delivery", async () => {
	const jobs = createJobs({ backgroundAfterMs: 1, notify() {} });
	const events = bus();
	const producer = createCountsProducer(jobs, events);
	let source!: CountsSource;
	events.on(COUNTS_OFFER, (offer) => { source = offer.source; });
	producer.start();
	const counts: (number | null)[] = [];
	source.subscribe(() => { throw new Error("display failure"); });
	source.subscribe((next) => { counts.push(next?.backgroundProcesses ?? null); });
	const one = Promise.withResolvers<any>();
	const two = Promise.withResolvers<any>();
	try {
		assert.deepEqual(source.snapshot(), { agents: 0, backgroundProcesses: 0 });
		await jobs.run({ tool: "read", command: "foreground", process: false }, async () => ({ content: [] }));
		assert.deepEqual(counts, []);
		const running: any = await jobs.run({ tool: "bash", command: "gated", process: true }, async (handle) => {
			await handle.begin();
			return one.promise;
		});
		const queued: any = await jobs.run({ tool: "read", command: "queued", process: false }, () => two.promise);
		assert.equal(jobs.status(undefined, 1)[0].state, "running");
		assert.equal(jobs.status(undefined, 1)[1].state, "queued");
		assert.equal(jobs.backgroundCount(), 2);
		const ids = [running.details.job.id, queued.details.job.id];
		assert.equal(jobs.watch(ids, 60000, 1).waiting, true);
		assert.equal(jobs.watch(ids, 60000, 1).waiting, true, "replacement wait does not double-count work");
		assert.deepEqual(source.snapshot(), { agents: 0, backgroundProcesses: 2 });
		one.resolve({ content: [] });
		await jobs.settled(ids[0]);
		assert.equal(jobs.backgroundCount(), 1, "completed undelivered job is not active");
		await jobs.kill(ids[1]);
		assert.equal(jobs.backgroundCount(), 0, "queued cancellation notifies immediately");
		assert.deepEqual(counts, [1, 2, 1, 0]);
	} finally {
		one.resolve({ content: [] });
		two.resolve({ content: [] });
		producer.stop();
		jobs.dispose();
	}
	assert.equal(counts.at(-1), null);
});

it("offers fresh session sources, replies only while live, and isolates child registries", async () => {
	const jobs = createJobs({ backgroundAfterMs: 1 });
	const events = bus();
	const producer = createCountsProducer(jobs, events);
	let offered!: CountsSource;
	events.on(COUNTS_OFFER, (offer) => { offered = offer.source; });
	const replies: CountsSource[] = [];
	const request = () => events.emit(COUNTS_REQUEST, { version: 1, reply: (source: CountsSource) => replies.push(source) });
	request();
	assert.equal(replies.length, 0);
	producer.start();
	request();
	assert.equal(replies[0], offered);
	const previous = offered;
	const endings: unknown[] = [];
	previous.subscribe((value) => endings.push(value));
	producer.start();
	assert.notEqual(offered, previous);
	assert.deepEqual(endings, [null]);
	previous.subscribe((value) => endings.push(value));
	assert.deepEqual(endings, [null, null]);
	const child = createJobs({ backgroundAfterMs: 1, label: "agent#1" });
	createTools(process.cwd(), () => ({}), undefined, { jobs: child });
	const gate = Promise.withResolvers<any>();
	try {
		const result: any = await child.run({ tool: "read", command: "child gate", process: false }, () => gate.promise);
		assert.equal(child.backgroundCount(), 1);
		assert.deepEqual(offered.snapshot(), { agents: 0, backgroundProcesses: 0 });
		gate.resolve({ content: [] });
		await child.settled(result.details.job.id);
	} finally { gate.resolve({ content: [] }); child.dispose(); }
	producer.stop();
	producer.stop();
	assert.deepEqual(offered.snapshot(), { agents: 0, backgroundProcesses: 0 });
	request();
	assert.equal(replies.length, 1);
	jobs.dispose();
});
