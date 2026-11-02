import assert from "node:assert/strict";
import { after, it } from "node:test";
import { isTask, keys, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

it("Escape while scrolled up returns to the latest message without interrupting the turn", async (t) => {
	const w = await world(t);
	const history = Array.from({ length: 60 }, (_, index) => `History line ${index + 1}`).join("\n\n");
	w.model.script(text(`${history}\n\nLatest history marker`));
	await w.submit("history");
	w.see("Latest history marker");

	const held = w.model.hold(isTask("history"));
	w.type("continue");
	w.press(keys.enter);
	await w.until(() => held.arrived, "the turn starts");
	w.press("\x1b[5~");
	w.notSee("Latest history marker");
	w.see("esc/ctrl+end");

	w.press(keys.escape);
	w.see("Latest history marker");
	w.notSee("esc/ctrl+end");
	assert.equal(held.request!.options?.signal?.aborted, false);
	assert.equal(w.session.isStreaming, true);
	held.reply(text("turn completed"));
	await w.settle();
	w.see("turn completed");
	assert.equal(w.jsonl().filter((entry) => entry.type === "message" && entry.message.role === "assistant").at(-1).message.stopReason, "stop");
});

it("Escape at the bottom interrupts the running turn", async (t) => {
	const w = await world(t);
	const held = w.model.hold(isTask("hi"));
	w.type("hi");
	w.press(keys.enter);
	await w.until(() => held.arrived, "the turn starts");
	w.press(keys.escape);
	await w.settle();
	assert.equal(held.request!.options?.signal?.aborted, true);
	assert.equal(w.jsonl().filter((entry) => entry.type === "message" && entry.message.role === "assistant").at(-1).message.stopReason, "aborted");
});
