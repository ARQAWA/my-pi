// The live block of the current call: a header row, the last four output rows and a status row, as one card
// under the summary line. Pure: no timers, the time is the final duration Pi reports; colors from the supplied theme.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { CallResult, Classified } from "./classify.ts";
import { record } from "./classify.ts";
import { fitEnd, fitStart } from "./summary.ts";

/** One classified call plus what the live block needs beyond it. */
export type LiveCall = Classified & {
	/** The tool name: tells grep from find. */
	toolName: string;
	/** The final duration Pi reports for a finished call (`context.durationMs`); omitted while unknown. */
	durationMs?: number;
	/** The confirmed diff of an edit (`diffOf`), shown instead of the result text. */
	diff?: string;
};

export const INDENT = 3;

/** Whole-card purple backgrounds of every live `agent` card, by state (constants, not theme keys: theme roles are global). */
const AGENT_BG = { running: [0x28, 0x20, 0x2b], success: [0x21, 0x0d, 0x2b], error: [0x35, 0x1c, 0x34] } as const;
export const TAIL = 4;

/** The confirmed diff text of an edit result: stock `details.diff`, else `details.patch`, else each RQW
 * `details.files[].details` diff in order. */
export function diffOf(result: CallResult | undefined): string | undefined {
	const own = (d: unknown) => {
		const r = record(d);
		return typeof r.diff === "string" ? r.diff : typeof r.patch === "string" ? r.patch : undefined;
	};
	const top = own(result?.details);
	if (top !== undefined) return top;
	const files = record(result?.details).files;
	if (!Array.isArray(files)) return undefined;
	const diffs = files.map((f) => own(record(f).details)).filter((d): d is string => d !== undefined);
	return diffs.length > 0 ? diffs.join("\n") : undefined;
}

/** `0.4s` under 10 s, `10s` under a minute, then `1m 05s`. */
export function formatDuration(ms: number): string {
	const tenths = Math.round(ms / 100) / 10;
	if (tenths < 10) return `${tenths.toFixed(1)}s`;
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** One output line for one screen row: terminal sequences gone, a carriage return keeps the last text drawn over it
 * (a trailing `\r` erases nothing),
 * tabs as three spaces (as Pi draws them), other control characters removed. */
export function cleanLine(line: string): string {
	// eslint-disable-next-line no-control-regex
	const drawn = stripTerminalSequences(line).split("\r").filter((part) => part !== "");
	return (drawn.at(-1) ?? "").replace(/\t/g, "   ").replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}

/** The last `TAIL` lines of `text`, trailing empty lines dropped first. */
export function tail(text: string): string[] {
	const lines = text.split(/\r?\n/);
	let end = lines.length;
	while (end > 0 && cleanLine(lines[end - 1]).trim() === "") end--;
	return lines.slice(Math.max(0, end - TAIL), end).map(cleanLine);
}

function header(call: LiveCall): string {
	switch (call.kind) {
		case "run": return `$ ${call.target}`;
		case "read": return `${call.toolName === "rqw_readfile" ? "rqw_readfile" : "read"} ${call.target}`;
		case "search": return `${call.toolName} ${call.target}`;
		case "wait": return call.target ? `wait ${call.target}` : "wait";
		default: return call.target; // edit/write and other tools already carry the tool name
	}
}

function status(call: LiveCall): string {
	if (call.status === "running") return "running";
	if (call.status === "aborted") return "aborted";
	const time = call.durationMs === undefined ? "" : formatDuration(call.durationMs);
	if (call.status === "done") return time ? `✓ ${time}` : "✓";
	const what = call.exitCode !== undefined ? `exit ${call.exitCode}` : "error";
	return time ? `✗ ${what} · ${time}` : `✗ ${what}`;
}

/** The live card of one call: at most six rows, each exactly one screen row no wider than `width`. */
export function renderLive(call: LiveCall, width: number, theme: Theme): string[] {
	const inner = width - INDENT;
	const failed = call.status === "error" || call.status === "aborted";
	const bgKey = call.status === "running" ? "toolPendingBg" : failed ? "toolErrorBg" : "toolSuccessBg";
	const purple = call.toolName === "agent" ? AGENT_BG[call.status === "running" ? "running" : failed ? "error" : "success"] : undefined;
	const paint = (body: string) => purple ? `\x1b[48;2;${purple.join(";")}m${body}\x1b[49m` : theme.bg(bgKey, body);
	const row = (text: string, fg: Parameters<Theme["fg"]>[0]) => {
		if (inner <= 0) return " ".repeat(Math.max(0, width));
		return " ".repeat(INDENT) + paint(theme.fg(fg, text) + " ".repeat(inner - visibleWidth(text)));
	};
	const rows = [row(fitStart(header(call), inner), "toolTitle")];
	if (call.kind === "edit" && call.diff !== undefined) {
		for (const line of tail(call.diff)) {
			const fg = line.startsWith("+") ? "toolDiffAdded" : line.startsWith("-") ? "toolDiffRemoved" : "toolDiffContext";
			rows.push(row(fitEnd(line, inner), fg));
		}
	} else for (const line of tail(call.outputText)) rows.push(row(fitEnd(line, inner), "toolOutput"));
	rows.push(row(fitEnd(status(call), inner), call.status === "running" ? "muted" : failed ? "error" : "success"));
	return rows;
}
