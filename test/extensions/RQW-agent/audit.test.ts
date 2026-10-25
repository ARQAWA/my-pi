import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSession, DefaultResourceLoader, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { fauxToolCall } from "@earendil-works/pi-ai";
import { answer, fixture, gate, texts, tick, until } from "./audit-fixture.ts";

test("F1: main abort returns before held auth; neither queued start can run later", async () => {
	const auth = Promise.withResolvers<void>();
	const f = await fixture("rpc", auth.promise);
	f.mainReplies.push(answer(["A", "B"].map((task, i) => fauxToolCall("agent", f.params(task), { id: `start-${i}` })), { stopReason: "toolUse" }));
	let executing = 0;
	f.session.subscribe(e => { if (e.type === "tool_execution_start" && e.toolName === "agent") executing++; });
	const running = f.session.prompt("GO");
	try {
		await until(() => executing === 2 && f.authEntered() > 0, "both calls dispatched, auth held");
		let returned = false;
		const aborting = f.session.abort().then(() => { returned = true; });
		await until(() => returned, "abort returns without auth");
		await aborting;
		await running;
		assert.equal(f.requests.sub.length, 0);
		auth.resolve();
		await tick(100);
		assert.equal(f.requests.sub.length, 0, "late auth cannot create or start a child");
		assert.deepEqual(f.delivered(), []);
	} finally { auth.resolve(); await running; await f.cleanup(); }
});

test("F1: capture caller and tool-context signals before the internal queue, for every action", async () => {
	for (const source of ["caller", "context"] as const) {
		const auth = Promise.withResolvers<void>();
		const f = await fixture("rpc", auth.promise);
		const first = new AbortController(), queued = new AbortController();
		let current = queued.signal;
		const ctx = { ...f.session.extensionRunner.createContext(), get signal() { return current; } };
		const pending = f.start("FIRST", first.signal);
		const firstRejected = assert.rejects(pending, /abort/i);
		try {
			await until(() => f.authEntered() > 0, "first action held");
			const calls = [f.params("QUEUED"), ...["send", "restart", "interrupt", "stop"].map(action => ({ action, id: "1", task: "NO" }))]
				.map(params => assert.rejects(f.call(params, source === "caller" ? queued.signal : undefined,
					source === "context" ? ctx : f.session.extensionRunner.createContext()), /abort/i));
			queued.abort();
			current = new AbortController().signal; // The getter no longer exposes the canceled caller's run.
			await Promise.all(calls);
			first.abort();
			await firstRejected;
			auth.resolve();
			await tick(100);
			assert.equal(f.requests.sub.length, 0);
			assert.deepEqual(f.delivered(), []);
		} finally { first.abort(); auth.resolve(); await firstRejected; await f.cleanup(); }
	}
});

test("F1: cancellation during loader reload cannot proceed to the factory or child creation", async () => {
	const f = await fixture();
	const controller = new AbortController();
	const held = Promise.withResolvers<void>();
	let entered = false, offers = 0;
	const reload = DefaultResourceLoader.prototype.reload;
	DefaultResourceLoader.prototype.reload = async function () { entered = true; await held.promise; await reload.call(this); };
	const off = f.bus.on("rqw-tools:subagent-tools", request => { offers++; request.offer(() => []); });
	try {
		const rejected = assert.rejects(f.start("NO", controller.signal), /abort/i);
		await until(() => entered, "loader entered");
		controller.abort();
		await rejected;
		held.resolve();
		await tick(100);
		assert.equal(offers, 0);
		assert.equal(f.requests.sub.length, 0);
	} finally { held.resolve(); DefaultResourceLoader.prototype.reload = reload; off(); await f.cleanup(); }
});

