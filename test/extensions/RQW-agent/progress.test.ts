import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fauxAssistantMessage as answer, fauxProvider, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { CONTEXT_FORK, PROGRESS_SKILL_PATH, ProgressReports, type ContextForkRequest } from "../../../extensions/RQW-agent/progress.ts";
import { Coordinator } from "../../../extensions/RQW-agent/coordinator.ts";

const model = fauxProvider({ provider: "progress", models: [{ id: "m" }] }).getModel("m");
const tool = (count = 1) => answer(Array.from({ length: count }, (_, i) => ({ type: "toolCall" as const, id: `call-${i}`, name: "codemode", arguments: { code: "nested tools do not count" } })), { stopReason: "toolUse" });
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup(id = "agent#1", delivered = true) {
	const events = createEventBus();
	const requests: ContextForkRequest[] = [];
	const completions: ReturnType<typeof Promise.withResolvers<AssistantMessage>>[] = [];
	const notices: { message: any; current(): boolean; delivered(): void }[] = [];
	let calls = 0;
	events.on(CONTEXT_FORK, data => {
		const request = data as ContextForkRequest;
		requests.push(request);
		const completion = Promise.withResolvers<AssistantMessage>();
		completions.push(completion);
		request.offer(() => { calls++; return completion.promise; });
	});
	const progress = new ProgressReports(events, id, `session-${id}`, (message, current, done) => {
		notices.push({ message, current, delivered: done });
		if (delivered) done();
	});
	const context: Context = { messages: [{ role: "system", content: "EXACT", sections: { rules: "rules" }, toolsAdded: [{ name: "codemode", description: "tools", parameters: {} as never }], timestamp: 1 }, { role: "user", content: "task", timestamp: 2 }] };
	progress.capture(model, context);
	const steps = (count: number, response = tool()) => { for (let i = 0; i < count; i++) progress.response(response, "low"); };
	return { events, requests, completions, notices, progress, context, steps, calls: () => calls };
}

test("50 nonfinal assistant responses count once each, not tools, text, errors or final tool calls", async () => {
	const f = setup();
	f.steps(49, tool(4));
	for (const stopReason of ["stop", "error", "length", "aborted"] as const) f.progress.response({ ...tool(8), stopReason }, "low");
	f.steps(10, answer("intermediate text", { stopReason: "toolUse" }));
	assert.equal(f.progress.steps, 49);
	assert.equal(f.requests.length, 0);
	f.steps(1, tool(6));
	assert.equal(f.progress.steps, 50);
	assert.equal(f.requests.length, 1, "offer captures synchronously at message_end, before any tool execution");
	assert.equal(f.calls(), 0, "inference is outside the event hook");
	await drain();
	assert.equal(f.calls(), 1);
	f.steps(100);
	assert.equal(f.requests.length, 1, "ongoing turns neither cancel nor duplicate an active summary");
	assert.equal(f.requests[0].signal.aborted, false);
	f.completions[0].resolve(answer("created files")); await drain();
	assert.equal(f.notices.length, 1); assert.equal(f.progress.steps, 0);
	f.steps(49); assert.equal(f.requests.length, 1);
	f.steps(1); assert.equal(f.requests.length, 2);
	f.progress.invalidate();
});

test("snapshot preserves system/tools and uses complete context plus textual latest intent, with no child writes", async () => {
	const f = setup(); const before = structuredClone(f.context);
	f.steps(50);
	const request = f.requests[0];
	assert.equal(request.sessionId, "session-agent#1"); assert.equal(request.model, model); assert.equal(request.reasoning, "low");
	assert.deepEqual(request.context.messages.slice(0, -1), before.messages);
	assert.match(String(request.context.messages.at(-1)!.content), /Latest response.*\n.*toolCall/s);
	assert.equal(request.context.messages.some(m => m.role === "assistant"), false, "no unmatched tool-call message is put on the wire");
	assert.deepEqual(f.context, before);
	f.context.messages[0].content = "CHANGED AFTER CAPTURE";
	assert.deepEqual(request.context.messages[0], before.messages[0]);
	f.completions[0].resolve(answer([ { type: "text", text: "summary" }, { type: "toolCall", id: "never-run", name: "bash", arguments: {} } ]));
	await drain();
	assert.match(f.notices[0].message.content, /summary/);
	assert.equal(f.context.messages.length, before.messages.length, "summary and instruction never enter the child context");
});

