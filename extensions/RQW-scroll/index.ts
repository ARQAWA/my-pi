// RQW-scroll: in Pi's fullscreen (alt-screen) view, Escape returns a scrolled-up transcript to the latest message.
// Everywhere else Escape keeps Pi's own meaning. Decision and limits: DECISIONS.md section Scroll.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getKeybindings, isKeyRelease, matchesKey, type TUI } from "@earendil-works/pi-tui";

const WIDGET = "rqw-scroll";

// The live renderer as seen through Pi's TUI proxy; the fullscreen members exist only on TuiAltScreen.
type Renderer = TUI & { isFollowingOutput?: boolean; scrollToBottom?(): void; getFocusedComponent(): unknown };
type Focused = { actionHandlers?: unknown; isShowingAutocomplete?(): boolean };

/** True when Escape should jump to the latest message instead of reaching Pi. */
function shouldJump(tui: Renderer | undefined): boolean {
	// Only the fullscreen renderer scrolls; there "not following" is exactly when Pi shows "Jump to latest message".
	if (!tui || tui.mode !== "fullscreen" || tui.isFollowingOutput !== false || typeof tui.scrollToBottom !== "function") return false;
	// Only where Escape would reach Pi's app-level handler: the main editor, a CustomEditor (Pi detects it the same
	// way, by its actionHandlers map). Selectors, dialogs and overlays hold focus themselves and keep their Escape;
	// an open autocomplete list keeps its Escape too.
	const focused = tui.getFocusedComponent() as Focused | null;
	if (!focused || !(focused.actionHandlers instanceof Map)) return false;
	return focused.isShowingAutocomplete?.() !== true;
}

export default function scroll(pi: ExtensionAPI) {
	let dispose: (() => void) | undefined;

	function install(ctx: ExtensionContext) {
		dispose?.();
		dispose = undefined;
		if (ctx.mode !== "tui") return;
		const ui = ctx.ui;
		let tui: Renderer | undefined;
		// A widget factory is the public way to reach Pi's TUI; the widget itself renders nothing.
		ui.setWidget(WIDGET, (t) => {
			tui = t as Renderer;
			return { render: () => [], invalidate() {} };
		}, { placement: "belowEditor" });
		// Pi also retains the manager for input, so decorate its display lookup in place.
		const manager = getKeybindings();
		let releaseDisplay = () => {};
		try {
			if (typeof manager.getKeys !== "function" || !Array.isArray(manager.getKeys("tui.altScreen.bottom"))) throw new Error("incompatible keybindings");
			// The check may have unlinked a released layer that had just returned to the top.
			const base = manager.getKeys;
			const own = Object.getOwnPropertyDescriptor(manager, "getKeys");
			let active = true;
			const unlink = () => {
				if (manager.getKeys !== display) return;
				if (own) Object.defineProperty(manager, "getKeys", own);
				else delete (manager as { getKeys?: typeof base }).getKeys;
			};
			const display: typeof base = function(id) {
				if (!active) unlink();
				const keys = base.call(this, id);
				return active && id === "tui.altScreen.bottom" && shouldJump(tui) ? ["esc", ...keys.filter((k) => k !== "esc" && k !== "escape")] : keys;
			};
			Object.defineProperty(manager, "getKeys", { value: display, writable: true, configurable: true });
			releaseDisplay = () => { active = false; unlink(); };
		} catch {
			// An incompatible manager keeps Pi's stock display.
		}
		// Pi's viewport listener runs first and keeps its own keys (search close, Ctrl+End, paging).
		const off = ui.onTerminalInput((data) => {
			if (!matchesKey(data, "escape") || isKeyRelease(data) || !shouldJump(tui)) return undefined;
			tui!.scrollToBottom!();
			return { consume: true };
		});
		dispose = () => {
			releaseDisplay();
			off();
			ui.setWidget(WIDGET, undefined);
		};
	}

	pi.on("session_start", (_event, ctx) => install(ctx));
	pi.on("session_shutdown", () => {
		dispose?.();
		dispose = undefined;
	});
}
