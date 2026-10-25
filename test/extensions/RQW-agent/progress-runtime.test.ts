import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxToolCall } from "@earendil-works/pi-ai";
import { createBashToolDefinition, type AgentSession } from "@earendil-works/pi-coding-agent";
import { CONTEXT_FORK, PROGRESS_SKILL_PATH, type ContextForkRequest } from "../../../extensions/RQW-agent/progress.ts";
import { answer, fixture, gate, tick, until } from "./audit-fixture.ts";

const toolUse = (id: string) => answer([fauxToolCall("bash", { command: "faux" }, { id })], { stopReason: "toolUse" });
const reports = (session: AgentSession) => session.messages.filter(m => m.role === "custom" && m.customType === "agent_progress");
const savedSteps = (session: AgentSession) => (session.sessionManager.getBranch().findLast(e => e.type === "custom" && e.customType === "rqw-agent-child") as any)?.data.progressSteps;

async function runningChild(configure?: (f: Awaited<ReturnType<typeof fixture>>) => Record<string, unknown>) {
	const f = await fixture();
	const extra = configure?.(f) ?? {};
	const children: AgentSession[] = [];
	const listeners: Parameters<AgentSession["subscribe"]>[0][] = [];
	f.bus.on("rqw-codex:session-policy", request => {
		const child = (request as unknown as { session: AgentSession }).session;
		children.push(child);
		const subscribe = child.subscribe.bind(child);
		child.subscribe = listener => { listeners.push(listener); return subscribe(listener); };
	});
	const requested = Promise.withResolvers<ContextForkRequest>();
	const summary = Promise.withResolvers<ReturnType<typeof answer>>();
	const forks: ContextForkRequest[] = [];
	f.bus.on(CONTEXT_FORK, request => {
		const fork = request as unknown as ContextForkRequest;
		forks.push(fork); fork.offer(() => summary.promise); requested.resolve(fork);
	});
	const toolEntered = Promise.withResolvers<void>(); const toolReleased = Promise.withResolvers<void>();
	let executions = 0;
	f.bus.on("rqw-tools:subagent-tools", request => request.offer((() => [{
		...createBashToolDefinition(f.root), execute: async () => {
			executions++;
			if (executions === 50) { toolEntered.resolve(); await toolReleased.promise; }
			return { content: [{ type: "text", text: "DONE" }], details: {} };
		},
	}]) as never));
	const final = gate("FINAL");
	f.subReplies.push(...Array.from({ length: 50 }, (_, i) => toolUse(`t${i}`)), final.reply);
	await f.call({ ...f.params(), ...extra, tools: ["bash"] });
	const fork = await requested.promise;
	await toolEntered.promise;
	return { ...f, children, listeners, fork, forks, summary, final, executions: () => executions, releaseTool: () => toolReleased.resolve(),
		cleanupAll: async () => { toolReleased.resolve(); final.release(); summary.resolve(answer("cleanup")); await f.cleanup(); } };
}

test("progress fork uses the routed request effort instead of the selected effort", async () => {
	const f = await runningChild(f => {
		f.runtime.registerVirtualModel({
			provider: "progress-effort", id: "route", name: "Progress effort", thinkingLevels: ["off", "low", "medium"],
			route: () => ({ model: f.sub.getModel("s")!, thinkingLevel: "medium" }),
		});
		return { model: "progress-effort/route", thinking: "low" };
	});
	try {
		assert.equal(f.children[0].thinkingLevel, "low");
		const responses = f.children[0].messages.filter(m => m.role === "assistant");
		assert.equal(responses.at(-1)!.thinkingLevel, "medium");
		assert.equal(f.fork.reasoning, "medium");
	} finally { await f.cleanupAll(); }
});

