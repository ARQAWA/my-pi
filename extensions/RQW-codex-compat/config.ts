// Read-only view of the Codex configuration layers that matter for skills and AGENTS.md.
// Mirrors codex-rs config loader rules: layers system < user < trusted project, trust from `projects.*.trust_level`.
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parse } from "smol-toml";

export type Table = Record<string, unknown>;
export type Trust = "trusted" | "untrusted" | undefined;

export interface Env {
	/** `$CODEX_HOME`, default `~/.codex`. */
	codexHome: string;
	home: string;
	/** Administrative Codex folder; absent on systems without one. */
	systemDir?: string;
	/** Pi's agent directory (`getAgentDir()`). */
	agentDir: string;
}

export interface ProjectLayer {
	dir: string;
	folder: string;
	trusted: boolean;
	config: Table;
}

export interface CodexContext {
	cwd: string;
	env: Env;
	/** The user config: the layer that sets `project_root_markers` and trust. */
	base: Table;
	user: Table;
	markers: string[];
	root: string;
	/** Directories from the project root down to cwd, inclusive. */
	dirs: string[];
	/** Active-project trust of cwd (cwd entry first, then the main checkout). */
	trust: Trust;
	/** Existing `.codex` folders from root to cwd with their trust. */
	layers: ProjectLayer[];
	/** System, user and trusted project layers merged low to high. */
	effective: Table;
}

export const isTable = (value: unknown): value is Table =>
	value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

export function defaultEnv(agentDir: string): Env {
	return {
		codexHome: resolve(process.env.CODEX_HOME || join(homedir(), ".codex")),
		home: homedir(),
		systemDir: process.platform === "win32" ? undefined : "/etc/codex",
		agentDir,
	};
}

export function isDirectory(path: string): boolean {
	try { return statSync(path).isDirectory(); } catch { return false; }
}

export function isFile(path: string): boolean {
	try { return statSync(path).isFile(); } catch { return false; }
}

function exists(path: string): boolean {
	try { statSync(path); return true; } catch { return false; }
}

export function readToml(path: string): Table {
	try {
		const parsed = parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)));
		return isTable(parsed) ? parsed : {};
	} catch { return {}; }
}

export function mergeTables(low: Table, high: Table): Table {
	const out: Table = { ...low };
	for (const [key, value] of Object.entries(high)) {
		out[key] = isTable(value) && isTable(out[key]) ? mergeTables(out[key] as Table, value) : value;
	}
	return out;
}

const lookupKey = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;

function trustKeys(path: string): string[] {
	const plain = lookupKey(path);
	let real = plain;
	try { real = lookupKey(realpathSync(path)); } catch { /* keep the plain key */ }
	return real === plain ? [real] : [real, plain];
}

// `.agents/skills` and `AGENTS.md` roots accept any existing marker (host_roots.rs, agents_md.rs). The project-layer root
// of the config loader skips a `.git` directory without HEAD (loader/mod.rs discover_project_root): `strict`.
const markerFound = (directory: string, marker: string, strict: boolean) =>
	exists(join(directory, marker)) && !(strict && marker === ".git" && isDirectory(join(directory, marker)) && !exists(join(directory, marker, "HEAD")));

const MAX_GIT_METADATA_BYTES = 64 * 1024;

/** A small regular file, not a symlink, as Codex reads git metadata. */
function metadataFile(path: string): string | undefined {
	try {
		const info = lstatSync(path);
		if (!info.isFile() || info.size > MAX_GIT_METADATA_BYTES) return undefined;
		return readFileSync(path, "utf8");
	} catch { return undefined; }
}

/** The target of a `gitdir: <path>` pointer file, resolved against the file's folder. */
function gitdirTarget(file: string): string | undefined {
	const text = metadataFile(file)?.trim();
	const target = text?.startsWith("gitdir:") ? text.slice("gitdir:".length).trim() : "";
	return target ? resolve(dirname(file), target) : undefined;
}

/**
 * The trust root of a repository, as codex-rs `resolve_root_git_project_for_trust`: the main checkout. A `.git`
 * directory without HEAD is skipped; a `.git` directory is its own root. A linked worktree must prove its link: the
 * `gitdir` and `commondir` files of `<common>/worktrees/<name>` are both required and must lead back to the checkout
 * and to the common directory, and the main checkout must own that common directory (a separate git directory works).
 */
