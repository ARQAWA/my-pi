// Standalone Coordinator checks: a fake ExtensionAPI captures hooks and sendMessage, targets are closures.
// Timeouts use a virtual clock (performance.now + mocked setTimeout), so no test waits for real minutes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Coordinator, DEFAULT_WAIT_MS, messageCount, targetIds, waitTimeout } from "../coordinator.ts";

type Hook = (event: any, ctx?: any) => unknown;

function fakePi() {
	const hooks = new Map<string, Hook[]>();
	const sent: { message: any; options: any }[] = [];
	return {
		sent,
		on(name: string, handler: Hook) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
		sendMessage(message: any, options?: any) { sent.push({ message, options }); },
		emit(name: string, event: any = {}, ctx?: any) { let last: unknown; for (const handler of hooks.get(name) ?? []) last = handler(event, ctx); return last; },
	};
}

function target(id: string, run = "r1", active = true) {
	let live = active;
	return {
		id,
		run,
		active: () => live,
		snapshot: () => ({ state: live ? "running" : "idle" }),
		finish() { live = false; },
	};
}

function session() {
	const pi = fakePi();
	const coord = new Coordinator(pi as never);
	const branch: any[] = [];
	const ctx = { sessionManager: { getBranch: () => branch } };
	const pushes: any[] = [];
	const push = (result: any) => { pushes.push(result); };
	return { pi, coord, branch, ctx, pushes, push };
}

const toolResult = (toolCallId: string, text: string, isError = false) => ({
	type: "message",
	message: { role: "toolResult", toolCallId, isError, content: [{ type: "text", text }] },
});

const flush = () => new Promise(resolve => setImmediate(resolve));
const signal = () => new AbortController().signal;

/** Virtual clock: performance.now and setTimeout move together, so long deadlines cost no real time. */
function virtualClock(t: { mock: any }) {
	let now = 0;
	t.mock.method(performance, "now", () => now);
	t.mock.timers.enable({ apis: ["setTimeout"] });
	return {
		advance(ms: number) { now += ms; t.mock.timers.tick(ms); },
	};
}

describe("coordinator validation", () => {
	it("omitted or null timeout is the 300000 ms default", () => {
		assert.equal(DEFAULT_WAIT_MS, 300000);
		assert.equal(waitTimeout(), 300000);
		assert.equal(waitTimeout(undefined), 300000);
		assert.equal(waitTimeout(null), 300000);
	});

	it("shorter and longer valid timeouts are not clamped", () => {
		for (const value of [1, 1000, 240000, 300001, 600000, 3600000, 2147483647, 2147483648, Number.MAX_SAFE_INTEGER])
			assert.equal(waitTimeout(value), value);
	});

	it("invalid timeouts are rejected", () => {
		for (const value of [0, -1, 1.5, NaN, Infinity, -Infinity, 2 ** 53, "1000"])
			assert.throws(() => waitTimeout(value as never), /timeout_ms must be a positive finite safe integer/);
	});

	it("ids must be nonempty full child IDs and are deduplicated", () => {
		assert.deepEqual(targetIds(["agent#1", "code_writer#2", "agent#1", "shell_runner#10"]), ["agent#1", "code_writer#2", "shell_runner#10"]);
		for (const value of [[], "agent#1", undefined, [1], ["agent"], ["agent#0"], ["agent#01"], ["worker#1"], ["agent#1", ""]])
			assert.throws(() => targetIds(value as never), /ids must be a nonempty array of full child IDs/);
	});

	it("messages defaults to 8 and accepts only integers from 5 to 10", () => {
		assert.equal(messageCount(), 8);
		assert.equal(messageCount(null), 8);
		for (const value of [5, 7, 10]) assert.equal(messageCount(value), value);
		for (const value of [4, 11, 5.5, 0, "6"])
			assert.throws(() => messageCount(value as never), /messages must be an integer from 5 to 10/);
	});
});

