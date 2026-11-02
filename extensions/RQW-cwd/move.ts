import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { isSystemFolder } from "./folders.ts";

/** The part of Pi 1.4.0's AgentSessionRuntime the move uses. */
type Runtime = {
	cwd: string;
	services: { agentDir: string };
	session: { sessionManager: SessionManager };
	createRuntime(options: { cwd: string; agentDir: string; sessionManager: SessionManager }): Promise<unknown>;
	teardownCurrent(reason: "new", targetSessionFile?: string): Promise<void>;
	apply(result: unknown): void;
};

export type MoveOptions = { platform?: NodeJS.Platform; home?: string; target?: string; chdir?: (dir: string) => void };

function isRuntime(value: any): value is Runtime {
	const manager = value?.session?.sessionManager;
	return typeof value?.services?.agentDir === "string"
		&& typeof value.createRuntime === "function" && typeof value.teardownCurrent === "function" && typeof value.apply === "function"
		&& typeof manager?.getSessionDir === "function" && typeof manager.isPersisted === "function";
}

/** Pi 1.4.0's default history folder for a cwd (session-manager.js `getDefaultSessionDirPath`). */
function defaultSessionDir(cwd: string, agentDir: string): string {
	const safePath = `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(resolve(agentDir), "sessions", safePath);
}

/** The new chat keeps an explicit history folder; the default one becomes the temp folder's own group. */
function tempSessionManager(old: SessionManager, from: string, target: string, agentDir: string): SessionManager {
	if (!old.isPersisted()) return SessionManager.inMemory(target);
	const dir = old.getSessionDir();
	return SessionManager.create(target, dir === defaultSessionDir(from, agentDir) ? defaultSessionDir(target, agentDir) : dir);
}

function warning(from: string, reason: unknown): string {
	const text = reason instanceof Error ? reason.message : String(reason);
	return `Could not move the chat from ${from} to the temp folder (${text}). It stays in ${from}.`;
}

/**
 * A runtime started in a system folder moves to os.tmpdir() as a new chat: process.chdir, then Pi's own runtime
 * factory rebuilds settings, resources, extensions, tools and history group for the temp folder. Old session files
 * stay untouched. Any other folder is left alone. Returns a warning when the chat stays where it started.
 */
export async function moveToTemp(runtime: unknown, options: MoveOptions = {}, hostSupported = true): Promise<string | undefined> {
	const from = (runtime as { cwd?: unknown } | undefined)?.cwd;
	if (typeof from !== "string") {
		// Unknown runtime shape: the session folder, else the process folder, tells whether the chat should have moved.
		let sessionCwd: unknown;
		try { sessionCwd = (runtime as any)?.session?.sessionManager?.getCwd(); } catch { /* no session folder in this shape */ }
		const cwd = typeof sessionCwd === "string" ? sessionCwd : process.cwd();
		return isSystemFolder(cwd, options.platform, options.home) ? warning(cwd, "unsupported Pi version") : undefined;
	}
	if (!isSystemFolder(from, options.platform, options.home)) return undefined;
	if (!hostSupported || !isRuntime(runtime)) return warning(from, "unsupported Pi version");
	const chdir = options.chdir ?? ((dir: string) => process.chdir(dir));
	const target = options.target ?? tmpdir();
	const agentDir = runtime.services.agentDir;
	const old = runtime.session.sessionManager;
	let next: SessionManager;
	try {
		chdir(target);
		next = tempSessionManager(old, from, target, agentDir);
	} catch (error) {
		try { chdir(from); } catch { /* the process folder was never changed */ }
		return warning(from, error);
	}
	// Stock order of a session switch: the old extensions shut down before the new runtime loads its own.
	try {
		await runtime.teardownCurrent("new", next.getSessionFile());
		runtime.apply(await runtime.createRuntime({ cwd: target, agentDir, sessionManager: next }));
		return undefined;
	} catch (error) {
		// Stock fallback: the original chat is rebuilt in its own folder.
		chdir(from);
		runtime.apply(await runtime.createRuntime({ cwd: from, agentDir, sessionManager: old }));
		return warning(from, error);
	}
}
