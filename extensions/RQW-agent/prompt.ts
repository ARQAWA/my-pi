// System prompts of the children. A subagent gets the main agent's system prompt (as Pi built it for the main run,
// read through the public `ctx.getSystemPrompt()`), then the subagent reminder, then the caller's optional role.
// An explorer gets the same prompt with the search role. Workers keep their role file and get cwd, OS and date.
// DECISIONS.md, sections Agent and Workers.
import { arch, release } from "node:os";

/** Cursor-style reminder: the child answers its caller; rules addressed to the main agent or a coordinator are not its own. */
export const SUBAGENT_REMINDER = [
	"<subagent>",
	"You are running as a subagent: a caller agent started you through a tool and gave you your task.",
	"Your final answer goes to that caller, not to the user: answer it with what it asked for.",
	"Instructions above that address the main agent or a coordinator do not apply to you.",
	"</subagent>",
].join("\n");

export const THOROUGHNESS = ["quick", "medium", "very thorough"] as const;
export type Thoroughness = (typeof THOROUGHNESS)[number];

/** The very short search role of an explorer, at one thoroughness level. */
export function explorerRole(level: Thoroughness): string {
	return [
		"You are a file search specialist. Find what the caller asks for in this codebase and report it.",
		`Thoroughness: ${level}. quick: a targeted lookup, the first good match. medium: a moderate search of the likely places. very thorough: a comprehensive search of every plausible place and naming variant.`,
		"You read and search only: do not create, edit or delete files and do not change git state.",
		"Run independent searches in parallel. Return file paths as absolute paths, with the lines that answer the question.",
	].join("\n");
}

/** The default subagent prompt: the main agent's prompt, the reminder, then the role when given. */
export function subagentPrompt(base: string, role?: string, preserveRoleWhitespace = false): string {
	const parts = [base.trimEnd(), SUBAGENT_REMINDER];
	// File roles preserve their decoded text, including an empty file; inline roles retain normalization.
	if (preserveRoleWhitespace ? role !== undefined : role?.trim())
		parts.push(`<role>\n${preserveRoleWhitespace ? role : role!.trim()}\n</role>`);
	return parts.filter(Boolean).join("\n\n");
}

/** The block appended to a worker's role prompt: working directory, OS and today's date. */
export function workerEnvironment(cwd: string, now = new Date()): string {
	return [
		"<environment>",
		`- Working directory: ${cwd}`,
		`- OS: ${process.platform} ${release()} (${arch()})`,
		`- Today (UTC): ${now.toISOString().slice(0, 10)}`,
		"</environment>",
	].join("\n");
}

/** A worker's whole prompt: its fixed role file, then the environment block. */
export function workerPrompt(role: string, cwd: string, now = new Date()): string {
	return `${role.trimEnd()}\n\n${workerEnvironment(cwd, now)}`;
}
