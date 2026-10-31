import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** Copy only the selected conversation, before the first unfinished tool-call group. */
export function forkBranch(branch: SessionEntry[]): SessionEntry[] {
	const answered = new Set(branch.flatMap(entry => entry.type === "message" && entry.message.role === "toolResult" ? [entry.message.toolCallId] : []));
	const cut = branch.findIndex(entry => entry.type === "message" && entry.message.role === "assistant"
		&& entry.message.content.some(part => part.type === "toolCall" && !answered.has(part.id)));
	const conversation = cut < 0 ? branch : branch.slice(0, cut);
	let parentId: string | null = null;
	const entries: SessionEntry[] = [];
	for (const entry of conversation) {
		if (!["message", "custom_message", "compaction", "branch_summary", "context_edit", "model_change", "thinking_level_change"].includes(entry.type)) continue;
		const copy = structuredClone(entry);
		copy.parentId = parentId;
		if (copy.type === "custom_message") delete copy.details;
		if (copy.type === "compaction" && !entries.some(previous => previous.id === copy.firstKeptEntryId)) {
			const first = conversation.findIndex(previous => previous.id === copy.firstKeptEntryId);
			const kept = new Set(entries.map(previous => previous.id));
			copy.firstKeptEntryId = conversation.slice(first < 0 ? conversation.length : first).find(previous => kept.has(previous.id))?.id ?? copy.id;
		}
		entries.push(copy);
		parentId = copy.id;
	}
	return entries;
}
