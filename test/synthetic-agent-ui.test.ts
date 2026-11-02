import assert from "node:assert/strict";
import { after, it } from "node:test";
import { call, isTask, keys, reportTimings, text, world } from "./synthetic/world.ts";
import { untilWake } from "./synthetic/wake.ts";

after(() => reportTimings(import.meta.filename));

const ANSWER = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n");

async function finishedChild(t: Parameters<typeof world>[0]) {
	const w = await world(t);
	w.model.when(isTask("count files"), text(ANSWER));
	w.model.script(
		call("agent", { action: "start", task: "count files", title: "Count", model: "anthropic/claude-sonnet-5-5", thinking: "medium" }, "a1"),
		text("started"),
		text("child said"),
	);
	await w.submit("go");
	const delivered = await untilWake(w);
	return { w, delivered };
}

// An automatic result is one hidden message: no card in the chat, and the model gets the answer byte for byte.
it("the result of a child is hidden in the chat, also with Ctrl+O", async (t) => {
	const { w } = await finishedChild(t);
	w.see("child said");
	w.notSee("agent#1 Count finished");
	w.notSee("line 1");

	w.press(keys.ctrlO);
	w.notSee("agent#1 Count finished");
	w.notSee("line 1");
});

it("the model gets the whole answer of the child byte for byte", async (t) => {
	const { delivered } = await finishedChild(t);
	assert.ok(JSON.parse(delivered).results[0].text.startsWith(`${ANSWER}\n\n`));
});
