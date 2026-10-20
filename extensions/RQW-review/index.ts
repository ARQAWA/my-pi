// Extension 5: the `review` tool. Each call starts a fresh read-only reviewer session in this process on the model of
// its level, with REVIEWER.md as the prompt and a brief built from the user's own messages; the call returns at once
// and the verdict comes back later as a `[review#N]` message that starts a turn.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	createExtensionRuntime,
	type ExtensionAPI,
	type ExtensionContext,
	type ModelRuntime,
	type ResourceLoader,
	type SessionEntry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** The reviewer of each level. The levels and models are fixed; the thinking levels wait for measurement. */
export const LEVELS = {
	blind: { provider: "anthropic", model: "claude-haiku-5-5", thinking: "medium" },
	high: { provider: "anthropic", model: "claude-sonnet-5-5", thinking: "low" },
} as const;
export type Level = keyof typeof LEVELS;

/** Stock Pi tools of the reviewer: read only. */
export const REVIEWER_TOOLS = ["read", "grep", "find"];
export const TIMEOUT_MS = 10 * 60 * 1000;
export const MESSAGE_TYPE = "review";

export const REVIEWER = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "REVIEWER.md"), "utf8").trimEnd();

const DESCRIPTION =
	"Blind review of finished work by a separate read-only model; the user's own messages are passed to it verbatim. " +
	"Use it when the user asks for a review or a checked result. The call returns at once; the verdict arrives later " +
	"as a message starting with `[review#N]`: CLEAN or numbered findings. Keep working meanwhile. Fix every admitted " +
	"finding; reject one only with a reason backed by a verbatim quote.";

const parameters = Type.Object({
	level: StringEnum(["blind", "high"] as const, { description: "blind by default; high when the user asks for it." }),
	object: Type.String({
		description:
			"Paths of the object and its sources, the diff as a file path (the reviewer only reads files), and the stage: pre-action or pre-completion.",
	}),
	criterion: Type.String({ description: "What this check confirms." }),
	agreement: Type.Optional(
		Type.String({ description: "Accepted proposals and decisions that are not in the user's own messages, verbatim." }),
	),
	rejected: Type.Optional(Type.String({ description: "Findings rejected in earlier passes, each with its reason." })),
});

type Params = {
	level: Level;
	object: string;
	criterion: string;
	agreement?: string | null;
	rejected?: string | null;
};

// No extensions, skills, prompt templates, themes or context files; the prompt is REVIEWER.md.
function reviewerResources(): ResourceLoader {
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => REVIEWER,
		getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => [],
		getAppendSystemPromptSources: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const c of content) {
		if (!c || typeof c !== "object" || !("type" in c)) continue;
		if (c.type === "text" && "text" in c && typeof c.text === "string") parts.push(c.text);
		else if (c.type === "image") parts.push("[image]");
	}
	return parts.join("\n");
}

/** The user's own messages of the branch, verbatim and in order, with compaction and branch summaries labeled. */
export function userMessages(entries: readonly SessionEntry[]): string {
	const parts: string[] = [];
	let n = 0;
	for (const entry of entries) {
		if (entry.type === "message" && entry.message.role === "user") {
			parts.push(`<message n="${++n}">\n${textOf(entry.message.content)}\n</message>`);
		} else if (entry.type === "compaction") {
			parts.push(`<compaction_summary note="written by the main model when it compacted the context, not the user's words">\n${entry.summary}\n</compaction_summary>`);
		} else if (entry.type === "branch_summary") {
			parts.push(`<branch_summary note="written by the main model for an abandoned branch, not the user's words">\n${entry.summary}\n</branch_summary>`);
		}
	}
	return parts.join("\n\n");
}

// Strict tool mode fills every optional field, so an empty or null value means "not given".
const given = (value: string | null | undefined): value is string => typeof value === "string" && value.trim() !== "";

export function buildBrief(entries: readonly SessionEntry[], params: Params): string {
	const sections = [`<user_messages>\n${userMessages(entries)}\n</user_messages>`];
	if (given(params.agreement)) sections.push(`<agreement>\n${params.agreement}\n</agreement>`);
	sections.push(`<object>\n${params.object}\n</object>`, `<criterion>\n${params.criterion}\n</criterion>`);
	if (given(params.rejected)) sections.push(`<rejected_earlier>\n${params.rejected}\n</rejected_earlier>`);
	return sections.join("\n\n");
}

const SHUTDOWN = "shutdown";
const TIMEOUT = "timeout";

