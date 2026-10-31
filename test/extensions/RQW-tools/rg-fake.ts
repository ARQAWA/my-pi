import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { PassThrough } from "node:stream";
import type { TestContext } from "node:test";
import { createGlobToolDefinition } from "../../../extensions/RQW-tools/glob.ts";
import { createRgToolDefinition } from "../../../extensions/RQW-tools/rg.ts";

export type Reply = { stdout?: string; stderr?: string; code?: number; hang?: boolean; chunkBytes?: number; afterClose?: () => void };

/** A file of the simulated tree; `path` is posix and relative to the project folder. */
export type VFile = { path: string; text?: string; ignored?: boolean; mtime?: number };

const childProcess: any = createRequire(import.meta.url)("node:child_process");

const TYPES: Record<string, string[]> = { py: ["*.py", "*.pyi"], ts: ["*.ts", "*.tsx"], js: ["*.js", "*.mjs"] };

/** One rg glob as a regular expression over a posix path: ** crosses folders, * and ? stay inside one. */
function globRegExp(glob: string): RegExp {
	const text = glob.includes("/") ? glob.replace(/^\//, "") : `**/${glob}`;
	let source = "";
	let braces = 0;
	for (let i = 0; i < text.length; i++) {
		const rest = text.slice(i);
		if (rest.startsWith("**/")) { source += "(?:.*/)?"; i += 2; }
		else if (rest.startsWith("/**")) { source += "(?:/.*)?"; i += 2; }
		else if (rest.startsWith("**")) { source += ".*"; i += 1; }
		else if (text[i] === "*") source += "[^/]*";
		else if (text[i] === "?") source += "[^/]";
		else if (text[i] === "{") { braces++; source += "(?:"; }
		else if (text[i] === "}" && braces > 0) { braces--; source += ")"; }
		else if (text[i] === "," && braces > 0) source += "|";
		else source += text[i].replace(/[.+^$()|\\[\]]/g, "\\$&");
	}
	return new RegExp(`^${source}$`, "i");
}

const matchesGlob = (glob: string, path: string) => globRegExp(glob).test(path);

/** The prefixes of a path that are folders, then the path itself: what a negated glob may match. */
const withAncestors = (path: string) => path.split("/").map((_part, i, parts) => parts.slice(0, i + 1).join("/"));

/**
 * A small ripgrep: it answers an rg command from the files of a simulated tree, by the command's own flags
 * (case, regex, context, globs, type, ignore rules, sort order, output mode). Unsorted output comes out in
 * descending path order, so a tool that forgets to sort shows it.
 */
export function simulateRipgrep(tree: VFile[], root: string, args: string[], cwd: string): Reply {
	if (args.includes("--type-list")) return { stdout: Object.entries(TYPES).map(([name, globs]) => `${name}: ${globs.join(", ")}\n`).join("") };
	const flag = (name: string) => args.includes(name);
	const values = (name: string) => args.flatMap((arg, i) => args[i - 1] === name ? [arg] : []);
	const iglobs = values("--iglob");
	const positives = iglobs.filter((glob) => !glob.startsWith("!"));
	const negatives = iglobs.filter((glob) => glob.startsWith("!")).map((glob) => glob.slice(1));
	const type = values("--type")[0];
	if (type && !TYPES[type]) return { code: 2, stderr: `rg: unrecognized file type: ${type}` };
	const target = args.at(-1)!;
	const prefix = relative(root, cwd).split("\\").join("/");
	const underBase = (file: VFile) => prefix === "" || file.path.startsWith(`${prefix}/`);
	const local = (file: VFile) => (prefix === "" ? file.path : file.path.slice(prefix.length + 1));
	const candidates = tree.filter(underBase).filter((file) => target === "." || local(file) === target).map((file) => ({ file, rel: local(file) }));

	const kept = candidates.filter(({ file, rel }) => {
		if (!flag("--hidden") && rel.split("/").some((part) => part.startsWith("."))) return false;
		const whitelisted = positives.some((glob) => matchesGlob(glob, rel));
		if (file.ignored && !flag("--no-ignore") && !whitelisted) return false;
		if (positives.length > 0 && !whitelisted) return false;
		if (positives.length === 0 && type && !TYPES[type].some((glob) => matchesGlob(glob, rel))) return false;
		return !negatives.some((glob) => withAncestors(rel).some((part) => matchesGlob(glob, part)));
	});
	const order = flag("--sortr") ? (a: typeof kept[0], b: typeof kept[0]) => (b.file.mtime ?? 0) - (a.file.mtime ?? 0)
		: flag("--sort") ? (a: typeof kept[0], b: typeof kept[0]) => (a.rel < b.rel ? -1 : 1)
		: (a: typeof kept[0], b: typeof kept[0]) => (a.rel < b.rel ? 1 : -1);
	const files = [...kept].sort(order);
	const shown = (rel: string) => (target === "." ? `./${rel}` : rel);

	if (flag("--files")) return files.length ? { stdout: files.map(({ rel }) => `${shown(rel)}\0`).join("") } : { code: 1 };

	const pattern = args.find((arg) => arg.startsWith("--regexp="))!.slice("--regexp=".length);
	const multiline = flag("--multiline");
	let regex: RegExp;
	try {
		regex = new RegExp(pattern, `${flag("--ignore-case") ? "i" : ""}${multiline ? "gs" : ""}`);
	} catch (error: any) {
		return { code: 2, stderr: `rg: regex parse error:\n    ${pattern}\nerror: ${error.message}` };
	}
	const after = Number(values("--after-context")[0] ?? 0);
	const before = Number(values("--before-context")[0] ?? 0);
	type Hit = { start: number; end: number; lines: string[] };
	const hitsOf = (file: VFile): { lines: string[]; hits: Hit[] } => {
		const lines = (file.text ?? "").replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
		const hits: Hit[] = [];
		if (multiline) {
			const whole = lines.join("\n");
			for (const found of whole.matchAll(regex)) {
				const start = whole.slice(0, found.index).split("\n").length;
				const span = found[0].split("\n");
				hits.push({ start, end: start + span.length - 1, lines: lines.slice(start - 1, start - 1 + span.length) });
			}
		} else {
			lines.forEach((line, i) => { if (regex.test(line)) hits.push({ start: i + 1, end: i + 1, lines: [line] }); });
		}
		return { lines, hits };
	};
	const searched = files.map(({ file, rel }) => ({ rel, ...hitsOf(file) })).filter((one) => one.hits.length > 0);
	if (searched.length === 0) return { code: 1 };
	if (flag("--files-with-matches")) return { stdout: searched.map(({ rel }) => `${shown(rel)}\0`).join("") };
	if (flag("--count")) return { stdout: searched.map(({ rel, hits }) => `${shown(rel)}\0${hits.length}\n`).join("") };

	const text = (value: string) => ({ text: `${value}\n` });
	const events: unknown[] = [];
	for (const { rel, lines, hits } of searched) {
		const path = { text: shown(rel) };
		events.push({ type: "begin", data: { path } });
		const emitted = new Set<number>();
		for (const hit of hits) {
			for (let n = Math.max(1, hit.start - before); n < hit.start; n++) {
				if (emitted.has(n) || hits.some((other) => n >= other.start && n <= other.end)) continue;
				emitted.add(n);
				events.push({ type: "context", data: { path, lines: text(lines[n - 1]), line_number: n } });
			}
			emitted.add(hit.start);
			events.push({ type: "match", data: { path, lines: text(hit.lines.join("\n")), line_number: hit.start, submatches: [] } });
			for (let n = hit.end + 1; n <= Math.min(lines.length, hit.end + after); n++) {
				if (emitted.has(n) || hits.some((other) => n >= other.start && n <= other.end)) continue;
				emitted.add(n);
				events.push({ type: "context", data: { path, lines: text(lines[n - 1]), line_number: n } });
			}
		}
		events.push({ type: "end", data: { path } });
	}
	return { stdout: jsonLines(events) };
}

/** ripgrep replaced at the process spawn: the handler answers each command, nothing else runs. */
export class FakeRipgrep {
	calls: string[][] = [];
	binaries: string[] = [];
	spawnOptions: any[] = [];
	killed = 0;
	/** What Pi's `rg --version` probe finds: a status 0 reply, or a missing program. */
	probeFinds = true;
	tree: VFile[] = [];
	root = "";
	handler: (args: string[], options: any) => Reply = (args, options) => simulateRipgrep(this.tree, this.root, args, options.cwd);
	private original = { spawn: childProcess.spawn, spawnSync: childProcess.spawnSync };
	private waiting: Array<{ count: number; resolve: () => void }> = [];

	/** Resolves once rg has been started `count` times in total. */
	started(count = 1): Promise<void> {
		if (this.calls.length >= count) return Promise.resolve();
		return new Promise((resolve) => this.waiting.push({ count, resolve }));
	}

	spawn = (binary: string, args: string[], options: any) => {
		this.calls.push(args);
		this.binaries.push(binary);
		this.spawnOptions.push(options);
		const reply = this.handler(args, options);
		const child: any = new EventEmitter();
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.killed = false;
		child.kill = () => {
			if (child.killed) return;
			child.killed = true;
			this.killed++;
			child.stdout.destroy();
			child.stderr.destroy();
			setImmediate(() => child.emit("close", null));
		};
		setImmediate(() => {
			if (reply.hang || child.killed) return;
			if (reply.stderr) child.stderr.write(reply.stderr);
			const data = Buffer.from(reply.stdout ?? "", "utf8");
			const size = reply.chunkBytes ?? (data.length || 1);
			for (let at = 0; at < data.length && !child.killed; at += size) child.stdout.write(data.subarray(at, at + size));
			if (child.killed) return;
			// A real process closes after its output has been read.
			child.stdout.once("end", () => setImmediate(() => {
				if (child.killed) return;
				child.emit("close", reply.code ?? 0);
				reply.afterClose?.();
			}));
			child.stderr.end();
			child.stdout.end();
		});
		for (const waiter of this.waiting.filter((one) => this.calls.length >= one.count)) waiter.resolve();
		this.waiting = this.waiting.filter((one) => this.calls.length < one.count);
		return child;
	};

	/** Pi only asks whether rg exists; every other command goes to the real spawnSync. */
	spawnSync = (command: string, args: string[], ...rest: unknown[]) => {
		const isProbe = ["rg", "fd", "fdfind"].includes(basename(command).replace(/\.exe$/, "")) && args.join(" ") === "--version";
		if (!isProbe) return (this.original.spawnSync as any)(command, args, ...rest);
		return this.probeFinds ? { status: 0, error: undefined } : { status: null, error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }) };
	};

	install(t: TestContext): this {
		childProcess.spawn = this.spawn;
		childProcess.spawnSync = this.spawnSync;
		syncBuiltinESMExports();
		t.after(() => {
			Object.assign(childProcess, this.original);
			syncBuiltinESMExports();
		});
		return this;
	}
}

