import assert from "node:assert/strict";
import { test } from "node:test";
import { Coordinator } from "../../../extensions/RQW-agent/coordinator.ts";

function fixture() {
	const hooks = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	const sent: { message: any; options: any }[] = [];
	const branch: any[] = [], pushes: any[] = [];
	const pi = { on(name: string, handler: any) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
		sendMessage() { throw new Error("must use injected sender"); } };
	let sendError: Error | undefined;
	const coordinator = new Coordinator(pi as never, (message, options) => { if (sendError) throw sendError; sent.push({ message, options }); });
	const ctx = { sessionManager: { getBranch: () => branch } } as any;
	const emit = (name: string, event: any = {}, context = ctx) => {
		let result: unknown;
		for (const hook of hooks.get(name) ?? []) result = hook(event, context);
		return result;
	};
	const controller = new AbortController();
	const child = (id: string) => {
		let live = true, version = 0;
		const target = { id, run: "run-1", active: () => live, alertVersion: () => version,
			snapshot: () => ({ state: live ? "running" : "idle" }) };
		coordinator.add(target);
		return { target, alert() { version++; coordinator.notify(); },
			finish(text = id) { live = false; coordinator.publish(id, target.run, text, "completed", result => pushes.push(result)); } };
	};
	const wait = (ids: string[], options = {}, timeout = 1000, call = "wait-call") =>
		coordinator.notificationWait(ids, timeout, controller.signal, call, options);
	const save = (receipt: unknown, call = "wait-call", isError = false) => {
		branch.push({ type: "message", message: { role: "toolResult", toolCallId: call, isError,
			content: [{ type: "text", text: JSON.stringify(receipt) }] } });
	};
	const payloads = () => sent.map(item => JSON.parse(item.message.content));
	return { coordinator, ctx, emit, controller, child, wait, save, sent, pushes, payloads,
		failSend() { sendError = new Error("sender failed"); } };
}
function clock(t: any) {
	let now = 0;
	t.mock.method(performance, "now", () => now);
	t.mock.timers.enable({ apis: ["setTimeout"] });
	return (ms: number) => { now += ms; t.mock.timers.tick(ms); };
}

test("notification wait returns immediately and sends nothing merely for waiting", t => {
	const advance = clock(t), f = fixture();
	f.child("agent#1");
	const receipt = f.wait(["agent#1"]);
	assert.equal("then" in receipt, false);
	assert.equal(receipt.terminate, true);
	assert.equal(receipt.details.reason, "waiting");
	assert.equal(typeof receipt.details.wait_id, "string");
	f.save(receipt); f.emit("turn_end"); f.emit("agent_settled", { aborted: false });
	advance(999);
	assert.equal(f.sent.length, 0);
	// A saved subscription outlives the caller's abort: its deadline is one quiet notification.
	f.controller.abort(); f.emit("agent_settled", { aborted: true });
	advance(1000);
	assert.equal(f.sent.length, 1);
	assert.equal(f.sent[0].options.triggerTurn, false);
	assert.equal(f.payloads()[0].reason, "timeout");
	assert.equal(f.payloads()[0].wait_id, receipt.details.wait_id);
});

for (const order of ["before_saved", "after_saved", "after_settled"] as const) {
	test(`completion ${order} sends once only after a successful saved receipt`, () => {
		const f = fixture(), a = f.child("agent#1");
		const receipt = f.wait(["agent#1"]);
		if (order === "before_saved") a.finish("answer");
		assert.equal(f.sent.length, 0); assert.equal(f.pushes.length, 0);
		f.save(receipt); f.emit("turn_end");
		if (order === "after_saved") a.finish("answer");
		f.emit("agent_settled", { aborted: false });
		if (order === "after_settled") a.finish("answer");
		assert.equal(f.sent.length, 1);
		assert.equal(f.sent[0].message.customType, "child_wait");
		assert.equal(f.sent[0].options.triggerTurn, true);
		const payload = f.payloads()[0];
		assert.equal(payload.wait_id, receipt.details.wait_id);
		assert.equal(payload.reason, "result"); assert.equal(payload.results[0].text, "answer");
		assert.equal(f.pushes.length, 0);
		f.emit("turn_end"); f.emit("agent_settled", { aborted: false }); f.coordinator.notify();
		assert.equal(f.sent.length, 1);
		const again = f.wait(["agent#1"]);
		assert.equal(again.details.reason, "receipt");
		assert.equal("terminate" in again, false);
		assert.equal(JSON.stringify(again).includes("answer"), false);
	});
}

