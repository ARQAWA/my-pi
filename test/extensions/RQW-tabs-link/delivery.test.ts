import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it, type TestContext } from "node:test";
import { Value } from "typebox/value";
import { fakeNet, openTab, tempDir } from "./harness.ts";

async function pair(t: TestContext) {
	const dir = tempDir(t);
	const net = fakeNet();
	const recv = openTab({ dir, net }, "recv");
	const send = openTab({ dir, net }, "send");
	await recv.fire("session_start", { reason: "startup" });
	await send.fire("session_start", { reason: "startup" });
	const status = async (params: object, callId?: string) => JSON.parse((await send.run("send_message_to_chat", { chatId: "recv", ...params }, callId)).content[0].text);
	const code = (promise: Promise<unknown>) => promise.then(() => "ok", (error: Error) => JSON.parse(error.message).error as string);
	return { recv, send, dir, status, code };
}

it("an idle chat gets the message as a follow-up with its source; the answer is at once and delivered shows once Pi stored it", async (t) => {
	const { recv, status } = await pair(t);
	assert.deepEqual(await status({ prompt: "do it" }, "once"), { chatId: "recv", status: "accepted" });
	assert.deepEqual(await status({ prompt: "do it" }, "once"), { chatId: "recv", status: "delivered" });
	const { message, options } = recv.world.sent[0];
	assert.equal(message.customType, "rqw-tabs-link");
	assert.equal(message.details.from, "send");
	assert.match(message.content, /send.*do it/s);
	assert.deepEqual(options, { triggerTurn: true, deliverAs: "followUp" });
});

it("a busy chat only queues the message after its work; nothing is steered or aborted", async (t) => {
	const { recv, status } = await pair(t);
	recv.world.idle = false;
	recv.world.autoRecord = false;
	assert.deepEqual(await status({ prompt: "later" }), { chatId: "recv", status: "accepted" });
	assert.equal(recv.world.sent[0].options.deliverAs, "followUp");
});

/** One delivered turn as Pi runs it: its message starts, the run ends. */
async function runTurn(recv: Awaited<ReturnType<typeof pair>>["recv"], index: number) {
	await recv.fire("message_start", { message: { role: "custom", ...recv.world.sent[index].message } });
	await recv.fire("agent_end", {});
}

it("an open dialog holds messages in arrival order; they go out one turn at a time", async (t) => {
	const { recv, status } = await pair(t);
	recv.world.autoRecord = false;
	await recv.fire("ui_prompt_start", { kind: "select" });
	assert.equal((await status({ prompt: "first" }, "c1")).status, "accepted");
	assert.equal((await status({ prompt: "second" }, "c2")).status, "accepted");
	assert.equal(recv.world.sent.length, 0);
	await recv.fire("ui_prompt_end", { kind: "select" });
	assert.equal(recv.world.sent.length, 1);
	await runTurn(recv, 0);
	assert.equal(recv.world.sent.length, 2);
	assert.deepEqual(recv.world.sent.map(sent => sent.message.content.split("\n\n")[1]), ["first", "second"]);
});

it("every accepted message that is not yet in the history counts against the limit, also those already in Pi's queue", async (t) => {
	const { recv, send, status, code } = await pair(t);
	recv.world.autoRecord = false;
	for (let n = 1; n <= 20; n++) await status({ prompt: `m${n}` }, `c${n}`);
	// One went to Pi at once, the others wait; all twenty still count.
	assert.equal(recv.world.sent.length, 1);
	assert.equal(await code(send.run("send_message_to_chat", { chatId: "recv", prompt: "x" }, "c21")), "queue_full");
	// Once Pi stored the first, a slot is free again.
	recv.world.entries.push({ id: "stored", type: "custom_message", ...recv.world.sent[0].message });
	assert.equal((await status({ prompt: "x" }, "c21")).status, "accepted");
});

it("queued model overrides run one turn at a time: no second override before the first turn ended and was restored", async (t) => {
	const { recv, status } = await pair(t);
	recv.world.autoRecord = false;
	recv.world.models.push({ provider: "p", id: "third" });
	await recv.fire("ui_prompt_start", { kind: "select" });
	await status({ prompt: "one", model: "p/other" }, "c1");
	await status({ prompt: "two", model: "p/third" }, "c2");
	await recv.fire("ui_prompt_end", { kind: "select" });
	assert.equal(recv.world.sent.length, 1);
	assert.equal(recv.world.model?.id, "other");
	await runTurn(recv, 0);
	assert.equal(recv.world.sent.length, 2);
	assert.equal(recv.world.model?.id, "third");
	await runTurn(recv, 1);
	assert.equal(recv.world.model?.id, "owner");
});

