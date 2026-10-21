import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type BorderSource, ContextEditor } from "../editor.ts";
import { type BarState, plain, renderBar } from "../render.ts";

const sample: BarState = {
	model: { id: "sonnet", name: "Claude Sonnet 5.5", reasoning: true }, thinkingLevel: "high",
	context: { tokens: 13100, limit: 450000 }, compactions: 2, rate: 52.4,
	place: { kind: "worktree", text: "my-pi/statusbar" },
	git: { branch: "rqw-statusbar", unstaged: 1, staged: 2, untracked: 3 }, statuses: [],
};

const id = "019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b";

/** Pi's working indicator as `CustomEditor` uses it: the spinner and message, cut to the given width. */
const working = (message = "Working...") => ({
	renderInBorder: (width: number) => truncateToWidth(`\u280b ${message}`, width, ""),
	renderSpinnerInBorder: (width: number) => truncateToWidth("\u280b", width, ""),
}) as never;

function editor(source: BorderSource | undefined, text: string, cursorUp = 0, status?: string) {
	const tui = { requestRender() {}, terminal: { rows: 40 } } as never;
	const theme = { borderColor: (text: string) => text, selectList: {} } as never;
	const result = new ContextEditor(tui, theme, { matches: () => false } as never, () => source);
	result.setText(text);
	for (let i = 0; i < cursorUp; i++) result.handleInput("\x1b[A");
	if (status !== undefined) result.setWorkingStatusIndicator(working(status));
	return result;
}

const source: BorderSource = { context: () => sample.context, sessionId: () => id, paint: () => plain };
const many = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");

/** What the owner sees below the transcript: Pi's editor with the context bar as its bottom border, then the footer. */
function screen(width: number, text: string, cursorUp = 0, status?: string): string[] {
	return [...editor(source, text, cursorUp, status).render(width), ...renderBar(sample, width).slice(1)]
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
		"80 working": screen(80, "hello", 0, "Working..."),
		"48 working": screen(48, "hello", 0, "Working..."),
		"80 hidden above": screen(80, many),
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
	assert.equal(stock.render(80)[0], "\u2500".repeat(80), "no session ID without a source");
});

it("the top border is Pi's own at a reduced width plus the whole session ID, or Pi's own when the ID does not fit", () => {
	const top = (e: ContextEditor, width: number) => (e as unknown as { renderTopBorder(w: number, h: number): string })
		.renderTopBorder(width, (e as unknown as { scrollOffset: number }).scrollOffset);
	const cases: [string, ContextEditor, ContextEditor, number][] = [
		// The first width with the ID: 40 cells for " <36-cell ID> \u2500\u2500", and Pi's border at the remaining width must keep
		// its full text and end in two rule cells (idle 2; "\u2500\u2500 " + status + " " + 2 with a status; a centred hint).
		["idle", editor(source, "hello"), editor(undefined, "hello"), 42],
		["working", editor(source, "hello", 0, "Working..."), editor(undefined, "hello", 0, "Working..."), 58],
		["long status", editor(source, "hello", 0, "x".repeat(70)), editor(undefined, "hello", 0, "x".repeat(70)), 118],
		["hidden above", editor(source, many), editor(undefined, many), 53],
		["hidden and working", editor(source, many, 0, "Working..."), editor(undefined, many, 0, "Working..."), 84],
	];
	for (const [label, ours, stock, from] of cases) {
		for (let width = 1; width <= 160; width++) {
			const line = ours.render(width)[0];
			const pi = stock.render(width)[0];
			assert.equal(visibleWidth(line), width, `${label} ${width}`);
			assert.equal(top(stock, width), pi);
			if (width < from) {
				assert.equal(line, pi, `${label} ${width}: the ID is dropped, Pi's border is unchanged`);
				continue;
			}
			assert.equal(line, `${top(stock, width - 40)} ${id} \u2500\u2500`, `${label} ${width}`);
			assert.match(top(stock, width - 40), /\u2500\u2500$/);
		}
	}
	assert.equal(editor(source, "hello").render(80)[0], `${"\u2500".repeat(40)} ${id} \u2500\u2500`);
	assert.equal(editor(source, "hello", 0, "Working...").render(80)[0],
		`\u2500\u2500 \u280b Working... ${"\u2500".repeat(24)} ${id} \u2500\u2500`);
});
