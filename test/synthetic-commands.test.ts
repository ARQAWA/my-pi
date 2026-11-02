import assert from "node:assert/strict";
import { after, it } from "node:test";
import { keys, reportTimings, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

it("removed commands are absent from slash suggestions", async (t) => {
	const w = await world(t);
	const removed = ["model", "thinking", "tree", "scoped-models", "share", "bug", "fork", "llama"];

	for (const name of removed) {
		w.type(`/${name}`);
		await w.tick(100);
		const suggestion = new RegExp(`^\\s*[→ ]\\s*${name}(?:\\s|$)`);
		const matches = w.screen().filter((line) => suggestion.test(line));
		assert.deepEqual(matches, [], `${name} appears in suggestions`);
		w.press(keys.escape);
		w.press("\x15");
	}

	w.type("/settings");
	await w.tick(100);
	assert.ok(w.screen().some((line) => /^\s*[→ ]\s*settings\s/.test(line)), "settings remains available");
	assert.deepEqual(w.networkAttempts, []);
	await w.dispose();
	assert.deepEqual(w.patched(), []);
});

it("settings search excludes hidden items and keeps visible settings", async (t) => {
	const w = await world(t);
	await w.submit("/settings");
	w.see("Type to search");

	for (const [query, label] of [
		["cache warming", "Cache warming"],
		["default thinking level per model", "Default thinking level per model"],
		["double-escape action", "Double-escape action"],
		["tree filter mode", "Tree filter mode"],
	]) {
		w.type(query);
		w.notSee(label);
		for (const _ of query) w.press(keys.backspace);
	}

	w.type("theme");
	w.see("Theme");
	assert.deepEqual(w.networkAttempts, []);
	await w.dispose();
	assert.deepEqual(w.patched(), []);
});
