import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { createGrepToolDefinition, getAgentDir, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createPolicy, resolveInputPath } from "./search-policy.ts";

export const OUTPUT_BYTES = 50 * 1024;
export const DEFAULT_HEAD_LIMIT = 2000;
export const MAX_LINE_CHARS = 1000;
/** Entries one scan reads before it stops and marks the answer incomplete. */
export const SCAN_ENTRIES = 10000;
export const STDOUT_BYTES = 8 * 1024 * 1024;
export const SEARCH_TIMEOUT_MS = 25000;
const INT32_MAX = 2147483647;
/** Room kept free for the footer lines, which are always shown. */
export const FOOTER_RESERVE = 1024;

export function readDescription(name: string): string {
	return readFileSync(new URL(`./descriptions/${name}.md`, import.meta.url), "utf-8").trimEnd();
}

const OUTPUT_MODES = ["content", "files_with_matches", "count"] as const;
type OutputMode = (typeof OUTPUT_MODES)[number];

const rgSchema = Type.Object({
	pattern: Type.String({ description: "The regular expression pattern to search for in file contents" }),
	path: Type.Optional(Type.String({ description: "File or directory to search in (rg pattern -- PATH). Defaults to current working directory. Relative and absolute paths are supported." })),
	glob: Type.Optional(Type.String({ description: "Glob pattern to filter files (e.g. \"*.js\", \"*.{ts,tsx}\") - maps to rg --glob" })),
	type: Type.Optional(Type.String({ description: "File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than glob for standard file types." })),
	output_mode: Type.Optional(Type.Union(OUTPUT_MODES.map((mode) => Type.Literal(mode)), {
		description: "Output mode: \"content\" shows matching lines (supports -A/-B/-C context, head_limit), \"files_with_matches\" shows file paths (supports head_limit), \"count\" shows match counts (supports head_limit). Defaults to \"content\".",
	})),
	"-A": Type.Optional(Type.Number({ description: "Number of lines to show after each match (rg -A). Requires output_mode: \"content\", ignored otherwise." })),
	"-B": Type.Optional(Type.Number({ description: "Number of lines to show before each match (rg -B). Requires output_mode: \"content\", ignored otherwise." })),
	"-C": Type.Optional(Type.Number({ description: "Number of lines to show before and after each match (rg -C). Requires output_mode: \"content\", ignored otherwise." })),
	"-i": Type.Optional(Type.Boolean({ description: "Case insensitive search (rg -i) Defaults to false" })),
	multiline: Type.Optional(Type.Boolean({ description: "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false." })),
	head_limit: Type.Optional(Type.Number({ minimum: 0, description: "Limit output size. For \"content\" mode: limits total matches shown. For \"files_with_matches\" and \"count\" modes: limits number of files." })),
	offset: Type.Optional(Type.Number({ minimum: 0, description: "Skip first N entries. For \"content\" mode: skips first N matches. For \"files_with_matches\" and \"count\" modes: skips first N files. Use with head_limit for pagination." })),
});

type RgParams = {
	pattern: string;
	path?: string;
	glob?: string;
	type?: string;
	output_mode?: string;
	"-A"?: number;
	"-B"?: number;
	"-C"?: number;
	"-i"?: boolean;
	multiline?: boolean;
	head_limit?: number;
	offset?: number;
};

/** Pi's stock grep factory; tests supply their own to control the ensure/download step. */
export type RgOptions = { createGrep?: typeof createGrepToolDefinition };

/** Null sentinels some providers send for optional fields are dropped; required arguments stay untouched. */
export function dropNulls(input: unknown, required: string[]): unknown {
	if (!input || typeof input !== "object" || Array.isArray(input)) return input;
	return Object.fromEntries(Object.entries(input).filter(([key, value]) =>
		required.includes(key) || (value != null && value !== "null"),
	));
}

// ---- ripgrep binary ----

function findRipgrep(): string | undefined {
	const executable = process.platform === "win32" ? "rg.exe" : "rg";
	const managed = path.join(getAgentDir(), "bin", executable);
	if (existsSync(managed)) return managed;
	for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
		const candidate = directory ? path.join(directory, executable) : "";
		if (candidate && existsSync(candidate)) return candidate;
	}
	return undefined;
}

let bootstrapping: Promise<void> | undefined;

