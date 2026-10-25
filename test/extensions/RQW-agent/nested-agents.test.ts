// RQW-agent alone, real Pi sessions and faux providers. No transport, user auth or sibling extension is loaded.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { fauxProvider, fauxToolCall, type TranscriptContext, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { AgentSession, createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { answer, fixture, gate, texts, tick, until } from "./audit-fixture.ts";

const nestedProvider = "nested-agent-faux";
const call = (task: string, selectedTools: string[] = []) => fauxToolCall("agent", {
	action: "start", system: "EXACT_NESTED", task, model: `${nestedProvider}/nested`,
	thinking: "low", tools: selectedTools, fast_gpt: false,
});
const tools = (context: TranscriptContext) => {
	const names = new Set<string>();
	for (const message of context.messages) if (message.role === "system") {
		for (const tool of message.toolsAdded ?? []) names.add(tool.name);
		for (const tool of message.toolsRemoved ?? []) names.delete(tool.name);
	}
	return [...names].sort();
};
const agentMessages = (session: AgentSession) => session.messages.flatMap(m => m.role === "custom"
	&& m.customType === "agent" ? [m.content] : []);

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
	// A separate provider keeps descendant replies out of the direct child's queue.
	const faux = fauxProvider({ provider: nestedProvider, api: nestedProvider, models: [{ id: "nested", reasoning: true }] });
	const nestedRequests: TranscriptContext[] = [];
	const nestedReplies: (ReturnType<typeof answer> | ReturnType<typeof gate>["reply"])[] = [];
	faux.setResponses(Array.from({ length: 30 }, () => async (context: TranscriptContext, options?: SimpleStreamOptions) => {
		nestedRequests.push(structuredClone(context));
		const next = nestedReplies.shift();
		return typeof next === "function" ? await next(context, options) : next ?? answer("NESTED_DONE");
	}));
	f.runtime.registerNativeProvider(faux.provider);
	const subSession = () => sessions.find(s => s !== f.session && s.model?.provider === f.sub.provider.id)!;
	const nestedSessions = () => [...new Set(sessions.filter(s => s.model?.provider === nestedProvider))];
	return { ...f, nestedRequests, nestedReplies, subSession, nestedSessions };
}

test("nested agents wake their direct caller; main receives only the final answer after both results", async t => {
	const f = await nested(t);
	const first = gate("FIRST_RESULT"), second = gate("SECOND_RESULT");
	f.nestedReplies.push(first.reply, second.reply);
	f.subReplies.push(answer([call("FIRST", ["read", "write"]), call("SECOND", ["bash"])], { stopReason: "toolUse" }),
		answer("INTERMEDIATE"), answer("STILL_PENDING"), answer("FINAL_WITH_BOTH"));
	try {
		assert.equal(await f.start(), "agent#1 started");
		await until(() => f.nestedRequests.length === 2 && f.subSession().isIdle, "subagent settled while descendants run");
		await tick();
		assert.deepEqual(f.delivered(), [], "no intermediate answer to main");
		assert.deepEqual(tools(f.requests.sub[0]), ["agent"], "even a tools:[] subagent has recursive delegation");
		assert.ok(f.subSession().getToolDefinition("agent"), "a subagent starts subagents of its own");
		assert.deepEqual(f.nestedRequests.map(tools), [["agent", "read", "write"], ["agent", "bash"]]);
		for (const child of f.nestedSessions()) {
			assert.equal(child.sessionManager.getCwd(), f.root);
			assert.ok(child.getToolDefinition("agent"), "ordinary descendants can delegate recursively too");
		}
		first.release();
		await until(() => f.requests.sub.length === 3 && f.subSession().isIdle, "first result woke subagent");
		await tick();
		assert.deepEqual(agentMessages(f.subSession()), ["[agent#1] FIRST_RESULT"]);
		assert.deepEqual(f.delivered(), [], "the other descendant still prevents delivery to main");
		second.release();
		await until(() => f.delivered().length === 1, "one final answer to main");
		await f.session.waitForIdle();
		await tick();
		assert.deepEqual(f.delivered(), ["[agent#1] FINAL_WITH_BOTH"]);
		assert.deepEqual(agentMessages(f.subSession()).sort(), ["[agent#1] FIRST_RESULT", "[agent#2] SECOND_RESULT"]);
		assert.ok(texts(f.requests.sub[3]).includes("[agent#1] FIRST_RESULT"));
		assert.ok(texts(f.requests.sub[3]).includes("[agent#2] SECOND_RESULT"));
		assert.deepEqual(agentMessages(f.session), ["[agent#1] FINAL_WITH_BOTH"], "raw descendant results never reach main");
		assert.equal(f.requests.sub.length, 4);
		assert.deepEqual(f.errors, []);
	} finally { first.release(); second.release(); await f.cleanup(); }
});

