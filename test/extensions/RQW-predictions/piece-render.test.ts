import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { draftOf } from "../../../extensions/RQW-predictions/context.ts";
import { DIM, harness, settle, suggestion } from "./harness.ts";

const LEFT = "\x1b[D";
// Pi writes its cursor and its marker as APC sequences, which the Node helper leaves in.
const plain = (row: string) => stripVTControlCharacters(row.replace(/\x1b_[^\x07]*\x07/g, ""));
const body = (rows: string[]) => rows.slice(1, -1).map(row => plain(row).trimEnd());

type H = ReturnType<typeof harness>;

/** A chat whose editor holds `text` with the cursor at `col`, and whose model has answered `piece` for that draft. */
async function withPiece(text: string, col: number, piece: string | null, options: Parameters<typeof harness>[0] = {}): Promise<H> {
	const h = harness({ replies: [suggestion(null), suggestion(piece)], ...options });
	h.answer();
	await settle();
	h.editor.setText(text);
	for (let i = text.length; i > col; i--) h.key(LEFT);
	h.controller.continueDraft(draftOf(text, h.editor.getCursor()));
	await settle();
	return h;
}

/** What Pi's own editor draws for `text` already typed, the cursor after it. */
function stock(text: string, width: number): string[] {
	const editor = new CustomEditor({ requestRender() {}, terminal: { rows: 40, columns: 80 } } as never,
		{ borderColor: (value: string) => value, selectList: {} } as never, { matches: () => false } as never);
	editor.setText(text);
	return body(editor.render(width));
}

