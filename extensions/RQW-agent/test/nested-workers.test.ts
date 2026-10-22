// RQW-agent alone, real Pi sessions and faux providers. No transport, user auth or sibling extension is loaded.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { fauxProvider, fauxToolCall, type TranscriptContext, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { AgentSession, createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { answer, fixture, gate, texts, tick, until } from "./audit-fixture.ts";

const call = (name: string, task = "MECHANICAL") => fauxToolCall(name, { task });
const tools = (context: TranscriptContext) => {
	const names = new Set<string>();
	for (const message of context.messages) if (message.role === "system") {
		for (const tool of message.toolsAdded ?? []) names.add(tool.name);
		for (const tool of message.toolsRemoved ?? []) names.delete(tool.name);
	}
	return [...names].sort();
};
const workerMessages = (session: AgentSession) => session.messages.flatMap(m => m.role === "custom"
	&& ["code_writer", "shell_runner"].includes(m.customType) ? [m.content] : []);

async function nested(t: TestContext) {
	const sessions: AgentSession[] = [];
	const prompt = AgentSession.prototype.prompt;
	t.mock.method(AgentSession.prototype, "prompt", function(this: AgentSession, ...args: Parameters<typeof prompt>) {
		sessions.push(this);
		return prompt.apply(this, args);
	});
	const f = await fixture();
	const registry = f.session.extensionRunner.createContext().modelRegistry;
	t.mock.method(registry, "hasConfiguredAuth", () => true);
	const faux = fauxProvider({ provider: "anthropic", api: "nested-worker-faux", models: [{ id: "claude-haiku-5-5", reasoning: true }] });
	const workerRequests: TranscriptContext[] = [];
	const workerReplies: (ReturnType<typeof answer> | ReturnType<typeof gate>["reply"])[] = [];
	faux.setResponses(Array.from({ length: 30 }, () => async (context: TranscriptContext, options?: SimpleStreamOptions) => {
		workerRequests.push(structuredClone(context));
		const next = workerReplies.shift();
		return typeof next === "function" ? await next(context, options) : next ?? answer("WORKER_DONE");
	}));
	f.runtime.registerNativeProvider(faux.provider);
	const subSession = () => sessions.find(s => s !== f.session && s.model?.provider === f.sub.provider.id)!;
	const workerSessions = () => sessions.filter(s => s.model?.provider === "anthropic");
	return { ...f, workerRequests, workerReplies, subSession, workerSessions };
}

test("nested workers wake their direct caller; main receives only the final answer after both results", async t => {
	const f = await nested(t);
	const code = gate("CODE_RESULT"), shell = gate("SHELL_RESULT");
	f.workerReplies.push(code.reply, shell.reply);
	f.subReplies.push(answer([call("code_writer"), call("shell_runner")], { stopReason: "toolUse" }),
		answer("INTERMEDIATE"), answer("STILL_PENDING"), answer("FINAL_WITH_BOTH"));
	try {
		assert.equal(await f.start(), "agent#1 started");
		await until(() => f.workerRequests.length === 2 && f.subSession().isIdle, "subagent settled while workers run");
		await tick();
		assert.deepEqual(f.delivered(), [], "no intermediate answer to main");
		assert.deepEqual(tools(f.requests.sub[0]), ["code_writer", "shell_runner"], "even a tools:[] subagent has workers but no agent");
		assert.equal(f.subSession().getToolDefinition("agent"), undefined);
		assert.deepEqual(f.workerRequests.map(tools), [["bash", "edit", "find", "grep", "read", "write"], ["bash", "find", "grep", "read"]]);
		for (const worker of f.workerSessions()) {
			assert.equal(worker.sessionManager.getCwd(), f.root);
			for (const name of ["agent", "code_writer", "shell_runner"]) assert.equal(worker.getToolDefinition(name), undefined);
		}
		code.release();
		await until(() => f.requests.sub.length === 3 && f.subSession().isIdle, "code result woke subagent");
		await tick();
		assert.deepEqual(workerMessages(f.subSession()), ["[code_writer#1] CODE_RESULT"]);
		assert.deepEqual(f.delivered(), [], "the other worker still prevents delivery to main");
		shell.release();
		await until(() => f.delivered().length === 1, "one final answer to main");
		await f.session.waitForIdle();
		await tick();
		assert.deepEqual(f.delivered(), ["[agent#1] FINAL_WITH_BOTH"]);
		assert.deepEqual(workerMessages(f.subSession()).sort(), ["[code_writer#1] CODE_RESULT", "[shell_runner#1] SHELL_RESULT"]);
		assert.ok(texts(f.requests.sub[3]).includes("[code_writer#1] CODE_RESULT"));
		assert.ok(texts(f.requests.sub[3]).includes("[shell_runner#1] SHELL_RESULT"));
		assert.deepEqual(workerMessages(f.session), [], "raw worker results never reach main");
		assert.equal(f.requests.sub.length, 4);
		assert.deepEqual(f.errors, []);
	} finally { code.release(); shell.release(); await f.cleanup(); }
});

