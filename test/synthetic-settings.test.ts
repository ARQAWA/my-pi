import assert from "node:assert/strict";
import { after, it } from "node:test";
import { keys, reportTimings, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

it("starts with codemode and tool_search enabled", async (t) => {
	const w = await world(t);
	const tools = w.session.getActiveToolNames();
	assert.ok(tools.includes("codemode"));
	assert.ok(tools.includes("tool_search"));
});

it("shows GPT Fast on Codex", async (t) => {
	const state = (globalThis as Record<symbol, { on: boolean } | undefined>)[Symbol.for("rqw-settings/fast-gpt")];
	const wasOn = state?.on ?? false;
	const w = await world(t);
	try {
		w.press(keys.shiftDown);
		await w.until(() => w.screen().some((line) => line.includes("Model / effort")), "model chooser opens");
		w.press(keys.down);
		w.press(keys.down);
		w.press(keys.enter);
		await w.until(() => w.session.model?.provider === "openai-codex", "Codex model selected");
		await w.submit("/fast-gpt off");
		w.notSee("\uf0e7");
		await w.submit("/fast-gpt on");
		w.see("\uf0e7");
	} finally {
		await w.submit(`/fast-gpt ${wasOn ? "on" : "off"}`);
	}
});
