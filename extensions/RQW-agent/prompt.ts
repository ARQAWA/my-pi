// System prompts of the children. A subagent gets the main agent's system prompt (as Pi built it for the main run,
// read through the public `ctx.getSystemPrompt()`), then the subagent reminder, then the caller's optional role.
// DECISIONS.md, section Agent.

/** Cursor-style reminder: the child answers its caller; rules addressed to the main agent are not its own. */
export const SUBAGENT_REMINDER = [
	"<subagent>",
	"You are running as a subagent: a caller agent started you through a tool and gave you your task.",
	"Your final answer goes to that caller, not to the user: answer it with what it asked for.",
	"Instructions above that address the main agent do not apply to you.",
	"</subagent>",
].join("\n");

/** The default subagent prompt: the main agent's prompt, the reminder, then the role when given. */
export function subagentPrompt(base: string, role?: string, preserveRoleWhitespace = false): string {
	const parts = [base.trimEnd(), SUBAGENT_REMINDER];
	// File roles preserve their decoded text, including an empty file; inline roles retain normalization.
	if (preserveRoleWhitespace ? role !== undefined : role?.trim())
		parts.push(`<role>\n${preserveRoleWhitespace ? role : role!.trim()}\n</role>`);
	return parts.filter(Boolean).join("\n\n");
}