test("F1: cancellation inside the optional factory prevents session construction", async () => {
	const f = await fixture();
	const controller = new AbortController();
	let constructed = 0;
	const subscribe = AgentSession.prototype.subscribe;
	AgentSession.prototype.subscribe = function (listener) { constructed++; return subscribe.call(this, listener); };
	const off = f.bus.on("rqw-tools:subagent-tools", request => request.offer(() => { controller.abort(); return []; }));
	try {
		await assert.rejects(f.start("NO", controller.signal), /abort/i);
		await tick();
		assert.equal(constructed, 0);
		assert.equal(f.requests.sub.length, 0);
	} finally { AgentSession.prototype.subscribe = subscribe; off(); await f.cleanup(); }
});

test("F1: a session materialized after cancellation is disposed and never starts", async () => {
	const f = await fixture();
	const controller = new AbortController();
	const proto = AgentSession.prototype as unknown as { _buildRuntime: (...args: unknown[]) => unknown };
	const build = proto._buildRuntime, dispose = AgentSession.prototype.dispose;
	let created: AgentSession | undefined, disposed = false;
	proto._buildRuntime = function (...args) { const result = build.apply(this, args); created = this as unknown as AgentSession; controller.abort(); return result; };
	AgentSession.prototype.dispose = function () { if (this === created) disposed = true; return dispose.call(this); };
	try {
		await assert.rejects(f.start("NO", controller.signal), /abort/i);
		await until(() => disposed, "late-created child disposed");
		assert.ok(created);
		assert.equal(f.requests.sub.length, 0);
		await assert.rejects(f.call({ action: "send", id: "1", task: "NO" }), /Unknown agent id/);
	} finally { proto._buildRuntime = build; AgentSession.prototype.dispose = dispose; await f.cleanup(); }
});

test("F1: pending SDK prompt auth is fenced after main cancellation; only the new child is closed", async () => {
	const f = await fixture();
	const independent = gate("INDEPENDENT");
	f.subReplies.push(independent.reply);
	await f.start("ACCEPTED");
	await until(() => independent.entered(), "accepted child running");
	const hold = Promise.withResolvers<void>();
	const controller = new AbortController();
	const registry = f.session.extensionRunner.createContext().modelRegistry;
	const configured = registry.hasConfiguredAuth.bind(registry), runtimeConfigured = f.runtime.hasConfiguredAuth.bind(f.runtime);
	const checkAuth = f.runtime.checkAuth.bind(f.runtime);
	let authEntered = false;
	registry.hasConfiguredAuth = () => true; // Enter the SDK's own prompt preflight, not resolveConfig.
	f.runtime.hasConfiguredAuth = provider => provider === f.sub.provider.id ? false : runtimeConfigured(provider);
	f.runtime.checkAuth = async (provider, options) => {
		if (provider === f.sub.provider.id) { authEntered = true; await hold.promise; }
		return checkAuth(provider, options);
	};
	try {
		const rejected = assert.rejects(f.start("UNACCEPTED", controller.signal), /abort/i);
		await until(() => authEntered, "child prompt auth held");
		controller.abort();
		await rejected;
		assert.equal(independent.aborted(), false);
		hold.resolve();
		await tick(150);
		assert.equal(f.requests.sub.length, 1, "abandoned SDK prompt cannot infer after auth");
		await assert.rejects(f.call({ action: "send", id: "2", task: "NO" }), /Unknown agent id/);
		assert.equal(await f.call({ action: "send", id: "1", task: "FOLLOW" }), "agent#1: queued after the current tool call");
		assert.equal(independent.aborted(), false);
	} finally { hold.resolve(); registry.hasConfiguredAuth = configured; f.runtime.hasConfiguredAuth = runtimeConfigured; f.runtime.checkAuth = checkAuth; await f.cleanup(); }
});

