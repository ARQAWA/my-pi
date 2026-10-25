// Extension-local real Pi sessions, faux providers and gated tools. No model/network/other extension.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { AgentSession, createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { fauxToolCall } from "@earendil-works/pi-ai";
import { answer, fixture, gate, tick, until, texts } from "./audit-fixture.ts";

async function setup(t: TestContext) {
	const f = await fixture();
	const sessions: AgentSession[] = [];
	const prompt = AgentSession.prototype.prompt;
	t.mock.method(AgentSession.prototype, "prompt", function(this: AgentSession, ...args: Parameters<typeof prompt>) {
		if (this !== f.session && !sessions.includes(this)) sessions.push(this);
		return prompt.apply(this, args);
	});
	const tool = async (args: Record<string, unknown>, signal?: AbortSignal) => f.call(args, signal);
	const status = async (ids: string[]) => JSON.parse(await tool({ action: "status", ids })).statuses;
	return { ...f, sessions, replies: f.subReplies, requests: f.requests.sub, mainRequests: f.requests.main, tool, status };
}

/** Per-instance dispose counter: calls the original, so cleanup still runs. */
function countDisposals(t: TestContext) {
	const counts = new Map<AgentSession, number>();
	const dispose = AgentSession.prototype.dispose;
	t.mock.method(AgentSession.prototype, "dispose", function(this: AgentSession) {
		counts.set(this, (counts.get(this) ?? 0) + 1);
		return dispose.call(this);
	});
	return (session: AgentSession) => counts.get(session) ?? 0;
}

test("completed agents stay retained and undisposed until stop; others until caller shutdown; each disposed exactly once", async t => {
	const f = await setup(t), disposed = countDisposals(t);
	const kept: AgentSession[] = [];
	try {
		for (const id of [1, 2]) {
			assert.equal(await f.start(`STOP_${id}`), `agent#${id} started`);
			const child = f.sessions.at(-1)!;
			await until(() => child.isIdle && f.delivered().length === id, `agent#${id} completed`);
			await f.session.waitForIdle(); await tick();
			assert.equal(disposed(child), 0, `agent#${id} retained after completion`);
			assert.equal((await f.status([`agent#${id}`]))[0].state, "idle");
			await f.tool({ action: "stop", id: `agent#${id}` });
			await until(() => disposed(child) === 1, `agent#${id} disposed by stop`);
			await tick();
			assert.equal(disposed(child), 1, "disposed exactly once");
		}
		for (const id of [3, 4]) {
			assert.equal(await f.start(`SHUTDOWN_${id}`), `agent#${id} started`);
			const child = f.sessions.at(-1)!;
			await until(() => child.isIdle && f.delivered().length === id, `agent#${id} completed`);
			await f.session.waitForIdle(); await tick();
			assert.equal(disposed(child), 0, "undisposed before caller shutdown");
			kept.push(child);
		}
		await f.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await until(() => kept.every(child => disposed(child) === 1), "caller shutdown disposes retained agents");
		await tick();
		for (const child of kept) assert.equal(disposed(child), 1, "disposed exactly once after shutdown");
	} finally { await f.cleanup(); }
});

