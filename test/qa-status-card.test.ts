import assert from "node:assert/strict";
import { it } from "node:test";
import { createQaCard } from "../.pi/extensions/qa-status/card.ts";

const theme: any = { fg: (_color: string, text: string) => text };
const content = "RED release tests: failure #1 attempt 1 https://x/1";

function lines(expanded: boolean, details?: unknown): string[] {
	const message: any = { customType: "qa-status", content, details };
	const component = (createQaCard as any)(message, { expanded, outputPad: 0 }, theme);
	return component.render(100);
}

it("collapsed card shows the stored whole-snapshot red and green counts", () => {
	assert.deepEqual(lines(false, { red: 2, green: 3 }), ["qa-status · 2 red · 3 green"]);
});

it("collapsed card of an older message without counts reads its own lines", () => {
	assert.deepEqual(lines(false), ["qa-status · 1 red · 0 green"]);
	assert.deepEqual(lines(false, { red: "2" }), ["qa-status · 1 red · 0 green"]);
});

it("expanded card keeps the original lines and links", () => {
	const rows = lines(true, { red: 2, green: 3 }).map((row) => row.trim());
	assert.ok(rows.includes("RED release tests: failure #1 attempt 1"));
	assert.ok(rows.includes("https://x/1"));
});
