// RQW-codex: usage invalidation for portable history on one real Pi 1.4.0 AgentSession. After a native Codex checkpoint,
// the latest owned Codex usage describes the compressed wire, not the original physical history. Stock Pi trusts that
// usage until a later context_edit or compaction, so it underestimates. This module appends one identical-content
// context_edit (a no-op for the logical model content) on the smallest visible entry, which makes stock Pi fall back to
// its physical estimate. Original entries, usage, costs, messages, compaction entries and model queries are never changed.
// Imports: Pi SDK types/runtime and npm packages only.
import { calculateContextTokens, type AgentSession, type SessionProjection } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";

/** Owned Codex pair (session.ts): only usage from this provider and API can be stale after a native checkpoint. */
export const PORTABLE_HISTORY_PROVIDER = "openai-codex";
export const PORTABLE_HISTORY_API = "openai-codex-responses";

export type PortableHistoryOptions = {
	/** True when this branch holds a valid native Codex checkpoint. */
	hasNativeCheckpoint: () => boolean;
};

export type PortableHistory = {
	/** Appends the usage-invalidating no-op edit when needed. Returns true only when an edit was appended. */
	invalidate(): boolean;
	/** Invalidates once more, then stops listening. Idempotent. */
	release(): void;
};

type Target = { id: string; content: string | unknown[] };

const EDITABLE_ROLES: ReadonlySet<string> = new Set(["user", "assistant", "toolResult"]);
/** Public events that Pi emits only after the message_end persistence of the turn has completed. */
const PERSISTED_EVENTS: ReadonlySet<string> = new Set(["turn_end", "agent_end"]);

function isValidUsage(message: AssistantMessage): boolean {
	return message.stopReason !== "aborted" && message.stopReason !== "error" && !!message.usage && calculateContextTokens(message.usage) > 0;
}

/** Smallest currently visible, editable content of the projected session (after earlier edits). */
function smallestVisible(projection: SessionProjection): Target | undefined {
	let best: { target: Target; size: number } | undefined;
	for (const item of projection.entries) {
		const source = item.sourceEntry;
		const editable = source.type === "custom_message" || (source.type === "message" && EDITABLE_ROLES.has(source.message.role));
		if (!editable) continue;
		for (const message of item.messages) {
			if (!EDITABLE_ROLES.has(message.role) && message.role !== "custom") continue;
			const content = (message as { content?: unknown }).content;
			if (typeof content !== "string" && !Array.isArray(content)) continue;
			const size = JSON.stringify(content).length;
			if (!best || size < best.size) best = { target: { id: source.id, content: content as Target["content"] }, size };
		}
	}
	return best?.target;
}

export function installPortableHistory(session: AgentSession, options: PortableHistoryOptions): PortableHistory {
	const manager = session.sessionManager;
	let released = false;

	/** The latest valid assistant usage must be from the owned pair and not yet followed by an edit or compaction. */
	const invalidateOnce = (): boolean => {
		if (!options.hasNativeCheckpoint()) return false;
		const branch = manager.getBranch();
		let latest = -1;
		for (let index = branch.length - 1; index >= 0; index--) {
			const entry = branch[index]!;
			if (entry.type === "message" && entry.message.role === "assistant" && isValidUsage(entry.message as AssistantMessage)) {
				latest = index;
				break;
			}
		}
		if (latest < 0) return false;
		const usage = branch[latest]!;
		const message = (usage as { message: AssistantMessage }).message;
		if (message.provider !== PORTABLE_HISTORY_PROVIDER || message.api !== PORTABLE_HISTORY_API) return false;
		if (branch.slice(latest + 1).some((entry) => entry.type === "context_edit" || entry.type === "compaction")) return false;
		const target = smallestVisible(manager.buildSessionProjection());
		if (!target) return false;
		manager.appendContextEdit(target.id, { content: structuredClone(target.content) } as Parameters<typeof manager.appendContextEdit>[1]);
		return true;
	};

	const invalidate = (): boolean => (released ? false : invalidateOnce());

	const unsubscribe = session.subscribe((event) => {
		if (!released && PERSISTED_EVENTS.has(event.type)) invalidateOnce();
	});

	return {
		invalidate,
		release() {
			if (released) return;
			invalidate();
			released = true;
			unsubscribe();
		},
	};
}
