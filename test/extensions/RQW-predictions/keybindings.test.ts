import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getKeybindings, setKeybindings } from "@earendil-works/pi-tui";
import { CTRL_E, CTRL_R, harness, piKeybindings, settle } from "./harness.ts";

const CTRL_G = "\x07";
const END = "\x1b[F";

/** What the live manager says about every action, as Pi's settings view and menus read it. */
const resolved = (manager: ReturnType<typeof piKeybindings>) => manager.getResolvedBindings();

describe("RQW-predictions key freeing", () => {
	it("takes Ctrl+E and Ctrl+R from every action of the live manager and keeps all other keys", () => {
		const stock = resolved(piKeybindings());
		const manager = piKeybindings({ "tui.editor.deleteToLineEnd": ["ctrl+k", "ctrl+e"], "app.session.rename": ["ctrl+r", "ctrl+x"] });
		const h = harness({ keybindings: manager });
		assert.equal(getKeybindings(), manager);
		h.fire("session_start", { reason: "startup" });

		assert.deepEqual(manager.getKeys("tui.editor.cursorLineEnd"), ["end"]);
		assert.deepEqual(manager.getKeys("tui.editor.deleteToLineEnd"), ["ctrl+k"]);
		assert.deepEqual(manager.getKeys("app.session.rename"), ["ctrl+x"]);
		assert.equal(manager.matches(CTRL_E, "tui.editor.cursorLineEnd"), false);
		assert.equal(manager.matches(CTRL_E, "tui.editor.deleteToLineEnd"), false);
		assert.equal(manager.matches(CTRL_R, "app.session.rename"), false);
		assert.equal(manager.matches(END, "tui.editor.cursorLineEnd"), true);
		assert.equal(manager.matches(CTRL_G, "app.editor.external"), true);
		const after = resolved(manager);
		for (const id of Object.keys(stock)) {
			if (["tui.editor.cursorLineEnd", "tui.editor.deleteToLineEnd", "app.session.rename"].includes(id)) continue;
			assert.deepEqual(after[id], stock[id], id);
		}
		assert.equal(JSON.stringify(after).includes('"ctrl+e"') || JSON.stringify(after).includes('"ctrl+r"'), false);
		assert.deepEqual(manager.getUserBindings(), { "tui.editor.deleteToLineEnd": ["ctrl+k", "ctrl+e"], "app.session.rename": ["ctrl+r", "ctrl+x"] });
	});

	it("Ctrl+E makes one prediction and does not move the cursor, End still goes to the line end, Ctrl+G is untouched", async () => {
		const h = harness();
		h.ran();
		h.editor.setText("hello");
		h.key("\x01");
		h.key(CTRL_E);
		await settle();
		assert.equal(h.gets.length, 1);
		assert.equal(h.editor.getCursor().col, 0);
		h.key(END);
		assert.equal(h.editor.getCursor().col, 5);
		assert.equal(getKeybindings().matches(CTRL_G, "app.editor.external"), true);
	});

	it("new user settings after a reload are filtered at once and never overwritten", () => {
		const manager = piKeybindings();
		const h = harness({ keybindings: manager });
		h.fire("session_start", { reason: "startup" });
		manager.setUserBindings({ "app.session.rename": ["ctrl+r", "ctrl+y"] });
		assert.deepEqual(manager.getKeys("app.session.rename"), ["ctrl+y"]);
		assert.deepEqual(manager.getUserBindings(), { "app.session.rename": ["ctrl+r", "ctrl+y"] });
	});

	it("ending the session gives the stock manager back; a foreign wrapper put on top stays and passes through", () => {
		const manager = piKeybindings();
		const h = harness({ keybindings: manager });
		h.fire("session_start", { reason: "startup" });
		assert.equal(Object.hasOwn(manager, "getKeys"), true);
		const ours = manager.getKeys;
		const foreign = function(this: typeof manager, id: string) { return ours.call(this, id).map(key => key.toUpperCase()); };
		manager.getKeys = foreign;

		h.fire("session_shutdown", { reason: "reload" });
		assert.equal(manager.getKeys, foreign);
		assert.deepEqual(manager.getKeys("tui.editor.cursorLineEnd"), ["END", "CTRL+E"]);
		assert.equal(Object.hasOwn(manager, "matches"), false);
		assert.equal(manager.matches(CTRL_E, "tui.editor.cursorLineEnd"), true);
	});

	it("after the session ends the stock keys work again", () => {
		const manager = piKeybindings();
		const h = harness({ keybindings: manager });
		h.fire("session_start", { reason: "startup" });
		h.fire("session_shutdown", { reason: "quit" });
		assert.equal(manager.matches(CTRL_E, "tui.editor.cursorLineEnd"), true);
		assert.equal(manager.matches(CTRL_R, "app.session.rename"), true);
		assert.deepEqual(manager.getKeys("tui.editor.cursorLineEnd"), ["end", "ctrl+e"]);
	});

	it("a replaced manager is checked and wrapped at its first key; the old one is given back", async () => {
		const first = piKeybindings();
		const h = harness({ keybindings: first });
		h.ran();
		const second = piKeybindings();
		setKeybindings(second);
		h.key(CTRL_E);
		await settle();
		assert.deepEqual(second.getKeys("app.session.rename"), []);
		assert.deepEqual(first.getKeys("app.session.rename"), ["ctrl+r"]);
		assert.equal(h.gets.length, 1);
	});

	it("an incompatible manager stays stock: one warning, the keys keep their Pi action and no prediction starts", async () => {
		const manager = Object.assign(piKeybindings(), { getDefinition: undefined });
		const h = harness({ keybindings: manager });
		h.ran();
		h.editor.setText("hello");
		h.key("\x01");
		h.key(CTRL_E);
		h.key(CTRL_R);
		await settle();
		assert.equal(h.editor.getCursor().col, 5);
		assert.equal(h.gets.length, 0);
		assert.equal(manager.matches(CTRL_R, "app.session.rename"), true);
		assert.equal(h.notes.length, 1);
		assert.match(h.notes[0], /Ctrl\+E and Ctrl\+R/);
		// Without the manual keys nothing starts a request, not even a finished answer.
		h.answer();
		await settle();
		assert.equal(h.gets.length, 0);
	});

	it("a failed installation is rolled back completely", () => {
		const manager = piKeybindings();
		Object.defineProperty(manager, "getResolvedBindings", { value: manager.getResolvedBindings, writable: false, configurable: false });
		const h = harness({ keybindings: manager });
		h.fire("session_start", { reason: "startup" });
		assert.equal(Object.hasOwn(manager, "getKeys"), false);
		assert.equal(Object.hasOwn(manager, "matches"), false);
		assert.equal(manager.matches(CTRL_E, "tui.editor.cursorLineEnd"), true);
		assert.equal(h.notes.length, 1);
	});
});
