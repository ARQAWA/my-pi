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
