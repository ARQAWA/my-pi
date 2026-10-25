import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type BorderSource, ContextEditor } from "../editor.ts";
import { type ActivityChrome, type BarState, plain, renderBar } from "../render.ts";

const sample: BarState = {
	model: { id: "sonnet", name: "Claude Sonnet 5.5", reasoning: true }, thinkingLevel: "high",
	context: { tokens: 13100, limit: 450000 }, compactions: 2, rate: 52.4,
	place: { kind: "worktree", text: "my-pi/statusbar" },
	git: { branch: "rqw-statusbar", unstaged: 1, staged: 2, untracked: 3 }, statuses: [],
};

const id = "019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b";
const rule = (width: number) => "\u2500".repeat(Math.max(0, width));

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
const plainTop = (width: number, src: BorderSource | undefined, text = "hello") =>
	stripVTControlCharacters(editor(src, text).render(width)[0]);

/** What the owner sees below the transcript: Pi's editor with the context bar as its bottom border, then the footer. */
function screen(width: number, text: string, cursorUp = 0, status?: string): string[] {
	return [...editor(source, text, cursorUp, status).render(width), ...renderBar(sample, width).slice(1)]
		// Terminal APC markers (Pi's cursor position) are not text; strip them before the SGR codes.
		.map((line) => stripVTControlCharacters(line.replace(/\x1b_[^\x07]*\x07/g, "")).replace(/\s+$/, ""));
}

/** The top border as text for `width` >= 12 with `hidden` lines above: Pi's centred hint, then the ID when `withId`. */
function expectedTop(width: number, hidden: number, withId: boolean): string {
	const rest = withId ? width - id.length - 4 : width;
	if (hidden === 0) return withId ? `${rule(rest)} ${id} \u2500\u2500` : rule(rest);
	const hint = ` \u2191 ${hidden} more `;
	const left = Math.floor((rest - hint.length) / 2);
	const head = rule(left) + hint + rule(rest - left - hint.length);
	return withId ? `${head} ${id} \u2500\u2500` : head;
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

it("without a source the border is Pi's stock one with embedded status", () => {
	const stock = editor(undefined, "hello");
	assert.ok(stock instanceof CustomEditor);
	assert.equal(stock.embedWorkingStatus, true);
	assert.equal(stock.render(20).at(-1), "\u2500".repeat(20));
	assert.match(editor(undefined, many, 19).render(40).at(-1)!, /^\u2500+ \u2193 8 more \u2500+$/);
	assert.equal(stock.render(80)[0], "\u2500".repeat(80), "no session ID without a source");
});

it("without a source the editor restores Pi's embedded native indicator", () => {
	const stock = stripVTControlCharacters(editor(undefined, "hello", 0, "Working...").render(80)[0]);
	assert.match(stock, /⠋ Working\.\.\./);
});

it("with a source the native indicator is never drawn: an injected status is ignored at every width", () => {
	for (let width = 1; width <= 160; width++) {
		assert.equal(editor(source, "hello", 0, "Working...").render(width)[0], editor(source, "hello").render(width)[0], `${width}`);
	}
});

it("with a source the idle top border is a continuous rule with the whole ID when it fits, every width 0..160 exact", () => {
	for (let width = 1; width <= 160; width++) {
		const line = plainTop(width, source);
		assert.equal(visibleWidth(line), width, `${width}`);
		assert.equal(line, width - id.length - 4 >= 2 ? expectedTop(width, 0, true) : rule(width), `${width}`);
	}
	assert.equal(plainTop(80, source), `${rule(40)} ${id} \u2500\u2500`);
	assert.equal(plainTop(41, source), rule(41), "one cell short of the ID: the ID is dropped, not cut");
	assert.equal(plainTop(42, source), `${rule(2)} ${id} \u2500\u2500`);
});

it("with hidden lines above the hint is centred as Pi centres it, the ID kept when the whole hint and ID fit", () => {
	for (let width = 12; width <= 160; width++) {
		const line = plainTop(width, source, many);
		assert.equal(visibleWidth(line), width, `${width}`);
		assert.equal(line, expectedTop(width, 8, width - id.length - 4 >= 12), `${width}`);
	}
	assert.equal(plainTop(80, source, many), `${rule(15)} \u2191 8 more ${rule(15)} ${id} \u2500\u2500`);
});

it("the session title sits after `── `; the ID is dropped before the title is cut", () => {
	const active = (text: string, compacting = false): BorderSource => ({ ...source,
		sessionName: () => text,
		activity: (): ActivityChrome => ({ text: "Not in border", compacting, frame: 0 }) });
	assert.equal(plainTop(80, active("Planning next moves")),
		`\u2500\u2500 Planning next moves ${rule(17)} ${id} \u2500\u2500`);
	assert.equal(plainTop(65, active("Planning next moves")), `\u2500\u2500 Planning next moves \u2500\u2500 ${id} \u2500\u2500`);
	assert.equal(plainTop(64, active("Planning next moves")), `\u2500\u2500 Planning next moves ${rule(41)}`, "no ID, status whole");
	assert.equal(plainTop(80, active("Compacting context", true)), `\u2500\u2500 Compacting context ${rule(18)} ${id} \u2500\u2500`);
	// A 70-cell status needs 76 cells before the ID's 40: the ID shows from width 116 only, and the status is never cut for it.
	const long = "x".repeat(70);
	for (let width = 1; width <= 160; width++) {
		const line = editor(active(long), "hello").render(width)[0];
		assert.equal(visibleWidth(line), width, `long ${width}`);
		assert.equal(stripVTControlCharacters(line).includes(id), width >= 116, `long ${width}`);
	}
});

it("the top border is never Pi's native spinner, even with a status and a narrow width", () => {
	for (let width = 1; width <= 160; width++) {
		assert.ok(!plainTop(width, source, "hello").includes("\u280b"), `${width}`);
	}
});
