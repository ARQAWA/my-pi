import { appendFileSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { appendFile, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { continueNote, repairRequest } from "./history-repair.ts";
import {
	CURRENT_SESSION_VERSION,
	migrateSessionEntries,
	SessionManager,
	type AgentSession,
	type ExtensionContext,
	type FileEntry,
	type SessionEntry,
	type SessionHeader,
} from "@earendil-works/pi-coding-agent";

type ReadonlySessionManager = ExtensionContext["sessionManager"];

export const CHILD_ENTRY = "rqw-agent-child";
export const WAIT_ENTRY = "rqw-agent-wait";
export const ACCEPT_ENTRY = "rqw-agent-accept";
/** One base prompt text, written once per branch; child records name it by `base_ref`. */
export const BASE_ENTRY = "rqw-agent-base";

const retainedChildren = new WeakMap<ReadonlySessionManager, Map<string, SessionManager>>();

export function retainedChildManager(parent: ReadonlySessionManager, kind: string, id: number): SessionManager | undefined {
	return retainedChildren.get(parent)?.get(`${kind}#${id}`);
}

/** Forgets a retained manager whose history can be reopened from its file. */
export function releaseChildManager(parent: ReadonlySessionManager, kind: string, id: number): void {
	retainedChildren.get(parent)?.delete(`${kind}#${id}`);
}

function retainChild(parent: ReadonlySessionManager, kind: string, id: number, manager: SessionManager): SessionManager {
	let children = retainedChildren.get(parent);
	if (!children) {
		children = new Map();
		retainedChildren.set(parent, children);
	}
	children.set(`${kind}#${id}`, manager);
	return manager;
}

function childDirectory(parent: ReadonlySessionManager, kind: string, id: number): string | undefined {
	if (kind !== "agent" || !Number.isSafeInteger(id) || id < 1) {
		throw new Error("Invalid child kind or id");
	}
	const parentFile = parent.getSessionFile();
	return parentFile ? resolve(`${parentFile}.children`, `${kind}-${id}`) : undefined;
}

// The parent's directory is trusted, including OS aliases such as /var.
// Only the parent filename and the adjacent owned tree must not contain links.
function checkPath(path: string, allowMissing: boolean, parentFile: string): void {
	const trusted = dirname(resolve(parentFile));
	let current = realpathSync(trusted);
	for (const component of relative(trusted, resolve(path)).split(sep)) {
		current = resolve(current, component);
		try {
			const stat = lstatSync(current);
			if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
				throw new Error(`Unsafe child session path: ${current}`);
			}
		} catch (error) {
			if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	}
}

export function deliveredRuns(parent: ReadonlySessionManager): Set<string> {
	const file = parent.getSessionFile();
	if (!file) return new Set();
	const path = resolve(`${file}.children`, "delivered");
	checkPath(path, true, file);
	try { return new Set(readFileSync(path, "utf8").split("\n").filter(Boolean)); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set(); throw error; }
}

export function recordDelivery(parent: ReadonlySessionManager, run: string): void {
	const file = parent.getSessionFile();
	if (!file) return;
	const path = resolve(`${file}.children`, "delivered");
	checkPath(path, true, file);
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${run}\n`, "utf8");
}

/**
 * The first child manager of a durable parent holds `seed` after the header. The file is written in slices that yield to the
 * event loop and the manager is built from the same entries, with no read-back: a long fork froze the UI for seconds.
 */
export async function createChildManager(parent: ReadonlySessionManager, cwd: string, kind: string, id: number, seed?: SessionEntry[]): Promise<SessionManager> {
	const directory = childDirectory(parent, kind, id);
	if (!directory) return retainChild(parent, kind, id, SessionManager.inMemory(cwd, undefined, seed));
	checkPath(parent.getSessionFile()!, true, parent.getSessionFile()!);
	checkPath(directory, true, parent.getSessionFile()!);
	const manager = SessionManager.create(cwd, directory, { parentSession: parent.getSessionFile() });
	if (!seed) return retainChild(parent, kind, id, manager);
	const file = manager.getSessionFile()!;
	const entries: FileEntry[] = [manager.getHeader()!, ...seed];
	await writeEntries(file, entries);
	return retainChild(parent, kind, id, managerFromEntries(cwd, directory, file, entries));
}

/** Writes one JSON line per entry, a chunk at a time; a partial file is removed when the write fails. */
async function writeEntries(file: string, entries: FileEntry[]): Promise<void> {
	const handle = await open(file, "wx");
	try {
		const pace = slicePacer();
		let chunk = "";
		for (const entry of entries) {
			chunk += `${JSON.stringify(entry)}\n`;
			if (chunk.length >= WRITE_CHUNK_CHARS) {
				await handle.writeFile(chunk);
				chunk = "";
			}
			await pace();
		}
		if (chunk) await handle.writeFile(chunk);
	} catch (error) {
		await unlink(file).catch(() => {});
		throw error;
	} finally {
		await handle.close();
	}
}

/**
 * A manager over entries already in memory for a file that exists, so nothing is read again.
 * Pi's own `open` is the fallback when its constructor has another shape.
 */
function managerFromEntries(cwd: string, directory: string, file: string, entries: FileEntry[]): SessionManager {
	const Manager = SessionManager as unknown as new (cwd: string, dir: string, file: string, persist: boolean, options: undefined, entries: FileEntry[]) => SessionManager;
	if (Manager.length === 6) {
		try {
			const manager = new Manager(cwd, directory, file, true, undefined, entries);
			const header = entries[0] as { id: string };
			if (manager.getSessionId() === header.id && manager.getSessionFile() === resolve(file) && manager.getHeader() === entries[0]) return manager;
		} catch {
			// A constructor that refuses these arguments takes the stock path below.
		}
	}
	return SessionManager.open(file, directory, cwd);
}

/** The entries of a session file with Pi's own rules: blank and malformed lines are skipped, a foreign header gives none. */
async function readEntries(file: string): Promise<FileEntry[]> {
	const bytes = await readFile(file);
	const entries: FileEntry[] = [];
	const pace = slicePacer();
	let start = 0;
	while (start < bytes.length) {
		const newline = bytes.indexOf(10, start);
		const end = newline < 0 ? bytes.length : newline;
		const line = bytes.toString("utf8", start, end);
		start = end + 1;
		const entry = parseLine(line);
		if (entry) entries.push(entry);
		await pace();
	}
	const header = entries[0];
	if (header?.type !== "session" || typeof header.id !== "string") return [];
	// Pi ends a last line that has no newline.
	if (bytes.at(-1) !== 10) await appendFile(file, "\n");
	return entries;
}

/**
 * An older session format is migrated and rewritten here, in slices, through a temporary file;
 * Pi's constructor would rewrite the whole file synchronously.
 */
async function migrateFile(file: string, entries: FileEntry[]): Promise<void> {
	if (((entries[0] as SessionHeader).version ?? 1) >= CURRENT_SESSION_VERSION) return;
	migrateSessionEntries(entries);
	const rewritten = `${file}.migrating`;
	await unlink(rewritten).catch(() => {}); // left by an interrupted migration
	await writeEntries(rewritten, entries);
	await rename(rewritten, file).catch(async error => {
		await unlink(rewritten).catch(() => {});
		throw error;
	});
}

function parseLine(line: string): FileEntry | undefined {
	if (!line.trim()) return undefined;
	try { return JSON.parse(line); }
	catch { return undefined; }
}

/** The resolved child file after the ownership checks; throws when it is not a regular file of its owned directory. */
function checkChildFile(parent: ReadonlySessionManager, childFile: string, kind: string, id: number): { directory: string; file: string } {
	const directory = childDirectory(parent, kind, id);
	if (!directory) throw new Error("Cannot open a durable child of an in-memory parent");
	const file = resolve(childFile);
	const owned = relative(directory, file);
	if (!owned || owned === ".." || owned.startsWith(`..${sep}`) || isAbsolute(owned)) {
		throw new Error("Child session file is outside its owned directory");
	}
	checkPath(parent.getSessionFile()!, false, parent.getSessionFile()!);
	checkPath(file, false, parent.getSessionFile()!);
	const actual = relative(realpathSync(directory), realpathSync(file));
	if (!actual || actual === ".." || actual.startsWith(`..${sep}`) || isAbsolute(actual)) {
		throw new Error("Child session file resolves outside its owned directory");
	}
	if (!lstatSync(directory).isDirectory() || !lstatSync(file).isFile()) {
		throw new Error("Child session must be a regular file in its owned directory");
	}
	return { directory, file };
}

/** Reopens a child from its file, read in slices that yield to the event loop: a child file can be hundreds of megabytes. */
export async function openChildManager(parent: ReadonlySessionManager, childFile: string, cwd: string, kind: string, id: number, retain = true): Promise<SessionManager> {
	const { directory, file } = checkChildFile(parent, childFile, kind, id);
	const entries = await readEntries(file);
	if (entries.length) await migrateFile(file, entries);
	// An unreadable or empty file takes Pi's own errors.
	const manager = entries.length ? managerFromEntries(cwd, directory, file, entries) : SessionManager.open(file, directory, cwd);
	return retain ? retainChild(parent, kind, id, manager) : manager;
}

/** Bytes read from the end of the parent file; a record appended just now lies inside them. */
const PARENT_TAIL_BYTES = 4 * 1024 * 1024;
/** The header line is far shorter. */
const HEADER_BYTES = 64 * 1024;

/**
 * Whether the parent file still starts with its own session header and holds `entry` as a saved line near its end.
 * Only both ends are read, asynchronously: a full reopen of a long main session froze the UI for seconds.
 */
export async function parentHoldsEntry(parent: ReadonlySessionManager, entry: SessionEntry): Promise<boolean> {
	const path = parent.getSessionFile();
	if (!path) return false;
	const handle = await open(path, "r").catch(() => undefined);
	if (!handle) return false;
	try {
		const { size } = await handle.stat();
		const head = Buffer.alloc(Math.min(size, HEADER_BYTES));
		await handle.read(head, 0, head.length, 0);
		const newline = head.indexOf(10);
		const header = JSON.parse(head.toString("utf8", 0, newline < 0 ? head.length : newline));
		if (header.type !== "session" || header.id !== parent.getSessionId()) return false;
		const line = `\n${JSON.stringify(entry)}\n`;
		const tail = Buffer.alloc(Math.min(size, Math.max(PARENT_TAIL_BYTES, Buffer.byteLength(line))));
		await handle.read(tail, 0, tail.length, size - tail.length);
		return tail.includes(line);
	} catch {
		return false;
	} finally {
		await handle.close();
	}
}

/** One synchronous slice plus its last line stays under a frame, so the UI keeps drawing while a large file is checked. */
const SLICE_MS = 4;
/** A write chunk of about a megabyte. */
const WRITE_CHUNK_CHARS = 1024 * 1024;

/** Awaited between work items: yields to the event loop once the current slice has run for `SLICE_MS`. */
export function slicePacer(): () => Promise<void> {
	let slice = performance.now();
	return async () => {
		if (performance.now() - slice <= SLICE_MS) return;
		await nextTurn();
		slice = performance.now();
	};
}

/**
 * Whether the child's file holds exactly the history of `manager`, so the manager can be released and reopened later.
 * Pi writes every entry as one `JSON.stringify` line. Reads and compares in slices that yield to the event loop: a child file can be hundreds of megabytes, and a
 * synchronous reopen froze the UI for seconds. Any unreadable, foreign or different file answers false.
 */
export async function savedHistoryMatches(parent: ReadonlySessionManager, childFile: string, kind: string, id: number, manager: SessionManager): Promise<boolean> {
	try {
		const { file } = checkChildFile(parent, childFile, kind, id);
		const bytes = await readFile(file);
		const entries = manager.getEntries();
		let start = 0;
		let index = -1; // the header line comes first
		const pace = slicePacer();
		while (start < bytes.length) {
			const newline = bytes.indexOf(10, start);
			const end = newline < 0 ? bytes.length : newline;
			const line = bytes.toString("utf8", start, end).trim();
			start = end + 1;
			if (!line) continue;
			if (index < 0) {
				const header = JSON.parse(line);
				if (header.type !== "session" || header.id !== manager.getSessionId()) return false;
			} else if (index >= entries.length || line !== JSON.stringify(entries[index])) return false;
			index++;
			await pace();
		}
		return index === entries.length;
	} catch {
		return false;
	}
}

export function repairInterrupted(session: AgentSession): boolean {
	const manager = session.sessionManager;
	const projection = manager.buildSessionProjection();
	const visible = projection.entries.flatMap(entry => entry.messages.map(message => ({ message, id: entry.sourceEntry.id })));
	const hidden: string[] = [];
	while (visible.length) {
		const last = visible.at(-1)!;
		if (last.message.role !== "assistant" || !["aborted", "error"].includes(last.message.stopReason)
			|| last.message.content.some(part => part.type === "toolCall")) break;
		hidden.push(last.id);
		visible.pop();
	}
	for (const id of hidden) manager.appendContextEdit(id, null);
	// Broken pairs are repaired in the request only; the saved history stays as it is.
	const history = manager.buildSessionProjection().messages;
	const messages = repairRequest(history, continueNote());
	session.agent.state.messages = messages;
	return messages.some(message => message.role === "user") && messages.at(-1)?.role !== "assistant";
}
