import assert from "node:assert/strict";
import { it } from "node:test";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { installQuiet } from "../../../extensions/RQW-send-now/quiet.ts";
import { ALT_ENTER, CTRL_ENTER, ESC, CTRL_ENTER_OTHER_KEYS, harness } from "./harness.ts";

const steer = (prompt: string, images: unknown[] = []) => ({ prompt, images });

it("Ctrl+Enter and Alt+Enter with text give the editor its own submit, busy or idle, and never force", async (t) => {
	const h = harness(t);
	await h.steer("already waiting");
	h.state.editor = "next";
	for (const key of [CTRL_ENTER, CTRL_ENTER_OTHER_KEYS, ALT_ENTER]) assert.deepEqual(h.press(key), { consume: true });
	h.state.idle = true;
	assert.deepEqual(h.press(CTRL_ENTER), { consume: true });
	assert.deepEqual(h.inputs, ["\r", "\r", "\r", "\r"]);
	assert.equal(h.session.aborts, 0);
	assert.deepEqual(h.sent, []);
});

it("Codex: an empty Ctrl+Enter silently sends the waiting steering and leaves follow-ups and the draft", async (t) => {
	const h = harness(t);
	await h.steer("use the smaller patch");
	h.followUp("check the result later");
	assert.deepEqual(h.press(CTRL_ENTER), { consume: true });
	assert.equal(h.session.aborts, 1);
	assert.deepEqual(h.session._steeringMessages, []);
	assert.deepEqual(h.session.agent.steeringQueue.messages, []);
	assert.deepEqual(h.session._followUpMessages, ["check the result later"]);
	assert.equal(h.session.agent.followUpQueue.messages.length, 1);
	await h.flush();
	assert.deepEqual(h.sent, [steer("use the smaller patch")]);
	assert.deepEqual(h.notices, []);
});

it("Codex: an empty Ctrl+Enter with nothing steering, or with only a follow-up, does nothing", async (t) => {
	const h = harness(t);
	assert.equal(h.press(CTRL_ENTER), undefined);
	h.followUp("later");
	assert.equal(h.press(CTRL_ENTER), undefined);
	assert.equal(h.press(ALT_ENTER), undefined);
	assert.equal(h.session.aborts, 0);
});

it("Alt+Enter on an empty editor never forces", async (t) => {
	const h = harness(t);
	await h.steer("waiting");
	assert.equal(h.press(ALT_ENTER), undefined);
	assert.equal(h.session.aborts, 0);
});

for (const provider of ["openai-codex", "anthropic"]) {
	it(`an empty plain Enter still forces the waiting steering on ${provider}, without taking the follow-up`, async (t) => {
		const h = harness(t, { provider });
		await h.steer("waiting");
		h.followUp("later");
		assert.deepEqual(h.press("\r"), { consume: true });
		await h.flush();
		assert.equal(h.session.aborts, 1);
		assert.deepEqual(h.sent, [steer("waiting")]);
		assert.deepEqual(h.session._followUpMessages, ["later"]);
	});
}

it("the force acts only in the input editor without an open autocomplete list", async (t) => {
	const h = harness(t);
	await h.steer("waiting");
	h.state.autocomplete = true;
	assert.equal(h.press(CTRL_ENTER), undefined);
	h.state.autocomplete = false;
	h.state.focused = false;
	assert.equal(h.press(CTRL_ENTER), undefined);
	assert.equal(h.session.aborts, 0);
});

it("a second Ctrl+Enter while the send is pending does nothing more", async (t) => {
	const h = harness(t);
	await h.steer("once");
	assert.deepEqual(h.press(CTRL_ENTER), { consume: true });
	assert.equal(h.press(CTRL_ENTER), undefined);
	await h.flush();
	assert.deepEqual(h.sent, [steer("once")]);
	assert.equal(h.session.aborts, 1);
});

it("not Codex: an empty Ctrl+Enter forces nothing", async (t) => {
	const h = harness(t, { provider: "anthropic" });
	await h.steer("waiting");
	assert.equal(h.press(CTRL_ENTER), undefined);
	assert.equal(h.session.aborts, 0);
	assert.equal(h.session._steeringMessages.length, 1);
});

