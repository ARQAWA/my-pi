import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";
import { pairOfTabs } from "./harness.ts";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const message = (id: string, role: string, stopReason?: string) => ({
	id, parentId: null, timestamp: "2026-01-01T00:00:00Z", type: "message",
	message: { role, stopReason, content: [{ type: "text", text: id }] },
});
const parse = (result: any) => JSON.parse(result.content[0].text);
/** Pi's store keeps the file of a chat whose tab closed; only then is the chat known as closed. */
const saveSessionFile = (dir: string, id: string) => {
	const root = join(dir, "no-sessions", "--work--");
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, `2026_${id}.jsonl`), `${JSON.stringify({ type: "session", id })}\n`);
};
const errorOf = (promise: Promise<unknown>) => promise.then(() => undefined, (error: Error) => JSON.parse(error.message));

it("returns an answer that is already saved after the entry read last", async t => {
	const { recv, send } = await pairOfTabs(t);
	recv.world.entries.push(message("u", "user"), message("a", "assistant", "stop"));
	send.world.entries.push({ id: "batch", parentId: null, type: "message", message: {
		role: "assistant", content: [{ type: "toolCall", id: "wait", name: "wait_answer", arguments: {} }],
	} });
	const result = parse(await send.run("wait_answer", { chatId: "recv", afterEntryId: "u", timeout_ms: 500 }, "wait"));
	assert.equal(result.chatId, "recv");
	assert.equal(result.reason, "answer");
	assert.equal(result.entry.id, "a");
});

it("returns the first answer of a branch that had no entries, saved before the call", async t => {
	const { recv, send } = await pairOfTabs(t);
	recv.world.entries.push(message("first", "assistant", "stop"));
	const result = parse(await send.run("wait_answer", { chatId: "recv", afterEntryId: null, timeout_ms: 500 }));
	assert.equal(result.reason, "answer");
	assert.equal(result.entry.id, "first");
});

it("rejects mixed batches and nested waits before contacting the target", async t => {
	const { send, net } = await pairOfTabs(t);
	const params = { chatId: "recv", afterEntryId: null };
	const batch = (content: object[]) => ({ id: "batch", parentId: null, type: "message", message: { role: "assistant", content } });
	const tool = (id: string, name: string, args = {}) => ({ type: "toolCall", id, name, arguments: args });
	const connections = net.connections;
	send.world.entries.push(batch([tool("wait", "wait_answer"), tool("work", "read_chat")]));
	assert.deepEqual(parse(await send.run("wait_answer", params, "wait")), { chatId: "recv", reason: "work_pending" });
	send.world.entries.push(batch([tool("script", "codemode")]));
	assert.deepEqual(parse(await send.run("wait_answer", params, "script/wait")), { chatId: "recv", reason: "direct_wait_required" });
	assert.equal(net.connections, connections);
});

it("holds the call until the answer is saved", async t => {
	const { recv, send } = await pairOfTabs(t);
	recv.world.entries.push(message("u", "user"));
	let done = false;
	const pending = send.run("wait_answer", { chatId: "recv", afterEntryId: "u" }).then(result => { done = true; return parse(result); });
	await tick();
	assert.equal(done, false);
	recv.world.entries.push(message("a", "assistant", "stop"));
	await recv.fire("turn_end");
	assert.equal((await pending).entry.id, "a");
});

it("does not take a streaming part or a tool turn for the final answer, and times out", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { recv, send } = await pairOfTabs(t);
	recv.world.entries.push(message("u", "user"));
	const pending = send.run("wait_answer", { chatId: "recv", afterEntryId: "u", timeout_ms: 25 });
	await tick();
	await recv.fire("message_update", { message: message("chunk", "assistant").message });
	recv.world.entries.push(message("partial", "assistant"), message("tools", "assistant", "toolUse"));
	await recv.fire("turn_end");
	t.mock.timers.tick(25);
	assert.deepEqual(parse(await pending), { chatId: "recv", reason: "timeout" });
});

it("reports a chat that is closed before the call", async t => {
	const { recv, send, dir } = await pairOfTabs(t);
	saveSessionFile(dir, "recv");
	await recv.fire("session_shutdown");
	const error = await errorOf(send.run("wait_answer", { chatId: "recv", afterEntryId: null, timeout_ms: 500 }));
	assert.equal(error.error, "closed");
	assert.ok(error.openHint);
});

it("reports a chat that closes during the wait", async t => {
	const { recv, send, dir } = await pairOfTabs(t);
	saveSessionFile(dir, "recv");
	recv.world.entries.push(message("u", "user"));
	const pending = errorOf(send.run("wait_answer", { chatId: "recv", afterEntryId: "u", timeout_ms: 60_000 }));
	await tick();
	await recv.fire("session_shutdown");
	assert.equal((await pending).error, "closed");
});

it("returns target_changed when the branch changes", async t => {
	const { recv, send } = await pairOfTabs(t);
	recv.world.entries.push(message("u", "user"));
	const pending = send.run("wait_answer", { chatId: "recv", afterEntryId: "u", timeout_ms: 60_000 });
	await tick();
	await recv.fire("session_tree");
	assert.equal(parse(await pending).reason, "target_changed");
});

it("returns aborted when the caller aborts", async t => {
	const { recv, send } = await pairOfTabs(t);
	recv.world.entries.push(message("u", "user"));
	const controller = new AbortController();
	const pending = send.run("wait_answer", { chatId: "recv", afterEntryId: "u", timeout_ms: 60_000 }, "call-1", controller.signal);
	await tick();
	controller.abort();
	assert.deepEqual(parse(await pending), { chatId: "recv", reason: "aborted" });
});
