// T16 running counts on pi.events: the producer contract, then real RQW-agent sessions with faux providers only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxToolCall } from "@earendil-works/pi-ai";
import { createEventBus, type EventBus } from "@earendil-works/pi-coding-agent";
import { COUNTS_OFFER, COUNTS_REQUEST, type CountsOffer, type CountsRequest, type CountsSource, createCountsProducer, type RunningCounts } from "../counts.ts";
import { answer, fixture, gate, tick, until } from "./audit-fixture.ts";
import { withWorkers } from "./metadata-fixture.ts";

const ZERO: RunningCounts = { agents: 0, workers: 0, reviews: 0 };
const json = (counts: unknown) => JSON.stringify(counts);

test("counts-producer: a late offer, subscribe, unsubscribe, end and no listener left behind", () => {
	const bus = createEventBus();
	let running: RunningCounts = { ...ZERO };
	const producer = createCountsProducer(() => ({ ...running }), bus);
	// The producer answers requests itself: a consumer's request reaches producer.reply on this bus.
	bus.on(COUNTS_REQUEST, (request) => producer.reply(request as CountsRequest));
	const offers: CountsOffer[] = [];
	bus.on(COUNTS_OFFER, (offer) => offers.push(offer as CountsOffer));
	const replies: CountsSource[] = [];
	const ask = () => {
		const request: CountsRequest = { version: 1, reply: (source: CountsSource) => replies.push(source) };
		bus.emit(COUNTS_REQUEST, request);
	};

	ask();
	assert.equal(replies.length, 0, "no live source before the session starts");

	producer.start();
	assert.equal(offers.length, 1, "one offer per session start");
	const first = offers[0].source;
	ask();
	assert.equal(replies[0], first, "a request gets the same live source");
	assert.equal(typeof first.dispose, "function", "the producer-owned end is available on the source");

	const seen: (RunningCounts | null)[] = [];
	const off = first.subscribe((counts) => seen.push(counts));
	running = { agents: 1, workers: 0, reviews: 0 };
	producer.refresh();
	producer.refresh();
	assert.deepEqual(seen, [{ agents: 1, workers: 0, reviews: 0 }], "changes only, once");
	assert.deepEqual(first.snapshot(), { agents: 1, workers: 0, reviews: 0 });
	off();
	running = { agents: 0, workers: 2, reviews: 0 };
	producer.refresh();
	assert.deepEqual(seen, [{ agents: 1, workers: 0, reviews: 0 }], "an unsubscribed listener hears nothing");

	const late: (RunningCounts | null)[] = [];
	first.subscribe((counts) => late.push(counts));
	assert.equal(late.length, 0, "subscribing to a live source does not call back at once");

	producer.start();
	assert.equal(offers.length, 2, "the next session start offers a fresh source");
	assert.deepEqual(late, [null], "the previous source ends and its listeners get null");
	assert.deepEqual(first.snapshot(), ZERO, "an ended source counts nothing");
	first.dispose();
	first.dispose();
	assert.deepEqual(late, [null], "dispose after the replacement, twice, adds no second null");
	const lateAfterEnd: (RunningCounts | null)[] = [];
	const again = first.subscribe((counts) => lateAfterEnd.push(counts));
	assert.deepEqual(lateAfterEnd, [null], "a late subscriber to an ended source gets null at once");
	again();

	producer.stop();
	ask();
	assert.equal(replies.length, 1, "after stop nothing is offered back: the request got no reply");
	const second = offers[1].source;
	assert.deepEqual(second.snapshot(), ZERO);
	const lastSeen: (RunningCounts | null)[] = [];
	second.subscribe((counts) => lastSeen.push(counts));
	running = { agents: 3, workers: 0, reviews: 0 };
	producer.refresh();
	assert.deepEqual(lastSeen, [null], "a stopped producer does not notify");
});

test("counts-isolation: a throwing listener never breaks the producer, the other listeners or the end", () => {
	const bus = createEventBus();
	let running: RunningCounts = { ...ZERO };
	const producer = createCountsProducer(() => ({ ...running }), bus);
	bus.on(COUNTS_REQUEST, (request) => producer.reply(request as CountsRequest));
	const replies: CountsSource[] = [];
	bus.emit(COUNTS_REQUEST, { version: 1, reply: (source: CountsSource) => replies.push(source) });
	producer.start();
	bus.emit(COUNTS_REQUEST, { version: 1, reply: (source: CountsSource) => replies.push(source) });
	const source = replies[0];
	const seen: (RunningCounts | null)[] = [];
	source.subscribe(() => { throw new Error("consumer bug on change"); });
	source.subscribe((counts) => seen.push(counts));
	running = { agents: 1, workers: 0, reviews: 0 };
	assert.doesNotThrow(() => producer.refresh());
	assert.deepEqual(seen, [{ agents: 1, workers: 0, reviews: 0 }], "the other listener still hears the change");
	assert.deepEqual(source.snapshot(), { agents: 1, workers: 0, reviews: 0 });
	source.subscribe(() => { throw new Error("consumer bug on subscribe to an ended source"); });
	assert.doesNotThrow(() => producer.stop(), "a throwing listener does not stop the end");
	assert.equal(seen.at(-1), null, "the other listener still gets null");
	assert.doesNotThrow(() => source.subscribe(() => { throw new Error("late"); }));
	const count = seen.length;
	assert.doesNotThrow(() => { source.dispose(); source.dispose(); }, "dispose after stop is idempotent and isolated");
	assert.equal(seen.length, count, "dispose after stop adds no notification");
});