test("a nested result while the subagent is busy is consumed before its final answer; optional tools inherit into nested agents", async t => {
	const f = await nested(t);
	const interim = gate("INTERMEDIATE"), first = gate("FIRST_RESULT");
	let executed = 0;
	const cwd: string[] = [];
	const labels: unknown[] = [];
	const off = f.bus.on("rqw-tools:subagent-tools", request => request.offer(((dir: string, _settings: unknown, _nested: unknown, options?: { label?: string }) => {
		cwd.push(dir);
		labels.push(options?.label);
		return [{ ...createBashToolDefinition(dir), execute: async () => {
			executed++;
			return { content: [{ type: "text", text: "NESTED_OFFERED_BASH" }], details: {} };
		} }];
	}) as never));
	f.nestedReplies.push(answer([fauxToolCall("bash", { command: "printf first", timeout: 5 })], { stopReason: "toolUse" }),
		answer([fauxToolCall("bash", { command: "printf second", timeout: 5 })], { stopReason: "toolUse" }), first.reply);
	f.subReplies.push(answer([call("FIRST", ["bash"])], { stopReason: "toolUse" }), interim.reply, answer("FINAL_AFTER_BUSY_RESULT"));
	try {
		await f.start();
		await until(() => interim.entered() && first.entered(), "subagent busy and descendant ready");
		first.release();
		await until(() => f.nestedSessions()[0].isIdle, "descendant finished before subagent native run");
		await tick();
		assert.deepEqual(f.delivered(), []);
		assert.equal(executed, 2, "both nested bash calls reach the offered execute");
		assert.deepEqual(cwd, [f.root, f.root], "a fresh tools factory is requested for subagent and descendant");
		assert.deepEqual(labels, ["agent#1", "agent#1/agent#1"], "each session's label is its path from main");
		assert.deepEqual(tools(f.nestedRequests[0]), ["agent", "bash"], "selected optional tools coexist with recursive delegation");
		const results = f.nestedRequests[2].messages.filter(m => m.role === "toolResult");
		assert.equal(results.length, 2);
		assert.equal(results.some(result => result.isError), false);
		for (const result of results) assert.match(JSON.stringify(result.content), /NESTED_OFFERED_BASH/);
		interim.release();
		await until(() => f.delivered().length === 1, "final after busy result");
		await f.session.waitForIdle();
		assert.deepEqual(f.delivered(), ["[agent#1] FINAL_AFTER_BUSY_RESULT"]);
		assert.ok(texts(f.requests.sub[2]).includes("[agent#1] FIRST_RESULT"));
		assert.deepEqual(agentMessages(f.session), ["[agent#1] FINAL_AFTER_BUSY_RESULT"]);
	} finally { off(); first.release(); interim.release(); await f.cleanup(); }
});

test("nested agent results held across settlement produce only the final background wakeup's answer", async t => {
	const f = await nested(t);
	const first = gate("FIRST_RESULT"), second = gate("SECOND_RESULT"), interim = gate("INTERMEDIATE"), firstWake = gate("FIRST_WAKE");
	const settle = Promise.withResolvers<void>();
	let held = false;
	f.nestedReplies.push(first.reply, second.reply);
	f.subReplies.push(answer([call("FIRST"), call("SECOND")], { stopReason: "toolUse" }),
		interim.reply, firstWake.reply, answer("LAST_WAKE"));
	try {
		await f.start();
		await until(() => interim.entered() && first.entered() && second.entered(), "all runs held");
		const runner = f.subSession().extensionRunner;
		const emit = runner.emit;
		t.mock.method(runner, "emit", async function(this: typeof runner, ...args: Parameters<typeof emit>) {
			if (args[0].type === "agent_settled" && !held) { held = true; await settle.promise; }
			return emit.apply(this, args);
		});
		interim.release();
		await until(() => held, "subagent idle before settled handlers");
		first.release();
		await until(() => f.nestedSessions()[0].isIdle, "first descendant completes while caller settlement is held");
		await tick();
		assert.deepEqual(f.delivered(), []);
		settle.resolve();
		await until(firstWake.entered, "first deferred wakeup is running");
		second.release();
		await until(() => f.nestedSessions().every(s => s.isIdle), "second result arrives during the deferred wakeup");
		await tick();
		assert.deepEqual(f.delivered(), [], "neither settlement nor the unfinished wakeup delivers to main");
		firstWake.release();
		await until(() => f.delivered().length === 1, "final after deferred wakeups");
		await f.session.waitForIdle();
		await tick();
		assert.deepEqual(f.delivered(), ["[agent#1] LAST_WAKE"]);
		assert.equal(f.requests.sub.length, 4);
	} finally { settle.resolve(); first.release(); second.release(); interim.release(); firstWake.release(); await f.cleanup(); }
});

