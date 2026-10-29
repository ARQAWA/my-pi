import { spawnSync } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { setImmediate } from "node:timers";
import { copyToClipboard, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cleanupOrphanedChildren } from "./cleanup.ts";

type Spawn = (command: string, args: string[], options: { encoding: "utf-8" }) => { status: number | null; error?: Error; stderr?: string | null };

/** Same logic as stock /resume "Remove Session" (Pi 1.4.0 session-selector.js `deleteSessionFile`): `trash` first, then unlink. */
async function deleteSessionFile(sessionPath: string, spawn: Spawn): Promise<{ ok: true; method: "trash" | "unlink" } | { ok: false; error: string }> {
	const trashArgs = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
	const trashResult = spawn("trash", trashArgs, { encoding: "utf-8" });
	const getTrashErrorHint = () => {
		const parts: string[] = [];
		if (trashResult.error) parts.push(trashResult.error.message);
		const stderr = trashResult.stderr?.trim();
		if (stderr) parts.push(stderr.split("\n")[0] ?? stderr);
		if (parts.length === 0) return null;
		return `trash: ${parts.join(" · ").slice(0, 200)}`;
	};
	if (trashResult.status === 0 || !existsSync(sessionPath)) return { ok: true, method: "trash" };
	try {
		await unlink(sessionPath);
		return { ok: true, method: "unlink" };
	} catch (err) {
		const unlinkError = err instanceof Error ? err.message : String(err);
		const trashErrorHint = getTrashErrorHint();
		return { ok: false, error: trashErrorHint ? `${unlinkError} (${trashErrorHint})` : unlinkError };
	}
}

/** Parses one line as Pi's loader does: blank, malformed and falsy entries (null, false, 0, "") are skipped (undefined). */
function parseLine(line: string): { value: unknown } | undefined {
	if (!line.trim()) return undefined;
	try {
		const value: unknown = JSON.parse(line);
		return value ? { value } : undefined;
	} catch { return undefined; }
}

/**
 * Pi's loader (session-manager.js `loadEntriesFromFile`) decides by the first valid JSON entry: a session header
 * (`type: "session"`, string `id`) means a live file, anything else means no session. Same rule here, reading small
 * chunks and stopping at that entry, so a normal file costs only its short first line. A missing file, or one
 * recreated without a header by a later append after the deletion, or one without any valid entry, is a deleted
 * session. Read errors other than a missing file count as present.
 */
function sessionFileGone(file: string): boolean {
	let fd: number;
	try { fd = openSync(file, "r"); }
	catch (error) { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }
	try {
		const decoder = new StringDecoder("utf8");
		const chunk = Buffer.alloc(4096);
		let pending = "";
		let scanned = 0;
		const decide = (entry: { value: unknown }) => {
			const header = entry.value as { type?: unknown; id?: unknown };
			return !(header.type === "session" && typeof header.id === "string");
		};
		for (;;) {
			const bytes = readSync(fd, chunk, 0, chunk.length, null);
			if (bytes === 0) break;
			pending += decoder.write(chunk.subarray(0, bytes));
			for (let newline = pending.indexOf("\n", scanned); newline !== -1; newline = pending.indexOf("\n")) {
				const entry = parseLine(pending.slice(0, newline));
				pending = pending.slice(newline + 1);
				if (entry) return decide(entry);
			}
			scanned = pending.length;
		}
		const last = parseLine(pending + decoder.end());
		return last ? decide(last) : true;
	} catch { return false; }
	finally { closeSync(fd); }
}