/**
 * Pi's own ensure step finds or downloads rg inside the stock grep before it asks whether the path is a folder.
 * That second call marks the point; the call then ends with a controlled failure and no search runs.
 */
function bootstrapNative(cwd: string, createGrep: typeof createGrepToolDefinition): Promise<void> {
	bootstrapping ??= (async () => {
		let reached = false;
		const stock: any = createGrep(cwd, {
			operations: {
				isDirectory: async () => {
					reached = true;
					throw new Error("rg is ready");
				},
				readFile: async () => "",
			},
		});
		try {
			await stock.execute("rqw-rg-bootstrap", { pattern: "x" }, undefined, undefined, { cwd });
		} catch (error) {
			if (!reached) throw error;
		}
	})().finally(() => { bootstrapping = undefined; });
	return bootstrapping;
}

/** Pi's managed rg, then PATH, then Pi's own download; the PATH name when only Pi's probe found it. */
export async function resolveRipgrep(cwd: string, createGrep: typeof createGrepToolDefinition = createGrepToolDefinition): Promise<string> {
	const found = findRipgrep();
	if (found) return found;
	await bootstrapNative(cwd, createGrep);
	return findRipgrep() ?? "rg";
}

// ---- process ----

const abortError = () => new Error("Operation aborted");

/** Receives decoded stdout in order, one call after the other; returning false stops reading and ends the process. */
export type Sink = { write(text: string): boolean | Promise<boolean>; end(): void | Promise<void> };
export type Outcome = { code: number | null; stderr: string; stoppedBySink: boolean; timedOut: boolean; overBytes: boolean };
/** The files of a batch that may be shown, in the same order. */
export type FileFilter = (files: string[]) => Promise<string[]>;

export function runRipgrep(binary: string, args: string[], cwd: string | undefined, sink: Sink, signal: AbortSignal | undefined, timeoutMs: number): Promise<Outcome> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(abortError());
		const child = spawn(binary, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
		const decoder = new StringDecoder("utf8");
		let bytes = 0;
		let stderr = "";
		let stoppedBySink = false;
		let timedOut = false;
		let overBytes = false;
		let spawnError: Error | undefined;
		let sinkError: unknown;
		let sinkChain: Promise<void> = Promise.resolve();
		const stop = () => { if (!child.killed) child.kill(); };
		const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
		const onAbort = () => {
			stop();
			reject(abortError());
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		// The sink may need time per batch (it checks real paths); batches still reach it one after the other.
		const feed = (text: string) => {
			sinkChain = sinkChain.then(async () => {
				if (stoppedBySink || sinkError) return;
				try {
					if (!(await sink.write(text))) {
						stoppedBySink = true;
						stop();
					}
				} catch (error) {
					sinkError = error;
					stop();
				}
			});
		};
		child.stdout.on("data", (chunk: Buffer) => {
			if (overBytes) return;
			bytes += chunk.length;
			feed(decoder.write(chunk));
			if (bytes > STDOUT_BYTES) {
				overBytes = true;
				stop();
			}
		});
		child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
		child.on("error", (error) => { spawnError = error; });
		child.on("close", (code) => {
			void (async () => {
				try {
					if (spawnError) throw spawnError;
					if (!overBytes) feed(decoder.end());
					await sinkChain;
					if (sinkError) throw sinkError;
					await sink.end();
					if (signal?.aborted) throw abortError();
					resolve({ code, stderr: stderr.trim(), stoppedBySink, timedOut, overBytes });
				} catch (error) {
					reject(error);
				} finally {
					clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
				}
			})();
		});
	});
}

function splitter(separator: string) {
	let pending = "";
	return {
		push(text: string): string[] {
			const parts = (pending + text).split(separator);
			pending = parts.pop() ?? "";
			return parts;
		},
		rest(): string {
			const left = pending;
			pending = "";
			return left;
		},
	};
}

/** Why a scan did not see everything, undefined for a complete scan. */
export function incompleteReason(outcome: Outcome, entriesCut: boolean): string | undefined {
	if (outcome.timedOut) return `timed out after ${SEARCH_TIMEOUT_MS / 1000} seconds`;
	if (entriesCut) return `stopped after ${SCAN_ENTRIES} entries`;
	if (outcome.overBytes) return "stopped after 8 MiB of ripgrep output";
	return undefined;
}