test("50th message_end starts a nonblocking cache fork before its long tool finishes, with no child transcript injection", async () => {
	const f = await runningChild();
	try {
		assert.equal(f.requests.sub.length, 50); assert.equal(f.executions(), 50);
		assert.equal(savedSteps(f.session), 50);
		assert.equal(f.children[0].messages.filter(m => m.role === "toolResult").length, 49);
		const prefix = f.requests.sub[49].messages;
		assert.deepEqual(f.fork.context.messages.slice(0, -1), prefix);
		assert.match(String(f.fork.context.messages.at(-1)!.content), /"id":"t49"/);
		f.releaseTool();
		await until(() => f.final.entered(), "51st request while summary is still pending");
		assert.equal(f.requests.sub.length, 51); assert.equal(f.fork.signal.aborted, false);
		f.summary.resolve(answer("Summary of work"));
		await until(() => reports(f.session).length === 1, "progress notification delivered");
		assert.equal(f.delivered().length, 0, "progress does not complete the child");
		assert.equal(savedSteps(f.session), 0);
		assert.equal(f.children[0].messages.some(m => m.role === "custom" && m.customType === "agent_progress"), false);
		assert.equal(JSON.stringify(f.children[0].messages).includes("Summarize what you did"), false);
		f.final.release(); await until(() => f.delivered().length === 1, "normal final delivery");
		assert.deepEqual(f.delivered(), ["[agent#1] FINAL"]);
		assert.equal(reports(f.session).length, 1); assert.deepEqual(f.errors, []);
	} finally { await f.cleanupAll(); }
});

for (const action of ["final", "fail", "interrupt", "stop", "restart"] as const) {
	test(`${action} during summary drops the stale report before any final delivery`, async () => {
		const f = await runningChild();
		try {
			if (action === "final" || action === "fail") {
				if (action === "fail") {
					f.subReplies.length = 0;
					f.subReplies.push(answer("", { stopReason: "error", errorMessage: "failure" }));
				}
				f.releaseTool(); if (action === "final") f.final.release();
				await until(() => f.delivered().length === 1, "terminal delivery");
			} else await f.call({ action, id: "agent#1" });
			assert.equal(f.fork.signal.aborted, true);
			f.summary.resolve(answer("STALE REPORT")); await tick();
			assert.equal(reports(f.session).length, 0);
			assert.equal(f.delivered().some(text => text.includes("STALE REPORT")), false);
			if (action === "interrupt") assert.equal(savedSteps(f.session), 50, "interruption is not communication");
		} finally { await f.cleanupAll(); }
	});
}

test("successful send during summary resets persisted steps, status/wait do not, stale prose is discarded", async () => {
	const f = await runningChild();
	try {
		await f.call({ action: "status", ids: ["agent#1"] });
		assert.equal(savedSteps(f.session), 50); assert.equal(f.fork.signal.aborted, false);
		const receipt = JSON.parse(await f.call({ action: "wait", ids: ["agent#1"], timeout_ms: 10000 }));
		assert.equal(receipt.reason, "waiting"); assert.equal(savedSteps(f.session), 50);
		await f.call({ action: "send", id: "agent#1", task: "CORRECTION" });
		assert.equal(savedSteps(f.session), 0); assert.equal(f.fork.signal.aborted, true);
		f.summary.resolve(answer("STALE")); await tick(); assert.equal(reports(f.session).length, 0);
		f.releaseTool(); await until(() => f.final.entered(), "child continues after send");
		assert.match(JSON.stringify(f.requests.sub.at(-1)), /CORRECTION/);
	} finally { await f.cleanupAll(); }
});

