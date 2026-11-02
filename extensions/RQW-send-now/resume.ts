// Ctrl+R restarts an interrupted turn. Pi 1.4.0 has no public continue and drops an aborted reply from the next request,
// so the restart is Pi's own custom-message run: a hidden note after the saved conversation, which keeps every
// extension hook, the settle event and the post-run handling of a normal turn.
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** Custom message type of the restart note; the note is hidden in the chat and stays in the model's context. */
export const RESUME_TYPE = "rqw-resume";
export const RESUME_NOTE = "The previous turn was interrupted before it finished. Continue it from where it stopped.";

/** Entries without conversation: they may follow an interrupted message and do not end its turn. */
const SILENT = new Set<string>(["custom", "label", "model_change", "session_info", "thinking_level_change", "usage"]);

/** The agent and job waits end the turn on purpose; Pi does not save the terminate flag, their receipt says `waiting`. */
const endedTurn = (message: { details?: unknown }) => (message.details as { reason?: unknown } | undefined)?.reason === "waiting";

/**
 * True when the branch ends in an interrupted turn: the last conversation entry is no finished answer. That is a reply
 * Escape aborted, or what a quit with Ctrl+D or a crash left behind: the request, the call of a tool that was
 * running, or the results of tools whose next reply was never saved. A turn a wait ended on purpose is finished.
 */
export function interrupted(branch: readonly SessionEntry[]): boolean {
	const conversation = branch.filter(entry => !SILENT.has(entry.type));
	const last = conversation.at(-1);
	if (last?.type !== "message") return false;
	const message = last.message;
	if (message.role === "user") return true;
	if (message.role === "toolResult") return !batchEndedTurn(conversation);
	return message.role === "assistant" && (message.stopReason === "aborted" || message.stopReason === "toolUse");
}

/** Pi ends the turn only when every call of the last tool batch terminated; a batch with results still missing is cut. */
function batchEndedTurn(conversation: readonly SessionEntry[]): boolean {
	const results: { details?: unknown }[] = [];
	let index = conversation.length - 1;
	for (; index >= 0; index--) {
		const entry = conversation[index];
		if (entry.type !== "message" || entry.message.role !== "toolResult") break;
		results.push(entry.message);
	}
	const caller = conversation[index];
	if (caller?.type !== "message" || caller.message.role !== "assistant") return false;
	const calls = caller.message.content.filter(block => block.type === "toolCall").length;
	return results.length >= calls && results.every(endedTurn);
}
