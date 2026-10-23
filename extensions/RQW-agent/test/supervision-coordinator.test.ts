import assert from "node:assert/strict";
import { test } from "node:test";
import { Coordinator, statusDepth } from "../coordinator.ts";

const signal = () => new AbortController().signal;
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup() {
	const hooks = new Map<string, ((...args: any[]) => void)[]>();
	const pi = { on(name: string, handler: any) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); }, sendMessage() {} };
	const coordinator = new Coordinator(pi as never);
	const pushes: any[] = [];
	const branch: any[] = [];
	const emit = (name: string, event = {}) => hooks.get(name)?.forEach(h => h(event, { sessionManager: { getBranch: () => branch } }));
	const push = (result: any) => { pushes.push(result); };
	const child = (id: string) => {
		let live = true, version = 0;
		const target = { id, run: "run-1", active: () => live, alertVersion: () => version,
			snapshot: (_messages?: number, _checkpoint?: Map<string, number>, depth = 0): Record<string, unknown> => ({ state: live ? "running" : "idle", depth }) };
		coordinator.add(target);
		return { target,
			alert() { version++; coordinator.notify(); },
			finish(text = id) { live = false; coordinator.publish(id, target.run, text, "completed", push); },
		};
	};
	return { coordinator, child, pushes, push, branch, emit };
}
function clock(t: any) {
	let now = 0;
	t.mock.method(performance, "now", () => now);
	t.mock.timers.enable({ apis: ["setTimeout"] });
	return (ms: number) => { now += ms; t.mock.timers.tick(ms); };
}
function saved(call: string, value: any, isError = false) {
	return { type: "message", message: { role: "toolResult", toolCallId: call, isError, content: [{ type: "text", text: JSON.stringify(value) }] } };
}

test("new alerts wake wait without consuming a later terminal result; old alerts do not wake again", async () => {
	const f = setup(), a = f.child("agent#1");
	const wait = f.coordinator.wait(["agent#1"], 10000, signal(), "first");
	a.alert();
	const first = (await wait).details as any;
	assert.equal(first.reason, "alert");
	assert.deepEqual(first.results, []);
	let resolved = false;
	const next = f.coordinator.wait(["agent#1"], 10000, signal(), "next").then(r => { resolved = true; return r; });
	await tick(); assert.equal(resolved, false);
	a.finish("terminal failure");
	assert.equal((await next).details.reason, "result");
	assert.equal(f.pushes.length, 0);
});

test("wake_on_alert false and unselected alerts do not end the wait", async () => {
	const f = setup(), a = f.child("agent#1"), b = f.child("agent#2");
	let resolved = false;
	const wait = f.coordinator.wait(["agent#1"], 10000, signal(), "call", { wake_on_alert: false }).then(r => { resolved = true; return r; });
	a.alert(); b.alert(); await tick();
	assert.equal(resolved, false);
	a.finish();
	assert.equal((await wait).details.reason, "result");
});

test("all holds early selected results without pushing, then reserves one aggregate handoff", async () => {
	const f = setup(), a = f.child("agent#1"), b = f.child("shell_runner#1");
	let resolved = false;
	const wait = f.coordinator.wait(["agent#1", "shell_runner#1"], 10000, signal(), "call", { until: "all" }).then(r => { resolved = true; return r; });
	a.finish(); await tick();
	assert.equal(resolved, false);
	assert.equal(f.pushes.length, 0);
	b.finish();
	const result = (await wait).details as any;
	assert.equal(result.reason, "result");
	assert.deepEqual(result.results.map((r: any) => r.id), ["agent#1", "shell_runner#1"]);
	assert.equal(f.pushes.length, 0);
	f.branch.push(saved("call", result)); f.emit("turn_end");
	const receipt = (await f.coordinator.wait(["agent#1", "shell_runner#1"], 10000, signal(), "again", { until: "all" })).details as any;
	assert.equal(receipt.reason, "receipt");
	assert.equal(receipt.receipts.length, 2);
	assert.deepEqual(receipt.results, []);
});

test("all includes prior message receipts but still waits for other selected runs", async () => {
	const f = setup(), a = f.child("agent#1"), b = f.child("agent#2");
	a.finish(); assert.equal(f.coordinator.message(f.pushes[0]), true);
	let resolved = false;
	const wait = f.coordinator.wait(["agent#1", "agent#2"], 10000, signal(), "call", { until: "all" }).then(r => { resolved = true; return r; });
	await tick(); assert.equal(resolved, false);
	b.finish();
	const details = (await wait).details as any;
	assert.deepEqual(details.results.map((r: any) => r.id), ["agent#2"]);
	assert.equal(details.receipts[0].id, "agent#1");
	assert.equal(details.receipts[0].delivered_via, "message");
});

