import assert from "node:assert/strict";
import { after, it } from "node:test";
import { keys, reportTimings, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

it("Shift+Down opens a stepped draft and Enter commits the model", async (t) => {
	const w = await world(t);
	assert.equal(w.session.model?.id, "claude-opus-5-5");
	w.press(keys.shiftDown);
	await w.until(() => w.screen().some((line) => line.includes("› Sonnet 5.5")));
	assert.equal(w.session.model?.id, "claude-opus-5-5");
	assert.equal(w.requests.length, 0);

	w.press(keys.enter);
	await w.until(() => w.session.model?.id === "claude-sonnet-5-5");
	await w.settle();
	assert.equal(w.session.model?.provider, "anthropic");
	w.notSee("Model / effort");
	assert.equal(w.requests.length, 0);
	assert.deepEqual(w.networkAttempts, []);
});

it("Terra offers low through max without off and clamps shortcuts at low", async (t) => {
	const w = await world(t);
	w.press(keys.shiftDown);
	await w.until(() => w.screen().some((line) => line.includes("› Sonnet 5.5")));
	w.press(keys.down);
	w.press(keys.down);
	const row = w.screen().find((line) => line.includes("› GPT-6.1 Terra"));
	assert.ok(row);
	assert.match(row, /low medium high xhigh max/);
	assert.doesNotMatch(row, /\boff\b/);
	w.press(keys.left);
	w.press(keys.left);
	w.press(keys.enter);
	await w.until(() => w.session.model?.id === "gpt-6.1-terra");
	assert.equal(w.session.thinkingLevel, "low");
});

it("Escape discards a changed model and effort without requests", async (t) => {
	const w = await world(t);
	const original = w.session.model;
	const thinking = w.session.thinkingLevel;
	w.press(keys.shiftDown);
	await w.until(() => w.screen().some((line) => line.includes("› Sonnet 5.5")));
	w.press(keys.right);
	w.press(keys.escape);
	await w.until(() => !w.screen().some((line) => line.includes("Model / effort")));
	await w.settle();
	assert.equal(w.session.model, original);
	assert.equal(w.session.thinkingLevel, thinking);
	assert.equal(w.requests.length, 0);
	assert.deepEqual(w.networkAttempts, []);
});
