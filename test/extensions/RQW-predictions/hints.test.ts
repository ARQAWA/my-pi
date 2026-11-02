import assert from "node:assert/strict";
import { it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { CTRL_E, deferred, harness, settle, suggestion } from "./harness.ts";

const plain = (row: string) => stripVTControlCharacters(row.replace(/\x1b_[^\x07]*\x07/g, ""));

it("draws the one hint inside the empty editor, also while a request runs, without changing Tab or Enter", async () => {
	const pending = deferred<ReturnType<typeof suggestion>>();
	const h = harness({ replies: [pending.promise] });
	const idle = h.screen();
	assert.equal(plain(idle[1]).trimEnd(), "   ctrl+e to suggest");
	assert.ok(idle[1].includes("\x1b[3m"));
	assert.ok(idle[1].includes(CURSOR_MARKER));
	assert.equal(visibleWidth(idle[1].replaceAll(CURSOR_MARKER, "")), 80);
	assert.equal(h.editor.getText(), "");
	h.key("\t"); h.key("\r");
	assert.equal(h.editor.getText(), "");
	assert.deepEqual(h.reached, ["\t", "\r"]);
	h.key(CTRL_E);
	await settle();
	assert.deepEqual(h.states(), ["brewing"]);
	assert.equal(plain(h.screen()[1]).trim(), "ctrl+e to suggest");
	h.key(" ");
	assert.equal(plain(h.screen()[1]).includes("ctrl+e"), false);
	h.key("\x7f");
	pending.resolve(suggestion("later"));
	await settle();
	assert.equal(plain(h.screen()[1]).trim(), "later");
	h.fire("session_shutdown", { reason: "quit" });
});

it("caches the painted hint and repaints it on a theme change", () => {
	const h = harness();
	const before = h.screen();
	const paints = h.theme.paints;
	for (let i = 0; i < 10; i++) assert.deepEqual(h.screen(), before);
	assert.equal(h.theme.paints, paints);
	h.ctx.ui.theme = { ...h.theme, fg: (_role: string, value: string) => `\x1b[91m${value}\x1b[39m` };
	assert.ok(h.screen()[1].includes("\x1b[91mctrl+e to suggest"));
	assert.equal(plain(h.screen(12)[1]).trim(), "");
	h.fire("session_shutdown", { reason: "quit" });
});

it("keeps the hint while a turn runs or a message is queued", () => {
	const h = harness();
	h.state.idle = false;
	assert.equal(plain(h.screen()[1]).trim(), "ctrl+e to suggest");
	h.state.pending = true;
	assert.equal(plain(h.screen()[1]).trim(), "ctrl+e to suggest");
	h.fire("session_shutdown", { reason: "quit" });
});


it("a ready prediction is shown while a turn runs or a message waits, and nothing covers it", async () => {
	const h = harness({ replies: [suggestion("next step")] });
	h.asked();
	await settle();
	for (const [idle, pending] of [[true, false], [false, false], [false, true], [true, true]]) {
		h.state.idle = idle;
		h.state.pending = pending;
		assert.equal(plain(h.screen()[1]).trim(), "next step", `idle ${idle}, pending ${pending}`);
	}
	h.fire("agent_start");
	assert.equal(plain(h.screen()[1]).trim(), "next step");
	h.key("\t");
	assert.equal(h.editor.getText(), "next step");
	h.fire("session_shutdown", { reason: "quit" });
});

it("hides the hint without an answer, but shows it without a saved login", () => {
	const empty = harness();
	empty.state.branch = [];
	empty.fire("session_tree");
	assert.equal(plain(empty.screen()[1]).trim(), "");
	empty.fire("session_shutdown", { reason: "quit" });
	const noLogin = harness();
	noLogin.ctx.modelRegistry.getProviderAuthStatus = () => ({ configured: false, source: undefined as never });
	noLogin.fire("session_tree");
	assert.equal(plain(noLogin.screen()[1]).trim(), "ctrl+e to suggest");
	noLogin.fire("session_shutdown", { reason: "quit" });
});
