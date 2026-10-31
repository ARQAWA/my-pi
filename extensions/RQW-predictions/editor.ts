// The main input editor: the gray suggestion, Tab, and the keys Ctrl+E and Ctrl+R are handled here and nowhere else.
// The editor instance is decorated in place, so RQW-statusbar keeps its own editor factory.
import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, isKeyRelease, isKeyRepeat, matchesKey, renderFakeCursor, visibleWidth, wrapTextWithAnsi, type TUI } from "@earendil-works/pi-tui";

const WIDGET_KEY = "rqw-predictions-editor-access";

export type EditorActions = {
	generate(): void;
	cancel(): void;
	/** The ready suggestion, if any. */
	suggestion(): string | undefined;
	/** False when the keys could not be freed from Pi's own actions: then they stay stock. */
	hotkeys(): boolean;
};

type FocusTUI = TUI & { getFocusedComponent(): unknown };
type Input = (data: string) => void;
type Render = (width: number) => string[];
type EditorShape = { getPaddingX(): number; insertTextAtCursor(text: string): void };
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const firstGrapheme = (line: string) => [...graphemes.segment(line)][0]?.segment ?? "";
type Decoration = { editor: CustomEditor; release(): void };

export function installEditor(actions: EditorActions) {
	let tui: FocusTUI | undefined;
	let unsubscribe: (() => void) | undefined;
	let decorations: Decoration[] = [];
	let session: ExtensionContext | undefined;
	// The suggestion as the last render drew it: Tab takes only what was really shown.
	let shown: string | undefined;
	let cached: { text: string; width: number; padding: number; marker: string; paint: string; rows: string[] } | undefined;
	// Pi's own submit handler: every editor of the main chat, default or replaced, carries this exact function.
	let mainSubmit: unknown;

	/** The suggestion to show in this editor now, or undefined. */
	function visible(editor: CustomEditor): string | undefined {
		const text = actions.suggestion();
		if (!text || !session || editor.getText() !== "") return undefined;
		if (!session.isIdle() || session.hasPendingMessages() || editor.isShowingAutocomplete()) return undefined;
		return tui?.getFocusedComponent() === editor ? text : undefined;
	}

	/** The gray body rows, built once and rebuilt only when the text, the width, the cursor marker or the theme change. */
	function grayRows(text: string, width: number, padding: number, marker: string): string[] {
		const paint = session!.ui.theme.fg("dim", "x");
		if (cached && cached.text === text && cached.width === width && cached.padding === padding && cached.marker === marker && cached.paint === paint) return cached.rows;
		const contentWidth = Math.max(1, width - padding * 2);
		const room = Math.max(1, contentWidth - (padding ? 0 : 1));
		const margin = " ".repeat(padding);
		// Wrapped like the editor wraps its own text.
		const lines = text.split("\n").flatMap(line => line === "" ? [""] : wrapTextWithAnsi(line, room));
		const rows = lines.map((line, index) => {
			const first = index === 0 ? firstGrapheme(line) : "";
			const display = index === 0 ? marker + renderFakeCursor(first || " ") + gray(line.slice(first.length)) : gray(line);
			const fill = " ".repeat(Math.max(0, contentWidth - Math.max(visibleWidth(line), 1)));
			return `${margin}${display}${fill}${margin}`;
		});
		cached = { text, width, padding, marker, paint, rows };
		return rows;
	}

	/** The empty editor's three rows with the middle one replaced; any other shape stays stock. */
	function withSuggestion(editor: CustomEditor, rows: string[], width: number): string[] {
		shown = undefined;
		const text = visible(editor);
		if (!text || rows.length !== 3) return rows;
		const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
		const padding = Math.min((editor as unknown as EditorShape).getPaddingX(), maxPadding);
		const marker = editor.focused && rows[1].includes(CURSOR_MARKER) ? CURSOR_MARKER : "";
		shown = text;
		return [rows[0], ...grayRows(text, width, padding, marker), rows[2]];
	}

	const gray = (line: string) => line === "" || !session ? line : session.ui.theme.fg("dim", line);

	function decorate(editor: CustomEditor) {
		const slot = editor as unknown as { handleInput: Input };
		const renderSlot = editor as unknown as { render: Render };
		const own = Object.getOwnPropertyDescriptor(editor, "handleInput");
		const ownRender = Object.getOwnPropertyDescriptor(editor, "render");
		const base = slot.handleInput;
		let active = true;
		const baseRender = renderSlot.render;
		const wrappedRender: Render = function(this: CustomEditor, width) {
			const rows = baseRender.call(this, width);
			return active ? withSuggestion(editor, rows, width) : rows;
		};
		const wrapped: Input = function(this: CustomEditor, data) {
			if (active && matchesKey(data, "tab") && !isKeyRelease(data)) {
				const text = visible(editor);
				// Only the suggestion on screen is taken, as one undoable insert; nothing is sent.
				if (text && text === shown) {
					(editor as unknown as EditorShape).insertTextAtCursor(text);
					return;
				}
			}
			if (active && actions.hotkeys() && !editor.isShowingAutocomplete()) {
				const generate = matchesKey(data, "ctrl+e");
				if (generate || matchesKey(data, "ctrl+r")) {
					// A key release or a held key repeat is swallowed: one press is one action.
					if (!isKeyRelease(data) && !isKeyRepeat(data)) (generate ? actions.generate : actions.cancel)();
					return;
				}
			}
			base.call(this, data);
		};
		slot.handleInput = wrapped;
		renderSlot.render = wrappedRender;
		decorations.push({
			editor,
			release() {
				active = false;
				// A later wrapper from another extension stays; our layer in it just passes through.
				if (slot.handleInput === wrapped) {
					if (own) Object.defineProperty(editor, "handleInput", own);
					else delete (slot as { handleInput?: Input }).handleInput;
				}
				if (renderSlot.render === wrappedRender) {
					if (ownRender) Object.defineProperty(editor, "render", ownRender);
					else delete (renderSlot as { render?: Render }).render;
				}
			},
		});
	}

	/** Pi's own wiring on its main editor: the submit handler, Ctrl+D and the app actions. A dialog's editor has none of it. */
	const hasPiWiring = (editor: CustomEditor) =>
		typeof editor.onSubmit === "function" && typeof editor.onCtrlD === "function" && editor.actionHandlers.has("app.clear");

	/**
	 * Decorates the focused editor once, only when it is the main chat's. The first focused editor with Pi's wiring
	 * fixes Pi's submit handler (the focus may sit on the reload box at the start, so this can come later); a replaced
	 * main editor carries the same handler. An editor without that wiring is never taken.
	 */
	function attach() {
		const focused = tui?.getFocusedComponent();
		if (!(focused instanceof CustomEditor)) return;
		if (mainSubmit === undefined && hasPiWiring(focused)) mainSubmit = focused.onSubmit;
		if (mainSubmit === undefined || focused.onSubmit !== mainSubmit) return;
		if (!decorations.some(item => item.editor === focused)) decorate(focused);
	}

	return {
		start(ctx: ExtensionContext) {
			if (ctx.mode !== "tui") return;
			session = ctx;
			// A transient zero-row widget exposes the public TUI; removing it leaves no layout change.
			ctx.ui.setWidget(WIDGET_KEY, current => {
				tui = current as FocusTUI;
				return { render: () => [], invalidate() {} };
			});
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			mainSubmit = undefined;
			attach();
			// Attach only: the actions run in the decorated editor, never here.
			unsubscribe = ctx.ui.onTerminalInput(() => { attach(); return undefined; });
		},
		stop() {
			unsubscribe?.();
			unsubscribe = undefined;
			for (const item of decorations) item.release();
			decorations = [];
			tui = undefined;
			session = undefined;
			shown = undefined;
			cached = undefined;
			mainSubmit = undefined;
		},
		/** The suggestion changed: draw the editor again. */
		refresh() {
			tui?.requestRender();
		},
	};
}