describe("coordinator wait", () => {
	it("first result among mixed IDs is reserved for the wait, not sent as a message", async () => {
		const { pi, coord, pushes, push } = session();
		coord.add(target("agent#1"));
		coord.add(target("code_writer#1"));
		const pending = coord.wait(["agent#1", "code_writer#1"], 10000, signal(), "outer#1");
		coord.publish("code_writer#1", "r1", "done", "ok", push);
		const { details } = await pending;
		assert.equal(details.reason, "result");
		assert.equal(details.timed_out, false);
		assert.equal(details.results.length, 1);
		assert.equal(details.results[0].id, "code_writer#1");
		assert.equal(details.results[0].text, "done");
		assert.equal(pushes.length, 0);
		assert.equal(pi.sent.length, 0);
	});

	it("a result for an unrelated ID does not release the wait", async () => {
		const { coord, pushes, push } = session();
		coord.add(target("agent#1"));
		coord.add(target("code_writer#1"));
		let settled = false;
		const pending = coord.wait(["agent#1"], 10000, signal(), "outer#1").then(r => { settled = true; return r; });
		coord.publish("code_writer#1", "r1", "other", "ok", push);
		await flush();
		assert.equal(settled, false);
		assert.equal(pushes.length, 1, "unrelated result keeps its normal message path");
		coord.publish("agent#1", "r1", "mine", "ok", push);
		const { details } = await pending;
		assert.equal(details.reason, "result");
		assert.equal(details.results[0].id, "agent#1");
		assert.equal(pushes.length, 1);
	});

	it("timeout returns the status of every selected child and stops nothing", async (t) => {
		const clock = virtualClock(t);
		const { coord, pushes, push } = session();
		const agent = target("agent#1");
		const writer = target("code_writer#1");
		coord.add(agent);
		coord.add(writer);
		const pending = coord.wait(["agent#1", "code_writer#1"], 1000, signal(), "outer#1");
		clock.advance(999);
		await flush();
		clock.advance(1);
		const { details } = await pending;
		assert.equal(details.reason, "timeout");
		assert.equal(details.timed_out, true);
		assert.deepEqual(details.results, []);
		assert.deepEqual(details.statuses.map((s: any) => s.id), ["agent#1", "code_writer#1"]);
		assert.ok(details.statuses.every((s: any) => s.run === "r1" && s.state === "running"));
		assert.equal(agent.active(), true);
		assert.equal(writer.active(), true);
		// The children keep working: their later result still goes through the normal path.
		coord.publish("agent#1", "r1", "late", "ok", push);
		assert.equal(pushes.length, 1);
	});

	it("large timeouts above the platform timer limit are honored by the virtual clock", async (t) => {
		const clock = virtualClock(t);
		const { coord } = session();
		coord.add(target("agent#1"));
		const timeout = 2147483647 + 5000;
		const pending = coord.wait(["agent#1"], timeout, signal(), "outer#1");
		let settled = false;
		pending.then(() => { settled = true; });
		clock.advance(2147483647);
		await flush();
		assert.equal(settled, false, "must not resolve at the timer chunk boundary");
		clock.advance(4999);
		await flush();
		assert.equal(settled, false);
		clock.advance(1);
		const { details } = await pending;
		assert.equal(details.reason, "timeout");
		assert.equal(details.timed_out, true);
	});

	it("competing waits: one receives the result, the other a receipt without a second copy", async () => {
		const { coord, pushes, push } = session();
		coord.add(target("agent#1"));
		const first = coord.wait(["agent#1"], 10000, signal(), "a#1");
		const second = coord.wait(["agent#1"], 10000, signal(), "b#1");
		coord.publish("agent#1", "r1", "once", "ok", push);
		const won = (await first).details;
		const lost = (await second).details;
		assert.equal(won.reason, "result");
		assert.equal(won.results[0].text, "once");
		assert.equal(lost.reason, "receipt");
		assert.deepEqual(lost.results, []);
		assert.equal(lost.receipts.length, 1);
		assert.equal(lost.receipts[0].delivered_via, "wait");
		assert.equal("text" in lost.receipts[0], false);
		assert.equal(pushes.length, 0);
	});

	it("a deferred pending result is claimed by a later wait, and its message path then yields nothing", async () => {
		const { coord } = session();
		coord.add(target("agent#1"));
		const deferred: any[] = [];
		coord.publish("agent#1", "r1", "deferred text", "ok", (result: any) => { deferred.push(result); });
		assert.equal(deferred.length, 1);
		const { details } = (await coord.wait(["agent#1"], 10000, signal(), "outer#1"));
		assert.equal(details.reason, "result");
		assert.equal(details.results[0].text, "deferred text");
		assert.equal(coord.message(deferred[0]), false, "claimed result must not also be sent as a message");
	});

	it("a result already sent as a message gives a receipt with no text", async () => {
		const { coord } = session();
		coord.add(target("agent#1"));
		const sent: any[] = [];
		coord.publish("agent#1", "r1", "secret-text", "ok", (result: any) => { if (coord.message(result)) sent.push(result); });
		assert.equal(sent.length, 1);
		const { details } = await coord.wait(["agent#1"], 10000, signal(), "outer#1");
		assert.equal(details.reason, "receipt");
		assert.deepEqual(details.results, []);
		assert.equal(details.receipts[0].delivered_via, "message");
		assert.equal("text" in details.receipts[0], false);
		assert.equal(JSON.stringify(details).includes("secret-text"), false);
	});

	it("unknown or inactive selected children are idle immediately", async () => {
		const { coord } = session();
		const unknown = (await coord.wait(["agent#9"], 10000, signal(), "outer#1")).details;
		assert.equal(unknown.reason, "idle");
		assert.equal(unknown.timed_out, false);
		assert.equal(unknown.statuses[0].error, "Unknown or closed child ID");
		coord.add(target("code_writer#1", "r1", false));
		const inactive = (await coord.wait(["code_writer#1"], 10000, signal(), "outer#1")).details;
		assert.equal(inactive.reason, "idle");
	});

	for (const change of ["interrupt", "stop", "restart"]) {
		it(`${change} while waiting returns target_changed with the old run`, async () => {
			const { coord, pushes, push } = session();
			coord.add(target("agent#1", "r1"));
			const pending = coord.wait(["agent#1"], 10000, signal(), "outer#1");
			coord.change("agent#1", change);
			const { details } = await pending;
			assert.equal(details.reason, "target_changed");
			assert.equal(details.timed_out, false);
			assert.deepEqual(details.changed, [{ id: "agent#1", run: "r1", change }]);
			assert.deepEqual(details.results, []);
			// The old run's late result is not delivered to anyone.
			coord.publish("agent#1", "r1", "old", "ok", push);
			assert.equal(pushes.length, 0);
		});
	}

	it("a wait holds no management queue", async () => {
		const { coord, push } = session();
		coord.add(target("agent#1"));
		const queue = coord.queue;
		const pending = coord.wait(["agent#1"], 10000, signal(), "outer#1");
		assert.equal(coord.queue, queue);
		// Management reads run while the wait is still pending.
		assert.equal(coord.status(["agent#1"])[0].run, "r1");
		coord.publish("agent#1", "r1", "ok", "ok", push);
		assert.equal((await pending).details.reason, "result");
	});
});

