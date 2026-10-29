import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { stripVTControlCharacters as strip } from "node:util";
import { it } from "node:test";
import statusbar from "../../../extensions/RQW-statusbar/index.ts";

it("shows retry countdown and branch activity, then restores stock on unknown indicators", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const handlers = new Map<string, (event: unknown, ctx: any) => any>();
	const commands = new Map<string, any>();
	const pi = {
		events: { on: () => () => {}, emit() {} }, getSettings: () => ({}), getSessionName: () => undefined,
		registerCommand: (name: string, command: unknown) => commands.set(name, command),
		on: (name: string, handler: (event: unknown, ctx: any) => any) => handlers.set(name, handler),
	};
	let factory: any;
	let widget: any;
	const ctx = {
		mode: "tui", cwd: tmpdir(), isIdle: () => false, getContextUsage: () => undefined,
		sessionManager: { getSessionId: () => "s", getLeafId: () => null, getEntryCount: () => 0, getEntries: () => [] },
		ui: { theme: { fg: (_role: string, text: string) => text }, getEditorComponent: () => factory,
			setEditorComponent: (next: unknown) => { factory = next; }, setFooter() {}, setWorkingIndicator() {},
			setWidget: (_key: string, next: unknown) => { widget = next; } },
	};
	statusbar(pi as never);
	await handlers.get("session_start")!({}, ctx);
	const editor = factory({ requestRender() {}, terminal: { rows: 40 } },
		{ borderColor: (text: string) => text, selectList: {} }, { matches: () => false });
	const rows = widget();
	const shown = () => strip(rows.render(80)[0] ?? "").trim();
	class Retry {
		kind = "retry";
		message = "Retrying (2/3) in 4s... (esc to cancel)";
		setMessage(message: string) { this.message = message; }
		renderInBorder() { return `⠋ ${this.message}`; }
		renderSpinnerInBorder() { return "⠋"; }
		dispose() {}
	}
	const retry = new Retry();
	editor.setWorkingStatusIndicator(retry);
	assert.equal(shown(), "Retrying 2/3 in 4s · esc to cancel");
	assert.match(rows.render(80)[0], /\x1b\[38;2;255;179;71m/);
	retry.setMessage("Retrying (2/3) in 3s... (esc to cancel)");
	assert.equal(shown(), "Retrying 2/3 in 3s · esc to cancel");
	editor.setWorkingStatusIndicator({ kind: "branchSummary", renderInBorder: () => "Summarizing branch... (esc to cancel)", dispose() {} });
	assert.equal(shown(), "Summarizing branch · esc to cancel");
	editor.setWorkingStatusIndicator({ kind: "retry", renderInBorder: () => "Changed indicator", renderSpinnerInBorder: () => "!", setMessage() {} });
	assert.match(strip(editor.render(80)[0]), /Changed indicator/);
	editor.setWorkingStatusIndicator(retry);
	const ourFactory = factory;
	ctx.ui.setEditorComponent(() => ({ setWorkingStatusIndicator() {} }));
	// Pi disposes the active indicator and clears only the replacement editor.
	retry.dispose();
	assert.doesNotMatch(shown(), /Retrying/);
	ctx.ui.setEditorComponent(ourFactory);
	editor.setWorkingStatusIndicator(retry);
	await commands.get("statusbar").handler("off", ctx);
	retry.setMessage("Retrying (2/3) in 2s... (esc to cancel)");
	assert.doesNotMatch(shown(), /Retrying 2\/3 in 2s/);
});