test("interrupt aborts running descendants and drops results, then send can start fresh nested agents", async t => {
	const f = await nested(t);
	const first = gate("DROPPED_FIRST"), second = gate("DROPPED_SECOND");
	const nextFirst = gate("NEW_FIRST"), nextSecond = gate("NEW_SECOND");
	f.nestedReplies.push(first.reply, second.reply, nextFirst.reply, nextSecond.reply);
	f.subReplies.push(answer([call("FIRST"), call("SECOND")], { stopReason: "toolUse" }), answer("DROPPED_INTERMEDIATE"),
		answer([call("NEW_FIRST"), call("NEW_SECOND")], { stopReason: "toolUse" }), answer("RESUMED_INTERMEDIATE"),
		answer("RESUMED_FINAL"), answer("RESUMED_FINAL"));
	try {
		await f.start();
		await until(() => first.entered() && second.entered() && f.subSession().isIdle, "running descendants on idle subagent");
		const sub = f.subSession();
		const interrupted = JSON.parse(await f.call({ action: "interrupt", id: "agent#1" }));
		assert.equal(interrupted.id, "agent#1");
		assert.equal(interrupted.reason, "interruption_requested");
		assert.equal(interrupted.cancellation_requested, true);
		await until(() => first.aborted() && second.aborted(), "interrupt aborted both descendants");
		await until(() => sub.isIdle, "interrupted subagent settled");
		await tick();
		assert.deepEqual(f.delivered(), []);
		assert.deepEqual(agentMessages(sub), [], "canceled descendant results were dropped");
		assert.equal(await f.call({ action: "send", id: "agent#1", task: "TRY_AGAIN" }), "agent#1: sent");
		await until(() => nextFirst.entered() && nextSecond.entered() && sub.isIdle, "same session accepted new descendants");
		assert.equal(f.subSession(), sub);
		assert.equal(nextFirst.aborted(), false);
		assert.equal(nextSecond.aborted(), false);
		nextFirst.release(); nextSecond.release();
		await until(() => f.delivered().length === 1, "resumed final answer");
		await f.session.waitForIdle();
		assert.deepEqual(f.delivered(), ["[agent#1] RESUMED_FINAL"]);
		assert.deepEqual(agentMessages(sub).sort(), ["[agent#3] NEW_FIRST", "[agent#4] NEW_SECOND"]);
		assert.equal(f.nestedRequests.length, 4, "new calls inferred instead of hitting a closed lifetime");
	} finally { first.release(); second.release(); nextFirst.release(); nextSecond.release(); await f.cleanup(); }
});

for (const action of ["stop", "restart"] as const) test(`${action} of a subagent aborts its pending descendants and drops old results`, async t => {
	const f = await nested(t);
	const first = gate("DROPPED_FIRST"), second = gate("DROPPED_SECOND");
	f.nestedReplies.push(first.reply, second.reply);
	f.subReplies.push(answer([call("FIRST"), call("SECOND")], { stopReason: "toolUse" }), answer("DROPPED_INTERMEDIATE"), answer("REPLACEMENT_FINAL"));
	try {
		await f.start();
		await until(() => first.entered() && second.entered() && f.subSession().isIdle, "subagent idle with pending descendants");
		await tick();
		assert.deepEqual(f.delivered(), []);
		await f.call({ action, id: "agent#1", ...(action === "restart" ? { task: "NEW_ASSIGNMENT" } : {}) });
		await until(() => first.aborted() && second.aborted(), "both descendants aborted with subagent");
		if (action === "restart") {
			await until(() => f.delivered().length === 1, "replacement answer");
			await f.session.waitForIdle();
		}
		await tick();
		assert.deepEqual(f.delivered(), action === "restart" ? ["[agent#1] REPLACEMENT_FINAL"] : []);
		assert.deepEqual(agentMessages(f.subSession()), [], "old descendant result is discarded");
		assert.equal(f.nestedRequests.length, 2, "no post-stop inference from old descendants");
		assert.deepEqual(agentMessages(f.session), action === "restart" ? ["[agent#1] REPLACEMENT_FINAL"] : []);
	} finally { first.release(); second.release(); await f.cleanup(); }
});

