// Git facts owned by the bar: repository discovery, branch and file counts.
import { execFile } from "node:child_process";
import { readFileSync, type Stats, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { type GitCounts, parsePorcelain } from "./render.ts";

export interface RepoInfo {
	/** The working tree root (the folder that holds `.git`). */
	root: string;
	/** Set for a linked worktree: the main repository's folder name and this worktree's folder name. */
	worktree?: { project: string; name: string };
}

/** Walks up from cwd to the first `.git`; a `.git` file means a linked worktree (`gitdir:` plus `commondir`). */
export function findRepo(cwd: string): RepoInfo | undefined {
	let dir = resolve(cwd);
	for (;;) {
		const dotGit = join(dir, ".git");
		let stat: Stats | undefined;
		try {
			stat = statSync(dotGit);
		} catch {
			stat = undefined;
		}
		if (stat?.isDirectory()) return { root: dir };
		if (stat?.isFile()) return { root: dir, worktree: worktreeOf(dir, dotGit) };
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

function worktreeOf(root: string, dotGitFile: string): RepoInfo["worktree"] {
	try {
		const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGitFile, "utf8"));
		if (!match) return undefined;
		const gitDir = resolve(root, match[1].trim());
		const common = readFileSync(join(gitDir, "commondir"), "utf8").trim();
		const commonDir = isAbsolute(common) ? common : resolve(gitDir, common);
		// A submodule's `.git` file points into the parent's modules and has no commondir: not a worktree.
		return { project: basename(dirname(commonDir)), name: basename(root) };
	} catch {
		return undefined;
	}
}

/** Counts of staged, unstaged and untracked files; undefined when git fails or is missing. */
export function gitCounts(root: string): Promise<GitCounts | undefined> {
	const { promise, resolve: done } = Promise.withResolvers<GitCounts | undefined>();
	execFile(
		"git",
		["--no-optional-locks", "status", "--porcelain=v1", "-z"],
		{ cwd: root, timeout: 5000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
		(error, stdout) => done(error ? undefined : parsePorcelain(stdout)),
	);
	return promise;
}

/** Live branch, including unborn branches; detached HEAD matches Pi's footer label. */
export function gitBranch(root: string): Promise<string | null> {
	return new Promise((done) => {
		execFile(
			"git",
			["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"],
			{ cwd: root, timeout: 5000, windowsHide: true },
			(error, stdout) => done(error ? (error.code === 1 ? "detached" : null) : stdout.trim() || null),
		);
	});
}