for (const failure of ["missing", "error", "filtered", "execution_error"]) {
	test(`${failure} receipt releases an early completion to normal delivery once`, () => {
		const f = fixture(), a = f.child("agent#1");
		const receipt = f.wait(["agent#1"]); a.finish("held");
		if (failure !== "missing") f.save(failure === "filtered" ? "filtered" : receipt, "wait-call", failure === "error");
		if (failure === "execution_error") f.emit("tool_execution_end", { toolCallId: "wait-call", isError: true });
		f.emit("turn_end"); f.emit("agent_settled", { aborted: false }); f.emit("agent_settled", { aborted: false });
		assert.equal(f.sent.length, 0); assert.equal(f.pushes.length, 1);
		assert.equal(f.pushes[0].text, "held"); assert.equal(f.pushes[0].state, "pending");
	});
}

test("all holds early results and delivers one aggregate including prior receipts", () => {
	const f = fixture(), a = f.child("agent#1"), b = f.child("agent#2"), c = f.child("agent#3");
	a.finish("already"); assert.equal(f.coordinator.message(f.pushes[0]), true);
	const receipt = f.wait(["agent#1", "agent#2", "agent#3"], { until: "all" });
	assert.equal(receipt.terminate, true);
	f.save(receipt); f.emit("turn_end");
	b.finish("second"); assert.equal(f.sent.length, 0); assert.equal(f.pushes.length, 1);
	c.finish("third");
	assert.equal(f.sent.length, 1);
	const payload = f.payloads()[0];
	assert.deepEqual(payload.results.map((r: any) => r.text), ["second", "third"]);
	assert.equal(payload.receipts[0].id, "agent#1");
	assert.equal(JSON.stringify(payload).includes("already"), false);
});

test("first does not wait for or cancel the other selected child", () => {
	const f = fixture(), a = f.child("agent#1"), b = f.child("agent#2");
	const receipt = f.wait(["agent#1", "agent#2"]); f.save(receipt); f.emit("turn_end");
	a.finish("first");
	assert.equal(f.sent.length, 1); assert.equal(b.target.active(), true);
	b.finish("later"); assert.equal(f.sent.length, 1); assert.equal(f.pushes.length, 1);
});

for (const reason of ["alert", "timeout", "target_changed"] as const) {
	test(`${reason} reports status without consuming held all results`, t => {
		const advance = clock(t), f = fixture(), a = f.child("agent#1"), b = f.child("agent#2");
		const receipt = f.wait(["agent#1", "agent#2"], { until: "all" });
		f.save(receipt); f.emit("turn_end"); a.finish("partial");
		if (reason === "alert") b.alert();
		if (reason === "timeout") advance(1000);
		if (reason === "target_changed") f.coordinator.change("agent#2", "restart");
		const payload = f.payloads()[0];
		assert.equal(payload.reason, reason); assert.deepEqual(payload.results, []);
		assert.equal(payload.timed_out, reason === "timeout");
		assert.equal(f.pushes.length, 1); assert.equal(f.pushes[0].text, "partial");
		assert.equal(f.pushes[0].state, "pending");
		advance(1000); assert.equal(f.sent.length, 1);
	});
}

test("wake_on_alert false and unrelated results leave the subscription waiting", () => {
	const f = fixture(), a = f.child("agent#1"), b = f.child("agent#2");
	const receipt = f.wait(["agent#1"], { wake_on_alert: false }); f.save(receipt); f.emit("turn_end");
	a.alert(); b.finish(); assert.equal(f.sent.length, 0); assert.equal(f.pushes.length, 1);
	a.finish(); assert.equal(f.sent.length, 1);
});

test("uncommitted abort releases subscription holds without cancelling work", t => {
	const advance = clock(t), f = fixture(), a = f.child("agent#1"), b = f.child("agent#2");
	f.wait(["agent#1", "agent#2"], { until: "all" });
	a.finish("partial"); f.controller.abort(); advance(2000);
	assert.equal(f.sent.length, 0); assert.equal(f.pushes.length, 1);
	assert.equal(b.target.active(), true);
	b.finish("after abort"); assert.equal(f.pushes.length, 2);
});

