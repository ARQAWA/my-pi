import assert from "node:assert/strict";
import { test } from "node:test";
import { Activity } from "../activity.ts";

class Session {
	listeners = new Set<(event: any) => void>();
	isStreaming = false;
	messages = [];
	subscribe(listener: (event: any) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	getSessionStats() { return { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }; }
	emit(event: any) { for (const listener of this.listeners) listener(event); }
}
function setup(options = {}) {
	const session = new Session();
	let changes = 0;
	const activity = new Activity(session as never, () => { changes++; }, options);
	const alerts = () => (activity.snapshot() as any).alerts as { kind: string; at: string; detail: string }[];
	return { session, activity, alerts, changes: () => changes };
}
function clock(t: any) {
	let now = 0;
	t.mock.method(performance, "now", () => now);
	t.mock.timers.enable({ apis: ["setTimeout"] });
	return (ms: number) => { now += ms; t.mock.timers.tick(ms); };
}
function call(session: Session, id: string, name = "read", args = { path: "a" }) {
	session.emit({ type: "tool_execution_start", toolCallId: id, toolName: name, args });
	session.emit({ type: "tool_execution_end", toolCallId: id, toolName: name, isError: false, result: {} });
}

test("provider errors notify immediately; runtime reporting deduplicates the same final error", () => {
	const f = setup();
	f.activity.startRun();
	const before = f.changes();
	f.session.emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "provider failed" } });
	assert.equal(f.activity.alertVersion(), 1);
	assert.ok(f.changes() > before);
	assert.deepEqual(f.alerts().map(a => [a.kind, a.detail]), [["error", "provider failed"]]);
	f.activity.reportError("provider failed");
	assert.equal(f.activity.alertVersion(), 1);
	f.activity.reportError("prompt threw");
	assert.equal(f.activity.alertVersion(), 2);
	// A new failed provider attempt is a new event even with identical error prose.
	f.session.emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "prompt threw" } });
	assert.equal(f.activity.alertVersion(), 3);
	f.activity.close();
});

test("compaction failure and final logical failure produce alerts, not cancellation errors", () => {
	const f = setup();
	f.session.emit({ type: "compaction_end", aborted: false, errorMessage: "summary failed" });
	f.session.emit({ type: "compaction_end", aborted: true, errorMessage: "cancelled" });
	assert.deepEqual(f.alerts().map(a => a.detail), ["summary failed"]);
	f.activity.startRun();
	f.activity.endRun("error");
	assert.deepEqual(f.alerts().map(a => a.kind), ["error"]);
	f.activity.startRun();
	f.session.emit({ type: "message_end", message: { role: "assistant", stopReason: "length" } });
	assert.deepEqual(f.alerts().map(a => a.kind), ["error"]);
	assert.match(f.alerts()[0].detail, /Response was truncated/);
	f.activity.close();
});

test("repetition alerts cross the existing two-call threshold without repeated wakeups", () => {
	const f = setup();
	f.activity.startRun();
	call(f.session, "a");
	assert.deepEqual(f.alerts(), []);
	call(f.session, "b");
	assert.deepEqual(f.alerts().map(a => a.kind), ["repetition"]);
	call(f.session, "c");
	assert.equal(f.alerts().length, 1);
	f.activity.startRun();
	assert.deepEqual(f.alerts(), []);
	assert.equal(f.activity.alertVersion(), 1, "checkpoints remain monotonic across run resets");
	call(f.session, "fresh");
	assert.deepEqual(f.alerts(), []);
	f.activity.close();
});

test("live argument repetition notifies once per stream and retains the existing hint", () => {
	const f = setup();
	const partial = { role: "assistant", content: [{ type: "toolCall", id: "s", name: "write", arguments: {} }] };
	f.session.emit({ type: "message_start", message: partial });
	for (let n = 0; n < 5; n++) f.session.emit({ type: "message_update", message: partial,
		assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: "1234567890abcdef", partial } });
	assert.deepEqual(f.alerts().map(a => a.kind), ["repetition"]);
	assert.notEqual((f.activity.snapshot() as any).repetition_hint, null);
	f.activity.close();
});

