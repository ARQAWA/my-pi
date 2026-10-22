import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { answer, fixture, gate, tick, until } from "./audit-fixture.ts";

// Hold real SDK prompt auth after extension-level config auth has already succeeded.
function promptAuth(f: Awaited<ReturnType<typeof fixture>>) {
	const held = Promise.withResolvers<void>();
	const registry = f.session.extensionRunner.createContext().modelRegistry;
	const configured = registry.hasConfiguredAuth.bind(registry);
	const runtimeConfigured = f.runtime.hasConfiguredAuth.bind(f.runtime);
	const check = f.runtime.checkAuth.bind(f.runtime);
	let entered = false;
	registry.hasConfiguredAuth = () => true;
	f.runtime.hasConfiguredAuth = provider => provider === f.sub.provider.id ? false : runtimeConfigured(provider);
	f.runtime.checkAuth = async (provider, options) => {
		if (provider === f.sub.provider.id) { entered = true; await held.promise; }
		return check(provider, options);
	};
	return { entered: () => entered, release: () => held.resolve(), restore: () => {
		registry.hasConfiguredAuth = configured; f.runtime.hasConfiguredAuth = runtimeConfigured; f.runtime.checkAuth = check;
	} };
}

test("F1: pending idle send cancellation keeps the child valid and fences late pre-run compaction", async () => {
	const f = await fixture();
	const child = gate("INTERRUPTED");
	f.subReplies.push(child.reply);
	let subSession: AgentSession | undefined;
	const subscribe = AgentSession.prototype.subscribe;
	AgentSession.prototype.subscribe = function (listener) {
		if (this !== f.session) subSession = this;
		return subscribe.call(this, listener);
	};
	let auth: ReturnType<typeof promptAuth> | undefined;
	try {
		await f.start("x".repeat(500000));
		await until(() => child.entered(), "large child request");
		await f.call({ action: "interrupt", id: "1" });
		await tick(); // Explicit interruption is a request, not a promise of synchronous settlement.
		assert.ok(subSession);
		auth = promptAuth(f);
		const controller = new AbortController();
		const rejected = assert.rejects(f.call({ action: "send", id: "1", task: "CANCELED" }, controller.signal), /abort/i);
		await until(auth.entered, "idle-send prompt auth");
		controller.abort();
		await rejected;
		auth.release();
		await tick(200);
		assert.equal(f.requests.sub.length, 1, "neither summary nor inference from canceled preflight");
		assert.equal(subSession.isIdle, true);
		assert.deepEqual(f.delivered(), []);
		assert.equal(await f.call({ action: "interrupt", id: "1" }), "agent#1 is idle", "existing child was not disposed or forgotten");
	} finally { auth?.release(); auth?.restore(); AgentSession.prototype.subscribe = subscribe; await f.cleanup(); }
});

test("F1/F2: cancellation during replacement preflight leaves the id invalid and closes only the replacement", async () => {
	const f = await fixture();
	const old = gate("OLD"), independent = gate("INDEPENDENT");
	f.subReplies.push(old.reply, independent.reply);
	await f.start("OLD");
	await f.start("OTHER");
	await until(() => old.entered() && independent.entered(), "two accepted children");
	const auth = promptAuth(f);
	const controller = new AbortController();
	try {
		const rejected = assert.rejects(f.call({ action: "restart", id: "1", task: "REPLACEMENT" }, controller.signal), /abort/i);
		await until(auth.entered, "replacement prompt auth");
		controller.abort();
		await rejected;
		await until(() => old.aborted(), "old child closed");
		assert.equal(independent.aborted(), false);
		auth.release();
		await tick(150);
		assert.equal(f.requests.sub.length, 2, "late replacement does not infer");
		await assert.rejects(f.call({ action: "send", id: "1", task: "NO" }), /Unknown agent id/);
		assert.equal(await f.call({ action: "send", id: "2", task: "MORE" }), "agent#2: queued after the current run");
	} finally { auth.release(); auth.restore(); await f.cleanup(); }
});

test("F5: reload recovers metadata-only nested-style allocation before any result exists", async () => {
	const f = await fixture();
	const child = gate("NEVER_DELIVERED");
	f.subReplies.push(child.reply);
	try {
		assert.equal(await f.start(), "agent#1 started");
		await until(() => child.entered(), "first child held");
		assert.deepEqual(f.delivered(), []);
		assert.equal(f.session.sessionManager.getEntries().some(e => e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "agent"), false);
		await f.session.reload();
		await until(() => child.aborted(), "reload closes old child");
		assert.deepEqual(f.delivered(), []);
		assert.equal(await f.start(), "agent#2 started");
	} finally { await f.cleanup(); }
});

