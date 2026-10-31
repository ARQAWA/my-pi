// The main input editor: the gray suggestion, the gray piece, Tab, and the keys Ctrl+E and Ctrl+R are handled here and nowhere else.
// The editor instance is decorated in place, so RQW-statusbar keeps its own editor factory.
import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, isKeyRelease, isKeyRepeat, matchesKey, renderFakeCursor, visibleWidth, wrapTextWithAnsi, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { draftKey, draftOf, type Draft } from "./context.ts";
import type { Piece } from "./controller.ts";

const WIDGET_KEY = "rqw-predictions-editor-access";

export type EditorActions = {
	generate(): void;
	cancel(): void;
	/** The ready suggestion, if any. */
	suggestion(): string | undefined;
	/** The piece for the draft at the cursor, if any. */
	piece(): Piece | undefined;
	/** Ctrl+E on a non-empty input: a piece for the draft at the cursor. */
	continueDraft(draft: Draft): void;
	/** A piece was taken: the next one for the new draft. */
	chain(draft: Draft): void;
	/** The draft key of the editor now, read only when a piece or its request is waiting. */
	moved(key: () => string): void;
	/** False when the keys could not be freed from Pi's own actions: then they stay stock. */
	hotkeys(): boolean;
};

type FocusTUI = TUI & { getFocusedComponent(): unknown };
type Input = (data: string) => void;
type Mouse = (event: TuiMouseEvent) => TuiMouseEventResult | undefined;
type Render = (width: number) => string[];
type EditorShape = { getPaddingX(): number; insertTextAtCursor(text: string): void };
type LayoutRow = { text: string; hasCursor: boolean; cursorPos?: number };
/** The private parts of Pi's editor the piece drawing reads; `hasTextShape` checks them. */
type EditorInternals = {
	state: { lines: string[]; cursorLine: number; cursorCol: number };
	layoutText(width: number): LayoutRow[];
	lastWidth: number;
	scrollOffset: number;
	renderedVisibleLineCount: number;
	expandPasteMarkers(text: string): string;
};
/** The piece's part of one layout row: columns `from` to `to` of `text`; `cursor` marks the row the piece starts on. */
type Span = { row: number; text: string; from: number; to: number; cursor: boolean };

function hasTextShape(editor: CustomEditor): boolean {
	const { state, layoutText, expandPasteMarkers, lastWidth, scrollOffset, renderedVisibleLineCount } = editor as unknown as EditorInternals;
	return Array.isArray(state?.lines) && state.lines.every(line => typeof line === "string")
		&& Number.isInteger(state.cursorLine) && Number.isInteger(state.cursorCol)
		&& typeof layoutText === "function" && typeof expandPasteMarkers === "function"
		&& [lastWidth, scrollOffset, renderedVisibleLineCount].every(value => typeof value === "number");
}

/**
 * Where the piece, put into the cursor's line, falls in the layout rows of that line. Row texts are exact slices of
 * the line, apart from the spaces Pi drops where it wraps; undefined when they are not.
 */
