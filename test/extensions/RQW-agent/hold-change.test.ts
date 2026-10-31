import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Coordinator } from "../../../extensions/RQW-agent/coordinator.ts";

function fixture(t: TestContext, options: { busy?: boolean; failSend?: boolean } = {}) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	t.mock.method(performance, "now", () => 0);
	const hooks = new Map<string, ((event: any, context: any) => unknown)[]>();
	const branch: any[] = [];
	const context = { isIdle: () => !options.busy, sessionManager: { getBranch: () => branch, getSessionFile: () => undefined }, signal: new AbortController().signal };
	const pi = { on(name: string, hook: any) { hooks.set(name, [...hooks.get(name) ?? [], hook]); } };
	const coordinator = new Coordinator(pi as never, () => { if (options.failSend) throw new Error("send failed"); });
	const changes: boolean[] = [];
	coordinator.onHoldChange = () => changes.push(coordinator.holdsFollowUps(false));
	const emit = (name: string, event: any = {}) => {
		let result: unknown;
		for (const hook of hooks.get(name) ?? []) result = hook(event, context);
		return result;
	};
	let live = true;
	const target = { id: "agent#1", run: "run", active: () => live, snapshot: () => ({ state: live ? "running" : "idle" }) };
	coordinator.add(target);
	return { coordinator, branch, changes, emit, finish: () => { live = false; coordinator.publish(target.id, target.run, "answer", "completed", () => {}); } };
}

/** An accepted wait whose receipt is saved, with one unanswered notification once the child finishes while busy. */
function unanswered(t: TestContext) {
	const f = fixture(t, { busy: true });
	f.emit("before_agent_start");
	const receipt = f.coordinator.notificationWait(["agent#1"], 100, new AbortController().signal, "call");
	f.branch.push({ type: "message", message: { role: "toolResult", toolCallId: "call", isError: false, content: receipt.content } });
	f.emit("turn_end");
	f.finish();
	f.changes.length = 0;
	return { f, receipt };
}

test("a wait aborted before its receipt is saved reports a hold change", t => {
	const f = fixture(t);
	const controller = new AbortController();
	f.coordinator.notificationWait(["agent#1"], 100, controller.signal, "call");
	assert.equal(f.coordinator.holdsFollowUps(false), true);
	f.changes.length = 0;
	controller.abort();
	assert.deepEqual(f.changes, [false]);
});

test("stopping the background reports a hold change when only a notification was unanswered", t => {
	const { f } = unanswered(t);
	assert.equal(f.coordinator.holdsFollowUps(false), true);
	f.coordinator.stopBackground();
	assert.deepEqual(f.changes, [false]);
});

test("a session tree switch clears unanswered notifications and reports it", t => {
	const { f } = unanswered(t);
	f.emit("session_tree");
	assert.deepEqual(f.changes, [false]);
});

test("an unanswered notification seen by a later answer reports that it is no longer held", t => {
	const { f, receipt } = unanswered(t);
	f.branch.push(
		{ type: "custom_message", customType: "child_wait", details: { wait_id: receipt.details.wait_id } },
		{ type: "message", message: { role: "assistant", content: "seen" } },
	);
	f.emit("agent_before_settle");
	assert.equal(f.changes.at(-1), false);
});

test("settlement reports a hold change after an abort", t => {
	const f = fixture(t);
	f.coordinator.settleCore({ isIdle: () => true, sessionManager: { getBranch: () => [] } } as never, true);
	assert.equal(f.changes.at(-1), false);
});

test("a notification that cannot be sent releases the hold again", t => {
	const f = fixture(t, { busy: true, failSend: true });
	f.emit("before_agent_start");
	const receipt = f.coordinator.notificationWait(["agent#1"], 100, new AbortController().signal, "call");
	f.branch.push({ type: "message", message: { role: "toolResult", toolCallId: "call", isError: false, content: receipt.content } });
	f.emit("turn_end");
	f.changes.length = 0;
	f.finish();
	// The wait closes first, then the failed send removes the unanswered mark: two reports, both released.
	assert.deepEqual(f.changes, [false, false]);
});