it("a repeated delivery id sends once; other content under the same id is refused; a restart leaves it unknown", async (t) => {
	const { recv, status, code, send } = await pair(t);
	await status({ prompt: "once" }, "same");
	assert.deepEqual(await status({ prompt: "once" }, "same"), { chatId: "recv", status: "delivered" });
	assert.equal(recv.world.sent.length, 1);
	assert.equal(await code(send.run("send_message_to_chat", { chatId: "recv", prompt: "other" }, "same")), "duplicate_conflict");
	// The accepted record survives in the history; the delivery itself did not.
	recv.world.entries = recv.world.entries.filter(entry => entry.type === "custom");
	await recv.fire("session_shutdown", { reason: "reload" });
	await recv.fire("session_start", { reason: "reload" });
	assert.deepEqual(await status({ prompt: "once" }, "same"), { chatId: "recv", status: "unknown" });
	assert.equal(recv.world.sent.length, 1);
});

it("an explicit model applies to the delivered turn only; the owner's settings return at the turn's end", async (t) => {
	const { recv, status, code, send } = await pair(t);
	assert.equal(await code(send.run("send_message_to_chat", { chatId: "recv", prompt: "x", model: "p/missing" })), "model_unavailable");
	recv.world.level = "high";
	assert.equal((await status({ prompt: "go", model: "p/other" })).status, "accepted");
	assert.equal(recv.world.model?.id, "other");
	assert.equal(recv.world.sent.length, 1);
	// Pi recorded the delivered message itself (message_start): that does not end the override.
	assert.equal(recv.world.model?.id, "other");
	await recv.fire("agent_end", {});
	assert.equal(recv.world.model?.id, "owner");
	assert.equal(recv.world.level, "high");
});

it("a queued message of the owner in the same run gets the owner's model before its request", async (t) => {
	const { recv, status } = await pair(t);
	await status({ prompt: "go", model: "p/other" });
	await recv.fire("message_start", { message: { role: "user", content: "owner steer" } });
	assert.equal(recv.world.model?.id, "owner");
	await recv.fire("agent_end", {});
	assert.equal(recv.world.model?.id, "owner");
});

it("a model change the owner made during the turn is kept; the untouched level still returns", async (t) => {
	const { recv, status } = await pair(t);
	recv.world.level = "high";
	await status({ prompt: "go", model: "p/other" });
	recv.world.model = { provider: "p", id: "chosen" };
	await recv.fire("model_select", { model: recv.world.model, source: "set" });
	recv.world.level = "low";
	await recv.fire("agent_end", {});
	assert.equal(recv.world.model?.id, "chosen");
	assert.equal(recv.world.level, "high");
});

it("a thinking level the owner chose during the turn is kept; the untouched model still returns", async (t) => {
	const { recv, status } = await pair(t);
	recv.world.level = "high";
	await status({ prompt: "go", model: "p/other" });
	recv.world.level = "low";
	await recv.fire("thinking_level_select", { level: "low", previousLevel: "high" });
	await recv.fire("agent_end", {});
	assert.equal(recv.world.level, "low");
	assert.equal(recv.world.model?.id, "owner");
});

it("a crash before the new level was recorded is still undone from the model marker alone", async (t) => {
	const { recv } = await pair(t);
	recv.world.model = { provider: "p", id: "other" };
	recv.world.level = "low";
	recv.world.entries.push({ id: "m", type: "custom", customType: "rqw-tabs-link-restore", data: {
		pending: { model: { provider: "p", id: "owner" }, level: "medium" }, applied: { model: { provider: "p", id: "other" } },
	} });
	await recv.fire("session_start", { reason: "resume" });
	assert.deepEqual([recv.world.model?.id, recv.world.level], ["owner", "medium"]);
});

