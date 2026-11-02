import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/**
 * True when cwd is exactly one of the owner's system folders. Subfolders never match, links are not resolved.
 * Windows compares without case, separators and a trailing separator; macOS keeps case. Other systems have no list.
 */
export function isSystemFolder(cwd: string, platform: NodeJS.Platform = process.platform, home = homedir()): boolean {
	if (platform === "darwin") {
		const folders = ["/", home, posix.join(home, "Downloads")];
		return folders.some(folder => posix.resolve(folder) === posix.resolve(cwd));
	}
	if (platform === "win32") {
		const key = (path: string) => win32.resolve(path).toLowerCase();
		const folders = ["C:\\", home, win32.join(home, "Downloads"), "C:\\Users", "C:\\Program Files", "C:\\Windows"];
		return folders.some(folder => key(folder) === key(cwd));
	}
	return false;
}