test("send to a child parked on its own pending descendant reaches it at once; the descendant's later result still arrives once", async t => {
	const f = await nested(t);
	const first = gate("FIRST_RESULT");
	f.nestedReplies.push(first.reply);
	f.subReplies.push(answer([call("FIRST")], { stopReason: "toolUse" }), answer("INTERMEDIATE"), answer("STEERED_ANSWER"), answer("FINAL_AFTER_DESCENDANT"));
	try {
		await f.start();
		await until(() => f.requests.sub.length === 2 && f.subSession().isIdle && first.entered(), "child idle, parked on its descendant");
		await tick();
		assert.deepEqual(f.delivered(), []);
		assert.equal(await f.call({ action: "send", id: "1", task: "STEER_PARKED" }), "agent#1: sent");
		await until(() => f.requests.sub.length === 3, "the steered request before the descendant finished");
		assert.ok(texts(f.requests.sub[2]).includes("STEER_PARKED"));
		assert.equal(first.aborted(), false);
		await until(() => f.subSession().isIdle, "child idle again");
		await tick();
		assert.deepEqual(f.delivered(), [], "the descendant is still pending");
		assert.equal(f.requests.sub.length, 3);
		first.release();
		await until(() => f.delivered().length === 1, "final answer after the descendant result");
		await f.session.waitForIdle();
		await tick();
		assert.deepEqual(f.delivered(), ["[agent#1] FINAL_AFTER_DESCENDANT"]);
		assert.equal(f.requests.sub.length, 4);
		assert.equal(texts(f.requests.sub[3]).filter(x => x === "STEER_PARKED").length, 1, "the steering message is in the history once");
		assert.deepEqual(agentMessages(f.subSession()), ["[agent#1] FIRST_RESULT"]);
		assert.deepEqual(f.errors, []);
	} finally { first.release(); await f.cleanup(); }
});

test("send with interrupt to a descendant-woken native run with a tool ignoring abort starts the new task once, after that run, with no error", async t => {
	const f = await nested(t);
	const first = gate("FIRST_RESULT");
	const release = Promise.withResolvers<void>();
	let entered = false, aborted = false;
	const off = f.bus.on("rqw-tools:subagent-tools", request => request.offer(((dir: string) => [{
		...createBashToolDefinition(dir), execute: async (_id: string, _args: unknown, signal?: AbortSignal) => {
			entered = true;
			signal?.addEventListener("abort", () => { aborted = true; }, { once: true });
			await release.promise;
			return { content: [{ type: "text", text: "TOOL_DONE" }], details: {} };
		},
	}]) as never));
	f.nestedReplies.push(first.reply);
	f.subReplies.push(answer([call("FIRST")], { stopReason: "toolUse" }), answer("INTERMEDIATE"),
		answer([fauxToolCall("bash", { command: "held" }, { id: "b1" })], { stopReason: "toolUse" }), answer("NEW_ANSWER"));
	try {
		await f.call({ ...f.params("FIRST"), tools: ["bash"] });
		await until(() => f.requests.sub.length === 2 && f.subSession().isIdle && first.entered(), "child idle, parked on its descendant");
		first.release();
		await until(() => entered, "the descendant-woken native run is in the held tool");
		assert.equal(await f.call({ action: "send", id: "1", task: "NEW_TASK", interrupt: true }), "agent#1: interrupted, sent");
		await until(() => aborted, "the tool saw the abort");
		await tick(60);
		assert.equal(f.requests.sub.length, 3, "nothing starts while the woken run still streams");
		assert.equal(JSON.parse(await f.call({ action: "status", ids: ["agent#1"] })).statuses[0].pending_sends, 1);
		release.resolve();
		await until(() => f.delivered().length === 1, "delivery of the new run");
		assert.deepEqual(f.delivered(), ["[agent#1] NEW_ANSWER"]);
		assert.equal(f.requests.sub.length, 4, "exactly one new run");
		assert.equal(texts(f.requests.sub[3]).filter(x => x === "NEW_TASK").length, 1);
		await tick(60);
		assert.equal(f.delivered().length, 1);
		assert.deepEqual(f.errors, []);
	} finally { off(); first.release(); release.resolve(); await f.cleanup(); }
});