it("not Codex: Escape with steering waiting sends it silently, the draft stays", async (t) => {
	const h = harness(t, { provider: "anthropic" });
	await h.steer("steer me");
	h.state.editor = "my draft";
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.session.aborts, 1);
	assert.equal(h.state.ctrlAborts, 0, "Pi's own Escape (restore the queue into the editor) is skipped");
	await h.flush();
	assert.deepEqual(h.sent, [steer("steer me")]);
	assert.equal(h.state.editor, "my draft");
	assert.deepEqual(h.notices, []);
});

it("Escape stays Pi's with no steering and with only a follow-up", async (t) => {
	const h = harness(t, { provider: "anthropic" });
	assert.equal(h.press(), undefined);
	h.tick(600);
	h.followUp("later");
	assert.equal(h.press(), undefined);
	assert.equal(h.session.aborts, 0);
});

it("on Codex Escape stays Pi's even with steering waiting", async (t) => {
	const h = harness(t);
	await h.steer("waiting");
	assert.equal(h.press(), undefined);
	assert.equal(h.session.aborts, 0);
	assert.equal(h.session._steeringMessages.length, 1);
});

it("images of the steering go with it", async (t) => {
	const h = harness(t);
	const image = { type: "image", data: "abc", mimeType: "image/png" };
	await h.steer("look at this", [image]);
	await h.steer("and this");
	h.press(CTRL_ENTER);
	await h.flush();
	assert.deepEqual(h.sent, [steer("look at this\n\nand this", [image])]);
});

it("only user steering is taken; other queued messages and a same-text follow-up stay", async (t) => {
	const h = harness(t);
	const custom = { role: "custom", content: "from an extension", timestamp: 1 };
	h.session.agent.steeringQueue.messages.push(custom);
	await h.steer("same text");
	h.followUp("same text");
	h.press(CTRL_ENTER);
	await h.flush();
	assert.deepEqual(h.session.agent.steeringQueue.messages, [custom]);
	assert.deepEqual(h.session._followUpMessages, ["same text"]);
	assert.deepEqual(h.sent, [steer("same text")]);
});

it("an image of a steering input still on its way is kept", async (t) => {
	const h = harness(t);
	const image = { type: "image", data: "abc", mimeType: "image/png" };
	await h.steer("early");
	let arrive!: (value: unknown) => void;
	h.session._runInputHandlers = () => new Promise((resolve) => { arrive = resolve; });
	const late = h.session.prompt("late", { streamingBehavior: "steer", images: [image] });
	h.press(CTRL_ENTER);
	arrive({ text: "late", images: [image] });
	await late;
	await h.flush();
	assert.deepEqual(h.sent, [steer("early\n\nlate", [image])]);
});

it("steering still on its way is awaited and sent once, and its busy prompt does not start a run", async (t) => {
	const h = harness(t);
	await h.steer("early");
	let arrive!: (value: unknown) => void;
	h.session._runInputHandlers = () => new Promise((resolve) => { arrive = resolve; });
	const late = h.session.prompt("late", { streamingBehavior: "steer" });
	h.press(CTRL_ENTER);
	await h.flush();
	assert.deepEqual(h.sent, [], "waits for the input that is still on its way");
	arrive({ text: "late", images: undefined });
	await late;
	await h.flush();
	assert.deepEqual(h.sent, [steer("early\n\nlate")]);
	assert.equal(h.session.started, 1, "one run: the force-send, not a run of the late prompt");
	assert.deepEqual(h.session._steeringMessages, []);
});

it("an input that only is on its way can be forced; a handled one sends nothing", async (t) => {
	const h = harness(t);
	let arrive!: (value: unknown) => void;
	h.session._runInputHandlers = () => new Promise((resolve) => { arrive = resolve; });
	const late = h.session.prompt("swallowed", { streamingBehavior: "steer" });
	assert.deepEqual(h.press(CTRL_ENTER), { consume: true });
	arrive(undefined);
	await late;
	await h.flush();
	assert.deepEqual(h.sent, []);
	assert.equal(h.session.aborts, 1);
});

