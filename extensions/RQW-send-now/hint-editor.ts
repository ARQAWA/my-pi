import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, renderFakeCursor, visibleWidth, type TUI } from "@earendil-works/pi-tui";

type FocusTUI = TUI & { getFocusedComponent(): unknown };
type Render = (width: number) => string[];
type Shape = { getPaddingX(): number };

/** Fallback painter when predictions is disabled. It never changes the editor buffer. */
export function installHintEditor(hint: () => string | undefined, changed: () => void) {
	let tui: FocusTUI | undefined;
	let ctx: ExtensionContext | undefined;
	let submit: unknown;
	let supported = false;
	let unsubscribe: (() => void) | undefined;
	const releases: (() => void)[] = [];
	const editors = new WeakSet<CustomEditor>();
	let cached: { text: string; width: number; padding: number; marker: string; theme: ExtensionContext["ui"]["theme"]; row: string } | undefined;

	function setSupported(value: boolean) {
		if (supported === value) return;
		supported = value;
		changed();
	}
	function attach(replacement?: unknown) {
		const editor = replacement ?? tui?.getFocusedComponent();
		if (!(editor instanceof CustomEditor)) { if (replacement !== undefined) setSupported(false); return; }
		if (submit === undefined && typeof editor.onSubmit === "function" && typeof editor.onCtrlD === "function" && editor.actionHandlers.has("app.clear")) submit = editor.onSubmit;
		if (submit === undefined || editor.onSubmit !== submit) { if (replacement !== undefined) setSupported(false); return; }
		if (editors.has(editor)) { setSupported(true); return; }
		try {
			if (typeof (editor as unknown as Shape).getPaddingX !== "function" || (editor.getText() === "" && editor.render(80).length !== 3)) { setSupported(false); return; }
			decorate(editor);
			setSupported(true);
		} catch { setSupported(false); }
	}
	function decorate(editor: CustomEditor) {
		editors.add(editor);
		const slot = editor as unknown as { render: Render };
		const own = Object.getOwnPropertyDescriptor(editor, "render");
		const original = slot.render;
		let active = true;
		const wrapped: Render = function(this: CustomEditor, width) {
			const rows = original.call(this, width);
			const text = hint();
			if (!active || !text || !ctx || rows.length !== 3 || editor.getText() !== "" || editor.isShowingAutocomplete() || tui?.getFocusedComponent() !== editor) return rows;
			const padding = Math.min((editor as unknown as Shape).getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)));
			if (width - padding * 2 < 3 + visibleWidth(text)) return rows;
			const marker = editor.focused && rows[1].includes(CURSOR_MARKER) ? CURSOR_MARKER : "";
			const theme = ctx.ui.theme;
			if (!cached || cached.text !== text || cached.width !== width || cached.padding !== padding || cached.marker !== marker || cached.theme !== theme) {
				const margin = " ".repeat(padding);
				const fill = " ".repeat(width - padding * 2 - 3 - visibleWidth(text));
				cached = { text, width, padding, marker, theme, row: margin + marker + renderFakeCursor(" ") + "  " + theme.italic(theme.fg("dim", text)) + fill + margin };
			}
			return [rows[0], cached.row, rows[2]];
		};
		slot.render = wrapped;
		releases.push(() => { active = false; if (slot.render === wrapped) { if (own) Object.defineProperty(editor, "render", own); else delete (slot as { render?: Render }).render; } });
	}
	return {
		start(session: ExtensionContext) {
			ctx = session;
			session.ui.setWidget("rqw-send-now-hint", instance => { tui = instance as FocusTUI; return { render: () => [], invalidate() {} }; });
			session.ui.setWidget("rqw-send-now-hint", undefined);
			attach();
			unsubscribe = session.ui.onTerminalInput(() => { attach(); return undefined; });
		},
		attach,
		supported: () => supported,
		refresh() { tui?.requestRender(); },
		stop() { unsubscribe?.(); for (const release of releases.splice(0)) release(); tui = undefined; ctx = undefined; submit = undefined; supported = false; cached = undefined; },
	};
}
