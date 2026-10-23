// Pi's editor with the session ID at the right end of its top border and the context row as its bottom border.
// Everything else is stock `CustomEditor`.
import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { type ActivityChrome, type BarState, editorBorder, type Paint, topBorder } from "./render.ts";

/** What the borders show; undefined while the bar is off or its session is gone, then the stock borders are drawn. */
export interface BorderSource {
	context(): BarState["context"];
	sessionId(): string | undefined;
	paint(): Paint;
	/** The activity status for the top border and the compaction sheen; undefined when idle (the ordinary chrome). */
	activity?(): ActivityChrome | undefined;
}

export class ContextEditor extends CustomEditor {
	private readonly source: () => BorderSource | undefined;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, source: () => BorderSource | undefined) {
		// Pi's default editor embeds the working status in its top border; with our source that border is ours and the
		// native indicator is not drawn in it (see `renderTopBorder`).
		super(tui, theme, keybindings, { embedWorkingStatus: true });
		this.source = source;
	}

	/** With a source the top border is ours (rule, hint, status, ID); without one Pi's own border, native status included. */
	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		const source = this.source();
		if (!source) return super.renderTopBorder(width, hiddenLineCount);
		return topBorder(width, source.sessionId(), source.activity?.(), hiddenLineCount, source.paint());
	}

	protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
		const source = this.source();
		if (!source) return super.renderBottomBorder(width, hiddenLineCount);
		const activity = source.activity?.();
		return editorBorder(source.context(), hiddenLineCount, width, source.paint(), undefined,
			activity?.compacting ? activity.frame : undefined);
	}
}
