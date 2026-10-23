// SDK-level supervision: real sessions, faux providers and explicit caller waits. No model/network calls.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { AgentSession, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { answer, fixture, gate, tick, until, texts } from "./audit-fixture.ts";

function waits(session: AgentSession) {
	return session.messages.flatMap(m => {
		if (m.role !== "toolResult" || m.toolName !== "agent") return [];
		const text = m.content.filter(c => c.type === "text").map(c => c.text).join("");
		return text.startsWith("{") ? [JSON.parse(text)] : [];
	});
}

async function workerProvider(f: Awaited<ReturnType<typeof fixture>>) {
	const provider = fauxProvider({ provider: "anthropic", api: "supervision-worker", models: [{ id: "claude-haiku-5-5", reasoning: true }] });
	const held = gate("WORKER_DONE");
	provider.setResponses([held.reply]);
	f.runtime.registerNativeProvider(provider.provider);
	return held;
}

test("default error alert wakes without consuming terminal result; its later push and receipt survive", async () => {
	const f = await fixture(), held = gate();
	const failure = "400 invalid_request_error: ALERT_ERROR_MARK";
	f.subReplies.push(async (context, options) => {
		await held.reply(context, options);
		return answer("", { stopReason: "error", errorMessage: failure });
	});
	f.mainReplies.push(
		answer([fauxToolCall("agent", f.params())], { stopReason: "toolUse" }),
		answer([fauxToolCall("agent", { action: "wait", ids: ["agent#1"], timeout_ms: 10000 })], { stopReason: "toolUse" }),
		answer("ALERT_ACKNOWLEDGED"),
	);
	try {
		const run = f.session.prompt("GO");
		await until(() => held.entered() && f.requests.main.length === 2, "wait before provider failure");
		await tick(); held.release(); await run;
		const [alert] = waits(f.session);
		assert.equal(alert.reason, "alert");
		assert.deepEqual(alert.results, []);
		assert.deepEqual(alert.receipts, []);
		assert.ok(alert.statuses[0].alerts.some((a: any) => a.kind === "error" && a.detail === failure));
		await until(() => f.delivered().length === 1, "terminal error delivery after alert");
		assert.deepEqual(f.delivered(), [`[agent#1] error: ${failure}`]);
		const receipt = JSON.parse(await f.call({ action: "wait", ids: ["agent#1"], timeout_ms: 1 }));
		assert.equal(receipt.reason, "receipt");
		assert.equal(receipt.receipts[0].delivered_via, "message");
		assert.deepEqual(receipt.results, []);
		await tick(); assert.equal(f.delivered().length, 1);
	} finally { held.release(); await f.cleanup(); }
});

test("wake_on_alert false retains terminal wait delivery and makes no duplicate push", async () => {
	const f = await fixture(), held = gate();
	f.subReplies.push(async (context, options) => {
		await held.reply(context, options);
		return answer("", { stopReason: "error", errorMessage: "400 invalid_request_error: TERMINAL_ONLY" });
	});
	f.mainReplies.push(
		answer([fauxToolCall("agent", f.params())], { stopReason: "toolUse" }),
		answer([fauxToolCall("agent", { action: "wait", ids: ["agent#1"], timeout_ms: 10000, wake_on_alert: false })], { stopReason: "toolUse" }),
		answer("GOT_TERMINAL"),
	);
	try {
		const run = f.session.prompt("GO");
		await until(() => held.entered() && f.requests.main.length === 2, "terminal-only wait");
		await tick(); held.release(); await run;
		const [result] = waits(f.session);
		assert.equal(result.reason, "result");
		assert.equal(result.results.length, 1);
		assert.equal(result.results[0].outcome, "error");
		assert.equal(result.results[0].text, "error: 400 invalid_request_error: TERMINAL_ONLY");
		assert.ok(result.statuses[0].alerts.some((a: any) => a.kind === "error"));
		await tick(); assert.deepEqual(f.delivered(), []);
	} finally { held.release(); await f.cleanup(); }
});

test("until all holds mixed agent/worker completions without pushing the first result", async () => {
	const f = await fixture(), child = gate("AGENT_DONE"), worker = await workerProvider(f);
	f.subReplies.push(child.reply);
	f.mainReplies.push(
		answer([
			fauxToolCall("agent", f.params(), { id: "start-agent" }),
			fauxToolCall("code_writer", { task: "WORKER_TASK" }, { id: "start-worker" }),
		], { stopReason: "toolUse" }),
		answer([fauxToolCall("agent", { action: "wait", ids: ["agent#1", "code_writer#1"], timeout_ms: 10000, until: "all", wake_on_alert: false })], { stopReason: "toolUse" }),
		answer("GOT_BOTH"),
	);
	try {
		const run = f.session.prompt("GO");
		await until(() => child.entered() && worker.entered() && f.requests.main.length === 2, "mixed all wait");
		await tick(); child.release();
		await tick();
		const firstStatus = JSON.parse(await f.call({ action: "status", ids: ["agent#1"] })).statuses[0];
		assert.equal(firstStatus.state, "idle");
		assert.equal(f.requests.main.length, 2, "caller stays mechanically parked after first completion");
		assert.deepEqual(f.delivered(), []);
		assert.equal(f.session.messages.some(m => m.role === "custom" && m.customType === "code_writer"), false);
		worker.release(); await run;
		const [result] = waits(f.session);
		assert.equal(result.reason, "result");
		assert.deepEqual(result.results.map((r: any) => [r.id, r.text]), [["agent#1", "AGENT_DONE"], ["code_writer#1", "WORKER_DONE"]]);
		assert.equal(f.session.messages.some(m => m.role === "custom" && ["agent", "code_writer"].includes(m.customType)), false);
	} finally { child.release(); worker.release(); await f.cleanup(); }
});

