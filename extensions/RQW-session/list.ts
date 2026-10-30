import { readdir, open, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { getAgentDir, type SessionInfo } from "@earendil-works/pi-coding-agent";

const SESSION_INFO = Buffer.from('\n{"type":"session_info"');
const MESSAGE = Buffer.from('\n{"type":"message"');
const CHUNK = 64 * 1024;
const STOCK = Symbol.for("rqw-session.list.stock");

type ListFn = (...args: unknown[]) => Promise<SessionInfo[]>;
type SessionManagerStatics = { list: ListFn; listAll: ListFn };

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
	const buffer = Buffer.allocUnsafe(length);
	const { bytesRead } = await fh.read(buffer, 0, length, position);
	return buffer.subarray(0, bytesRead);
}

/** The line starting at `position`, without its newline; reads forward in chunks, each byte once. */
async function lineAt(fh: FileHandle, size: number, position: number): Promise<string> {
	const parts: Buffer[] = [];
	while (position < size) {
		const chunk = await readAt(fh, position, Math.min(CHUNK, size - position));
		if (chunk.length === 0) break;
		const newline = chunk.indexOf(10);
		parts.push(newline < 0 ? chunk : chunk.subarray(0, newline));
		if (newline >= 0) break;
		position += chunk.length;
	}
	return Buffer.concat(parts).toString();
}

/** Yields the start of every line that begins with `marker` (which starts with "\n"), in 64 KB windows that overlap by the marker length; no line is ever carried between windows. */
async function* lineStarts(fh: FileHandle, size: number, marker: Buffer, reverse: boolean): AsyncGenerator<number> {
	for (let i = 0; i * CHUNK < size; i++) {
		const start = reverse ? Math.max(0, size - (i + 1) * CHUNK) : i * CHUNK;
		const end = reverse ? size - i * CHUNK : Math.min(size, start + CHUNK);
		const window = await readAt(fh, start, Math.min(size, end + marker.length - 1) - start);
		if (reverse) {
			for (let at = window.lastIndexOf(marker); at >= 0; at = at > 0 ? window.lastIndexOf(marker, at - 1) : -1) if (at < end - start) yield start + at + 1;
		} else {
			for (let at = window.indexOf(marker); at >= 0 && at < end - start; at = window.indexOf(marker, at + 1)) yield start + at + 1;
		}
	}
}

/** Latest parsable session_info from the end, like Pi: a broken line is skipped for the one before it. */
async function lastName(fh: FileHandle, size: number): Promise<string | undefined> {
	for await (const position of lineStarts(fh, size, SESSION_INFO, true)) {
		try { return (JSON.parse(await lineAt(fh, size, position)).name as string | undefined)?.trim() || undefined; } catch { /* earlier match */ }
	}
	return undefined;
}

function userText(line: string): string | undefined {
	if (!line.includes('"role":"user"')) return undefined;
	try {
		const message = JSON.parse(line).message;
		if (message?.role !== "user") return undefined;
		const content = message.content;
		const text = typeof content === "string" ? content
			: Array.isArray(content) ? content.filter(block => block?.type === "text").map(block => block.text).join(" ") : "";
		return text || undefined;
	} catch { return undefined; }
}

/** Forward scan for the first user message; only used for sessions without a name. */
async function firstUserMessage(fh: FileHandle, size: number): Promise<string> {
	for await (const position of lineStarts(fh, size, MESSAGE, false)) {
		const text = userText(await lineAt(fh, size, position));
		if (text) return text;
	}
	return "(no messages)";
}

