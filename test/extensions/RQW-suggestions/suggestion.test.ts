import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { CustomEditor, DEFAULT_COMPACTION_SETTINGS, estimateTokens } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { assistant, CTRL_E, deferred, DIM, harness, MODEL, settle, suggestion, SYSTEM, text, USER } from "./harness.ts";

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

describe("RQW-suggestions gray suggestion", () => {
	it("keeps the unfinished tool tail as text in a fork and after resume", async () => {
		const calls = assistant([{ type: "toolCall", id: "open", name: "read", arguments: { path: "open.ts" } },
			{ type: "toolCall", id: "done", name: "read", arguments: { path: "done.ts" } }], "toolUse");
		const result = { role: "toolResult", toolCallId: "done", toolName: "read", content: [{ type: "text", text: "neighbor result" }], isError: false, timestamp: 4 } as const;
		const later = { role: "user", content: "later user text", timestamp: 5 } as const;
		for (const resumed of [false, true]) {
			const h = harness({ projection: [USER, calls, result, later] });
			if (!resumed) {
				h.request({ messages: [SYSTEM, USER] });
				for (const message of [calls, result, later]) h.fire("message_end", { message });
			}
			h.key(CTRL_E);
			await settle();
			const messages = (resumed ? h.provider[0] : h.forks[0]).context.messages;
			assert.equal(messages.some(message => message.role === "assistant" && message.content.some(part => part.type === "toolCall" && part.id === "open")), false);
			const instruction = String(messages.at(-1)?.content);
			const tail = instruction.split("tools may still be running:\n")[1].split("\nReturn only JSON")[0];
			assert.deepEqual(JSON.parse(tail), [
				{ role: "assistant", content: calls.content },
				{ role: "toolResult", content: result.content },
				{ role: "user", content: later.content },
			]);
		}
	});

	it("keeps the latest tail within the model window after a large tool result", async () => {
		const h = harness();
		h.setModel({ ...MODEL, contextWindow: 40_000 });
		h.request({ messages: [SYSTEM, USER] });
		const calls = assistant([{ type: "toolCall", id: "open", name: "read", arguments: {} },
			{ type: "toolCall", id: "done", name: "read", arguments: {} }], "toolUse");
		h.fire("message_end", { message: calls });
		h.fire("message_end", { message: { role: "toolResult", toolCallId: "done", toolName: "read", content: [{ type: "text", text: "x".repeat(150_000) }], isError: false, timestamp: 4 } });
		h.fire("message_end", { message: { role: "user", content: "latest request", timestamp: 5 } });
		h.key(CTRL_E);
		await settle();
		const messages = h.forks[0].context.messages;
		assert.deepEqual(messages.slice(0, 2), [SYSTEM, USER]);
		const instruction = String(messages.at(-1)?.content);
		assert.match(instruction, /\[earlier part cut\]/);
		assert.match(instruction, /latest request/);
		assert.ok(messages.reduce((sum, message) => sum + estimateTokens(message), 0) <= 40_000 - DEFAULT_COMPACTION_SETTINGS.reserveTokens);
	});

	it("keeps a near-full completed snapshot unchanged", async () => {
		const h = harness();
		h.setModel({ ...MODEL, contextWindow: 40_000 });
		const large = { role: "user" as const, content: "x".repeat(95_000) + "latest snapshot", timestamp: 2 };
		h.request({ messages: [SYSTEM, large] });
		h.key(CTRL_E);
		await settle();
		assert.deepEqual(h.forks[0].context.messages.slice(0, -1), [SYSTEM, large]);
	});

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

	it("stays visible while the chat works or a message waits, and Tab takes it; it is hidden when another component has the focus", async () => {
		const h = await ready();
		h.state.idle = false;
		assert.equal(plain(h.screen()[1]).trim(), "run the tests");
		h.state.pending = true;
		assert.equal(plain(h.screen()[1]).trim(), "run the tests");
		h.key(TAB);
		assert.equal(h.editor.getText(), "run the tests");
		h.editor.setText("");
		h.state.idle = true;
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

	it("wraps and grows exactly like the same text typed into the editor", async () => {
		const texts = [
			"Please run the whole suite again, then compare the results with the last green build",
			"averyveryverylongwordwithoutanyspaces and then some more words after it",
			"two  spaces   and three   inside a sentence that wraps around twice more",
			"漢字かな交じり文を折り返す漢字かな交じり文を折り返す\n\nthird line after a blank one",
		];
		for (const columns of [24, 37]) for (const value of texts) {
			const typed = new CustomEditor({ requestRender() {}, terminal: { rows: 40, columns } } as never,
				{ borderColor: (row: string) => row, selectList: {} } as never, { matches: () => false } as never);
			typed.setText(value);
			const h = await ready(value);
			assert.deepEqual(body(h.screen(columns)).map(row => row.trimEnd()), body(typed.render(columns)).map(row => row.trimEnd()), `${columns}: ${value}`);
		}
	});

	it("shows every line of a tall suggestion before Tab inserts it", async () => {
		const tall = Array.from({ length: 70 }, (_, i) => `step ${i}`).join("\n");
		const h = await ready(tall);
		assert.deepEqual(body(h.screen()).map(row => row.trimEnd()), tall.split("\n"));
		assert.equal(h.editor.getText(), "");
		h.key(TAB);
		assert.equal(h.editor.getText(), tall);
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

	it("while a new request is open, the old suggestion stays on the screen until the new one replaces it", async () => {
		const slow = deferred<ReturnType<typeof text>>();
		const h = await ready("old one", { replies: [suggestion("old one"), slow.promise] });
		h.key(CTRL_E);
		await settle();
		assert.equal(h.forks.length, 2);
		h.key("x");
		h.key("\x7f");
		assert.equal(plain(h.screen()[1]).trim(), "old one");
		slow.resolve(suggestion("new one"));
		await settle();
		assert.equal(plain(h.screen()[1]).trim(), "new one");
		h.key(TAB);
		assert.equal(h.editor.getText(), "new one");
	});

	it("a null answer or ending the session leaves the editor stock", async () => {
		const none = await ready(null);
		assert.equal(plain(none.screen()[1]).trim(), "ctrl+e to suggest");
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
		const long = Array.from({ length: 6 }, (_, i) => `step number ${i}`).join("\n");
		const h = await ready(long);
		const first = h.screen();
		const before = h.theme.paints;
		for (let i = 0; i < 10; i++) assert.deepEqual(h.screen(), first);
		// Six gray lines would cost 60 paints if each frame built them again.
		assert.ok(h.theme.paints - before <= 10, `${h.theme.paints - before} paints`);

		assert.ok(h.screen(8).length > first.length);
		h.theme.dim = "\x1b[38;2;1;2;3m";
		const recolored = h.screen(80);
		assert.ok(recolored[2].includes("\x1b[38;2;1;2;3mstep number 1"));
		assert.equal(first.join("").includes("\x1b[38;2;1;2;3m"), false);
	});
});
