import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, it } from "node:test";
import { call, keys, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

it("folds finished work and shows original tool output with Ctrl+O", async (t) => {
	const w = await world(t);
	const file = join(w.dirs.project, "tool-notes.txt");
	writeFileSync(file, "original tool output marker\n");
	const final = w.model.hold((request) => request.context.messages.some((message) => message.role === "toolResult"));
	w.model.script(call("rqw_readfile", { path: file, offset: null, limit: null }, "read-notes"));
	w.type("read the notes");
	w.press(keys.enter);
	await w.until(() => final.arrived, "tool result reaches the model");
	w.see("Read 1 file");
	await w.tick(42_000);
	final.reply(text("notes read"));
	await w.settle();

	w.see("worked for 42s ›");
	w.see("notes read");
	w.notSee("Read 1 file");
	w.notSee("original tool output marker");

	// Ctrl+O changes tool expansion, not the enclosing worked-for fold.
	w.press(keys.ctrlO);
	w.see("worked for 42s ›");
	w.notSee("original tool output marker");
	const row = w.screen().findIndex((line) => line.includes("worked for 42s ›"));
	assert.ok(row >= 0);
	w.press(`\x1b[<0;2;${row + 1}M`);
	w.press(`\x1b[<0;2;${row + 1}m`);
	w.see("original tool output marker");
	w.notSee("worked for 42s ›");

	w.press(keys.ctrlO);
	w.see("Read 1 file");
	w.notSee("original tool output marker");
	assert.deepEqual(w.model.unscripted, []);
	assert.deepEqual(w.networkAttempts, []);
});