function formatSize(bytes: number): string {
	return bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

async function readInfo(path: string): Promise<SessionInfo | null> {
	let fh: FileHandle | undefined;
	try {
		fh = await open(path, "r");
		const { size, mtime } = await fh.stat();
		const header = JSON.parse(await lineAt(fh, size, 0));
		if (header?.type !== "session" || typeof header.id !== "string") return null;
		const name = await lastName(fh, size);
		return {
			path, id: header.id, cwd: typeof header.cwd === "string" ? header.cwd : "", name, parentSessionPath: header.parentSession,
			created: new Date(header.timestamp), modified: mtime,
			// The stock row prints String(messageCount); the owner wants the file size there instead.
			messageCount: formatSize(size) as unknown as number,
			firstMessage: name ? "" : await firstUserMessage(fh, size),
			// Empty text: the stock search matches id, name and cwd only.
			allMessagesText: "",
		};
	} catch { return null; }
	finally { await fh?.close().catch(() => undefined); }
}

async function listDirs(dirs: string[], signal?: AbortSignal): Promise<SessionInfo[]> {
	const files = (await Promise.all(dirs.map(async dir => (await readdir(dir).catch(() => [] as string[])).filter(f => f.endsWith(".jsonl")).map(f => join(dir, f))))).flat();
	const infos: (SessionInfo | null)[] = new Array(files.length);
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(16, files.length) }, async () => {
		while (next < files.length) {
			signal?.throwIfAborted();
			const index = next++;
			infos[index] = await readInfo(files[index]!);
		}
	}));
	return (infos.filter(Boolean) as SessionInfo[]).sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

/** Calls a progress callback once with the finished list. */
function finish(sessions: SessionInfo[], onProgress: unknown): SessionInfo[] {
	if (typeof onProgress === "function") onProgress(sessions.length, sessions.length, sessions);
	return sessions;
}

/**
 * Replaces SessionManager.list and listAll with reverse-scan versions (Pi 1.4.0 shapes). An unknown shape, a relative
 * or `~` directory, or any error inside the fast path leaves the stock call. Returns the restore function.
 */
export function installFastList(manager: SessionManagerStatics): () => void {
	const { list, listAll } = manager;
	if (typeof list !== "function" || typeof listAll !== "function" || !list.toString().includes("listSessionsFromDir") || !listAll.toString().includes("listSessionsFromDir")) return () => undefined;
	// After /reload the previous patch is still installed; wrap the stock function it kept.
	const stockList = (list as unknown as Record<symbol, ListFn>)[STOCK] ?? list;
	const stockListAll = (listAll as unknown as Record<symbol, ListFn>)[STOCK] ?? listAll;
	const wrap = (stock: ListFn, fast: (args: unknown[]) => Promise<SessionInfo[]> | undefined): ListFn => {
		const patched: ListFn = async function (this: unknown, ...args) {
			try { const result = fast(args); if (result) return await result; }
			catch (error) { if ((args.find(arg => arg instanceof AbortSignal) as AbortSignal | undefined)?.aborted) throw error; }
			return stock.apply(this, args);
		};
		(patched as unknown as Record<symbol, ListFn>)[STOCK] = stock;
		return patched;
	};
	// list(cwd, sessionDir, onProgress, signal): only an absolute sessionDir; other cwds are filtered like stock.
	const patchedList = manager.list = wrap(stockList, ([cwd, sessionDir, onProgress, signal]) => {
		if (typeof cwd !== "string" || typeof sessionDir !== "string" || !isAbsolute(sessionDir)) return undefined;
		const defaultDir = join(resolve(getAgentDir()), "sessions", `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
		const filter = resolve(sessionDir) !== defaultDir;
		return listDirs([resolve(sessionDir)], signal as AbortSignal | undefined)
			.then(sessions => finish(filter ? sessions.filter(s => s.cwd !== "" && resolve(s.cwd) === resolve(cwd)) : sessions, onProgress));
	});
	// listAll(), listAll(onProgress, signal), listAll(dir, onProgress, signal)
	const patchedListAll = manager.listAll = wrap(stockListAll, ([first, second, third]) => {
		const custom = typeof first === "string";
		if (custom && !isAbsolute(first)) return undefined;
		const signal = (custom ? third : typeof first === "function" ? second : undefined) as AbortSignal | undefined;
		const onProgress = custom ? second : first;
		return (async () => {
			const root = join(resolve(getAgentDir()), "sessions");
			const dirs = custom ? [resolve(first)] : (await readdir(root, { withFileTypes: true }).catch(() => [])).filter(e => e.isDirectory() || e.isSymbolicLink()).map(e => join(root, e.name));
			return finish(await listDirs(dirs, signal), onProgress);
		})();
	});
	// Restore only what is still ours, and to the stock functions: a newer instance may have wrapped them since.
	return () => {
		if (manager.list === patchedList) manager.list = stockList;
		if (manager.listAll === patchedListAll) manager.listAll = stockListAll;
	};
}
