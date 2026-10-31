import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { ABORTED_MS, CTRL_E, CTRL_E_RELEASE, CTRL_R, deferred, DIM, harness, last, settle, suggestion } from "./harness.ts";

const TAB = "\t";
const LEFT = "\x1b[D";
const HOME = "\x1b[H";
const BACKSPACE = "\x7f";
const UNDO = "\x1f";
// Pi writes its cursor and its marker as APC sequences, which the Node helper leaves in.
const plain = (row: string) => stripVTControlCharacters(row.replace(/\x1b_[^\x07]*\x07/g, ""));

type H = ReturnType<typeof harness>;
type Reply = AssistantMessage | Promise<AssistantMessage>;

/** A chat whose input holds `text` with the cursor at `col`; the replies are for the pieces. */
async function typed(text: string, col: number, ...replies: Reply[]): Promise<H> {
	const h = harness({ replies: [suggestion(null), ...replies] });
	h.answer();
	await settle();
	h.editor.setText(text);
	for (let i = text.length; i > col; i--) h.key(LEFT);
	return h;
}

/** Ctrl+E, the answer, and a frame that draws it. */
async function ask(h: H) {
	h.key(CTRL_E);
	await settle();
	return h.screen();
}

const row = (h: H) => plain(h.screen()[1]).trimEnd();
const prompt = (h: H, index = 1) => last(h.forks[index].context).content as string;
const click = (x: number): TuiMouseEvent => ({ type: "click", button: "left", x, y: 1, screenX: x, screenY: 1, width: 80, height: 3, shift: false, alt: false, ctrl: false } as TuiMouseEvent);

