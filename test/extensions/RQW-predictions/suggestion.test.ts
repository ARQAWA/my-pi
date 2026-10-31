import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { CTRL_E, deferred, DIM, harness, settle, suggestion, text } from "./harness.ts";

const TAB = "\t";
const SHIFT_TAB = "\x1b[Z";
const TAB_RELEASE = "\x1b[9;1:3u";
const RIGHT = "\x1b[C";
const UNDO = "\x1f";
// Pi writes its cursor and its marker as APC sequences, which the Node helper leaves in.
const plain = (row: string) => stripVTControlCharacters(row.replace(/\x1b_[^\x07]*\x07/g, ""));
const body = (rows: string[]) => rows.slice(1, -1).map(plain);

/** A harness whose first answer already produced `value`. */
async function ready(value: string | null = "run the tests", options: Parameters<typeof harness>[0] = {}) {
	const h = harness({ replies: [suggestion(value)], ...options });
	h.asked();
	await settle();
	// The screen repaints when told a suggestion is there.
	h.screen();
	return h;
}

describe("RQW-predictions gray suggestion", () => {
	it("shows the suggestion gray while the buffer stays empty; Tab turns it into editable text and sends nothing", async () => {
		const h = await ready();
		let submitted = 0;
		h.editor.onSubmit = () => { submitted++; };
		const rows = h.screen();
		assert.equal(rows.length, 3);
		assert.equal(plain(rows[0]), "─".repeat(80));
		assert.equal(plain(rows[2]), "─".repeat(80));
		assert.equal(plain(rows[1]).trimEnd(), "run the tests");
		assert.ok(rows[1].includes(`${DIM}un the tests`));
		assert.equal(h.editor.getText(), "");

		h.key(TAB);
		assert.equal(h.editor.getText(), "run the tests");
		assert.equal(h.editor.getCursor().col, "run the tests".length);
		assert.equal(submitted, 0);
		assert.equal(h.main.length, 1);
		h.key("!");
		assert.equal(h.editor.getText(), "run the tests!");
	});

	it("tells the screen when a suggestion appears", async () => {
		const h = harness({ replies: [suggestion("run the tests")] });
		h.asked();
		await settle();
		assert.ok(h.renders() > 0);
	});

	it("typing hides it and clearing the input brings back the same one without a new request", async () => {
		const h = await ready();
		h.key("x");
		assert.equal(plain(h.screen()[1]).trimEnd(), "x");
		h.key("\x7f");
		assert.equal(h.editor.getText(), "");
		assert.equal(plain(h.screen()[1]).trimEnd(), "run the tests");
		assert.equal(h.forks.length, 1);
		assert.equal(h.gets.length, 1);
	});

	it("a whitespace-only buffer is not empty: nothing is shown", async () => {
		const h = await ready();
		h.key(" ");
		assert.equal(plain(h.screen()[1]).includes("run the tests"), false);
	});

	it("Enter, Right and Shift+Tab accept nothing and keep their stock path; so does a key release", async () => {
		const h = await ready();
		for (const key of ["\r", RIGHT, SHIFT_TAB, TAB_RELEASE]) h.key(key);
		assert.equal(h.editor.getText(), "");
		assert.deepEqual(h.reached, ["\r", RIGHT, SHIFT_TAB, TAB_RELEASE]);
		assert.equal(plain(h.screen()[1]).trimEnd(), "run the tests");
	});

	it("an open autocomplete menu keeps Tab and the screen", async () => {
		const h = await ready();
		(h.editor as unknown as { isShowingAutocomplete(): boolean }).isShowingAutocomplete = () => true;
		assert.equal(plain(h.screen()[1]).includes("run the tests"), false);
		h.key(TAB);
		assert.equal(h.editor.getText(), "");
		assert.deepEqual(h.reached, [TAB]);
	});

	it("is hidden while the chat works, a message waits, or another component has the focus", async () => {
		const h = await ready();
		h.state.idle = false;
		assert.equal(plain(h.screen()[1]).includes("run the tests"), false);
		h.key(TAB);
		assert.equal(h.editor.getText(), "");
		h.state.idle = true;
		h.state.pending = true;
		assert.equal(plain(h.screen()[1]).includes("run the tests"), false);
		h.state.pending = false;
		h.setFocus({});
		assert.equal(plain(h.screen()[1]).includes("run the tests"), false);
		h.setFocus(h.editor);
		assert.equal(plain(h.screen()[1]).includes("run the tests"), true);
	});

	it("wraps the whole text, wide characters included, inside the width and keeps one cursor marker", async () => {
		const long = "Please run the whole suite again, then 漢字かな交じり文 and emoji 👩‍💻🙂 end\nsecond line of the idea";
		const h = await ready(long);
		const rows = h.screen(24);
		assert.ok(rows.length > 3);
		for (const row of rows) assert.ok(visibleWidth(row.replaceAll(CURSOR_MARKER, "")) <= 24, plain(row));
		assert.equal(rows.join("").split(CURSOR_MARKER).length - 1, 1);
		assert.equal(body(rows).join("").replace(/\s/g, ""), long.replace(/\s/g, ""));
		assert.equal(body(rows).join("").includes("…"), false);
		assert.ok(h.screen(60).length < rows.length);
	});

	it("a text taller than the screen is still drawn whole", async () => {
		const tall = Array.from({ length: 70 }, (_, i) => `step ${i}`).join("\n");
		const h = await ready(tall);
		assert.equal(h.screen().length, 72);
	});

	it("Tab is one undo step", async () => {
		const h = await ready("line one\nline two");
		h.key(TAB);
		assert.equal(h.editor.getText(), "line one\nline two");
		h.key(UNDO);
		assert.equal(h.editor.getText(), "");
	});

	it("an editor of an unknown shape stays stock and takes no Tab", async () => {
		const h = await ready("run the tests", { extraRow: true });
		const rows = h.screen();
		assert.equal(rows.at(-1), "EXTRA");
		assert.equal(rows.some(row => plain(row).includes("run the tests")), false);
		h.key(TAB);
		assert.equal(h.editor.getText(), "");
		assert.deepEqual(h.reached, [TAB]);
	});

	it("typing and Tab work while a new request is still open, and the old suggestion stays until the new one lands", async () => {
		const slow = deferred<ReturnType<typeof text>>();
		const h = await ready("old one", { replies: [suggestion("old one"), slow.promise] });
		h.key(CTRL_E);
		await settle();
		assert.equal(h.forks.length, 2);
		h.key("x");
		h.key("\x7f");
		h.screen();
		h.key(TAB);
		assert.equal(h.editor.getText(), "old one");
		slow.resolve(suggestion("new one"));
		await settle();
		assert.equal(h.controller.suggestion(), "new one");
	});

	it("a null answer or ending the session leaves the editor stock", async () => {
		const none = await ready(null);
		assert.equal(plain(none.screen()[1]).trim(), "");
		const h = await ready();
		h.fire("session_shutdown", { reason: "quit" });
		assert.equal(plain(h.screen()[1]).includes("run the tests"), false);
		h.key(TAB);
		assert.equal(h.editor.getText().includes("run the tests"), false);
	});

	it("a new finished answer removes the old suggestion from the screen", async () => {
		const h = await ready();
		h.answer();
		assert.equal(plain(h.screen()[1]).includes("run the tests"), false);
	});

	it("repeated renders, as on animation frames, reuse the built rows; a new width or theme rebuilds them", async () => {
		const long = Array.from({ length: 12 }, (_, i) => `step number ${i}`).join("\n");
		const h = await ready(long);
		const first = h.screen();
		const before = h.theme.paints;
		for (let i = 0; i < 10; i++) assert.deepEqual(h.screen(), first);
		// Twelve gray lines would cost 120 paints if each frame built them again.
		assert.ok(h.theme.paints - before <= 10, `${h.theme.paints - before} paints`);

		assert.ok(h.screen(8).length > first.length);
		h.theme.dim = "\x1b[38;2;1;2;3m";
		const recolored = h.screen(80);
		assert.ok(recolored[2].includes("\x1b[38;2;1;2;3mstep number 1"));
		assert.equal(first.join("").includes("\x1b[38;2;1;2;3m"), false);
	});
});
