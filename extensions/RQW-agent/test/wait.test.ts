// Extension-local real Pi sessions, faux providers and gated tools. No model/network/other extension.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { fauxProvider, fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { AgentSession, createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { answer, fixture, gate, tick, until, texts } from "./audit-fixture.ts";

async function setup(t: TestContext) {
	const f = await fixture();
	const sessions: AgentSession[] = [];
	const prompt = AgentSession.prototype.prompt;
	t.mock.method(AgentSession.prototype, "prompt", function(this: AgentSession, ...args: Parameters<typeof prompt>) {
		if (this !== f.session && !sessions.includes(this)) sessions.push(this);
		return prompt.apply(this, args);
	});
	t.mock.method(f.session.extensionRunner.createContext().modelRegistry, "hasConfiguredAuth", () => true);
	const worker = fauxProvider({ provider: "anthropic", api: "wait-worker", models: [{ id: "claude-haiku-5-5", reasoning: true }] });
	const replies: any[] = [], requests: TranscriptContext[] = [];
	worker.setResponses(Array.from({ length: 80 }, () => async (context, options) => {
		requests.push(structuredClone(context));
		const reply = replies.shift();
		return typeof reply === "function" ? reply(context, options) : reply ?? answer("WORKER_OK");
	}));
	f.runtime.registerNativeProvider(worker.provider);
	const tool = async (name: string, args: Record<string, unknown>, signal?: AbortSignal) => {
		const result = await f.session.getToolDefinition(name)!.execute(`manual-${name}`, args, signal, undefined, f.session.extensionRunner.createContext());
		return result.content.map(c => c.type === "text" ? c.text : "").join("");
	};
	const status = async (ids: string[]) => JSON.parse(await tool("agent", { action: "status", ids })).statuses;
	return { ...f, sessions, replies, requests, mainRequests: f.requests.main, tool, status };
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

test("completed workers stay retained and undisposed until stop; another until caller shutdown; each disposed exactly once", async t => {
	const f = await setup(t), disposed = countDisposals(t);
	const kept: AgentSession[] = [];
	const delivered = (role: string) => f.session.messages.filter(m => m.role === "custom" && m.customType === role).length;
	try {
		for (const role of ["code_writer", "shell_runner"] as const) {
			assert.equal(await f.tool(role, { task: `STOP_${role}` }), `${role}#1 started`);
			const child = f.sessions.at(-1)!;
			await until(() => child.isIdle && delivered(role) === 1, `${role}#1 completed`);
			await f.session.waitForIdle(); await tick();
			assert.equal(disposed(child), 0, `${role}#1 is retained after completion`);
			assert.equal(JSON.parse(await f.tool(role, { action: "status", ids: [`${role}#1`] })).statuses[0].state, "idle");
			await f.tool(role, { action: "stop", id: `${role}#1` });
			await until(() => disposed(child) === 1, `${role}#1 disposed by stop`);
			await tick();
			assert.equal(disposed(child), 1, `${role}#1 disposed exactly once`);
		}
		for (const role of ["code_writer", "shell_runner"] as const) {
			assert.equal(await f.tool(role, { task: `SHUTDOWN_${role}` }), `${role}#2 started`);
			const child = f.sessions.at(-1)!;
			await until(() => child.isIdle && delivered(role) === 2, `${role}#2 completed`);
			await f.session.waitForIdle(); await tick();
			assert.equal(disposed(child), 0, `${role}#2 stays undisposed before caller shutdown`);
			kept.push(child);
		}
		await f.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await until(() => kept.every(child => disposed(child) === 1), "caller shutdown disposes retained workers");
		await tick();
		for (const child of kept) assert.equal(disposed(child), 1, "disposed exactly once after shutdown");
	} finally { await f.cleanup(); }
});

test("gated terminal worker error is returned once by explicit wait and never copied as a custom message", async t => {
	const f = await setup(t), MARK = "WORKER_BAD_REQUEST_MARK";
	const releases: (() => void)[] = [];
	const delivered = () => f.session.messages.some(m => m.role === "custom" && JSON.stringify(m).includes(MARK));
	try {
		for (const role of ["code_writer", "shell_runner"] as const) {
			let release!: () => void, entered = false;
			const released = new Promise<void>(resolve => { release = resolve; });
			releases.push(release);
			// Non-retryable classification: no 429/5xx/overload pattern, so the worker's default retry does not fire.
			f.replies.push(async () => {
				entered = true;
				await released;
				return answer("", { stopReason: "error", errorMessage: `400 invalid_request_error: ${MARK}` });
			});
			const before = f.mainRequests.length;
			f.mainReplies.push(answer([fauxToolCall(role, { task: "BAD_REQUEST_BRIEF" })], { stopReason: "toolUse" }),
				answer([fauxToolCall(role, { action: "wait", ids: [`${role}#1`], timeout_ms: 900000 })], { stopReason: "toolUse" }),
				answer("CALLER_DONE"));
			const run = f.session.prompt("GO");
			await until(() => entered, `${role} worker entered`);
			await until(() => f.session.messages.some(m => m.role === "assistant" && m.content.some(c => c.type === "toolCall" && c.name === role && c.arguments.action === "wait")), `${role} caller wait started`);
			await tick();
			assert.equal(f.mainRequests.length, before + 2, "caller is blocked in its explicit wait");
			release();
			await run;
			const waitResult = f.session.messages.findLast(m => m.role === "toolResult" && m.toolName === role)!;
			const body = JSON.parse(waitResult.content.filter(c => c.type === "text").map(c => c.text).join(""));
			assert.equal(body.reason, "result");
			assert.equal(body.results.length, 1);
			assert.equal(body.results[0].id, `${role}#1`);
			assert.equal(body.results[0].outcome, "error");
			assert.ok(body.results[0].text.includes(MARK));
			await f.session.waitForIdle(); await tick();
			assert.equal(delivered(), false, "no custom message copy after the caller settles");
			const again = JSON.parse(await f.tool(role, { action: "wait", ids: [`${role}#1`], timeout_ms: 1 }));
			assert.equal(again.reason, "receipt");
			assert.deepEqual(again.results, []);
			assert.equal(again.receipts[0].delivered_via, "wait");
			f.mainReplies.push(answer("NEXT_DONE"));
			await f.session.prompt("NEXT");
			await f.session.waitForIdle(); await tick();
			assert.equal(delivered(), false, "no late message after the next caller prompt");
			assert.equal(f.session.messages.filter(m => m.role === "custom" && m.customType === role).length, 0);
		}
	} finally { for (const release of releases) release(); await f.cleanup(); }
});

test("mixed explicit wait returns first result once, while caller makes no model requests during its pause", async t => {
	const f = await setup(t), code = gate("CODE_FIRST"), shell = gate("SHELL_SECOND"), child = gate("AGENT_THIRD");
	f.replies.push(code.reply, shell.reply); f.subReplies.push(child.reply);
	f.mainReplies.push(answer([
		fauxToolCall("agent", f.params()), fauxToolCall("code_writer", { task: "CODE" }), fauxToolCall("shell_runner", { task: "SHELL" }),
	], { stopReason: "toolUse" }), answer([fauxToolCall("agent", { action: "wait", ids: ["agent#1", "code_writer#1", "shell_runner#1"], timeout_ms: 900000 })], { stopReason: "toolUse" }), answer("GOT_FIRST"));
	try {
		const run = f.session.prompt("GO");
		await until(() => f.session.messages.some(m => m.role === "assistant" && m.content.some(c => c.type === "toolCall" && c.arguments.action === "wait")), "caller wait started");
		await tick();
		assert.equal(f.mainRequests.length, 2);
		assert.equal(code.aborted(), false); assert.equal(shell.aborted(), false);
		code.release(); await run;
		assert.equal(f.mainRequests.length, 3);
		const result = f.session.messages.findLast(m => m.role === "toolResult" && m.toolName === "agent")!;
		const body = JSON.parse(result.content.filter(c => c.type === "text").map(c => c.text).join(""));
		assert.equal(body.reason, "result"); assert.equal(body.results[0].id, "code_writer#1");
		assert.equal(body.results[0].text, "CODE_FIRST");
		assert.equal(f.session.messages.some(m => m.role === "custom" && m.customType === "code_writer"), false);
		const receipt = JSON.parse(await f.tool("shell_runner", { action: "wait", ids: ["code_writer#1"], timeout_ms: 1 }));
		assert.equal(receipt.reason, "receipt"); assert.equal(receipt.receipts[0].delivered_via, "wait");
		assert.deepEqual(receipt.results, []);
	} finally { code.release(); shell.release(); child.release(); await f.cleanup(); }
});

test("timeout affects only caller; repeated wait chooses a new duration, status reads history and no model is invoked by peek", async t => {
	const f = await setup(t), held = gate("LONG_WORK"); f.replies.push(held.reply);
	try {
		await f.tool("code_writer", { task: "FIRST_BRIEF" });
		await until(held.entered, "worker entered");
		const first = JSON.parse(await f.tool("shell_runner", { action: "wait", ids: ["code_writer#1", "shell_runner#999"], timeout_ms: 1 }));
		assert.equal(first.reason, "timeout"); assert.equal(first.statuses.length, 2); assert.equal(held.aborted(), false);
		const before = f.requests.length;
		const [snapshot] = await f.status(["code_writer#1"]);
		assert.ok(snapshot.messages.some((m: any) => m.text?.includes("FIRST_BRIEF")));
		assert.equal(snapshot.state, "running"); assert.equal(f.requests.length, before);
		const again = f.tool("code_writer", { action: "wait", ids: ["code_writer#1"], timeout_ms: 900000 });
		await tick(); held.release();
		assert.equal(JSON.parse(await again).results[0].text, "LONG_WORK");
	} finally { held.release(); await f.cleanup(); }
});

test("worker retention: send reuses history/config, start is clean, restart without task is fresh idle, stop forgets", async t => {
	const f = await setup(t);
	try {
		for (const name of ["code_writer", "shell_runner"]) {
			await f.tool(name, { task: "ORIGINAL" }); await until(() => f.sessions.at(-1)?.isIdle === true, "first settled"); await tick();
			const first = f.sessions.at(-1)!;
			assert.equal(await f.tool(name, { action: "send", id: `${name}#1`, task: "FOLLOWUP" }), `${name}#1: sent`);
			await until(() => first.isIdle, "followup settled"); await tick();
			assert.equal(f.sessions.at(-1), first);
			assert.ok(texts(f.requests.at(-1)!).includes("ORIGINAL")); assert.ok(texts(f.requests.at(-1)!).includes("FOLLOWUP"));
			await f.tool(name, { task: "UNRELATED" }); await until(() => f.sessions.at(-1)?.isIdle === true, "new assignment settled"); await tick();
			assert.notEqual(f.sessions.at(-1), first); assert.ok(!texts(f.requests.at(-1)!).includes("ORIGINAL"));
			const count = f.requests.length;
			await f.tool(name, { action: "restart", id: `${name}#1` });
			assert.equal(f.requests.length, count);
			const [snapshot] = await f.status([`${name}#1`]); assert.equal(snapshot.state, "idle");
			await f.tool(name, { action: "send", id: `${name}#1`, task: "AFTER_RESTART" });
			await until(() => f.sessions.at(-1)?.isIdle === true, "restart followup settled"); await tick();
			assert.ok(!texts(f.requests.at(-1)!).includes("ORIGINAL"));
			await f.tool(name, { action: "stop", id: `${name}#1` });
			await assert.rejects(f.tool(name, { action: "send", id: `${name}#1`, task: "NO" }), /Unknown/);
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
		await f.tool("code_writer", { task: "UNCOOPERATIVE" }); await until(() => toolEntered, "tool entered");
		const waiting = f.tool("agent", { action: "wait", ids: ["code_writer#1"], timeout_ms: 1000000 }); await tick();
		const interrupted = JSON.parse(await f.tool("code_writer", { action: "interrupt", id: "code_writer#1" }));
		assert.equal(interrupted.reason, "interruption_requested");
		assert.equal(interrupted.snapshot.state, "running_tool");
		assert.equal(interrupted.snapshot.current_tools[0].name, "bash");
		assert.equal(JSON.parse(await waiting).reason, "target_changed");
		await assert.rejects(f.tool("code_writer", { action: "send", id: "code_writer#1", task: "NO" }), /cancellation pending/);
		await f.tool("code_writer", { action: "restart", id: "code_writer#1", task: "NEW_RUN" });
		await until(() => f.requests.length === 2, "replacement request without old tool finishing");
		release.resolve(); await tick();
		assert.ok(f.session.messages.filter(m => m.role === "custom").every(m => !JSON.stringify(m).includes("OLD_EFFECT")));
		assert.equal(f.requests.length, 2, "old generation must not make a follow-on model request");
	} finally { release.resolve(); off(); await f.cleanup(); }
});

test("caller abort cancels only wait; late answer persists once without an extra caller turn", async t => {
	const f = await setup(t), held = gate("AFTER_ABORT"); f.replies.push(held.reply);
	f.mainReplies.push(answer([fauxToolCall("shell_runner", { task: "LONG" })], { stopReason: "toolUse" }),
		answer([fauxToolCall("shell_runner", { action: "wait", ids: ["shell_runner#1"], timeout_ms: 900000 })], { stopReason: "toolUse" }));
	try {
		const run = f.session.prompt("GO");
		await until(() => f.mainRequests.length === 2, "caller waiting"); await tick();
		await f.session.abort(); await run;
		assert.equal(held.aborted(), false);
		held.release(); await until(() => f.session.messages.some(m => m.role === "custom" && JSON.stringify(m).includes("AFTER_ABORT")), "late result persisted"); await tick();
		assert.equal(f.mainRequests.length, 2);
		assert.equal(f.session.messages.filter(m => m.role === "custom" && JSON.stringify(m).includes("AFTER_ABORT")).length, 1);
		await f.session.prompt("NEXT");
		assert.ok(JSON.stringify(f.mainRequests.at(-1)).includes("AFTER_ABORT"));
	} finally { held.release(); await f.cleanup(); }
});

test("tool_result hook failure after wait reservation returns answer to normal delivery", async t => {
	const f = await setup(t), held = gate("RECOVERED"); f.subReplies.push(held.reply);
	const runner = f.session.extensionRunner;
	const original = runner.emitToolResult.bind(runner);
	const hasHandlers = runner.hasHandlers.bind(runner);
	t.mock.method(runner, "hasHandlers", event => event === "tool_result" || hasHandlers(event));
	t.mock.method(runner, "emitToolResult", async event => {
		const changed = await original(event);
		if (event.toolName === "agent" && event.input.action === "wait") return { isError: true, content: [{ type: "text", text: "HOOK_FAILED" }] };
		return changed;
	});
	f.mainReplies.push(answer([fauxToolCall("agent", f.params())], { stopReason: "toolUse" }),
		answer([fauxToolCall("agent", { action: "wait", ids: ["agent#1"], timeout_ms: 900000 })], { stopReason: "toolUse" }), answer("FINISHED"));
	try {
		const run = f.session.prompt("GO"); await until(() => f.mainRequests.length === 2, "wait before hook"); await tick();
		held.release(); await run; await f.session.waitForIdle();
		assert.deepEqual(f.delivered(), ["[agent#1] RECOVERED"]);
	} finally { held.release(); await f.cleanup(); }
});

test("an offered job tool comes with the child's tools; interrupt aborts and stop disposes the child's jobs", async t => {
	const f = await setup(t), calls: string[] = [], held = gate("HELD"); f.replies.push(held.reply);
	const off = f.bus.on("rqw-tools:subagent-tools", request => request.offer((() => [
		createBashToolDefinition(f.root),
		{ ...createBashToolDefinition(f.root), name: "job", label: "job", jobs: { abortAll: () => calls.push("abortAll"), dispose: () => calls.push("dispose") } },
	]) as never));
	try {
		await f.tool("code_writer", { task: "WORK" });
		await until(() => f.requests.length === 1, "child request");
		assert.ok(f.sessions.at(-1)!.getActiveToolNames().includes("job"), "job is active in the child");
		await f.tool("code_writer", { action: "interrupt", id: "code_writer#1" });
		assert.deepEqual(calls, ["abortAll"]);
		await f.tool("code_writer", { action: "stop", id: "code_writer#1" });
		assert.deepEqual(calls, ["abortAll", "dispose"]);
	} finally { held.release(); off(); await f.cleanup(); }
});