test("F5: legacy valid outer tool ids survive, but error and body mentions do not reserve ids", async () => {
	const f = await fixture();
	try {
		for (const [i, text] of ["agent#7 started", "Unknown agent id: agent#9007199254740991", "agent#8 made-up body agent#999"].entries()) {
			f.session.sessionManager.appendMessage({ role: "toolResult", toolCallId: `legacy-${i}`, toolName: "agent",
				content: [{ type: "text", text }], isError: i > 0, timestamp: Date.now() });
		}
		f.session.sessionManager.appendCustomMessageEntry("agent", "[agent#4] source agent#9999", true);
		await f.session.reload();
		assert.equal(await f.start(), "agent#8 started");
	} finally { await f.cleanup(); }
});

test("F3: partial text, terminal compaction error and a follow-up final all survive", async () => {
	const f = await fixture();
	const g = gate("PARTIAL");
	const subscribe = AgentSession.prototype.subscribe;
	let following: Promise<string> | undefined;
	let attached = false;
	AgentSession.prototype.subscribe = function (listener) {
		if (this !== f.session && !attached) {
			attached = true;
			subscribe.call(this, event => {
				if (event.type === "compaction_end" && !event.willRetry && event.errorMessage && !following)
					following = f.call({ action: "send", id: "1", task: "FOLLOW" });
			});
		}
		return subscribe.call(this, listener);
	};
	try {
		const big = "x ".repeat(60000);
		f.subReplies.push(answer("ONE"), answer("TWO"));
		await f.start(big);
		await until(() => f.delivered().length === 1, "first seed");
		await f.call({ action: "send", id: "1", task: big });
		await until(() => f.delivered().length === 2, "second seed");
		f.subReplies.push(async (ctx, options) => { await g.reply(ctx, options); return answer("PARTIAL", { stopReason: "length" }); },
			answer("", { stopReason: "error", errorMessage: "bad request: terminal summary failure" }), answer("FOLLOWUP_FINAL"));
		await f.call({ action: "send", id: "1", task: "THIRD" });
		await until(() => g.entered(), "third request held");
		g.release();
		await until(() => f.delivered().length === 3, "result with final summary error and follow-up");
		assert.ok(following, "follow-up dispatched after terminal compaction failure");
		await following;
		assert.match(f.delivered()[2], /^\[agent#1\] PARTIAL\n\nerror: Response was truncated:/);
		assert.match(f.delivered()[2], /error: Context overflow recovery failed: .*terminal summary failure/);
		assert.ok(f.delivered()[2].indexOf("\n\nFOLLOWUP_FINAL") > f.delivered()[2].indexOf("terminal summary failure"), "the genuine follow-up answer stays after the final recovery error");
	} finally { g.release(); AgentSession.prototype.subscribe = subscribe; await f.cleanup(); }
});

test("F3: successful compaction drops an empty truncated follow-up attempt, not an earlier genuine final", async () => {
	const f = await fixture();
	const g = gate("GENUINE_THIRD_FINAL");
	try {
		const big = "x ".repeat(60000);
		f.subReplies.push(answer("ONE"), answer("TWO"));
		await f.start(big);
		await until(() => f.delivered().length === 1, "first seed");
		await f.call({ action: "send", id: "1", task: big });
		await until(() => f.delivered().length === 2, "second seed");
		f.subReplies.push(g.reply, answer("", { stopReason: "length" }), answer("SUMMARY"), answer("RECOVERED_FOLLOWUP"));
		await f.call({ action: "send", id: "1", task: "THIRD" });
		await until(() => g.entered(), "third request held");
		await f.call({ action: "send", id: "1", task: "FOLLOW" });
		g.release();
		await until(() => f.delivered().length === 3, "successful follow-up recovery");
		assert.equal(f.delivered()[2], "[agent#1] GENUINE_THIRD_FINAL\n\nRECOVERED_FOLLOWUP");
		assert.equal(f.requests.sub.length, 6, "two seeds, genuine final, length, summary and retry");
	} finally { g.release(); await f.cleanup(); }
});

test("F1: abort at the SDK preflight handoff cannot admit or infer an unaccepted child", async () => {
	const f = await fixture();
	const controller = new AbortController();
	const prompt = AgentSession.prototype.prompt;
	AgentSession.prototype.prompt = function (text, options) {
		if (this === f.session) return prompt.call(this, text, options);
		return prompt.call(this, text, { ...options, preflightResult: result => {
			options?.preflightResult?.(result);
			controller.abort();
		} });
	};
	try {
		await assert.rejects(f.start("UNACCEPTED", controller.signal), /abort/i);
		await tick(150);
		assert.equal(f.requests.sub.length, 0);
		assert.deepEqual(f.delivered(), []);
		await assert.rejects(f.call({ action: "send", id: "1", task: "NO" }), /Unknown agent id/);
	} finally { AgentSession.prototype.prompt = prompt; await f.cleanup(); }
});