export const jsonLines = (events: unknown[]) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";

/** One file of `rg --json` output: its match lines (and context lines) in file order. */
export function fileEvents(file: string, lines: Array<{ n: number; text: string; match?: boolean }>): unknown[] {
	const text = (value: string) => ({ text: value + "\n" });
	return [
		{ type: "begin", data: { path: { text: file } } },
		...lines.map((line) => ({
			type: line.match === false ? "context" : "match",
			data: { path: { text: file }, lines: text(line.text), line_number: line.n, submatches: [] },
		})),
		{ type: "end", data: { path: { text: file } } },
	];
}

export interface Project {
	cwd: string;
	abs: (...parts: string[]) => string;
	rg: FakeRipgrep;
	search: (params: any, options?: any) => Promise<string>;
	glob: (params: any, options?: any) => Promise<string>;
}

/** A real project folder (its `src` exists) and a simulated rg that sees `tree`; `reply` replaces the simulation. */
export async function project(t: TestContext, tree: VFile[] = [], reply?: Reply | ((args: string[], options: any) => Reply)): Promise<Project> {
	const cwd = await mkdtemp(join(tmpdir(), "rqw-rg-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	await mkdir(join(cwd, "src"));
	await writeFile(join(cwd, "src", "a.ts"), "x\n");
	const rg = new FakeRipgrep().install(t);
	rg.tree = tree;
	rg.root = cwd;
	if (reply) rg.handler = typeof reply === "function" ? reply : () => reply;
	const abs = (...parts: string[]) => join(cwd, ...parts);
	const search = async (params: any, options?: any) => {
		const tool: any = createRgToolDefinition(cwd, options);
		const result = await tool.execute("call-1", tool.prepareArguments(params), undefined, undefined, { cwd });
		return result.content[0].text as string;
	};
	const glob = async (params: any, options?: any) => {
		const tool: any = createGlobToolDefinition(cwd, options);
		const result = await tool.execute("call-1", tool.prepareArguments(params), undefined, undefined, { cwd });
		return result.content[0].text as string;
	};
	return { cwd, abs, rg, search, glob };
}

/** `count` files-lines of the same word, as a one-file tree: the line texts are "hit 1", "hit 2", ... */
export const manyHits = (path: string, count: number, word = "hit"): VFile => ({
	path,
	text: Array.from({ length: count }, (_unused, i) => `${word} ${i + 1}`).join("\n"),
});
