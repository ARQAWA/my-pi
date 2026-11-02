// What a child was waiting for when Pi stopped, read back from its own session after a restart.
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** The child's durable inbox record; also written by its own loop (see NotificationBridge in index.ts). */
export const INBOX_ENTRY = "rqw-agent-inbox";
/** `{ version: 1, ids }`: the live ids the child waits for, saved when it starts waiting and after every delivery. */
export const WAITING_ENTRY = "rqw-agent-waiting";

export const LOST_TEXT = "Pi restarted or reloaded; this work ended without a result.";

const resultIds = (details: unknown): string[] => {
	const results = (details as { results?: unknown } | undefined)?.results;
	return Array.isArray(results) ? results.flatMap(result => typeof result?.id === "string" ? [result.id] : []) : [];
};

const markerAt = (branch: readonly SessionEntry[]) => branch.findLastIndex(entry => entry.type === "custom" && entry.customType === WAITING_ENTRY
	&& (entry.data as { version?: unknown } | undefined)?.version === 1 && Array.isArray((entry.data as { ids?: unknown }).ids));

const idsOf = (entry: SessionEntry | undefined): string[] => entry?.type === "custom"
	? (entry.data as { ids: unknown[] }).ids.filter((id): id is string => typeof id === "string") : [];

/** The ids the child last said it waits for; none when it never waited. */
export const markedIds = (branch: readonly SessionEntry[]): string[] => idsOf(branch[markerAt(branch)]);

/**
 * The ids of the last waiting marker whose result is not saved after the marker
 * (a result in the inbox, in a custom message or in a successful wait result counts; hydration already published the finished ones).
 */
export function unsavedIds(branch: readonly SessionEntry[]): string[] {
	const at = markerAt(branch);
	if (at < 0) return [];
	const saved = new Set<string>();
	for (const entry of branch.slice(at + 1)) {
		if (entry.type === "custom_message") for (const id of resultIds(entry.details)) saved.add(id);
		// An explicit wait that returned the result counts too.
		else if (entry.type === "message" && entry.message.role === "toolResult" && !entry.message.isError)
			for (const id of resultIds(entry.message.details)) saved.add(id);
		else if (entry.type === "custom" && entry.customType === INBOX_ENTRY)
			for (const id of resultIds((entry.data as { message?: { details?: unknown } } | undefined)?.message?.details)) saved.add(id);
	}
	return idsOf(branch[at]).filter(id => !saved.has(id));
}

/** The unsaved ids that are not alive now: their work ended with the old process. */
export const lostIds = (branch: readonly SessionEntry[], alive: (id: string) => boolean): string[] => unsavedIds(branch).filter(id => !alive(id));