describe("RQW-predictions Ctrl+E with text", () => {
	it("at the end of the text it asks for a piece and shows it gray; the text, the cursor and the empty-input suggestion stay", async () => {
		const h = await typed("Fix the", 7, suggestion(" failing tests"));
		const rows = await ask(h);
		assert.equal(h.forks.length, 2);
		assert.ok(prompt(h).includes("<before_cursor>\nFix the\n</before_cursor>\n<after_cursor></after_cursor>"));
		assert.equal(plain(rows[1]).trimEnd(), "Fix the failing tests");
		assert.ok(rows[1].includes(`${DIM}failing tests`));
		assert.equal(h.editor.getText(), "Fix the");
		assert.deepEqual(h.editor.getCursor(), { line: 0, col: 7 });
		assert.equal(h.reached.includes(CTRL_E), false);
	});

	it("in the middle it sends both sides, and the piece is drawn between them", async () => {
		const h = await typed("Fix the tests now", 7, suggestion(" failing"));
		const rows = await ask(h);
		assert.ok(prompt(h).includes("<before_cursor>\nFix the\n</before_cursor>\n<after_cursor>\n tests now\n</after_cursor>"));
		assert.equal(plain(rows[1]).trimEnd(), "Fix the failing tests now");
		assert.ok(rows[1].includes(`${DIM}failing\x1b[39m tests now`));
		assert.equal(h.editor.getText(), "Fix the tests now");
	});

	it("an empty input keeps the old Ctrl+E: a suggestion request without the insert rule", async () => {
		const h = harness({ replies: [suggestion(null), suggestion("run the tests")] });
		h.answer();
		await settle();
		h.key(CTRL_E);
		await settle();
		assert.equal(h.forks.length, 2);
		assert.equal(prompt(h).includes("<before_cursor>"), false);
		assert.equal(h.controller.suggestion(), "run the tests");
		assert.equal(h.controller.piece(), undefined);
	});

	it("a whitespace-only input is text: it asks for a piece", async () => {
		const h = await typed(" ", 1, suggestion("hello"));
		await ask(h);
		assert.ok(prompt(h).includes("<before_cursor>\n \n</before_cursor>"));
	});

	it("a held key repeat or a key release asks for nothing, one press asks once", async () => {
		const h = await typed("Fix", 3, suggestion(" it"));
		h.key(CTRL_E_RELEASE);
		h.key(CTRL_E);
		h.key(CTRL_E);
		await settle();
		assert.equal(h.forks.length, 2);
	});

	it("a pasted block is sent with its real content, not its marker", async () => {
		const h = await typed("", 0, suggestion(" x"));
		const lines = Array.from({ length: 12 }, (_, i) => `pasted ${i}`);
		h.key(`\x1b[200~${lines.join("\n")}\x1b[201~`);
		assert.match(h.editor.getText(), /^\[paste #1 \+12 lines\]$/);
		h.key("!");
		h.key(LEFT);
		await ask(h);
		const content = prompt(h);
		assert.ok(content.includes(`<before_cursor>\n${lines.join("\n")}\n</before_cursor>`));
		assert.equal(content.includes("[paste #1"), false);
		assert.ok(content.includes("<after_cursor>\n!\n</after_cursor>"));
	});

	it("an editor without Pi's private parts keeps the old Ctrl+E even with text", async () => {
		const h = harness({ replies: [suggestion(null), suggestion("run the tests")], prepare: editor => { (editor as unknown as { expandPasteMarkers: unknown }).expandPasteMarkers = undefined; } });
		h.answer();
		await settle();
		h.editor.setText("Fix");
		h.key(CTRL_E);
		await settle();
		assert.equal(prompt(h).includes("<before_cursor>"), false);
		assert.equal(h.controller.suggestion(), "run the tests");
	});
});

describe("RQW-predictions Tab on a piece", () => {
	it("takes the piece as one undoable edit, puts the cursor after it, and sends nothing", async () => {
		const h = await typed("Fix the tests now", 7, suggestion(" failing"), suggestion(null));
		await ask(h);
		let submitted = 0;
		h.editor.onSubmit = () => { submitted++; };
		h.key(TAB);
		assert.equal(h.editor.getText(), "Fix the failing tests now");
		assert.deepEqual(h.editor.getCursor(), { line: 0, col: 15 });
		assert.equal(submitted, 0);
		assert.equal(h.main.length, 1);
		assert.deepEqual(h.reached.filter(key => key === TAB), []);
		h.key(UNDO);
		assert.equal(h.editor.getText(), "Fix the tests now");
	});

	it("starts the next piece at once for the new text; none is shown while it runs; Tab again goes on until the model has nothing", async () => {
		const slow = deferred<AssistantMessage>();
		const h = await typed("Fix", 3, suggestion(" the"), slow.promise, suggestion(null));
		await ask(h);
		h.key(TAB);
		assert.equal(row(h), "Fix the");
		assert.equal(h.states().at(-1), "brewing");
		assert.equal(h.screen()[1].includes(DIM), false);
		await settle();
		assert.equal(h.forks.length, 3);
		assert.ok(prompt(h, 2).includes("<before_cursor>\nFix the\n</before_cursor>"));
		slow.resolve(suggestion(" tests"));
		await settle();
		assert.equal(row(h), "Fix the tests");
		assert.ok(h.screen()[1].includes(`${DIM}tests`));
		h.key(TAB);
		assert.equal(h.editor.getText(), "Fix the tests");
		await settle();
		assert.equal(h.forks.length, 4);
		assert.equal(row(h), "Fix the tests");
		assert.equal(h.controller.piece(), undefined);
		assert.equal(h.states().at(-1), "idle");
		await settle();
		assert.equal(h.forks.length, 4);
	});

	it("takes only a piece that was drawn: before a frame, or while a request runs, Tab keeps its stock path", async () => {
		const h = await typed("Fix", 3, suggestion(" the"), new Promise<AssistantMessage>(() => {}));
		h.key(CTRL_E);
		await settle();
		assert.equal(h.controller.piece()?.text, " the");
		h.key(TAB);
		assert.equal(h.editor.getText(), "Fix");
		assert.ok(h.reached.includes(TAB));

		h.screen();
		h.key(CTRL_E);
		await settle();
		assert.equal(h.controller.piece(), undefined);
		h.key(TAB);
		assert.equal(h.editor.getText(), "Fix");
		assert.equal(h.reached.filter(key => key === TAB).length, 2);
	});

	it("a taken piece is not taken twice: the next piece with the same words needs a frame of its own", async () => {
		const h = await typed("Fix", 3, suggestion(" the"), suggestion(" the"));
		await ask(h);
		h.key(TAB);
		await settle();
		assert.equal(h.controller.piece()?.text, " the");
		h.key(TAB);
		assert.equal(h.editor.getText(), "Fix the");
		h.screen();
		h.key(TAB);
		assert.equal(h.editor.getText(), "Fix the the");
	});

	it("an open autocomplete menu keeps Tab", async () => {
		const h = await typed("Fix", 3, suggestion(" the"));
		await ask(h);
		(h.editor as unknown as { isShowingAutocomplete(): boolean }).isShowingAutocomplete = () => true;
		h.key(TAB);
		assert.equal(h.editor.getText(), "Fix");
	});
});

describe("RQW-predictions piece cancel", () => {
	it("typing, deleting, undo and cursor keys remove a shown piece for good, even when the text comes back", async () => {
		for (const [key, back] of [["x", BACKSPACE], [LEFT, "\x1b[C"], [HOME, "\x1b[F"], [BACKSPACE, "e"]] as const) {
			const h = await typed("Fix the", 7, suggestion(" tests"));
			await ask(h);
			assert.equal(h.controller.piece()?.text, " tests", key);
			h.key(key);
			assert.equal(h.controller.piece(), undefined, key);
			assert.equal(row(h).includes("tests"), false, key);
			h.key(back);
			assert.equal(h.controller.piece(), undefined, key);
			assert.equal(row(h).includes("tests"), false, key);
		}
	});

	it("a key during the request ends it quietly at once, and the late answer shows nothing", async () => {
		for (const key of ["x", LEFT, BACKSPACE, HOME]) {
			const slow = deferred<AssistantMessage>();
			const h = await typed("Fix the", 7, slow.promise);
			h.key(CTRL_E);
			await settle();
			assert.equal(h.states().at(-1), "brewing");
			h.key(key);
			assert.equal(h.forks[1].signal.aborted, true, key);
			assert.equal(h.states().at(-1), "idle", key);
			assert.equal(h.states().includes("aborted"), false, key);
			slow.resolve(suggestion(" tests"));
			await settle();
			assert.equal(h.controller.piece(), undefined, key);
			assert.equal(row(h).includes("tests"), false, key);
		}
	});

	it("a key that changes nothing keeps the request and the piece", async () => {
		const slow = deferred<AssistantMessage>();
		const h = await typed("Fix", 3, slow.promise);
		h.key(CTRL_E);
		await settle();
		h.key("\x1b[C");
		h.key(CTRL_E_RELEASE);
		assert.equal(h.forks[1].signal.aborted, false);
		slow.resolve(suggestion(" it"));
		await settle();
		assert.equal(h.controller.piece()?.text, " it");
	});

	it("a mouse click that moves the cursor removes the piece and ends the request at once; a click on the same place does not", async () => {
		const h = await typed("Fix the", 7, suggestion(" tests"));
		await ask(h);
		h.editor.handleMouse(click(7));
		assert.equal(h.controller.piece()?.text, " tests");
		h.editor.handleMouse(click(2));
		assert.deepEqual(h.editor.getCursor(), { line: 0, col: 2 });
		assert.equal(h.controller.piece(), undefined);

		const slow = deferred<AssistantMessage>();
		const g = await typed("Fix the", 7, slow.promise);
		g.screen();
		g.key(CTRL_E);
		await settle();
		g.editor.handleMouse(click(3));
		assert.equal(g.forks[1].signal.aborted, true);
		assert.equal(g.states().at(-1), "idle");
	});

	it("a change that bypasses the keys, such as Pi's own setText, is caught by the next frame", async () => {
		const h = await typed("Fix the", 7, suggestion(" tests"));
		await ask(h);
		h.editor.setText("something else");
		h.screen();
		await settle();
		assert.equal(h.controller.piece(), undefined);
		h.editor.setText("Fix the");
		h.screen();
		await settle();
		assert.equal(h.controller.piece(), undefined);
		assert.equal(row(h), "Fix the");

		const slow = deferred<AssistantMessage>();
		const g = await typed("Fix the", 7, slow.promise);
		g.key(CTRL_E);
		await settle();
		g.editor.setText("other");
		g.screen();
		await settle();
		assert.equal(g.forks[1].signal.aborted, true);
		assert.equal(g.states().at(-1), "idle");
	});

	it("Ctrl+R during the request is the maroon abort; on a shown piece it only removes it", async () => {
		const slow = deferred<AssistantMessage>();
		const h = await typed("Fix", 3, slow.promise);
		h.key(CTRL_E);
		await settle();
		h.key(CTRL_R);
		assert.equal(h.states().at(-1), "aborted");
		assert.equal(h.statuses.at(-1)?.includes("prediction aborted"), true);
		h.clock.now += ABORTED_MS;
		slow.resolve(suggestion(" late"));
		await settle();
		assert.equal(h.controller.piece(), undefined);

		const shown = await typed("Fix", 3, suggestion(" it"));
		await ask(shown);
		shown.key(CTRL_R);
		assert.equal(shown.controller.piece(), undefined);
		assert.equal(row(shown), "Fix");
		assert.equal(shown.states().includes("aborted"), false);
	});

	it("Enter ends a request and a piece; a new turn and another model do too", async () => {
		const slow = deferred<AssistantMessage>();
		const h = await typed("Fix", 3, slow.promise);
		h.key(CTRL_E);
		await settle();
		h.key("\r");
		assert.equal(h.forks[1].signal.aborted, true);
		assert.equal(h.states().at(-1), "idle");

		const g = await typed("Fix", 3, suggestion(" it"));
		await ask(g);
		g.fire("agent_start");
		assert.equal(row(g), "Fix");
	});

	it("ending the session gives the editor its own mouse and key methods back", async () => {
		const h = await typed("Fix", 3);
		assert.equal(Object.hasOwn(h.editor, "handleMouse"), true);
		h.fire("session_shutdown", { reason: "quit" });
		assert.equal(Object.hasOwn(h.editor, "handleMouse"), false);
		h.editor.handleMouse(click(1));
	});
});
