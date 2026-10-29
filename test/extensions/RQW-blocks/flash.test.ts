import assert from "node:assert/strict";
import { it } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { installFlash } from "../../../extensions/RQW-blocks/flash.ts";

it("shows successful copy in green and keeps other flashes unchanged", () => {
	const flashes = {
		entries: [{ message: "Copied!" }, { message: "Copy failed" }],
		flash() {}, dispose() {},
		render(width: number) { return this.entries.map(({ message }) => `\x1b[7m ${message.slice(0, width)} \x1b[27m`); },
	};
	const tui = { mode: "fullscreen", flashes };
	const dispose = installFlash(tui, { fg: (_role, text) => `\x1b[32m${text}\x1b[39m` });
	const lines = flashes.render(80);
	assert.equal(stripTerminalSequences(lines[0]), "✓ copied ");
	assert.match(lines[0], /\x1b\[32m/);
	assert.doesNotMatch(lines[0], /\x1b\[7m/);
	assert.match(lines[1], /\x1b\[7m Copy failed /);
	dispose();
	assert.match(flashes.render(80)[0], /\x1b\[7m Copied!/);
});

it("shows a replacement flash at the same length", () => {
	const entries = [{ message: "Copied!" }];
	const flashes = {
		entries,
		flash(message: string) { this.entries.push({ message }); }, dispose() {},
		render(_width: number) { return this.entries.map(({ message }) => `\x1b[7m${message}\x1b[27m`); },
	};
	const restore = installFlash({ mode: "fullscreen", flashes }, { fg: (_role, text) => `\x1b[32m${text}\x1b[39m` });
	assert.match(stripTerminalSequences(flashes.render(80)[0]), /✓ copied/);
	flashes.entries.splice(0, 1);
	flashes.flash("Copy failed");
	assert.match(flashes.render(80)[0], /Copy failed/);
	restore();
	flashes.entries.splice(0, 1);
	flashes.flash("Copied!");
	assert.match(flashes.render(80)[0], /Copied!/);
});
