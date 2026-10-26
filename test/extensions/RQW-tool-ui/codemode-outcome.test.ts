// Real Pi tool components: a codemode outcome cannot be replaced by its nested success.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import * as pi from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { ToolUi } from "../../../extensions/RQW-tool-ui/render.ts";
import { call, CWD, fakeTui, messages, session, stockTheme } from "./transcript.ts";

before(() => pi.initTheme("dark", false));

const plain = (c: pi.ToolExecutionComponent) => c.render(100).map((row) => stripTerminalSequences(row).trim()).filter(Boolean);

for (const mode of ["live", "history"] as const) describe(`codemode outer outcome, ${mode}`, () => {
	for (const [label, outerError, nestedError] of [
		["nested success then script error", true, false],
		["normal success", false, false],
		["nested failure propagated", true, true],
		["nested failure caught by successful script", false, true],
	] as const) it(label, () => {
		const m = messages();
		const args = { code: 'await tools.read({ path: "a.ts" }); throw new Error("SCRIPT_BROKE");' };
		const assistant = m.assistant([call("c0", "codemode", args)]);
		const final = m.result("c0", "codemode", outerError ? "Error: SCRIPT_BROKE" : "script completed", {
			isError: outerError, durationMs: 1200,
			nestedCalls: { complete: true, calls: [{ id: "c0/1", name: "read", arguments: { path: "a.ts" }, status: nestedError ? "error" : "ok", durationMs: 100 }] },
		});
		const sm = session(mode === "history" ? [assistant, final] : [assistant]);
		const ui = new ToolUi();
		ui.start(sm);
		const definition = pi.createCodemodeExtension();
		// The built-in extension's tool definition is obtained through its public registration API.
		let codemode: pi.ToolRenderers | undefined;
		definition({ registerTool: (tool: pi.ToolRenderers) => { codemode = tool; }, on: () => {} } as never);
		assert.ok(codemode);
		const options = { outputPad: 1 };
		const ours = new pi.ToolExecutionComponent("codemode", "c0", args, options, ui.resolve("codemode", () => codemode), fakeTui() as never, CWD);
		const stock = new pi.ToolExecutionComponent("codemode", "c0", args, options, codemode, fakeTui() as never, CWD);
		const update = () => {
			for (const component of [ours, stock]) component.updateResult({ content: final.content, isError: outerError, durationMs: 1200 }, false);
		};
		const expectedSummary = outerError || nestedError ? "Read 1 file \u00b7 1 failed" : "Read 1 file";
		const check = () => {
			const rows = plain(ours);
			assert.equal(rows[0], expectedSummary, "no parent tool count or duplicate failure count");
			assert.equal(rows.at(-1), outerError ? "\u2717 error \u00b7 1.2s" : nestedError ? "\u2717 error \u00b7 0.1s" : "\u2713 0.1s");
			assert.match(rows[1], outerError ? /^codemode / : /^read a\.ts$/);
			if (outerError) {
				assert.equal(rows[2], "Error: SCRIPT_BROKE");
				const theme = stockTheme();
				assert.ok(ours.render(100).at(-1)!.includes(theme.bg("toolErrorBg", theme.fg("error", "\u2717 error \u00b7 1.2s") + " ".repeat(96 - visibleWidth("\u2717 error \u00b7 1.2s")))));
			}
			const members = ui.group("c0")!.members;
			assert.deepEqual(members.map((member) => [member.id, member.toolName, member.isError]), [["c0/1", "read", nestedError]], "nested details remain authoritative for nested calls");
			return ours.render(100);
		};
		if (mode === "live") {
			ui.toolStart({ toolCallId: "c0", toolName: "codemode", args });
			ui.toolStart({ toolCallId: "c0/1", parentToolCallId: "c0", toolName: "read", args: { path: "a.ts" } });
			ui.toolEnd({ toolCallId: "c0/1", result: { content: [{ type: "text", text: "file contents" }] }, isError: nestedError, durationMs: 100 });
			assert.equal(plain(ours).at(-1), nestedError ? "\u2717 error \u00b7 0.1s" : "\u2713 0.1s", "nested outcome before outer completion");
			ui.toolEnd({ toolCallId: "c0", result: final, isError: outerError, durationMs: 1200 });
			update();
			const beforeSave = check();
			sm.appendMessage(final as never);
			ui.messageEnd(final);
			assert.deepEqual(check(), beforeSave, "saved result agrees with execution events");
		} else update();
		const compact = check();
		ui.agentEnd();
		assert.deepEqual(check(), compact, "agent_end preserves the outcome");
		for (const component of [ours, stock]) component.setExpanded(true);
		for (const width of [40, 80, 100]) assert.deepEqual(ours.render(width), stock.render(width), "Ctrl+O retains Pi's original");
		for (const component of [ours, stock]) component.setExpanded(false);
		assert.deepEqual(ours.render(100), compact, "folding restores compact details");
		const answer = m.assistant([{ type: "text", text: "done" }]);
		sm.appendMessage(answer as never);
		ui.messageStart(answer);
		assert.deepEqual(plain(ours), [expectedSummary], "answer folds the card but keeps the failure");
	});
});