function trustRoot(cwd: string): string | undefined {
	try {
		let base = isDirectory(cwd) ? cwd : dirname(cwd);
		let root: string | undefined;
		while (root === undefined) {
			const found = ancestors(base).find(dir => exists(join(dir, ".git")));
			if (found === undefined) return undefined;
			if (!isDirectory(join(found, ".git")) || exists(join(found, ".git", "HEAD"))) root = found;
			else if (dirname(found) === found) return undefined;
			else base = dirname(found);
		}
		const dotGit = join(root, ".git");
		if (isDirectory(dotGit)) return root;
		const gitDir = gitdirTarget(dotGit);
		if (gitDir === undefined || lstatSync(dotGit).isSymbolicLink() || lstatSync(gitDir).isSymbolicLink() || !isDirectory(gitDir)) return undefined;
		const canonical = realpathSync(gitDir);
		if (basename(dirname(canonical)) !== "worktrees") return undefined;
		const commonDir = dirname(dirname(canonical));
		const registered = metadataFile(join(canonical, "gitdir"))?.trim();
		const linked = metadataFile(join(canonical, "commondir"))?.trim();
		if (!registered || !linked) return undefined;
		const worktreeDotGit = resolve(canonical, registered);
		if (basename(worktreeDotGit) !== ".git") return undefined;
		if (realpathSync(dirname(worktreeDotGit)) !== realpathSync(root) || realpathSync(resolve(canonical, linked)) !== commonDir) return undefined;
		const mainRoot = dirname(dirname(dirname(gitDir)));
		const mainDotGit = join(mainRoot, ".git");
		const mainGitDir = isDirectory(mainDotGit) ? mainDotGit : gitdirTarget(mainDotGit);
		return mainGitDir !== undefined && realpathSync(mainGitDir) === commonDir ? mainRoot : undefined;
	} catch { return undefined; }
}

function ancestors(start: string): string[] {
	const out: string[] = [];
	for (let dir = start; ; dir = dirname(dir)) {
		out.push(dir);
		if (dirname(dir) === dir) return out;
	}
}

/** Markers from the user config; unset means `.git`, an empty list disables parent traversal. */
function rootMarkers(base: Table): string[] {
	const value = base.project_root_markers;
	if (Array.isArray(value) && value.every(item => typeof item === "string")) return value as string[];
	return [".git"];
}

function projectEntries(config: Table): Map<string, Trust> {
	const entries = new Map<string, Trust>();
	const projects = isTable(config.projects) ? config.projects : {};
	for (const [key, value] of Object.entries(projects)) {
		if (!isTable(value)) continue;
		entries.set(lookupKey(key), value.trust_level === "trusted" || value.trust_level === "untrusted" ? value.trust_level : undefined);
	}
	return entries;
}

/** Layer trust: the first key with a trust level; entries without a level are skipped (codex-rs config loader). */
function layerTrust(entries: Map<string, Trust>, keys: string[]): Trust {
	for (const key of keys) if (entries.get(key) !== undefined) return entries.get(key);
	return undefined;
}

/** Active project: the first key with an entry at all decides, a level-less cwd entry included (codex-rs project_trust.rs). */
function activeTrust(entries: Map<string, Trust>, keys: string[]): Trust {
	for (const key of keys) if (entries.has(key)) return entries.get(key);
	return undefined;
}

export function loadContext(cwdInput: string, env: Env): CodexContext {
	const cwd = resolve(cwdInput);
	// Administrative and managed Codex config is not supported: only the user config is read.
	const user = readToml(join(env.codexHome, "config.toml"));
	const base = user;
	const markers = rootMarkers(base);
	const chain = ancestors(cwd);
	const rootFor = (strict: boolean) => (markers.length === 0 ? undefined : chain.find(dir => markers.some(marker => markerFound(dir, marker, strict)))) ?? cwd;
	const upTo = (root: string) => chain.slice(0, chain.indexOf(root) + 1).reverse();
	const root = rootFor(false);
	const dirs = upTo(root);
	const layerRoot = rootFor(true);
	const repoRoot = trustRoot(cwd);

	// Trust comes from the user config, with the layer root of the config loader.
	const entries = projectEntries(base);
	const trustOf = (dir: string): Trust =>
		layerTrust(entries, trustKeys(dir)) ?? layerTrust(entries, trustKeys(layerRoot))
		?? (repoRoot === undefined ? undefined : layerTrust(entries, trustKeys(repoRoot)));
	const active = activeTrust(entries, [...trustKeys(cwd), ...(repoRoot === undefined ? [] : trustKeys(repoRoot))]);

	const home = resolve(env.codexHome);
	const layers: ProjectLayer[] = [];
	for (const dir of upTo(layerRoot)) {
		const folder = join(dir, ".codex");
		if (!isDirectory(folder) || resolve(folder) === home) continue;
		const trusted = trustOf(dir) === "trusted";
		layers.push({ dir, folder, trusted, config: trusted ? readToml(join(folder, "config.toml")) : {} });
	}
	let effective = base;
	for (const layer of layers) if (layer.trusted) effective = mergeTables(effective, layer.config);
	return { cwd, env, base, user, markers, root, dirs, trust: active, layers, effective };
}
