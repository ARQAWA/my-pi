import assert from "node:assert/strict";
import { after, it } from "node:test";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { reportTimings, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

const MOUSE_SET = /\x1b\[\?1000h.*?\x1b\[\?1006h/;
const HOOK = "TuiAltScreen.prototype.afterTerminalStart";
const windows = process.platform === "win32";

// The extension reads the platform when it loads, and other extensions build platform paths from it, so the
// scenarios run on the platform of the machine: macOS and Windows both run them in CI.
it("the start turns mouse reporting on once, and on Windows once more, with Pi's own set", async (t) => {
	const w = await world(t);
	const sets = w.output.flatMap((chunk) => chunk.match(MOUSE_SET) ?? []);
	assert.equal(sets.length, windows ? 2 : 1);
	assert.ok(sets.every((set) => set === sets[0]));
	assert.equal(w.patched().includes(HOOK), windows);
});

it("the patch leaves with the session and Pi's screen class is stock again", async (t) => {
	const w = await world(t);
	await w.dispose();
	assert.equal(Object.getOwnPropertyDescriptor(TuiAltScreen.prototype, "afterTerminalStart"), undefined);
});
