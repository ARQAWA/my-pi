import assert from "node:assert/strict";
import { after, it } from "node:test";
import { reportTimings, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

it("draws the first frame in RQW-theme colours", async (t) => {
	const w = await world(t);
	assert.equal(w.settings.getTheme(), "RQW-theme");
	const frame = w.raw();
	// RQW-theme's dim foreground is #96918a.
	assert.ok(frame.some((line) => line.includes("38;2;150;145;138")), "first frame uses the theme's dim colour");
	assert.ok(w.output.join("").includes("38;2;150;145;138"), "startup terminal output uses the theme's dim colour");
	assert.deepEqual(w.errors, []);
	assert.deepEqual(w.networkAttempts, []);
});
