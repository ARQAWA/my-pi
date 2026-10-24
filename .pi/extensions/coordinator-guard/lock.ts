// The exclusive coordinator lock: `coordinator.lock` in the git common dir, shared by the main checkout and every
// worktree. Content is JSON `{ pid, start, sessionId }`; `start` is the OS start time of the process, so a pid that
// another program has taken over after a crash does not look like the holder. The holder is a process: /new,
// /resume, /fork and /reload keep the lock; only a quit releases it, and a lock whose process is gone is taken over.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, linkSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

export const LOCK_NAME = "coordinator.lock";

export type LockInfo = { pid: number; start?: string; sessionId: string };
export type Acquired = { held: true; fresh: boolean } | { held: false; holder: LockInfo | undefined };

export function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * The OS start time of a process as text, or undefined when it cannot be read: `ps -o lstart=` (the lock is macOS
 * only), run with LC_ALL=C and TZ=UTC because `ps` prints local time, so two chats in different time zones read the
 * same text.
 */
export function processStart(pid: number): string | undefined {
	try {
		const env = { ...process.env, LC_ALL: "C", TZ: "UTC" };
		const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env, timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] });
		return out.trim() || undefined;
	} catch {
		return undefined;
	}
}

/** The recorded holder still runs: its pid is alive and, when a start time was recorded, it is the same process. */
export function holderAlive(info: LockInfo): boolean {
	if (!pidAlive(info.pid)) return false;
	if (info.start === undefined) return true;
	const now = processStart(info.pid);
	return now === undefined || now === info.start;
}

const sameProcess = (a: { pid: number; start?: string }, b: { pid: number; start?: string }) => a.pid === b.pid && a.start === b.start;

const unique = (file: string) => `${file}.${process.pid}.${randomBytes(4).toString("hex")}`;
const text = (info: LockInfo) => JSON.stringify(info);

function parse(raw: string): LockInfo | undefined {
	try {
		const data = JSON.parse(raw);
		const ok = Number.isInteger(data?.pid) && data.pid > 0 && typeof data.sessionId === "string" && (data.start === undefined || typeof data.start === "string");
		return ok ? data : undefined;
	} catch {
		return undefined;
	}
}

/** Reads the raw lock text, `null` when there is no lock. */
function readRaw(file: string): string | null {
	try {
		return readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/** Creates the lock only if it does not exist, with its full content visible at once: write a temp file, hard-link it. */
function createExclusive(file: string, info: LockInfo): boolean {
	const tmp = unique(file);
	writeFileSync(tmp, text(info));
	try {
		linkSync(tmp, file);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EEXIST") return false;
		// A file system without hard links: plain exclusive create.
		try {
			const fd = openSync(file, "wx");
			try {
				writeFileSync(fd, text(info));
			} finally {
				closeSync(fd);
			}
			return true;
		} catch (inner) {
			if ((inner as NodeJS.ErrnoException).code === "EEXIST") return false;
			throw inner;
		}
	} finally {
		try {
			unlinkSync(tmp);
		} catch {}
	}
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Replaces the lock atomically with this process's info; the lock file never disappears. */
function overwrite(file: string, info: LockInfo): void {
	const tmp = unique(file);
	writeFileSync(tmp, text(info));
	renameSync(tmp, file);
}

/**
 * Becomes the holder when the lock is free, ours (same process), or left by a process that is gone, also when its pid is now another program's. Stale takeover is serialized by
 * a gate file created the same exclusive way, and the stale lock is replaced by rename, never deleted. So the lock
 * is never absent during a takeover, no second contender can create it fresh, and a contender that lost the gate
 * sees the winner alive. Only a takeover whose gate holder died mid-way can leave a gate behind; it is removed
 * once its process is gone.
 */
export function acquireLock(file: string, info: LockInfo, alive: (holder: LockInfo) => boolean = holderAlive): Acquired {
	const gate = `${file}.takeover`;
	for (let attempt = 0; attempt < 200; attempt++) {
		if (createExclusive(file, info)) return { held: true, fresh: true };
		const raw = readRaw(file);
		if (raw === null) continue;
		const current = parse(raw);
		if (current && sameProcess(current, info)) {
			if (current.sessionId !== info.sessionId) overwrite(file, info);
			return { held: true, fresh: false };
		}
		if (current && alive(current)) return { held: false, holder: current };
		// Stale: a dead pid, or text nobody can read.
		if (createExclusive(gate, info)) {
			try {
				if (readRaw(file) === raw) {
					overwrite(file, info);
					return { held: true, fresh: true };
				}
			} finally {
				try {
					unlinkSync(gate);
				} catch {}
			}
			continue;
		}
		const gateInfo = parse(readRaw(gate) ?? "");
		if (gateInfo && !alive(gateInfo)) {
			try {
				unlinkSync(gate);
			} catch {}
		} else sleep(5);
	}
	return { held: false, holder: undefined };
}

/** Removes the lock only when this very process holds it. */
export function releaseLock(file: string, self: { pid: number; start?: string }): void {
	try {
		const raw = readRaw(file);
		const current = raw === null ? undefined : parse(raw);
		if (current && sameProcess(current, self)) unlinkSync(file);
	} catch {}
}