describe("coordinator handoff at turn end and settlement", () => {
	it("a successful persisted result carrying its handoff commits, so the next wait gets a receipt", async () => {
		const { pi, coord, branch, ctx, pushes, push } = session();
		coord.add(target("agent#1"));
		const pending = coord.wait(["agent#1"], 10000, signal(), "outer#1");
		coord.publish("agent#1", "r1", "answer", "ok", push);
		const { details } = await pending;
		branch.push(toolResult("outer#1", JSON.stringify(details.results)));
		pi.emit("turn_end", {}, ctx);
		pi.emit("agent_settled", {}, ctx);
		assert.equal(pushes.length, 0);
		const again = (await coord.wait(["agent#1"], 10000, signal(), "outer#2")).details;
		assert.equal(again.reason, "receipt");
		assert.equal(again.receipts[0].delivered_via, "wait");
		assert.equal("text" in again.receipts[0], false);
	});

	it("a successful direct result that does not carry its handoff falls back to one push", async () => {
		const { pi, coord, branch, ctx, pushes, push } = session();
		coord.add(target("agent#1"));
		const pending = coord.wait(["agent#1"], 10000, signal(), "outer#1");
		coord.publish("agent#1", "r1", "answer", "ok", push);
		await pending;
		branch.push(toolResult("outer#1", "no handoff here"));
		pi.emit("turn_end", {}, ctx);
		assert.equal(pushes.length, 1);
		pi.emit("agent_settled", {}, ctx);
		assert.equal(pushes.length, 1);
	});

	it("an isError persisted result falls back to a push exactly once", async () => {
		const { pi, coord, branch, ctx, pushes, push } = session();
		coord.add(target("agent#1"));
		const pending = coord.wait(["agent#1"], 10000, signal(), "outer#1");
		coord.publish("agent#1", "r1", "answer", "ok", push);
		const { details } = await pending;
		assert.equal(pushes.length, 0);
		branch.push(toolResult("outer#1", JSON.stringify(details.results), true));
		pi.emit("turn_end", {}, ctx);
		assert.equal(pushes.length, 1);
		assert.equal(pushes[0].id, "agent#1");
		assert.equal(pushes[0].text, "answer");
		pi.emit("agent_settled", {}, ctx);
		pi.emit("turn_end", {}, ctx);
		assert.equal(pushes.length, 1);
	});

	it("a missing persisted result waits for settlement, then falls back to exactly one push", async () => {
		const { pi, coord, ctx, pushes, push } = session();
		coord.add(target("agent#1"));
		const pending = coord.wait(["agent#1"], 10000, signal(), "outer#1");
		coord.publish("agent#1", "r1", "answer", "ok", push);
		await pending;
		pi.emit("turn_end", {}, ctx);
		assert.equal(pushes.length, 0, "turn_end without a persisted result must not push yet");
		pi.emit("agent_settled", {}, ctx);
		assert.equal(pushes.length, 1);
		pi.emit("agent_settled", {}, ctx);
		assert.equal(pushes.length, 1);
	});

	it("nested call: the real parentToolCallId link commits when the successful outer script persists, even if it filters the result", async () => {
		const { pi, coord, branch, ctx, pushes, push } = session();
		coord.add(target("agent#1"));
		pi.emit("tool_call", { toolCallId: "outer#1" }, ctx);
		pi.emit("tool_call", { toolCallId: "child#1", parentToolCallId: "outer#1" }, ctx);
		const pending = coord.wait(["agent#1"], 10000, signal(), "child#1");
		coord.publish("agent#1", "r1", "answer", "ok", push);
		assert.equal((await pending).details.reason, "result");
		pi.emit("tool_execution_end", { toolCallId: "child#1", isError: false }, ctx);
		branch.push(toolResult("outer#1", "script returned a filtered summary"));
		pi.emit("turn_end", {}, ctx);
		pi.emit("agent_settled", {}, ctx);
		assert.equal(pushes.length, 0, "successful script must not get a second automatic delivery");
		const again = (await coord.wait(["agent#1"], 10000, signal(), "outer#2")).details;
		assert.equal(again.reason, "receipt");
	});

	it("nested call: a failed outer script releases the reserved result to one push", async () => {
		const { pi, coord, branch, ctx, pushes, push } = session();
		coord.add(target("agent#1"));
		pi.emit("tool_call", { toolCallId: "outer#1" }, ctx);
		pi.emit("tool_call", { toolCallId: "child#1", parentToolCallId: "outer#1" }, ctx);
		const pending = coord.wait(["agent#1"], 10000, signal(), "child#1");
		coord.publish("agent#1", "r1", "answer", "ok", push);
		await pending;
		branch.push(toolResult("outer#1", "script failed", true));
		pi.emit("turn_end", {}, ctx);
		assert.equal(pushes.length, 1);
		assert.equal(pushes[0].text, "answer");
		pi.emit("agent_settled", {}, ctx);
		assert.equal(pushes.length, 1);
	});
});

