import assert from "node:assert/strict";
import { after, it } from "node:test";
import { keys, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

it("answers in a side chat and Escape leaves the session and main context unchanged", async (t) => {
	const w = await world(t);
	w.model.script(text("main answer"), text("private side answer"), text("next main answer"));

	await w.submit("main question");
	w.see("main answer");
	const before = w.jsonl();

	await w.submit("/btw private side question");
	await w.until(() => w.screen().some((line) => line.includes("private side answer")), "side answer");
	w.see("private side question");
	w.see("private side answer");
	const side = w.requests.filter((request) => request.background === undefined).at(-1)!;
	assert.match(JSON.stringify(side.context.messages), /main question/);
	assert.match(JSON.stringify(side.context.messages), /private side question/);

	w.press(keys.escape);
	await w.settle();
	w.see("main answer");
	w.notSee("private side answer");
	assert.deepEqual(w.jsonl(), before);

	await w.submit("next main question");
	w.see("next main answer");
	const main = w.requests.filter((request) => request.background === undefined).at(-1)!;
	const context = JSON.stringify(main.context.messages);
	assert.match(context, /main question/);
	assert.match(context, /main answer/);
	assert.match(context, /next main question/);
	assert.doesNotMatch(context, /private side question|private side answer/);
	assert.doesNotMatch(JSON.stringify(w.jsonl()), /private side question|private side answer/);
	assert.deepEqual(w.model.unscripted, []);
	assert.deepEqual(w.networkAttempts, []);
	assert.deepEqual(w.processAttempts, []);
});
