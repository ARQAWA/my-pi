// send to a running child is Pi steering: it reaches the child after its current tool call, aborts nothing, and
// an idle child still starts a new run. Real Pi sessions, faux providers, a held bash tool.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { answer, fixture, tick, texts, until } from "./audit-fixture.ts";

const bash = (id: string) => answer([fauxToolCall("bash", { command: "held" }, { id })], { stopReason: "toolUse" });
const results = (context: TranscriptContext) => context.messages.filter(m => m.role === "toolResult").map(m => JSON.stringify(m.content));

/** A bash tool whose execution waits until `release()`; `aborted()` says whether Pi aborted its signal. */
function heldBash(f: { root: string; bus: Awaited<ReturnType<typeof fixture>>["bus"] }, cooperative = false) {
	const release = Promise.withResolvers<void>();
	let entered = false, aborted = false, finished = false;
	const off = f.bus.on("rqw-tools:subagent-tools", request => request.offer((() => [{
		...createBashToolDefinition(f.root), execute: async (_id: string, _args: unknown, signal?: AbortSignal) => {
			entered = true;
			signal?.addEventListener("abort", () => { aborted = true; if (cooperative) release.resolve(); }, { once: true });
			await release.promise;
			finished = true;
			return { content: [{ type: "text", text: "TOOL_DONE" }], details: {} };
		},
	}]) as never));
	return { release: () => release.resolve(), entered: () => entered, aborted: () => aborted, finished: () => finished, off };
}

test("agent: send during a long tool call arrives in the next request after the tool result; nothing is aborted", async () => {
	const f = await fixture();
	const tool = heldBash(f);
	f.subReplies.push(bash("b1"), answer("DONE_WITH_STEER"));
	try {
		assert.equal(await f.call({ ...f.params("FIRST"), tools: ["bash"] }), "agent#1 started");
		await until(() => tool.entered(), "tool running");
		assert.equal(await f.call({ action: "send", id: "1", task: "STEER_NOW" }), "agent#1: queued after the current tool call");
		await tick();
		assert.equal(f.requests.sub.length, 1, "no request before the tool call completes");
		tool.release();
		await until(() => f.delivered().length === 1, "delivery");
		assert.equal(f.requests.sub.length, 2, "one next request, no extra run");
		assert.equal(tool.aborted(), false);
		assert.ok(tool.finished());
		const next = f.requests.sub[1];
		assert.equal(results(next).length, 1);
		assert.match(results(next)[0], /TOOL_DONE/);
		assert.deepEqual(texts(next).slice(0, 1), ["FIRST"]);
		assert.ok(texts(next).includes("STEER_NOW"));
		const order = next.messages.map(m => m.role);
		assert.ok(order.indexOf("toolResult") < order.lastIndexOf("user"), "the steering message follows the tool result");
		assert.equal(f.delivered()[0], "[agent#1] DONE_WITH_STEER");
		await tick();
		assert.equal(f.delivered().length, 1);
		assert.deepEqual(f.errors, []);
	} finally { tool.release(); tool.off(); await f.cleanup(); }
});

test("agent: send to an idle child still starts a new run with the history", async () => {
	const f = await fixture();
	f.subReplies.push(answer("ONE"), answer("TWO"));
	try {
		await f.start("FIRST");
		await until(() => f.delivered().length === 1, "first delivery");
		assert.equal(await f.call({ action: "send", id: "1", task: "SECOND" }), "agent#1: sent");
		await until(() => f.delivered().length === 2, "second delivery");
		assert.deepEqual(texts(f.requests.sub[1]), ["FIRST", "ONE", "SECOND"]);
	} finally { await f.cleanup(); }
});