for (const branch of ["completed child", "queued behind interrupt"] as const) {
	test(`successful send to ${branch} resets progress and triggers only after 50 fresh responses`, async () => {
		const f = await runningChild();
		const firstEntered = Promise.withResolvers<void>(); const firstReleased = Promise.withResolvers<void>();
		const fiftiethEntered = Promise.withResolvers<void>(); const fiftiethReleased = Promise.withResolvers<void>();
		const freshSummary = Promise.withResolvers<ReturnType<typeof answer>>();
		const final = gate("FRESH FINAL");
		f.bus.on(CONTEXT_FORK, request => (request as unknown as ContextForkRequest).offer(() => freshSummary.promise));
		try {
			assert.equal(savedSteps(f.session), 50); assert.equal(f.fork.signal.aborted, false);
			if (branch === "completed child") {
				f.releaseTool(); f.final.release();
				await until(() => f.delivered().length === 1 && f.children[0].isIdle, "original child completed and idle");
				assert.equal(savedSteps(f.session), 50, "completion itself does not reset communication history");
			}
			f.subReplies.length = 0;
			f.subReplies.push(async () => {
				firstEntered.resolve(); await firstReleased.promise; return toolUse("fresh-1");
			}, ...Array.from({ length: 48 }, (_, i) => toolUse(`fresh-${i + 2}`)), async () => {
				fiftiethEntered.resolve(); await fiftiethReleased.promise; return toolUse("fresh-50");
			}, final.reply);
			const sent = await f.call({ action: "send", id: "agent#1", task: "FRESH TASK", ...(branch === "queued behind interrupt" ? { interrupt: true } : {}) });
			assert.equal(sent, branch === "completed child" ? "agent#1: sent" : "agent#1: interrupted, sent");
			assert.equal(savedSteps(f.session), 0, "successful send persists the reset before the fresh response");
			assert.equal(f.fork.signal.aborted, true, "old summary cannot survive this generation");
			if (branch === "queued behind interrupt") {
				assert.equal(f.requests.sub.length, 50, "replacement stays queued behind the tool that ignores abort");
				assert.equal(f.children[0].isIdle, false);
				f.releaseTool();
			}
			await firstEntered.promise;
			assert.equal(savedSteps(f.session), 0);
			f.summary.resolve(answer("STALE ORIGINAL REPORT")); await tick();
			assert.equal(reports(f.session).length, 0); assert.equal(f.forks.length, 1);
			firstReleased.resolve(); await fiftiethEntered.promise;
			assert.equal(savedSteps(f.session), 49); assert.equal(f.forks.length, 1, "49 fresh responses must not trigger");
			fiftiethReleased.resolve(); await until(final.entered, "50th fresh response and next request");
			assert.equal(savedSteps(f.session), 50); assert.equal(f.forks.length, 2, "exactly one fresh 50-step trigger");
			assert.notEqual(f.forks[1].signal, f.fork.signal); assert.equal(f.forks[1].signal.aborted, false);
			freshSummary.resolve(answer("FRESH REPORT"));
			await until(() => reports(f.session).length === 1, "fresh report delivered");
			assert.match(JSON.stringify(reports(f.session)), /FRESH REPORT/);
			assert.equal(JSON.stringify(reports(f.session)).includes("STALE ORIGINAL REPORT"), false);
			assert.equal(savedSteps(f.session), 0); assert.deepEqual(f.errors, []);
		} finally {
			firstReleased.resolve(); fiftiethReleased.resolve(); freshSummary.resolve(answer("cleanup")); final.release();
			await f.cleanupAll();
		}
	});
}

test("compaction_start during generation cancels only the snapshot and preserves count", async () => {
	const f = await runningChild();
	try {
		// Inject the documented public event at the actual session subscribers, without invoking a model compaction.
		for (const listener of f.listeners) listener({ type: "compaction_start", reason: "threshold" });
		assert.equal(f.fork.signal.aborted, true); assert.equal(savedSteps(f.session), 50);
		f.summary.resolve(answer("PRE-COMPACTION REPORT")); await tick();
		assert.equal(reports(f.session).length, 0);
		f.releaseTool(); await until(f.final.entered, "child continues after snapshot cancellation");
		assert.equal(savedSteps(f.session), 50);
	} finally { await f.cleanupAll(); }
});

test("public resource discovery offers the progress skill while child noSkills receives the reminder in its notification", async () => {
	const f = await fixture();
	try {
		const resources = await f.session.extensionRunner.emitResourcesDiscover(f.root, "reload");
		assert.ok(resources.skillPaths.some(skill => skill.path === PROGRESS_SKILL_PATH));
	} finally { await f.cleanup(); }
});

test("model selection during generation cancels only the snapshot and preserves count", async () => {
	const f = await runningChild();
	try {
		await f.children[0].setModel(f.main.getModel("m"));
		assert.equal(f.fork.signal.aborted, true); assert.equal(savedSteps(f.session), 50);
		f.summary.resolve(answer("OLD MODEL REPORT")); await tick(); assert.equal(reports(f.session).length, 0);
		assert.equal(f.executions(), 50, "the held tool is unaffected");
	} finally { await f.cleanupAll(); }
});

test("busy parent keeps progress outside clearQueue, abort persists it quietly and next owner input consumes it once", async () => {
	const f = await runningChild(); const busy = gate("ABORTED MAIN"); let turn: Promise<void> | undefined;
	try {
		f.mainReplies.push(busy.reply);
		turn = f.session.prompt("MAIN WORK"); await until(busy.entered, "busy parent");
		f.summary.resolve(answer("BUSY REPORT"));
		await until(() => savedSteps(f.session) === 0, "report accepted by safe sender");
		assert.equal(f.session.agent.hasQueuedMessages(), false, "no clearable follow-up holds the notification");
		f.session.clearQueue(); await f.session.abort(); await turn;
		await until(() => reports(f.session).length === 1, "report persisted at abort settlement");
		await tick(); assert.equal(f.requests.main.length, 1, "aborted parent is not woken");
		await f.session.prompt("OWNER CONTINUES");
		assert.equal(f.requests.main.length, 2); assert.match(JSON.stringify(f.requests.main[1]), /BUSY REPORT/);
		assert.equal(reports(f.session).length, 1);
	} finally { busy.release(); await turn; await f.cleanupAll(); }
});