/** One reviewer session from start to its last assistant text. Throws with the reason when there is no verdict. */
async function runReviewer(level: Level, brief: string, ctx: ExtensionContext, signal: AbortSignal): Promise<string> {
	const spec = LEVELS[level];
	const name = `${spec.provider}/${spec.model}`;
	const model = ctx.modelRegistry.find(spec.provider, spec.model);
	if (!model) throw new Error(`model ${name} is not available`);
	if (!ctx.modelRegistry.hasConfiguredAuth(model)) throw new Error(`no credentials for ${spec.provider} (model ${name})`);
	// The session's own runtime, so providers and credentials registered by the user's extensions reach the
	// reviewer too. ModelRegistry keeps it in a field that is private only to TypeScript.
	const modelRuntime = (ctx.modelRegistry as unknown as { runtime?: ModelRuntime }).runtime;
	if (!modelRuntime) throw new Error("the model runtime of the session is not reachable");

	const { session } = await createAgentSession({
		cwd: ctx.cwd,
		model,
		thinkingLevel: spec.thinking,
		modelRuntime,
		resourceLoader: reviewerResources(),
		tools: [...REVIEWER_TOOLS],
		sessionManager: SessionManager.inMemory(ctx.cwd),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
	});
	const stop = () => void session.abort();
	try {
		signal.addEventListener("abort", stop, { once: true });
		if (signal.aborted) throw new Error("aborted");
		await session.prompt(brief);
		if (signal.aborted) throw new Error("aborted");
		const last = [...session.messages].reverse().find((m) => m.role === "assistant");
		if (last?.role === "assistant" && last.stopReason === "error") {
			throw new Error(last.errorMessage || "the model request failed");
		}
		if (last?.role === "assistant" && last.stopReason === "aborted") throw new Error("aborted");
		const text = session.getLastAssistantText()?.trim();
		if (!text) throw new Error("the reviewer gave no verdict");
		return text;
	} finally {
		signal.removeEventListener("abort", stop);
		session.dispose();
	}
}

/** The highest review number already used in this session, so a resumed session goes on counting. */
function lastNumber(entries: readonly SessionEntry[]): number {
	let max = 0;
	for (const entry of entries) {
		let text = "";
		if (entry.type === "custom_message" && entry.customType === MESSAGE_TYPE) text = textOf(entry.content);
		else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "review") {
			text = textOf(entry.message.content);
		}
		const m = /review#(\d+)/.exec(text);
		if (m) max = Math.max(max, Number(m[1]));
	}
	return max;
}

export default function review(pi: ExtensionAPI) {
	let counter = 0;
	const running = new Set<AbortController>();

	pi.on("session_start", (_event, ctx) => {
		counter = lastNumber(ctx.sessionManager.getEntries());
	});
	pi.on("session_shutdown", () => {
		for (const job of running) job.abort(SHUTDOWN);
		running.clear();
	});

	async function job(n: number, level: Level, brief: string, ctx: ExtensionContext) {
		const controller = new AbortController();
		running.add(controller);
		const startedAt = Date.now();
		const timer = setTimeout(() => controller.abort(TIMEOUT), TIMEOUT_MS);
		// A running review never keeps the process alive.
		timer.unref?.();
		let verdict: string;
		try {
			verdict = await runReviewer(level, brief, ctx, controller.signal);
		} catch (error) {
			const reason =
				controller.signal.reason === TIMEOUT
					? `no verdict within ${TIMEOUT_MS / 60000} minutes`
					: error instanceof Error
						? error.message
						: String(error);
			verdict = `Review failed: ${reason}`;
		} finally {
			clearTimeout(timer);
			running.delete(controller);
		}
		// The session that asked is gone; nobody is left to read the verdict.
		if (controller.signal.reason === SHUTDOWN) return;
		try {
			pi.sendMessage(
				{
					customType: MESSAGE_TYPE,
					content: `[review#${n}] ${verdict}`,
					display: true,
					// For the user and the logs only; details do not reach the model.
					details: {
						n,
						level,
						model: `${LEVELS[level].provider}/${LEVELS[level].model}`,
						thinking: LEVELS[level].thinking,
						seconds: Math.round((Date.now() - startedAt) / 100) / 10,
					},
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} catch {
			// The session ended between the verdict and its delivery.
		}
	}

	pi.registerTool({
		name: "review",
		label: "review",
		description: DESCRIPTION,
		parameters,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const p = params as Params;
			const n = ++counter;
			const brief = buildBrief(ctx.sessionManager.getBranch(), p);
			void job(n, p.level, brief, ctx);
			return {
				content: [{ type: "text", text: `review#${n} started` }],
				details: { n, level: p.level },
			};
		},
	});
}
