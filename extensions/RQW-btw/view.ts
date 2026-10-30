// The side chat view: its own transcript and input over the whole screen. Everything lives in this object only;
// closing drops it, and nothing reaches the main chat, the session file or the model context.
import type { AssistantMessage, Message, UserMessage } from "@earendil-works/pi-ai";
import { getMarkdownTheme, getSelectListTheme, UserMessageComponent, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Editor, Markdown, matchesKey, wrapTextWithAnsi, type Component, type Focusable, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { BtwCore, Mark } from "./core.ts";

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const TOOL_NOTE = "Tool calls in this answer were not executed.";
export const SHORT_NOTE = "This answer used a shorter context.";
export const UNSENT_NOTE = "Earlier side messages are no longer sent to the model.";

type Item =
	| { kind: "user"; text: string; turn: number }
	| { kind: "answer"; text: string; tools: boolean; short: boolean }
	| { kind: "error"; text: string };

/** The stock editor with `/btw` in gold on its top line. */
class SideEditor extends Editor {
	private readonly label: (width: number) => string;
	constructor(tui: TUI, theme: Theme) {
		super(tui, { borderColor: (text) => theme.fg("dim", text), selectList: getSelectListTheme() });
		this.label = (width) => theme.fg("dim", "─") + theme.fg("accent", " /btw ") + theme.fg("dim", "─".repeat(Math.max(0, width - 7)));
	}
	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		return hiddenLineCount > 0 || width < 8 ? super.renderTopBorder(width, hiddenLineCount) : this.label(width);
	}
}

export class SideChat implements Component, Focusable {
	private readonly turns: Message[] = [];
	private readonly items: Item[] = [];
	private lines = new WeakMap<Item, { width: number; lines: string[] }>();
	private readonly editor: SideEditor;
	/** The first side turn still sent to the model, when older ones no longer fit. */
	private cut = 0;
	/** Rows scrolled up from the end; 0 follows the end. */
	private back = 0;
	private rows = 0;
	private frame = 0;
	private timer: ReturnType<typeof setInterval> | undefined;
	private controller: AbortController | undefined;
	private closed = false;
	private _focused = false;

	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly ctx: ExtensionContext;
	private readonly core: BtwCore;
	private readonly mark: Mark;
	private readonly done: () => void;

	constructor(tui: TUI, theme: Theme, ctx: ExtensionContext, core: BtwCore, mark: Mark, done: () => void) {
		this.tui = tui;
		this.theme = theme;
		this.ctx = ctx;
		this.core = core;
		this.mark = mark;
		this.done = done;
		this.editor = new SideEditor(tui, theme);
		this.editor.onSubmit = (text) => { if (text.trim()) this.send(text.trim()); };
	}

	isClosed(): boolean { return this.closed; }

	get focused(): boolean { return this._focused; }
	set focused(value: boolean) { this._focused = value; this.editor.focused = value; }