test("interrupt after a steering send clears it and still aborts the run", async () => {
	const f = await fixture();
	const tool = heldBash(f);
	f.subReplies.push(bash("b1"), answer("AFTER"));
	try {
		await f.call({ ...f.params("FIRST"), tools: ["bash"] });
		await until(() => tool.entered(), "tool running");
		await f.call({ action: "send", id: "1", task: "DROPPED" });
		assert.equal(JSON.parse(await f.call({ action: "interrupt", id: "1" })).reason, "interruption_requested");
		await until(() => tool.aborted(), "tool aborted by interrupt");
		tool.release();
		await tick(60);
		assert.deepEqual(f.delivered(), []);
		await f.call({ action: "send", id: "1", task: "NEXT" });
		await until(() => f.delivered().length === 1, "delivery after interrupt");
		assert.ok(!texts(f.requests.sub.at(-1)!).includes("DROPPED"));
	} finally { tool.release(); tool.off(); await f.cleanup(); }
});

test("sibling agents: steering during a long tool call stays in the target history without aborting", async () => {
	const f = await fixture();
	let tool = heldBash(f);
	try {
		for (const id of ["agent#1", "agent#2"]) {
			const before = f.requests.sub.length;
			if (id === "agent#2") { tool.off(); tool = heldBash(f); }
			f.subReplies.push(bash(`${id}-b`), answer(`${id}_FINAL`));
			assert.equal(await f.call({ ...f.params(`${id}_TASK`), tools: ["bash"] }), `${id} started`);
			await until(() => tool.entered(), `${id} tool running`);
			assert.equal(await f.call({ action: "send", id, task: `${id}_STEER` }), `${id}: queued after the current tool call`);
			await tick();
			assert.equal(f.requests.sub.length, before + 1, "no request before the tool call completes");
			tool.release();
			await until(() => f.delivered().includes(`[${id}] ${id}_FINAL`), `${id} delivery`);
			await until(() => f.requests.sub.length === before + 2, `${id} next request`);
			assert.equal(tool.aborted(), false);
			const next = f.requests.sub[before + 1];
			assert.match(results(next)[0], /TOOL_DONE/);
			assert.ok(texts(next).includes(`${id}_STEER`));
			assert.ok(!texts(next).includes(`${id === "agent#1" ? "agent#2" : "agent#1"}_STEER`));
			await tick();
			assert.equal(f.requests.sub.length, before + 2);
			await f.call({ action: "stop", id });
			await tick();
		}
		assert.deepEqual(f.errors, []);
	} finally { tool.release(); tool.off(); await f.cleanup(); }
});

test("agent: send with interrupt aborts the held tool call, drops queued steering, then runs the new task once", async () => {
	const f = await fixture();
	const tool = heldBash(f, true);
	f.subReplies.push(bash("b1"), answer("NEW_ANSWER"));
	try {
		await f.call({ ...f.params("FIRST"), tools: ["bash"] });
		await until(() => tool.entered(), "tool running");
		await f.call({ action: "send", id: "1", task: "DROPPED_STEER" });
		assert.equal(await f.call({ action: "send", id: "1", task: "NEW_TASK", interrupt: true }), "agent#1: interrupted, sent");
		assert.ok(tool.aborted(), "the held tool call was aborted");
		await until(() => f.delivered().length === 1, "delivery of the new run");
		assert.equal(f.delivered()[0], "[agent#1] NEW_ANSWER");
		assert.equal(f.requests.sub.length, 2, "exactly one request for the new run");
		const next = texts(f.requests.sub[1]);
		assert.ok(next.includes("FIRST"), "history kept");
		assert.ok(next.includes("NEW_TASK"));
		assert.ok(!next.includes("DROPPED_STEER"), "the queued steering was dropped");
		assert.equal(next.filter(x => x === "NEW_TASK").length, 1);
		await tick(60);
		assert.equal(f.delivered().length, 1);
		assert.equal(f.requests.sub.length, 2);
		assert.deepEqual(f.errors, []);
	} finally { tool.release(); tool.off(); await f.cleanup(); }
});

