// Unchanged-read note (DECISIONS.md Tools, D-TOOLS-UNCHANGED-READ).
//
// A repeat of the identical read (same file, offset and limit) returns a one-line note instead of the text when all of
// these hold: this session's last full read of it is still in the session branch and in the model's context (no
// compaction and no context_edit of that result came after it), at most MAX_TURNS model responses and MAX_TOKENS of
// context were added since, and the file has the same mtime and the same content hash. Anything else, and every
// `force: true` read, returns the normal content. Pure bookkeeping on the session entries Pi already keeps: no event
// hooks, so a subagent's own session works the same way.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { detectSupportedImageMimeTypeFromFile, estimateTokens } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { stat } from "./ledger.ts";

export const MAX_TURNS = 10;
export const MAX_TOKENS = 30000;

/** The stock read schema plus the optional `force` flag. */
export function createReadSchema(stockParameters: any) {
	return Type.Object({
		...stockParameters.properties,
		force: Type.Optional(Type.Boolean({ description: "Set true to get the content even when the range is unchanged since your last read of it." })),
	});
}

/** What the last full read of one range looked like: the call that returned it, and the file version it showed. */
type Version = { mtimeMs: number; hash: string };
type Seen = Version & { callId: string };

const hashOf = async (file: string): Promise<string | undefined> => {
	try {
		return createHash("sha256").update(await readFile(file)).digest("hex");
	} catch {
		return undefined;
	}
};

/** A stable version to compare across the stock read and the asynchronous cache checks. */
async function versionOf(file: string): Promise<Version | undefined> {
	const version = stat(file);
	const hash = await hashOf(file);
	if (!version || !hash || stat(file)?.mtimeMs !== version.mtimeMs) return undefined;
	return { mtimeMs: version.mtimeMs, hash };
}

/** The session of this tool call, or undefined when the context offers no session entries (then nothing is skipped). */
const sessionOf = (ctx: any): { id: string; branch: any[] } | undefined => {
	try {
		const manager = ctx?.sessionManager;
		return { id: manager.getSessionId(), branch: manager.getBranch() };
	} catch {
		return undefined;
	}
};

/** The model-context message an entry stands for, or undefined for entries that add none (the ones this check counts). */
function contextMessage(entry: any): any {
	if (entry.type === "message") return entry.message;
	if (entry.type === "custom_message") return { role: "custom", content: entry.content };
	if (entry.type === "branch_summary") return { role: "branchSummary", summary: entry.summary };
	return undefined;
}

/**
 * Tokens of one entry as Pi projects it. A context_edit replaces only the content (a string becomes a text block for an
 * assistant or toolResult message); an edit that omits the entry counts the raw message, which is only too high. The
 * larger of raw and replaced is taken, so an edit never makes the count too low.
 */
function tokensOf(message: any, edit: any): number {
	const raw = estimateTokens(message);
	const content = edit?.replacement?.content;
	if (content === undefined) return raw;
	const asBlocks = typeof content === "string" && (message.role === "assistant" || message.role === "toolResult");
	return Math.max(raw, estimateTokens({ ...message, content: asBlocks ? [{ type: "text", text: content }] : content }));
}

/**
 * True when the toolResult `callId` is in the branch, no compaction follows it, no context_edit changed or removed that
 * result (Pi's model context then lacks its text) and the entries after it stay within the limits. Turns are the
 * assistant messages after it, including the one making the current call; tokens are those of message, custom_message
 * and branch_summary entries, with context_edit replacements counted (`tokensOf`). Scans from the end and stops at the
 * first limit, so the work is bounded by MAX_TOKENS.
 */
function recentEnough(branch: any[], callId: string): boolean {
	let turns = 0;
	let tokens = 0;
	// Edits come after their targets in the branch, so the backward scan has met them when it reaches the target; the
	// first one met is the latest, which is the one Pi applies.
	const edits = new Map<string, any>();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type === "compaction") return false;
		if (entry.type === "context_edit" && !edits.has(entry.targetId)) edits.set(entry.targetId, entry);
		const message = contextMessage(entry);
		if (message?.role === "toolResult" && message.toolCallId === callId) return !edits.has(entry.id);
		if (message) {
			if (message.role === "assistant") turns++;
			tokens += tokensOf(message, edits.get(entry.id));
		}
		if (turns > MAX_TURNS || tokens > MAX_TOKENS) return false;
	}
	return false;
}

/** The one memory of a tool set (one per session; a subagent's tools have their own). */
export function createUnchangedReads() {
	const seen = new Map<string, Seen>();
	const keyOf = (sessionId: string, file: string, params: any) => JSON.stringify([sessionId, file, params?.offset ?? null, params?.limit ?? null]);

	return {
		version: versionOf,
		/** The note replacing the content of this read, or undefined when the content must be returned. */
		async check(ctx: any, file: string, params: any): Promise<string | undefined> {
			const session = sessionOf(ctx);
			const last = session && seen.get(keyOf(session.id, file, params));
			if (!last || stat(file)?.mtimeMs !== last.mtimeMs || !recentEnough(session.branch, last.callId)) return undefined;
			if ((await hashOf(file)) !== last.hash) return undefined;
			return "unchanged since your last read of this range; its text is earlier in this conversation. To get the content again, call read with force: true.";
		},

		/**
		 * Remembers a full read whose result `result` the model got as tool call `callId`. Errors, images (also one the
		 * stock tool could not process and answered with text only) and a file that changed while it was read are not
		 * remembered. The image test is the stock tool's own detector, so both always agree.
		 */
		async remember(ctx: any, file: string, params: any, callId: string, result: any, before: Version | undefined): Promise<void> {
			const session = sessionOf(ctx);
			const content = result?.content;
			if (!session || result?.isError || !Array.isArray(content)) return;
			if (await detectSupportedImageMimeTypeFromFile(file)) return;
			const after = await versionOf(file);
			if (!before || !after || before.mtimeMs !== after.mtimeMs || before.hash !== after.hash) return;
			seen.set(keyOf(session.id, file, params), { callId, ...before });
		},
	};
}
