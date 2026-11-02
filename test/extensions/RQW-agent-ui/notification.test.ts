import assert from "node:assert/strict";
import { it } from "node:test";
import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { initTheme, keyHint, keyText } from "@earendil-works/pi-coding-agent";
import agentUi from "../../../extensions/RQW-agent-ui/index.ts";

const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };
const codes: Record<string, number> = { muted: 90, thinkingHigh: 33, success: 32, error: 31 };
const colored = { ...theme, fg: (role: string, text: string) => `\x1b[${codes[role]}m${text}\x1b[39m` };

for (const [type, content, expected] of [
	["agent_progress", '[notification] agent#711 has worked 50 tool-call steps without communication.\n\nThe agent continues working.\n\n<skill name="agent-progress">\nFull instructions\n</skill>', "agent#711 progress"],
	["child_wait", JSON.stringify({ reason: "timeout", timed_out: true, results: [], statuses: [{ id: "agent#5", state: "running" }] }), "wait timed out: agent#5"],
]) {
	it(`renders ${type} as one line with the full original expanded`, () => {
		const renderers = new Map<string, MessageRenderer>();
		agentUi({ registerMessageRenderer: (name: string, renderer: MessageRenderer) => renderers.set(name, renderer), registerToolRenderer() {}, on() {} } as never);
		const renderer = renderers.get(type);
		assert.ok(renderer);
		const message = { role: "custom", customType: type, content, display: true, timestamp: 0 };
		assert.deepEqual(renderer(message as never, { expanded: false, outputPad: 0, keyText, keyHint }, theme as never)!.render(80), [expected]);
		assert.equal(renderer(message as never, { expanded: true, outputPad: 0, keyText, keyHint }, theme as never)!.render(1000).join("\n"), content);
		const status = type === "agent_progress" ? "progress" : "timed out";
		const role = type === "agent_progress" ? "thinkingHigh" : "error";
		const rows = renderer(message as never, { expanded: false, outputPad: 0, keyText, keyHint }, colored as never)!.render(80);
		assert.equal(rows.length, 1);
		assert.ok(rows[0].includes(colored.fg(role, status)));
		assert.ok(rows[0].includes(colored.fg("muted", type === "agent_progress" ? "agent#711 " : ": agent#5")));
	});
}