test("gated terminal agent error is returned once by explicit wait and never copied as a custom message", async t => {
	const f = await setup(t), MARK = "AGENT_BAD_REQUEST_MARK";
	const releases: (() => void)[] = [];
	const delivered = () => f.session.messages.some(m => m.role === "custom" && JSON.stringify(m).includes(MARK));
	try {
		for (const id of [1, 2]) {
			let release!: () => void, entered = false;
			const released = new Promise<void>(resolve => { release = resolve; });
			releases.push(release);
			// A non-retryable request error exercises final error delivery, not native retry.
			f.replies.push(async () => { entered = true; await released; return answer("", { stopReason: "error", errorMessage: `400 invalid_request_error: ${MARK}` }); });
			const before = f.mainRequests.length;
			f.mainReplies.push(answer([fauxToolCall("agent", f.params("BAD_REQUEST_BRIEF"))], { stopReason: "toolUse" }),
				answer([fauxToolCall("agent", { action: "wait", blocking: true, ids: [`agent#${id}`], timeout_ms: 900000, wake_on_alert: false })], { stopReason: "toolUse" }), answer("CALLER_DONE"));
			const run = f.session.prompt("GO");
			await until(() => entered, "agent entered");
			await until(() => f.session.messages.filter(m => m.role === "assistant" && m.content.some(c => c.type === "toolCall" && c.name === "agent" && c.arguments.action === "wait")).length === id, "caller wait started");
			await tick();
			assert.equal(f.mainRequests.length, before + 2, "caller blocked in explicit wait");
			release(); await run;
			const result = f.session.messages.findLast(m => m.role === "toolResult" && m.toolName === "agent")!;
			const body = JSON.parse(result.content.filter(c => c.type === "text").map(c => c.text).join(""));
			assert.equal(body.reason, "result"); assert.equal(body.results.length, 1);
			assert.equal(body.results[0].id, `agent#${id}`); assert.equal(body.results[0].outcome, "error");
			assert.ok(body.results[0].text.includes(MARK));
			await f.session.waitForIdle(); await tick();
			assert.equal(delivered(), false, "no custom message copy");
			const again = JSON.parse(await f.tool({ action: "wait", blocking: true, ids: [`agent#${id}`], timeout_ms: 1 }));
			assert.equal(again.reason, "receipt"); assert.deepEqual(again.results, []); assert.equal(again.receipts[0].delivered_via, "wait");
			f.mainReplies.push(answer("NEXT_DONE")); await f.session.prompt("NEXT"); await f.session.waitForIdle(); await tick();
			assert.equal(delivered(), false, "no late message after next caller prompt");
			assert.equal(f.delivered().length, 0);
		}
	} finally { for (const release of releases) release(); await f.cleanup(); }
});

test("multi-agent explicit wait returns first result once, with no caller model requests during its pause", async t => {
	const f = await setup(t), first = gate("FIRST"), second = gate("SECOND"), third = gate("THIRD");
	f.replies.push(first.reply, second.reply, third.reply);
	f.mainReplies.push(answer([fauxToolCall("agent", f.params("ONE")), fauxToolCall("agent", f.params("TWO")), fauxToolCall("agent", f.params("THREE"))], { stopReason: "toolUse" }),
		answer([fauxToolCall("agent", { action: "wait", blocking: true, ids: ["agent#1", "agent#2", "agent#3"], timeout_ms: 900000 })], { stopReason: "toolUse" }), answer("GOT_FIRST"));
	try {
		const run = f.session.prompt("GO");
		await until(() => f.session.messages.some(m => m.role === "assistant" && m.content.some(c => c.type === "toolCall" && c.arguments.action === "wait")), "caller wait started");
		await tick();
		assert.equal(f.mainRequests.length, 2);
		assert.equal(second.aborted(), false); assert.equal(third.aborted(), false);
		first.release(); await run;
		assert.equal(f.mainRequests.length, 3);
		const result = f.session.messages.findLast(m => m.role === "toolResult" && m.toolName === "agent")!;
		const body = JSON.parse(result.content.filter(c => c.type === "text").map(c => c.text).join(""));
		assert.equal(body.reason, "result"); assert.equal(body.results[0].id, "agent#1"); assert.equal(body.results[0].text, "FIRST");
		assert.deepEqual(f.delivered(), []);
		const receipt = JSON.parse(await f.tool({ action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 1 }));
		assert.equal(receipt.reason, "receipt"); assert.equal(receipt.receipts[0].delivered_via, "wait"); assert.deepEqual(receipt.results, []);
	} finally { first.release(); second.release(); third.release(); await f.cleanup(); }
});