/** ripgrep exits 2 for a bad regex and also for one unreadable file; only the first case has nothing to show. */
export function failureOf(outcome: Outcome, hasResults: boolean): { error?: Error; partial?: string } {
	if (outcome.stoppedBySink || outcome.timedOut || outcome.overBytes) return {};
	if (outcome.code === 0 || outcome.code === 1) return {};
	const message = outcome.stderr.split("\n")[0].slice(0, 300) || `ripgrep exited with code ${outcome.code}`;
	return hasResults ? { partial: message } : { error: new Error(message) };
}

/** Path records ending in NUL, as `rg --null` prints them; only the files the filter lets through count toward the limit. */
export function createPathSink(limit: number, resolve: (file: string) => string, filter: FileFilter) {
	const parts = splitter("\0");
	const paths: string[] = [];
	let cut = false;
	const take = async (records: string[]): Promise<boolean> => {
		for (const file of await filter(records.filter(Boolean).map(resolve))) {
			if (paths.length >= limit) {
				cut = true;
				return false;
			}
			paths.push(file);
		}
		return true;
	};
	const sink: Sink = {
		write: (text) => take(parts.push(text)),
		end: async () => { await take([parts.rest()]); },
	};
	return { sink, paths, wasCut: () => cut };
}

// ---- query ----

type Query = {
	pattern: string;
	root: string;
	glob?: string;
	type?: string;
	mode: OutputMode;
	ignoreCase: boolean;
	multiline: boolean;
	before: number;
	after: number;
	headLimit: number;
	offset: number;
};

function whole(name: string, value: unknown, round: (n: number) => number): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
	if (value < 0) throw new Error(`${name} must not be negative`);
	return Math.min(round(value), INT32_MAX);
}

function parseQuery(params: RgParams, cwd: string): Query {
	if (typeof params?.pattern !== "string" || params.pattern === "") throw new Error("pattern must not be empty");
	if (params.glob !== undefined && (typeof params.glob !== "string" || params.glob === "")) throw new Error("glob must not be empty");
	const mode = params.output_mode ?? "content";
	if (!(OUTPUT_MODES as readonly string[]).includes(mode)) {
		throw new Error(`Invalid output_mode "${mode}"; use content, files_with_matches or count`);
	}
	const after = whole("-A", params["-A"], Math.ceil);
	const before = whole("-B", params["-B"], Math.ceil);
	const both = whole("-C", params["-C"], Math.ceil);
	const separate = after !== undefined || before !== undefined;
	return {
		pattern: params.pattern,
		root: resolveInputPath(params.path, cwd),
		glob: params.glob,
		type: params.type || undefined,
		mode: mode as OutputMode,
		ignoreCase: params["-i"] === true,
		multiline: params.multiline === true,
		before: mode !== "content" ? 0 : separate ? (before ?? 0) : (both ?? 0),
		after: mode !== "content" ? 0 : separate ? (after ?? 0) : (both ?? 0),
		headLimit: whole("head_limit", params.head_limit, Math.ceil) ?? DEFAULT_HEAD_LIMIT,
		offset: whole("offset", params.offset, Math.floor) ?? 0,
	};
}

/** Whether the search root is a folder; a missing path and a refused path are reported apart. */
export async function inspectRoot(root: string): Promise<{ isDirectory: boolean }> {
	try {
		return { isDirectory: (await stat(root)).isDirectory() };
	} catch (error: any) {
		if (error?.code === "ENOENT" || error?.code === "ENOTDIR") throw new Error(`Path not found: ${root}`);
		if (error?.code === "EACCES" || error?.code === "EPERM") throw new Error(`Permission denied: ${root}`);
		throw new Error(`Cannot read ${root}: ${error?.message ?? error}`);
	}
}

/** The flags shared by every rg run of the tools: no user config, no colour, hidden files, symlinks followed. */
export function baseArgs(): string[] {
	return ["--no-config", "--color=never", "--hidden", "--follow", "--with-filename"];
}

