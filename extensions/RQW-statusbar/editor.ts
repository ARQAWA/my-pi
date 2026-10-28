// Pi's editor with the session ID at the right end of its top border and the context row as its bottom border.
// Everything else is stock `CustomEditor`.
import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { type ActivityChrome, type BarState, editorBorder, type Paint, topBorder } from "./render.ts";

/** What the borders show; undefined while the bar is off or its session is gone, then the stock borders are drawn. */
export interface BorderSource {
	context(): BarState["context"];
	sessionId(): string | undefined;
	sessionName?(): string | undefined;
	paint(): Paint;
	/** Activity controls the compaction sheen; its text lives in the separate widget. */
	activity?(): ActivityChrome | undefined;
}

export class ContextEditor extends CustomEditor {
	private readonly source: () => BorderSource | undefined;
	private top?: { key: unknown[]; line: string };
	private bottom?: { key: unknown[]; line: string };

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, source: () => BorderSource | undefined) {
		// Keep Pi's status out of its separate row; our top border replaces the embedded indicator.
		super(tui, theme, keybindings, { embedWorkingStatus: true });
		this.source = source;
	}

	/** With a source the top border is ours (rule, title, hint, ID); otherwise Pi draws its plain border. */
	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		const source = this.source();
		if (!source) return super.renderTopBorder(width, hiddenLineCount);
		const id = source.sessionId();
		const activity = source.activity?.();
		const paint = source.paint();
		const name = source.sessionName?.();
		const key = [width, hiddenLineCount, id, name, paint, activity?.compacting, activity?.compacting ? activity.frame : undefined];
		if (!this.top || key.some((value, i) => value !== this.top!.key[i])) this.top = { key, line: topBorder(width, id, activity, hiddenLineCount, paint, name) };
		return this.top.line;
	}

	protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
		const source = this.source();
		if (!source) return super.renderBottomBorder(width, hiddenLineCount);
		const activity = source.activity?.();
		const context = source.context();
		const paint = source.paint();
		const frame = activity?.compacting ? activity.frame : undefined;
		const key = [width, hiddenLineCount, context?.tokens, context?.limit, paint, frame];
		if (!this.bottom || key.some((value, i) => value !== this.bottom!.key[i])) this.bottom = { key, line: editorBorder(context, hiddenLineCount, width, paint, undefined, frame) };
		return this.bottom.line;
	}
}
