// Pure classification of one tool call for the summary line and the live block. No filesystem access;
// the inputs are never mutated. Edit and write are classified by changes.ts into the same shape.
import path from "node:path";
import type { ToolRenderContext } from "./index.ts";

export type Kind = "read" | "search" | "run" | "wait" | "other" | "edit";
export type Status = "running" | "done" | "error" | "aborted";

export interface Classified {
	kind: Kind;
	/** One-line display target: path and range, pattern and place, command, waited IDs or tool and argument. */
	target: string;
	status: Status;
	/** Every key this call counts under: one per waited ID for wait, one per file for read, edit and write, else the tool call ID. */
	countKeys: string[];
	/** The text content of the result, joined by newlines. */
	outputText: string;
	/** A bash exit code, when the result reports one. */
	exitCode?: number;
}

/** The fields of Pi's render context the classifiers read; every one may be missing. */
export type CallContext = Partial<Pick<ToolRenderContext, "toolCallId" | "isPartial" | "isError" | "cwd">> & {
	stopReason?: "aborted" | "error";
};

/** The fields of a tool result the classifiers read. */
export interface CallResult {
	content?: readonly { type: string; text?: string }[];
	details?: unknown;
	structuredContent?: unknown;
	isError?: boolean;
}

// Keep stored standalone review waits readable; current profile reviewers use agent.
const WAITERS = new Set(["agent", "review"]);
// eslint-disable-next-line no-control-regex
const ESCAPES = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])|\x9b[0-?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\x00-\x1f\x7f-\x9f]/g;

/** Text for one display row: terminal escapes removed, line breaks folded to one space, controls to spaces. */
export function oneLine(text: string): string {
	return text.replace(ESCAPES, "").replace(/[ \t]*(?:\r\n|\r|\n)\s*/g, " ").replace(CONTROLS, " ").trim();
}

export function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The same file under different spellings counts once, resolved lexically on `platform` (default: the host):
 * with `cwd`, the path is resolved against it by `path.win32.resolve` or `path.posix.resolve`; `./`, `..` and
 * repeated slashes fold, and Windows `\` separators and `C:/` are the same. Drive letter case is kept as
 * written. No filesystem access. Windows UNC roots keep their double separator (`//server/share`).
 */
export function normalizePath(input: string, cwd?: string, platform: string = process.platform): string {
	const win = platform === "win32";
	let p = input;
	if (cwd) p = (win ? path.win32 : path.posix).resolve(cwd, p);
	if (win) p = p.replace(/\\/g, "/");
	const drive = win ? /^[A-Za-z]:/.exec(p)?.[0] ?? "" : "";
	const rooted = p.slice(drive.length).startsWith("/");
	const unc = win && p.startsWith("//");
	const parts: string[] = [];
	for (const part of p.slice(drive.length).split("/")) {
		if (part === "" || part === ".") continue;
		if (part === ".." && parts.length > 0 && parts.at(-1) !== "..") parts.pop();
		else if (part !== ".." || !rooted) parts.push(part);
	}
	return `${drive}${unc ? "//" : rooted ? "/" : ""}${parts.join("/")}` || ".";
}

export function outputOf(result: CallResult | undefined): string {
	const content = Array.isArray(result?.content) ? result.content : [];
	return content.filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n");
}

/** The exit code a bash result reports: Pi's `structuredContent.exit_code`, or `exitCode`/`exit_code` in details. */
function exitCodeOf(result: CallResult | undefined): number | undefined {
	for (const value of [record(result?.structuredContent).exit_code, record(result?.details).exitCode, record(result?.details).exit_code])
		if (typeof value === "number" && Number.isFinite(value)) return value;
	return undefined;
}

// Not `argsComplete`: Pi leaves it false for calls replayed from history, which do have their result.
export function statusOf(result: CallResult | undefined, context: CallContext, failed = false): Status {
	if (context.stopReason) return context.stopReason;
	if (context.isPartial) return "running";
	if (context.isError || result?.isError || failed) return "error";
	return result ? "done" : "running";
}

const positive = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;

function readTarget(args: Record<string, unknown>): string {
	const path = oneLine(str(args.path) ?? "");
	if (!positive(args.offset)) return path;
	return positive(args.limit) ? `${path} L${args.offset}-${args.offset + args.limit - 1}` : `${path} L${args.offset}`;
}

export function classify(toolName: string, args: unknown, result: CallResult | undefined, context: CallContext = {}, platform: string = process.platform): Classified {
	const a = record(args);
	const id = context.toolCallId ?? "";
	const outputText = outputOf(result);
	if (toolName === "read" || toolName === "rqw_readfile") {
		const path = str(a.path);
		const key = path ? normalizePath(path, context.cwd, platform) : id;
		let target = readTarget(a);
		if (toolName === "rqw_readfile" && !positive(a.offset)) {
			if (typeof a.offset === "number" && Number.isInteger(a.offset)) target += ` L${a.offset}`;
			if (typeof a.limit === "number" && Number.isInteger(a.limit)) target += ` limit: ${a.limit}`;
		} else if (toolName === "rqw_readfile" && typeof a.limit === "number" && Number.isInteger(a.limit) && !positive(a.limit)) {
			target += ` limit: ${a.limit}`;
		}
		return { kind: "read", target, status: statusOf(result, context), countKeys: [key], outputText };
	}
	if (toolName === "rqw_rg" || toolName === "rqw_glob") {
		const pattern = oneLine(str(toolName === "rqw_rg" ? a.pattern : a.glob_pattern) ?? "");
		const path = str(toolName === "rqw_rg" ? a.path : a.target_directory);
		let target = toolName === "rqw_rg" ? `${pattern} in ${oneLine(path ?? ".")}` : path ? `${pattern} in ${oneLine(path)}` : pattern;
		if (toolName === "rqw_rg") {
			const glob = str(a.glob);
			const mode = str(a.output_mode);
			if (glob) target += ` glob: ${oneLine(glob)}`;
			if (mode) target += ` output_mode: ${oneLine(mode)}`;
		}
		return { kind: "search", target, status: statusOf(result, context), countKeys: [id], outputText };
	}
	if (toolName === "grep" || toolName === "find") {
		const pattern = oneLine(str(a.pattern) ?? "");
		const path = str(a.path);
		const target = toolName === "grep" ? `${pattern} in ${oneLine(path ?? ".")}` : path ? `${pattern} in ${oneLine(path)}` : pattern;
		return { kind: "search", target, status: statusOf(result, context), countKeys: [id], outputText };
	}
	if (toolName === "bash") {
		const exitCode = exitCodeOf(result);
		const failed = exitCode !== undefined && exitCode !== 0;
		return { kind: "run", target: oneLine(str(a.command) ?? ""), status: statusOf(result, context, failed), countKeys: [id],
			outputText, ...(exitCode !== undefined ? { exitCode } : {}) };
	}
	if (WAITERS.has(toolName) && a.action === "wait") {
		const ids = [...new Set((Array.isArray(a.ids) ? a.ids : []).filter((x): x is string => typeof x === "string" && x.length > 0))];
		return { kind: "wait", target: ids.map(oneLine).join(" "), status: statusOf(result, context), countKeys: ids,
			outputText };
	}
	const first = Object.values(a).find((value): value is string => typeof value === "string" && oneLine(value).length > 0);
	const target = first === undefined ? oneLine(toolName) : `${oneLine(toolName)} ${oneLine(first)}`;
	return { kind: "other", target, status: statusOf(result, context), countKeys: [id], outputText };
}