test("counts-by-kind: running agents and workers from RQW-agent, one offer, running not pending", async () => {
	const f = await fixture();
	const replies = await withWorkers(f);
	const bus = f.bus as unknown as EventBus;
	const sources: CountsSource[] = [];
	const request: CountsRequest = { version: 1, reply: (source: CountsSource) => sources.push(source) };
	bus.emit(COUNTS_REQUEST, request);
	assert.equal(sources.length, 1, "the session offers exactly one RQW-agent source");
	const [source] = sources;
	assert.deepEqual(source.snapshot(), ZERO);

	const seen: (RunningCounts | null)[] = [];
	const off = source.subscribe((counts) => seen.push(counts));
	const ended: (RunningCounts | null)[] = [];
	source.subscribe((counts) => ended.push(counts));
	// A listener that throws is isolated: the run still completes and the other listeners hear every change.
	source.subscribe(() => { throw new Error("consumer bug"); });
	const agentGate = gate("AGENT");
	const workerGate = gate("WORKER");
	f.subReplies.push(agentGate.reply);
	replies.push(workerGate.reply);
	try {
		await f.start("ONE");
		await until(() => agentGate.entered(), "the agent running");
		assert.deepEqual(source.snapshot(), { agents: 1, workers: 0, reviews: 0 });

		await f.session.getToolDefinition("code_writer")!.execute("worker", { task: "CODE" }, undefined, undefined, f.session.extensionRunner.createContext());
		await until(() => workerGate.entered(), "the worker running");
		assert.deepEqual(source.snapshot(), { agents: 1, workers: 1, reviews: 0 }, "agents and workers are counted by kind");

		agentGate.release();
		workerGate.release();
		await until(() => json(source.snapshot()) === json(ZERO), "both runs ended");
		assert.deepEqual(seen[0], { agents: 1, workers: 0, reviews: 0 });
		assert.deepEqual(seen[1], { agents: 1, workers: 1, reviews: 0 });
		assert.deepEqual(seen.at(-1), ZERO, "ended runs stop counting, even when their result is still undelivered or delivered");
		assert.equal(source.snapshot().reviews, 0, "RQW-agent never counts reviews");
		off();
		assert.deepEqual(f.errors, []);
	} finally {
		await f.cleanup();
	}
	// Session shutdown ends the source: its listeners get null, and a late subscriber does too.
	assert.deepEqual(ended.at(-1), null);
	assert.deepEqual(source.snapshot(), ZERO);
	const afterShutdown: (RunningCounts | null)[] = [];
	source.subscribe((counts) => afterShutdown.push(counts));
	assert.deepEqual(afterShutdown, [null]);
});

test("counts-nested: a native-idle parent waiting for its worker counts zero agents and one worker", async () => {
	const f = await fixture();
	const replies = await withWorkers(f);
	const bus = f.bus as unknown as EventBus;
	const sources: CountsSource[] = [];
	bus.emit(COUNTS_REQUEST, { version: 1, reply: (source: CountsSource) => sources.push(source) });
	const [source] = sources;
	const worker = gate("NESTED_WORKER");
	replies.push(worker.reply);
	// The child calls code_writer, then answers while its worker is still running: its native run ends and it parks.
	f.subReplies.push(
		answer([fauxToolCall("code_writer", { task: "NESTED" })], { stopReason: "toolUse" }),
		answer("WAITING"),
		answer("CHILD_DONE"),
	);
	try {
		await f.start("PARENT");
		await until(() => worker.entered(), "the nested worker running");
		await until(() => json(source.snapshot()) === json({ agents: 0, workers: 1, reviews: 0 }), "the parked parent counts zero agents and one worker");
		await tick();
		assert.deepEqual(source.snapshot(), { agents: 0, workers: 1, reviews: 0 });
		worker.release();
		await until(() => json(source.snapshot()) === json(ZERO), "the nested worker and parent ended");
		await until(() => f.delivered().length === 1, "the parent's final answer");
		assert.deepEqual(f.errors, []);
	} finally {
		await f.cleanup();
	}
});
