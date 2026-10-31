import assert from "node:assert/strict";
import { it } from "node:test";
import { harness } from "./harness.ts";

const steer = (prompt: string, images: unknown[] = []) => ({ prompt, images });

it("an empty Enter with only a follow-up, or after a swallowed steering input, does nothing", async (t) => {
	const h = harness(t);
	let arrive!: (value: unknown) => void;
	h.session._runInputHandlers = () => new Promise((resolve) => { arrive = resolve; });
	const swallowed = h.session.prompt("swallowed", { streamingBehavior: "steer" });
	arrive(undefined);
	await swallowed;
	h.followUp("later");
	assert.equal(h.press("\r"), undefined);
	assert.equal(h.session.aborts, 0);
	assert.deepEqual(h.sent, []);
});

it("an empty Enter while a steering input is still on its way forces and sends the late queue", async (t) => {
	const h = harness(t);
	let arrive!: (value: unknown) => void;
	h.session._runInputHandlers = () => new Promise((resolve) => { arrive = resolve; });
	const late = h.session.prompt("late", { streamingBehavior: "steer" });
	assert.deepEqual(h.press("\r"), { consume: true });
	arrive({ text: "late", images: undefined });
	await late;
	await h.flush();
	assert.deepEqual(h.sent, [steer("late")]);
});

it("two Enter keys in one terminal batch send the steering once", async (t) => {
	const h = harness(t);
	await h.steer("once");
	assert.deepEqual(h.press("\r"), { consume: true });
	assert.equal(h.press("\r"), undefined);
	await h.flush();
	assert.deepEqual(h.sent, [steer("once")]);
	assert.equal(h.session.aborts, 1);
});

it("Enter with text queues a follow-up, and an empty Enter in an idle chat or with a malformed queue is left to Pi", async (t) => {
	const h = harness(t);
	await h.steer("waiting");
	h.state.editor = "typed";
	assert.deepEqual(h.press("\r"), { consume: true });
	assert.deepEqual(h.inputs, ["follow-up"]);
	h.state.editor = "";
	h.state.idle = true;
	assert.equal(h.press("\r"), undefined);
	h.state.idle = false;
	for (const broken of [null, [42], "text"]) {
		h.session.agent.steeringQueue.messages = broken;
		assert.equal(h.press("\r"), undefined);
	}
	assert.equal(h.session.aborts, 0);
});
