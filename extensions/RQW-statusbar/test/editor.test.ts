import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { type BorderSource, ContextEditor } from "../editor.ts";
import { type BarState, plain, renderBar } from "../render.ts";

const sample: BarState = {
	model: { id: "sonnet", name: "Claude Sonnet 5.5", reasoning: true }, thinkingLevel: "high",
	context: { tokens: 13100, limit: 450000 }, compactions: 2, rate: 52.4,
	place: { kind: "worktree", text: "my-pi/statusbar" },
	git: { branch: "rqw-statusbar", unstaged: 1, staged: 2, untracked: 3 }, statuses: [],
};

function editor(source: BorderSource | undefined, text: string, cursorUp = 0) {
	const tui = { requestRender() {}, terminal: { rows: 40 } } as never;
	const theme = { borderColor: (text: string) => text, selectList: {} } as never;
	const result = new ContextEditor(tui, theme, { matches: () => false } as never, () => source);
	result.setText(text);
	for (let i = 0; i < cursorUp; i++) result.handleInput("\x1b[A");
	return result;
}

const source: BorderSource = { context: () => sample.context, paint: () => plain };
const many = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");

/** What the owner sees below the transcript: Pi's editor with the context bar as its bottom border, then the footer. */
function screen(width: number, text: string, cursorUp = 0): string[] {
	return [...editor(source, text, cursorUp).render(width), ...renderBar(sample, width).slice(1)]
		// Terminal APC markers (Pi's cursor position) are not text; strip them before the SGR codes.
		.map((line) => stripVTControlCharacters(line.replace(/\x1b_[^\x07]*\x07/g, "")).replace(/\s+$/, ""));
}

it("deterministic editor and footer renders match the committed snapshots", () => {
	const actual = {
		"80": screen(80, "hello"),
		"48": screen(48, "hello"),
		"24": screen(24, "hello"),
		"80 hidden": screen(80, many, 19),
		"24 hidden": screen(24, many, 19),
	};
	const expected = JSON.parse(readFileSync(new URL("./editor.snap.json", import.meta.url), "utf8"));
	assert.deepEqual(actual, expected);
});

it("without a source the border is Pi's stock one, and the editor is a CustomEditor with an embedded status", () => {
	const stock = editor(undefined, "hello");
	assert.ok(stock instanceof CustomEditor);
	assert.equal(stock.embedWorkingStatus, true);
	assert.equal(stock.render(20).at(-1), "\u2500".repeat(20));
	assert.match(editor(undefined, many, 19).render(40).at(-1)!, /^\u2500+ \u2193 8 more \u2500+$/);
	// The top border and its scroll hint are untouched.
	assert.match(editor(source, many).render(40)[0], /^\u2500+ \u2191 8 more \u2500+$/);
});
