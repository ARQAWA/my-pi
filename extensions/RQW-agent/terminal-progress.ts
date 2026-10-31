import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeSync } from "node:fs";
import { formatProgramStatus, ProcessTerminal, type ProgramStatus } from "@earendil-works/pi-tui";
import type { RealFinal } from "./real-final.ts";

const KEY = "terminal-progress";
const STATUS_KEY = "terminal-program-status";
type Method = (this: unknown, ...args: any[]) => unknown;

/**
 * Holds OSC 9;4 and OSC 7501 until the real final; returns the undo.
 * Pi calls `setProgress` only with `terminal.showTerminalProgress`.
 */
function patch(realFinal: RealFinal): (() => void) | undefined {
	const proto = ProcessTerminal?.prototype as unknown as object | undefined;
	if (!proto || !Object.isExtensible(proto)) return undefined;
	const setOwn = Object.getOwnPropertyDescriptor(proto, "setProgress");
	const startOwn = Object.getOwnPropertyDescriptor(proto, "start");
	const statusOwn = Object.getOwnPropertyDescriptor(proto, "setProgramStatus");
	if (typeof setOwn?.value !== "function" || typeof startOwn?.value !== "function" || typeof statusOwn?.value !== "function" || !setOwn.configurable || !startOwn.configurable || !statusOwn.configurable) return undefined;
	const setProgress = setOwn.value as Method;
	const setStatus = statusOwn.value as Method;
	const start = startOwn.value as Method;
	let active = true;
	let pending: { terminal: { programStatusSupported?: boolean }; status: ProgramStatus } | undefined;
	const onExit = () => {
		if (!pending || !realFinal.deferred(STATUS_KEY) || !pending.terminal.programStatusSupported) return;
		try { writeSync(process.stdout.fd, formatProgramStatus(pending.status)); } catch { /* Terminal already gone. */ }
	};
	process.on("exit", onExit);
	const patchedSetProgress: Method = function (this: unknown, on: boolean) {
		if (!active) return setProgress.call(this, on);
		// "On" cancels a deferred "off". "Off" waits for the real final; Pi's own keepalive keeps writing "on" meanwhile.
		if (on) { realFinal.drop(KEY); return setProgress.call(this, true); }
		realFinal.defer(KEY, () => setProgress.call(this, false));
	};
	const patchedStatus: Method = function (this: { programStatus?: ProgramStatus; programStatusSupported?: boolean }, status: ProgramStatus) {
		if (!active) return setStatus.call(this, status);
		if (status.state === "working" || status.state === "blocked" || status.state === "clear") {
			pending = undefined;
			realFinal.drop(STATUS_KEY);
			return setStatus.call(this, status);
		}
		if (realFinal.held() && this.programStatus?.state !== "working") {
			setStatus.call(this, { state: "working", app: status.app, message: status.message });
		}
		pending = { terminal: this, status };
		realFinal.defer(STATUS_KEY, () => { pending = undefined; return setStatus.call(this, status); });
	};
	const patchedStart: Method = function (this: unknown, ...args: unknown[]) {
		const result = start.apply(this, args);
		// A screen mode switch runs stop(), which cleared the progress; Pi restores it only during a turn.
		if (active && realFinal.deferred(KEY)) setProgress.call(this, true);
		return result;
	};
	Object.defineProperty(proto, "setProgress", { ...setOwn, value: patchedSetProgress });
	Object.defineProperty(proto, "setProgramStatus", { ...statusOwn, value: patchedStatus });
	Object.defineProperty(proto, "start", { ...startOwn, value: patchedStart });
	return () => {
		active = false;
		process.off("exit", onExit);
		// Something else wrapped on top of this one: leave it in place, the wrapper is inert now.
		if (Object.getOwnPropertyDescriptor(proto, "setProgress")?.value === patchedSetProgress) Object.defineProperty(proto, "setProgress", setOwn);
		if (Object.getOwnPropertyDescriptor(proto, "setProgramStatus")?.value === patchedStatus) Object.defineProperty(proto, "setProgramStatus", statusOwn);
		if (Object.getOwnPropertyDescriptor(proto, "start")?.value === patchedStart) Object.defineProperty(proto, "start", startOwn);
	};
}

/** Terminal busy indicators stay on until the real final. Another shape of Pi's terminal: stock behaviour. */
export function registerTerminalProgressHold(pi: ExtensionAPI, realFinal: RealFinal) {
	let restore: (() => void) | undefined;
	pi.on("session_start", (_event, ctx) => {
		restore?.(); restore = undefined;
		if (ctx.mode === "tui") restore = patch(realFinal);
	});
	// The gate's own shutdown handler runs first and sends the deferred "off".
	pi.on("session_shutdown", () => { restore?.(); restore = undefined; });
}