it("a busy prompt with expansion off joins the force as it is and starts no run of its own", async (t) => {
	const h = harness(t);
	h.session._expandSkillCommand = (text: string) => `EXPANDED ${text}`;
	await h.steer("early");
	let arrive!: (value: unknown) => void;
	h.session._runInputHandlers = () => new Promise((resolve) => { arrive = resolve; });
	const late = h.session.prompt("/not a command", { streamingBehavior: "steer", expandPromptTemplates: false });
	h.press(CTRL_ENTER);
	arrive({ text: "/not a command", images: undefined });
	await late;
	await h.flush();
	assert.deepEqual(h.sent, [steer("early\n\n/not a command")]);
	assert.equal(h.session.started, 1);
});

it("the force starts Pi's run path with the prepared text: input handlers do not run again", async (t) => {
	const h = harness(t);
	await h.steer("prepared");
	let handlers = 0;
	h.session._runInputHandlers = async () => { handlers++; return undefined; };
	h.press(CTRL_ENTER);
	await h.flush();
	assert.deepEqual(h.sent, [steer("prepared")]);
	assert.equal(handlers, 0);
});

it("a run that fails before it starts puts the text back in the editor", async (t) => {
	const h = harness(t);
	await h.steer("lost?");
	h.session._startRun = async () => { throw new Error("no key"); };
	h.press(CTRL_ENTER);
	await h.flush();
	assert.equal(h.state.editor, "lost?");
	assert.match(h.notices.at(-1)!, /no key/);
});

it("a reload during a force-send restores the text at once and the late input when it settles", async (t) => {
	const h = harness(t);
	await h.steer("reserved");
	let arrive!: (value: unknown) => void;
	h.session._runInputHandlers = () => new Promise((resolve) => { arrive = resolve; });
	const late = h.session.prompt("late", { streamingBehavior: "steer" });
	h.press(CTRL_ENTER);
	h.shutdown();
	assert.equal(h.state.editor, "reserved");
	arrive({ text: "late", images: undefined });
	await late;
	await h.flush();
	assert.equal(h.state.editor, "reserved\n\nlate");
	assert.deepEqual(h.session._steeringMessages, []);
	assert.deepEqual(h.sent, []);
});

it("a late input after the context went stale is left to Pi's queue, not lost", async (t) => {
	const h = harness(t);
	await h.steer("reserved");
	let arrive!: (value: unknown) => void;
	h.session._runInputHandlers = () => new Promise((resolve) => { arrive = resolve; });
	const late = h.session.prompt("late", { streamingBehavior: "steer" });
	h.press(CTRL_ENTER);
	h.shutdown();
	Object.defineProperty(h.ctx, "ui", { get() { throw new Error("stale context"); } });
	arrive({ text: "late", images: undefined });
	await late;
	await h.flush();
	assert.deepEqual(h.session._steeringMessages, ["late"]);
	assert.deepEqual(h.sent, []);
});

it("a run that fails before it starts marks the interrupted reply unsent", async (t) => {
	const h = harness(t);
	await h.steer("lost?");
	h.session._startRun = async () => { throw new Error("no key"); };
	h.press(CTRL_ENTER);
	h.fire("message_end", { message: { role: "assistant", content: [{ type: "text", text: "half" }], stopReason: "aborted", timestamp: 31 } });
	await h.flush();
	assert.deepEqual(h.entries, [{ timestamp: 31, unsent: true }]);
	assert.deepEqual(h.fire("context_with_system", { messages: [{ role: "assistant", content: [{ type: "text", text: "half" }], stopReason: "aborted", timestamp: 31 }] }), [undefined]);
});

it("a cancelled force-send still marks its interrupted reply, without replaying it to the model", async (t) => {
	initTheme();
	const h = harness(t, { provider: "anthropic" });
	await h.steer("steer me");
	h.press(ESC);
	h.fire("message_end", { message: { role: "assistant", content: [{ type: "text", text: "half" }], stopReason: "aborted", timestamp: 55 } });
	h.press(ESC);
	await h.flush();
	assert.deepEqual(h.entries, [{ timestamp: 55, unsent: true }]);
	const request = { messages: [{ role: "assistant", content: [{ type: "text", text: "half" }], stopReason: "aborted", timestamp: 55 }] };
	assert.deepEqual(h.fire("context_with_system", request), [undefined], "an unsent reply is not replayed");
	h.manager.getEntries = () => [{ type: "custom", customType: "rqw-send-now", data: { timestamp: 55, unsent: true } }];
	h.fire("session_start");
	assert.doesNotMatch(new AssistantMessageComponent(request.messages[0] as any).render(80).join("\n"), /Operation aborted/);
});