test("descendant status is read-only, depth zero omits children and depth one exposes the direct child's children", async () => {
	const f = await fixture(), grandchild = gate("GRAND_DONE");
	const nested = { ...f.params("GRAND_TASK"), title: "Grandchild title" };
	f.subReplies.push(answer([fauxToolCall("agent", nested)], { stopReason: "toolUse" }));
	for (let n = 0; n < 12; n++) f.subReplies.push(async (context, options) =>
		texts(context)[0] === "GRAND_TASK" ? grandchild.reply(context, options) : answer("PARENT_WAITING"));
	try {
		await f.call(f.params("PARENT_TASK"));
		await until(grandchild.entered, "grandchild running");
		const before = f.requests.sub.length;
		const flat = JSON.parse(await f.call({ action: "status", ids: ["agent#1"] })).statuses[0];
		assert.equal("children" in flat, false);
		const deep = JSON.parse(await f.call({ action: "status", ids: ["agent#1"], depth: 1 })).statuses[0];
		assert.equal(deep.children.length, 1);
		assert.equal(deep.children[0].id, "agent#1");
		assert.equal(deep.children[0].title, "Grandchild title");
		assert.equal(deep.children[0].state, "running");
		assert.equal("children" in deep.children[0], false);
		for (const key of ["messages", "current_tools", "last_tool", "retry", "tokens"])
			assert.equal(key in deep.children[0], false, `descendant status omits ${key}`);
		assert.equal(JSON.stringify(deep.children).includes("preview"), false);
		const deeper = JSON.parse(await f.call({ action: "status", ids: ["agent#1"], depth: 2 })).statuses[0];
		assert.deepEqual(deeper.children[0].children, []);
		assert.equal(f.requests.sub.length, before, "status never invokes a child model");
		await assert.rejects(f.call({ action: "stop", id: "agent#1/agent#1" }), /Unknown agent id/);
		assert.equal(grandchild.aborted(), false, "status grants no descendant control");
	} finally { grandchild.release(); await f.cleanup(); }
});

test("long-turn alerts are opt-in, wake wait, reset on restart and inherited threshold still applies", async () => {
	const f = await fixture(), first = gate("FIRST"), second = gate("SECOND"), unconfigured = gate("DEFAULT");
	f.subReplies.push(first.reply, second.reply, unconfigured.reply);
	try {
		await f.call({ ...f.params(), alert_after_ms: 10 });
		const alert = JSON.parse(await f.call({ action: "wait", ids: ["agent#1"], timeout_ms: 1000 }));
		assert.equal(alert.reason, "alert");
		assert.ok(alert.statuses[0].alerts.some((a: any) => a.kind === "long_turn"));
		assert.equal(first.aborted(), false, "alert is observational only");
		await assert.rejects(f.call({ action: "restart", id: "agent#1", alert_after_ms: 0 }), /positive finite safe integer/);
		assert.equal(first.aborted(), false, "invalid threshold cannot destroy existing child");
		await f.call({ action: "restart", id: "agent#1", task: "FRESH" });
		const inherited = JSON.parse(await f.call({ action: "wait", ids: ["agent#1"], timeout_ms: 1000 }));
		assert.equal(inherited.reason, "alert");
		assert.equal(inherited.statuses[0].alerts.filter((a: any) => a.kind === "long_turn").length, 1);
		assert.equal(second.aborted(), false);
		await f.call({ action: "stop", id: "agent#1" });
		await f.call(f.params("NO_THRESHOLD"));
		await until(unconfigured.entered, "default child");
		const timeout = JSON.parse(await f.call({ action: "wait", ids: ["agent#2"], timeout_ms: 25 }));
		assert.equal(timeout.reason, "timeout");
		assert.deepEqual(timeout.statuses[0].alerts, []);
		assert.equal(unconfigured.aborted(), false);
	} finally { first.release(); second.release(); unconfigured.release(); await f.cleanup(); }
});

