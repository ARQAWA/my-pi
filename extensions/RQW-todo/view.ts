import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, stripTerminalSequences, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Item, State } from "./index.ts";

const itemStatus: Record<Item["status"], string> = {
	pending: "○", active: "▸", done: "✓", dropped: "×", blocked: "!",
};
const stepStatus = { pending: "○", active: "▸", done: "✓" };
const safe = (text: string) => stripTerminalSequences(text).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, " ");

function history(ctx: ExtensionContext): State[] {
	const lists: State[] = [];
	let latest: State | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || entry.message.role !== "toolResult" || entry.message.toolName !== "todo") continue;
		const state = entry.message.details as State | undefined;
		if (!state || !Array.isArray(state.items)) continue;
		if (state.new && latest) {
			if (latest.items.length && latest.items.every(item => item.status === "done" || item.status === "dropped")) lists.push(latest);
		}
		latest = state;
	}
	return lists.reverse();
}

class TodoView implements Component {
	private offset = 0;
	private length = 0;
	private readonly lines: string[] = [];
	private readonly tui: TUI;
	private readonly done: () => void;

	constructor(tui: TUI, current: State, previous: State[], done: () => void) {
		this.tui = tui;
		this.done = done;
		this.lines.push("/todo", "");
		this.addList(current, "Current list");
		for (const list of previous) {
			this.lines.push("");
			this.addList(list, "Closed list");
		}
	}

	private addList(state: State, title: string): void {
		this.lines.push(title);
		if (!state.items.length) this.lines.push("  No items");
		for (const item of state.items) {
			this.lines.push(`${itemStatus[item.status]} ${safe(item.text)} [${item.status}]`);
			if (item.note) this.lines.push(`  ${safe(item.note)}`);
			for (const step of item.steps ?? []) this.lines.push(`  ${stepStatus[step.status]} ${safe(step.text)} [${step.status}]`);
		}
	}

	render(width: number): string[] {
		const height = Math.max(1, this.tui.terminal.rows);
		const lines = this.lines.flatMap(line => line ? wrapTextWithAnsi(line, Math.max(1, width)) : [""]);
		this.length = lines.length;
		this.offset = Math.max(0, Math.min(this.offset, this.length - height));
		const visible = lines.slice(this.offset, this.offset + height);
		while (visible.length < height) visible.push("");
		return visible;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) { this.done(); return; }
		const page = Math.max(1, this.tui.terminal.rows - 1);
		let delta = 0;
		if (matchesKey(data, "up")) delta = -1;
		else if (matchesKey(data, "down")) delta = 1;
		else if (matchesKey(data, "pageUp")) delta = -page;
		else if (matchesKey(data, "pageDown")) delta = page;
		if (delta) {
			this.offset = Math.max(0, Math.min(this.offset + delta, this.length - Math.max(1, this.tui.terminal.rows)));
			this.tui.requestRender();
		}
	}

	invalidate(): void {}
}

/** Register the command with the current in-memory state; history comes from the selected branch. */
export function registerTodoView(pi: ExtensionAPI, getState: () => State): void {
	pi.registerCommand("todo", {
		description: "Show the full todo list and branch history",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") { ctx.ui.notify("/todo needs the interactive view.", "warning"); return; }
			const current = getState();
			const previous = history(ctx);
			void ctx.ui.custom<void>((tui, _theme, _keys, done) => new TodoView(tui, current, previous, done), {
				overlay: true, overlayOptions: { anchor: "top-left", row: 0, col: 0, width: "100%", maxHeight: "100%" },
			}).catch(error => ctx.ui.notify(`Unable to open /todo: ${String(error)}`, "error"));
		},
	});
}
