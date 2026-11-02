import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";
import { pathToFileURL } from "node:url";
import { Compile } from "typebox/compile";

it("the theme satisfies Pi's strict native schema", () => {
	const theme = JSON.parse(readFileSync(join(import.meta.dirname, "../../../extensions/RQW-theme/theme.json"), "utf8"));
	const schema = JSON.parse(readFileSync(join(import.meta.dirname, "../../../node_modules/@earendil-works/pi-coding-agent/schemas/theme.schema.json"), "utf8"));
	const check = Compile(schema);
	assert.equal(check.Check(theme), true, JSON.stringify([...check.Errors(theme)]));
	assert.equal(check.Check({ ...theme, colors: { ...theme.colors, pythonMode: "#ffb347" } }), false);
});

it("dialog and list accents render gold", async () => {
	const entry = join(import.meta.dirname, "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
	const { loadThemeFromPath } = await import(pathToFileURL(entry).href);
	const theme = loadThemeFromPath(join(import.meta.dirname, "../../../extensions/RQW-theme/theme.json"), "truecolor");
	assert.match(theme.fg("accent", "selected"), /\x1b\[38;2;201;162;39mselected/);
});

it("custom message boxes have no background and a gold label", () => {
	const theme = JSON.parse(readFileSync(join(import.meta.dirname, "../../../extensions/RQW-theme/theme.json"), "utf8"));
	assert.equal(theme.colors.customMessageBg, "");
	assert.equal(theme.colors.customMessageLabel, "sourceGold");
});

// Synthetic palette map: each token resolved to its hex value (empty = terminal default).
// A deliberate colour change must update this map together with DECISIONS.md.
const expectedColors: Record<string, string> = {
		accent: "#c9a227",
		border: "#2c2b2a",
		borderAccent: "#7f7e7c",
		borderMuted: "#222120",
		success: "#00ff88",
		error: "#ff4757",
		warning: "#ffb347",
		muted: "#adadac",
		dim: "#7f7e7c",
		text: "",
		thinkingText: "#adadac",
		selectedBg: "#2a2826",
		userMessageBg: "#232120",
		userMessageText: "",
		customMessageBg: "",
		customMessageText: "",
		customMessageLabel: "#c9a227",
		toolPendingBg: "#222222",
		toolSuccessBg: "#062b29",
		toolErrorBg: "#351c22",
		toolTitle: "",
		toolOutput: "#adadac",
		mdHeading: "#f0f0f0",
		mdLink: "#e6e6ec",
		mdLinkUrl: "#adadac",
		mdCode: "#d6d6d5",
		mdCodeBlock: "#e6e6ec",
		mdCodeBlockBorder: "#2c2b2a",
		mdQuote: "#adadac",
		mdQuoteBorder: "#3a3836",
		mdHr: "#2c2b2a",
		mdListBullet: "#adadac",
		toolDiffAdded: "#00ff88",
		toolDiffRemoved: "#ff4757",
		toolDiffContext: "#adadac",
		syntaxComment: "#7f7e7c",
		syntaxKeyword: "#d6d6d5",
		syntaxFunction: "#f0f0f0",
		syntaxVariable: "#e6e6ec",
		syntaxString: "#adadac",
		syntaxNumber: "#d6d6d5",
		syntaxType: "#e6e6ec",
		syntaxOperator: "#d6d6d5",
		syntaxPunctuation: "#adadac",
		thinkingOff: "#5a5856",
		thinkingMinimal: "#6a6866",
		thinkingLow: "#80ffc4",
		thinkingMedium: "#00df77",
		thinkingHigh: "#c9a227",
		thinkingXhigh: "#b97cff",
		thinkingMax: "#ff4757",
		bashMode: "#00ff88",
};

it("every theme colour keeps its agreed value", () => {
	const theme = JSON.parse(readFileSync(join(import.meta.dirname, "../../../extensions/RQW-theme/theme.json"), "utf8"));
	const resolved: Record<string, string> = {};
	for (const [token, value] of Object.entries<string>(theme.colors)) resolved[token] = theme.vars[value] ?? value;
	assert.deepEqual(resolved, expectedColors);
});