test("timeout affects only caller; repeated wait chooses a new duration, status reads history without model requests", async t => {
	const f = await setup(t), held = gate("LONG_WORK"); f.replies.push(held.reply);
	try {
		await f.start("FIRST_BRIEF"); await until(held.entered, "agent entered");
		const first = JSON.parse(await f.tool({ action: "wait", blocking: true, ids: ["agent#1", "agent#999"], timeout_ms: 1 }));
		assert.equal(first.reason, "timeout"); assert.equal(first.statuses.length, 2); assert.equal(held.aborted(), false);
		const before = f.requests.length, [snapshot] = await f.status(["agent#1"]);
		assert.ok(snapshot.messages.some((m: any) => m.text?.includes("FIRST_BRIEF")));
		assert.equal(snapshot.state, "running"); assert.equal(f.requests.length, before);
		const again = f.tool({ action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 900000 });
		await tick(); held.release(); assert.equal(JSON.parse(await again).results[0].text, "LONG_WORK");
	} finally { held.release(); await f.cleanup(); }
});

test("agent retention: send reuses history/config, start is clean, restart without task is fresh idle, stop forgets", async t => {
	const f = await setup(t);
	try {
		for (const id of [1, 3]) {
			await f.start("ORIGINAL"); await until(() => f.sessions.at(-1)?.isIdle === true, "first settled"); await tick();
			const first = f.sessions.at(-1)!;
			assert.equal(await f.tool({ action: "send", id: `agent#${id}`, task: "FOLLOWUP" }), `agent#${id}: sent`);
			await until(() => first.isIdle, "followup settled"); await tick();
			assert.equal(f.sessions.at(-1), first);
			assert.ok(texts(f.requests.at(-1)!).includes("ORIGINAL")); assert.ok(texts(f.requests.at(-1)!).includes("FOLLOWUP"));
			await f.start("UNRELATED"); await until(() => f.sessions.at(-1)?.isIdle === true, "new assignment settled"); await tick();
			assert.notEqual(f.sessions.at(-1), first); assert.ok(!texts(f.requests.at(-1)!).includes("ORIGINAL"));
			const count = f.requests.length;
			await f.tool({ action: "restart", id: `agent#${id}` }); assert.equal(f.requests.length, count);
			const [snapshot] = await f.status([`agent#${id}`]); assert.equal(snapshot.state, "idle");
			await f.tool({ action: "send", id: `agent#${id}`, task: "AFTER_RESTART" });
			await until(() => f.sessions.at(-1)?.isIdle === true, "restart followup settled"); await tick();
			assert.ok(!texts(f.requests.at(-1)!).includes("ORIGINAL"));
			await f.tool({ action: "stop", id: `agent#${id}` });
			await assert.rejects(f.tool({ action: "send", id: `agent#${id}`, task: "NO" }), /Unknown/);
		}
	} finally { await f.cleanup(); }
});

test("wait does not hold management queue: interrupt snapshots live tool, rejects send while cancellation pending; restart fences old effects", async t => {
	const f = await setup(t), release = Promise.withResolvers<void>();
	let toolEntered = false;
	const off = f.bus.on("rqw-tools:subagent-tools", request => request.offer((() => [{
		...createBashToolDefinition(f.root), execute: async () => { toolEntered = true; await release.promise; return { content: [{ type: "text", text: "OLD_EFFECT" }], details: {} }; },
	}]) as never));
	f.replies.push(answer([fauxToolCall("bash", { command: "ignored signal" })], { stopReason: "toolUse" }));
	try {
		await f.tool({ ...f.params("UNCOOPERATIVE"), tools: ["bash"] }); await until(() => toolEntered, "tool entered");
		const waiting = f.tool({ action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 1000000 }); await tick();
		const interrupted = JSON.parse(await f.tool({ action: "interrupt", id: "agent#1" }));
		assert.equal(interrupted.reason, "interruption_requested"); assert.equal(interrupted.snapshot.state, "running_tool"); assert.equal(interrupted.snapshot.current_tools[0].name, "bash");
		assert.equal(JSON.parse(await waiting).reason, "target_changed");
		await assert.rejects(f.tool({ action: "send", id: "agent#1", task: "NO" }), /cancellation pending/);
		await f.tool({ action: "restart", id: "agent#1", task: "NEW_RUN" });
		await until(() => f.requests.length === 2, "replacement without old tool finishing"); release.resolve(); await tick();
		assert.ok(f.session.messages.filter(m => m.role === "custom").every(m => !JSON.stringify(m).includes("OLD_EFFECT")));
		assert.equal(f.requests.length, 2, "old generation makes no follow-on request");
	} finally { release.resolve(); off(); await f.cleanup(); }
});