for (const core of [false, true]) {
	test(`armed observation survives caller abort and retains all results once, core=${core}`, () => {
		const f = fixture(), a = f.child("agent#1"), b = f.child("agent#2");
		const receipt = f.wait(["agent#1", "agent#2"], { until: "all" });
		f.save(receipt); f.emit("turn_end"); a.finish("partial");
		f.emit("agent_end", {}, { ...f.ctx, signal: f.controller.signal });
		f.controller.abort();
		if (core) f.coordinator.settleCore(f.ctx, true);
		else f.emit("agent_settled", { aborted: true });
		assert.equal(f.sent.length, 0); assert.equal(f.pushes.length, 0);
		assert.equal(b.target.active(), true);
		b.finish("after abort");
		assert.equal(f.sent.length, 1); assert.equal(f.sent[0].options.triggerTurn, false);
		assert.deepEqual(f.payloads()[0].results.map((r: any) => r.text), ["partial", "after abort"]);
		assert.equal(f.pushes.length, 0);
		f.emit("agent_start"); f.emit("agent_settled", { aborted: false }); f.coordinator.notify();
		assert.equal(f.sent.length, 1, "a later turn does not repeat the retained result");
		assert.equal(f.coordinator.notificationWait(["agent#1", "agent#2"], 1000, new AbortController().signal, "next", { until: "all" }).details.reason, "receipt");
	});
}

test("armed deadline survives caller abort without an automatic wake", t => {
	const advance = clock(t), f = fixture(), a = f.child("agent#1");
	const receipt = f.wait(["agent#1"]); f.save(receipt); f.emit("turn_end");
	f.controller.abort(); f.emit("agent_settled", { aborted: true }); advance(1000);
	assert.equal(f.sent.length, 1); assert.equal(f.sent[0].options.triggerTurn, false);
	assert.equal(f.payloads()[0].reason, "timeout"); assert.equal(a.target.active(), true);
	advance(1000); assert.equal(f.sent.length, 1);
});

test("agent_end observes abort before confirming a ready notification", () => {
	const f = fixture(), a = f.child("agent#1");
	const receipt = f.wait(["agent#1"]); a.finish("held"); f.save(receipt);
	f.emit("agent_end", {}, { ...f.ctx, signal: AbortSignal.abort() });
	f.emit("agent_before_settle"); f.emit("agent_settled", { aborted: true });
	assert.equal(f.sent.length, 0); assert.equal(f.pushes.length, 1);
});

test("caller settlement abort cancels subscriptions even without the original signal abort", () => {
	const f = fixture(), a = f.child("agent#1");
	const receipt = f.wait(["agent#1"]); f.save(receipt);
	f.emit("agent_settled", { aborted: true });
	a.finish(); assert.equal(f.sent.length, 0); assert.equal(f.pushes.length, 1);
});

test("completed pending result is held until notification receipt persists", () => {
	const f = fixture(), a = f.child("agent#1"); a.finish("ready");
	const receipt = f.wait(["agent#1"]);
	assert.equal(receipt.terminate, true); assert.equal(f.coordinator.message(f.pushes[0]), false);
	assert.equal(f.sent.length, 0); f.save(receipt); f.emit("turn_end");
	assert.equal(f.payloads()[0].results[0].text, "ready");
	assert.equal(f.coordinator.message(f.pushes[0]), false);
});

test("unknown and already delivered selections return immediate legacy results", () => {
	const f = fixture();
	const idle = f.wait(["agent#99"]); assert.equal(idle.details.reason, "idle"); assert.equal("terminate" in idle, false);
	const a = f.child("agent#1"); a.finish(); f.coordinator.message(f.pushes[0]);
	const receipt = f.wait(["agent#1"]); assert.equal(receipt.details.reason, "receipt"); assert.equal("terminate" in receipt, false);
	assert.equal(f.sent.length, 0);
});

test("blocking wait replaces a same-target notification and claims its held result", async t => {
	const advance = clock(t), f = fixture(), a = f.child("agent#1");
	const receipt = f.wait(["agent#1"]); a.finish("once");
	const blocking = f.coordinator.wait(["agent#1"], 2000, new AbortController().signal, "blocking");
	const result = await blocking;
	assert.equal(result.details.reason, "result");
	assert.equal((result.details.results as any[])[0].text, "once");
	f.save(receipt); f.save(result, "blocking"); f.emit("turn_end");
	advance(1000);
	assert.equal(f.sent.length, 0); assert.equal(f.pushes.length, 0);
});

test("core settlement confirms and flushes a saved receipt without Session settle hooks", () => {
	const f = fixture(), a = f.child("agent#1");
	const receipt = f.wait(["agent#1"]); a.finish("core"); f.save(receipt);
	f.coordinator.settleCore(f.ctx, false);
	assert.equal(f.payloads()[0].results[0].text, "core"); assert.equal(f.sent[0].options.triggerTurn, true);
	f.coordinator.settleCore(f.ctx, false); assert.equal(f.sent.length, 1);
});

