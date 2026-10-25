// Pure classification of edit and write calls: which files, each file's own outcome and its confirmed
// `+added -removed`. Counts come only from the result (Pi's diff or patch, RQW multi-file `details.files[]`,
// the content of a confirmed write); never from the requested old/new text, never from the disk.
import { type CallContext, type CallResult, type Classified, normalizePath, oneLine, outputOf, record, statusOf, str } from "./classify.ts";

export type FileStatus = "running" | "done" | "error" | "aborted" | "possibly_changed";

export interface FileChange {
	path: string;
	status: FileStatus;
	countKey: string;
	added?: number;
	removed?: number;
}

export interface ChangeClassified extends Classified {
	kind: "edit";
	files: FileChange[];
}

/** Local mirror of the collection coercion in RQW-tools (`prepareWriteArguments`, stock edit preparation): a JSON
 * string is parsed (malformed or non-JSON stays unusable), one object is wrapped in an array. Never mutates the args. */
function collection(value: unknown): unknown[] | undefined {
	let list = value;
	if (typeof list === "string") {
		try {
			list = JSON.parse(list);
		} catch {
			return undefined;
		}
	}
	if (list !== null && typeof list === "object" && !Array.isArray(list)) list = [list];
	return Array.isArray(list) ? list : undefined;
}

/** Requested files in first-seen order, each once under its first spelling: RQW `edits[].path` with the top-level
 * path as fallback, RQW `files[].path` for write, or the stock top-level `path`. */
function requested(toolName: string, args: Record<string, unknown>, cwd: string | undefined, platform: string): { path: string; countKey: string; content?: string }[] {
	const seen = new Map<string, { path: string; countKey: string; content?: string }>();
	const add = (path: string | undefined, content?: unknown) => {
		const countKey = path && normalizePath(path, cwd, platform);
		if (path && countKey && !seen.has(countKey)) seen.set(countKey, { path, countKey, ...(typeof content === "string" ? { content } : {}) });
	};
	const top = str(args.path);
	const files = toolName === "write" ? collection(args.files) : undefined;
	const edits = toolName === "edit" ? collection(args.edits) : undefined;
	if (files && files.length > 0) {
		for (const f of files) add(str(record(f).path), record(f).content);
	} else if (edits && edits.length > 0) {
		for (const e of edits) add(str(record(e).path) ?? top);
	} else add(top, args.content);
	return [...seen.values()];
}

/** Lines of written content: "" is 0, "a\n" is 1, "a\n\n" is 2; a final newline ends the last line. */
export function contentLines(content: string): number {
	if (content === "") return 0;
	const parts = content.split("\n").length;
	return content.endsWith("\n") ? parts - 1 : parts;
}

/** Changed lines of a unified patch, counted inside hunks only: headers and context lines are not changes. */
export function countPatch(patch: string): { added: number; removed: number } | undefined {
	let added = 0, removed = 0, oldLeft = 0, newLeft = 0, hunks = 0;
	for (const line of patch.split(/\r?\n/)) {
		if (oldLeft > 0 || newLeft > 0) {
			if (line.startsWith("\\")) continue;
			if (line.startsWith("+")) { added++; newLeft--; }
			else if (line.startsWith("-")) { removed++; oldLeft--; }
			else { oldLeft--; newLeft--; }
			continue;
		}
		const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
		if (hunk) { hunks++; oldLeft = Number(hunk[1] ?? 1); newLeft = Number(hunk[2] ?? 1); }
	}
	return hunks > 0 ? { added, removed } : undefined;
}

/** Changed lines of Pi's line-numbered display diff (`+12 text`, `-12 text`, ` 12 text`, `    ...`). */
export function countDiff(diff: string): { added: number; removed: number } | undefined {
	let added = 0, removed = 0, lines = 0;
	for (const line of diff.split(/\r?\n/)) {
		const m = /^([+\- ]) *\d+(?: |$)/.exec(line);
		if (!m) continue;
		lines++;
		if (m[1] === "+") added++;
		else if (m[1] === "-") removed++;
	}
	return lines > 0 ? { added, removed } : undefined;
}

