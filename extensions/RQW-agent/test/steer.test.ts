// send to a running child is Pi steering: it reaches the child after its current tool call, aborts nothing, and
// an idle child still starts a new run. Real Pi sessions, faux providers, a held bash tool.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { fauxProvider, fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { AgentSession, createBashToolDefinition } from "@earendil-works/pi-coding-agent";
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

/** Real code_writer / shell_runner children on an `anthropic` faux provider; every worker request is recorded. */
function workers(f: Awaited<ReturnType<typeof fixture>>, t: TestContext) {
	const prompt = AgentSession.prototype.prompt;
	t.mock.method(AgentSession.prototype, "prompt", function(this: AgentSession, ...args: Parameters<typeof prompt>) { return prompt.apply(this, args); });
	t.mock.method(f.session.extensionRunner.createContext().modelRegistry, "hasConfiguredAuth", () => true);
	const worker = fauxProvider({ provider: "anthropic", api: "steer-worker", models: [{ id: "claude-haiku-5-5", reasoning: true }] });
	const replies: ReturnType<typeof answer>[] = [], requests: TranscriptContext[] = [];
	worker.setResponses(Array.from({ length: 20 }, () => async (context: TranscriptContext) => {
		requests.push(structuredClone(context));
		return replies.shift() ?? answer("WORKER_OK");
	}));
	f.runtime.registerNativeProvider(worker.provider);
	const run = async (name: string, args: Record<string, unknown>) => {
		const result = await f.session.getToolDefinition(name)!.execute(`steer-${name}`, args, undefined, undefined, f.session.extensionRunner.createContext());
		return result.content.map(c => c.type === "text" ? c.text : "").join("");
	};
	return { replies, requests, run };
}

test("code_writer and shell_runner: send during a long tool call is steering, nothing aborted", async (t: TestContext) => {
	const f = await fixture();
	const { replies, requests, run } = workers(f, t);
	let tool = heldBash(f);
	try {
		for (const name of ["code_writer", "shell_runner"]) {
			const before = requests.length;
			if (name === "shell_runner") { tool.off(); tool = heldBash(f); }
			replies.push(bash(`${name}-b`), answer(`${name}_FINAL`));
			assert.equal(await run(name, { task: `${name}_TASK` }), `${name}#1 started`);
			await until(() => tool.entered(), `${name} tool running`);
			assert.equal(await run(name, { action: "send", id: `${name}#1`, task: `${name}_STEER` }), `${name}#1: queued after the current tool call`);
			await tick();
			assert.equal(requests.length, before + 1, "no request before the tool call completes");
			tool.release();
			await until(() => f.session.messages.some(m => m.role === "custom" && m.customType === name), `${name} delivery`);
			await until(() => requests.length === before + 2, `${name} next request`);
			assert.equal(tool.aborted(), false);
			const next = requests[before + 1];
			assert.match(results(next)[0], /TOOL_DONE/);
			assert.ok(texts(next).includes(`${name}_STEER`));
			await tick();
			assert.equal(requests.length, before + 2);
			await run(name, { action: "stop", id: `${name}#1` });
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
		let first: Record<string, unknown> | undefined;
		const waiting = f.call({ action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 10000 }).then(text => { first = JSON.parse(text); });
		await tick(60);
		assert.equal(first, undefined, "the wait keeps waiting while the old run stops");
		tool.release();
		await waiting;
		assert.notEqual(first!.reason, "idle");
		assert.equal(first!.reason, "target_changed", "the wait follows the new run");
		const second = JSON.parse(await f.call({ action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 10000 }));
		if (second.reason === "result") assert.equal(second.results[0].text, "NEW_ANSWER");
		else await until(() => f.delivered().includes("[agent#1] NEW_ANSWER"), "the new run's result as a message");
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

test("code_writer and shell_runner: send with interrupt aborts the held tool call, drops steering, runs the new task once", async (t: TestContext) => {
	const f = await fixture();
	const { replies, requests, run } = workers(f, t);
	let tool = heldBash(f, true);
	try {
		for (const name of ["code_writer", "shell_runner"]) {
			const before = requests.length;
			if (name === "shell_runner") { tool.off(); tool = heldBash(f, true); }
			replies.push(bash(`${name}-b`), answer(`${name}_NEW_ANSWER`));
			assert.equal(await run(name, { task: `${name}_FIRST` }), `${name}#1 started`);
			await until(() => tool.entered(), `${name} tool running`);
			await run(name, { action: "send", id: `${name}#1`, task: `${name}_DROPPED` });
			assert.equal(await run(name, { action: "send", id: `${name}#1`, task: `${name}_NEW`, interrupt: true }), `${name}#1: interrupted, sent`);
			assert.ok(tool.aborted());
			await until(() => f.session.messages.some(m => m.role === "custom" && m.customType === name && JSON.stringify(m.content).includes(`${name}_NEW_ANSWER`)), `${name} delivery`);
			assert.equal(requests.length, before + 2, "one request for the first run, one for the new run");
			const next = texts(requests[before + 1]);
			assert.ok(next.includes(`${name}_FIRST`) && next.includes(`${name}_NEW`));
			assert.ok(!next.includes(`${name}_DROPPED`));
			await tick(60);
			assert.equal(requests.length, before + 2);
			await run(name, { action: "stop", id: `${name}#1` });
			await tick();
		}
		assert.deepEqual(f.errors, []);
	} finally { tool.release(); tool.off(); await f.cleanup(); }
});
