// Which paths Main may not edit or write: this checkout, the main checkout, every registered worktree and
// the sibling my-pi-worktrees folder. Paths are compared in canonical form (symlinks and `..` resolved).
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/** Pi's own path resolution for edit and write (`resolveToCwd`): unicode spaces, `@` prefix, `~`, file URLs, cwd. */
export function resolveToolPath(input: string, cwd: string): string {
	let p = input.replace(UNICODE_SPACES, " ");
	if (p.startsWith("@")) p = p.slice(1);
	if (process.platform === "win32") {
		const m = /^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i.exec(p);
		if (m && !p.startsWith("//") && !p.includes("\\")) p = `${m[1].toUpperCase()}:\\${m[2]?.replaceAll("/", "\\") ?? ""}`;
	}
	if (p === "~") p = homedir();
	else if (p.startsWith("~/") || (process.platform === "win32" && p.startsWith("~\\"))) p = join(homedir(), p.slice(2));
	if (/^file:\/\//.test(p)) p = fileURLToPath(p);
	return isAbsolute(p) ? resolve(p) : resolve(cwd, p);
}

/** The real path, also for a path whose tail does not exist yet; a dangling symlink is followed to its target. */
export function canonical(abs: string, depth = 0): string {
	try {
		return realpathSync.native(abs);
	} catch {}
	const parent = dirname(abs);
	if (parent === abs || depth > 40) return abs;
	try {
		if (lstatSync(abs).isSymbolicLink()) return canonical(resolve(canonical(parent, depth + 1), readlinkSync(abs)), depth + 1);
	} catch {}
	return join(canonical(parent, depth + 1), basename(abs));
}

// macOS and Windows file systems are case-insensitive by default.
const fold = (p: string) => (process.platform === "darwin" || process.platform === "win32" ? p.toLowerCase() : p);

export function isInside(path: string, root: string): boolean {
	const rel = relative(fold(root), fold(path));
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function readGitLink(file: string, base: string): string | undefined {
	const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(file, "utf8"));
	return m ? resolve(base, m[1]) : undefined;
}

/**
 * The protected roots for a checkout `root` (the folder that holds `.pi/extensions/coordinator-guard`). Git is read from
 * its files, not by running git: `.git` as a folder (main checkout) or as a `gitdir:` file (worktree).
 */
export function protectedRoots(root: string): string[] {
	const roots = new Set<string>([root]);
	let main = root;
	try {
		const dotGit = join(root, ".git");
		let common: string | undefined;
		if (statSync(dotGit).isDirectory()) common = dotGit;
		else {
			const gitdir = readGitLink(dotGit, root);
			if (gitdir) {
				const commondir = join(gitdir, "commondir");
				common = existsSync(commondir) ? resolve(gitdir, readFileSync(commondir, "utf8").trim()) : gitdir;
			}
		}
		if (common) {
			if (basename(common) === ".git") main = dirname(common);
			roots.add(main);
			const worktrees = join(common, "worktrees");
			if (existsSync(worktrees)) {
				for (const name of readdirSync(worktrees)) {
					try {
						const link = readFileSync(join(worktrees, name, "gitdir"), "utf8").trim();
						if (link) roots.add(dirname(resolve(join(worktrees, name), link)));
					} catch {}
				}
			}
		}
	} catch {}
	roots.add(join(dirname(main), "my-pi-worktrees"));
	return [...roots].map((r) => canonical(r));
}
