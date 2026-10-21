// Extension 5: the `review` tool. Each call starts a fresh read-only reviewer session in this process on the model of
// its level, with REVIEWER.md as the prompt and a brief built from the user's own messages; the call returns at once
// and the verdict comes back later as a `[review#N]` message that the main model answers.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	createExtensionRuntime,
	createFindToolDefinition,
	createGrepToolDefinition,
	type ExtensionAPI,
	type ExtensionContext,
	type ModelRuntime,
	type ResourceLoader,
	type SessionEntry,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** The reviewer of each level. The levels and models are fixed; the thinking levels wait for measurement. */
export const LEVELS = {
	blind: { provider: "anthropic", model: "claude-haiku-5-5", thinking: "medium" },
	high: { provider: "anthropic", model: "claude-sonnet-5-5", thinking: "low" },
} as const;
export type Level = keyof typeof LEVELS;

/** Stock Pi tools of the reviewer: read only. grep and find go in through `reviewerTools`. */
export const REVIEWER_TOOLS = ["read", "grep", "find"];
export const TIMEOUT_MS = 10 * 60 * 1000;
export const MESSAGE_TYPE = "review";

export const REVIEWER = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "REVIEWER.md"), "utf8").replace(/\r\n/g, "\n").trimEnd();

export const DESCRIPTION =
	"Blind review by a separate read-only model that works with you as one team for the user's agreement: " +
	"it checks the requested criterion, including checks beyond the agreement and exclusions, and gets the user's own messages verbatim. Use " +
	"it when the user asks for a review or a checked result. The call returns at once; the verdict arrives later as a " +
	"message starting with `[review#N]`, together with what to do next. Keep working meanwhile.";

/** What the main agent does next, appended to each verdict by its kind; the pair rules live here, not in the prompt. */
export const NEXT = {
	clean: "The check passed; run no further pass for confidence.",
	findings:
		"Your teammate's findings. Find each quote by searching for it. A finding whose two quotes stand verbatim in their " +
		"sources is admitted: fix it exactly to its REQUIRED OUTCOME and no further; do not reject it, argue with it or " +
		"put it to the user. Reject a finding only when a quote is not verbatim, or a NOT AGREED element is covered by a " +
		"verbatim quote of the agreement, and give that reason with the quote. Fix all admitted findings in one batch, " +
		"then call `review` again with the same level, object and criterion and every rejection so far in `rejected`, " +
		"until CLEAN.",
	incomplete:
		"The check is incomplete. Resolve UNCHECKED sources or retry malformed output; never claim the check passed.",
	failed:
		"The check has not passed, and no self-check replaces it. Call `review` again once on the unchanged object; if it " +
		"fails again, tell the user and wait.",
} as const;

/** The delivered message: `[review#N]` first, the verdict verbatim, then the next step for its kind. */
export function verdictMessage(n: number, verdict: string, failed: boolean): string {
	const kind = failed ? "failed" : verdict.trim() === "CLEAN" ? "clean" : verdict.trim().startsWith("CLEAN") ? "incomplete" : "findings";
	return `[review#${n}] ${verdict}\n\n${NEXT[kind]}`;
}

/** The tool result of a call. */
export const startedText = (n: number) =>
	`review#${n} started. Keep working, but leave the reviewed files unchanged until its verdict.`;

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

const EMPTY = new Set(["", "null", "undefined"]);

/**
 * Optional arguments sent as the string "null", "undefined" or blank count as not given. Stock grep would pass
 * `--glob null` to rg and answer "No matches found", a silent false negative for the reviewer.
 */
export function dropEmptyOptional(input: unknown, required: readonly string[]): unknown {
	if (!input || typeof input !== "object" || Array.isArray(input)) return input;
	const entries = Object.entries(input);
	const kept = entries.filter(([key, value]) => required.includes(key) || typeof value !== "string" || !EMPTY.has(value.trim()));
	return kept.length === entries.length ? input : Object.fromEntries(kept);
}

/** Stock grep and find with `dropEmptyOptional` before Pi validates the arguments; execute stays stock. */
export function reviewerTools(cwd: string): ToolDefinition[] {
	return [createGrepToolDefinition(cwd), createFindToolDefinition(cwd)].map((stock) => {
		const definition = stock as unknown as ToolDefinition;
		const required: string[] = (definition.parameters as { required?: string[] }).required ?? [];
		const prepare = definition.prepareArguments;
		return {
			...definition,
			prepareArguments: (input: unknown) => {
				const args = dropEmptyOptional(input, required);
				return prepare ? prepare(args) : args;
			},
		} as ToolDefinition;
	});
}

const SHUTDOWN = "shutdown";
const TIMEOUT = "timeout";