test("settling retains results and flushes at before_settle with one continuation", () => {
	const f = fixture(), a = f.child("agent#1");
	const receipt = f.wait(["agent#1"]); f.save(receipt); f.emit("turn_end");
	f.emit("agent_end", {}, { ...f.ctx, signal: f.controller.signal }); a.finish();
	assert.equal(f.sent.length, 0);
	assert.deepEqual(f.emit("agent_before_settle"), { continue: true });
	assert.equal(f.sent.length, 1); assert.equal(f.sent[0].options.triggerTurn, false);
	f.emit("agent_settled", { aborted: false }); assert.equal(f.sent.length, 1);
});

test("late settlement flush wakes only once for multiple notification results", () => {
	const f = fixture(), a = f.child("agent#1"), b = f.child("agent#2");
	const one = f.wait(["agent#1"], {}, 1000, "one"), two = f.wait(["agent#2"], {}, 1000, "two");
	f.save(one, "one"); f.save(two, "two"); f.emit("turn_end");
	f.emit("agent_end"); f.emit("agent_before_settle"); a.finish(); b.finish();
	assert.equal(f.sent.length, 0); f.emit("agent_settled", { aborted: false });
	assert.deepEqual(f.sent.map(item => item.options.triggerTurn), [false, true]);
});

test("deadline above timer overflow boundary is honored and starts at registration", t => {
	const advance = clock(t), f = fixture(); f.child("agent#1");
	const receipt = f.wait(["agent#1"], {}, 2147483647 + 10);
	advance(2147483647); assert.equal(f.sent.length, 0);
	advance(10); assert.equal(f.sent.length, 0, "unconfirmed deadline cannot notify");
	f.save(receipt); f.emit("turn_end");
	assert.equal(f.payloads()[0].reason, "timeout");
});

test("notification subscription supersedes the implicit observe timeout", async t => {
	const advance = clock(t), f = fixture(); f.child("agent#1");
	const implicit = f.coordinator.observe(f.controller.signal, 10);
	f.wait(["agent#1"], {}, 1000);
	await implicit; advance(10); assert.equal(f.sent.length, 0);
	f.controller.abort();
});

test("management invalidates a completion held before its receipt persists", () => {
	const f = fixture(), a = f.child("agent#1");
	const receipt = f.wait(["agent#1"]); a.finish("must not survive restart");
	f.coordinator.change("agent#1", "restart"); f.save(receipt); f.emit("turn_end");
	const payload = f.payloads()[0];
	assert.equal(payload.reason, "target_changed"); assert.deepEqual(payload.results, []);
	assert.equal(JSON.stringify(payload).includes("must not survive restart"), false);
	assert.equal(f.pushes.length, 0);
});

test("publish during receipt snapshot is observed without a lost wakeup", () => {
	const f = fixture(), a = f.child("agent#1");
	let published = false;
	a.target.snapshot = () => {
		if (!published) { published = true; a.finish("snapshot race"); }
		return { state: "idle" };
	};
	const receipt = f.wait(["agent#1"]); f.save(receipt); f.emit("turn_end");
	assert.equal(f.payloads()[0].results[0].text, "snapshot race");
	assert.equal(f.coordinator.message(f.pushes[0]), false);
});

test("synchronous sender failure releases a claimed result to normal delivery", () => {
	const f = fixture(), a = f.child("agent#1");
	const receipt = f.wait(["agent#1"]); f.save(receipt); f.emit("turn_end");
	f.failSend(); a.finish("retry normal delivery");
	assert.equal(f.sent.length, 0); assert.equal(f.pushes.length, 1);
	assert.equal(f.pushes[0].text, "retry normal delivery");
	assert.equal(f.coordinator.message(f.pushes[0]), true);
});

test("shutdown removes the subscription and deadline", t => {
	const advance = clock(t), f = fixture(), a = f.child("agent#1");
	const receipt = f.wait(["agent#1"]); f.save(receipt); f.emit("turn_end");
	f.emit("session_shutdown"); advance(1000); a.finish();
	assert.equal(f.sent.length, 0); assert.equal(f.pushes.length, 1);
});

test("replacement ignores ID order and cancels the older notification deadline", t => {
	const advance = clock(t), f = fixture(); f.child("agent#1"); f.child("agent#2");
	const old = f.wait(["agent#1", "agent#2"], {}, 100, "old"); f.save(old, "old"); f.emit("turn_end");
	const next = f.wait(["agent#2", "agent#1"], {}, 200, "next"); f.save(next, "next"); f.emit("turn_end");
	advance(100); assert.equal(f.sent.length, 0);
	advance(100); assert.equal(f.sent.length, 1);
	assert.equal(f.payloads()[0].wait_id, next.details.wait_id);
	assert.equal(f.payloads()[0].reason, "timeout");
	advance(200); assert.equal(f.sent.length, 1);
});