test("workers share supervision schema and long-turn threshold, and guard refusals raise scope_block alerts", async () => {
	const f = await fixture(), held = gate("WORKER_DONE");
	const provider = fauxProvider({ provider: "anthropic", api: "supervision-guard", models: [{ id: "claude-haiku-5-5", reasoning: true }] });
	provider.setResponses([
		async (context, options) => {
			await held.reply(context, options);
			return answer([fauxToolCall("bash", { command: "git add forbidden.txt" })], { stopReason: "toolUse" });
		},
		answer("GUARD_DONE"),
	]);
	f.runtime.registerNativeProvider(provider.provider);
	f.mainReplies.push(
		answer([fauxToolCall("code_writer", { task: "GUARD_TASK", alert_after_ms: 10 })], { stopReason: "toolUse" }),
		answer([fauxToolCall("agent", { action: "wait", ids: ["code_writer#1"], timeout_ms: 1000 })], { stopReason: "toolUse" }),
		answer("LONG_ALERT_ACK"),
	);
	try {
		for (const name of ["agent", "code_writer", "shell_runner"]) {
			const properties = f.session.getToolDefinition(name)!.parameters.properties;
			for (const key of ["until", "wake_on_alert", "depth", "alert_after_ms"]) assert.ok(key in properties, `${name} has ${key}`);
		}
		await f.session.prompt("GO");
		const [long] = waits(f.session);
		assert.equal(long.reason, "alert");
		assert.ok(long.statuses[0].alerts.some((a: any) => a.kind === "long_turn"));
		assert.equal(held.aborted(), false);
		held.release();
		await until(() => f.session.messages.some(m => m.role === "custom" && m.customType === "code_writer"), "guard worker result");
		const status = JSON.parse(await f.call({ action: "status", ids: ["code_writer#1"] })).statuses[0];
		assert.equal(status.alerts.filter((a: any) => a.kind === "scope_block").length, 1);
		assert.equal(status.alerts.some((a: any) => a.kind === "error"), false, "ordinary refused tools are not generic runtime errors");
		assert.equal(status.last_tool.is_error, true);
	} finally { held.release(); await f.cleanup(); }
});

test("actual SDK schema rejections alert on the second rejection before tool_call hooks run", async () => {
	const f = await fixture(), begin = gate(), final = gate("SCHEMA_DONE");
	let readHooks = 0;
	// The public subagent-review offer exposes the child's API, without accessing Pi internals.
	f.bus.on("rqw-review:subagent-review", raw => {
		const request = raw as unknown as { offer(register: (child: ExtensionAPI) => void): void };
		request.offer(child => { child.on("tool_call", event => { if (event.toolName === "read") readHooks++; }); });
	});
	f.subReplies.push(
		async (context, options) => {
			await begin.reply(context, options);
			return answer([fauxToolCall("read", {}, { id: "invalid-read-one" })], { stopReason: "toolUse" });
		},
		// Distinct arguments avoid the separate identical-call alert, while the missing-path rejection is the same.
		answer([fauxToolCall("read", { offset: 1 }, { id: "invalid-read-two" })], { stopReason: "toolUse" }),
		final.reply,
	);
	f.mainReplies.push(
		answer([fauxToolCall("agent", { ...f.params(), tools: ["read"] })], { stopReason: "toolUse" }),
		answer([fauxToolCall("agent", { action: "wait", ids: ["agent#1"], timeout_ms: 1000 })], { stopReason: "toolUse" }),
		answer("SCHEMA_ALERT_ACK"),
	);
	try {
		const run = f.session.prompt("GO");
		await until(() => begin.entered() && f.requests.main.length === 2, "wait before invalid tools");
		await tick(); begin.release(); await run;
		const [result] = waits(f.session);
		assert.equal(result.reason, "alert");
		assert.deepEqual(result.results, []);
		const alerts = result.statuses[0].alerts;
		assert.equal(alerts.length, 1);
		assert.equal(alerts[0].kind, "schema_rejection_repeated");
		assert.match(alerts[0].detail, /Validation failed for tool "read"/);
		assert.equal(readHooks, 0, "Pi refuses arguments before tool_call observers");
		await until(final.entered, "child continues after schema alert");
		assert.equal(final.aborted(), false);
		const lastRequest = f.requests.sub.at(-1)!;
		const rejections = lastRequest.messages.filter(m => m.role === "toolResult" && m.toolName === "read");
		assert.equal(rejections.length, 2);
		assert.ok(rejections.every(m => m.role === "toolResult" && m.isError));
		assert.deepEqual(f.delivered(), []);
	} finally { begin.release(); final.release(); await f.cleanup(); }
});

test("runtime prompt rejection becomes an error alert and a terminal error result", async t => {
	const f = await fixture();
	const original = AgentSession.prototype.prompt;
	t.mock.method(AgentSession.prototype, "prompt", function(this: AgentSession, ...args: Parameters<typeof original>) {
		if (this !== f.session && args[0] === "RUNTIME_REJECT") return Promise.reject(new Error("RUNTIME_REJECT_MARK"));
		return original.apply(this, args);
	});
	try {
		await f.call(f.params("RUNTIME_REJECT"));
		await until(() => f.delivered().length === 1, "runtime error delivery");
		const status = JSON.parse(await f.call({ action: "status", ids: ["agent#1"] })).statuses[0];
		assert.ok(status.alerts.some((a: any) => a.kind === "error" && a.detail === "RUNTIME_REJECT_MARK"));
		assert.deepEqual(f.delivered(), ["[agent#1] error: RUNTIME_REJECT_MARK"]);
	} finally { await f.cleanup(); }
});