function searchArgs(query: Query, filterByType: boolean, excludes: string[], target: string, sorted: boolean): string[] {
	const args = [...baseArgs(), query.ignoreCase ? "--ignore-case" : "--case-sensitive"];
	if (sorted) args.push("--sort", "path");
	const json = query.mode === "content" || query.multiline && query.mode === "count";
	if (json) args.push("--json");
	else args.push(query.mode === "count" ? "--count" : "--files-with-matches", "--null");
	if (query.after > 0) args.push("--after-context", String(query.after));
	if (query.before > 0) args.push("--before-context", String(query.before));
	if (query.multiline) args.push("--multiline", "--multiline-dotall");
	if (query.glob) args.push("--iglob", query.glob);
	else if (query.type && !filterByType) args.push("--type", query.type);
	// After the user's glob: a broad positive glob would otherwise let the noise folders back in.
	for (const exclude of excludes) args.push("--iglob", exclude);
	args.push(`--regexp=${query.pattern}`, "--", target);
	return args;
}

// ---- type filter (a glob replaces rg's own type filter, so both together are intersected here) ----

function globToRegExp(glob: string): RegExp {
	let source = "";
	let braces = 0;
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === "*") source += "[^/]*";
		else if (c === "?") source += "[^/]";
		else if (c === "{") { braces++; source += "(?:"; }
		else if (c === "}" && braces > 0) { braces--; source += ")"; }
		else if (c === "," && braces > 0) source += "|";
		else if (c === "[") {
			const close = glob.indexOf("]", i + 2);
			if (close < 0) source += "\\[";
			else { source += glob.slice(i, close + 1); i = close; }
		} else source += c.replace(/[.+^$()|\\/]/g, "\\$&");
	}
	return new RegExp(`^${source}$`, "i");
}

async function typeFilter(binary: string, type: string, signal: AbortSignal | undefined): Promise<(file: string) => boolean> {
	const lines = splitter("\n");
	const entries: string[] = [];
	const sink: Sink = { write: (text) => { entries.push(...lines.push(text)); return true; }, end: () => { entries.push(lines.rest()); } };
	await runRipgrep(binary, ["--no-config", "--type-list"], undefined, sink, signal, SEARCH_TIMEOUT_MS);
	const line = entries.find((entry) => entry.startsWith(`${type}:`));
	if (!line) throw new Error(`unrecognized file type: ${type}`);
	const patterns = line.slice(type.length + 1).split(",").map((glob) => globToRegExp(glob.trim()));
	return (file) => patterns.some((pattern) => pattern.test(path.basename(file)));
}

// ---- results ----

type Match = { start: number; end: number };
type ContentFile = { path: string; lines: Map<number, string>; matches: Match[] };
type Entry = { file: string; index: number; count?: number };

function jsonText(field: any): string {
	if (typeof field?.text === "string") return field.text;
	if (typeof field?.bytes === "string") return Buffer.from(field.bytes, "base64").toString("utf8");
	return "";
}

function physicalLines(text: string): string[] {
	return text.replace(/\r?\n$/, "").split("\n").map((line) => line.replace(/\r$/, ""));
}

/** Reads `rg --json` events into files with their matches and the context lines around them. */
function createContentSink(resolve: (file: string) => string, filter: FileFilter) {
	const parts = splitter("\n");
	const files: ContentFile[] = [];
	let current: ContentFile | undefined;
	let allowed = new Set<string>();
	let total = 0;
	let cut = false;
	const close = () => {
		if (current?.matches.length) files.push(current);
		current = undefined;
	};
	const handle = (event: any): boolean => {
		const data = event.data;
		if (event.type === "begin") {
			close();
			const file = resolve(jsonText(data?.path));
			if (allowed.has(file)) current = { path: file, lines: new Map(), matches: [] };
		} else if (event.type === "match" && current) {
			if (total >= SCAN_ENTRIES) {
				cut = true;
				return false;
			}
			total++;
			const lines = physicalLines(jsonText(data.lines));
			lines.forEach((line, offset) => current!.lines.set(data.line_number + offset, line));
			current.matches.push({ start: data.line_number, end: data.line_number + lines.length - 1 });
		} else if (event.type === "context" && current) {
			current.lines.set(data.line_number, physicalLines(jsonText(data.lines))[0] ?? "");
		} else if (event.type === "end") {
			close();
		}
		return true;
	};
	const take = async (raws: string[]): Promise<boolean> => {
		const events = raws.filter((raw) => raw.trim()).flatMap((raw) => {
			try {
				return [JSON.parse(raw)];
			} catch {
				return [];
			}
		});
		// Every file of the batch is checked at once, then the events are read in order.
		const begun = events.filter((event) => event.type === "begin").map((event) => resolve(jsonText(event.data?.path)));
		allowed = new Set(await filter(begun));
		return events.every(handle);
	};
	const sink: Sink = {
		write: (text) => take(parts.push(text)),
		end: async () => {
			await take([parts.rest()]);
			close();
		},
	};
	return { sink, files, wasCut: () => cut };
}

