import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { continueNote, repairHistory, repairRequest } from "../../../extensions/RQW-agent/history-repair.ts";

const user = (text: string) => ({ role: "user" as const, content: text, timestamp: 1 });
const call = (id: string) => fauxToolCall("read", { path: id }, { id });
const toolUse = (...ids: string[]) => fauxAssistantMessage(ids.map(call), { stopReason: "toolUse" });
const result = (id: string, text = id) => ({
	role: "toolResult" as const, toolCallId: id, toolName: "read", content: [{ type: "text" as const, text }], isError: false, timestamp: 1,
});
const shape = (messages: { role: string; toolCallId?: string }[]) => messages.map(message => message.toolCallId ? `result:${message.toolCallId}` : message.role);

test("a valid history passes through with the same messages", () => {
	const history = [user("task"), toolUse("a", "b"), result("b"), result("a"), fauxAssistantMessage("done")];
	const repaired = repairHistory(history);
	assert.notEqual(repaired, history);
	assert.deepEqual(repaired, history);
	assert.ok(repaired.every((message, index) => message === history[index]));
});

test("a result with no call before it is removed", () => {
	const history = [result("lost"), user("task"), fauxAssistantMessage("answer")];
	assert.deepEqual(shape(repairHistory(history)), ["user", "assistant"]);
});

test("a result of an earlier turn that came after other conversation is removed", () => {
	const history = [user("task"), toolUse("a"), result("a"), fauxAssistantMessage("middle"), result("a", "late"), user("next")];
	assert.deepEqual(shape(repairHistory(history)), ["user", "assistant", "result:a", "assistant", "user"]);
});

test("a result placed after a user message does not answer the call before it", () => {
	const history = [user("task"), toolUse("a"), user("steer"), result("a")];
	// The late result goes, and so does the call it no longer answers.
	assert.deepEqual(shape(repairHistory(history)), ["user", "user"]);
});

test("a result of a call from another assistant message of the turn sequence is removed", () => {
	const history = [user("task"), toolUse("a"), result("a"), toolUse("b"), result("a", "wrong turn"), result("b")];
	assert.deepEqual(shape(repairHistory(history)), ["user", "assistant", "result:a", "assistant", "result:b"]);
});

test("a duplicate result is removed and the first one stays", () => {
	const history = [user("task"), toolUse("a"), result("a", "first"), result("a", "second"), fauxAssistantMessage("done")];
	const repaired = repairHistory(history);
	assert.deepEqual(shape(repaired), ["user", "assistant", "result:a", "assistant"]);
	assert.deepEqual((repaired[2] as { content: unknown }).content, [{ type: "text", text: "first" }]);
});

test("a system message inside a turn does not end it", () => {
	const system = { role: "system" as const, content: "tools changed", timestamp: 1 };
	const history = [user("task"), toolUse("a"), system, result("a"), fauxAssistantMessage("done")];
	assert.deepEqual(shape(repairHistory(history)), ["user", "assistant", "result:a", "system", "assistant"]);
});

test("two calls with the same id in one message are not guessed", () => {
	const history = [user("task"), toolUse("a", "a"), result("a")];
	assert.throws(() => repairHistory(history), /Ambiguous history: tool call id a/);
});

test("repair leaves the input array and its messages unchanged", () => {
	const history = [result("lost"), user("task"), toolUse("a"), result("a"), result("a")];
	const copy = structuredClone(history);
	repairHistory(history);
	assert.deepEqual(history, copy);
});

test("an assistant message whose calls are all answered is returned as the same object", () => {
	const message = fauxAssistantMessage([fauxText("before"), call("a")], { stopReason: "toolUse" });
	const repaired = repairHistory([user("task"), message, result("a")]);
	assert.equal(repaired[1], message);
});

const blocks = (message: unknown) => (message as { content: { type: string; id?: string }[] }).content.map(part => part.id ?? part.type);

test("a call without a result is cut out and the rest of its message stays", () => {
	const message = fauxAssistantMessage([fauxText("plan"), call("a"), call("b")], { stopReason: "toolUse" });
	const history = [user("task"), message, result("b"), user("next")];
	const repaired = repairHistory(history);
	assert.deepEqual(shape(repaired), ["user", "assistant", "result:b", "user"]);
	assert.deepEqual(blocks(repaired[1]), ["text", "b"]);
	assert.equal((repaired[1] as { stopReason: string }).stopReason, "toolUse");
	assert.deepEqual(blocks(message), ["text", "a", "b"]);
});

test("a message left with no text and no call is removed, a neighbour with content is kept", () => {
	const history = [user("task"), fauxAssistantMessage("earlier"), toolUse("a"), user("next")];
	assert.deepEqual(shape(repairHistory(history)), ["user", "assistant", "user"]);
});

test("a message left with thinking only is removed", () => {
	const thinking = { type: "thinking" as const, thinking: "hm", thinkingSignature: "sig" };
	const message = fauxAssistantMessage([thinking, call("a")], { stopReason: "toolUse" });
	assert.deepEqual(shape(repairHistory([user("task"), message])), ["user"]);
});

test("an empty assistant message that needed no repair is kept", () => {
	const message = fauxAssistantMessage([], { stopReason: "error" });
	assert.equal(repairHistory([user("task"), message])[1], message);
});

test("repair is idempotent", () => {
	const history = [result("x"), user("task"), toolUse("a", "b"), result("a"), result("a"), toolUse("c"), user("next")];
	const once = repairHistory(history);
	assert.deepEqual(repairHistory(once), once);
});

test("a request whose repair leaves a changed assistant message last gets the continue line", () => {
	const message = fauxAssistantMessage([fauxText("plan"), call("a")], { stopReason: "toolUse" });
	const repaired = repairRequest<{ role: string }>([user("task"), message], continueNote());
	assert.deepEqual(shape(repaired), ["user", "assistant", "user"]);
	assert.deepEqual((repaired[2] as unknown as { content: unknown }).content, [{ type: "text", text: "continue; the removed call was not repeated" }]);
});

test("a request ending with a finished assistant message or with a user message gets no continue line", () => {
	assert.deepEqual(shape(repairRequest<{ role: string }>([user("task"), fauxAssistantMessage("done"), result("stray")], continueNote())), ["user", "assistant"]);
	assert.deepEqual(shape(repairRequest<{ role: string }>([user("task"), toolUse("a")], continueNote())), ["user"]);
});

test("a last assistant message dropped whole exposes an earlier assistant message, so the continue line is added", () => {
	const history = [user("task"), fauxAssistantMessage("earlier answer"), toolUse("a")];
	assert.deepEqual(shape(repairRequest<{ role: string }>(history, continueNote())), ["user", "assistant", "user"]);
});

test("a stray result after a dropped assistant message does not hide the drop", () => {
	const history = [user("task"), fauxAssistantMessage("earlier answer"), toolUse("a"), result("stray")];
	assert.deepEqual(shape(repairRequest<{ role: string }>(history, continueNote())), ["user", "assistant", "user"]);
});
