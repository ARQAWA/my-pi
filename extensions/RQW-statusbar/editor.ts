// Pi's editor with the session ID at the right end of its top border and the context row as its bottom border.
// Everything else is stock `CustomEditor`.
import { stripVTControlCharacters } from "node:util";
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

export type NativeActivity = { text: string; retry: boolean };
type Indicator = NonNullable<Parameters<CustomEditor["setWorkingStatusIndicator"]>[0]>;

function nativeText(text: string, kind: string): string | undefined {
	const plain = stripVTControlCharacters(text);
	const match = kind === "retry"
		? plain.match(/Retrying \((\d+)\/(\d+)\) in (\d+)s\.\.\. \((.+?) to cancel\)/)
		: plain.match(/Summarizing branch\.\.\. \((.+?) to cancel\)/);
	if (!match) return undefined;
	return kind === "retry" ? `Retrying ${match[1]}/${match[2]} in ${match[3]}s · ${match[4]} to cancel`
		: `Summarizing branch · ${match[1]} to cancel`;
}

export class ContextEditor extends CustomEditor {
	private readonly source: () => BorderSource | undefined;
	private readonly activityChanged: (activity: NativeActivity | undefined) => void;
	private restoreIndicator?: () => void;
	private stockIndicator = false;
	private top?: { key: unknown[]; line: string };
	private bottom?: { key: unknown[]; line: string };

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, source: () => BorderSource | undefined,
		activityChanged: (activity: NativeActivity | undefined) => void = () => {}) {
		// Keep Pi's status out of its separate row; our top border replaces the embedded indicator.
		super(tui, theme, keybindings, { embedWorkingStatus: true });
		this.source = source;
		this.activityChanged = activityChanged;
	}

	/** Restore the indicator's own method when it changes or this extension is disabled. */
	releaseIndicator(): void {
		this.restoreIndicator?.();
		this.restoreIndicator = undefined;
		this.stockIndicator = false;
		this.activityChanged(undefined);
	}

	override setWorkingStatusIndicator(indicator: Indicator | undefined): void {
		this.releaseIndicator();
		super.setWorkingStatusIndicator(indicator);
		if (!indicator || (indicator.kind !== "retry" && indicator.kind !== "branchSummary")) return;
		let text: string | undefined;
		try { text = nativeText(indicator.renderInBorder(1000), indicator.kind); } catch {}
		if (!text || typeof indicator.dispose !== "function" || (indicator.kind === "retry" && typeof indicator.setMessage !== "function")) {
			this.stockIndicator = true;
			return;
		}
		if (indicator.kind === "retry") {
			const original = indicator.setMessage;
			const descriptor = Object.getOwnPropertyDescriptor(indicator, "setMessage");
			try {
				const patched = (message: string) => {
					original.call(indicator, message);
					const next = nativeText(message, "retry");
					if (next) this.activityChanged({ text: next, retry: true });
					else { this.stockIndicator = true; this.activityChanged(undefined); }
				};
				indicator.setMessage = patched;
				this.restoreIndicator = () => {
					if (indicator.setMessage !== patched) return;
					if (descriptor) Object.defineProperty(indicator, "setMessage", descriptor);
					else delete (indicator as { setMessage?: Indicator["setMessage"] }).setMessage;
				};
			} catch { this.stockIndicator = true; return; }
		}
		const originalDispose = indicator.dispose;
		const descriptor = Object.getOwnPropertyDescriptor(indicator, "dispose");
		const restoreMessage = this.restoreIndicator;
		try {
			const patchedDispose = () => {
				try { originalDispose.call(indicator); }
				finally { this.releaseIndicator(); }
			};
			indicator.dispose = patchedDispose;
			this.restoreIndicator = () => {
				restoreMessage?.();
				if (indicator.dispose !== patchedDispose) return;
				if (descriptor) Object.defineProperty(indicator, "dispose", descriptor);
				else delete (indicator as { dispose?: Indicator["dispose"] }).dispose;
			};
		} catch {
			restoreMessage?.();
			this.restoreIndicator = undefined;
			this.stockIndicator = true;
			return;
		}
		this.activityChanged({ text, retry: indicator.kind === "retry" });
	}

	/** With a source the top border is ours (rule, title, hint, ID); otherwise Pi draws its plain border. */
	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		const source = this.source();
		if (!source || this.stockIndicator) return super.renderTopBorder(width, hiddenLineCount);
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
