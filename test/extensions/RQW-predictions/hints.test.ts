import assert from "node:assert/strict";
import { it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { CTRL_E, CTRL_R, deferred, harness, settle, suggestion } from "./harness.ts";

const plain = (row: string) => stripVTControlCharacters(row.replace(/\x1b_[^\x07]*\x07/g, ""));

it("draws idle and brewing hints inside the empty editor without changing Tab or Enter", async () => {
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
	assert.equal(plain(h.screen()[1]).trim(), "ctrl+r to interrupt");
	h.key(" ");
	assert.equal(plain(h.screen()[1]).includes("ctrl+r"), false);
	h.key("\x7f");
	h.key(CTRL_R);
	pending.resolve(suggestion("later"));
	await settle();
	assert.equal(plain(h.screen()[1]).trim(), "ctrl+e to suggest");
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
	h.fire("session_shutdown", { reason: "quit" });
});

it("takes the offered action and restores the idle hint when the action ends", () => {
	const h = harness();
	let value: string | undefined;
	let listener = () => {};
	const source = { snapshot: () => value, subscribe(fn: () => void) { listener = fn; return () => {}; } };
	h.events.emit("rqw:editor-hint:offer", { sessionId: "main", source });
	for (const text of ["esc to interrupt", "esc esc to stop background", "ctrl+enter to steer", "ctrl+enter to send now", "esc to send now"]) {
		value = text; listener();
		assert.equal(plain(h.screen()[1]).trim(), text);
	}
	value = undefined; listener();
	assert.equal(plain(h.screen()[1]).trim(), "ctrl+e to suggest");
	assert.equal(plain(h.screen(12)[1]).trim(), "");
	h.fire("session_shutdown", { reason: "quit" });
});

it("a background action replaces a ready prediction until the background ends", async () => {
	const h = harness({ replies: [suggestion("next step")] });
	h.asked();
	await settle();
	assert.equal(plain(h.screen()[1]).trim(), "next step");
	let current: string | undefined = "esc esc to stop background";
	let changed = () => {};
	h.events.emit("rqw:editor-hint:offer", { sessionId: "main", source: { snapshot: () => current, subscribe(fn: () => void) { changed = fn; return () => {}; } } });
	assert.equal(plain(h.screen()[1]).trim(), "esc esc to stop background");
	h.key("\t");
	assert.equal(h.editor.getText(), "");
	current = undefined; changed();
	assert.equal(plain(h.screen()[1]).trim(), "next step");
	h.fire("session_shutdown", { reason: "quit" });
});

it("hides the idle hint without an answer or a saved login", () => {
	const empty = harness();
	empty.state.branch = [];
	empty.fire("session_tree");
	assert.equal(plain(empty.screen()[1]).trim(), "");
	empty.fire("session_shutdown", { reason: "quit" });
	const noLogin = harness();
	noLogin.ctx.modelRegistry.getProviderAuthStatus = () => ({ configured: false, source: undefined as never });
	noLogin.fire("session_tree");
	assert.equal(plain(noLogin.screen()[1]).trim(), "");
	noLogin.fire("session_shutdown", { reason: "quit" });
});
