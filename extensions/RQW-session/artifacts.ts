import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { setImmediate } from "node:timers/promises";

const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";
const inside = (root: string, path: string) => {
	const rel = relative(root, path);
	return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const referenceText = (s: string) => {
	const text = s.replaceAll("\\", "/");
	return process.platform === "win32" ? text.toLowerCase() : text;
};
// Pi 1.4.0 output-files.js: randomBytes(8).toString("hex"); clipboard paste: crypto.randomUUID().
const OUTPUT_NAME = "pi-(?:bash|powershell|output|codemode|mcp)-[a-f0-9]{16}";
const CLIPBOARD_NAME = "pi-clipboard-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const ARTIFACT_NAME = `(?:${OUTPUT_NAME}|${CLIPBOARD_NAME})\\.[A-Za-z0-9]{1,8}`;

/** One combined path search per normalized string. Metadata keys cannot bypass the generated-name restriction. */
function referenceScanner(roots: string[]) {
	const prefixes = [...new Set(roots.map(root => referenceText(resolve(root))))].map(escape).join("|");
	const pattern = new RegExp(`(?<![A-Za-z0-9_./-])((?:${prefixes})/)|(?<=/)(${ARTIFACT_NAME})(?![A-Za-z0-9._/-])`, "g");
	return (value: unknown): Set<string> => {
		const found = new Set<string>();
		const visit = (v: unknown) => {
			if (typeof v === "string") {
				const normalized = referenceText(v);
				let start: number | undefined;
				for (const match of normalized.matchAll(pattern)) {
					if (match[1]) { start = match.index; continue; }
					if (start === undefined) continue;
					const path = normalized.slice(start, match.index! + match[0].length);
					start = undefined;
					if (!/[\r\n\"'<>|]/.test(path) && isAbsolute(path) && !path.split("/").includes("..")) found.add(resolve(path));
				}
			} else if (Array.isArray(v)) v.forEach(visit);
			else if (v && typeof v === "object") Object.values(v).forEach(visit);
		};
		visit(value);
		return found;
	};
}
export function references(value: unknown, roots: string[]): Set<string> { return referenceScanner(roots)(value); }

/** A damaged final JSONL line can still name shared files. Decode JSON escapes without requiring valid JSON. */
function unescapeLine(line: string): string {
	return line.replace(/\\(?:u([a-fA-F0-9]{4})|(["\\/bfnrt]))/g, (_match, hex: string | undefined, escaped: string) => {
		if (hex) return String.fromCharCode(parseInt(hex, 16));
		return ({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" } as Record<string, string>)[escaped] ?? escaped;
	});
}

async function readReferences(path: string, scan: ReturnType<typeof referenceScanner>): Promise<Set<string>> {
	const refs = new Set<string>();
	const input = createReadStream(path, { encoding: "utf8" });
	const closed = new Promise<void>(done => input.once("close", done));
	const lines = createInterface({ input, crlfDelay: Infinity });
	try {
		let count = 0;
		for await (const line of lines) {
			let value: unknown;
			try { value = JSON.parse(line); }
			catch { value = unescapeLine(line); } // Pi skips malformed lines; protect any recognizable raw references.
			for (const ref of scan(value)) refs.add(ref);
			if (++count % 512 === 0) await setImmediate();
		}
	} catch (error) {
		if (!missing(error)) throw new Error(`Cannot read session ${path}: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		lines.close();
		input.destroy();
		await closed; // Windows must see the read handle closed before unlinking the current JSONL.
	}
	return refs;
}

async function sessionFiles(dir: string): Promise<string[]> {
	let children;
	try {
		if ((await lstat(dir)).isSymbolicLink()) throw new Error("session directory is a symlink");
		children = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (missing(error)) return [];
		throw new Error(`Cannot scan sessions at ${dir}: ${error instanceof Error ? error.message : String(error)}`);
	}
	const result: string[] = [];
	for (const child of children) {
		const path = join(dir, child.name);
		if (child.isDirectory()) result.push(...await sessionFiles(path));
		else if (child.isFile() && child.name.endsWith(".jsonl")) result.push(path);
		else if (child.isSymbolicLink()) throw new Error(`Cannot safely scan session symlink: ${path}`);
	}
	return result;
}

/** Canonicalize only regular files whose lexical AND physical locations are inside approved roots. */
export async function regular(path: string, roots: string[]): Promise<string | undefined> {
	if (!isAbsolute(path) || path.split(/[\\/]/).includes("..")) return;
	const absolute = resolve(path);
	if (!roots.some(root => inside(resolve(root), absolute))) return;
	try {
		if (!(await lstat(absolute)).isFile()) return;
		const physical = await realpath(absolute);
		const canonicalRoots = await Promise.all(roots.map(root => realpath(root)));
		if (canonicalRoots.some(root => inside(root, physical))) return physical;
	} catch (error) { if (!missing(error)) throw error; }
}

export async function validateSessionFile(file: string | undefined, agentDir: string): Promise<void> {
	if (!file) return;
	if (!inside(resolve(agentDir), resolve(file))) throw new Error(`Session file is outside Pi's agent directory; refusing removal: ${file}`);
	try {
		await lstat(file);
		if (!(await regular(file, [agentDir]))) throw new Error(`Session file is not a safe regular file; refusing removal: ${file}`);
	} catch (error) { if (!missing(error)) throw error; }
}

const CHILDREN_SUFFIX = ".children";
export type ChildTree = { root: string; files: string[]; dirs: string[] };

/**
 * Exact owned tree of a session: `<file>.children/`, nested descendants use the same suffix next to their own JSONL.
 * Only regular files and real directories are accepted; anything else refuses removal (fail closed, no traversal).
 */
export async function childTree(file: string | undefined, agentDir: string): Promise<ChildTree | undefined> {
	if (!file) return;
	const root = resolve(file + CHILDREN_SUFFIX);
	let info;
	try { info = await lstat(root); }
	catch (error) { if (missing(error)) return; throw new Error(`Cannot inspect child session tree ${root}: ${error instanceof Error ? error.message : String(error)}`); }
	if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Child session tree is not a real directory: ${root}`);
	if (!inside(await realpath(agentDir), await realpath(root))) throw new Error(`Child session tree escapes Pi's agent directory: ${root}`);
	const tree: ChildTree = { root, files: [], dirs: [root] };
	const walk = async (dir: string): Promise<void> => {
		let entries;
		try { entries = await readdir(dir, { withFileTypes: true }); }
		catch (error) { throw new Error(`Cannot scan child session tree at ${dir}: ${error instanceof Error ? error.message : String(error)}`); }
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) { tree.dirs.push(path); await walk(path); }
			else if (entry.isFile()) tree.files.push(path);
			else throw new Error(`Cannot safely remove child session tree entry (symlink or special file): ${path}`);
		}
	};
	await walk(root);
	return tree;
}

export type RemovalPlan = {
	file: string | undefined;
	agentDir: string;
	roots: string[];
	shared: Set<string>;
	sessionPaths: Set<string>;
};

/** Validate and scan other sessions BEFORE switching, so a read/discovery refusal leaves the current session active. */
export async function prepareRemoval(file: string | undefined, agentDir: string): Promise<RemovalPlan> {
	await validateSessionFile(file, agentDir);
	const roots = [...new Set([tmpdir(), await realpath(tmpdir())])];
	const plan: RemovalPlan = { file, agentDir, roots, shared: new Set(), sessionPaths: new Set() };
	if (!file) return plan;
	const scan = referenceScanner(roots);
	const tree = await childTree(file, agentDir); // fail closed before newSession
	const files = new Set([...await sessionFiles(join(agentDir, "sessions")), ...await sessionFiles(dirname(file))]);
	const currentPhysical = await regular(file, [agentDir]);
	const refs = new Set<string>();
	for (const other of files) {
		const physical = await regular(other, [agentDir]);
		if (physical) plan.sessionPaths.add(referenceText(physical));
		if (resolve(other) === resolve(file) || physical && physical === currentPhysical) continue;
		if (tree && inside(tree.root, resolve(other))) continue; // removed descendants do not "share" anything
		for (const ref of await readReferences(other, scan)) refs.add(ref);
	}
	// A set of canonical identities replaces the old artifacts x aliases x transcript-bytes substring loop.
	for (const ref of refs) {
		plan.shared.add(referenceText(ref));
		try { plan.shared.add(referenceText(await realpath(ref))); }
		catch (error) {
			if (!missing(error)) throw new Error(`Cannot inspect shared artifact ${ref}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return plan;
}

/** Called after the old runtime shuts down. Read its final JSONL, including shutdown-hook output references. */
export async function removeFiles(plan: RemovalPlan): Promise<{ artifacts: number; children: number }> {
	const { file, agentDir, roots, shared, sessionPaths } = plan;
	if (!file) return { artifacts: 0, children: 0 };
	await validateSessionFile(file, agentDir);
	// Rescan the tree: descendants may have written final entries or sidecars since discovery.
	const tree = await childTree(file, agentDir);
	const scan = referenceScanner(roots);
	const candidates = await readReferences(file, scan);
	const descendants = tree ? tree.files.filter(path => path.endsWith(".jsonl")) : [];
	for (const path of descendants) for (const ref of await readReferences(path, scan)) candidates.add(ref);
	let removed = 0;
	for (const path of candidates) {
		const physical = await regular(path, roots);
		if (!physical || sessionPaths.has(referenceText(physical)) || shared.has(referenceText(physical))) continue;
		try { await unlink(physical); removed++; }
		catch (error) { if (!missing(error)) throw error; }
	}
	if (tree) {
		for (const path of tree.files) {
			try { await unlink(path); } catch (error) { if (!missing(error)) throw error; }
		}
		for (const dir of [...tree.dirs].reverse()) { // children before parents
			try { await rmdir(dir); } catch (error) { if (!missing(error)) throw error; }
		}
	}
	// The parent JSONL goes last: if the tree fails, it stays as the marker of unfinished removal.
	try { await unlink(file); }
	catch (error) { if (!missing(error)) throw error; }
	return { artifacts: removed, children: descendants.length };
}
