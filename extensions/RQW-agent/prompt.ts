// System prompts of the children. A subagent gets the main agent's system prompt (as Pi built it for the main run,
// read through the public `ctx.getSystemPrompt()`), then the subagent reminder, then the caller's optional role.
// DECISIONS.md, section Agent.

/** Cursor's subagent reminder, always part of every child prompt. */
export const SUBAGENT_REMINDER = [
	"<subagent>",
	"You are running as a subagent under a parent agent. Do not spawn additional subagents unless requested by the user or by your instructions.",
	"</subagent>",
].join("\n");

/** The reminder text shipped before Cursor parity; kept only to rebuild saved children (DECISIONS.md, Agent). */
export const LEGACY_SUBAGENT_REMINDER = [
	"<subagent>",
	"You are running as a subagent: a caller agent started you through a tool and gave you your task.",
	"Your final answer goes to that caller, not to the user: answer it with what it asked for.",
	"Instructions above that address the main agent do not apply to you.",
	"</subagent>",
].join("\n");

/** Cursor's completion follow-up, appended to every delivered final result (push, wait, child_wait). */
export const FOLLOW_UP = "Perform any necessary follow-up actions in response to the subagent completion above. If no follow-up work is needed, no further action is required. Don't repeat the same confirmation every time.";

/** The default subagent prompt: the main agent's prompt, the reminder, then the role when given. */
export function subagentPrompt(base: string, role?: string, preserveRoleWhitespace = false): string {
	const parts = [base.trimEnd(), SUBAGENT_REMINDER];
	// File roles preserve their decoded text, including an empty file; inline roles retain normalization.
	if (preserveRoleWhitespace ? role !== undefined : role?.trim())
		parts.push(`<role>\n${preserveRoleWhitespace ? role : role!.trim()}\n</role>`);
	return parts.filter(Boolean).join("\n\n");
}

/**
 * Brings a persisted child prompt to the current reminder: the legacy block is replaced in place by the current one,
 * all other bytes unchanged; the reminder is appended only when it is still missing afterwards.
 */
export function withCurrentReminder(system: string): string {
	const replaced = system.replace(LEGACY_SUBAGENT_REMINDER, () => SUBAGENT_REMINDER);
	return replaced.includes(SUBAGENT_REMINDER) ? replaced : `${replaced}\n\n${SUBAGENT_REMINDER}`;
}