test("F2: a failed replacement invalidates the old id and cannot send through the disposed session", async () => {
	const f = await fixture();
	const child = gate("OLD");
	f.subReplies.push(child.reply);
	let off = () => {};
	try {
		await f.start();
		await until(() => child.entered(), "old child running");
		await f.call({ action: "send", id: "1", task: "OLD_QUEUED" });
		off = f.bus.on("rqw-tools:subagent-tools", request => request.offer(() => { throw new Error("factory failed"); }));
		await assert.rejects(f.call({ action: "restart", id: "1", task: "REPLACEMENT" }), /factory failed/);
		off();
		await until(() => child.aborted(), "old child aborted");
		for (const action of ["send", "restart", "interrupt", "stop"])
			await assert.rejects(f.call({ action, id: "1", task: "NO" }), /Unknown agent id/);
		await tick(100);
		assert.equal(f.requests.sub.length, 1);
		assert.deepEqual(f.delivered(), []);
		assert.equal(await f.start("NEXT"), "agent#2 started");
	} finally { off(); await f.cleanup(); }
});

test("F3: terminal length preserves partial text, explicit truncation and final compaction failure", async () => {
	const f = await fixture();
	try {
		const big = "x ".repeat(60000);
		f.subReplies.push(answer("ONE"), answer("TWO"));
		await f.start(big);
		await until(() => f.delivered().length === 1, "first seed");
		await f.call({ action: "send", id: "1", task: big });
		await until(() => f.delivered().length === 2, "second seed");
		f.subReplies.push(answer("PARTIAL_INCOMPLETE", { stopReason: "length" }), answer("", { stopReason: "error", errorMessage: "bad request: summary failed" }));
		await f.call({ action: "send", id: "1", task: "THIRD" });
		await until(() => f.delivered().length === 3, "terminal result");
		assert.equal(f.requests.sub.length, 4);
		assert.match(f.delivered()[2], /^\[agent#1\] PARTIAL_INCOMPLETE\n\nerror: Response was truncated:/);
		assert.match(f.delivered()[2], /error: Context overflow recovery failed: .*summary failed/);
	} finally { await f.cleanup(); }
});

test("F3: length without recovery has a marker even with empty text; follow-up finals are kept", async () => {
	for (const partial of ["PARTIAL", ""]) {
		const f = await fixture();
		const g = gate();
		f.subReplies.push(async (ctx, options) => { await g.reply(ctx, options); return answer(partial, { stopReason: "length" }); }, answer("FINAL_FOLLOWUP"));
		try {
			await f.start();
			await until(() => g.entered(), "length request");
			await f.call({ action: "send", id: "1", task: "FOLLOW" });
			g.release();
			await until(() => f.delivered().length === 1, "length and follow-up");
			assert.match(f.delivered()[0], /error: Response was truncated:/);
			assert.ok(f.delivered()[0].endsWith("\n\nFINAL_FOLLOWUP"));
			if (partial) assert.ok(f.delivered()[0].includes(partial));
			assert.equal(f.requests.sub.length, 2);
		} finally { g.release(); await f.cleanup(); }
	}
});

for (const mode of ["print", "json"] as const) test(`F4: ${mode} main abort returns while an accepted independent child is still held`, async () => {
	const f = await fixture(mode);
	const child = gate();
	f.subReplies.push(child.reply);
	f.mainReplies.push(answer([fauxToolCall("agent", f.params("LONG"))], { stopReason: "toolUse" }), answer("STARTED"));
	let waiting = false;
	f.session.subscribe(e => { if (e.type === "message_end" && e.message.role === "assistant" && e.message.content.some(c => c.type === "text" && c.text === "STARTED")) waiting = true; });
	const running = f.session.prompt("GO");
	try {
		await until(() => child.entered() && waiting, "main waiting for child");
		let returned = false;
		const aborting = f.session.abort().then(() => { returned = true; });
		await until(() => returned, "abort before child release");
		await aborting;
		await running;
		assert.equal(child.aborted(), false);
		assert.deepEqual(f.delivered(), []);
		child.release();
		await until(() => f.delivered().length === 1, "late result preserved");
		await tick(100);
		assert.equal(f.requests.main.length, 2);
	} finally { child.release(); await running; await f.cleanup(); }
});

for (const mode of ["tui", "rpc"] as const) test(`late AFTER ${mode} abort stays idle and is seen exactly once on the next main run`, async () => {
	const f = await fixture(mode);
	const child = gate("LATE_AFTER_ABORT"), busy = gate("MAIN_BUSY");
	f.subReplies.push(child.reply);
	f.mainReplies.push(answer([fauxToolCall("agent", f.params())], { stopReason: "toolUse" }), busy.reply);
	const running = f.session.prompt("GO");
	try {
		await until(() => child.entered() && busy.entered(), "main and child busy");
		if (mode === "tui") f.session.clearQueue();
		await f.session.abort();
		await running;
		assert.equal(child.aborted(), false, "accepted child remains independent");
		child.release();
		await until(() => f.delivered().length === 1, "late result");
		await tick(100);
		assert.equal(f.requests.main.length, 2, "late result must not wake an aborted main");
		assert.equal(f.session.agent.hasQueuedMessages(), false);
		await f.session.prompt("NEXT");
		assert.equal(f.requests.main.length, 3);
		assert.equal(texts(f.requests.main[2]).filter(t => t === "[agent#1] LATE_AFTER_ABORT").length, 1);
		assert.deepEqual(f.delivered(), ["[agent#1] LATE_AFTER_ABORT"]);
		// The latch ends at a new main run. A later ordinary idle delivery wakes it again.
		f.subReplies.push(answer("AFTER_NEW_RUN"));
		await f.call({ action: "send", id: "1", task: "MORE" });
		await until(() => f.requests.main.length === 4, "normal idle wake restored");
	} finally { child.release(); busy.release(); await running; await f.cleanup(); }
});

test("F5: result bodies cannot poison ids; reload and shutdown keep both live children", async () => {
	const f = await fixture();
	const one = gate("ONE"), two = gate("TWO");
	f.subReplies.push(one.reply, two.reply);
	try {
		f.session.sessionManager.appendCustomMessageEntry("agent", "[agent#1] sample source: agent#9007199254740992", true);
		f.session.sessionManager.appendCustomMessageEntry("agent", "unowned agent#888", true);
		f.session.sessionManager.appendCustomMessageEntry("agent", "[agent#9007199254740992] unsafe outer", true);
		f.session.sessionManager.appendCustomEntry("agent", { id: Infinity });
		f.session.refreshContext();
		await f.session.reload();
		assert.equal(await f.start("ONE"), "agent#2 started");
		assert.equal(await f.start("TWO"), "agent#3 started");
		await until(() => one.entered() && two.entered(), "both unique children");
		await f.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await until(() => one.aborted() && two.aborted(), "both tracked children aborted");
	} finally { one.release(); two.release(); await f.cleanup(); }
});

test("F5: issued ids are immediately persisted even without an outer agent tool result", async () => {
	const f = await fixture();
	try {
		assert.equal(await f.start(), "agent#1 started");
		const entries = f.session.sessionManager.getEntries();
		assert.ok(entries.some(e => e.type === "custom" && e.customType === "agent" && (e.data as { id?: unknown }).id === 1));
		assert.equal(entries.some(e => e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "agent"), false);
		await until(() => f.session.isIdle && f.delivered().length === 1, "idle before reload");
		await f.session.reload();
		assert.equal(await f.start(), "agent#2 started");
	} finally { await f.cleanup(); }
});

test("F5: safe maximum id refuses increment before constructing or overwriting any child", async () => {
	const f = await fixture();
	try {
		f.session.sessionManager.appendCustomEntry("agent", { id: Number.MAX_SAFE_INTEGER });
		f.session.sessionManager.appendCustomEntry("agent", { id: Number.MAX_SAFE_INTEGER + 1 });
		await f.session.reload();
		await assert.rejects(f.start(), /id space exhausted/);
		await assert.rejects(f.start(), /id space exhausted/);
		assert.equal(f.requests.sub.length, 0);
		assert.deepEqual(f.errors, []);
	} finally { await f.cleanup(); }
});
