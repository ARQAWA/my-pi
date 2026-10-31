import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { CTRL_E, CTRL_R, harness, settle } from "./harness.ts";

const newEditor = () => new CustomEditor({ requestRender() {}, terminal: { rows: 40, columns: 80 } } as never,
	{ borderColor: (value: string) => value, selectList: {} } as never, { matches: () => false } as never);

describe("RQW-predictions boundaries", () => {
	it("a dialog or another component with the focus gets the keys; no prediction starts and its input is untouched", async () => {
		const h = harness();
		h.ran();
		const seen: string[] = [];
		h.setFocus({ handleInput: (data: string) => seen.push(data) });
		h.key(CTRL_E);
		h.key(CTRL_R);
		await settle();
		assert.deepEqual(seen, [CTRL_E, CTRL_R]);
		assert.equal(h.gets.length, 0);
		assert.equal(h.activity.length, 0);
	});

	it("another extension's dialog with its own editor never gets the suggestion, Tab, Ctrl+E or Ctrl+R", async () => {
		const h = harness();
		h.asked();
		await settle();
		const dialog = newEditor();
		dialog.focused = true;
		dialog.onSubmit = () => {};
		h.setFocus(dialog);
		h.key(CTRL_E);
		h.key(CTRL_R);
		h.key("\t");
		await settle();
		assert.equal(h.gets.length, 1);
		assert.equal(h.activity.length, 2);
		assert.equal(dialog.getText().includes("run the tests"), false);
		assert.equal(dialog.render(80).join("").includes("run the tests"), false);
	});

	it("after a reload the main editor is found when the focus returns to it, and a dialog's editor in between is never taken", async () => {
		// Pi keeps the focus on its reload box while the session starts; RQW-statusbar is not there to hand over an editor.
		const h = harness({ startFocus: {} });
		h.ran();
		const dialog = newEditor();
		dialog.focused = true;
		dialog.onSubmit = () => {};
		h.setFocus(dialog);
		h.key(CTRL_E);
		await settle();
		assert.equal(h.gets.length, 0);

		h.setFocus(h.editor);
		h.key(CTRL_E);
		await settle();
		assert.equal(h.gets.length, 1);
		h.screen();
		h.key("\t");
		assert.equal(h.editor.getText(), "run the tests");
	});

	it("a replaced main editor is decorated at its first key and works like the first one", async () => {
		const h = harness();
		h.ran();
		const replacement = newEditor();
		replacement.focused = true;
		// Pi hands a replaced main editor the submit handler of the default one.
		replacement.onSubmit = h.editor.onSubmit;
		replacement.onCtrlD = h.editor.onCtrlD;
		for (const [action, handler] of h.editor.actionHandlers) replacement.actionHandlers.set(action, handler);
		h.setFocus(replacement);
		h.key(CTRL_E);
		await settle();
		assert.equal(h.gets.length, 1);
		assert.equal(h.controller.suggestion(), "run the tests");
		h.key("\x1b[Z");
		assert.equal(replacement.getText(), "");
	});

	it("a new session in the same editor decorates it again", async () => {
		const h = harness();
		h.fire("session_shutdown", { reason: "new" });
		h.fire("session_start", { reason: "new" });
		h.ran();
		h.key(CTRL_E);
		await settle();
		assert.equal(h.gets.length, 1);
	});

	it("a session without the interactive view starts nothing", async () => {
		const h = harness();
		h.fire("session_shutdown", { reason: "quit" });
		(h.ctx as { mode: string }).mode = "print";
		h.fire("session_start", { reason: "startup" });
		h.asked();
		await settle();
		assert.equal(h.gets.length, 0);
		assert.equal(h.controller.suggestion(), undefined);
	});
});
