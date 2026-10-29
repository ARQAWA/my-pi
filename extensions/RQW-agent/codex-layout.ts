import fs from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parse } from "smol-toml";

type Table = Record<string, unknown>;
const table = (value: unknown): value is Table => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
const exists = (path: string) => fs.stat(path).then(() => true, () => false);
const key = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;

async function readTable(path: string): Promise<Table> {
	try {
		const data = parse(new TextDecoder("utf-8", { fatal: true }).decode(await fs.readFile(path)));
		return table(data) ? data : {};
	} catch { return {}; }
}

async function trustKeys(path: string): Promise<string[]> {
	const plain = key(path);
	const real = key(await fs.realpath(path).catch(() => path));
	return real === plain ? [real] : [real, plain];
}

const MAX_GIT_METADATA_BYTES = 64 * 1024;
const isDirectory = (path: string) => fs.stat(path).then(info => info.isDirectory(), () => false);

/** A small regular file, not a symlink, as Codex reads git metadata. */
async function metadataFile(path: string): Promise<string | undefined> {
	try {
		const info = await fs.lstat(path);
		return info.isFile() && info.size <= MAX_GIT_METADATA_BYTES ? await fs.readFile(path, "utf8") : undefined;
	} catch { return undefined; }
}

/** The target of a `gitdir: <path>` pointer file, resolved against the file's folder. */
async function gitdirTarget(file: string): Promise<string | undefined> {
	const text = (await metadataFile(file))?.trim();
	const target = text?.startsWith("gitdir:") ? text.slice("gitdir:".length).trim() : "";
	return target ? resolve(dirname(file), target) : undefined;
}

/**
 * The trust root of a repository, as codex-rs `resolve_root_git_project_for_trust`: the main checkout. A `.git`
 * directory without HEAD is skipped; a `.git` directory is its own root. A linked worktree must prove its link: the
 * `gitdir` and `commondir` files of `<common>/worktrees/<name>` are both required and must lead back to the checkout
 * and to the common directory, and the main checkout must own that common directory (a separate git directory works).
 */
async function trustRoot(cwd: string, chain: string[]): Promise<string | undefined> {
	try {
		let from = chain.indexOf(cwd);
		let root: string | undefined;
		while (root === undefined) {
			const found = (await Promise.all(chain.slice(from).map(async dir => await exists(join(dir, ".git")) ? dir : undefined))).find(Boolean);
			if (found === undefined) return undefined;
			if (!(await isDirectory(join(found, ".git"))) || await exists(join(found, ".git", "HEAD"))) root = found;
			else if (dirname(found) === found) return undefined;
			else from = chain.indexOf(dirname(found));
		}
		const dotGit = join(root, ".git");
		if (await isDirectory(dotGit)) return root;
		const gitDir = await gitdirTarget(dotGit);
		if (gitDir === undefined || (await fs.lstat(dotGit)).isSymbolicLink() || (await fs.lstat(gitDir)).isSymbolicLink() || !(await isDirectory(gitDir))) return undefined;
		const canonical = await fs.realpath(gitDir);
		if (basename(dirname(canonical)) !== "worktrees") return undefined;
		const commonDir = dirname(dirname(canonical));
		const registered = (await metadataFile(join(canonical, "gitdir")))?.trim();
		const linked = (await metadataFile(join(canonical, "commondir")))?.trim();
		if (!registered || !linked) return undefined;
		const worktreeDotGit = resolve(canonical, registered);
		if (basename(worktreeDotGit) !== ".git") return undefined;
		if (await fs.realpath(dirname(worktreeDotGit)) !== await fs.realpath(root) || await fs.realpath(resolve(canonical, linked)) !== commonDir) return undefined;
		const mainRoot = dirname(dirname(dirname(gitDir)));
		const mainDotGit = join(mainRoot, ".git");
		const mainGitDir = await isDirectory(mainDotGit) ? mainDotGit : await gitdirTarget(mainDotGit);
		return mainGitDir !== undefined && await fs.realpath(mainGitDir) === commonDir ? mainRoot : undefined;
	} catch { return undefined; }
}

export interface CodexLayout {
	/** Directories from the project root to cwd, inclusive. */
	dirs: string[];
	/** Codex project trust of a directory's `.codex` layer: `projects.*.trust_level = "trusted"`. */
	trusted(dir: string): Promise<boolean>;
}

/**
 * The Codex project layers as codex-rs loads them, from the user config only (administrative and managed Codex config
 * is not supported). The root of the config loader is the nearest directory
 * with a `project_root_markers` entry (default `.git`, where a `.git` directory without HEAD does not count; none or an
 * empty list leaves cwd). Trust is looked up for the directory, then that root, then the main checkout of the worktree.
 */
export async function codexLayout(cwdInput: string, codexHome: string): Promise<CodexLayout> {
	const cwd = resolve(cwdInput);
	const config = await readTable(join(codexHome, "config.toml"));
	const configured = config.project_root_markers;
	const markers = Array.isArray(configured) && configured.every(item => typeof item === "string") ? configured as string[] : [".git"];
	const chain: string[] = [];
	for (let dir = cwd; ; dir = dirname(dir)) {
		chain.push(dir);
		if (dirname(dir) === dir) break;
	}
	let root = cwd;
	search: for (const dir of markers.length === 0 ? [] : chain) {
		for (const marker of markers) {
			const path = join(dir, marker);
			if (!(await exists(path))) continue;
			if (marker === ".git" && await isDirectory(path) && !(await exists(join(path, "HEAD")))) continue;
			root = dir;
			break search;
		}
	}
	const repoRoot = await trustRoot(cwd, chain);

	const levels = new Map<string, unknown>();
	if (table(config.projects)) {
		for (const [path, value] of Object.entries(config.projects)) if (table(value)) levels.set(key(path), value.trust_level);
	}
	const decide = async (path: string) => {
		for (const candidate of await trustKeys(path)) {
			const level = levels.get(candidate);
			if (level === "trusted" || level === "untrusted") return level;
		}
		return undefined;
	};
	const trusted = async (dir: string) =>
		(await decide(dir) ?? await decide(root) ?? (repoRoot === undefined ? undefined : await decide(repoRoot))) === "trusted";
	return { dirs: chain.slice(0, chain.indexOf(root) + 1).reverse(), trusted };
}