describe("RQW-predictions gray piece", () => {
	it("cursor at the end: the piece follows the text in gray, the cursor sits on its first character, the buffer stays as typed", async () => {
		const h = await withPiece("Fix the", 7, " failing tests");
		const rows = h.screen();
		assert.equal(rows.length, 3);
		assert.equal(plain(rows[1]).trimEnd(), "Fix the failing tests");
		assert.ok(rows[1].includes(`Fix the${CURSOR_MARKER}`));
		assert.ok(rows[1].includes(`${DIM}failing tests\x1b[39m`));
		assert.equal(rows[1].split(CURSOR_MARKER).length - 1, 1);
		assert.equal(h.editor.getText(), "Fix the");
		assert.deepEqual(h.editor.getCursor(), { line: 0, col: 7 });
		assert.equal(visibleWidth(rows[1].replaceAll(CURSOR_MARKER, "")), 80);
	});

	it("cursor in the middle: the piece sits right there, the text after it stays normal", async () => {
		const h = await withPiece("Fix the tests now", 7, " failing");
		const [row] = h.screen().slice(1, 2);
		assert.equal(plain(row).trimEnd(), "Fix the failing tests now");
		assert.ok(row.includes(`${DIM}failing\x1b[39m tests now`));
		assert.equal(row.includes(`${DIM}tests`), false);
		assert.equal(h.editor.getText(), "Fix the tests now");
	});

	it("is drawn exactly as Pi draws the text after Tab, at any width and cursor place, through wraps and line breaks", async () => {
		const text = "Update the README of the extension and then add the tests for 漢字かな and the cursor in the middle";
		const piece = " alpha_beta_gamma delta_epsilon_zeta 漢字かな_交じり eta_theta 🙂_iota today";
		for (const col of [text.length, 40, 12, 0]) {
			const h = await withPiece(text, col, piece);
			for (const width of [80, 41, 24]) {
				assert.deepEqual(body(h.screen(width)), stock(text.slice(0, col) + piece + text.slice(col), width), `col ${col}, width ${width}`);
			}
		}
		const multi = await withPiece("first line\nsecond line", 17, " and a long piece of words");
		assert.deepEqual(body(multi.screen(20)), stock("first line\nsecond and a long piece of words line", 20));
	});

	it("paints the piece gray on every row it wraps to, and nothing else", async () => {
		const h = await withPiece("Fix", 3, " alpha_beta_gamma delta_epsilon_zeta eta_theta_iota kappa_lambda_mu nu_xi_omicron");
		const rows = h.screen(24);
		assert.ok(rows.length > 4);
		const gray = rows.slice(1, -1).map(row => row.includes(DIM));
		assert.ok(gray.every(Boolean), "every row holds a piece");
		const text = rows.slice(1, -1).map(row => row.replaceAll(DIM, "").replaceAll("\x1b[39m", "")).map(plain).join("");
		assert.ok(text.replace(/\s/g, "").startsWith("Fixalpha"));
				assert.equal(rows[1].includes(`Fix${CURSOR_MARKER}`), true);
		assert.equal(rows[2].startsWith(DIM), true);
	});

	it("a text taller than the window keeps the window: the piece on the cursor row is drawn, the rows around are stock", async () => {
		const text = Array.from({ length: 30 }, (_, i) => `step ${i}`).join("\n");
		const h = await withPiece(text, text.length, " done");
		const rows = h.screen();
		assert.equal(rows.length, 14);
		assert.equal(plain(rows[12]).trimEnd(), "step 29 done");
		assert.ok(rows[12].includes(`${DIM}done`));
		assert.equal(rows.slice(1, 12).some(row => row.includes(DIM)), false);
		assert.equal(h.editor.getText(), text);
	});

	it("rows of the piece below the editor's window are not drawn and never overwrite the bottom border", async () => {
		const text = `${Array.from({ length: 11 }, (_, i) => `step ${i}`).join("\n")}\nFix`;
		const h = await withPiece(text, text.length, " ab alpha_beta_gamma delta_epsilon_zeta eta_theta_iota kappa_lambda");
		const rows = h.screen(20);
		assert.equal(rows.length, 14);
		assert.ok(plain(rows.at(-1)!).includes("↓ 4 more"));
		assert.ok(rows[12].includes(DIM));
		// Part of the piece is out of sight, so Tab does not take it.
		h.key("\t");
		assert.equal(h.editor.getText(), text);
	});

	it("a piece on a line that has more lines after it is drawn like after Tab, wrapped or not", async () => {
		const short = await withPiece("first\nsecond\nthird", 5, " one");
		assert.deepEqual(body(short.screen()), stock("first one\nsecond\nthird", 80));
		assert.ok(short.screen()[1].includes(`${DIM}one`));
		const wrapped = await withPiece("first\nsecond\nthird", 5, " alpha_beta_gamma delta_epsilon_zeta eta_theta_iota ");
		assert.deepEqual(body(wrapped.screen(20)), stock("first alpha_beta_gamma delta_epsilon_zeta eta_theta_iota \nsecond\nthird", 20));
		assert.ok(wrapped.screen(20).some(row => row.includes(DIM)));
	});

	it("a layout that does not match the cursor's line paints nothing gray", async () => {
		const piece = " alpha_beta_gamma delta_epsilon_zeta eta_theta_iota kappa_lambda_mu";
		const edit = (change: (rows: { text: string }[]) => { text: string }[]) => (editor: CustomEditor) => {
			const layout = (editor as unknown as { layoutText(width: number): { text: string }[] }).layoutText;
			(editor as unknown as { layoutText: unknown }).layoutText = function(this: CustomEditor, width: number) { return change(layout.call(this, width)); };
		};
		const changed = await withPiece("Fix", 3, piece, { prepare: edit(rows => rows.map(row => ({ ...row, text: row.text.toUpperCase() }))) });
		assert.equal(changed.screen(20).some(row => row.includes(DIM)), false);
		const first = await withPiece("Fix", 3, " it", { prepare: edit(rows => rows.map(row => ({ ...row, text: row.text.toUpperCase() }))) });
		assert.equal(first.screen(20).some(row => row.includes(DIM)), false);
		const skipped = await withPiece("Fix", 3, piece, { prepare: edit(rows => rows.filter((_, index) => index !== 1)) });
		assert.equal(skipped.screen(20).some(row => row.includes(DIM)), false);
		assert.equal(skipped.editor.getText(), "Fix");
	});

	it("draws no marker when the editor is not focused", async () => {
		const h = await withPiece("Fix", 3, " it");
		h.editor.focused = false;
		const row = h.screen()[1];
		assert.equal(row.includes(CURSOR_MARKER), false);
		assert.equal(plain(row).trimEnd(), "Fix it");
	});

	it("is shown only for the draft it was asked for: other text or another cursor place shows nothing", async () => {
		const h = await withPiece("Fix the", 7, " tests");
		assert.equal(plain(h.screen()[1]).trimEnd(), "Fix the tests");
		(h.editor as unknown as { state: { cursorCol: number } }).state.cursorCol = 3;
		assert.equal(plain(h.screen()[1]).trimEnd(), "Fix the");
		h.editor.setText("Fix th");
		assert.equal(plain(h.screen()[1]).trimEnd(), "Fix th");
	});

	it("is hidden while the chat works, a message waits, a menu is open or another component has the focus", async () => {
		const h = await withPiece("Fix the", 7, " tests");
		const shown = () => plain(h.screen()[1]).includes("tests");
		assert.equal(shown(), true);
		h.state.idle = false;
		assert.equal(shown(), false);
		h.state.idle = true;
		h.state.pending = true;
		assert.equal(shown(), false);
		h.state.pending = false;
		(h.editor as unknown as { isShowingAutocomplete(): boolean }).isShowingAutocomplete = () => true;
		assert.equal(shown(), false);
		(h.editor as unknown as { isShowingAutocomplete(): boolean }).isShowingAutocomplete = () => false;
		h.setFocus({});
		assert.equal(shown(), false);
		h.setFocus(h.editor);
		assert.equal(shown(), true);
		h.fire("session_shutdown", { reason: "quit" });
		assert.equal(shown(), false);
	});

	it("repeated frames reuse the painted rows; a changed width, text, piece or theme paints them again", async () => {
		const h = await withPiece("Fix", 3, " alpha_beta_gamma delta_epsilon_zeta eta_theta_iota kappa_lambda_mu nu_xi_omicron");
		const first = h.screen(24);
		const before = h.theme.paints;
		for (let i = 0; i < 10; i++) assert.deepEqual(h.screen(24), first);
		assert.ok(h.theme.paints - before <= 10, `${h.theme.paints - before} paints`);

		assert.ok(h.screen(12).length > first.length);
		h.theme.dim = "\x1b[38;2;1;2;3m";
		assert.ok(h.screen(24)[1].includes("\x1b[38;2;1;2;3m"));
		assert.equal(first.join("").includes("\x1b[38;2;1;2;3m"), false);
	});

	it("restores the editor's own lines after every frame, even when the base render throws", async () => {
		const h = await withPiece("Fix the", 7, " tests", { prepare: editor => {
			const stockRender = editor.render;
			editor.render = function(this: CustomEditor, width: number) {
				if ((this as unknown as { state: { lines: string[] } }).state.lines[0].includes("tests")) throw new Error("boom");
				return stockRender.call(this, width);
			};
		} });
		assert.throws(() => h.screen(), /boom/);
		assert.deepEqual(h.editor.getLines(), ["Fix the"]);
	});

	it("an editor with extra rows, or without Pi's private parts, shows no piece and says so once", async () => {
		const extra = await withPiece("Fix the", 7, " tests", { extraRow: true });
		assert.equal(extra.screen().at(-1), "EXTRA");
		assert.equal(extra.screen().some(row => plain(row).includes("tests")), false);
		extra.screen();
		assert.equal(extra.notes.filter(note => note.includes("extra rows")).length, 1);
		assert.equal(extra.editor.getText(), "Fix the");

		const bare = await withPiece("Fix the", 7, " tests", { prepare: editor => { (editor as unknown as { expandPasteMarkers: unknown }).expandPasteMarkers = undefined; } });
		assert.equal(bare.screen().some(row => plain(row).includes("tests")), false);
		assert.equal(bare.notes.filter(note => note.includes("unknown shape")).length, 1);
	});

	it("without the private parts the empty-input suggestion still works", async () => {
		const h = harness({ replies: [suggestion("run the tests")], prepare: editor => { (editor as unknown as { expandPasteMarkers: unknown }).expandPasteMarkers = undefined; } });
		h.answer();
		await settle();
		assert.equal(plain(h.screen()[1]).trimEnd(), "run the tests");
	});
});