/** Stop waiting even when an SDK preflight ignores cancellation; observe its eventual rejection too. */
async function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
	const aborted = Promise.withResolvers<never>();
	const stop = () => aborted.reject(new Error("aborted"));
	signal.addEventListener("abort", stop, { once: true });
	if (signal.aborted) stop();
	try {
		return await Promise.race([pending, aborted.promise]);
	} finally {
		signal.removeEventListener("abort", stop);
	}
}

/** One reviewer session from start to its last assistant text. Throws with the reason when there is no verdict. */
async function runReviewer(level: Level, brief: string, ctx: ExtensionContext, signal: AbortSignal): Promise<string> {
	signal.throwIfAborted();
	const spec = LEVELS[level];
	const name = `${spec.provider}/${spec.model}`;
	const model = ctx.modelRegistry.find(spec.provider, spec.model);
	if (!model) throw new Error(`model ${name} is not available`);
	// The session's own runtime, so providers and credentials registered by the user's extensions reach the
	// reviewer too. ModelRegistry keeps it in a field that is private only to TypeScript.
	const modelRuntime = (ctx.modelRegistry as unknown as { runtime?: ModelRuntime }).runtime;
	if (!modelRuntime) throw new Error("the model runtime of the session is not reachable");
	// As Pi's prompt: the auth snapshot is filled asynchronously, so a stale one falls back to a direct check.
	if (!ctx.modelRegistry.hasConfiguredAuth(model) && !(await untilAborted(modelRuntime.checkAuth(spec.provider, { signal }), signal)))
		throw new Error(`no credentials for ${spec.provider} (model ${name})`);

	signal.throwIfAborted();
	const creating = createAgentSession({
		cwd: ctx.cwd,
		model,
		thinkingLevel: spec.thinking,
		modelRuntime,
		resourceLoader: reviewerResources(),
		tools: [...REVIEWER_TOOLS],
		customTools: reviewerTools(ctx.cwd),
		sessionManager: SessionManager.inMemory(ctx.cwd),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
	}).then((created) => {
		// createAgentSession has no signal: dispose a session that materializes after cancellation.
		if (signal.aborted) {
			created.session.dispose();
			signal.throwIfAborted();
		}
		return created;
	});
	let created: Awaited<typeof creating>;
	try {
		created = await untilAborted(creating, signal);
	} catch (error) {
		void creating.then(({ session }) => session.dispose()).catch(() => {});
		throw error;
	}
	const { session } = created;
	// Pi 1.3 prompt() awaits auth before an active run exists, so abort() alone cannot stop that preflight.
	// This public request hook stays guarded even if the abandoned prompt resumes after dispose().
	const stream = session.agent.streamFunction;
	session.agent.streamFunction = (model, context, options) => {
		signal.throwIfAborted();
		return stream(model, context, options);
	};
	const stop = () => { void session.abort().catch(() => {}); };
	try {
		signal.addEventListener("abort", stop, { once: true });
		if (signal.aborted) throw new Error("aborted");
		await untilAborted(session.prompt(brief), signal);
		if (signal.aborted) throw new Error("aborted");
		const last = [...session.messages].reverse().find((m) => m.role === "assistant");
		if (last?.role === "assistant" && last.stopReason === "error") {
			throw new Error(last.errorMessage || "the model request failed");
		}
		if (last?.role !== "assistant" || last.stopReason !== "stop") {
			throw new Error(`the reviewer did not complete normally (${last?.stopReason ?? "no assistant response"})`);
		}
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
		if (entry.type === "custom" && entry.customType === MESSAGE_TYPE) {
			const n = (entry.data as { n?: number } | undefined)?.n;
			if (typeof n === "number" && Number.isSafeInteger(n) && n > 0) max = Math.max(max, n);
		}
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
	let main: ExtensionContext | undefined;
	let mainAborted = false;
	const running = new Set<AbortController>();
	/** Every job until its verdict is sent; print and JSON modes wait for them. */
	const jobs = new Set<Promise<void>>();
	/** Verdicts sent while the main session was busy, by review number, until the main model answers after them. */
	const unanswered = new Set<number>();

	pi.on("session_start", (_event, ctx) => {
		main = ctx;
		counter = lastNumber(ctx.sessionManager.getEntries());
	});
	pi.on("session_shutdown", () => {
		for (const job of running) job.abort(SHUTDOWN);
		running.clear();
	});

	// Each review sends one verdict, so its number `n` in `details` is the delivery number.
	type Verdict = { customType: string; content: string; display: boolean; details: { n: number } };
	/** Set once our agent_before_settle handler has run; verdicts sent then wait for agent_settled in `late`. */
	let settling = false;
	const late: Verdict[] = [];
	function deliver(message: Verdict) {
		if (settling) {
			late.push(message);
			return;
		}
		if (mainAborted) {
			pi.sendMessage(message, { triggerTurn: false });
			return;
		}
		if (main?.isIdle() !== false) {
			pi.sendMessage(message, { triggerTurn: true, deliverAs: "followUp" });
			return;
		}
		// Busy: Pi appends a message without triggerTurn to the session at the end of the current turn or run, aborted
		// or not, so Esc and abort cannot drop it (a follow-up waits in the agent's queue, which Esc clears).
		// agent_before_settle adds the turn.
		unanswered.add(message.details.n);
		pi.sendMessage(message, { triggerTurn: false });
	}

	/** Whether a verdict sent while busy still waits for a main turn; drops the ones the model already saw. */
	function needsTurn(ctx: ExtensionContext): boolean {
		const entries = ctx.sessionManager.getEntries();
		const branch = ctx.sessionManager.getBranch();
		const lastAnswer = branch.findLastIndex((e) => e.type === "message" && e.message.role === "assistant");
		const isVerdict = (n: number) => (e: SessionEntry) =>
			e.type === "custom_message" && e.customType === MESSAGE_TYPE && (e.details as { n?: number } | undefined)?.n === n;
		for (const n of unanswered) {
			if (!entries.some(isVerdict(n))) continue; // still held by Pi until the turn ends
			const at = branch.findIndex(isVerdict(n));
			if (at < 0 || at < lastAnswer) unanswered.delete(n); // on another branch, or answered
		}
		return unanswered.size > 0;
	}

	// Print and JSON modes exit when the main run settles, so there the main run waits for running reviews. A verdict
	// sent during the run continues it here; an idle main session gets a verdict as a new turn. After an abort the
	// verdict stays in the session without a turn, and the model sees it on the next one.
	pi.on("agent_end", async (_event, ctx) => {
		// Unlike before_settle, agent_end still has the native run's active abort signal.
		if (ctx.mode !== "print" && ctx.mode !== "json") return;
		const signal = ctx.signal;
		if (!signal) return;
		try {
			while (jobs.size > 0) await untilAborted(Promise.all(jobs), signal);
		} catch (error) {
			if (!signal.aborted) throw error;
		} finally {
			if (signal.aborted) mainAborted = true;
		}
	});
	pi.on("agent_before_settle", (_event, ctx) => {
		if (!mainAborted && needsTurn(ctx)) return { continue: true };
		settling = true;
	});
	// Another extension's agent_before_settle handler may run after ours, so a verdict can come in after our check and
	// before the run settles. It is sent here; Pi defers it until the settle ends and then starts its turn.
	pi.on("agent_start", () => {
		mainAborted = false;
	});
	pi.on("turn_start", () => {
		settling = false;
	});
	pi.on("agent_settled", (event) => {
		mainAborted = event.aborted;
		settling = false;
		// One turn for all of them: Pi defers each triggerTurn separately, so the earlier ones are appended at once and
		// only the last one starts the turn.
		const held = late.splice(0);
		held.forEach((message, i) => pi.sendMessage(message, { triggerTurn: !event.aborted && i === held.length - 1 }));
	});

	async function job(n: number, level: Level, brief: string, ctx: ExtensionContext) {
		const controller = new AbortController();
		running.add(controller);
		const startedAt = Date.now();
		const timer = setTimeout(() => controller.abort(TIMEOUT), TIMEOUT_MS);
		// A running review never keeps the process alive.
		timer.unref?.();
		let verdict: string;
		let failed = false;
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
			failed = true;
		} finally {
			clearTimeout(timer);
			running.delete(controller);
		}
		// The session that asked is gone; nobody is left to read the verdict.
		if (controller.signal.reason === SHUTDOWN) return;
		try {
			deliver({
				customType: MESSAGE_TYPE,
				content: verdictMessage(n, verdict, failed),
				display: true,
				// For the user and the logs only; details do not reach the model.
				details: {
					n,
					level,
					model: `${LEVELS[level].provider}/${LEVELS[level].model}`,
					thinking: LEVELS[level].thinking,
					seconds: Math.round((Date.now() - startedAt) / 100) / 10,
				},
			});
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
			// SDK reload can rebuild an unbound runner without emitting session_start.
			if (!main) {
				main = ctx;
				counter = lastNumber(ctx.sessionManager.getEntries());
			}
			const p = params as Params;
			const n = ++counter;
			pi.appendEntry(MESSAGE_TYPE, { n });
			const brief = buildBrief(ctx.sessionManager.getBranch(), p);
			const pending = job(n, p.level, brief, ctx);
			jobs.add(pending);
			void pending.finally(() => jobs.delete(pending));
			return {
				content: [{ type: "text", text: startedText(n) }],
				details: { n, level: p.level },
			};
		},
	});
}
