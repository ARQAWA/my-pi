import { access, readdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

const TREE = ".jsonl.children";
const AGENT_DIR = /^agent-\d+$/;
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/**
 * Deletes `<name>.jsonl.children` directories whose `<name>.jsonl` sibling is gone. RQW-agent layout: a tree holds
 * `agent-N/` directories, each with a child's `<ts>_<uuid>.jsonl` and possibly its own `.jsonl.children` tree.
 * Only directory listings are read (no file content), plus one existence check right before each delete.
 * Names compare case-insensitively on every platform, so the rule only ever keeps more. Symlinks and files are skipped.
 * The current session is never touched: its own tree and any tree containing its file (or the target of a symlinked file) are kept (also when reached through a symlinked or differently cased path), but orphans
 * inside it are still cleaned. An unreadable directory counts as failed, except a missing one; only a confirmed ENOENT
 * on the sibling permits a delete.
 */
export async function cleanupOrphanedChildren(agentDir: string, currentSessionFile: string | undefined): Promise<{ removed: number; failed: number }> {
	const current = currentSessionFile ? resolve(`${currentSessionFile}.children`).toLowerCase() : undefined;
	const currentName = currentSessionFile ? `${basename(currentSessionFile)}.children`.toLowerCase() : undefined;
	const currentDir = currentSessionFile ? await realpath(dirname(currentSessionFile)).then(path => path.toLowerCase(), () => undefined) : undefined;
	// Real, lowercased path of the current session file (its directory exists even when the file is gone).
	const currentFile = currentSessionFile ? join(currentDir ?? resolve(dirname(currentSessionFile)).toLowerCase(), basename(currentSessionFile).toLowerCase()) : undefined;
	// The file itself may be a symlink into a tree, so its own real path counts too.
	const currentTarget = currentSessionFile ? await realpath(currentSessionFile).then(value => value.toLowerCase(), () => undefined) : undefined;
	const containsCurrent = async (path: string) => {
		if (!currentFile) return false;
		const real = await realpath(path).then(value => value.toLowerCase(), () => resolve(path).toLowerCase());
		return currentFile.startsWith(real + sep) || (currentTarget?.startsWith(real + sep) ?? false);
	};
	// Lexical match first; a tree with the current name is also compared by the real path of its directory.
	const isCurrent = async (dir: string, name: string) => {
		if (resolve(dir, name).toLowerCase() === current) return true;
		if (name.toLowerCase() !== currentName || !currentDir) return false;
		return realpath(dir).then(path => path.toLowerCase() === currentDir, () => true);
	};
	let removed = 0;
	let failed = 0;
	const list = async (dir: string) => {
		try { return await readdir(dir, { withFileTypes: true }); }
		catch (error) { if (!missing(error)) failed++; return []; }
	};
	// A directory that holds sessions: orphan trees are deleted, live ones are searched for nested agent directories.
	const walk = async (dir: string): Promise<void> => {
		const entries = await list(dir);
		const files = new Set(entries.map(entry => entry.name.toLowerCase()));
		await Promise.all(entries.filter(entry => entry.isDirectory() && entry.name.endsWith(TREE)).map(async entry => {
			const path = join(dir, entry.name);
			const owner = entry.name.slice(0, -".children".length);
			if (files.has(owner.toLowerCase()) || await isCurrent(dir, entry.name) || await containsCurrent(path)) return walkTree(path);
			// The listing may be stale: a session file created meanwhile keeps its tree; only ENOENT confirms absence.
			try { await access(join(dir, owner)); return; }
			catch (error) { if (!missing(error)) { failed++; return; } }
			try { await rm(path, { recursive: true, force: true }); removed++; } catch { failed++; }
		}));
	};
	const walkTree = async (tree: string): Promise<void> => {
		const entries = await list(tree);
		await Promise.all(entries.filter(entry => entry.isDirectory() && AGENT_DIR.test(entry.name)).map(entry => walk(join(tree, entry.name))));
	};
	const sessions = join(agentDir, "sessions");
	let projects;
	try { projects = await readdir(sessions, { withFileTypes: true }); }
	catch (error) { return { removed, failed: missing(error) ? 0 : 1 }; }
	await Promise.all(projects.filter(project => project.isDirectory()).map(project => walk(join(sessions, project.name))));
	return { removed, failed };
}
