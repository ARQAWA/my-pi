import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ProcessTerminal, type ProgramStatus } from "@earendil-works/pi-tui";
import type { RunningCounts } from "./running-counts.ts";

type Method = (this: any, ...args: any[]) => any;

/** Project native terminal state and running background counts onto the same indicators. */
function patch(counts: RunningCounts): (() => void) | undefined {
	const proto = ProcessTerminal?.prototype;
	if (!proto || !Object.isExtensible(proto)) return undefined;
	const progressOwn = Object.getOwnPropertyDescriptor(proto, "setProgress");
	const statusOwn = Object.getOwnPropertyDescriptor(proto, "setProgramStatus");
	const startOwn = Object.getOwnPropertyDescriptor(proto, "start");
	if (![progressOwn, statusOwn, startOwn].every(item => typeof item?.value === "function" && item.configurable)) return undefined;
	const progress = progressOwn!.value as Method, status = statusOwn!.value as Method, start = startOwn!.value as Method;
	const terminals = new Map<any, { progress?: boolean; status?: ProgramStatus }>();
	let active = true;
	const state = (terminal: any) => {
		let value = terminals.get(terminal);
		if (!value) { value = {}; terminals.set(terminal, value); }
		return value;
	};
	const showStatus = (terminal: any, value: ProgramStatus) => {
		if (counts.running() && value.state !== "working" && value.state !== "blocked" && value.state !== "clear") return status.call(terminal, { ...value, state: "working" });
		return status.call(terminal, value);
	};
	const patchedProgress: Method = function(on: boolean) {
		if (!active) return progress.call(this, on);
		state(this).progress = on;
		return progress.call(this, on || counts.running());
	};
	const patchedStatus: Method = function(value: ProgramStatus) {
		if (!active) return status.call(this, value);
		state(this).status = value;
		return showStatus(this, value);
	};
	const patchedStart: Method = function(...args: unknown[]) {
		const result = start.apply(this, args);
		if (active && counts.running() && state(this).progress === false) progress.call(this, true);
		return result;
	};
	Object.defineProperty(proto, "setProgress", { ...progressOwn!, value: patchedProgress });
	Object.defineProperty(proto, "setProgramStatus", { ...statusOwn!, value: patchedStatus });
	Object.defineProperty(proto, "start", { ...startOwn!, value: patchedStart });
	const stop = counts.subscribe(() => {
		for (const [terminal, value] of terminals) {
			if (value.progress !== undefined) progress.call(terminal, value.progress || counts.running());
			if (value.status && value.status.state !== "clear") showStatus(terminal, value.status);
		}
	});
	return () => {
		active = false; stop();
		for (const [terminal, value] of terminals) {
			if (value.progress !== undefined) progress.call(terminal, value.progress);
			if (value.status && value.status.state !== "clear") status.call(terminal, value.status);
		}
		if (Object.getOwnPropertyDescriptor(proto, "setProgress")?.value === patchedProgress) Object.defineProperty(proto, "setProgress", progressOwn!);
		if (Object.getOwnPropertyDescriptor(proto, "setProgramStatus")?.value === patchedStatus) Object.defineProperty(proto, "setProgramStatus", statusOwn!);
		if (Object.getOwnPropertyDescriptor(proto, "start")?.value === patchedStart) Object.defineProperty(proto, "start", startOwn!);
	};
}

export function registerTerminalActivity(pi: ExtensionAPI, counts: RunningCounts) {
	let restore: (() => void) | undefined;
	pi.on("session_start", (_event, ctx) => { restore?.(); restore = ctx.mode === "tui" ? patch(counts) : undefined; });
	pi.on("session_shutdown", () => { restore?.(); restore = undefined; });
}