function spansOf(layout: LayoutRow[], line: string, col: number, length: number): Span[] | undefined {
	const first = layout.findIndex(row => row.hasCursor);
	const cursorPos = layout[first]?.cursorPos;
	if (cursorPos === undefined) return undefined;
	const end = col + length;
	const spans: Span[] = [];
	let position = col - cursorPos;
	for (let row = first; row < layout.length; row++) {
		// Past the piece, or past the line's own text, the rows belong to the next logical line.
		if (row > first && (position >= end || /^\s*$/.test(line.slice(position)))) break;
		const { text } = layout[row];
		const start = row === first ? position : line.indexOf(text, position);
		if (start < 0 || line.slice(start, start + text.length) !== text || !/^\s*$/.test(line.slice(position, start))) return undefined;
		if (start >= end) break;
		const from = Math.max(col, start) - start;
		const to = Math.min(end, start + text.length) - start;
		if (to > from) spans.push({ row, text, from, to, cursor: row === first });
		position = start + text.length;
	}
	return spans;
}

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
	// The piece as the last render drew it: Tab takes only what was really shown.
	let shownPiece: string | undefined;
	let pieceCached: { key: string; rows: string[] } | undefined;
	let cached: { text: string; width: number; padding: number; marker: string; paint: string; rows: string[] } | undefined;
	// False for good once the private parts of Pi's editor are not as the piece drawing expects.
	let textShape = true;
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

	/** The piece to show in this editor now: its draft is exactly what the editor holds, and the same screen rules as the suggestion. */
	function visiblePiece(editor: CustomEditor): string | undefined {
		const piece = actions.piece();
		const text = editor.getText();
		if (!piece || !session || text === "" || piece.key !== draftKey(text, editor.getCursor())) return undefined;
		if (!session.isIdle() || session.hasPendingMessages() || editor.isShowingAutocomplete()) return undefined;
		return tui?.getFocusedComponent() === editor ? piece.text : undefined;
	}

	const keyNow = (editor: CustomEditor) => draftKey(editor.getText(), editor.getCursor());
	const draftNow = (editor: CustomEditor): Draft =>
		draftOf(editor.getText(), editor.getCursor(), text => (editor as unknown as EditorInternals).expandPasteMarkers(text));

	/** One body row: the text, the piece in gray from `from` to `to`, and the fill. The cursor sits on the piece's first grapheme. */
	function paintRow(span: Span, marker: string, padding: number, contentWidth: number): string {
		const before = span.text.slice(0, span.from);
		const piece = span.text.slice(span.from, span.to);
		const after = span.text.slice(span.to);
		const first = span.cursor ? firstGrapheme(piece) : "";
		const body = span.cursor ? marker + renderFakeCursor(first) + gray(piece.slice(first.length)) : gray(piece);
		const fill = " ".repeat(Math.max(0, contentWidth - visibleWidth(span.text)));
		const margin = " ".repeat(padding);
		return `${margin}${before}${body}${after}${fill}${margin}`;
	}

	/**
	 * The stock render of the editor with the piece put into the cursor's line for this one call, so Pi wraps, scrolls
	 * and places the cursor as it will after Tab. The rows holding the piece are then painted again. Undefined, with the
	 * editor's own text restored, when the frame does not look as expected.
	 */
	function renderWithPiece(editor: CustomEditor, render: Render, piece: string, width: number): string[] | undefined {
		const internals = editor as unknown as EditorInternals;
		const { state } = internals;
		const lines = state.lines;
		const line = lines[state.cursorLine] ?? "";
		const virtual = [...lines];
		virtual[state.cursorLine] = line.slice(0, state.cursorCol) + piece + line.slice(state.cursorCol);
		state.lines = virtual;
		try {
			const rows = render.call(editor, width);
			const count = internals.renderedVisibleLineCount;
			if (rows.length !== count + 2) {
				textShape = false;
				session?.ui.notify("RQW-predictions: this editor draws extra rows, so pieces of text are not shown.", "warning");
				return undefined;
			}
			const all = spansOf(internals.layoutText(internals.lastWidth), virtual[state.cursorLine], state.cursorCol, piece.length);
			if (!all) return undefined;
			// Row 0 is the top border; rows above the scroll offset or below the window are not drawn.
			const spans = all.map(span => ({ ...span, row: span.row - internals.scrollOffset + 1 })).filter(span => span.row >= 1 && span.row <= count);
			const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
			const padding = Math.min((editor as unknown as EditorShape).getPaddingX(), maxPadding);
			const marker = spans.some(span => span.cursor && rows[span.row].includes(CURSOR_MARKER)) ? CURSOR_MARKER : "";
			const key = JSON.stringify([session!.ui.theme.fg("dim", "x"), padding, width, marker, spans]);
			if (pieceCached?.key !== key) {
				const contentWidth = Math.max(1, width - padding * 2);
				pieceCached = { key, rows: spans.map(span => paintRow(span, marker, padding, contentWidth)) };
			}
			spans.forEach((span, index) => { rows[span.row] = pieceCached!.rows[index]; });
			// A piece with rows below the window is not whole on screen: Tab must not take what cannot be seen.
			if (spans.length === all.length) shownPiece = piece;
			return rows;
		} finally {
			state.lines = lines;
		}
	}

	function decorate(editor: CustomEditor) {
		const slot = editor as unknown as { handleInput: Input };
		const renderSlot = editor as unknown as { render: Render };
		const own = Object.getOwnPropertyDescriptor(editor, "handleInput");
		const ownRender = Object.getOwnPropertyDescriptor(editor, "render");
		const base = slot.handleInput;
		const mouseSlot = editor as unknown as { handleMouse: Mouse };
		const ownMouse = Object.getOwnPropertyDescriptor(editor, "handleMouse");
		const baseMouse = mouseSlot.handleMouse;
		let active = true;
		const baseRender = renderSlot.render;
		if (!hasTextShape(editor)) {
			textShape = false;
			session?.ui.notify("RQW-predictions: this editor has an unknown shape, so pieces of text are not shown.", "warning");
		}
		const wrappedRender: Render = function(this: CustomEditor, width) {
			// Text or cursor changed behind the keys, as by Pi's own setText: the piece goes, from outside this frame.
			if (active) queueMicrotask(() => actions.moved(() => keyNow(editor)));
			shownPiece = undefined;
			const piece = active && textShape ? visiblePiece(editor) : undefined;
			const drawn = piece === undefined ? undefined : renderWithPiece(editor, baseRender, piece, width);
			if (drawn) return drawn;
			const rows = baseRender.call(this, width);
			return active ? withSuggestion(editor, rows, width) : rows;
		};
		const wrapped: Input = function(this: CustomEditor, data) {
			if (active && matchesKey(data, "tab") && !isKeyRelease(data)) {
				const taken = shownPiece;
				// Only the piece on screen is taken, as one undoable insert; the next piece is asked at once.
				if (taken !== undefined && taken === visiblePiece(editor)) {
					(editor as unknown as EditorShape).insertTextAtCursor(taken);
					shownPiece = undefined;
					actions.chain(draftNow(editor));
					return;
				}
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
					if (!isKeyRelease(data) && !isKeyRepeat(data)) {
						// With text in the input Ctrl+E asks for a piece at the cursor; an empty input asks for a suggestion.
						if (generate && textShape && editor.getText() !== "") actions.continueDraft(draftNow(editor));
						else (generate ? actions.generate : actions.cancel)();
					}
					return;
				}
			}
			base.call(this, data);
			// Every other key, typing or cursor moves, is checked by its effect, not by its name.
			if (active) actions.moved(() => keyNow(editor));
		};
		const wrappedMouse: Mouse = function(this: CustomEditor, event) {
			const result = baseMouse.call(this, event);
			if (active) actions.moved(() => keyNow(editor));
			return result;
		};
		slot.handleInput = wrapped;
		renderSlot.render = wrappedRender;
		if (typeof baseMouse === "function") mouseSlot.handleMouse = wrappedMouse;
		decorations.push({
			editor,
			release() {
				active = false;
				// A later wrapper from another extension stays; our layer in it just passes through.
				if (slot.handleInput === wrapped) {
					if (own) Object.defineProperty(editor, "handleInput", own);
					else delete (slot as { handleInput?: Input }).handleInput;
				}
				if (mouseSlot.handleMouse === wrappedMouse) {
					if (ownMouse) Object.defineProperty(editor, "handleMouse", ownMouse);
					else delete (mouseSlot as { handleMouse?: Mouse }).handleMouse;
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
			shownPiece = undefined;
			pieceCached = undefined;
			cached = undefined;
			textShape = true;
			mainSubmit = undefined;
		},
		/** The suggestion changed: draw the editor again. */
		refresh() {
			tui?.requestRender();
		},
	};
}