it("an override left by a crash is undone on the next start", async (t) => {
	const { recv } = await pair(t);
	recv.world.model = { provider: "p", id: "other" };
	recv.world.entries.push({ id: "m", type: "custom", customType: "rqw-tabs-link-restore", data: {
		pending: { model: { provider: "p", id: "owner" }, level: "medium" }, applied: { model: { provider: "p", id: "other" }, level: "medium" },
	} });
	await recv.fire("session_start", { reason: "resume" });
	assert.equal(recv.world.model?.id, "owner");
});

it("the tool schemas refuse run-control inputs and read_chat reports a closed chat with its open hint", async (t) => {
	const { send, dir, code } = await pair(t);
	const schema = send.tools.find(tool => tool.name === "send_message_to_chat")!.parameters;
	for (const extra of ["mode", "expectedRun", "requestId"]) {
		assert.equal(Value.Check(schema, { chatId: "a", prompt: "p", [extra]: "x" }), false);
	}
	const closedId = "closed-chat";
	const root = join(dir, "no-sessions", "--work--");
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, `2026_${closedId}.jsonl`), `${JSON.stringify({ type: "session", id: closedId })}\n`);
	for (const name of ["read_chat", "send_message_to_chat"]) {
		const error = await send.run(name, { chatId: closedId, prompt: "p" }).catch((e: Error) => JSON.parse(e.message));
		assert.equal(error.error, "closed");
		assert.match(error.openHint, /pi --session closed-chat/);
	}
	assert.equal(await code(send.run("read_chat", { chatId: "nothing-here" })), "not_found");
});

it("read_chat returns the stored turns of an open chat", async (t) => {
	const { recv, send } = await pair(t);
	recv.world.entries.push({ id: "u1", type: "message", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "hello there" } });
	const result = JSON.parse((await send.run("read_chat", { chatId: "recv" })).content[0].text);
	assert.equal(result.chat.id, "recv");
	assert.match(JSON.stringify(result.turns), /hello there/);
});

it("delivered is reported only once the entry exists in Pi's history, not at the message event", async (t) => {
	const { recv, status } = await pair(t);
	recv.world.autoRecord = false;
	await status({ prompt: "hi" }, "k");
	const { message } = recv.world.sent[0];
	// Pi emits message_end to extensions before it stores the entry.
	await recv.fire("message_end", { message: { role: "custom", ...message } });
	assert.equal((await status({ prompt: "hi" }, "k")).status, "accepted");
	recv.world.entries.push({ id: "stored", type: "custom_message", ...message });
	assert.equal((await status({ prompt: "hi" }, "k")).status, "delivered");
});

it("a model without credentials is refused before anything is accepted, stored or sent", async (t) => {
	const { recv, send, code } = await pair(t);
	recv.world.noAuth.add("other");
	assert.equal(await code(send.run("send_message_to_chat", { chatId: "recv", prompt: "x", model: "p/other" })), "model_unavailable");
	assert.deepEqual(recv.world.entries, []);
	assert.deepEqual(recv.world.sent, []);
	assert.equal(recv.world.model?.id, "owner");
});

it("a crash right after the override took effect is undone at the next start: model and level are back", async (t) => {
	const { recv, status } = await pair(t);
	recv.world.level = "high";
	recv.world.clampLevel = "low";
	// The process dies the moment the model has changed: nothing it does afterwards reaches Pi or the history.
	recv.world.crashAfterSetModel = true;
	await status({ prompt: "go", model: "p/other" });
	assert.deepEqual([recv.world.model?.id, recv.world.level], ["other", "low"]);
	recv.world.crashed = false;
	recv.world.crashAfterSetModel = false;
	await recv.fire("session_start", { reason: "resume" });
	assert.deepEqual([recv.world.model?.id, recv.world.level], ["owner", "high"]);
});