/** Injectable clipboard and spawner boundaries for deterministic tests; production uses Pi's /copy implementation and `spawnSync`. */
export function registerSessionCommands(pi: ExtensionAPI, copy = copyToClipboard, spawn: Spawn = spawnSync, agentDir = getAgentDir()) {
	pi.registerCommand("copy-session", {
		description: "Copy the current session ID to the clipboard",
		async handler(_args, ctx) {
			const id = ctx.sessionManager.getSessionId();
			try {
				await copy(id);
				ctx.ui.notify(`Session ID copied: ${id}`, "info");
			} catch (error) {
				ctx.ui.notify(`Could not copy session ID: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
	pi.registerCommand("remove", {
		description: "Remove this session like /resume does (trash, else delete), then start fresh",
		async handler(_args, ctx) {
			if (!ctx.hasUI) {
				ctx.ui.notify("Session removal requires a confirmation-capable UI; nothing was deleted", "error");
				return;
			}
			const file = ctx.sessionManager.getSessionFile();
			if (await ctx.ui.select("Delete this session?", ["1. No", "2. Yes"]) !== "2. Yes") return;
			// Never reuse ctx/pi after replacement: old extension contexts become stale. A cancelled switch never reaches withSession.
			await ctx.newSession({ withSession: async fresh => {
				if (!file) return;
				const result = await deleteSessionFile(file, spawn);
				if (result.ok) fresh.ui.notify(result.method === "trash" ? "Session moved to trash" : "Session deleted", "info");
				else fresh.ui.notify(`Failed to delete: ${result.error}`, "error");
			} });
		},
	});
	pi.registerCommand("cleanup", {
		description: "Delete child session folders whose parent session file is gone",
		async handler(_args, ctx) {
			const { removed, failed } = await cleanupOrphanedChildren(agentDir, ctx.sessionManager.getSessionFile());
			if (failed) ctx.ui.notify(`Cleanup removed ${removed} folders, could not remove ${failed}`, "warning");
			else ctx.ui.notify(removed ? `Cleanup removed ${removed} orphaned child session folders` : "Nothing to clean", "info");
		},
	});
	// A message typed into a window whose session file was deleted is not sent. Only a command context can open a
	// session, so the input handler hands the text to a hidden command through the public sendUserMessage dispatch.
	let pendingText: string | undefined;
	pi.registerCommand("session-deleted", {
		description: "Internal: open a new session after the open session file was deleted",
		async handler(_args, ctx) {
			const text = pendingText;
			pendingText = undefined;
			if (text === undefined) return;
			ctx.ui.notify("Session file was deleted. Opening a new session.", "error");
			const { cancelled } = await ctx.newSession({ withSession: async fresh => { fresh.ui.setEditorText(text); } });
			// The switch was refused: the old context stays valid, so the text is kept and the failure is said here.
			if (cancelled) {
				ctx.ui.setEditorText(text);
				ctx.ui.notify("A new session could not be opened.", "error");
			}
		},
	});
	// The file is expected when this window has seen it exist, or when the session already has conversation entries
	// (Pi writes the file as soon as the first user or assistant message is persisted). A new session with neither is
	// normal. The window (extension instance) is replaced with its session.
	let seen = false;
	const observe = (ctx: { sessionManager: { getSessionFile(): string | undefined } }) => {
		const file = ctx.sessionManager.getSessionFile();
		if (file && existsSync(file)) seen = true;
	};
	pi.on("session_start", (_event, ctx) => { observe(ctx); });
	pi.on("turn_end", (_event, ctx) => { observe(ctx); });
	pi.on("agent_end", (_event, ctx) => { observe(ctx); });
	pi.on("input", (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };
		observe(ctx);
		const file = ctx.sessionManager.getSessionFile();
		const written = ctx.sessionManager.getEntries().some(entry => entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant"));
		if (!file || !(seen || written) || !sessionFileGone(file)) return { action: "continue" };
		pendingText = event.text;
		// Let the input pipeline finish before the session is replaced.
		setImmediate(() => pi.sendUserMessage("/session-deleted", { expandPromptTemplates: true }));
		return { action: "handled" };
	});
}

export default function sessionCommands(pi: ExtensionAPI) { registerSessionCommands(pi); }