/** `rg --count --null` lines: the path, a NUL, the count. */
function createCountSink(resolve: (file: string) => string, filter: FileFilter) {
	const parts = splitter("\n");
	const counts: Array<{ path: string; count: number }> = [];
	let cut = false;
	const take = async (lines: string[]): Promise<boolean> => {
		const records = lines.filter((line) => line.includes("\0")).map((line) => {
			const at = line.lastIndexOf("\0");
			return { path: resolve(line.slice(0, at)), count: Number(line.slice(at + 1)) };
		});
		const allowed = new Set(await filter(records.map((record) => record.path)));
		for (const record of records.filter((one) => allowed.has(one.path))) {
			if (counts.length >= SCAN_ENTRIES) {
				cut = true;
				return false;
			}
			counts.push(record);
		}
		return true;
	};
	const sink: Sink = { write: (text) => take(parts.push(text)), end: async () => { await take([parts.rest()]); } };
	return { sink, counts, wasCut: () => cut };
}

/** Paths from an `rg --null` listing run inside `base`, made absolute; stops reading after `limit` paths. */
export async function listPaths(binary: string, args: string[], base: string, limit: number, filter: FileFilter, signal: AbortSignal | undefined, timeoutMs: number) {
	const listing = createPathSink(limit, (file) => path.resolve(base, file), filter);
	const outcome = await runRipgrep(binary, args, base, listing.sink, signal, timeoutMs);
	return { paths: listing.paths, cut: listing.wasCut(), outcome };
}

type Scan = {
	/** Files that hold matches, by path order, with their lines; content mode only. */
	files: Map<string, ContentFile>;
	entries: Entry[];
	incomplete?: string;
	partial?: string;
};

async function scan(binary: string, query: Query, isDirectory: boolean, signal: AbortSignal | undefined, timeoutMs: number): Promise<Scan> {
	const filterByType = Boolean(query.type && query.glob);
	const keep = filterByType ? await typeFilter(binary, query.type!, signal) : () => true;
	// Running inside the folder and searching "." makes anchored globs like src/*.ts match from the search root.
	const base = isDirectory ? query.root : path.dirname(query.root);
	const policy = await createPolicy(query.root, query.glob, isDirectory);
	const resolve = (file: string) => path.resolve(base, file);
	// Noise reached through symlinks is dropped here, before it can use up the scan budget.
	const filter: FileFilter = async (candidates) => {
		await policy.check(candidates, signal);
		return candidates.filter((file) => policy.allows(file) && keep(file));
	};
	const target = isDirectory ? "." : path.basename(query.root);
	const run = async (sorted: boolean) => {
		const args = searchArgs(query, filterByType, policy.excludes, target, sorted);
		const files = new Map<string, ContentFile>();
		const entries: Entry[] = [];
		let outcome: Outcome;
		let cut: boolean;
		if (query.mode === "count" && !query.multiline) {
			const counting = createCountSink(resolve, filter);
			outcome = await runRipgrep(binary, args, base, counting.sink, signal, timeoutMs);
			cut = counting.wasCut();
			for (const item of counting.counts) entries.push({ file: item.path, index: 0, count: item.count });
		} else if (query.mode === "files_with_matches") {
			const listing = await listPaths(binary, args, base, SCAN_ENTRIES, filter, signal, timeoutMs);
			outcome = listing.outcome;
			cut = listing.cut;
			for (const file of listing.paths) entries.push({ file, index: 0 });
		} else {
			const reading = createContentSink(resolve, filter);
			outcome = await runRipgrep(binary, args, base, reading.sink, signal, timeoutMs);
			cut = reading.wasCut();
			for (const file of reading.files) {
				files.set(file.path, file);
				if (query.mode === "count") entries.push({ file: file.path, index: 0, count: file.matches.length });
				else file.matches.forEach((_match, index) => entries.push({ file: file.path, index }));
			}
		}
		return { files, entries, outcome, cut };
	};
	// ripgrep runs on all cores, and a complete result is put in path order here, so pages are stable.
	// A result cut at the scan budget is an arbitrary part of the tree, so that case runs again in path
	// order (ripgrep's own single-threaded sort), which stops early and gives the same first part every time.
	const byPath = (a: Entry, b: Entry) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.index - b.index);
	let result = await run(false);
	let unstable = false;
	if ((result.cut || result.outcome.overBytes) && !result.outcome.timedOut) {
		const sorted = await run(true);
		// A rerun that cannot finish must not replace what the first run found.
		if (sorted.outcome.timedOut) unstable = true;
		else result = sorted;
	}
	if (result.outcome.timedOut || unstable || !(result.cut || result.outcome.overBytes)) result.entries.sort(byPath);
	const { files, entries, outcome, cut } = result;
	const failure = failureOf(outcome, entries.length > 0);
	if (failure.error) throw failure.error;
	if (signal?.aborted) throw abortError();
	const reason = incompleteReason(outcome, cut);
	const incomplete = unstable ? `${reason}; the path-ordered rerun timed out, so these results are an arbitrary part of the tree and offsets are not stable` : reason;
	return { files, entries, incomplete, partial: failure.partial };
}