it("key auto-repeat of Ctrl+Enter or Escape is not a press", async (t) => {
	const h = harness(t, { provider: "anthropic" });
	await h.steer("waiting");
	assert.equal(h.press("\x1b[27;1:2u"), undefined);
	assert.equal(h.press("\x1b[13;5:2u"), undefined);
	assert.equal(h.session.aborts, 0);
	assert.equal(h.session._steeringMessages.length, 1);
});

it("a busy prompt that is a registered extension command is left to Pi", async (t) => {
	const h = harness(t);
	h.session._extensionRunner = { getCommand: (name: string) => (name === "mine" ? {} : undefined) };
	h.session._tryExecuteExtensionCommand = async () => true;
	const calls: string[] = [];
	h.session._queueUserInput = async (text: string) => { calls.push(text); return "queued"; };
	await h.session.prompt("/mine now", { streamingBehavior: "steer" });
	assert.deepEqual(calls, []);
});

it("an incompatible queue shape leaves Ctrl+Enter and Escape to Pi", async (t) => {
	const h = harness(t, { provider: "anthropic" });
	await h.steer("waiting");
	delete h.session._emitQueueUpdate;
	assert.equal(h.press(), undefined);
	assert.equal(h.session.aborts, 0);
	h.session._emitQueueUpdate = () => {};
	h.tick(600);
	h.session.agent.steeringQueue.messages = "broken";
	assert.equal(h.press(), undefined);
});

it("an interrupted reply loses its Operation aborted row, others keep it, and the mark survives a reload", async (t) => {
	initTheme();
	const h = harness(t);
	const aborted = (timestamp: number) => ({ role: "assistant", content: [{ type: "text", text: "half an answer" }], stopReason: "aborted", timestamp });
	const drawn = (message: unknown) => new AssistantMessageComponent(message as any).render(80).join("\n");
	await h.steer("steer me");
	h.press(CTRL_ENTER);
	h.fire("message_end", { message: aborted(77) });
	assert.doesNotMatch(drawn(aborted(77)), /Operation aborted/);
	assert.match(drawn(aborted(77)), /half an answer/);
	assert.match(drawn(aborted(78)), /Operation aborted/);
	await h.flush();
	assert.deepEqual(h.entries, [{ timestamp: 77 }]);
	const replay = h.fire("context_with_system", { messages: [{ ...aborted(77), stopReason: "aborted" }] })[0] as { messages: { stopReason: string }[] };
	assert.equal(replay.messages[0].stopReason, "stop", "a sent reply is replayed to the model as finished");
	h.manager.getEntries = () => [{ type: "custom", customType: "rqw-send-now", data: { timestamp: 99 } }];
	h.fire("session_start");
	assert.doesNotMatch(drawn(aborted(99)), /Operation aborted/);
	assert.match(drawn(aborted(77)), /Operation aborted/);
});

it("the status row is kept without a mark, and an aborted reply with an error keeps its other rows", (t) => {
	initTheme();
	const proto = AssistantMessageComponent.prototype as any;
	const stock = proto.updateContent;
	const undo = installQuiet((message) => message.timestamp === 5);
	t.after(undo);
	const draw = (message: unknown) => new AssistantMessageComponent(message as any).render(80).join("\n");
	const base = { role: "assistant", content: [{ type: "text", text: "x" }], stopReason: "aborted" };
	assert.match(draw({ ...base, timestamp: 4 }), /Operation aborted/);
	assert.doesNotMatch(draw({ ...base, timestamp: 5 }), /Operation aborted/);
	assert.match(draw({ ...base, timestamp: 5, stopReason: "error", errorMessage: "boom" }), /Error: boom/);
	undo();
	assert.equal(proto.updateContent, stock);
});

it("an incompatible Pi version or component shape is left alone", () => {
	const proto = { updateContent() {} };
	const original = proto.updateContent;
	installQuiet(() => true, proto, "2.0.0")();
	assert.equal(proto.updateContent, original);
	const missing = {};
	installQuiet(() => true, missing)();
	assert.deepEqual(missing, {});
});
