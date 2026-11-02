import assert from "node:assert/strict";
import { after, it } from "node:test";
import { isTask, keys, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

const ctrlEnter = "\x1b[13;5u";

it("Enter queues a follow-up until the current answer finishes", async (t) => {
	const w = await world(t);
	const held = w.model.hold(isTask("first"));
	w.model.script(text("second answer"));
	w.type("first");
	w.press(keys.enter);
	await w.until(() => held.arrived, "first request arrives");

	w.type("follow up");
	w.press(keys.enter);
	await w.until(() => w.session.getFollowUpMessages().includes("follow up"), "follow-up is queued");
	assert.equal(w.requests.filter((request) => !request.background).length, 1);
	assert.equal(held.request?.options?.signal?.aborted, false);

	held.reply(text("first answer"));
	await w.settle();
	w.see("first answer");
	w.see("second answer");
	const messages = w.jsonl().filter((entry) => entry.type === "message" && entry.message.role !== "system").map((entry) => entry.message);
	assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "user", "assistant"]);
	assert.equal(messages[2].content[0].text, "follow up");
	assert.deepEqual(w.model.unscripted, []);
});

it("empty Enter interrupts the current answer and sends queued steering", async (t) => {
	const w = await world(t);
	const held = w.model.hold(isTask("first"));
	w.model.script(text("steered answer"));
	w.type("first");
	w.press(keys.enter);
	await w.until(() => held.arrived, "first request arrives");

	w.type("change direction");
	w.press(ctrlEnter);
	await w.until(() => w.session.getSteeringMessages().includes("change direction"), "steering is queued");
	assert.equal(held.request?.options?.signal?.aborted, false);
	w.press(keys.enter);
	await w.settle();

	assert.equal(held.request?.options?.signal?.aborted, true);
	w.see("steered answer");
	w.notSee("Operation aborted");
	const messages = w.jsonl().filter((entry) => entry.type === "message").map((entry) => entry.message);
	assert.equal(messages.find((message) => message.role === "assistant" && message.stopReason === "aborted")?.stopReason, "aborted");
	assert.ok(messages.some((message) => message.role === "user" && message.content[0]?.text === "change direction"));
	assert.deepEqual(w.model.unscripted, []);
});

it("Ctrl+R restarts an Escape-interrupted turn once", async (t) => {
	const w = await world(t);
	const held = w.model.hold(isTask("first"));
	w.model.script(text("resumed answer"));
	w.type("first");
	w.press(keys.enter);
	await w.until(() => held.arrived, "first request arrives");
	w.press(keys.escape);
	await w.settle();
	assert.equal(held.request?.options?.signal?.aborted, true);
	assert.ok(w.jsonl().some((entry) => entry.type === "message" && entry.message.role === "assistant" && entry.message.stopReason === "aborted"));

	w.press(keys.ctrlR);
	await w.settle();
	w.see("resumed answer");
	assert.equal(w.requests.filter((request) => !request.background).length, 2);
	w.press(keys.ctrlR);
	await w.settle();
	assert.equal(w.requests.filter((request) => !request.background).length, 2);
	assert.deepEqual(w.model.unscripted, []);
});