test("unavailable request effort stays absent instead of inheriting the selected effort", () => {
	const f = setup();
	for (let i = 0; i < 50; i++) f.progress.response(tool(), undefined);
	assert.equal(f.requests.length, 1);
	assert.equal(f.requests[0].reasoning, undefined);
	f.progress.invalidate();
});

test("notification provenance, continuation and fixed scope/brief check include the actual discovered skill", async () => {
	const f = setup(); f.steps(50); f.completions[0].resolve(answer("what happened")); await drain();
	const message = f.notices[0].message;
	assert.equal(message.customType, "agent_progress"); assert.notEqual(message.customType, "agent");
	assert.match(message.content, /^\[notification\] agent#1 has worked 50 tool-call steps without communication\./);
	assert.match(message.content, /The agent continues working\./);
	const wording = "Check whether this child has drifted outside its task and still follows the plan in its brief. Decide whether to send a correction.";
	assert.equal(message.content.split(wording).length - 1, 2, "fixed notification text and skill both carry the scope/plan check");
	assert.ok(message.content.includes(readFileSync(PROGRESS_SKILL_PATH, "utf8").trim()));
	assert.equal("outcome" in message.details, false); assert.equal("run" in message.details, false);
	assert.deepEqual(message.details, { id: "agent#1", steps: 50, continues: true });
});

test("successful send resets count and drops a summary even when its provider ignores abort", async () => {
	const f = setup(); f.steps(50); await drain();
	f.progress.reset();
	assert.equal(f.progress.steps, 0); assert.equal(f.requests[0].signal.aborted, true);
	f.completions[0].resolve(answer("stale")); await drain(); assert.equal(f.notices.length, 0);
	f.steps(49); assert.equal(f.requests.length, 1); f.steps(1); assert.equal(f.requests.length, 2);
	f.progress.invalidate();
});

for (const reason of ["final", "fail", "interrupt", "stop", "restart", "compaction", "model switch"] as const) {
	test(`${reason} invalidates in-flight or queued report without resetting the counter`, async () => {
		for (const queued of [false, true]) {
			const f = setup("agent#1", false); f.steps(50); await drain();
			if (queued) { f.completions[0].resolve(answer("queued")); await drain(); assert.equal(f.notices[0].current(), true); }
			if (reason === "model switch") f.progress.capture({ ...model, id: "other" }, f.context);
			else f.progress.invalidate();
			assert.equal(f.requests[0].signal.aborted, true); assert.equal(f.progress.steps, 50);
			if (!queued) { f.completions[0].resolve(answer("stale")); await drain(); assert.equal(f.notices.length, 0); }
			else assert.equal(f.notices[0].current(), false);
			if (reason === "compaction" || reason === "model switch") {
				f.steps(49); assert.equal(f.requests.length, 1);
				f.steps(1); assert.equal(f.requests.length, 2, "next complete 50-step block is a legitimate new trigger");
				f.progress.invalidate();
			}
		}
	});
}

for (const outcome of ["error", "timeout", "no-cache"] as const) {
	test(`${outcome} never retries on each turn and never changes child progress`, async () => {
		const f = setup();
		if (outcome === "no-cache") {
			// Another bus has no offering provider at all.
			const requests: unknown[] = []; const events = createEventBus(); events.on(CONTEXT_FORK, request => requests.push(request));
			const p = new ProgressReports(events, "agent#1", "child", () => assert.fail("no fallback")); p.capture(model, f.context);
			for (let i = 0; i < 99; i++) p.response(tool(), "low");
			assert.equal(requests.length, 1); assert.equal(p.steps, 99);
			p.response(tool(), "low"); assert.equal(requests.length, 2); return;
		}
		f.steps(50); await drain(); f.completions[0].reject(new Error(outcome)); await drain();
		f.steps(49); assert.equal(f.requests.length, 1); assert.equal(f.progress.steps, 99); assert.equal(f.notices.length, 0);
		f.steps(1); assert.equal(f.requests.length, 2); f.progress.invalidate();
	});
}

test("several simultaneous children have independent counters, snapshots and cancellation", async () => {
	const children = [setup("agent#1"), setup("agent#2"), setup("agent#3")];
	for (const f of children) f.steps(50);
	children[1].progress.reset();
	for (const f of children) f.completions[0].resolve(answer("parallel summary"));
	await drain();
	assert.deepEqual(children.map(f => f.notices.length), [1, 0, 1]);
	assert.deepEqual(children.map(f => f.requests[0].sessionId), ["session-agent#1", "session-agent#2", "session-agent#3"]);
});

function broker() {
	const hooks = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	const sent: { message: any; options: any }[] = [];
	const pi = { on: (name: string, hook: any) => { hooks.set(name, [...hooks.get(name) ?? [], hook]); }, sendMessage: (message: any, options: any) => sent.push({ message, options }) };
	const coordinator = new Coordinator(pi as never);
	const ctx = { sessionManager: { getBranch: () => [] } };
	const emit = (name: string, event = {}, context = ctx) => { let result: unknown; for (const hook of hooks.get(name) ?? []) result = hook(event, context); return result; };
	return { coordinator, sent, emit, ctx };
}

for (const state of ["idle", "busy", "settling", "aborted"] as const) {
	test(`parent ${state}: progress uses notification settlement, not final-result ownership or wait completion`, async () => {
		const b = broker(); const f = setup("agent#1", false);
		b.coordinator.add({ id: "agent#1", run: "run", active: () => true, snapshot: () => ({ state: "running" }) });
		const controller = new AbortController(); let finished = false;
		const wait = b.coordinator.wait(["agent#1"], 10000, controller.signal, "wait").then(() => { finished = true; }, () => {});
		if (state === "busy") b.emit("agent_start");
		if (state === "settling" || state === "aborted") b.emit("agent_end", {}, state === "aborted" ? { ...b.ctx, signal: AbortSignal.abort() } as any : b.ctx);
		f.steps(50); f.completions[0].resolve(answer("progress")); await drain();
		const notice = f.notices[0]; b.coordinator.notification(notice.message, notice.current, notice.delivered);
		if (state === "settling" || state === "aborted") {
			assert.equal(b.sent.length, 0); assert.equal(f.progress.steps, 50);
			assert.deepEqual(b.emit("agent_before_settle"), state === "settling" ? { continue: true } : undefined);
		}
		assert.equal(b.sent.length, 1); assert.equal(f.progress.steps, 0); assert.equal(finished, false);
		assert.equal(b.sent[0].options.triggerTurn, state === "idle" || state === "busy");
		b.emit("agent_settled", { aborted: state === "aborted" }); assert.equal(b.sent.length, 1);
		controller.abort(); await wait;
	});
}

test("queued report is dropped before final, while a report delivered before final stays exactly once", async () => {
	for (const beforeFinal of [false, true]) {
		const b = broker(); const f = setup("agent#1", false);
		if (!beforeFinal) b.emit("agent_end");
		f.steps(50); f.completions[0].resolve(answer("report")); await drain();
		const notice = f.notices[0]; b.coordinator.notification(notice.message, notice.current, notice.delivered);
		f.progress.invalidate();
		b.emit("agent_before_settle"); b.emit("agent_settled", { aborted: false });
		assert.equal(b.sent.length, beforeFinal ? 1 : 0);
	}
});

test("parent send invalidates a deferred notice before settlement and does not reset on status or wait", async () => {
	const b = broker(); const f = setup("agent#1", false); b.emit("agent_end");
	f.steps(50); f.completions[0].resolve(answer("old")); await drain();
	const notice = f.notices[0]; b.coordinator.notification(notice.message, notice.current, notice.delivered);
	b.coordinator.status(["agent#1"]);
	assert.equal(f.progress.steps, 50); assert.equal(notice.current(), true);
	f.progress.reset(); b.emit("agent_before_settle"); b.emit("agent_settled", { aborted: false });
	assert.equal(b.sent.length, 0); assert.equal(f.progress.steps, 0);
});

test("late parent-abort settlement persists one quiet deferred notice without waking the caller", async () => {
	const b = broker(); const f = setup("agent#1", false); const controller = new AbortController();
	b.emit("agent_end", {}, { ...b.ctx, signal: controller.signal } as any);
	b.emit("agent_before_settle");
	f.steps(50); f.completions[0].resolve(answer("late")); await drain();
	const notice = f.notices[0]; b.coordinator.notification(notice.message, notice.current, notice.delivered);
	controller.abort(); b.emit("agent_settled", { aborted: true });
	assert.equal(b.sent.length, 1); assert.equal(b.sent[0].options.triggerTurn, false); assert.equal(f.progress.steps, 0);
	b.emit("agent_settled", { aborted: false }); assert.equal(b.sent.length, 1);
});
