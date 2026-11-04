import assert from "node:assert/strict";
import { after, it } from "node:test";
import { call, isTask, reportTimings, text, worldPair } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

const CHAT_TOOLS = ["list_chats", "read_chat", "send_message_to_chat", "wait_answer"];

/** The tools a request declares to the model: what its system messages added, minus what they removed. */
function declared(request: { context: { messages: unknown[] } }): string[] {
	const names = new Set<string>();
	for (const message of request.context.messages as { role: string; toolsAdded?: { name: string }[]; toolsRemoved?: { name: string }[] }[]) {
		if (message.role !== "system") continue;
		for (const tool of message.toolsAdded ?? []) names.add(tool.name);
		for (const tool of message.toolsRemoved ?? []) names.delete(tool.name);
	}
	return [...names];
}

it("a child's chat tools stay deferred and load only after tool_search rqwchat", async (t) => {
	const [w, peer] = await worldPair(t);
	w.model.when(isTask("chat child"), call("tool_search", { query: "rqwchat" }, "search"), call("list_chats", {}, "list"), text("child done"));
	w.model.script(call("agent", { action: "start", task: "chat child" }), text("started"), text("received"));
	await w.submit("start child");
	await w.until(() => w.requests.filter(isTask("chat child")).length >= 3, "the child's third request");
	const [first, second, third] = w.requests.filter(isTask("chat child"));
	assert.ok(declared(first).includes("tool_search"));
	assert.deepEqual(declared(first).filter(name => CHAT_TOOLS.includes(name)), []);
	const search = second.context.messages.find(message => message.role === "toolResult" && message.toolCallId === "search");
	assert.match(JSON.stringify(search), /Loaded 4 tools/);
	assert.deepEqual(CHAT_TOOLS.filter(name => declared(second).includes(name)), CHAT_TOOLS);
	const listed = third.context.messages.find(message => message.role === "toolResult" && message.toolCallId === "list");
	assert.equal(listed?.role === "toolResult" && listed.isError, false);
	await w.settle();
	await w.dispose();
	await peer.dispose();
});