describe("coordinator reserved results across runs", () => {
	it("a failed saved wait result at turn_end still falls back once to the old reserved answer after begin of a newer run", async () => {
		const { pi, coord, branch, ctx, pushes, push } = session();
		coord.add(target("agent#1", "r1"));
		const pending = coord.wait(["agent#1"], 10000, signal(), "outer#1");
		coord.publish("agent#1", "r1", "old answer", "ok", push);
		const { details } = await pending;
		assert.equal(pushes.length, 0);
		coord.begin(target("agent#1", "r2"));
		assert.equal(coord.status(["agent#1"])[0].run, "r2");
		branch.push(toolResult("outer#1", JSON.stringify(details.results), true));
		pi.emit("turn_end", {}, ctx);
		assert.equal(pushes.length, 1);
		const oldResult = pushes[0];
		assert.equal(oldResult.run, "r1");
		assert.equal(oldResult.text, "old answer");
		assert.equal(coord.message(oldResult), true);
		assert.equal(coord.message(oldResult), false);
		pi.emit("agent_settled", {}, ctx);
		assert.equal(pushes.length, 1);
	});

	for (const change of ["stop", "restart"]) {
		it(`${change} via change after a newer begin invalidates the older reserved run with no fallback`, async () => {
			const { pi, coord, branch, ctx, pushes, push } = session();
			coord.add(target("agent#1", "r1"));
			const pending = coord.wait(["agent#1"], 10000, signal(), "outer#1");
			coord.publish("agent#1", "r1", "old answer", "ok", push);
			const { details } = await pending;
			const oldResult = [...(coord as any).uncommitted].find((r: any) => r.run === "r1");
			assert.equal(oldResult.state, "reserved");
			coord.begin(target("agent#1", "r2"));
			coord.change("agent#1", change);
			assert.equal(oldResult.state, "wait");
			branch.push(toolResult("outer#1", JSON.stringify(details.results), true));
			pi.emit("turn_end", {}, ctx);
			pi.emit("agent_settled", {}, ctx);
			assert.equal(pushes.length, 0);
			assert.equal(coord.message(oldResult), false);
			assert.equal(pi.sent.length, 0);
		});
	}
});

