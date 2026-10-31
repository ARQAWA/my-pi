import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

type Execute = (id: string, params: any, signal: any, onUpdate: any, ctx: any) => Promise<any>;
type Program = "rg" | "fd";
type Listing = { lines: string[]; truncated: boolean };

/** A listing stops after this many paths; the note then says "at least" and the program is killed. */
export const MAX_LISTED_PATHS = 10000;
const MAX_SHOWN = 5;

const BINARY_NAMES: Record<Program, string[]> = { rg: ["rg"], fd: ["fd", "fdfind"] };
/** rg exits 1 for "no matches"; for fd any non-zero exit is a failure. */
const OK_EXIT_CODES: Record<Program, number[]> = { rg: [0, 1], fd: [0] };

function binaryCandidates(program: Program): string[] {
	const suffix = process.platform === "win32" ? ".exe" : "";
	const local = path.join(getAgentDir(), "bin", program + suffix);
	return [...(existsSync(local) ? [local] : []), ...BINARY_NAMES[program]];
}

function runBinary(program: Program, binary: string, args: string[], signal: AbortSignal): Promise<Listing> {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], signal });
		const lines: string[] = [];
		let pending = "";
		let stderr = "";
		let truncated = false;
		const take = (text: string) => {
			const parts = (pending + text).split(/\r?\n/);
			pending = parts.pop() ?? "";
			for (const line of parts) {
				if (truncated || !line) continue;
				if (lines.length >= MAX_LISTED_PATHS) {
					truncated = true;
					child.kill();
				} else {
					lines.push(line);
				}
			}
		};
		child.stdout.on("data", (chunk) => take(chunk.toString()));
		child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
		child.on("error", reject);
		child.on("close", (code) => {
			take("\n");
			if (!truncated && !OK_EXIT_CODES[program].includes(code ?? -1)) {
				reject(new Error(stderr.trim() || `${binary} exited with code ${code}`));
			} else {
				resolve({ lines, truncated });
			}
		});
	});
}

/** Pi's own binary directory first, then the names on PATH; ENOENT when none of them exists. */
async function runProgram(program: Program, args: string[], signal: AbortSignal): Promise<Listing> {
	let missing: unknown;
	for (const binary of binaryCandidates(program)) {
		try {
			return await runBinary(program, binary, args, signal);
		} catch (error: any) {
			if (error?.code !== "ENOENT") throw error;
			missing = error;
		}
	}
	throw missing;
}

function resolveSearchPath(input: string | undefined, cwd: string): string {
	let value = (input || ".").replace(/^@/, "");
	if (value === "~" || value.startsWith("~/")) value = path.join(homedir(), value.slice(1));
	return path.resolve(cwd, value);
}

/** rg arguments that list the files with matches, mirroring the stock grep tool's flags. */
function grepListArgs(params: any, target: string, noIgnore: boolean): string[] {
	const args = ["--no-config", "--files-with-matches", "--color=never", "--hidden"];
	if (noIgnore) args.push("--no-ignore");
	if (params.ignoreCase) args.push("--ignore-case");
	if (params.literal) args.push("--fixed-strings");
	if (params.glob) args.push("--glob", params.glob);
	args.push("--", params.pattern, target);
	return args;
}

async function insideGitRepo(target: string): Promise<boolean> {
	for (let current = target; ;) {
		const found = await access(path.join(current, ".git")).then(() => true, () => false);
		if (found) return true;
		const parent = path.dirname(current);
		if (parent === current) return false;
		current = parent;
	}
}

/** fd arguments that list the matching paths, mirroring the stock find tool's flags. */
async function findListArgs(params: any, target: string, noIgnore: boolean): Promise<string[]> {
	const args = ["--glob", "--color=never", "--hidden"];
	if (noIgnore) args.push("--no-ignore");
	if (!(await insideGitRepo(target))) args.push("--no-require-git");
	let pattern: string = params.pattern;
	if (pattern.includes("/")) {
		args.push("--full-path");
		if (!pattern.startsWith("/") && !pattern.startsWith("**/") && pattern !== "**") pattern = `**/${pattern}`;
		if (process.platform === "win32") pattern = pattern.replaceAll("/", String.raw`[/\\]`);
	}
	args.push("--", pattern, target);
	return args;
}

async function list(kind: "grep" | "find", params: any, target: string, noIgnore: boolean, signal: AbortSignal): Promise<Listing> {
	if (kind === "grep") return runProgram("rg", grepListArgs(params, target, noIgnore), signal);
	return runProgram("fd", await findListArgs(params, target, noIgnore), signal);
}

type Hidden = { path: string; isDir: boolean };
type Entry = { text: string; count: number; isDir: boolean };

/** A listed path relative to the search root, with posix separators and no trailing slash. */
function relativeEntry(listed: string, searchPath: string): Hidden {
	const isDir = /[\\/]$/.test(listed);
	const relative = path.isAbsolute(listed) ? path.relative(searchPath, listed) : listed;
	return { path: relative.split(path.sep).join("/").replace(/\/+$/, ""), isDir };
}

function ancestorDirs(files: Hidden[]): Set<string> {
	const dirs = new Set<string>();
	for (const file of files) {
		const parts = file.path.split("/");
		for (let depth = 1; depth < parts.length; depth++) dirs.add(parts.slice(0, depth).join("/"));
	}
	return dirs;
}

/** The shallowest folder above the path that holds no visible match, if any. */
function candidateDir(hidden: Hidden, visibleDirs: Set<string>): string | undefined {
	const parts = hidden.path.split("/");
	const deepest = hidden.isDir ? parts.length : parts.length - 1;
	for (let depth = 1; depth <= deepest; depth++) {
		const dir = parts.slice(0, depth).join("/");
		if (!visibleDirs.has(dir)) return dir;
	}
	return undefined;
}