test("send with interrupt on an idle child is a plain send; null means omitted", async () => {
	const f = await fixture();
	f.subReplies.push(answer("ONE"), answer("TWO"), answer("THREE"));
	try {
		await f.start("FIRST");
		await until(() => f.delivered().length === 1, "first delivery");
		assert.equal(await f.call({ action: "send", id: "1", task: "SECOND", interrupt: true }), "agent#1: sent");
		await until(() => f.delivered().length === 2, "second delivery");
		assert.deepEqual(texts(f.requests.sub[1]), ["FIRST", "ONE", "SECOND"]);
		assert.equal(await f.call({ action: "send", id: "1", task: "THIRD", interrupt: null }), "agent#1: sent");
		await until(() => f.delivered().length === 3, "third delivery");
	} finally { await f.cleanup(); }
});

test("send with interrupt returns at once; a tool that ignores the abort delays the new run, which then starts once with all pending sends in order", async () => {
	const f = await fixture();
	const tool = heldBash(f);
	f.subReplies.push(bash("b1"), answer("NEW_ANSWER"));
	try {
		await f.call({ ...f.params("FIRST"), tools: ["bash"] });
		await until(() => tool.entered(), "tool running");
		assert.equal(await f.call({ action: "send", id: "1", task: "NEW_TASK", interrupt: true }), "agent#1: interrupted, sent");
		assert.ok(tool.aborted());
		assert.equal(await f.call({ action: "send", id: "1", task: "FURTHER" }), "agent#1: sent");
		const status = JSON.parse(await f.call({ action: "status", ids: ["agent#1"] })).statuses[0];
		assert.equal(status.cancellation_requested, true);
		assert.equal(status.pending_sends, 2);
		await tick(60);
		assert.equal(f.requests.sub.length, 1, "nothing starts while the tool still runs");
		assert.deepEqual(f.delivered(), []);
		tool.release();
		await until(() => f.delivered().length === 1, "delivery of the new run");
		assert.equal(f.delivered()[0], "[agent#1] NEW_ANSWER");
		assert.equal(f.requests.sub.length, 2, "exactly one new run");
		const next = texts(f.requests.sub[1]);
		assert.ok(next.includes("FIRST"));
		assert.ok(next.includes("NEW_TASK\n\nFURTHER"), "pending sends in order, in one prompt");
		const after = JSON.parse(await f.call({ action: "status", ids: ["agent#1"] })).statuses[0];
		assert.equal(after.pending_sends, undefined);
		await tick(60);
		assert.equal(f.requests.sub.length, 2);
		assert.equal(f.delivered().length, 1);
		assert.deepEqual(f.errors, []);
	} finally { tool.release(); tool.off(); await f.cleanup(); }
});

test("wait after send with interrupt does not see an idle child before the new run; its result still arrives", async () => {
	const f = await fixture();
	const tool = heldBash(f);
	f.subReplies.push(bash("b1"), answer("NEW_ANSWER"));
	try {
		await f.call({ ...f.params("FIRST"), tools: ["bash"] });
		await until(() => tool.entered(), "tool running");
		assert.equal(await f.call({ action: "send", id: "1", task: "NEW_TASK", interrupt: true }), "agent#1: interrupted, sent");
		f.mainReplies.push(answer([fauxToolCall("agent", { action: "wait", ids: ["agent#1"], timeout_ms: 10000 })], { stopReason: "toolUse" }));
		await f.session.prompt("WAIT");
		const saved = f.session.messages.findLast(m => m.role === "toolResult" && m.toolName === "agent")!;
		const receipt = JSON.parse(saved.content.filter(c => c.type === "text").map(c => c.text).join(""));
		assert.equal(receipt.reason, "waiting", "the old run's cancellation is not an idle result");
		await tick(60);
		assert.equal(f.session.messages.some(m => m.role === "custom" && m.customType === "child_wait"), false, "no notification while the old tool still runs");
		tool.release();
		await until(() => f.session.messages.some(m => m.role === "custom" && m.customType === "child_wait"), "generation change notification");
		const message = f.session.messages.findLast(m => m.role === "custom" && m.customType === "child_wait")!;
		const first = JSON.parse(message.content as string);
		assert.notEqual(first.reason, "idle");
		assert.equal(first.reason, "target_changed", "the wait follows the new run");
		assert.equal(first.wait_id, receipt.wait_id);
		await until(() => f.delivered().includes("[agent#1] NEW_ANSWER"), "the new run's result as a message");
		const second = JSON.parse(await f.call({ action: "wait", ids: ["agent#1"], timeout_ms: 10000 }));
		assert.equal(second.reason, "receipt");
		assert.equal(second.receipts[0].delivered_via, "message");
		assert.equal(f.requests.sub.length, 2, "exactly one new run");
		assert.deepEqual(f.errors, []);
	} finally { tool.release(); tool.off(); await f.cleanup(); }
});

