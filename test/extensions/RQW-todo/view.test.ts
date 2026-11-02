import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import todo, { type State } from "../../../extensions/RQW-todo/index.ts";
import { registerTodoView } from "../../../extensions/RQW-todo/view.ts";

const state = (text: string, status: "active" | "done" = "done", extra: Partial<State> = {}): State => ({
	items: [{ id: text, text, status }], ...extra,
});
const result = (details: unknown, toolName = "todo") => ({ type: "message", message: { role: "toolResult", toolName, details } });
type Panel = { render(width: number): string[]; handleInput(data: string): void };

function harness(current: State, branch: unknown[], rows = 30, mode = "tui") {
	let command!: { handler(args: string, ctx: unknown): Promise<void> };
	let panel!: Panel;
	let closed = false;
	let renders = 0;
	let options: unknown;
	const notes: string[] = [];
	registerTodoView({ registerCommand(name: string, definition: typeof command) { assert.equal(name, "todo"); command = definition; } } as unknown as ExtensionAPI, () => current);
	const ctx = {
		mode,
		sessionManager: { getBranch: () => branch },
		ui: {
			notify: (text: string) => notes.push(text),
			custom(factory: Function, value: unknown) {
				options = value;
				return new Promise<void>(resolve => {
					panel = factory({ terminal: { rows, columns: 80 }, requestRender: () => { renders++; } }, { fg: (_color: string, text: string) => text, bold: (text: string) => text }, {}, () => { closed = true; resolve(); });
				});
			},
		},
	};
	return {
		async open() { await command.handler("", ctx); },
		screen(width = 80) { return panel.render(width).join("\n"); },
		key(data: string) { panel.handleInput(data); },
		get closed() { return closed; }, get renders() { return renders; }, get options() { return options; }, notes,
	};
}

it("opens the full view with current details and closed branch history, newest first", async () => {
	const current: State = { items: [
		{ id: "a", text: "Current task", status: "blocked", note: "Waiting for approval", steps: [{ text: "First step", status: "done" }, { text: "Next step", status: "active" }] },
		{ id: "b", text: "Cancelled task", status: "dropped", note: "No longer needed" },
	] };
	const branch = [result(state("Old draft", "active")), result(state("Old final")), result(state("Middle draft", "active", { new: true })), result(state("Middle final")), result(state("Current draft", "active", { new: true })), result(current), result(state("Other tool"), "other"), result({ wrong: true })];
	const h = harness(current, branch);
	await h.open();
	assert.deepEqual(h.options, { overlay: true, overlayOptions: { anchor: "top-left", row: 0, col: 0, width: "100%", maxHeight: "100%" } });
	const screen = h.screen();
	for (const text of ["Current task", "Waiting for approval", "First step", "Next step", "Cancelled task", "No longer needed", "Middle final", "Old final"]) assert.ok(screen.includes(text), text);
	assert.ok(screen.indexOf("Current task") < screen.indexOf("Middle final"));
	assert.ok(screen.indexOf("Middle final") < screen.indexOf("Old final"));
	for (const text of ["Old draft", "Middle draft", "Current draft", "Other tool"]) assert.ok(!screen.includes(text), text);
	h.key("\x1b");
	assert.equal(h.closed, true);
});

it("reads history from actual todo tool results after a branch change", async () => {
	const handlers: Record<string, Function[]> = {};
	let tool: any;
	let active = ["todo"];
	todo({
		events: { on: () => {} },
		on: (name: string, handler: Function) => { (handlers[name] ??= []).push(handler); },
		registerTool: (value: unknown) => { tool = value; }, registerCommand: () => {},
		getActiveTools: () => active, setActiveTools: (names: string[]) => { active = names; }, appendEntry: () => {},
	} as unknown as ExtensionAPI);
	const branch: unknown[] = [];
	const ctx = { sessionManager: { getBranch: () => branch } };
	for (const handler of handlers.session_start) await handler({}, ctx);
	const run = async (input: unknown) => {
		const output = await tool.execute("id", input, undefined, undefined, ctx);
		branch.push(result(output.details));
		return output.details as State;
	};
	await run({ items: [{ id: "a", text: "First list", status: "active" }] });
	await run({ items: [{ id: "a", status: "done" }] });
	const fork = branch.slice();
	await run({ new: true, items: [{ id: "b", text: "Other branch" }] });
	branch.splice(0, branch.length, ...fork);
	for (const handler of handlers.session_tree) await handler({}, ctx);
	const current = await run({ new: true, items: [{ id: "c", text: "Chosen branch" }] });
	const h = harness(current, branch);
	await h.open();
	assert.ok(h.screen().includes("First list"));
	assert.ok(h.screen().includes("Chosen branch"));
	assert.ok(!h.screen().includes("Other branch"));
	h.key("\x1b");
});

it("does not send terminal control sequences from todo content", async () => {
	const current: State = { items: [{ id: "a", text: "Task\u001b]52;c;SGk=\u0007", status: "blocked", note: "Reason\u001b[2J", steps: [{ text: "Step\u001b]0;title\u0007", status: "pending" }] }] };
	const h = harness(current, []);
	await h.open();
	const screen = h.screen();
	assert.ok(screen.includes("Task"));
	assert.ok(screen.includes("Reason"));
	assert.ok(screen.includes("Step"));
	assert.doesNotMatch(screen, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u);
	h.key("\u001b");
});

it("scrolls in both directions by line and page, including wrapped details", async () => {
	const current: State = { items: Array.from({ length: 15 }, (_, index) => ({ id: String(index), text: `Task ${index}`, status: "pending" as const, note: index === 0 ? "A long reason that must wrap without losing its end" : undefined })) };
	const h = harness(current, [result(current)], 6);
	await h.open();
	const top = h.screen(20);
	assert.ok(top.includes("Task 0"));
	h.key("\x1b[B");
	assert.notEqual(h.screen(20), top);
	h.key("\x1b[A");
	assert.equal(h.screen(20), top);
	h.key("\x1b[6~");
	assert.notEqual(h.screen(20), top);
	h.key("\x1b[5~");
	assert.equal(h.screen(20), top);
	let all = top;
	for (let i = 0; i < 20; i++) { h.key("\x1b[6~"); all += h.screen(20); }
	assert.ok(all.includes("Task 14"));
	assert.ok(all.includes("its end"));
	assert.ok(h.renders > 0);
	h.key("\x1b");
});

it("uses the selected branch and handles an empty list and noninteractive mode", async () => {
	const empty = harness({ items: [] }, []);
	await empty.open();
	assert.ok(empty.screen().includes("todo"));
	empty.key("\x1b");
	const branch = [result(state("Visible history")), result(state("Branch task", "active", { new: true }))];
	const h = harness(state("Branch task", "active"), branch);
	await h.open();
	assert.ok(h.screen().includes("Visible history"));
	h.key("\x1b");
	const headless = harness({ items: [] }, [], 30, "print");
	await headless.open();
	assert.equal(headless.notes.length, 1);
});
