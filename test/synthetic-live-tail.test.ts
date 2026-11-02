import assert from "node:assert/strict";
import { after, it } from "node:test";
import { reply, reportTimings, text, think, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

it("shows the placeholder while the answer streams and the full answer afterwards", async (t) => {
	const w = await world(t);
	const frames: string[] = [];
	const unsubscribe = w.session.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			frames.push(w.screen().join("\n"));
		}
	});
	t.after(unsubscribe);
	w.model.script(text("The complete streamed answer is visible only after it finishes."));

	await w.submit("Explain this");

	assert.ok(frames.length > 0, "the answer produced streaming frames");
	for (const frame of frames) {
		assert.match(frame, /writing answer/);
		assert.doesNotMatch(frame, /The complete/);
	}
	w.see("The complete streamed answer is visible only after it finishes.");
	w.notSee("writing answer");
});

it("leaves thinking visible while streaming", async (t) => {
	const w = await world(t, { settings: { hideThinkingBlock: false } });
	let thinkingFrame = "";
	const unsubscribe = w.session.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_end") {
			thinkingFrame = w.screen().join("\n");
		}
	});
	t.after(unsubscribe);
	w.model.script(reply(think("Consider this carefully."), text("Finished response.")));

	await w.submit("Think first");

	assert.match(thinkingFrame, /Consider this carefully\./);
	assert.doesNotMatch(thinkingFrame, /writing answer/);
	w.see("Consider this carefully.");
	w.see("Finished response.");
});
