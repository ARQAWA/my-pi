import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";
import { Compile } from "typebox/compile";

it("the theme satisfies Pi's strict native schema", () => {
	const theme = JSON.parse(readFileSync(join(import.meta.dirname, "../../../extensions/RQW-theme/theme.json"), "utf8"));
	const schema = JSON.parse(readFileSync(join(import.meta.dirname, "../../../node_modules/@earendil-works/pi-coding-agent/schemas/theme.schema.json"), "utf8"));
	const check = Compile(schema);
	assert.equal(check.Check(theme), true, JSON.stringify([...check.Errors(theme)]));
	assert.equal(check.Check({ ...theme, colors: { ...theme.colors, pythonMode: "#ffb347" } }), false);
});