test("caller abort cancels only wait; late answer persists once without an extra caller turn", async t => {
	const f = await setup(t), held = gate("AFTER_ABORT"); f.replies.push(held.reply);
	f.mainReplies.push(answer([fauxToolCall("agent", f.params("LONG"))], { stopReason: "toolUse" }), answer([fauxToolCall("agent", { action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 900000 })], { stopReason: "toolUse" }));
	try {
		const run = f.session.prompt("GO"); await until(() => f.mainRequests.length === 2, "caller waiting"); await tick();
		await f.session.abort(); await run; assert.equal(held.aborted(), false);
		held.release(); await until(() => f.session.messages.some(m => m.role === "custom" && JSON.stringify(m).includes("AFTER_ABORT")), "late result persisted"); await tick();
		assert.equal(f.mainRequests.length, 2); assert.equal(f.session.messages.filter(m => m.role === "custom" && JSON.stringify(m).includes("AFTER_ABORT")).length, 1);
		await f.session.prompt("NEXT"); assert.ok(JSON.stringify(f.mainRequests.at(-1)).includes("AFTER_ABORT"));
	} finally { held.release(); await f.cleanup(); }
});

test("tool_result hook failure after wait reservation returns answer to normal delivery", async t => {
	const f = await setup(t), held = gate("RECOVERED"); f.replies.push(held.reply);
	const runner = f.session.extensionRunner, original = runner.emitToolResult.bind(runner), hasHandlers = runner.hasHandlers.bind(runner);
	t.mock.method(runner, "hasHandlers", event => event === "tool_result" || hasHandlers(event));
	t.mock.method(runner, "emitToolResult", async event => {
		const changed = await original(event);
		if (event.toolName === "agent" && event.input.action === "wait") return { isError: true, content: [{ type: "text", text: "HOOK_FAILED" }] };
		return changed;
	});
	f.mainReplies.push(answer([fauxToolCall("agent", f.params())], { stopReason: "toolUse" }), answer([fauxToolCall("agent", { action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 900000 })], { stopReason: "toolUse" }), answer("FINISHED"));
	try {
		const run = f.session.prompt("GO"); await until(() => f.mainRequests.length === 2, "wait before hook"); await tick();
		held.release(); await run; await f.session.waitForIdle(); assert.deepEqual(f.delivered(), ["[agent#1] RECOVERED"]);
	} finally { held.release(); await f.cleanup(); }
});

test("an offered job tool comes with the child's tools; interrupt aborts and stop disposes the child's jobs", async t => {
	const f = await setup(t), calls: string[] = [], held = gate("HELD"); f.replies.push(held.reply);
	const off = f.bus.on("rqw-tools:subagent-tools", request => request.offer((() => [createBashToolDefinition(f.root),
		{ ...createBashToolDefinition(f.root), name: "job", label: "job", jobs: { abortAll: () => calls.push("abortAll"), dispose: () => calls.push("dispose") } },
	]) as never));
	try {
		await f.tool({ ...f.params("WORK"), tools: ["bash"] }); await until(() => f.requests.length === 1, "child request");
		assert.ok(f.sessions.at(-1)!.getActiveToolNames().includes("job"), "job active in child");
		await f.tool({ action: "interrupt", id: "agent#1" }); assert.deepEqual(calls, ["abortAll"]);
		await f.tool({ action: "stop", id: "agent#1" }); assert.deepEqual(calls, ["abortAll", "dispose"]);
	} finally { held.release(); off(); await f.cleanup(); }
});
