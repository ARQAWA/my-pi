import assert from "node:assert/strict";
import { it, type TestContext } from "node:test";
import { harness } from "./harness.ts";

/** Idle at first; a test flips `state` between presses. */
function setup(t: TestContext, provider = "openai-codex") {
	const h = harness(t, { provider });
	h.state.idle = true;
	return h;
}

it("a single Escape while the turn works is left to Pi and stops no background", (t) => {
	const h = setup(t);
	h.state.idle = false;
	assert.equal(h.press(), undefined);
	assert.equal(h.stops.length, 0);
	h.tick(600);
	assert.equal(h.press(), undefined);
	assert.equal(h.stops.length, 0);
});

it("a double Escape within 500 ms while the turn works stops the background", (t) => {
	const h = setup(t);
	h.state.idle = false;
	h.state.background = 2;
	assert.equal(h.press(), undefined);
	h.tick(499);
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.stops.length, 1);
	assert.match(h.notices.at(-1)!, /Stopped: 2 agents/);
});

it("with only background running the first Escape is taken and the second stops it", (t) => {
	const h = setup(t);
	h.state.background = 1;
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.stops.length, 0);
	h.tick(100);
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.stops.length, 1);
	// A third press right after must not reach the history gesture.
	h.state.background = 0;
	h.tick(100);
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.stops.length, 1);
	h.tick(500);
	assert.equal(h.press(), undefined);
});

it("a double Escape moves held follow-ups back into the editor", (t) => {
	const h = setup(t);
	h.state.background = 1;
	h.followUp("held follow-up");
	h.state.editor = "typed";
	assert.deepEqual(h.press(), { consume: true });
	h.tick(50);
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.stops.length, 1);
	assert.equal(h.state.editor, "held follow-up\n\ntyped");
});

it("presses more than 500 ms apart are two single presses", (t) => {
	const h = setup(t);
	h.state.background = 1;
	assert.deepEqual(h.press(), { consume: true });
	h.tick(500);
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.stops.length, 0);
});

it("an idle chat without background leaves both Escapes to the history gesture", (t) => {
	const h = setup(t);
	assert.equal(h.press(), undefined);
	h.tick(100);
	assert.equal(h.press(), undefined);
	assert.equal(h.stops.length, 0);
});

it("busy is captured on the first press: a turn that ends between the presses still absorbs the second", (t) => {
	const h = setup(t);
	h.state.idle = false;
	assert.equal(h.press(), undefined);
	h.state.idle = true;
	h.tick(100);
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.stops.length, 1);
});

it("background that ends between the presses still absorbs the second", (t) => {
	const h = setup(t);
	h.state.background = 1;
	assert.deepEqual(h.press(), { consume: true });
	h.state.background = 0;
	h.tick(100);
	assert.deepEqual(h.press(), { consume: true });
});

it("compaction counts as work: Pi gets the first press to cancel it", (t) => {
	const h = setup(t);
	h.state.compacting = true;
	assert.equal(h.press(), undefined);
	h.tick(100);
	assert.deepEqual(h.press(), { consume: true });
});

it("an open autocomplete list and other focused components keep their Escape", (t) => {
	const h = setup(t);
	h.state.background = 1;
	h.state.autocomplete = true;
	assert.equal(h.press(), undefined);
	h.state.autocomplete = false;
	h.state.focused = false;
	assert.equal(h.press(), undefined);
	assert.equal(h.press(), undefined);
	assert.equal(h.stops.length, 0);
});

it("a double Escape cancels a force-send that has not started and keeps its text", async (t) => {
	const h = setup(t, "anthropic");
	h.state.idle = false;
	await h.steer("steer me");
	assert.deepEqual(h.press(), { consume: true });
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.stops.length, 1);
	await h.flush();
	h.tick(1000);
	assert.equal(h.state.editor, "steer me");
	assert.deepEqual(h.sent, []);
});

it("a steering input that lands after the cancel is restored with the text, not left in Pi's queue", async (t) => {
	const h = setup(t, "anthropic");
	h.state.idle = false;
	await h.steer("steer me");
	let finish!: (value: unknown) => void;
	h.session._runInputHandlers = () => new Promise((resolve) => { finish = resolve; });
	const late = h.session.prompt("late one", { streamingBehavior: "steer" });
	assert.deepEqual(h.press(), { consume: true });
	assert.deepEqual(h.press(), { consume: true });
	finish({ text: "late one", images: undefined });
	await late;
	await h.flush();
	h.tick(1000);
	assert.equal(h.state.editor, "steer me\n\nlate one");
	assert.deepEqual(h.session._steeringMessages, []);
	assert.deepEqual(h.sent, []);
});