test("exact Pi schema/format failures count by diagnostic, not received arguments or execution errors", () => {
	const f = setup();
	const end = (id: string, text: string, durationMs?: number) => f.session.emit({ type: "tool_execution_end", toolCallId: id,
		toolName: "submit", isError: true, result: { content: [{ type: "text", text }] }, durationMs });
	const diagnostic = 'Validation failed for tool "submit":\n  - /value: Expected number';
	end("1", diagnostic + '\n\nReceived arguments:\n{"value":"a"}');
	assert.deepEqual(f.alerts(), []);
	end("2", diagnostic + '\n\nReceived arguments:\n{"value":"b"}');
	end("3", diagnostic + '\n\nReceived arguments:\n{"value":"c"}');
	assert.deepEqual(f.alerts().map(a => [a.kind, a.detail]), [["schema_rejection_repeated", diagnostic]]);
	end("4", 'Invalid arguments for tool "submit": Invalid JSON');
	end("5", 'Invalid arguments for tool "submit": Invalid JSON');
	assert.equal(f.alerts().length, 2);
	end("6", 'Invalid arguments for tool "submit": Tool threw', 0);
	end("7", 'Invalid arguments for tool "submit": Tool threw', 0);
	end("8", "Tool execution was blocked");
	end("9", "Tool execution was blocked");
	assert.equal(f.alerts().length, 2, "ordinary tool errors are not schema failures");
	f.activity.close();
});

test("long turn is opt-in, fires once, and no idle or post-close timer remains", t => {
	const advance = clock(t);
	const off = setup();
	off.session.emit({ type: "turn_start" }); advance(1000);
	assert.deepEqual(off.alerts(), []);
	off.activity.close();
	const f = setup({ alert_after_ms: 100 });
	f.activity.startRun(); advance(1000);
	assert.deepEqual(f.alerts(), [], "preflight is not an active turn");
	f.session.emit({ type: "turn_start" }); advance(99);
	assert.deepEqual(f.alerts(), []);
	advance(1);
	assert.deepEqual(f.alerts().map(a => a.kind), ["long_turn"]);
	advance(500);
	assert.equal(f.alerts().length, 1);
	f.session.emit({ type: "turn_end" }); advance(1000);
	assert.equal(f.alerts().length, 1);
	f.session.emit({ type: "turn_start" }); advance(50);
	f.session.emit({ type: "turn_end" }); advance(100);
	assert.equal(f.alerts().length, 1);
	f.session.emit({ type: "turn_start" });
	f.activity.close(); advance(1000);
	assert.equal(f.alerts().length, 1);
});

test("endRun and native settlement cancel the active-turn timer; threshold rejects invalid values", t => {
	const advance = clock(t);
	for (const boundary of ["agent_end", "agent_settled", "endRun"]) {
		const f = setup({ alert_after_ms: 100 });
		f.session.emit({ type: "turn_start" });
		if (boundary === "endRun") f.activity.endRun("interrupted");
		else f.session.emit({ type: boundary });
		advance(100);
		assert.deepEqual(f.alerts(), []);
		f.activity.close();
	}
	for (const alert_after_ms of [0, -1, 0.5, Infinity, NaN, 2 ** 53])
		assert.throws(() => setup({ alert_after_ms }), /alert_after_ms must be a positive finite safe integer/);
});

test("alert history is bounded and copied while checkpoints preserve every new event", () => {
	const f = setup();
	for (let i = 0; i < 40; i++) f.activity.reportError(`${i}: ${"x".repeat(500)}`);
	assert.equal(f.activity.alertVersion(), 40);
	assert.equal(f.alerts().length, 32);
	assert.equal(f.alerts()[0].detail.length, 300);
	assert.equal(Number.isNaN(Date.parse(f.alerts()[0].at)), false);
	const copy = f.alerts(); copy[0].detail = "mutated";
	assert.notEqual(f.alerts()[0].detail, "mutated");
	f.activity.close();
});
