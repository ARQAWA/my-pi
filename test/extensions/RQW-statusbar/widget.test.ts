import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { stripVTControlCharacters as strip } from "node:util";
import { it } from "node:test";
import statusbar from "../../../extensions/RQW-statusbar/index.ts";

it("shows the current activity in the widget after a cached frame", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	t.mock.method(performance, "now", () => 0);
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const pi = {
		events: { on: () => () => {}, emit() {} }, getSettings: () => ({}), getSessionName: () => undefined, getThinkingLevel: () => "off",
		registerCommand() {}, on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers.set(name, handler); },
	};
	let widget: (() => { render(width: number): string[] }) | undefined;
	const ctx = {
		mode: "tui", cwd: tmpdir(), model: undefined, isIdle: () => false,
		ui: { theme: { fg: (_role: string, text: string) => text }, getEditorComponent: () => ({}), setEditorComponent() {}, setFooter() {}, setWorkingIndicator() {},
			setWidget: (_key: string, factory: typeof widget) => { widget = factory; } },
	};
	statusbar(pi as never);
	await handlers.get("session_start")!({}, ctx);
	handlers.get("agent_start")!({}, ctx);
	const rows = widget!();
	assert.equal(strip(rows.render(80)[0]).trim(), "Planning next moves");
	rows.render(80);
	handlers.get("tool_execution_start")!({ toolCallId: "t", toolName: "bash", args: { command: "npm test" } }, ctx);
	assert.equal(strip(rows.render(80)[0]).trim(), "Running npm test");
	await handlers.get("session_shutdown")!({}, ctx);
});
