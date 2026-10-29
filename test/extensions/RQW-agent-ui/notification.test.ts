import assert from "node:assert/strict";
import { it } from "node:test";
import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import agentUi from "../../../extensions/RQW-agent-ui/index.ts";

const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
const codes: Record<string, number> = { muted: 90, thinkingHigh: 33, success: 32, error: 31 };
const colored = { ...theme, fg: (role: string, text: string) => `\x1b[${codes[role]}m${text}\x1b[39m` };

for (const [type, content, expected] of [
	["agent_progress", '[notification] agent#711 has worked 50 tool-call steps without communication.\nReport\n<skill name="agent-progress">\nFull instructions\n</skill>', "agent#711 progress: 50 steps"],
	["child_wait", JSON.stringify({ reason: "timeout", timed_out: true, results: [], statuses: [{ id: "agent#5", state: "running" }] }), "wait timed out: agent#5"],
	["job", '[job] ' + JSON.stringify({ reason: "exit", results: [{ id: "job#3", state: "exited", result: "Full output\nSecond line" }], statuses: [] }), "job#3 done"],
]) {
	it(`renders ${type} as one line with the full original expanded`, () => {
		const renderers = new Map<string, MessageRenderer>();
		agentUi({ registerMessageRenderer: (name: string, renderer: MessageRenderer) => renderers.set(name, renderer), registerToolRenderer() {} } as never);
		const renderer = renderers.get(type);
		assert.ok(renderer);
		const message = { role: "custom", customType: type, content, display: true, timestamp: 0 };
		assert.deepEqual(renderer(message as never, { expanded: false, outputPad: 0 }, theme as never)!.render(80), [expected]);
		assert.equal(renderer(message as never, { expanded: true, outputPad: 0 }, theme as never)!.render(1000).join("\n"), content);
		const status = type === "agent_progress" ? "progress" : type === "child_wait" ? "timed out" : "done";
		const role = type === "agent_progress" ? "thinkingHigh" : type === "child_wait" ? "error" : "success";
		const rows = renderer(message as never, { expanded: false, outputPad: 0 }, colored as never)!.render(80);
		assert.equal(rows.length, 1);
		assert.ok(rows[0].includes(colored.fg(role, status)));
		assert.ok(rows[0].includes(colored.fg("muted", type === "agent_progress" ? "agent#711 " : type === "job" ? "job#3 " : ": agent#5")));
		if (type === "job") {
			for (const failure of [{ state: "failed" }, { state: "exited", exit_code: 1 }]) {
				const failed = { ...message, content: "[job] " + JSON.stringify({ reason: "exit", results: [{ id: "job#3", ...failure }] }) };
				assert.ok(renderer(failed as never, { expanded: false, outputPad: 0 }, colored as never)!.render(80)[0].includes(colored.fg("error", "failed")));
			}
		}
	});
}

it("does not repaint a notification at an unchanged width and refreshes after invalidate", () => {
	const renderers = new Map<string, MessageRenderer>();
	agentUi({ registerMessageRenderer: (name: string, renderer: MessageRenderer) => renderers.set(name, renderer), registerToolRenderer() {} } as never);
	let paints = 0;
	const counting = { ...theme, fg: (_role: string, text: string) => (paints++, text) };
	const message = { role: "custom", customType: "agent_progress", content: "[notification] agent#7 has worked 50 tool-call steps", display: true, timestamp: 0 };
	const card = renderers.get("agent_progress")!(message as never, { expanded: true, outputPad: 0 }, counting as never)!;
	const wide = [...card.render(80)];
	const before = paints;
	assert.deepEqual(card.render(80), wide);
	assert.equal(paints, before);
	// A width change rewraps the rows and repaints them.
	const narrow = card.render(20);
	assert.ok(paints > before);
	assert.ok(narrow.length > wide.length && narrow.every(row => row.length <= 20));
	const afterWidth = paints;
	card.invalidate();
	assert.deepEqual(card.render(20), narrow);
	assert.ok(paints > afterWidth);
});
