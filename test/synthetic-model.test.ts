import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, it } from "node:test";
import { call, fail, isTask, keys, reply, reportTimings, text, think, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

const assistantMessages = (w: Awaited<ReturnType<typeof world>>) =>
	w.jsonl().filter((entry) => entry.type === "message" && entry.message.role === "assistant").map((entry) => entry.message);

it("a reply can carry thinking and text, saved in that order", async (t) => {
	const w = await world(t);
	w.model.script(reply(think("weighing"), text("answer")));
	await w.submit("hi");
	w.see("answer");
	const [message] = assistantMessages(w);
	assert.deepEqual(message.content.map((block: { type: string }) => block.type), ["thinking", "text"]);
	assert.equal(message.content[0].thinking, "weighing");
});

it("a scripted tool call runs the real tool and its result reaches the next request", async (t) => {
	const w = await world(t);
	const file = join(w.dirs.project, "notes.txt");
	writeFileSync(file, "first line\nsecond line\n");
	w.model.script(call("rqw_readfile", { path: file, offset: null, limit: null }), text("read it"));
	await w.submit("look");
	w.see("read it");
	const [, followUp] = w.requests.filter((request) => request.background === undefined);
	const result = followUp.context.messages.find((message) => message.role === "toolResult") as any;
	assert.equal(result.toolCallId, "call-1");
	assert.match(JSON.stringify(result.content), /second line/);
});

it("a rule takes only its own requests and hands over when its replies are used up", async (t) => {
	const w = await world(t);
	w.model.script(text("from the script"));
	w.model.when(isTask("hi"), text("from the rule"));
	await w.submit("hi");
	w.see("from the rule");
	await w.submit("again");
	w.see("from the script");
	assert.deepEqual(w.model.unscripted, []);
});

it("a held request stays open until the test answers it", async (t) => {
	const w = await world(t);
	const held = w.model.hold(isTask("hi"));
	w.type("hi");
	w.press(keys.enter);
	await w.until(() => held.arrived, "the request arrives");
	w.notSee("late answer");
	held.reply(text("late answer"));
	await w.settle();
	w.see("late answer");
});

it("an answer given before the request arrives is used when it does", async (t) => {
	const w = await world(t);
	w.model.hold(isTask("hi")).reply(text("early answer"));
	await w.submit("hi");
	w.see("early answer");
});

it("Escape aborts a held request and the turn ends aborted", async (t) => {
	const w = await world(t);
	const held = w.model.hold(isTask("hi"));
	w.type("hi");
	w.press(keys.enter);
	await w.until(() => held.arrived, "the request arrives");
	w.press(keys.escape);
	await w.settle();
	assert.equal(assistantMessages(w).at(-1).stopReason, "aborted");
});

it("a failing reply reaches the screen as the provider error", async (t) => {
	const w = await world(t, { settings: { retry: { enabled: false } } });
	w.model.script(fail("provider says no"));
	await w.submit("hi");
	w.see("provider says no");
	assert.equal(assistantMessages(w).at(-1).stopReason, "error");
});

it("requests are recorded with the model, the context and the background reason", async (t) => {
	const w = await world(t);
	w.model.script(text("hello"));
	await w.submit("hi");
	const main = w.requests.find((request) => isTask("hi")(request) && request.background === undefined)!;
	assert.equal(main.model.provider, w.session.model!.provider);
	assert.equal(main.model.id, w.session.model!.id);
	assert.ok(w.requests.some((request) => request.background?.includes("RQW-naming")), "the naming request is answered by the world");
});
