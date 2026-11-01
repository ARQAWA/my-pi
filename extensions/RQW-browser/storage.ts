import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** A path relative to the session folder, with ~/ for the user's home. */
export function resolveUserPath(path: string, cwd: string): string {
	return resolve(cwd, path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
}
