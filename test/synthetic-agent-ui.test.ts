import assert from "node:assert/strict";
import { after, it } from "node:test";
import { call, isTask, keys, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

const ANSWER = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n");

async function finishedChild(t: Parameters<typeof world>[0]) {
	const w = await world(t);
	w.model.when(isTask("count files"), text(ANSWER));
	w.model.script(
		call("agent", { action: "start", task: "count files", title: "Count", model: "anthropic/claude-sonnet-5-5", thinking: "medium" }, "a1"),
		call("agent", { action: "wait", ids: ["agent#1"] }, "a2"),
		text("child said"),
	);
	await w.submit("go");
	return w;
}

it("Ctrl+O shows the result card with the child's id, title, model and thinking", async (t) => {
	const w = await finishedChild(t);
	w.notSee("agent#1 Count finished");

	w.press(keys.ctrlO);
	w.see("agent#1 Count finished · Sonnet 5.5 md");
});

it("Ctrl+O shows the child's whole answer, and Ctrl+O again folds it", async (t) => {
	const w = await finishedChild(t);
	w.notSee("line 1");

	w.press(keys.ctrlO);
	for (const line of ANSWER.split("\n")) w.see(line);
	// The card changes only the display: the model got the answer byte for byte.
	const original = w.requests.at(-1)!.context.messages.findLast((message) => message.role === "toolResult") as { content: { text: string }[] };
	assert.ok(JSON.parse(original.content[0].text).results[0].text.startsWith(`${ANSWER}\n\n`));

	w.press(keys.ctrlO);
	w.notSee("line 1");
	w.see("Waited for 1 agent");
});
