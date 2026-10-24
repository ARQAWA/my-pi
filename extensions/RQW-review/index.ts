// Each review pass starts a fresh session with REVIEWER.md and the caller's user messages.
// Only earlier rejected findings and their reasons are carried between passes.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	createCodemodeExtension,
	createFindToolDefinition,
	createGrepToolDefinition,
	DefaultResourceLoader,
	type EventBus,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	type ModelRuntime,
	type SessionEntry,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
	createToolSearchExtension,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { blockedGit } from "./git-guard.ts";
import { COUNTS_REQUEST, COUNTS_VERSION, type CountsRequest, createCountsProducer } from "./counts.ts";
import { fastGpt, inheritedFastGpt } from "./fast-gpt.ts";

/** Smarty and Bossy are fixed profiles, independent of the caller's model. */
export const LEVELS = {
	blind: { provider: "openai-codex", model: "gpt-6.1-sol", thinking: "low" },
	high: { provider: "openai-codex", model: "gpt-6.1-sol", thinking: "medium" },
} as const;
export type Level = keyof typeof LEVELS;
export type Spec = (typeof LEVELS)[Level];

/** The tools of the reviewer, by name: read, bash, grep and find. grep and find go in through `reviewerTools` when no RQW-tools offer is made. */
export const REVIEWER_TOOLS = ["read", "bash", "grep", "find"];
/** Pi's built-in tools a reviewer gets on top of REVIEWER_TOOLS when its caller has them active. */
export const BUILTIN_TOOLS = ["codemode", "tool_search"] as const;
export const MESSAGE_TYPE = "review";

export const REVIEWER = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "REVIEWER.md"), "utf8").replace(/\r\n/g, "\n").trimEnd();

export const DESCRIPTION =
	"Blind review by a separate read-only model on your team, with the user's own messages assembled verbatim. " +
	"Use only when the user asks for review or a checked result, or an invoked skill requires it; never on your own initiative. " +
	"blind uses Smarty (GPT-6.1-Sol low), high uses Bossy (GPT-6.1-Sol medium), only when requested. " +
	"The call returns at once; the verdict arrives as a [review#N] message. Keep working, but leave reviewed files unchanged until it arrives. " +
	"Supply primary requirements, governing rules and evidence, not only your summary; use absolute paths for work in another directory. " +
	"Do not impose file, search, tool-call or turn quotas. " +
	"By default a reviewer inherits GPT Fast; pass fast_gpt false when the user forbids Fast for subagents.";

export const NEXT = {
	clean:
		"The check passed only with complete CHECKED evidence and no UNCHECKED. Run no extra pass for confidence, " +
		"but preserve every independent pass and its order required by the invoking procedure.",
	findings:
		"Your teammate's findings. Find each quote by searching for it. A finding whose two quotes stand verbatim in " +
		"their sources is admitted; for an omission, verify the quoted requirement and the complete inspected file or " +
		"section instead of demanding nonexistent text. Fix it exactly to its REQUIRED OUTCOME and no further; do not " +
		"reject it, argue with it or put it to the user. Reject a finding only when a quote is not verbatim, the allegedly " +
		"missing content is present in the cited object, or a NOT AGREED element is covered by a verbatim quote of the " +
		"agreement, and give that reason with the quote. Fix all admitted findings in one batch, then call review with " +
		"the same level, object and criterion and every rejection so far in rejected_earlier, until CLEAN.",
	incomplete:
		"The check is incomplete regardless of its leading verdict. Resolve missing sources or evidence or retry malformed " +
		"output; never record it as acceptance.",
	failed:
		"The check has not passed, and no self-check replaces it. Call review again once on the unchanged object; " +
		"if it fails again, tell the user and wait.",
} as const;

type Kind = "clean" | "incomplete" | "findings" | "failed";

/** Preserve malformed output too: a preamble is not a valid source verdict. */
export function verdictOf(text: string): string {
	return text.trim();
}

