import assert from "node:assert/strict";
import { it } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { installJump } from "../../../extensions/RQW-blocks/jump.ts";

it("shows the compact gold jump label and restores the stock indicator", () => {
	const tui = { mode: "fullscreen", scrollToEndIndicator: () => "stock" };
	const theme = { fg: (_role: "dim", text: string) => text, getColorMode: () => "truecolor" as const };
	const dispose = installJump(tui, () => theme);
	const line = tui.scrollToEndIndicator();
	assert.match(stripTerminalSequences(line), /↓ latest · /);
	assert.match(line, /\x1b\[38;2;138;109;28m↓/);
	assert.match(line, /\x1b\[38;2;227;196;90mt/);
	assert.doesNotMatch(line, /\x1b\[48;/);
	dispose();
	assert.equal(tui.scrollToEndIndicator(), "stock");
});

it("updates the hint when the theme changes without changing colour mode", () => {
	const tui = { mode: "fullscreen", scrollToEndIndicator: () => "stock" };
	let theme = { fg: (_role: "dim", text: string) => `\x1b[31m${text}\x1b[39m`, getColorMode: () => "truecolor" as const };
	installJump(tui, () => theme);
	assert.match(tui.scrollToEndIndicator(), /\x1b\[31m/);
	theme = { ...theme, fg: (_role, text) => `\x1b[34m${text}\x1b[39m` };
	assert.match(tui.scrollToEndIndicator(), /\x1b\[34m/);
});
