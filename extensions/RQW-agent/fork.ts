import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { slicePacer } from "./persistence.ts";

type ReadonlySessionManager = ExtensionContext["sessionManager"];

/** The path from the root to `leaf`, walked in slices that yield to the event loop: a long session has tens of thousands of entries. */
async function pathTo(manager: ReadonlySessionManager, leaf: SessionEntry | undefined, pace: () => Promise<void>): Promise<SessionEntry[]> {
	const path: SessionEntry[] = [];
	for (let entry = leaf; entry; entry = entry.parentId ? manager.getEntry(entry.parentId) : undefined) {
		path.push(entry);
		await pace();
	}
	return path.reverse();
}

/**
 * Copy only the conversation on the branch ending at `leaf`, before the first unfinished tool-call group.
 * `leaf` is taken when the caller asks; the walk and the copy yield to the event loop, so a long branch does not freeze the UI.
 */
export async function forkBranch(manager: ReadonlySessionManager, leaf: SessionEntry | undefined): Promise<SessionEntry[]> {
	const pace = slicePacer();
	const branch = await pathTo(manager, leaf, pace);
	const answered = new Set<string>();
	for (const entry of branch) {
		if (entry.type === "message" && entry.message.role === "toolResult") answered.add(entry.message.toolCallId);
		await pace();
	}
	let cut = -1;
	for (let i = 0; i < branch.length && cut < 0; i++) {
		const entry = branch[i];
		if (entry.type === "message" && entry.message.role === "assistant"
			&& entry.message.content.some(part => part.type === "toolCall" && !answered.has(part.id))) cut = i;
		await pace();
	}
	const conversation = cut < 0 ? branch : branch.slice(0, cut);
	const position = new Map<string, number>();
	for (const [index, entry] of conversation.entries()) {
		position.set(entry.id, index);
		await pace();
	}
	let parentId: string | null = null;
	const entries: SessionEntry[] = [];
	const kept = new Set<string>();
	for (const entry of conversation) {
		await pace();
		if (!["message", "custom_message", "compaction", "branch_summary", "context_edit", "model_change", "thinking_level_change"].includes(entry.type)) continue;
		const copy = structuredClone(entry);
		copy.parentId = parentId;
		if (copy.type === "custom_message") delete copy.details;
		if (copy.type === "compaction" && !kept.has(copy.firstKeptEntryId)) copy.firstKeptEntryId = await firstKept(conversation, position.get(copy.firstKeptEntryId), kept, copy.id, pace);
		entries.push(copy);
		kept.add(copy.id);
		parentId = copy.id;
	}
	return entries;
}

/** The first entry from `start` on that was copied; the compaction's own id when the old first kept entry is not on the branch or nothing after it was copied. */
async function firstKept(conversation: SessionEntry[], start: number | undefined, kept: Set<string>, own: string, pace: () => Promise<void>): Promise<string> {
	for (let i = start ?? conversation.length; i < conversation.length; i++) {
		if (kept.has(conversation[i].id)) return conversation[i].id;
		await pace();
	}
	return own;
}