test("a nested result while the subagent is busy is consumed before its final answer; optional tools and git guard survive nesting", async t => {
	const f = await nested(t);
	const interim = gate("INTERMEDIATE"), code = gate("CODE_RESULT");
	let executed = 0;
	const cwd: string[] = [];
	const off = f.bus.on("rqw-tools:subagent-tools", request => request.offer(((dir: string) => {
		cwd.push(dir);
		return [{ ...createBashToolDefinition(dir), execute: async () => {
			executed++;
			return { content: [{ type: "text", text: "NESTED_OFFERED_BASH" }], details: {} };
		} }];
	}) as never));
	f.workerReplies.push(answer([fauxToolCall("bash", { command: "git add forbidden", timeout: 5 })], { stopReason: "toolUse" }),
		answer([fauxToolCall("bash", { command: "printf allowed", timeout: 5 })], { stopReason: "toolUse" }), code.reply);
	f.subReplies.push(answer([call("code_writer")], { stopReason: "toolUse" }), interim.reply, answer("FINAL_AFTER_BUSY_RESULT"));
	try {
		await f.start();
		await until(() => interim.entered() && code.entered(), "subagent busy and worker ready");
		code.release();
		await until(() => f.workerSessions()[0].isIdle, "worker finished before subagent native run");
		await tick();
		assert.deepEqual(f.delivered(), []);
		assert.equal(executed, 1, "only allowed bash reaches offered execute");
		assert.deepEqual(cwd, [f.root, f.root], "a fresh tools factory is requested for subagent and nested worker");
		const results = f.workerRequests[2].messages.filter(m => m.role === "toolResult");
		assert.equal(results[0].isError, true);
		assert.match(JSON.stringify(results[0].content), /Workers may not change git state/);
		assert.match(JSON.stringify(results[1].content), /NESTED_OFFERED_BASH/);
		interim.release();
		await until(() => f.delivered().length === 1, "final after busy result");
		await f.session.waitForIdle();
		assert.deepEqual(f.delivered(), ["[agent#1] FINAL_AFTER_BUSY_RESULT"]);
		assert.ok(texts(f.requests.sub[2]).includes("[code_writer#1] CODE_RESULT"));
		assert.deepEqual(workerMessages(f.session), []);
	} finally { off(); code.release(); interim.release(); await f.cleanup(); }
});

test("worker results held across settlement produce only the final background wakeup's answer", async t => {
	const f = await nested(t);
	const code = gate("CODE_RESULT"), shell = gate("SHELL_RESULT"), interim = gate("INTERMEDIATE");
	const settle = Promise.withResolvers<void>();
	let held = false;
	f.workerReplies.push(code.reply, shell.reply);
	f.subReplies.push(answer([call("code_writer"), call("shell_runner")], { stopReason: "toolUse" }),
		interim.reply, answer("FIRST_WAKE"), answer("LAST_WAKE"));
	try {
		await f.start();
		await until(() => interim.entered() && code.entered() && shell.entered(), "all runs held");
		const runner = f.subSession().extensionRunner;
		const emit = runner.emit;
		t.mock.method(runner, "emit", async function(this: typeof runner, ...args: Parameters<typeof emit>) {
			if (args[0].type === "agent_settled" && !held) { held = true; await settle.promise; }
			return emit.apply(this, args);
		});
		interim.release();
		await until(() => held, "subagent idle before settled handlers");
		code.release(); shell.release();
		await until(() => f.workerSessions().every(s => s.isIdle), "workers complete while caller settlement is held");
		await tick();
		assert.deepEqual(f.delivered(), []);
		settle.resolve();
		await until(() => f.delivered().length === 1, "final after deferred wakeups");
		await f.session.waitForIdle();
		await tick();
		assert.deepEqual(f.delivered(), ["[agent#1] LAST_WAKE"]);
		assert.equal(f.requests.sub.length, 4);
	} finally { settle.resolve(); code.release(); shell.release(); interim.release(); await f.cleanup(); }
});