for (const drop of ["interrupt", "stop", "restart"] as const) {
	test(`a pending send is dropped by ${drop} before the old run has stopped`, async () => {
		const f = await fixture();
		const tool = heldBash(f);
		f.subReplies.push(bash("b1"), answer("SHOULD_NOT_RUN"));
		try {
			await f.call({ ...f.params("FIRST"), tools: ["bash"] });
			await until(() => tool.entered(), "tool running");
			assert.equal(await f.call({ action: "send", id: "1", task: "DROPPED_NEW", interrupt: true }), "agent#1: interrupted, sent");
			await f.call(drop === "restart" ? { action: "restart", id: "1" } : { action: drop, id: "1" });
			tool.release();
			await tick(80);
			assert.equal(f.requests.sub.length, 1, "the pending task never starts");
			assert.deepEqual(f.delivered(), []);
			if (drop === "interrupt") {
				assert.equal(JSON.parse(await f.call({ action: "status", ids: ["agent#1"] })).statuses[0].state, "paused");
				assert.equal(await f.call({ action: "send", id: "1", task: "LATER" }), "agent#1: sent");
				await until(() => f.delivered().length === 1, "later delivery");
				assert.ok(!texts(f.requests.sub.at(-1)!).includes("DROPPED_NEW"));
			}
		} finally { tool.release(); tool.off(); await f.cleanup(); }
	});
}

test("sibling agents: interrupting sends abort the tool, drop steering and run each new task once", async () => {
	const f = await fixture();
	let tool = heldBash(f, true);
	try {
		for (const id of ["agent#1", "agent#2"]) {
			const before = f.requests.sub.length;
			if (id === "agent#2") { tool.off(); tool = heldBash(f, true); }
			f.subReplies.push(bash(`${id}-b`), answer(`${id}_NEW_ANSWER`));
			assert.equal(await f.call({ ...f.params(`${id}_FIRST`), tools: ["bash"] }), `${id} started`);
			await until(() => tool.entered(), `${id} tool running`);
			await f.call({ action: "send", id, task: `${id}_DROPPED` });
			assert.equal(await f.call({ action: "send", id, task: `${id}_NEW`, interrupt: true }), `${id}: interrupted, sent`);
			assert.ok(tool.aborted());
			await until(() => f.delivered().includes(`[${id}] ${id}_NEW_ANSWER`), `${id} delivery`);
			assert.equal(f.requests.sub.length, before + 2, "one request for the first run, one for the new run");
			const next = texts(f.requests.sub[before + 1]);
			assert.ok(next.includes(`${id}_FIRST`) && next.includes(`${id}_NEW`));
			assert.ok(!next.includes(`${id}_DROPPED`));
			await tick(60);
			assert.equal(f.requests.sub.length, before + 2);
			await f.call({ action: "stop", id });
			await tick();
		}
		assert.deepEqual(f.errors, []);
	} finally { tool.release(); tool.off(); await f.cleanup(); }
});
