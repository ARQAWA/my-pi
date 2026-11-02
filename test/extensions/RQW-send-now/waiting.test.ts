import assert from "node:assert/strict";
import { test } from "node:test";
import { harness } from "./harness.ts";

const WAITING = "rqw:waiting:v1";
type Harness = ReturnType<typeof harness>;
const open = (h: Harness, call = "wait", sessionId = "session") => h.events.emit(WAITING, { sessionId, call, open: true });
const close = (h: Harness, call = "wait", sessionId = "session") => h.events.emit(WAITING, { sessionId, call, open: false });
const user = (text: string, ...images: unknown[]) => ({ role: "user", content: [{ type: "text", text }, ...images], timestamp: 1 });

test("Enter queues a follow-up while the agent generates and while a useful tool runs, until a lone wait opens", (t) => {
	const h = harness(t);
	h.state.editor = "while generating";
	assert.deepEqual(h.press("\r"), { consume: true });
	h.followUp("while generating");
	h.fire("tool_execution_start", { toolCallId: "bash", toolName: "bash" });
	h.state.editor = "while bash runs";
	assert.deepEqual(h.press("\r"), { consume: true });
	// A wait of another session, such as a subagent's, is not this chat's wait.
	open(h, "wait", "child");
	assert.deepEqual(h.session._followUpMessages, ["while generating"]);
	assert.deepEqual(h.inputs, ["follow-up", "follow-up"]);
	open(h);
	assert.deepEqual(h.session._followUpMessages, []);
	assert.deepEqual(h.session._steeringMessages, ["while generating"]);
	h.state.editor = "now";
	assert.deepEqual(h.press("\r"), { consume: true });
	assert.deepEqual(h.inputs, ["follow-up", "follow-up", "\r"]);
});

test("Enter steers through the editor's own submit while only a wait is open, and queues again when it closes", (t) => {
	const h = harness(t);
	open(h);
	h.state.editor = "now";
	assert.deepEqual(h.press("\r"), { consume: true });
	close(h);
	h.state.editor = "later";
	assert.deepEqual(h.press("\r"), { consume: true });
	assert.deepEqual(h.inputs, ["\r", "follow-up"]);
});

test("Enter belongs to a focused chooser or dialog while a wait is open", (t) => {
	const h = harness(t);
	open(h);
	h.state.editor = "draft";
	h.state.focused = false;
	assert.equal(h.press("\r"), undefined);
	h.state.editor = "";
	assert.equal(h.press("\r"), undefined);
	assert.deepEqual(h.inputs, []);
	assert.equal(h.session.aborts, 0);
});

test("the transition to a lone wait moves the follow-ups queued so far into steering, in order", (t) => {
	const h = harness(t);
	h.followUp("first");
	h.followUp("second");
	assert.equal(h.session._steeringMessages.length, 0);
	open(h);
	assert.deepEqual(h.session._followUpMessages, []);
	assert.deepEqual(h.session._steeringMessages, ["first", "second"]);
	assert.deepEqual(h.session.agent.steeringQueue.messages.map((message: any) => message.content[0].text), ["first", "second"]);
	assert.deepEqual(h.session.agent.followUpQueue.messages, []);
});

test("a follow-up is not touched while the work goes on, only when the wait opens", (t) => {
	const h = harness(t);
	h.followUp("kept");
	close(h);
	open(h, "wait", "child");
	assert.deepEqual(h.session._followUpMessages, ["kept"]);
	assert.deepEqual(h.session._steeringMessages, []);
});

test("promoted follow-ups keep their images, and commands go through the native submit", (t) => {
	const h = harness(t);
	const picture = { type: "image", data: "AAAA", mimeType: "image/png" };
	const message = user("look", picture);
	h.session._followUpMessages.push("look");
	h.session.agent.followUpQueue.messages.push(message);
	open(h);
	assert.equal(h.session.agent.steeringQueue.messages[0], message);
	for (const text of ["/compact", "!ls", "see [Image #1]"]) {
		h.state.editor = text;
		assert.deepEqual(h.press("\r"), { consume: true });
	}
	// Nothing is assembled by hand: the editor's own submit gets every one of them.
	assert.deepEqual(h.inputs, ["\r", "\r", "\r"]);
	assert.deepEqual(h.session._steeringMessages, ["look"]);
});

test("after a shutdown the extension no longer listens to waits", (t) => {
	const h = harness(t);
	h.followUp("later");
	h.shutdown();
	open(h);
	assert.deepEqual(h.session._followUpMessages, ["later"]);
});