it("a lost acknowledgement leaves the sender with unknown, and a repeat of the call sends nothing twice", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const dir = tempDir(t);
	const net = fakeNet();
	const recv = openTab({ dir, net }, "recv");
	const send = openTab({ dir, net }, "send");
	await recv.fire("session_start", { reason: "startup" });
	await send.fire("session_start", { reason: "startup" });
	// Connection 1 resolves the address; connection 2 carries the delivery, whose answer is lost.
	const base = net.connections;
	net.muted = connection => connection === base + 2;
	const first = send.run("send_message_to_chat", { chatId: "recv", prompt: "once" }, "call-9");
	await new Promise(resolve => setImmediate(resolve));
	await new Promise(resolve => setImmediate(resolve));
	t.mock.timers.tick(2000);
	const lost = JSON.parse((await first).content[0].text);
	assert.deepEqual(lost, { chatId: "recv", status: "unknown" });
	assert.equal(recv.world.sent.length, 1);
	net.muted = () => false;
	const again = JSON.parse((await send.run("send_message_to_chat", { chatId: "recv", prompt: "once" }, "call-9")).content[0].text);
	assert.ok(["accepted", "delivered"].includes(again.status));
	assert.equal(recv.world.sent.length, 1);
});

it("send_message_to_chat answers without waiting on any timer", async (t) => {
	const { send } = await pair(t);
	// The clock is never advanced: a tool that waits for a timer would never answer.
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const outcome = await Promise.race([
		send.run("send_message_to_chat", { chatId: "recv", prompt: "now" }).then(() => "answered"),
		new Promise(resolve => setImmediate(() => resolve("waiting"))),
	]);
	assert.equal(outcome, "answered");
});

it("a model that fails to select when the turn comes is recorded as model_unavailable and never sent", async (t) => {
	const { recv, send, status, code } = await pair(t);
	recv.world.idle = false;
	recv.world.setModelFails = true;
	assert.equal((await status({ prompt: "go", model: "p/other" }, "late")).status, "accepted");
	recv.world.idle = true;
	await recv.fire("agent_settled", {});
	assert.deepEqual(recv.world.sent, []);
	assert.match(recv.notices.at(-1) ?? "", /dropped/);
	assert.equal(await code(send.run("send_message_to_chat", { chatId: "recv", prompt: "go", model: "p/other" }, "late")), "model_unavailable");
	assert.deepEqual(recv.world.sent, []);
});

it("a model selection that throws is handled like a refused one: model_unavailable, not queued, marker closed", async (t) => {
	const { recv, send, status, code } = await pair(t);
	recv.world.idle = false;
	recv.world.setModelFails = "throw";
	assert.equal((await status({ prompt: "go", model: "p/other" }, "boom")).status, "accepted");
	recv.world.idle = true;
	await recv.fire("agent_settled", {});
	assert.deepEqual(recv.world.sent, []);
	assert.equal(await code(send.run("send_message_to_chat", { chatId: "recv", prompt: "go", model: "p/other" }, "boom")), "model_unavailable");
	// Nothing stays queued: a later plain message goes out at once.
	recv.world.setModelFails = false;
	await status({ prompt: "next" }, "after");
	assert.equal(recv.world.sent.length, 1);
	assert.equal(recv.world.entries.filter(entry => entry.customType === "rqw-tabs-link-restore").at(-1)?.data.done, true);
});

it("a message that never started (its run was aborted) is unknown, and later messages are still delivered", async (t) => {
	const { recv, status } = await pair(t);
	recv.world.autoRecord = false;
	recv.world.idle = false;
	await status({ prompt: "one" }, "c1");
	await status({ prompt: "two" }, "c2");
	assert.equal(recv.world.sent.length, 1);
	// The run is aborted: Pi still holds the first message in its queue and never drains it.
	await recv.fire("agent_end", {});
	recv.world.idle = true;
	await recv.fire("agent_settled", { aborted: true });
	assert.equal(recv.world.sent.length, 2);
	assert.equal((await status({ prompt: "one" }, "c1")).status, "unknown");
	await runTurn(recv, 1);
	recv.world.entries.push({ id: "stored", type: "custom_message", ...recv.world.sent[1].message });
	assert.equal((await status({ prompt: "two" }, "c2")).status, "delivered");
});

it("a lost message with a model override puts the owner's model back and lets the next message go", async (t) => {
	const { recv, status } = await pair(t);
	recv.world.autoRecord = false;
	await status({ prompt: "one", model: "p/other" }, "c1");
	await status({ prompt: "two" }, "c2");
	assert.equal(recv.world.model?.id, "other");
	assert.equal(recv.world.sent.length, 1);
	// The send never turned into a run; the next settle point releases it.
	await recv.fire("agent_settled", { aborted: false });
	assert.equal(recv.world.model?.id, "owner");
	assert.equal(recv.world.sent.length, 2);
});