	send(text: string): void {
		if (this.closed || this.controller) return;
		const user: UserMessage = { role: "user", content: text, timestamp: Date.now() };
		this.turns.push(user);
		this.items.push({ kind: "user", text, turn: this.turns.length - 1 });
		this.cut = this.core.unsent(this.mark, this.turns);
		this.back = 0;
		const controller = new AbortController();
		this.controller = controller;
		this.editor.disableSubmit = true;
		this.timer = setInterval(() => { this.frame++; this.tui.requestRender(); }, 80);
		const finish = (item: Item, answer?: AssistantMessage) => {
			if (controller.signal.aborted) return;
			// A failed question is not part of what the model is told next time.
			if (answer) this.turns.push(answer);
			else this.turns.splice(this.turns.indexOf(user), 1);
			this.items.push(item);
			this.idle();
		};
		this.core.send(this.ctx, this.mark, [...this.turns], controller.signal).then(({ message, short }) => {
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				finish({ kind: "error", text: message.errorMessage ?? "The side chat request failed." });
				return;
			}
			const answer = message.content.filter(part => part.type === "text").map(part => part.text).join("\n\n").trim();
			finish({ kind: "answer", text: answer, tools: message.content.some(part => part.type === "toolCall"), short }, message);
		}, (error: unknown) => finish({ kind: "error", text: error instanceof Error ? error.message : String(error) }));
		this.tui.requestRender();
	}

	private idle(): void {
		if (this.timer !== undefined) clearInterval(this.timer);
		this.timer = undefined;
		this.controller = undefined;
		this.editor.disableSubmit = false;
		this.tui.requestRender();
	}

	/** Leaves the side chat: a running answer is cancelled and everything here is forgotten. */
	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.controller?.abort();
		this.idle();
		this.turns.length = 0;
		this.items.length = 0;
		this.done();
	}

	private itemLines(item: Item, width: number): string[] {
		const cached = this.lines.get(item);
		if (cached?.width === width) return cached.lines;
		const t = this.theme;
		const note = (color: "warning" | "dim", text: string) => wrapTextWithAnsi(t.fg(color, text), width - 2).map(line => " " + line);
		let lines: string[];
		if (item.kind === "user") lines = ["", ...new UserMessageComponent(item.text, getMarkdownTheme()).render(width)];
		else if (item.kind === "error") lines = ["", ...wrapTextWithAnsi(t.fg("error", item.text), width - 2).map(line => " " + line)];
		else {
			lines = ["", ...(item.text ? new Markdown(item.text, 1, 0, getMarkdownTheme()).render(width) : [])];
			if (item.tools) lines.push("", ...note("warning", TOOL_NOTE));
			if (item.short) lines.push("", ...note("dim", SHORT_NOTE));
		}
		this.lines.set(item, { width, lines });
		return lines;
	}

	private body(width: number): string[] {
		const rows: string[] = [];
		for (const item of this.items) {
			if (this.cut > 0 && item.kind === "user" && item.turn === this.cut) {
				rows.push("", ...wrapTextWithAnsi(this.theme.fg("dim", UNSENT_NOTE), width - 2).map(line => " " + line));
			}
			rows.push(...this.itemLines(item, width));
		}
		if (this.controller) rows.push("", " " + this.theme.fg("dim", SPIN[this.frame % SPIN.length]));
		return rows;
	}

	private lowerHeight = 4;
	private width = 0;
	private room(): number {
		return Math.max(1, this.tui.terminal.rows - this.lowerHeight);
	}

	render(width: number): string[] {
		this.width = width;
		const height = Math.max(1, this.tui.terminal.rows);
		const lower = ["", ...this.editor.render(width)];
		this.lowerHeight = lower.length;
		const body = this.body(width);
		// Scrolled up: rows added or removed at the end must not move the visible text. Only the end is followed.
		if (this.back > 0) this.back += body.length - this.rows;
		this.rows = body.length;
		const room = Math.max(0, height - lower.length);
		this.back = Math.max(0, Math.min(this.back, body.length - room));
		const end = body.length - this.back;
		const shown = body.slice(Math.max(0, end - room), end);
		while (shown.length < room) shown.unshift("");
		return [...shown, ...lower].slice(-height);
	}

	private scroll(lines: number): void {
		// Leaving the end: count from the body as it is now, not as it was at the last frame.
		if (this.back === 0) this.rows = this.body(this.width || this.tui.terminal.columns).length;
		this.back = Math.max(0, this.back + lines);
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) { this.close(); return; }
		const page = Math.max(1, this.room() - 1);
		const empty = this.editor.getText() === "";
		if (matchesKey(data, "pageUp")) this.scroll(page);
		else if (matchesKey(data, "pageDown")) this.scroll(-page);
		else if (empty && matchesKey(data, "up")) this.scroll(1);
		else if (empty && matchesKey(data, "down")) this.scroll(-1);
		else {
			this.editor.handleInput(data);
			this.tui.requestRender();
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel") return undefined;
		// The side chat takes the wheel, so the main chat underneath never scrolls.
		this.scroll(-(event.wheelDelta ?? 0));
		return { handled: true };
	}

	invalidate(): void {
		this.lines = new WeakMap();
		this.editor.invalidate();
	}

	dispose(): void {
		this.closed = true;
		this.controller?.abort();
		if (this.timer !== undefined) clearInterval(this.timer);
		this.timer = undefined;
	}
}