// ---- format ----

export const sizeOf = (text: string) => Buffer.byteLength(text, "utf-8");

/** Largest prefix of the entries whose rendered text fits the budget; whole entries only. */
export function fitPrefix(total: number, render: (count: number) => string[], budget: number): number {
	let low = 0;
	let high = total;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (sizeOf(render(middle).join("\n")) <= budget) low = middle;
		else high = middle - 1;
	}
	return low;
}

function clip(text: string): { text: string; cut: boolean } {
	if (text.length <= MAX_LINE_CHARS) return { text, cut: false };
	let end = MAX_LINE_CHARS;
	const last = text.charCodeAt(end - 1);
	if (last >= 0xd800 && last <= 0xdbff) end--;
	return { text: `${text.slice(0, end)} [line cut: ${end} of ${text.length} characters]`, cut: true };
}

function displayPath(file: string, root: string, isDirectory: boolean): string {
	if (!isDirectory) return path.basename(file);
	const relative = path.relative(root, file);
	return (relative && !relative.startsWith("..") ? relative : file).split(path.sep).join("/");
}

type Render = { lines: string[]; clipped: boolean };

/** Match and context lines of the chosen matches, grouped by file; `--` separates gaps like rg does. */
function renderContent(chosen: Entry[], found: Map<string, ContentFile>, query: Query, isDirectory: boolean): Render {
	const byFile = new Map<string, number[]>();
	for (const entry of chosen) byFile.set(entry.file, [...(byFile.get(entry.file) ?? []), entry.index]);
	const withContext = query.before > 0 || query.after > 0;
	const lines: string[] = [];
	let clipped = false;
	for (const [file, indexes] of byFile) {
		const content = found.get(file)!;
		const selected = indexes.map((index) => content.matches[index]);
		const matchLines = new Set<number>();
		for (const match of selected) for (let n = match.start; n <= match.end; n++) matchLines.add(n);
		// Only the lines ripgrep sent are walked, so a huge -C costs no more than the file has lines.
		const shown = new Map<number, { text: string; isMatch: boolean }>();
		let window = 0;
		for (const n of [...content.lines.keys()].sort((a, b) => a - b)) {
			while (window < selected.length && selected[window].end + query.after < n) window++;
			const inWindow = window < selected.length && selected[window].start - query.before <= n;
			if (matchLines.has(n) || inWindow) shown.set(n, { text: content.lines.get(n)!, isMatch: matchLines.has(n) });
		}
		const name = displayPath(file, query.root, isDirectory);
		let previous = -2;
		for (const n of [...shown.keys()].sort((a, b) => a - b)) {
			const line = shown.get(n)!;
			const cut = clip(line.text);
			clipped ||= cut.cut;
			if (withContext && lines.length > 0 && n !== previous + 1) lines.push("--");
			lines.push(line.isMatch ? `${name}:${n}: ${cut.text}` : `${name}-${n}- ${cut.text}`);
			previous = n;
		}
	}
	return { lines, clipped };
}

