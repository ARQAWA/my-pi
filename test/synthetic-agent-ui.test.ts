import assert from "node:assert/strict";
import { after, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
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

it("draws a saved agent result as a compact card and expands it", async (t) => {
	const initial = await world(t);
	initial.model.script(text("ready"));
	await initial.submit("start");
	const original = Array.from({ length: 8 }, (_, index) => `line ${index + 1}: original content`);
	initial.session.sessionManager.appendCustomMessageEntry("agent", `[agent#7] ${original.join("\n")}`, true, { outcome: "finished", title: "Count files" });
	const w = await initial.restart();
	w.see("agent#7 Count files finished");
	w.see("line 8");
	w.notSee("line 1");
	w.press(keys.ctrlO);
	for (const line of original) w.see(line);
	w.press(keys.ctrlO);
	w.host.renderer.terminal.columns = 30;
	w.see("line 8");
	assert.ok(w.screen().every((line: string) => visibleWidth(line) <= 30));
});

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