/** Hidden paths that a search with path set to the folder really finds, or none when that search fails. */
async function reachableIn(kind: "grep" | "find", params: any, searchPath: string, dir: string, signal: AbortSignal): Promise<Set<string>> {
	try {
		const target = path.join(searchPath, ...dir.split("/"));
		const found = await list(kind, params, target, false, signal);
		return new Set(found.lines.map((line) => relativeEntry(line, searchPath).path));
	} catch {
		return new Set();
	}
}

function unreached(hidden: Hidden): Entry {
	return { text: hidden.isDir ? `${hidden.path}/` : hidden.path, count: 1, isDir: false };
}

/** What to tell about one ignored folder: itself when a path search finds its matches, else the files by name. */
async function folderEntries(kind: "grep" | "find", params: any, searchPath: string, dir: string, members: Hidden[], signal: AbortSignal): Promise<Entry[]> {
	const found = await reachableIn(kind, params, searchPath, dir, signal);
	const reached = members.filter((member) => found.has(member.path));
	const entries: Entry[] = reached.length > 0 ? [{ text: `${dir}/ ${reached.length}`, count: reached.length, isDir: true }] : [];
	for (const member of members) {
		if (found.has(member.path)) continue;
		if (member.path === dir && reached.length > 0) continue;
		entries.push(unreached(member));
	}
	return entries;
}

function plural(count: number, one: string, many: string): string {
	return count === 1 ? one : many;
}

function advice(kind: "grep" | "find", entries: Entry[]): string {
	const hasDir = entries.some((entry) => entry.isDir);
	const hasFile = entries.some((entry) => !entry.isDir);
	if (kind === "grep") {
		const what = hasDir && hasFile ? "directory or file" : hasDir ? "directory" : "file";
		return `Set path to a listed ${what} to search it.`;
	}
	const directories = hasDir ? "Set path to a listed directory to list it." : "";
	const named = hasFile ? "find cannot list the paths named one by one." : "";
	return [directories, named].filter(Boolean).join(" ");
}

/**
 * The note about matches in ignored paths, undefined when the listings agree or cannot be compared,
 * or the marker string "missing" when a listing program was not found.
 */
async function hiddenNote(kind: "grep" | "find", params: any, searchPath: string, signal: AbortSignal): Promise<string | undefined | "missing"> {
	try {
		const [visible, all] = await Promise.all([
			list(kind, params, searchPath, false, signal),
			list(kind, params, searchPath, true, signal),
		]);
		// With a cut-off visible list the difference would count visible files as hidden.
		if (visible.truncated) return undefined;
		const visibleEntries = visible.lines.map((line) => relativeEntry(line, searchPath));
		const seen = new Set(visibleEntries.map((entry) => entry.path));
		const hidden = all.lines.map((line) => relativeEntry(line, searchPath)).filter((entry) => entry.path && !seen.has(entry.path));
		if (hidden.length === 0) return undefined;
		return await describe(kind, params, searchPath, hidden, ancestorDirs(visibleEntries), all.truncated, signal);
	} catch (error: any) {
		return error?.code === "ENOENT" ? "missing" : undefined;
	}
}

async function describe(kind: "grep" | "find", params: any, searchPath: string, hidden: Hidden[], visibleDirs: Set<string>, cutOff: boolean, signal: AbortSignal): Promise<string> {
	const folders = new Map<string, Hidden[]>();
	const entries: Entry[] = [];
	for (const item of hidden) {
		const dir = candidateDir(item, visibleDirs);
		if (dir === undefined) {
			entries.push(unreached(item));
			continue;
		}
		const members = folders.get(dir) ?? [];
		members.push(item);
		folders.set(dir, members);
	}
	const byCount = [...folders].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
	const checked = byCount.slice(0, MAX_SHOWN);
	const answers = await Promise.all(checked.map(([dir, members]) => folderEntries(kind, params, searchPath, dir, members, signal)));
	entries.push(...answers.flat());
	entries.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
	const shownEntries = entries.slice(0, MAX_SHOWN);
	const shown = shownEntries.map((entry) => entry.text);
	const more = entries.length - shown.length + (byCount.length - checked.length);
	if (more > 0) shown.push(`${more} more`);
	const unit = kind === "grep" ? plural(hidden.length, "file", "files") : plural(hidden.length, "entry", "entries");
	const amount = `${cutOff ? "at least " : ""}${hidden.length}`;
	return `Also ${amount} ${unit} in ignored paths: ${shown.join(", ")}. ${advice(kind, shownEntries)}`;
}

/** Wraps a search execute: the visible search and both listings run in parallel, the note is appended to the answer. */
export function withHiddenNote(kind: "grep" | "find", search: Execute, cwd: string): Execute {
	return async (id, params, signal, onUpdate, ctx) => {
		const searchPath = resolveSearchPath(params?.path, ctx?.cwd || cwd);
		const listing = new AbortController();
		const stop = () => listing.abort();
		signal?.addEventListener("abort", stop, { once: true });
		const first = hiddenNote(kind, params, searchPath, listing.signal);
		try {
			const result = await search(id, params, signal, onUpdate, ctx);
			let note = await first;
			// Pi downloads a missing rg or fd during the search; by now it is in place.
			if (note === "missing") note = await hiddenNote(kind, params, searchPath, listing.signal);
			const text = result?.content?.[0];
			if (note && note !== "missing" && !result?.isError && text?.type === "text") text.text += `\n\n${note}`;
			return result;
		} catch (error) {
			stop();
			throw error;
		} finally {
			signal?.removeEventListener("abort", stop);
		}
	};
}
