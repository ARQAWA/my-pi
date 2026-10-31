import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** Drive letters that Git Bash, WSL and Cygwin write as /c/, /mnt/c/ and /cygdrive/c/. */
const POSIX_DRIVE = /^\/(?:(?:mnt|cygdrive)\/)?([a-zA-Z])(\/.*)?$/;

/** An input path resolved against cwd; on Windows also the POSIX-style drive spellings, never the regex or glob text. */
export function resolveInputPath(input: string | undefined, cwd: string, platform: NodeJS.Platform = process.platform): string {
	const api = platform === "win32" ? path.win32 : path.posix;
	let value = input || ".";
	if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) value = api.join(homedir(), value.slice(1));
	if (platform === "win32") {
		value = value.replace(POSIX_DRIVE, (_whole, drive: string, rest: string | undefined) => `${drive.toUpperCase()}:${rest ?? "/"}`);
	}
	return api.resolve(cwd, value);
}

/** Whole folder names that a broad search skips: version control, dependencies and tool caches. */
export const NOISE_DIRS = [
	".git", "node_modules", "__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache", ".cache", ".tox", ".nox",
	".venv", "venv", ".turbo", ".next", ".nuxt", ".pnpm", ".yarn", ".nyc_output",
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Names the user asked for: a folder on the search path, or a folder named in the glob (a bare * does not count). */
function askedFor(name: string, root: string, glob: string | undefined): boolean {
	if (root.split(/[\\/]/).some((part) => part.toLowerCase() === name)) return true;
	return glob !== undefined && new RegExp(`(^|[/{,!])${escapeRegExp(name)}($|[/},*])`, "i").test(glob);
}

export type SearchPolicy = {
	/** Negated --iglob patterns that keep the noise folders out of a broad search. */
	excludes: string[];
	/** Looks at these files' real paths (one pass per file, shared between calls) so `allows` can answer. */
	check(files: string[], signal: AbortSignal | undefined): Promise<void>;
	/** Whether a checked file stays: it does not reach a noise folder through a symlink. */
	allows(file: string): boolean;
};

/**
 * Noise is not a ban: the folders of the search path and those named in the glob stay searchable, and a
 * file can still be read by its path. Symlinks are followed, so the real path of every result is checked too.
 */
export async function createPolicy(root: string, glob: string | undefined, isDirectory: boolean): Promise<SearchPolicy> {
	const active = NOISE_DIRS.filter((name) => !askedFor(name, root, glob));
	const excludes = active.map((name) => `!**/${name}`);
	if (!isDirectory || active.length === 0) return { excludes, check: async () => {}, allows: () => true };
	const noisy = new Set(active);
	const realRoot = await realpath(root).catch(() => root);
	const dirVerdicts = new Map<string, Promise<boolean>>();
	const verdicts = new Map<string, boolean>();

	/** False when the real path of `target` lies in a noise folder although its path under the root does not. */
	const realPathAllowed = async (target: string, isFile: boolean): Promise<boolean> => {
		let real: string;
		try {
			real = await realpath(target);
		} catch {
			return true;
		}
		const lexicalRelative = path.relative(root, target);
		const realRelative = path.relative(realRoot, real);
		if (lexicalRelative === realRelative) return true;
		const location = realRelative.startsWith("..") ? beyondCommonPrefix(real, realRoot) : realRelative;
		const folders = isFile ? location.split(/[\\/]/).slice(0, -1) : location.split(/[\\/]/);
		return !folders.some((part) => noisy.has(part.toLowerCase()));
	};
	const dirAllowed = (dir: string): Promise<boolean> => {
		let known = dirVerdicts.get(dir);
		if (!known) {
			known = realPathAllowed(dir, false);
			dirVerdicts.set(dir, known);
		}
		return known;
	};
	const fileAllowed = async (file: string): Promise<boolean> => {
		if (!(await dirAllowed(path.dirname(file)))) return false;
		try {
			if (!(await lstat(file)).isSymbolicLink()) return true;
		} catch {
			return true;
		}
		return realPathAllowed(file, true);
	};
	return {
		excludes,
		async check(files, signal) {
			const unknown = [...new Set(files)].filter((file) => !verdicts.has(file));
			for (let at = 0; at < unknown.length; at += CHECK_BATCH) {
				if (signal?.aborted) throw new Error("Operation aborted");
				const batch = unknown.slice(at, at + CHECK_BATCH);
				const answers = await Promise.all(batch.map(fileAllowed));
				batch.forEach((file, index) => verdicts.set(file, answers[index]));
			}
			if (signal?.aborted) throw new Error("Operation aborted");
		},
		allows: (file) => verdicts.get(file) ?? true,
	};
}

const CHECK_BATCH = 64;

/** The part of a real path that lies outside the search root, after the folders both share. */
function beyondCommonPrefix(real: string, realRoot: string): string {
	const own = real.split(/[\\/]/);
	const shared = realRoot.split(/[\\/]/);
	let common = 0;
	while (common < own.length && common < shared.length && own[common] === shared[common]) common++;
	return own.slice(common).join("/");
}