test("a parent waiting for final results sees progress independently and final wait ownership stays intact", async () => {
	const f = await runningChild();
	try {
		f.mainReplies.push(answer([fauxToolCall("agent", { action: "wait", ids: ["agent#1"], timeout_ms: 10000 }, { id: "wait-final" })], { stopReason: "toolUse" }));
		await f.session.prompt("WAIT");
		assert.equal(f.requests.main.length, 1);
		f.summary.resolve(answer("STILL WORKING"));
		await until(() => reports(f.session).length === 1 && f.requests.main.length === 2, "waiting parent notified");
		assert.equal(f.session.messages.some(m => m.role === "custom" && m.customType === "child_wait"), false);
		f.releaseTool(); f.final.release();
		await until(() => f.session.messages.some(m => m.role === "custom" && m.customType === "child_wait"), "final wait notification");
		assert.deepEqual(f.delivered(), [], "the wait, not the progress message, owns the final answer");
		const result = f.session.messages.find(m => m.role === "custom" && m.customType === "child_wait");
		assert.ok(result && result.role === "custom");
		const payload = JSON.parse(result.content as string);
		assert.equal(payload.reason, "result"); assert.equal(payload.results[0].text, "FINAL");
		assert.equal(reports(f.session).length, 1);
	} finally { await f.cleanupAll(); }
});

test("nested child sends progress only to its direct parent through the durable inbox", async () => {
	const f = await fixture();
	const sessions: AgentSession[] = [];
	f.bus.on("rqw-codex:session-policy", request => sessions.push((request as unknown as { session: AgentSession }).session));
	const summary = Promise.withResolvers<ReturnType<typeof answer>>(); const forked = Promise.withResolvers<void>();
	f.bus.on(CONTEXT_FORK, data => { (data as unknown as ContextForkRequest).offer(() => summary.promise); forked.resolve(); });
	let calls = 0;
	const held = Promise.withResolvers<void>(); const entered = Promise.withResolvers<void>();
	f.bus.on("rqw-tools:subagent-tools", request => request.offer((() => [{ ...createBashToolDefinition(f.root), execute: async () => {
		calls++; if (calls === 50) { entered.resolve(); await held.promise; }
		return { content: [{ type: "text", text: "ok" }], details: {} };
	} }]) as never));
	// Requests share the faux provider; decide replies by the child's system prompt, not scheduling.
	// The first child ends a native run while its descendant keeps the assignment open.
	let parentCalls = 0, deepCalls = 0;
	const decide = async (context: any) => {
		const deep = context.messages.some((m: any) => m.role === "system" && m.content === "DEEP");
		if (deep) { deepCalls++; return deepCalls <= 50 ? toolUse(`deep-${deepCalls}`) : answer("DEEP FINAL"); }
		parentCalls++;
		if (parentCalls === 1) return answer([fauxToolCall("agent", { action: "start", task: "GRANDCHILD", system: "DEEP", tools: ["bash"] }, { id: "start-deep" })], { stopReason: "toolUse" });
		return answer("PARENT FINAL");
	};
	f.subReplies.push(...Array.from({ length: 60 }, () => decide));
	try {
		await f.start(); await forked.promise; await entered.promise;
		assert.equal(sessions.length, 2);
		summary.resolve(answer("DEEP PROGRESS"));
		await until(() => sessions[0].sessionManager.getBranch().some(e => e.type === "custom" && e.customType === "rqw-agent-inbox"), "direct parent durable inbox entry");
		await until(() => reports(sessions[0]).length === 1, "direct parent consumes report");
		assert.equal(reports(f.session).length, 0); assert.equal(reports(sessions[1]).length, 0);
		assert.equal(JSON.stringify(sessions[1].messages).includes("DEEP PROGRESS"), false);
		held.resolve(); await until(() => f.delivered().length === 1, "nested final delivery");
		assert.equal(f.delivered()[0], "[agent#1] PARENT FINAL");
		assert.deepEqual(f.errors, []);
	} finally { held.resolve(); summary.resolve(answer("cleanup")); await f.cleanup(); }
});