for (const reason of ["timeout", "abort", "alert", "target_changed", "snapshot_error"]) test(`all releases held completions on ${reason} without consuming them`, async t => {
	const advance = clock(t);
	const f = setup(), a = f.child("agent#1"), b = f.child("agent#2");
	const controller = new AbortController();
	const wait = f.coordinator.wait(["agent#1", "agent#2"], 100, controller.signal, "call", { until: "all" });
	a.finish("held");
	assert.equal(f.pushes.length, 0);
	if (reason === "timeout") advance(100);
	if (reason === "abort") controller.abort();
	if (reason === "alert") b.alert();
	if (reason === "target_changed") f.coordinator.change("agent#2", "stop");
	if (reason === "snapshot_error") {
		b.target.snapshot = () => { throw new Error("snapshot failed"); };
		advance(100);
	}
	if (reason === "abort") await assert.rejects(wait, { name: "AbortError" });
	else if (reason === "snapshot_error") await assert.rejects(wait, /snapshot failed/);
	else assert.equal((await wait).details.reason, reason);
	assert.equal(f.pushes.length, 1);
	assert.equal(f.pushes[0].text, "held");
	assert.equal(f.pushes[0].state, "pending");
	const again = (await f.coordinator.wait(["agent#1"], 100, signal(), "next")).details as any;
	assert.equal(again.results[0].text, "held");
});

test("failed aggregate handoff falls back once for every result", async () => {
	const f = setup(), a = f.child("agent#1"), b = f.child("agent#2");
	const wait = f.coordinator.wait(["agent#1", "agent#2"], 10000, signal(), "call", { until: "all" });
	a.finish(); b.finish();
	const result = (await wait).details;
	f.branch.push(saved("call", result, true)); f.emit("turn_end"); f.emit("agent_settled");
	assert.deepEqual(f.pushes.map(r => r.id), ["agent#1", "agent#2"]);
	assert.ok(f.pushes.every(r => r.state === "pending"));
});

test("another wait cannot consume a held result or receive a false delivered receipt", async () => {
	const f = setup(), a = f.child("agent#1"), b = f.child("agent#2");
	const all = f.coordinator.wait(["agent#1", "agent#2"], 10000, signal(), "all", { until: "all" });
	a.finish();
	let resolved = false;
	const first = f.coordinator.wait(["agent#1"], 10000, signal(), "first").then(r => { resolved = true; return r; });
	await tick(); assert.equal(resolved, false);
	b.finish();
	assert.equal((await all).details.reason, "result");
	const receipt = (await first).details as any;
	assert.equal(receipt.reason, "receipt");
	assert.equal(receipt.receipts[0].claimed_by, (await f.coordinator.wait(["agent#1"], 10000, signal(), "third")).details.receipts[0].claimed_by);
	assert.equal(f.pushes.length, 0);
});

test("a failed snapshot during publish releases its hold and offers the result only once", async () => {
	const f = setup(), a = f.child("agent#1");
	const wait = f.coordinator.wait(["agent#1"], 10000, signal(), "call", { until: "all" });
	a.target.snapshot = () => { throw new Error("broken snapshot"); };
	a.finish();
	await assert.rejects(wait, /broken snapshot/);
	assert.equal(f.pushes.length, 1);
	assert.equal(f.pushes[0].state, "pending");
});

test("status forwards validated depth and leaves ordinary status read-only", () => {
	const f = setup(); f.child("agent#1");
	assert.equal(statusDepth(), 0);
	assert.equal(statusDepth(null), 0);
	for (const depth of [0, 1, 2, Number.MAX_SAFE_INTEGER]) {
		assert.equal(statusDepth(depth), depth);
		assert.equal(f.coordinator.status(["agent#1"], undefined, undefined, depth)[0].depth, depth);
	}
	for (const depth of [-1, 0.5, NaN, Infinity, 2 ** 53, "1"])
		assert.throws(() => f.coordinator.status(["agent#1"], undefined, undefined, depth as never), /depth must be a nonnegative safe integer/);
	assert.equal(f.pushes.length, 0);
});

test("wait options reject invalid values before registration", () => {
	const f = setup(); f.child("agent#1");
	assert.throws(() => f.coordinator.wait(["agent#1"], 100, signal(), "call", { until: "invalid" as never }), /until/);
	assert.throws(() => f.coordinator.wait(["agent#1"], 100, signal(), "call", { wake_on_alert: 1 as never }), /wake_on_alert/);
});