test("interrupt aborts running workers and drops results, then send can start fresh workers", async t => {
	const f = await nested(t);
	const code = gate("DROPPED_CODE"), shell = gate("DROPPED_SHELL");
	const nextCode = gate("NEW_CODE"), nextShell = gate("NEW_SHELL");
	f.workerReplies.push(code.reply, shell.reply, nextCode.reply, nextShell.reply);
	f.subReplies.push(answer([call("code_writer"), call("shell_runner")], { stopReason: "toolUse" }), answer("DROPPED_INTERMEDIATE"),
		answer([call("code_writer"), call("shell_runner")], { stopReason: "toolUse" }), answer("RESUMED_INTERMEDIATE"),
		answer("RESUMED_FINAL"), answer("RESUMED_FINAL"));
	try {
		await f.start();
		await until(() => code.entered() && shell.entered() && f.subSession().isIdle, "running workers on idle subagent");
		const sub = f.subSession();
		const interrupted = JSON.parse(await f.call({ action: "interrupt", id: "agent#1" }));
		assert.equal(interrupted.id, "agent#1");
		assert.equal(interrupted.reason, "interruption_requested");
		assert.equal(interrupted.cancellation_requested, true);
		await until(() => code.aborted() && shell.aborted(), "interrupt aborted both roles");
		await until(() => sub.isIdle, "interrupted subagent settled");
		await tick();
		assert.deepEqual(f.delivered(), []);
		assert.deepEqual(workerMessages(sub), [], "canceled worker results were dropped");
		assert.equal(await f.call({ action: "send", id: "agent#1", task: "TRY_AGAIN" }), "agent#1: sent");
		await until(() => nextCode.entered() && nextShell.entered() && sub.isIdle, "same session accepted new workers");
		assert.equal(f.subSession(), sub);
		assert.equal(nextCode.aborted(), false);
		assert.equal(nextShell.aborted(), false);
		nextCode.release(); nextShell.release();
		await until(() => f.delivered().length === 1, "resumed final answer");
		await f.session.waitForIdle();
		assert.deepEqual(f.delivered(), ["[agent#1] RESUMED_FINAL"]);
		assert.deepEqual(workerMessages(sub).sort(), ["[code_writer#2] NEW_CODE", "[shell_runner#2] NEW_SHELL"]);
		assert.equal(f.workerRequests.length, 4, "new calls inferred instead of hitting a closed lifetime");
	} finally { code.release(); shell.release(); nextCode.release(); nextShell.release(); await f.cleanup(); }
});

for (const action of ["stop", "restart"] as const) test(`${action} of a subagent aborts its pending worker and drops old results`, async t => {
	const f = await nested(t);
	const code = gate("DROPPED_CODE"), shell = gate("DROPPED_SHELL");
	f.workerReplies.push(code.reply, shell.reply);
	f.subReplies.push(answer([call("code_writer"), call("shell_runner")], { stopReason: "toolUse" }), answer("DROPPED_INTERMEDIATE"), answer("REPLACEMENT_FINAL"));
	try {
		await f.start();
		await until(() => code.entered() && shell.entered() && f.subSession().isIdle, "subagent idle with pending workers");
		await tick();
		assert.deepEqual(f.delivered(), []);
		await f.call({ action, id: "agent#1", ...(action === "restart" ? { task: "NEW_ASSIGNMENT" } : {}) });
		await until(() => code.aborted() && shell.aborted(), "both workers aborted with subagent");
		if (action === "restart") {
			await until(() => f.delivered().length === 1, "replacement answer");
			await f.session.waitForIdle();
		}
		await tick();
		assert.deepEqual(f.delivered(), action === "restart" ? ["[agent#1] REPLACEMENT_FINAL"] : []);
		assert.deepEqual(workerMessages(f.subSession()), [], "old worker result is discarded");
		assert.equal(f.workerRequests.length, 2, "no post-stop inference from old workers");
		assert.deepEqual(workerMessages(f.session), []);
	} finally { code.release(); shell.release(); await f.cleanup(); }
});
