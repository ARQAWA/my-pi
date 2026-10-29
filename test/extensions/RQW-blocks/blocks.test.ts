import assert from "node:assert/strict";
import { it } from "node:test";
import { BranchSummaryMessageComponent, CompactionSummaryMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { getKeybindings, KeybindingsManager, setKeybindings, stripTerminalSequences, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import blocks, { installBranch, installCompaction } from "../../../extensions/RQW-blocks/index.ts";

const theme = { fg: (_key: string, text: string) => text, getColorMode: () => "truecolor" } as any;
class Summary {
	expanded = false;
	paddingX = 1;
	markdownTheme = new Proxy({}, { get: () => (text: string) => text });
	message = { summary: "summary body", tokensBefore: 451495 };
	render(_width: number) { return ["stock"]; }
	invalidate() {}
	setExpanded(value: boolean) { this.expanded = value; }
	updateDisplay() {}
	handleMouse() { return "stock mouse"; }
}

it("shows one gold compaction line and restores stock rendering", t => {
	const previous = getKeybindings();
	setKeybindings(new KeybindingsManager({ ...TUI_KEYBINDINGS, "app.tools.expand": { defaultKeys: "ctrl+o", description: "expand" } } as any));
	t.after(() => setKeybindings(previous));
	const restore = installCompaction(() => theme, Summary.prototype);
	try {
		const component = new Summary();
		const lines = component.render(80);
		assert.equal(lines.length, 1);
		assert.match(stripTerminalSequences(lines[0]), /compaction · 451\.5k tokens.*ctrl\+o/);
		for (const color of ["138;109;28", "202;163;41", "227;196;90"]) assert.ok(lines[0].includes(`\x1b[38;2;${color}m`));
		assert.ok(visibleWidth(lines[0]) <= 80);
		component.setExpanded(true);
		assert.match(component.render(80).map(stripTerminalSequences).join("\n"), /summary body/);
		component.setExpanded(false);
		component.message = { ...component.message, tokensBefore: 1000 };
		assert.match(stripTerminalSequences(component.render(80)[0]), /1k tokens/);
	} finally { restore(); }
	assert.deepEqual(new Summary().render(80), ["stock"]);
	const restore256 = installCompaction(() => ({ ...theme, getColorMode: () => "256color" }), Summary.prototype);
	try {
		const line = new Summary().render(80)[0];
		for (const color of [94, 178, 185]) assert.ok(line.includes(`\x1b[38;5;${color}m`));
		assert.doesNotMatch(line, /\x1b\[38;2;/);
	} finally { restore256(); }
});

it("patches and restores the real compaction component", () => {
	initTheme();
	const component = new CompactionSummaryMessageComponent({ role: "compactionSummary", summary: "body", tokensBefore: 451495, timestamp: 0 } as any);
	const stock = component.render(80).map(stripTerminalSequences);
	const restore = installCompaction(() => theme);
	try {
		const lines = component.render(80).map(stripTerminalSequences);
		assert.equal(lines.length, 1);
		assert.match(lines[0], /compaction · 451\.5k tokens/);
		component.setExpanded(true);
		assert.match(component.render(80).map(stripTerminalSequences).join("\n"), /body/);
		component.setExpanded(false);
	} finally { restore(); }
	assert.deepEqual(component.render(80).map(stripTerminalSequences), stock);
});

it("retains stock mouse handling for an incompatible compaction", () => {
	const restore = installCompaction(() => theme, Summary.prototype);
	try {
		const component = new Summary();
		(component as any).markdownTheme = undefined;
		assert.deepEqual(component.render(80), ["stock"]);
		assert.equal(component.handleMouse(), "stock mouse");
	} finally { restore(); }
});

it("returns stock mouse handling when branch rendering fails", () => {
	const restore = installBranch(() => { throw new Error("theme unavailable"); }, Summary.prototype);
	try {
		const component = new Summary();
		assert.deepEqual(component.render(80), ["stock"]);
		assert.equal(component.handleMouse(), "stock mouse");
	} finally { restore(); }
});

it("installs both fullscreen styles and reinstalls after a renderer switch", () => {
	const handlers = new Map<string, (...args: any[]) => void>();
	blocks({ on: (name: string, fn: (...args: any[]) => void) => handlers.set(name, fn) } as any);
	const makeRenderer = () => ({
		mode: "fullscreen", scrollToEndIndicator: () => "stock",
		flashes: { entries: [{ message: "Copied!" }], flash() {}, dispose() {}, render(_width: number) { return ["stock flash"]; } },
	});
	let current = makeRenderer();
	const tui = new Proxy({}, {
		get: (_target, key) => {
			const owner = current;
			const value = Reflect.get(owner, key, owner);
			return typeof value === "function" ? (...args: unknown[]) => Reflect.apply(value, owner, args) : value;
		},
		set: (_target, key, value) => Reflect.set(current, key, value, current),
	});
	let widget: { invalidate(): void } | undefined;
	const ui = { theme, setWidget: (_key: string, factory: any) => { widget = factory?.(tui); } };
	handlers.get("session_start")!({}, { hasUI: true, mode: "tui", ui });
	assert.match(stripTerminalSequences(current.scrollToEndIndicator()), /↓ latest/);
	assert.match(stripTerminalSequences(current.flashes.render(80)[0]), /✓ copied/);
	widget!.invalidate();
	assert.match(stripTerminalSequences(current.scrollToEndIndicator()), /↓ latest/);
	current = makeRenderer();
	widget!.invalidate();
	assert.match(stripTerminalSequences(current.scrollToEndIndicator()), /↓ latest/);
	assert.match(stripTerminalSequences(current.flashes.render(80)[0]), /✓ copied/);
	handlers.get("session_shutdown")!();
	assert.equal(current.scrollToEndIndicator(), "stock");
	assert.equal(current.flashes.render(80)[0], "stock flash");
});

it("shows branch summary as a silver line with expandable text", () => {
	initTheme();
	const component = new BranchSummaryMessageComponent({ role: "branchSummary", summary: "summary body", fromId: "x", timestamp: 0 } as any);
	const stock = component.render(80).map(stripTerminalSequences);
	const restore = installBranch(() => theme);
	try {
		const lines = component.render(80);
		assert.equal(lines.length, 1);
		assert.match(stripTerminalSequences(lines[0]), /branch summary/);
		assert.match(lines[0], /38;2;127;126;124/);
		assert.match(component.render(12)[0], /38;2;127;126;124/);
		component.setExpanded(true);
		assert.match(component.render(80).map(stripTerminalSequences).join("\n"), /summary body/);
		component.setExpanded(false);
	} finally { restore(); }
	assert.deepEqual(component.render(80).map(stripTerminalSequences), stock);
});