/** Confirmed counts: a patch or display diff, or the compact nested counts synthesized by groups.ts. */
function editCounts(details: unknown): { added?: number; removed?: number } | undefined {
	const d = record(details);
	const parsed = (typeof d.patch === "string" ? countPatch(d.patch) : undefined) ?? (typeof d.diff === "string" ? countDiff(d.diff) : undefined);
	if (parsed) return parsed;
	const compact = record(d.rqwToolsNestedCounts);
	const valid = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
	const counts = { ...(valid(compact.added) ? { added: compact.added } : {}), ...(valid(compact.removed) ? { removed: compact.removed } : {}) };
	return Object.keys(counts).length ? counts : undefined;
}

export function classifyChange(toolName: string, args: unknown, result: CallResult | undefined, context: CallContext = {}, platform: string = process.platform): ChangeClassified {
	const a = record(args);
	const status = statusOf(result, context);
	const perFile = Array.isArray(record(result?.details).files) ? (record(result?.details).files as unknown[]).map(record) : undefined;
	const reqs = requested(toolName, a, context.cwd, platform);
	const contentOf = (countKey: string) => reqs.find((r) => r.countKey === countKey)?.content;
	const build = (path: string, countKey: string, fileStatus: FileStatus, details: unknown, content: string | undefined): FileChange => {
		if (fileStatus !== "done") return { path, status: fileStatus, countKey };
		const counts = toolName === "write" ? (content === undefined ? undefined : { added: contentLines(content), removed: 0 }) : editCounts(details);
		if (!counts) return { path, status: fileStatus, countKey };
		return toolName === "write" ? { path, status: fileStatus, countKey, added: counts.added } : { path, status: fileStatus, countKey, ...counts };
	};
	const entryStatus = (own: Record<string, unknown>): FileStatus => (own.ok === true ? "done" : own.outcome === "possibly_changed" ? "possibly_changed" : "error");
	// A finished RQW multi-file call lists the files it actually grouped (by filesystem identity, which can merge
	// several requested spellings into one): that list is the truth, the requested args only a fallback.
	const entries = status === "running" ? [] : (perFile ?? []).filter((f) => typeof f.path === "string" && f.path !== "");
	let files: FileChange[];
	if (entries.length > 0) {
		const seen = new Set<string>();
		files = [];
		for (const own of entries) {
			const path = own.path as string;
			const countKey = normalizePath(path, context.cwd, platform);
			if (seen.has(countKey)) continue;
			seen.add(countKey);
			files.push(build(path, countKey, entryStatus(own), own.details, contentOf(countKey)));
		}
	} else {
		// Without a per-file list one stock result stands for the whole call: its details count once, on the first
		// file, never again for another spelling of the same file.
		// A finished stock edit is one identity: only the first requested path is exposed; a running call keeps the list.
		const exposed = toolName === "edit" && !perFile && status !== "running" ? reqs.slice(0, 1) : reqs;
		let counted = false;
		files = exposed.map(({ path, countKey, content }) => {
			if (status === "running") return build(path, countKey, "running", undefined, content);
			// A multi-file result that does not mention this file confirms nothing about it.
			const fileStatus: FileStatus = perFile ? "error" : status;
			const details = toolName === "write" || counted ? undefined : result?.details;
			if (fileStatus === "done") counted = true;
			return build(path, countKey, fileStatus, details, content);
		});
	}
	const first = files[0];
	// The whole live-block header: the tool name, the first path and how many more files.
	const target = first ? `${toolName} ${oneLine(first.path)}${files.length > 1 ? ` +${files.length - 1} more` : ""}` : toolName;
	const countKeys = files.map((f) => f.countKey);
	return { kind: "edit", target, status, countKey: countKeys[0] ?? context.toolCallId ?? "", countKeys, outputText: outputOf(result), files };
}
