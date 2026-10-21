// RQW-mouse: on Windows, Pi's fullscreen (alt-screen) view enables mouse reporting a second time right after the
// terminal has started. Pi writes the commands before raw mode and Windows VT input are on, and ConPTY loses them, so
// the wheel turns into arrow keys that scroll the input history. Cause, scope, proof and limits: DECISIONS.md section PCLI.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TuiAltScreen } from "@earendil-works/pi-tui";

// The two sets Pi 1.3.0 writes (pi-tui dist/tui-alt-screen.js:16-17), copied verbatim; the test compares them with
// what Pi's own TuiAltScreen writes. Pi's disable-on-stop (DISABLE_MOUSE) is left alone.
const ENABLE_BUTTON_MOTION_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1004h\x1b[?1006h";
const ENABLE_ALL_MOTION_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1004h\x1b[?1006h";

/** The set Pi picks: without any-motion tracking (?1003h) in tmux, Zellij and screen, as at tui-alt-screen.js:184-193. */
function mouseSequence(): string {
	const term = process.env.TERM?.toLowerCase() ?? "";
	const multiplexer = process.env.TMUX !== undefined || process.env.ZELLIJ !== undefined || process.env.STY !== undefined ||
		term.startsWith("tmux") || term.startsWith("screen");
	return multiplexer ? ENABLE_BUTTON_MOTION_MOUSE : ENABLE_ALL_MOTION_MOUSE;
}

type Screen = { mouseEnabled?: unknown; terminal: { write(data: string): void } };
type Hook = (this: Screen) => void;

// Live owners of the process-wide patch: one token per factory run, shared across module reloads. The patch stays on
// TuiAltScreen only while an owner is loaded; after the last owner leaves the prototype is as Pi made it.
const STATE = Symbol.for("rqw-mouse/state");
type State = { owners: Set<object>; restore?: () => void };
const shared = globalThis as { [STATE]?: State };

/** Wraps TuiAltScreen.afterTerminalStart, which stock Pi leaves empty; returns the undo. */
function patch(): () => void {
	const proto = TuiAltScreen.prototype as unknown as { afterTerminalStart?: Hook };
	const own = Object.getOwnPropertyDescriptor(proto, "afterTerminalStart");
	let active = true;
	const patched: Hook = function (this: Screen) {
		// Pi's own hook first: the inherited empty one, or one a newer Pi defines on the class itself.
		const inner = own ? (own.value as Hook) : (Object.getPrototypeOf(proto) as { afterTerminalStart: Hook }).afterTerminalStart;
		inner.call(this);
		// Mouse reporting enabled, as Pi's beforeTerminalStart decides; here raw mode and VT input are on already.
		if (active && this.mouseEnabled) this.terminal.write(mouseSequence());
	};
	Object.defineProperty(proto, "afterTerminalStart", { value: patched, writable: true, configurable: true });
	return () => {
		active = false;
		// Something else wrapped on top of this one: leave it in place, the wrapper is inert now.
		if (Object.getOwnPropertyDescriptor(proto, "afterTerminalStart")?.value !== patched) return;
		if (own) Object.defineProperty(proto, "afterTerminalStart", own);
		else delete proto.afterTerminalStart;
	};
}

export default function mouse(pi: ExtensionAPI) {
	// Only Windows (ConPTY) loses the early commands; elsewhere Pi's own enable works and nothing is changed.
	if (process.platform !== "win32") return;
	const proto = TuiAltScreen?.prototype as unknown as Record<string, unknown> | undefined;
	const base = proto && (Object.getPrototypeOf(proto) as Record<string, unknown> | null);
	if (!proto || typeof proto.beforeTerminalStart !== "function" || typeof base?.afterTerminalStart !== "function" || !Object.isExtensible(proto)) {
		throw new Error("RQW-mouse: TuiAltScreen.beforeTerminalStart or the afterTerminalStart hook not found; the fix is built for Pi 1.3.0, nothing is changed");
	}
	const state = (shared[STATE] ??= { owners: new Set() });
	const token = {};
	state.owners.add(token);
	state.restore ??= patch();
	// Removing only this factory's token keeps the patch for concurrent sessions and for a runtime that replaces this one.
	pi.on("session_shutdown", () => {
		state.owners.delete(token);
		if (state.owners.size > 0) return;
		state.restore?.();
		state.restore = undefined;
	});
}