for (const until of ["first", "all"] as const) {
	test(`replacement transfers old all holds into new ${until} without normal push`, t => {
		const advance = clock(t), f = fixture(), a = f.child("agent#1"), b = f.child("agent#2");
		const old = f.wait(["agent#1", "agent#2"], { until: "all" }, 100, "old");
		f.save(old, "old"); f.emit("turn_end"); a.finish("held");
		const next = f.wait(["agent#2", "agent#1"], { until }, 200, "next");
		assert.equal(next.terminate, true); assert.equal(f.pushes.length, 0); assert.equal(f.sent.length, 0);
		if (until === "all") b.finish("second");
		f.save(next, "next"); f.emit("turn_end");
		assert.equal(f.sent.length, 1); assert.equal(f.pushes.length, 0);
		const payload = f.payloads()[0];
		assert.equal(payload.wait_id, next.details.wait_id);
		assert.deepEqual(payload.results.map((r: any) => r.text).sort(), until === "all" ? ["held", "second"] : ["held"]);
		advance(300); assert.equal(f.sent.length, 1);
		if (until === "first") { assert.equal(b.target.active(), true); b.finish("later"); assert.equal(f.pushes.length, 1); }
	});
}

test("blocking replacement registers before releasing old all holds", async t => {
	const advance = clock(t), f = fixture(), a = f.child("agent#1"), b = f.child("agent#2");
	const old = f.wait(["agent#1", "agent#2"], { until: "all" }, 100, "old");
	f.save(old, "old"); f.emit("turn_end"); a.finish("held");
	let resolved = false;
	const next = f.coordinator.wait(["agent#2", "agent#1"], 200, new AbortController().signal, "blocking", { until: "all" })
		.then(value => { resolved = true; return value; });
	advance(100); await Promise.resolve();
	assert.equal(resolved, false); assert.equal(f.sent.length, 0); assert.equal(f.pushes.length, 0);
	b.finish("second"); const result = await next;
	assert.deepEqual((result.details.results as any[]).map(r => r.text).sort(), ["held", "second"]);
	f.save(result, "blocking"); f.emit("turn_end"); advance(200);
	assert.equal(f.sent.length, 0); assert.equal(f.pushes.length, 0);
});

test("immediate receipt replacement still cancels the older same-target notification", t => {
	const advance = clock(t), f = fixture(), a = f.child("agent#1"), b = f.child("agent#2");
	a.finish("delivered"); assert.equal(f.coordinator.message(f.pushes[0]), true);
	const old = f.wait(["agent#1", "agent#2"], { until: "all" }, 100, "old"); f.save(old, "old"); f.emit("turn_end");
	const receipt = f.wait(["agent#2", "agent#1"], {}, 200, "next");
	assert.equal(receipt.details.reason, "receipt"); assert.equal(receipt.terminate, undefined);
	advance(200); assert.equal(f.sent.length, 0);
	b.finish("later"); assert.equal(f.pushes.length, 2);
});

test("immediate idle replacement cancels an obsolete deadline", t => {
	const advance = clock(t), f = fixture(), a = f.child("agent#1");
	const old = f.wait(["agent#1"], {}, 100, "old"); f.save(old, "old"); f.emit("turn_end");
	a.target.active = () => false;
	assert.equal(f.wait(["agent#1"]).details.reason, "idle");
	advance(1000); assert.equal(f.sent.length, 0);
});

test("different overlapping target sets retain independent notifications", t => {
	const advance = clock(t), f = fixture(); f.child("agent#1"); f.child("agent#2");
	const both = f.wait(["agent#1", "agent#2"], {}, 100, "both"); f.save(both, "both"); f.emit("turn_end");
	const one = f.wait(["agent#1"], {}, 200, "one"); f.save(one, "one"); f.emit("turn_end");
	advance(100); assert.deepEqual(f.payloads().map(p => p.wait_id), [both.details.wait_id]);
	advance(100); assert.deepEqual(f.payloads().map(p => p.wait_id), [both.details.wait_id, one.details.wait_id]);
});

test("failed receipt snapshot releases holds without registering a subscription", () => {
	const f = fixture(), a = f.child("agent#1"), b = f.child("agent#2");
	a.finish("partial"); b.target.snapshot = () => { throw new Error("snapshot failed"); };
	assert.throws(() => f.wait(["agent#1", "agent#2"], { until: "all" }), /snapshot failed/);
	assert.equal(f.pushes.length, 2, "the previously offered result is offered again after a failed claim");
	assert.equal(f.coordinator.message(f.pushes[0]), true); assert.equal(f.coordinator.message(f.pushes[1]), false);
	f.controller.abort();
});
