// RQW-scroll: in Pi's fullscreen (alt-screen) view, Escape returns a scrolled-up transcript to the latest message.
// Everywhere else Escape keeps Pi's own meaning. Decision and limits: DECISIONS.md section Scroll.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getKeybindings, isKeyRelease, matchesKey, type TUI } from "@earendil-works/pi-tui";

const WIDGET = "rqw-scroll";
/** Escape presses this close are one turn-control gesture (RQW-send-now). */
const GESTURE_MS = 500;

// The live renderer as seen through Pi's TUI proxy; the fullscreen members exist only on TuiAltScreen.
type Renderer = TUI & { isFollowingOutput?: boolean; scrollToBottom?(): void; getFocusedComponent(): unknown };
type Focused = { actionHandlers?: unknown; isShowingAutocomplete?(): boolean };

/** True when Escape should jump to the latest message instead of reaching Pi. */
function shouldJump(tui: Renderer | undefined, idle: boolean): boolean {
	// While a turn or background work runs Escape belongs to turn control. Jumping is for the idle chat.
	if (!idle) return false;
	// Only the fullscreen renderer scrolls; there "not following" is exactly when Pi shows "Jump to latest message".
	if (!tui || tui.mode !== "fullscreen" || tui.isFollowingOutput !== false || typeof tui.scrollToBottom !== "function") return false;
	// Only where Escape would reach Pi's app-level handler: the main editor, a CustomEditor (Pi detects it the same
	// way, by its actionHandlers map). Selectors, dialogs and overlays hold focus themselves and keep their Escape;
	// an open autocomplete list keeps its Escape too.
	const focused = tui.getFocusedComponent() as Focused | null;
	if (!focused || !(focused.actionHandlers instanceof Map)) return false;
	return focused.isShowingAutocomplete?.() !== true;
}

type CountsSource = { version: number; snapshot(): { agents?: number; backgroundProcesses?: number } };

export default function scroll(pi: ExtensionAPI) {
	let dispose: (() => void) | undefined;
	// Running background work, from the counts offers of RQW-agent and RQW-tools; an ended source reports zero.
	const sources = new Set<CountsSource>();
	const adopt = (source: CountsSource) => {
		if (source?.version === 1 && typeof source.snapshot === "function") sources.add(source);
	};
	const background = () => [...sources].some((source) => { const counts = source.snapshot(); return (counts.agents ?? 0) > 0 || (counts.backgroundProcesses ?? 0) > 0; });
	/** Escape is turn control while the turn or any background work runs; jumping is for the idle chat. */
	const idle = (ctx: ExtensionContext) => ctx.isIdle() && !background();
	pi.events?.on("rqw:running-counts:offer", (offer: any) => adopt(offer?.source));

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
				return active && id === "tui.altScreen.bottom" && shouldJump(tui, idle(ctx)) ? ["esc", ...keys.filter((k) => k !== "esc" && k !== "escape")] : keys;
			};
			Object.defineProperty(manager, "getKeys", { value: display, writable: true, configurable: true });
			releaseDisplay = () => { active = false; unlink(); };
		} catch {
			// An incompatible manager keeps Pi's stock display.
		}
		// Pi's viewport listener runs first and keeps its own keys (search close, Ctrl+End, paging).
		let gestureUntil = 0;
		const off = ui.onTerminalInput((data) => {
			if (!matchesKey(data, "escape") || isKeyRelease(data)) return undefined;
			// A press that finds work, and any press within 500 ms after it, is a turn-control gesture even if the work ended since.
			const now = Date.now();
			if (!idle(ctx)) {
				gestureUntil = now + GESTURE_MS;
				return undefined;
			}
			if (now < gestureUntil) return undefined;
			if (!shouldJump(tui, true)) return undefined;
			tui!.scrollToBottom!();
			return { consume: true };
		});
		dispose = () => {
			releaseDisplay();
			off();
			ui.setWidget(WIDGET, undefined);
		};
	}

	pi.on("session_start", (_event, ctx) => {
		sources.clear();
		pi.events?.emit("rqw:running-counts:request", { version: 1, reply: adopt });
		install(ctx);
	});
	pi.on("session_shutdown", () => {
		sources.clear();
		dispose?.();
		dispose = undefined;
	});
}
