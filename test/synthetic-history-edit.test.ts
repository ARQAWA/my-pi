import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { after, it } from "node:test";
import { keys, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

type World = Awaited<ReturnType<typeof world>>;

/** Role and text of the conversation messages on the file's branch, system prompt left out. */
function conversation(w: World): [string, string][] {
	return w.jsonl()
		.filter((entry) => entry.type === "message" && entry.message.role !== "system")
		.map((entry) => [entry.message.role, entry.message.content.map((block: { text?: string }) => block.text ?? "").join("")]);
}

const screenText = (w: World) => w.screen().join("\n");

it("Esc Esc opens the list of messages; editing one cuts the history there and sends the new text", async (t) => {
	const w = await world(t);
	w.model.script(text("a1"), text("a2"), text("a3"));
	await w.submit("first");
	await w.submit("second");

	w.press(keys.escape);
	w.press(keys.escape);
	await w.until(() => screenText(w).includes("Message 2 of 2"), "the list of messages shows");
	w.press(keys.enter);
	await w.until(() => screenText(w).includes("Enter truncates history"), "the message is in the editor");
	w.type(" edited");
	w.press(keys.enter);
	await w.until(() => conversation(w).some(([, content]) => content === "a3"), "the edited message got its answer");
	await w.settle();

	assert.deepEqual(conversation(w), [["user", "first"], ["assistant", "a1"], ["user", "second edited"], ["assistant", "a3"]]);
	w.see("second edited");
	w.see("a3");
	w.notSee("a2");
	const last = w.requests.filter((request) => request.background === undefined).at(-1)!;
	assert.doesNotMatch(JSON.stringify(last.context.messages.filter((message) => message.role !== "system")), /a2/);
});

it("Esc cancels the edit and leaves the history as it was", async (t) => {
	const w = await world(t);
	w.model.script(text("a1"));
	await w.submit("first");
	const before = conversation(w);

	w.press(keys.escape);
	w.press(keys.escape);
	await w.until(() => screenText(w).includes("Message 1 of 1"), "the list of messages shows");
	w.press(keys.enter);
	await w.until(() => screenText(w).includes("Enter truncates history"), "the message is in the editor");
	w.press(keys.escape);
	await w.until(() => screenText(w).includes("Message 1 of 1"), "back in the list");
	w.press(keys.escape);
	await w.settle();

	assert.deepEqual(conversation(w), before);
	assert.equal(w.requests.filter((request) => request.background === undefined).length, 1, "no new request");
});

// Pi 1.4.0 passes the whole tail after a compaction to push(...), which throws a RangeError at about 120000 entries.
const TAIL = 130_000;

it("a session with a very long tail after a compaction opens and shows its tail without a stack overflow", async (t) => {
	const w = await world(t);
	w.model.script(text("first answer"));
	await w.submit("first question");

	const entries = w.jsonl();
	const keptId = entries.find((entry) => entry.type === "message" && entry.message.role === "user").id;
	const assistant = entries.findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
	const stamp = "2026-11-02T00:00:00.000Z";
	const lines: string[] = [];
	let parent: string = entries.at(-1).id;
	const add = (entry: Record<string, unknown>) => { lines.push(JSON.stringify({ ...entry, parentId: parent, timestamp: stamp })); parent = entry.id as string; };
	add({ type: "compaction", id: "cmp-1", summary: "SUMMARY OF THE OLD PART", firstKeptEntryId: keptId, tokensBefore: 1000 });
	for (let index = 0; index < TAIL; index++) add({ type: "custom", id: `pad-${index}`, customType: "pad", data: {} });
	add({ type: "message", id: "tail-user", message: { role: "user", content: [{ type: "text", text: "tail question" }], timestamp: 1 } });
	add({ ...assistant, id: "tail-assistant", message: { ...assistant.message, content: [{ type: "text", text: "tail answer" }] } });
	appendFileSync(w.sessionFile!, `${lines.join("\n")}\n`);

	const w2 = await w.restart();
	assert.deepEqual(w2.errors, []);
	assert.deepEqual(w2.exitCodes, []);
	w2.see("tail answer");
	const context = JSON.stringify(w2.session.sessionManager.buildSessionContext().messages);
	assert.match(context, /SUMMARY OF THE OLD PART/);
	assert.match(context, /tail question/);
	assert.match(context, /tail answer/);
});