it("does not repaint a notification at an unchanged width and refreshes after invalidate", () => {
	const renderers = new Map<string, MessageRenderer>();
	agentUi({ registerMessageRenderer: (name: string, renderer: MessageRenderer) => renderers.set(name, renderer), registerToolRenderer() {}, on() {} } as never);
	let paints = 0;
	const counting = { ...theme, fg: (_role: string, text: string) => (paints++, text) };
	const message = { role: "custom", customType: "agent_progress", content: "[notification] agent#7 has worked 50 tool-call steps", display: true, timestamp: 0 };
	const card = renderers.get("agent_progress")!(message as never, { expanded: true, outputPad: 0, keyText, keyHint }, counting as never)!;
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

const click = (card: any, over: Record<string, unknown> = {}) =>
	card.handleMouse({ type: "click", button: "left", x: 3, y: 0, screenX: 3, screenY: 0, width: 80, height: 1, shift: false, alt: false, ctrl: false, ...over });

it("shows the whole progress summary under the opened header, not the instructions or skill", () => {
	initTheme();
	const renderers = new Map<string, MessageRenderer>();
	agentUi({ registerMessageRenderer: (name: string, renderer: MessageRenderer) => renderers.set(name, renderer), registerToolRenderer() {}, on() {} } as never);
	const summary = "First line of the report\n\n- point one\n- point two\nThe agent continues working.\n<skill name=\"x\">\n\nLast **bold** line";
	const content = `[notification] agent#711 has worked 50 tool-call steps without communication.\n${summary}\nThe agent continues working. Check whether this child has drifted.\n\n<skill name="agent-progress">\nFull instructions\n</skill>`;
	const message = { role: "custom", customType: "agent_progress", content, details: { id: "agent#711", steps: 50 }, display: true, timestamp: 0 };
	const card = renderers.get("agent_progress")!(message as never, { expanded: false, outputPad: 0, keyText, keyHint }, theme as never)!;
	assert.deepEqual(card.render(80), ["agent#711 progress [click to show]"]);
	assert.deepEqual(click(card), { handled: true, render: true });
	const rows = card.render(80).map((row) => row.replace(/\x1b\[[0-9;]*m/g, ""));
	assert.equal(rows[0], "agent#711 progress");
	assert.deepEqual(rows.slice(1).map((row) => row.trim()).filter(Boolean), ["First line of the report", "- point one", "- point two", "The agent continues working.", '<skill name="x">', "Last bold line"]);
	assert.ok(rows.slice(1).every((row) => !row || row.startsWith("  ")));
	assert.ok(!rows.join("\n").includes("drifted") && !rows.join("\n").includes("Full instructions"));
	// Ctrl+O still shows the whole original text.
	const expanded = renderers.get("agent_progress")!(message as never, { expanded: true, outputPad: 0, keyText, keyHint }, theme as never)!;
	assert.equal(expanded.render(1000).join("\n"), content);
});

it("opens a progress card by left click and closes it by a click on its text, per message", () => {
	initTheme();
	const renderers = new Map<string, MessageRenderer>();
	agentUi({ registerMessageRenderer: (name: string, renderer: MessageRenderer) => renderers.set(name, renderer), registerToolRenderer() {}, on() {} } as never);
	const make = (id: string) => ({ role: "custom", customType: "agent_progress", display: true, timestamp: 0, details: { id },
		content: `[notification] ${id} has worked 30 minutes without communication.\nChecked the counter.\nThe agent continues working.\n\n<skill name="agent-progress">\nFull\n</skill>` });
	const message = make("agent#7");
	const draw = (card: any) => card.render(80).map((row: string) => row.trim());
	const card: any = renderers.get("agent_progress")!(message as never, { expanded: false, outputPad: 0, keyText, keyHint }, theme as never)!;
	assert.deepEqual(draw(card), ["agent#7 progress [click to show]"]);
	// Only a left click changes the card.
	for (const over of [{ button: "right" }, { button: "middle" }, { type: "wheel", button: "none" }, { type: "press" }, { type: "drag" }, { type: "release" }]) {
		assert.equal(click(card, over), undefined);
		assert.deepEqual(draw(card), ["agent#7 progress [click to show]"]);
	}
	assert.deepEqual(click(card), { handled: true, render: true });
	assert.deepEqual(draw(card), ["agent#7 progress", "Checked the counter."]);
	// A rebuilt card (theme change) of the same message stays open; another message starts collapsed.
	const rebuilt: any = renderers.get("agent_progress")!(message as never, { expanded: false, outputPad: 0, keyText, keyHint }, theme as never)!;
	assert.deepEqual(draw(rebuilt), ["agent#7 progress", "Checked the counter."]);
	assert.deepEqual(draw(renderers.get("agent_progress")!(make("agent#7") as never, { expanded: false, outputPad: 0, keyText, keyHint }, theme as never)!), ["agent#7 progress [click to show]"]);
	// A click on the text row closes it again.
	assert.deepEqual(click(rebuilt, { y: 1, screenY: 1, height: 2 }), { handled: true, render: true });
	assert.deepEqual(draw(rebuilt), ["agent#7 progress [click to show]"]);
	// Ctrl+O shows the original and takes no clicks.
	const original: any = renderers.get("agent_progress")!(message as never, { expanded: true, outputPad: 0, keyText, keyHint }, theme as never)!;
	assert.equal(original.handleMouse, undefined);
	assert.ok(original.render(1000).join("\n").includes("Full"));
});