function renderNames(chosen: Entry[], query: Query, isDirectory: boolean): Render {
	const lines = chosen.map((entry) => {
		const name = displayPath(entry.file, query.root, isDirectory);
		return entry.count === undefined ? name : `${name}:${entry.count}`;
	});
	return { lines, clipped: false };
}

export type Formatted = { text: string; shown: number; details: Record<string, unknown> };

export function formatScan(result: Scan, query: Query, isDirectory: boolean): Formatted {
	const unit = query.mode === "content" ? "matches" : "files";
	const { entries } = result;
	const end = query.headLimit === 0 ? entries.length : Math.min(entries.length, query.offset + query.headLimit);
	const page = entries.slice(query.offset, end);
	const render = (count: number): Render => {
		const chosen = page.slice(0, count);
		return query.mode === "content" ? renderContent(chosen, result.files, query, isDirectory) : renderNames(chosen, query, isDirectory);
	};
	const budget = OUTPUT_BYTES - FOOTER_RESERVE;
	let shown = fitPrefix(page.length, (count) => render(count).lines, budget);
	let body = render(shown);
	const footers: string[] = [];
	if (shown === 0 && page.length > 0) {
		// One entry larger than the whole budget: its first lines that fit are shown.
		const lines: string[] = [];
		let used = 0;
		for (const line of render(1).lines) {
			used += sizeOf(line) + 1;
			if (used > budget) break;
			lines.push(line);
		}
		body = { lines, clipped: body.clipped };
		shown = 1;
		footers.push(`[The first ${unit === "matches" ? "match" : "entry"} is larger than the output budget and is cut.]`);
	}
	if (body.clipped) footers.push(`[Some lines were cut to ${MAX_LINE_CHARS} characters. Read the file with rqw_readfile to see them.]`);
	const moreAfterPage = shown < page.length || entries.length > end;
	if (moreAfterPage) {
		const nextOffset = query.offset + shown;
		const why = shown < page.length ? `Output cut at ${OUTPUT_BYTES / 1024}KiB after ${shown} ${unit}.` : `Showing ${shown} ${unit}; more exist.`;
		footers.push(`[${why} Use offset=${nextOffset} to continue, or narrow path, pattern or glob.]`);
	}
	if (result.incomplete) footers.push(`[Scan incomplete: ${result.incomplete}. Results may be missing; narrow path, pattern or glob.]`);
	if (result.partial) footers.push(`[Some paths could not be searched: ${result.partial}. Results may be missing.]`);
	let lines = body.lines;
	if (page.length === 0) {
		if (entries.length === 0) lines = ["No matches found"];
		else lines = [`No ${unit} at offset ${query.offset}; only ${entries.length} ${unit} found.`];
		if (entries.length === 0 && result.incomplete) lines = ["No matches found before the scan stopped"];
	}
	const text = [lines.join("\n"), ...(footers.length ? [footers.join("\n")] : [])].join("\n\n");
	return { text, shown, details: { mode: query.mode, offset: query.offset, shown, total: entries.length, incomplete: result.incomplete } };
}

// ---- tool ----

export function createRgToolDefinition(cwd: string, options: RgOptions = {}): ToolDefinition<any, any, any> {
	return {
		name: "rqw_rg",
		label: "rg",
		description: readDescription("rqw_rg"),
		promptSnippet: "Search file contents with ripgrep (respects .gitignore)",
		parameters: rgSchema,
		prepareArguments: (input: unknown) => dropNulls(input, ["pattern"]) as any,
		async execute(_id: string, params: RgParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
			if (signal?.aborted) throw abortError();
			const query = parseQuery(params, ctx?.cwd || cwd);
			const { isDirectory } = await inspectRoot(query.root);
			const binary = await resolveRipgrep(ctx?.cwd || cwd, options.createGrep);
			const result = await scan(binary, query, isDirectory, signal, SEARCH_TIMEOUT_MS);
			const formatted = formatScan(result, query, isDirectory);
			return { content: [{ type: "text" as const, text: formatted.text }], details: formatted.details };
		},
	} as ToolDefinition<any, any, any>;
}