export type Block = { header: string; text: string };
const REQUIRED = ["REQUIREMENT", "MISMATCH", "EVIDENCE", "REQUIRED OUTCOME"] as const;
const FIELD = /^\s*(REQUIREMENT|MISMATCH|EVIDENCE|REQUIRED OUTCOME):[ \t]*(.*)$/;

/** Source quotes may contain the verdict's own headings, including complete templates. */
class SourceQuote {
	private fence = "";
	private quote = "";

	get open() { return this.fence !== "" || this.quote !== ""; }

	scan(line: string) {
		if (this.fence) {
			if (closesFence(line, this.fence)) this.fence = "";
			return;
		}
		for (let i = 0; i < line.length; i++) {
			const char = line[i];
			if (char === "\\") { i++; continue; }
			if (this.quote) {
				const apostrophe = char === "'" && /\w/.test(line[i - 1] ?? "") && /\w/.test(line[i + 1] ?? "");
				if (char === this.quote && !apostrophe) this.quote = "";
				continue;
			}
			if (i > 0 && !/[\s([{=:>]/.test(line[i - 1])) continue;
			const fence = /^(`{3,}|~{3,})/.exec(line.slice(i))?.[1];
			if (fence) {
				const close = line.indexOf(fence, i + fence.length);
				if (close >= 0) { i = close + fence.length - 1; continue; }
				this.fence = fence;
				return;
			}
			if (char === '"' || char === "'") this.quote = char;
		}
	}
}

function closesFence(line: string, fence: string): boolean {
	const close = /^\s*(`{3,}|~{3,})(?:\s+\([^\n]*\))?\s*$/.exec(line)?.[1];
	return close?.[0] === fence[0] && close.length >= fence.length;
}

type Findings = { blocks: Block[]; unchecked: boolean };

/** Only headings outside source quotes can introduce fields, findings or verification sections. */
function parseFindings(verdict: string): Findings | undefined {
	// Literal source delimiters may be unbalanced; both interpretations reject duplicate protocol fields.
	return scanFindings(verdict, true) ?? scanFindings(verdict, false);
}

function scanFindings(verdict: string, quotedSources: boolean): Findings | undefined {
	const text = verdict.replace(/\r\n/g, "\n").trim();
	const lines = text.split("\n");
	if (!/^FINDINGS:[ \t]*$/.test(lines[0])) return undefined;
	const blocks: Block[] = [];
	let header = "";
	let body: string[] = [];
	let fields: string[][] = [];
	let verification = false;
	let unchecked = false;
	const quote = new SourceQuote();
	const finish = () => {
		if (fields.length !== REQUIRED.length || fields.some((value) => !value.join("\n").trim())) return false;
		blocks.push({ header, text: body.join("\n").trim() });
		return true;
	};
	for (const line of lines.slice(1)) {
		if (!quotedSources || !quote.open) {
			const section = /^\s*(CHECKED|UNCHECKED):/.exec(line);
			if (section && (verification || fields.length === REQUIRED.length)) {
				if (!verification && !finish()) return undefined;
				verification = true;
				if (section[1] === "UNCHECKED") unchecked = true;
				continue;
			}
			if (!verification) {
				const next = /^(FINDING\s+\d+)[ \t]*$/.exec(line);
				if (next && (!header || fields.length === REQUIRED.length)) {
					if (header && !finish()) return undefined;
					header = next[1].replace(/\s+/, " ");
					body = [];
					fields = [];
					continue;
				}
				const field = FIELD.exec(line);
				if (header && field) {
					if (field[1] !== REQUIRED[fields.length]) return undefined;
					fields.push([field[2]]);
					body.push(line);
					if (quotedSources && fields.length < REQUIRED.length) quote.scan(field[2]);
					continue;
				}
			}
		}
		if (!verification) {
			if (!header || !fields.length) { if (line.trim()) return undefined; }
			else { body.push(line); fields.at(-1)!.push(line); }
		}
		if (quotedSources && !verification && fields.length < REQUIRED.length) quote.scan(line);
	}
	if (!verification && !finish()) return undefined;
	return blocks.length ? { blocks, unchecked } : undefined;
}

export function findingBlocks(verdict: string): Block[] | undefined {
	return parseFindings(verdict)?.blocks;
}

/** Structure cannot prove coverage: Main must also assess every required obligation against CHECKED. */
export function kindOf(verdict: string, failed: boolean): Kind {
	if (failed) return "failed";
	const text = verdict.replace(/\r\n/g, "\n").trim();
	if (text.startsWith("FINDINGS:")) {
		const findings = parseFindings(text);
		return findings && !findings.unchecked ? "findings" : "incomplete";
	}
	if (/^\s*UNCHECKED:/m.test(text)) return "incomplete";
	if (/^CLEAN\n\s*CHECKED:[ \t]*\n?\s*\S/.test(text) &&
		!/^\s*FINDING(?:S:|\s+\d+)/m.test(text) && (text.match(/^\s*CHECKED:/gm)?.length === 1)) return "clean";
	return "incomplete";
}

export function verdictMessage(n: number, verdict: string, failed: boolean): string {
	return `[review#${n}] ${verdict}\n\n${NEXT[kindOf(verdict, failed)]}`;
}

export type RejectedFinding = { finding: string; reason: string };

/** Rejections belong to the same level, object and criterion, never to unrelated concurrent checks. */
export function rejectedEarlier(entries: readonly SessionEntry[], params: Params): RejectedFinding[] {
	const result: RejectedFinding[] = [];
	const add = (items: readonly RejectedFinding[]) => {
		for (const item of items) {
			if (typeof item?.finding !== "string" || typeof item?.reason !== "string") continue;
			if (!result.some((old) => old.finding === item.finding && old.reason === item.reason)) result.push(item);
		}
	};
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== MESSAGE_TYPE) continue;
		const data = entry.data as Partial<Params> | undefined;
		if (data?.level === params.level && data.object === params.object && data.criterion === params.criterion)
			add(Array.isArray(data.rejected_earlier) ? data.rejected_earlier : []);
	}
	add(params.rejected_earlier ?? []);
	return result;
}

/** The tool result of a call. */
export const startedText = (n: number) =>
	`review#${n} started. Keep working, but leave the reviewed files unchanged until its verdict.`;

const parameters = Type.Object({
	level: StringEnum(["blind", "high"] as const, { description: "blind by default; high when the user asks for it." }),
	object: Type.String({
		description:
			"Paths of the object and its sources, the diff as a file path, and the stage: pre-action or pre-completion.",
	}),
	criterion: Type.String({
		description: "What this check confirms and which deliverable must fulfill each obligation; an exclusion cannot silently waive a governing requirement of this pass.",
	}),
	agreement: Type.Optional(
		Type.String({ description: "Accepted proposals and decisions that are not in the user's own messages, verbatim." }),
	),
	rejected_earlier: Type.Optional(
		Type.Array(Type.Object({
			finding: Type.String({ description: "The earlier rejected finding, verbatim." }),
			reason: Type.String({ description: "Why it was rejected, with the supporting quote." }),
		}), { description: "Every earlier rejected finding with its reason; carried forward for the same level, object and criterion." }),
	),
	fast_gpt: Type.Optional(
		Type.Boolean({ description: "GPT Fast for this reviewer; default: inherit the main chat's. false when the user forbids Fast for subagents." }),
	),
});

export type Params = {
	level: Level;
	object: string;
	criterion: string;
	agreement?: string | null;
	rejected_earlier?: RejectedFinding[] | null;
	fast_gpt?: boolean | null;
};

/**
 * Channel on `pi.events` where RQW-tools, when it is loaded, offers its tools for reviewers: a request `{ offer(factory) }`
 * gets a factory of fresh definitions. Nothing here imports RQW-tools; the same handshake as RQW-agent.
 */
const SUBAGENT_TOOLS = "rqw-tools:subagent-tools";
/**
 * `options.label` names the reviewer in RQW-tools' notes of other sessions; optional. `options.codemode`: the reviewer's
 * own Pi `codemode` definition; the factory returns it as a call of the reviewer's barrier and a job of its registry.
 */
type ToolsFactory = (cwd: string, settings: () => unknown, nested?: undefined, options?: { label?: string; codemode?: ToolDefinition }) => ToolDefinition[];

/**
 * Channel on `pi.events` where RQW-agent, when it is loaded, asks for the `review` tool for each of its general
 * subagents. The request is `{ offer(register) }`; the answer registers this tool in that child's own API, with the
 * main session's bus for the RQW-tools offer, GPT Fast and running counts, the child's GPT Fast, and the child's
 * lifetime. Nothing in RQW-review depends on RQW-agent.
 */
const SUBAGENT_REVIEW = "rqw-review:subagent-review";
/**
 * Where one `review` tool lives: the bus of the main session, the default GPT Fast, and, for a child, its lifetime and
 * the reviewer's label in RQW-tools' notes ("agent#1/review"; "review" when absent).
 */
export type ReviewHost = { events: EventBus; fast: () => boolean; signal?: AbortSignal; label?: string };

/** Reviewer jobs abort when its caller session shuts down or its asking child ends; review completion disposes them. */
type JobControl = { abortAll(): void; dispose(): void };

/** The RQW-tools factory of reviewer tools when RQW-tools is loaded; undefined otherwise. */
function offeredFactory(events: EventBus): ToolsFactory | undefined {
	let factory: ToolsFactory | undefined;
	// Pi's event bus calls every handler synchronously inside emit, so an offer is in place when emit returns.
	events.emit(SUBAGENT_TOOLS, {
		offer: (f: ToolsFactory) => {
			factory = f;
		},
	});
	return factory;
}

/**
 * The offered RQW-tools definitions of the reviewer, filtered to its four names plus `job` (a call still running after
 * 12 s goes to the background; the reviewer waits for or kills it) and, when it has `codemode`, that one as a call of
 * its barrier. Without a returned `codemode`, Pi's own definition stays.
 */
function offeredTools(pi: ExtensionAPI, factory: ToolsFactory, cwd: string, label: string, codemode?: ToolDefinition): ToolDefinition[] {
	const tools = factory(cwd, () => pi.getSettings(), undefined, { label, ...(codemode ? { codemode } : {}) })
		.filter((d) => REVIEWER_TOOLS.includes(d.name) || d.name === "job" || (codemode && d.name === "codemode")).map(normalizeSearchTool);
	return codemode && !tools.some((d) => d.name === "codemode") ? [...tools, codemode] : tools;
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

/** User messages in branch order, with summaries explicitly labeled as Main's text. */
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

/** Each fresh reviewer's complete input, in the source contract's section order. */
export function buildBrief(entries: readonly SessionEntry[], params: Params): string {
	const sections = [`<user_messages>\n${userMessages(entries)}\n</user_messages>`];
	if (given(params.agreement)) sections.push(`<agreement>\n${params.agreement}\n</agreement>`);
	sections.push(`<object>\n${params.object}\n</object>`, `<criterion>\n${params.criterion}\n</criterion>`);
	const rejected = rejectedEarlier(entries, params);
	if (rejected.length) sections.push(`<rejected_earlier>\n${rejected.map((r) => `FINDING:\n${r.finding}\nREASON:\n${r.reason}`).join("\n\n")}\n</rejected_earlier>`);
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

/** grep and find get `dropEmptyOptional` before Pi validates the arguments; any other definition is returned unchanged. */
function normalizeSearchTool(definition: ToolDefinition): ToolDefinition {
	if (definition.name !== "grep" && definition.name !== "find") return definition;
	const required: string[] = (definition.parameters as { required?: string[] }).required ?? [];
	const prepare = definition.prepareArguments;
	return {
		...definition,
		prepareArguments: (input: unknown) => {
			const args = dropEmptyOptional(input, required);
			return prepare ? prepare(args) : args;
		},
	} as ToolDefinition;
}

/** Stock grep and find with `normalizeSearchTool`; execute stays stock. */
export function reviewerTools(cwd: string): ToolDefinition[] {
	return [createGrepToolDefinition(cwd), createFindToolDefinition(cwd)].map((stock) => normalizeSearchTool(stock as unknown as ToolDefinition));
}

const SHUTDOWN = "shutdown";

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

/** No provider fallback: a missing Codex model or credentials is a failed review. */
async function pickReviewer(level: Level, ctx: ExtensionContext, signal: AbortSignal) {
	signal.throwIfAborted();
	const spec = LEVELS[level];
	const name = `${spec.provider}/${spec.model}`;
	const model = ctx.modelRegistry.find(spec.provider, spec.model);
	if (!model) throw new Error(`model ${name} is not available`);
	// Use the caller's runtime so registered providers and credentials reach the reviewer.
	const modelRuntime = (ctx.modelRegistry as unknown as { runtime?: ModelRuntime }).runtime;
	if (!modelRuntime) throw new Error("the model runtime of the session is not reachable");
	if (!ctx.modelRegistry.hasConfiguredAuth(model) &&
		!(await untilAborted(modelRuntime.checkAuth(spec.provider, { signal }), signal)))
		throw new Error(`no credentials for ${spec.provider} (model ${name}); review requires Codex credentials, no fallback`);
	return { spec, model, modelRuntime };
}

/**
 * Optional channel where RQW-codex binds a child session to its Codex root. Nothing here imports it. The request is
 * emitted right after the reviewer's creation and before its prompt. No listener: stock behaviour. A listener that
 * sets `error` makes the review fail before any prompt. `release`, set by a listener, runs once when the reviewer ends.
 */
const SESSION_POLICY = "rqw-codex:session-policy";
type SessionPolicyRequest = { session: AgentSession; parentThreadId: string; kind: "collab_spawn" | "review"; startupSystemPrompt?: string; childName?: string; captureRun?: (callerThreadId?: string) => void; release?: () => void; error?: string };

/**
 * Emits the request on the caller's bus. Returns the idempotent release and the per-operation capture (a no-op after release);
 * a refused request disposes the session and throws. `childName` is the reviewer's actual label, `review#N`.
 */
function bindSessionPolicy(events: ExtensionAPI["events"], session: AgentSession, parentThreadId: string, kind: SessionPolicyRequest["kind"], startupSystemPrompt: string, childName: string): { release: () => void; capture: (callerThreadId?: string) => void } {
	const request: SessionPolicyRequest = { session, parentThreadId, kind, startupSystemPrompt, childName };
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		request.captureRun = undefined;
		request.release?.();
	};
	const capture = (callerThreadId?: string) => {
		if (!released) request.captureRun?.(callerThreadId);
	};
	let failed = false;
	let failure: unknown;
	try { events.emit(SESSION_POLICY, request); } catch (error) { failed = true; failure = error; }
	if (!failed && request.error === undefined) return { release, capture };
	release();
	session.dispose();
	const reason = failed ? (failure instanceof Error ? failure.message : String(failure)) : String(request.error);
	throw new Error(`Session policy refused: ${reason.split("\n")[0].slice(0, 200)}`);
}

/** One reviewer session from start to its last assistant text. Throws with the reason when there is no verdict. */
async function runReviewer(pi: ExtensionAPI, host: ReviewHost, level: Level, brief: string, ctx: ExtensionContext, signal: AbortSignal, used: { spec?: Spec }, fast: boolean | undefined, label: string): Promise<string> {
	signal.throwIfAborted();
	const { spec, model, modelRuntime } = await pickReviewer(level, ctx, signal);
	used.spec = spec;

	signal.throwIfAborted();
	// The caller's owner settings: shell (Git Bash on Windows), images, retries and provider timeouts, transport and its
	// timeouts, compaction, thinking budgets, codemode; no warmer.
	const settingsManager = SettingsManager.inMemory(reviewerSettings(pi.getSettings()));
	// GPT Fast: the caller's `fast_gpt`, else the caller's state at the reviewer's start; kept for the session.
	const inherited = fast ?? host.fast();
	// The reviewer is a child too: Pi's built-in codemode and tool_search as its caller has them active.
	const active = new Set(pi.getActiveTools());
	const builtins = BUILTIN_TOOLS.filter((name) => active.has(name));
	// With RQW-tools, codemode is Pi's definition built from the reviewer's API and handed to the factory (a call of the
	// reviewer's barrier and a job of its registry); without an offer it is registered exactly as Pi's factory does.
	// The offer is asked for at that point of the reload when the reviewer has codemode, otherwise right after it.
	let factory: ToolsFactory | undefined;
	let codemode: ToolDefinition | undefined;
	const withCodemode = (sub: ExtensionAPI) => {
		factory = signal.aborted ? undefined : offeredFactory(host.events);
		// The built-in factory only calls `registerTool`; the rest of the API stays the reviewer's for its callbacks.
		if (factory) createCodemodeExtension()(Object.assign(Object.create(sub), { registerTool: (d: ToolDefinition) => void (codemode = d) }));
		else createCodemodeExtension()(sub);
	};
	// No extensions, skills, prompt templates, themes or context files; the prompt is REVIEWER.md, with Pi's <cwd> block.
	const resourceLoader = new DefaultResourceLoader({
		cwd: ctx.cwd,
		agentDir: getAgentDir(),
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPromptOverride: () => REVIEWER,
		appendSystemPromptOverride: () => [],
		// Pi's codemode and tool_search when the caller has them active, and the git guard of every bash call, stock or
		// offered (a codemode script's bash calls pass the same hook).
		extensionFactories: [...builtins.map((name) => (name === "codemode" ? withCodemode : createToolSearchExtension())), (sub: ExtensionAPI) => {
			fastGpt(sub, () => inherited);
			sub.on("tool_call", (event) => {
				if (event.toolName !== "bash" || typeof event.input.command !== "string") return;
				const reason = blockedGit(event.input.command);
				if (reason) return { block: true, reason };
			});
		}],
	});
	await untilAborted(resourceLoader.reload(), signal);
	signal.throwIfAborted();
	if (!builtins.includes("codemode")) factory = offeredFactory(host.events);
	const offered = factory ? offeredTools(pi, factory, ctx.cwd, host.label ?? "review", codemode) : undefined;
	const jobs = (offered?.find((d) => d.name === "job") as (ToolDefinition & { jobs?: JobControl }) | undefined)?.jobs;
	if (signal.aborted) { jobs?.dispose(); signal.throwIfAborted(); }
	const creating = createAgentSession({
		cwd: ctx.cwd,
		model,
		thinkingLevel: spec.thinking,
		modelRuntime,
		resourceLoader,
		tools: [...REVIEWER_TOOLS, ...(jobs ? ["job"] : []), ...builtins],
		customTools: offered ?? reviewerTools(ctx.cwd),
		sessionManager: SessionManager.inMemory(ctx.cwd),
		settingsManager,
	}).then((created) => {
		// Before any prompt. createAgentSession has no signal: a session that materializes after cancellation is released too.
		// A throwing parent-id or system-prompt read must not leak the created session.
		let parentThreadId: string;
		let startupSystemPrompt: string;
		try {
			parentThreadId = ctx.sessionManager.getSessionId();
			startupSystemPrompt = created.session.systemPrompt;
		} catch (error) { created.session.dispose(); throw error; }
		const policy = bindSessionPolicy(host.events, created.session, parentThreadId, "review", startupSystemPrompt, label);
		if (signal.aborted) {
			jobs?.dispose();
			policy.release();
			created.session.dispose();
			signal.throwIfAborted();
		}
		return { ...created, release: policy.release, capture: policy.capture };
	});
	let created: Awaited<typeof creating>;
	try {
		created = await untilAborted(creating, signal);
	} catch (error) {
		jobs?.dispose();
		void creating.then(({ session, release }) => { release(); session.dispose(); }).catch(() => {});
		throw error;
	}
	const { session, release, capture } = created;
	// Pi 1.4 prompt() awaits auth before an active run exists, so abort() alone cannot stop that preflight.
	// This public request hook stays guarded even if the abandoned prompt resumes after dispose().
	const stream = session.agent.streamFunction;
	session.agent.streamFunction = (model, context, options) => {
		signal.throwIfAborted();
		return stream(model, context, options);
	};
	// Shutdown of the caller session or the asking child's end cancels this reviewer and its background jobs.
	const stop = () => { jobs?.abortAll(); void session.abort().catch(() => {}); };
	try {
		signal.addEventListener("abort", stop, { once: true });
		if (signal.aborted) throw new Error("aborted");
		// This reviewer's own run starts now, while the caller's tool operation is still active.
		capture(ctx.sessionManager.getSessionId());
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
		return verdictOf(text);
	} finally {
		signal.removeEventListener("abort", stop);
		// The review is over: no job of the reviewer outlives it.
		jobs?.dispose();
		release();
		session.dispose();
	}
}

/** Highest owned review id, including legacy outer prefixes, never a verdict or error body. */
function lastNumber(entries: readonly SessionEntry[]): number {
	let max = 0;
	const take = (n: unknown) => {
		if (typeof n === "number" && Number.isSafeInteger(n) && n > 0) max = Math.max(max, n);
	};
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === MESSAGE_TYPE)
			take((entry.data as { n?: unknown } | undefined)?.n);
		let match: RegExpExecArray | null = null;
		if (entry.type === "custom_message" && entry.customType === MESSAGE_TYPE)
			match = /^\[review#(\d+)\](?:\s|$)/.exec(textOf(entry.content));
		else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "review")
			match = /^review#(\d+) started\.(?:\s|$)/.exec(textOf(entry.message.content));
		if (match) take(Number(match[1]));
	}
	return max;
}

/** The reviewer session's settings: the caller's owner settings that shape a session, with warming off. */
export function reviewerSettings(own: ReturnType<ExtensionAPI["getSettings"]>) {
	const copied = JSON.parse(JSON.stringify({
		shellPath: own.shellPath,
		shellCommandPrefix: own.shellCommandPrefix,
		images: { autoResize: own.images?.autoResize, blockImages: own.images?.blockImages },
		retry: own.retry,
		transport: own.transport,
		httpIdleTimeoutMs: own.httpIdleTimeoutMs,
		websocketConnectTimeoutMs: own.websocketConnectTimeoutMs,
		compaction: own.compaction,
		thinkingBudgets: own.thinkingBudgets,
		codemode: own.codemode,
	})) as Partial<ReturnType<ExtensionAPI["getSettings"]>>;
	return { ...copied, cacheWarming: "off" as const };
}

export default function review(pi: ExtensionAPI) {
	registerReview(pi, { events: pi.events, fast: () => inheritedFastGpt(pi.events) });
	// A subagent of RQW-agent asks for its own `review` tool; it reviews for that subagent, its caller.
	pi.events.on(SUBAGENT_REVIEW, (request) =>
		(request as { offer?: (register: (child: ExtensionAPI, host: ReviewHost) => void) => void })?.offer?.((child, host) => registerReview(child, host)));
}

/**
 * The `review` tool of one caller: the main session, or (with `host.signal`) a subagent, whose session never emits
 * session_start or session_shutdown: its counts start at once and its reviews end with the signal.
 */
export function registerReview(pi: ExtensionAPI, host: ReviewHost) {
	let counter = 0;
	let main: ExtensionContext | undefined;
	let mainAborted = false;
	const running = new Set<AbortController>();
	/** Every job until its verdict is sent; print and JSON modes wait for them. */
	const jobs = new Set<Promise<void>>();
	// Running reviews of this session, offered on pi.events (see counts.ts).
	const counts = createCountsProducer(() => ({ agents: 0, workers: 0, reviews: running.size }), host.events);
	const offCounts = host.events.on(COUNTS_REQUEST, (request) => {
		const r = request as CountsRequest;
		if (r?.version === COUNTS_VERSION) counts.reply(r);
	});
	if (host.signal) {
		const end = () => {
			for (const job of running) job.abort(SHUTDOWN);
			running.clear();
			counts.stop();
			offCounts();
		};
		if (host.signal.aborted) end();
		else {
			counts.start();
			host.signal.addEventListener("abort", end, { once: true });
		}
	}
	/** Verdicts sent while the main session was busy, by review number, until the main model answers after them. */
	const unanswered = new Set<number>();

	pi.on("session_start", (_event, ctx) => {
		main = ctx;
		counter = lastNumber(ctx.sessionManager.getEntries());
		counts.start();
	});
	pi.on("session_shutdown", () => {
		for (const job of running) job.abort(SHUTDOWN);
		running.clear();
		counts.stop();
	});

	// Each review sends one verdict, so its number `n` in `details` is the delivery number.
	type Verdict = { customType: string; content: string; display: boolean; details: { n: number } };
	/** Held from agent_end until turn_start or our authoritative agent_settled handler. */
	let settling = false;
	const late: Verdict[] = [];
	function deliver(message: Verdict) {
		if (settling) {
			late.push(message);
			return;
		}
		// A previous abort pauses idle delivery only; a new busy run may still be in an earlier start hook.
		if (mainAborted && main?.isIdle() !== false) {
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
		// isIdle becomes true before earlier agent_settled hooks finish, including after an abort.
		settling = true;
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
		// Flush the early phase before deciding to continue, or held verdicts could miss this run.
		for (const message of late.splice(0)) {
			unanswered.add(message.details.n);
			pi.sendMessage(message, { triggerTurn: false });
		}
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

	async function job(n: number, level: Level, brief: string, ctx: ExtensionContext, fast?: boolean) {
		const controller = new AbortController();
		running.add(controller);
		counts.refresh();
		const startedAt = Date.now();
		let verdict: string;
		let failed = false;
		const used: { spec?: Spec } = {};
		try {
			verdict = await runReviewer(pi, host, level, brief, ctx, controller.signal, used, fast, `review#${n}`);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			verdict = `Review failed: ${reason}`;
			failed = true;
		} finally {
			running.delete(controller);
			counts.refresh();
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
					...(used.spec ? { model: `${used.spec.provider}/${used.spec.model}`, thinking: used.spec.thinking } : {}),
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
			if (counter >= Number.MAX_SAFE_INTEGER) throw new Error("Review id space exhausted");
			const branch = ctx.sessionManager.getBranch();
			const rejected = rejectedEarlier(branch, p);
			const brief = buildBrief(branch, { ...p, rejected_earlier: rejected });
			const n = ++counter;
			pi.appendEntry(MESSAGE_TYPE, rejected.length
				? { n, level: p.level, object: p.object, criterion: p.criterion, rejected_earlier: rejected }
				: { n });
			const pending = job(n, p.level, brief, ctx, typeof p.fast_gpt === "boolean" ? p.fast_gpt : undefined);
			jobs.add(pending);
			void pending.finally(() => jobs.delete(pending));
			return {
				content: [{ type: "text", text: startedText(n) }],
				details: { n, level: p.level },
			};
		},
	});
}
