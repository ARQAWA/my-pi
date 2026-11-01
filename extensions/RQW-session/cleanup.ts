import { access, readdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

const TREE = ".jsonl.children";
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/**
 * Deletes `<name>.jsonl.children` directories whose `<name>.jsonl` sibling is gone, one listing per project folder.
 * Only directory listings are read (no file content), plus one existence check right before each delete.
 * Names compare case-insensitively on every platform, so the rule only ever keeps more. Symlinks and files are skipped.
 * The current session's tree is never entered, including through symlinked or differently cased paths. Trees containing
 * its file (or a symlink target) are kept. An unreadable directory counts as failed, except a missing one; only a confirmed ENOENT
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
		if (name.toLowerCase() !== currentName && name.toLowerCase() !== `${basename(currentTarget ?? "")}.children`) return false;
		return realpath(dir).then(path => {
			const tree = join(path, name).toLowerCase();
			return tree === current || tree === `${currentTarget}.children` || (name.toLowerCase() === currentName && path.toLowerCase() === currentDir);
		}, () => true);
	};
	let removed = 0;
	let failed = 0;
	const list = async (dir: string) => {
		try { return await readdir(dir, { withFileTypes: true }); }
		catch (error) { if (!missing(error)) failed++; return []; }
	};
	// A project folder: orphan trees are deleted, live ones are left alone.
	const walk = async (dir: string): Promise<void> => {
		const entries = await list(dir);
		const files = new Set(entries.map(entry => entry.name.toLowerCase()));
		await Promise.all(entries.filter(entry => entry.isDirectory() && entry.name.endsWith(TREE)).map(async entry => {
			const path = join(dir, entry.name);
			const owner = entry.name.slice(0, -".children".length);
			if (await isCurrent(dir, entry.name)) return;
			if (files.has(owner.toLowerCase()) || await containsCurrent(path)) return;
			// The listing may be stale: a session file created meanwhile keeps its tree; only ENOENT confirms absence.
			try { await access(join(dir, owner)); return; }
			catch (error) { if (!missing(error)) { failed++; return; } }
			try { await rm(path, { recursive: true, force: true }); removed++; } catch { failed++; }
		}));
	};
	const sessions = join(agentDir, "sessions");
	let projects;
	try { projects = await readdir(sessions, { withFileTypes: true }); }
	catch (error) { return { removed, failed: missing(error) ? 0 : 1 }; }
	await Promise.all(projects.filter(project => project.isDirectory()).map(project => walk(join(sessions, project.name))));
	return { removed, failed };
}