describe("coordinator implicit observe", () => {
	function gatedTargets(coord: Coordinator) {
		const agent = target("agent#1");
		const writer = target("code_writer#1");
		const shell = target("shell_runner#1");
		const idle = target("code_writer#2", "r1", false);
		for (const item of [agent, writer, shell, idle]) coord.add(item);
		return { agent, writer, shell, idle };
	}

	it("observe(1000) uses one clock deadline and its diagnostic lists only the active selected IDs", async (t) => {
		const clock = virtualClock(t);
		const { pi, coord } = session();
		const { agent, writer, shell } = gatedTargets(coord);
		const observed = coord.observe(signal(), 1000);
		clock.advance(999);
		await flush();
		assert.equal(pi.sent.length, 0);
		clock.advance(1);
		await observed;
		assert.equal(pi.sent.length, 1);
		const { message, options } = pi.sent[0];
		assert.equal(message.customType, "child_wait");
		assert.equal(options.triggerTurn, true);
		const content = JSON.parse(message.content);
		assert.equal(content.reason, "timeout");
		assert.equal(content.timed_out, true);
		assert.deepEqual(content.results, []);
		assert.deepEqual(content.statuses.map((s: any) => s.id), ["agent#1", "code_writer#1", "shell_runner#1"]);
		assert.ok(content.statuses.every((s: any) => s.state === "running"));
		assert.equal(agent.active(), true);
		assert.equal(writer.active(), true);
		assert.equal(shell.active(), true);
	});

	it("observe expiring while agent_end is settling defers the diagnostic to agent_before_settle with continuation and flushes once", async (t) => {
		const clock = virtualClock(t);
		const { pi, coord, ctx } = session();
		gatedTargets(coord);
		const observed = coord.observe(signal(), 1000);
		pi.emit("agent_end", {}, { ...ctx, signal: signal() });
		clock.advance(1000);
		await observed;
		assert.equal(pi.sent.length, 0, "diagnostic is deferred while settling");
		assert.deepEqual(pi.emit("agent_before_settle", {}, ctx), { continue: true });
		assert.equal(pi.sent.length, 1);
		assert.equal(pi.sent[0].options.triggerTurn, false);
		pi.emit("agent_settled", { aborted: false }, ctx);
		assert.equal(pi.sent.length, 1, "flushed once only");
	});

	it("abort state while settling: deferred diagnostic goes out with triggerTurn false and no continue", async (t) => {
		const clock = virtualClock(t);
		const { pi, coord, ctx } = session();
		gatedTargets(coord);
		const observed = coord.observe(signal(), 1000);
		pi.emit("agent_end", {}, { ...ctx, signal: AbortSignal.abort() });
		clock.advance(1000);
		await observed;
		assert.equal(pi.sent.length, 0);
		assert.equal(pi.emit("agent_before_settle", {}, ctx), undefined);
		assert.equal(pi.sent.length, 1);
		assert.equal(pi.sent[0].options.triggerTurn, false);
		pi.emit("agent_settled", { aborted: true }, ctx);
		assert.equal(pi.sent.length, 1, "no extra wake or second copy");
	});

	it("diagnostic expiring after agent_before_settle is flushed once by agent_settled", async (t) => {
		const clock = virtualClock(t);
		const { pi, coord, ctx } = session();
		gatedTargets(coord);
		const observed = coord.observe(signal(), 1000);
		pi.emit("agent_end", {}, { ...ctx, signal: signal() });
		assert.equal(pi.emit("agent_before_settle", {}, ctx), undefined);
		clock.advance(1000);
		await observed;
		assert.equal(pi.sent.length, 0);
		pi.emit("agent_settled", { aborted: false }, ctx);
		assert.equal(pi.sent.length, 1);
		assert.equal(pi.sent[0].message.customType, "child_wait");
		assert.equal(pi.sent[0].options.triggerTurn, true);
		pi.emit("agent_settled", { aborted: false }, ctx);
		assert.equal(pi.sent.length, 1);
	});

	it("an explicit wait started during observe ends observe with no diagnostic and keeps its own 900000 ms deadline", async (t) => {
		const clock = virtualClock(t);
		const { pi, coord } = session();
		coord.add(target("agent#1"));
		const observed = coord.observe(signal(), 1000);
		let settled = false;
		const explicit = coord.wait(["agent#1"], 900000, signal(), "outer#1").then(r => { settled = true; return r; });
		await observed;
		assert.equal(pi.sent.length, 0);
		clock.advance(1000);
		await flush();
		assert.equal(pi.sent.length, 0);
		assert.equal(settled, false);
		clock.advance(898999);
		await flush();
		assert.equal(settled, false, "explicit wait must not be shortened by the implicit deadline");
		clock.advance(1);
		const { details } = await explicit;
		assert.equal(details.reason, "timeout");
		assert.equal(pi.sent.length, 0);
	});

	it("an idle retained worker with an unconsumed result waits for a native wakeup, not a resolved-Promise spin", async (t) => {
		const clock = virtualClock(t);
		const { pi, coord } = session();
		coord.add(target("code_writer#1", "r1", false));
		let finished = false;
		const observed = coord.observe(signal(), 1000, () => true).then(() => { finished = true; });
		await flush();
		assert.equal(finished, false);
		pi.emit("agent_start");
		await observed;
		clock.advance(1000);
		assert.equal(pi.sent.length, 0, "new native work cancels the hidden fallback");
	});

	it("an idle caller still owing a result turn receives bounded diagnostics if no wakeup arrives", async (t) => {
		const clock = virtualClock(t);
		const { pi, coord } = session();
		coord.add(target("code_writer#1", "r1", false));
		const observed = coord.observe(signal(), 1000, () => true);
		clock.advance(1000);
		await observed;
		assert.equal(pi.sent.length, 1);
		assert.equal(JSON.parse(pi.sent[0].message.content).statuses[0].state, "idle");
	});

	it("aborting observe rejects, clears its timer and leaves targets active", async (t) => {
		const clock = virtualClock(t);
		const { pi, coord } = session();
		const { agent } = gatedTargets(coord);
		const controller = new AbortController();
		const observed = coord.observe(controller.signal, 1000);
		controller.abort();
		await assert.rejects(observed, { name: "AbortError" });
		clock.advance(1000);
		await flush();
		assert.equal(pi.sent.length, 0);
		assert.equal(agent.active(), true);
	});

	it("aborting wait rejects, clears its timer and leaves a later result on the normal path", async (t) => {
		const clock = virtualClock(t);
		const { coord, pushes, push } = session();
		const agent = target("agent#1");
		coord.add(agent);
		const controller = new AbortController();
		const pending = coord.wait(["agent#1"], 1000, controller.signal, "outer#1");
		controller.abort();
		await assert.rejects(pending, { name: "AbortError" });
		clock.advance(1000);
		await flush();
		coord.publish("agent#1", "r1", "late", "ok", push);
		assert.equal(pushes.length, 1);
		assert.equal(pushes[0].state, "pending");
		assert.equal(agent.active(), true);
	});

	it("a wait that times out before the result does not consume the later result", async (t) => {
		const clock = virtualClock(t);
		const { coord, pushes, push } = session();
		coord.add(target("agent#1"));
		const first = coord.wait(["agent#1"], 1000, signal(), "outer#1");
		clock.advance(1000);
		assert.equal((await first).details.reason, "timeout");
		coord.publish("agent#1", "r1", "later", "ok", push);
		assert.equal(pushes.length, 1);
		assert.equal(pushes[0].state, "pending");
		const second = (await coord.wait(["agent#1"], 10000, signal(), "outer#2")).details;
		assert.equal(second.reason, "result");
		assert.equal(second.results[0].text, "later");
	});
});
