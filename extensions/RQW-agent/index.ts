// Extension 5: asynchronous subagents with caller-local lifecycle and recursive delegation.
import { createHash, randomUUID } from "node:crypto";
import { ProgressReports, PROGRESS_SKILL_PATH } from "./progress.ts";
import registerMainProgress from "./main-progress.ts";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { getCurrentTools, getSupportedThinkingLevels, StringEnum } from "@earendil-works/pi-ai";
import type { AgentSessionEvent, ExtensionAPI, ExtensionContext, ModelRuntime, SessionEntry, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	type AgentSession,
	createAgentSession,
	createCodemodeExtension,
	createToolSearchExtension,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
	shouldCompact,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { FOLLOW_UP, SUBAGENT_REMINDER, subagentPrompt, withCurrentReminder } from "./prompt.ts";
import { forkBranch } from "./fork.ts";
import { forkPayloads, type ForkPayload } from "./fork-payload.ts";
import { registerFollowUpHold } from "./followup-hold.ts";
import { ProfileCatalogue, type ProfileRef } from "./profiles.ts";
import { Activity } from "./activity.ts";
import { appendUserMessages, loadPromptFile, type PromptFile } from "./prompt-files.ts";
import { COUNTS_REQUEST, COUNTS_VERSION, type CountsRequest, createCountsProducer, type RunningCounts } from "./counts.ts";
import { fastGpt, inheritedFastGpt } from "./fast-gpt.ts";
import { Coordinator, type AcceptRecord, type Result, type WaitRecord, type RuntimeHandle, deadlineTimer, waitTimeout, targetIds, messageCount, statusDepth, waitResult } from "./coordinator.ts";
import { ACCEPT_ENTRY, BASE_ENTRY, CHILD_ENTRY, WAIT_ENTRY, deliveredRuns, createChildManager, openChildManager, retainedChildManager, releaseChildManager, repairInterrupted } from "./persistence.ts";

const TOOLS = ["read", "bash", "edit", "write", "grep", "find"] as const;
/** Pi's built-in tools a child gets when its caller has them active (the main session has them through RQW-settings). */
const BUILTIN_TOOLS = ["codemode", "tool_search"] as const;
const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type Thinking = (typeof THINKING)[number];

export const DESCRIPTION = [
	"Tool for spawning and managing sub-agents.",
	"Spawns an agent to work on the specified task with action start. It returns the agent id agent#N.",
	"The spawned agent will have the base tools or the `tools` subset, job and web when they are offered, codemode and tool_search when you have them, and always the ability to spawn its own subagents.",
	"Its final answer will be provided to you when it finishes.",
	"By default the spawned agent gets no surrounding context beyond its task; `include: [\"user_messages\"]` adds your user's messages. On start, `fork_turns: \"all\"` instead copies the current branch in memory, with the caller's prompt, model and tools; its history is not durable across restart.",
	"Do not use job wait or poll; use status only for a check you need; continue with other work or end your turn. Never fabricate or predict a pending agent's results; the notification is never something you write yourself; if the user asks before it arrives, say the result has not arrived yet. The user may not have opened the agent's report: relay what matters.",
	"Treat its result as finished work; don't redo its searches, reads or runs. When you hand its work to another agent or cite it, use source links or verbatim quotes, never a bare retelling, and cite only what you have seen in a source, opening just that spot if you have not. Check a claim only when it has no path and line, contradicts what you have seen, shows an obvious failure or misses a significant edge case, comes from a failed or incomplete run, or is a significant behavioral change no one has verified by a test or run; then check just that claim or send the same agent a short follow-up, and still run any check the user or a skill asks for.",
	"",
	"All agents share the same directory. In detail:",
	"- All agents have access to the same container and filesystem as you.",
	"- All agents use the same current working directory.",
	"- As a result, edits made by one agent are immediately visible to all other agents.",
	"",
	"Only set `model` or `thinking` when explicitly requested by the user, applicable `AGENTS.md` instructions, or skill instructions.",
	"",
	"Any earlier instruction enabling proactive multi-agent delegation no longer applies. Do not spawn sub-agents unless the user, your task, role or system prompt, or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.",
	"",
	"send: Send a follow-up task to an existing agent and trigger a turn if it is idle. If the target is already running, deliver the task after its current tool call completes.",
	"wait: Wait for agents to reach a final status. Completed statuses may include the agent's final message. Returns no results when timed out. Where notifications work, wait returns a waiting receipt at once, ends this turn and wakes you later with a child_wait notification; each result arrives once, through wait or a later [agent#N] message. Nested codemode calls and external print/json hosts still hold the wait call.",
	"interrupt: Interrupt an agent's current turn, if any, and return its previous status. The agent remains available for messages and follow-up tasks. Cancellation can stay pending; inspect it with status.",
	"status: List the status of the listed direct agents: last trimmed messages, in-flight tool calls and structured alerts. Positive depth adds read-only descendant status; it grants no descendant control.",
	"stop: Close an agent and any open descendants when they are no longer needed. Completed agents remain open and keep their history until closed. Don't keep agents open for too long if they are not needed anymore.",
	"resume: Resume a previously interrupted or failed agent by id so it retries its last request from saved history, without a new message. Child sessions survive Pi restarts with the same caller-local id.",
	"start/restart: system_file or role_file loads exact UTF-8 text relative to the caller cwd instead of matching inline text; system and role choices are mutually exclusive. Restart inherits the file choice and re-reads it before replacing the child. Result details record prompt_file {kind, path (absolute), sha256 (file bytes)} beside delivery/run on push, and in results[].display on wait.",
	"include: [user_messages] on start/restart appends caller-session user-role text verbatim in a <user_messages> block after the task, from the caller's current branch; images and non-user messages are omitted. It is not inherited on restart.",
	"agent_type on start/restart selects a named Codex TOML profile from the catalogue below. Its developer_instructions are a role after the root prompt and reminder, not a sandbox. Profile model, effort and instructions are defaults; explicit model, thinking, role, role_file, system and system_file use ordinary API semantics. Unset fields use ordinary defaults. Profiles keep the same tools and recursive delegation as generic agents.",
	"restart: id, optional task, title and new role/system/model/thinking/tools; a fresh session; a selected agent_type is inherited and re-read unless changed.",
	"Defaults: your system prompt with the reminder, this session's thinking, all tools.",
	"By default children inherit GPT Fast; pass fast_gpt false when the user forbids Fast for subagents.",
].join("\n");

const PARAMETERS = Type.Object({
	action: StringEnum(["start", "wait", "status", "send", "resume", "interrupt", "stop", "restart"]),
	fork_turns: Type.Optional(StringEnum(["none", "all"], { description: "start only: copy the current branch in memory with all; default none. all refuses model, thinking, agent_type, system, system_file, role, role_file and include." })),
	id: Type.Optional(Type.String({ description: "Agent id to send a follow-up task to, resume, interrupt, stop or restart (from start): agent#N or N." })),
	ids: Type.Optional(Type.Array(Type.String(), { description: "Agent ids to wait on or to inspect with status: full direct child IDs agent#N. Pass multiple ids to wait for whichever finishes first." })),
	timeout_ms: Type.Optional(Type.Integer({ minimum: 1, description: "Timeout in milliseconds. Defaults to 300000, min 1, no max. Prefer longer waits (minutes) to avoid busy polling." })),
	messages: Type.Optional(Type.Integer({ minimum: 5, maximum: 10, description: "Status peek length; default 8" })),
	until: Type.Optional(StringEnum(["first", "all"], { description: "wait: first terminal result (default), or hold results until all selected targets are terminal" })),
	wake_on_alert: Type.Optional(Type.Boolean({ description: "wait: return on a new structured alert without consuming a result; default true" })),
	depth: Type.Optional(Type.Integer({ minimum: 0, description: "status: descendant generations to include, read-only; default 0" })),
	alert_after_ms: Type.Optional(Type.Integer({ minimum: 1, description: "start/restart: long-turn alert threshold in milliseconds, positive safe integer; disabled by default, inherited on restart" })),
	system: Type.Optional(Type.String({ description: "Whole system prompt, replacing the default (your prompt and role); the subagent reminder is still appended after it; start, restart" })),
	role: Type.Optional(Type.String({ description: "Short role text added after the default prompt; start, restart" })),
	system_file: Type.Optional(Type.String({ description: "start, restart: UTF-8 whole-prompt file, relative to caller cwd; conflicts with system and either role option" })),
	role_file: Type.Optional(Type.String({ description: "start, restart: UTF-8 role file, relative to caller cwd; conflicts with role and either system option" })),
	include: Type.Optional(Type.Array(StringEnum(["user_messages"]), { description: "start, restart: append verbatim user-role text from this caller's current session branch after the task" })),
	title: Type.Optional(Type.String({ description: "Short title, 3-5 words, shown in status and result headers; start, restart. Make it concrete and distinct, consider recent titles to avoid reuse." })),
	agent_type: Type.Optional(Type.String({ description: "Agent type override for the new agent. Omit unless explicitly asked. Restart inherits and revalidates the selected agent_type. The roles are listed at the end of the tool description." })),
	task: Type.Optional(Type.String({ description: "Initial plain-text task for the new agent, or the message text to send to the target agent with send or restart." })),
	model: Type.Optional(Type.String({ description: "Model override for the new agent, as provider/id. Omit unless an explicit override is needed. If omitted: on restart, the previous model if it was given explicitly (a previous model that came from the agent_type profile is dropped and the profile is re-read); otherwise the agent_type profile's model, if it has one; otherwise the caller's model." })),
	thinking: Type.Optional(StringEnum(THINKING, { description: "Reasoning effort override for the new agent. Omit to inherit the parent effort, unless the selected agent_type sets one." })),
	tools: Type.Optional(Type.Array(StringEnum(TOOLS), { description: "Base subset; default all. Recursive agent delegation stays available." })),
	fast_gpt: Type.Optional(Type.Boolean({ description: "GPT Fast for this child; default: inherit yours. false when the user forbids Fast for subagents; send and restart may change it" })),
	interrupt: Type.Optional(Type.Boolean({ description: "send only: True interrupts the current task and starts this message as soon as the interrupted run has stopped; false or omitted queues it. A queued message reaches a running agent after its current tool call; an interrupt drops queued messages and keeps history." })),
});
type Params = Omit<Static<typeof PARAMETERS>, "tools"> & { tools?: string[] };

/**
 * `system` is the whole prompt sent; `base` the main agent's prompt it was built from (handed down to nested callers);
 * `custom` the caller's full override, `role` its resolved role text, `profile` the loaded profile's provenance.
 */
type Config = { system: string; base: string; cwd?: string; custom?: string; role?: string; prompt_file?: PromptFile; profile?: ProfileRef; profile_defaults?: { model: boolean; thinking: boolean; role: boolean }; alert_after_ms?: number; fork_turns?: "all"; model: Model<Api>; thinking: Thinking; tools: string[]; builtins?: string[]; settings?: ReturnType<typeof childSettings> };
/** Commands the child accepted: `tasks` become one user message, the `n`-th user message of its history. */
type SendBatch = { n: number; tasks: string[] };
/** `delivery` is the id its message carries; the saved result is the outbox, so a restore sends the same id. Older records have none. */
type SavedResult = { run: string; text: string; outcome: "completed" | "error"; meta: RunMeta; delivery?: string };
type SavedChild = { version: 1; kind: string; id: number; epoch: string; sessionFile?: string; runNumber: number; state: "idle" | "running" | "interrupted" | "paused" | "completed" | "stopped"; config: Omit<Config, "model" | "system" | "base"> & { base?: string; base_ref?: string; system?: string; system_tail?: string; model: { provider: string; id: string } }; fast: boolean; title?: string; task?: string; result?: SavedResult; progressSteps?: number; pending_sends?: SendBatch[]; history?: boolean; recovers?: string };
/** The text of the config and task as last written to the parent session; restore takes it from the saved record. */
type Written = { config: string; task?: string };

/** The id of a base prompt text in `rqw-agent-base` entries and in child configs' `base_ref`. */
export const baseRef = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Config and task are written once and again only when their text changes; restore takes them from the earlier full record. */
export function childRecord<T extends { config?: unknown; task?: string }>(a: { written?: Written }, full: T): T | Omit<T, "config" | "task"> {
	const config = JSON.stringify(full.config);
	if (a.written?.config === config && a.written.task === full.task) {
		const { config: _config, task: _task, ...short } = full;
		return short;
	}
	a.written = { config, task: full.task };
	return full;
}

/** A short record inherits config and task from the previous record of the same child. */
export function mergeSaved<T extends { config?: unknown; task?: string }>(previous: T | undefined, data: T): T {
	return data.config || !previous ? data : { ...data, config: previous.config, task: data.task ?? previous.task };
}
type CallerHost = { busy(): boolean; send: ExtensionAPI["sendMessage"] };
type JobNotification = { id: string; text: string; details: Record<string, unknown> };
type InboxMessage = Parameters<ExtensionAPI["sendMessage"]>[0];
const INBOX_ENTRY = "rqw-agent-inbox";

/** Durable notifications are acknowledged by their persisted custom message, never by a clearable core queue. */
class NotificationBridge {
	readonly lifetime = new AbortController();
	wake?: () => void;
	private manager: SessionManager;
	private inbox = new Map<string, InboxMessage>();
	private leases = 0;
	private watchers = new Set<() => void>();

	constructor(manager: SessionManager) {
		this.manager = manager;
		for (const entry of manager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== INBOX_ENTRY) continue;
			const data = entry.data as { version?: number; id?: string; message?: InboxMessage } | undefined;
			if (data?.version === 1 && typeof data.id === "string" && data.message) this.inbox.set(data.id, data.message);
		}
		this.reconcile();
	}
	readonly deliver: ExtensionAPI["sendMessage"] = (message) => {
		if (this.lifetime.signal.aborted) return;
		const id = randomUUID();
		this.manager.appendCustomEntry(INBOX_ENTRY, { version: 1, id, message });
		this.inbox.set(id, message);
		this.changed();
	};
	retain(): () => void {
		if (this.lifetime.signal.aborted) return () => {};
		this.leases++;
		let released = false;
		return () => { if (!released) { released = true; this.leases--; this.changed(); } };
	}
	retained(): boolean { return this.leases > 0; }
	pending(): boolean { this.reconcile(); return this.leases > 0 || this.inbox.size > 0; }
	messages(): InboxMessage[] {
		this.reconcile();
		return [...this.inbox].map(([id, message]) => ({
			...message, details: { ...(message.details as Record<string, unknown> | undefined), rqw_agent_inbox: id },
		}));
	}
	reconcile(): void {
		if (!this.inbox.size) return;
		for (const entry of this.manager.getBranch()) {
			if (entry.type !== "custom_message") continue;
			const id = (entry.details as { rqw_agent_inbox?: string } | undefined)?.rqw_agent_inbox;
			if (id) this.inbox.delete(id);
		}
	}
	wait(signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		if (!this.pending()) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const cleanup = () => { this.watchers.delete(done); signal.removeEventListener("abort", abort); };
			const done = () => { cleanup(); resolve(); };
			const abort = () => { cleanup(); reject(signal.reason ?? new Error("aborted")); };
			this.watchers.add(done); signal.addEventListener("abort", abort, { once: true });
		});
	}
	close(): void { this.lifetime.abort(); this.changed(); }
	private changed(): void { for (const watcher of [...this.watchers]) watcher(); this.wake?.(); }
}
/** Display details of a delivered result: flattened beside delivery and run in a message's details, and under `display` in a wait result. For cards only, never part of the delivered text. */
type Display = { id: string; outcome: "finished" | "failed"; model?: string; thinking?: string; seconds: number; title?: string; prompt_file?: PromptFile; profile?: ProfileRef };
/** Control of a child's background jobs, carried by RQW-tools' offered `job` definition when it offers one. */
type JobControl = { abortAll(): void; dispose(): void };
type Child = { session: AgentSession; progress: ProgressReports; controller: AbortController; guard: { signal?: AbortSignal }; children?: RuntimeHandle; activity: Activity; jobs?: JobControl; release: () => void; captureRun: (callerThreadId?: string) => void; bridge: NotificationBridge; core: { on: boolean; active: boolean; wake?: () => void } };
type Agent = Child & {
	id: number;
	/** The caller's optional short title, shown in status and result details. */
	title?: string;
	/** GPT Fast of this child for its life: inherited at start, or the caller's `fast_gpt`. Its own children inherit it. */
	fast: { on: boolean };
	config: Config;
	epoch: string;
	runNumber: number;
	state: SavedChild["state"];
	/** Last accepted task for provenance, never authority to reconstruct missing durable history. */
	task?: string;
	/** The config and task text already written to the parent session for this child. */
	written?: Written;
	result?: SavedResult;
	/** The current run, undefined while idle. `quiet` ends it without a message. */
	run?: { done: Promise<void>; quiet: boolean; controller: AbortController; parked?: AbortController };
	/** Tasks of `send` calls made while an interrupted run is still stopping; they start, in order, once it has. */
	next?: string[];
	/** Accepted commands, in order, until their user messages are in the child's history; saved as `pending_sends`. */
	sends: SendBatch[];
	/** Whether the child's history has a user message, so its file exists. Records written before this field count as true. */
	history?: boolean;
	/** The run this one continues after a crash, saved with the child's record: a restored wait follows only that. */
	recovers?: string;
	idleSince?: number;
	cancelSleep?: () => void;
};

/** The run's own record (startRun), from its assistant message_end events: last executed model and last stop reason. */
export type RunMeta = { model?: string; stop?: string };

/**
 * The display details of a run that ended: its executed model (only an actually executed one, if any), the session's
 * selected thinking (if any), monotonic seconds rounded to 0.1. A final aborted or length stop counts as failed.
 */
export function resultDisplay(id: string, outcome: "completed" | "error", activity: Activity, meta: RunMeta, thinking?: string, title?: string): Display {
	const model = meta.model;
	// A final aborted or length stop that was delivered counts as failed; a successful retry ends with stop.
	const stop = meta.stop;
	const failed = outcome === "error" || stop === "aborted" || stop === "length";
	return {
		id,
		outcome: failed ? "failed" : "finished",
		...(model ? { model } : {}),
		...(thinking ? { thinking } : {}),
		seconds: Math.round(activity.runElapsedMs() / 100) / 10,
		...(title ? { title } : {}),
	};
}

/** Records one assistant message_end into its run's record: the stop reason, and the executed model when given. The last one wins. */
export function recordRunMessage(meta: RunMeta, message: Pick<AssistantMessage, "provider" | "model" | "stopReason">): void {
	meta.stop = message.stopReason;
	if (message.provider && message.model) meta.model = `${message.provider}/${message.model}`;
}

/** SDK auth and creation can ignore cancellation. Observe late failures without waiting for them. */
async function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
	const aborted = Promise.withResolvers<never>();
	const stop = () => aborted.reject(signal.reason ?? new Error("aborted"));
	signal.addEventListener("abort", stop, { once: true });
	if (signal.aborted) stop();
	try {
		const value = await Promise.race([pending, aborted.promise]);
		signal.throwIfAborted();
		return value;
	} finally {
		signal.removeEventListener("abort", stop);
	}
}

const textOf = (message: AssistantMessage): string =>
	message.content
		.flatMap((c) => (c.type === "text" ? [c.text] : []))
		.join("\n")
		.trim();

/** Highest owned id, including old histories without allocation metadata. Never scan a result's body. */
function lastNumber(entries: readonly SessionEntry[], name: string): number {
	let max = 0;
	const take = (n: unknown) => {
		if (typeof n === "number" && Number.isSafeInteger(n) && n > 0) max = Math.max(max, n);
	};
	for (const e of entries) {
		if (e.type === "custom" && e.customType === name) take((e.data as { id?: unknown } | undefined)?.id);
		if (e.type === "custom" && e.customType === CHILD_ENTRY) {
			const data = e.data as Partial<SavedChild> | undefined;
			if (data?.version === 1 && data.kind === name) take(data.id);
		}
		let match: RegExpExecArray | null = null;
		if (e.type === "custom_message" && e.customType === name && typeof e.content === "string")
			match = new RegExp(`^\\[${name}#(\\d+)\\](?:\\s|$)`).exec(e.content);
		else if (e.type === "message" && e.message.role === "toolResult" && e.message.toolName === name) {
			const text = e.message.content.map((c) => c.type === "text" ? c.text : "").join("");
			match = new RegExp(`^${name}#(\\d+)(?: started| restarted| stopped| interrupted| is idle|: sent|: interrupted, sent|: queued after the current run|: queued after the current tool call)(?:$|[\\s,])`).exec(text);
		}
		if (match) take(Number(match[1]));
	}
	return max;
}

/**
 * Channel on `pi.events` where RQW-tools, when it is loaded, offers its tools for subagents: a request
 * `{ offer(factory) }` gets a factory of fresh definitions. Nothing here imports RQW-tools.
 */
const SUBAGENT_TOOLS = "rqw-tools:subagent-tools";
/**
 * `options.codemode`: the child's own Pi `codemode` definition, returned with background-job support.
 */
type ToolsFactory = (cwd: string, settings: () => unknown, options?: { codemode?: ToolDefinition; notify?: (notification: JobNotification) => void; retain?: () => () => void }) => ToolDefinition[];
type ToolCatalogue = { names: string[]; aliases: Record<string, string> };
type ToolOffer = { factory: ToolsFactory; catalogue?: ToolCatalogue };

type ExtensionFactory = (child: ExtensionAPI) => void;
const SUBAGENT_EXTENSION_FACTORIES = "rqw-agent:subagent-extension-factories";

/** Inline extensions explicitly offered for each child, without enabling resource discovery. */
export function collectExtensionFactories(events: ExtensionAPI["events"]): ExtensionFactory[] {
	const factories = new Set<ExtensionFactory>();
	events.emit(SUBAGENT_EXTENSION_FACTORIES, {
		offer: (factory: ExtensionFactory) => { if (typeof factory === "function") factories.add(factory); },
	});
	return [...factories];
}

type WebRegistrar = (child: ExtensionAPI) => void;

function offeredWeb(events: ExtensionAPI["events"]): WebRegistrar | undefined {
	let register: WebRegistrar | undefined;
	events.emit("rqw-search:subagent-web", { offer: (value: WebRegistrar) => { register = value; } });
	return register;
}

const PROFILES = "rqw-agent:profiles";

type OwnSettings = ReturnType<ExtensionAPI["getSettings"]>;

/** Descendant supervision stays compact: no message, argument or tool-output previews. */
function compactStatus(status: Record<string, unknown>): Record<string, unknown> {
	const keys = ["id", "run", "error", "recovery_error", "title", "profile", "state", "activity", "run_active", "run_id", "elapsed_ms", "idle_for_ms", "last_activity_ago_ms", "model", "outcome", "alerts", "current_tools_total", "pending_children", "cancellation_requested", "pending_sends", "children"];
	return Object.fromEntries(keys.filter(key => key in status).map(key => [key, status[key]]));
}

/**
 * The owner's settings a child session runs with, copied from the caller's effective settings: the shell (Git Bash on
 * Windows), image handling, retries and provider timeouts, transport and its timeouts, compaction (reserve, kept
 * tokens, per-model overrides), thinking budgets, steering and follow-up delivery, and codemode's mode and budget.
 * Background cache warming stays off. UI, model selection, resources and telemetry are not session behaviour of a child.
 */
export function childSettings(own: OwnSettings) {
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
		steeringMode: own.steeringMode,
		followUpMode: own.followUpMode,
		codemode: own.codemode,
	})) as Partial<OwnSettings>;
	return { ...copied, cacheWarming: "off" as const };
}

/** An optional text counts as given only when it has non-blank content. */
const given = (value: string | undefined): value is string => typeof value === "string" && value.trim() !== "";

/**
 * Optional channel where RQW-codex binds a child session to its Codex root. Nothing here imports it. The request is
 * emitted right after the child's creation and before its first prompt. No listener: stock behaviour. A listener that
 * sets `error` makes the start fail before any prompt. `release`, set by a listener, runs once on every stop, restart,
 * error or cancel of the child.
 */
const SESSION_POLICY = "rqw-codex:session-policy";
type SessionPolicyRequest = { session: AgentSession; parentThreadId: string; kind: "collab_spawn"; startupSystemPrompt?: string; startupSystemPromptForced?: boolean; childName?: string; captureRun?: (callerThreadId?: string) => void; installCompactionHooks?: (api: ExtensionAPI) => void; release?: () => void; error?: string };

/**
 * Emits the request on the caller's bus. Returns the idempotent release and the per-operation capture (a no-op after release);
 * a refused request disposes the session and throws. `childName` is the child's actual label, `kind#id`.
 */
function bindSessionPolicy(events: ExtensionAPI["events"], session: AgentSession, parentThreadId: string, kind: SessionPolicyRequest["kind"], startupSystemPrompt: string, childName: string, startupSystemPromptForced: boolean, childApi: ExtensionAPI): { release: () => void; capture: (callerThreadId?: string) => void } {
	const request: SessionPolicyRequest = { session, parentThreadId, kind, startupSystemPrompt, startupSystemPromptForced, childName };
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
	try {
		events.emit(SESSION_POLICY, request);
		if (request.error === undefined) request.installCompactionHooks?.(childApi);
	} catch (error) { failed = true; failure = error; }
	if (!failed && request.error === undefined) return { release, capture };
	release();
	session.dispose();
	const reason = failed ? (failure instanceof Error ? failure.message : String(failure)) : String(request.error);
	throw new Error(`Session policy refused: ${reason.split("\n")[0].slice(0, 200)}`);
}

const isAssistant = (m: { role: string }): m is AssistantMessage => m.role === "assistant";

// The main session's runtime (a plain field of ModelRegistry): same credentials, OAuth refresh and providers.
const runtimeOf = (ctx: ExtensionContext) => (ctx.modelRegistry as unknown as { runtime: ModelRuntime }).runtime;

export default function agent(pi: ExtensionAPI) {
	registerMainProgress(pi);
	pi.on("resources_discover", () => ({ skillPaths: [PROGRESS_SKILL_PATH] }));
	registerCaller(pi, pi.events, false, true, () => inheritedFastGpt(pi.events));
}

/**
 * Registers `agent` for one caller: the main session (`top`) or a subagent, recursively, without a
 * depth limit. `callerFast`: this caller's GPT Fast state at the moment it starts a child (the main chat's, or a
 * child's own). `basePrompt`: the main agent's system prompt, read from the main context or handed down.
 */
function registerCaller(pi: ExtensionAPI, toolEvents: ExtensionAPI["events"], background: boolean, top: boolean, callerFast: () => boolean, refresh: () => void = () => {}, basePrompt: (ctx: ExtensionContext) => string = ctx => ctx.getSystemPrompt(), labelPrefix = "", host?: CallerHost): RuntimeHandle {
	const coordinator = new Coordinator(pi, host?.send, (type, data) => pi.appendEntry(type, data));
	// Display details of delivered results, by run, until shutdown (see publishRun).
	const displays = new Map<string, Display>();
	// Running counts of the whole tree, offered by the top-level caller only (see counts.ts). Nested callers get its refresh.
	const counts = top ? createCountsProducer(() => runtime.runningCounts(), pi.events) : undefined;
	const notify = counts ? () => counts.refresh() : refresh;
	const runtime = registerSessionRuntime(pi, toolEvents, background, coordinator, callerFast, displays, notify, basePrompt, labelPrefix, host);
	if (top) pi.registerCommand("resume-agents", {
		description: "Resume unfinished children without sending a message to the main model",
		handler: async (_args, ctx) => { const count = await runtime.resume?.(ctx.signal ?? new AbortController().signal) ?? 0; ctx.ui.notify(`Resumed ${count} child session(s)`, "info"); },
	});
	if (counts) {
		pi.events.on(COUNTS_REQUEST, (request) => {
			const r = request as CountsRequest;
			if (r?.version === COUNTS_VERSION) counts.reply(r);
		});
		pi.on("session_start", () => counts.start());
		pi.on("session_shutdown", () => counts.stop());
		registerFollowUpHold(pi, background => coordinator.holdsFollowUps(background));
		let sessionId: string | undefined;
		let stopNotice: (() => void) | undefined;
		pi.on("session_start", (_event, ctx) => {
			stopNotice?.();
			sessionId = ctx.sessionManager.getSessionId();
			stopNotice = pi.events.on("rqw:stop-background:v1", (request: any) => {
				if (request?.sessionId !== sessionId || typeof request.reply !== "function") return;
				request.reply({ agents: runtime.stopBackground?.() ?? 0 });
			});
		});
		pi.on("session_shutdown", () => { stopNotice?.(); stopNotice = undefined; sessionId = undefined; });
	}
	pi.on("agent_end", async (_event, ctx) => {
		if (!background && (ctx.mode === "print" || ctx.mode === "json") && ctx.signal) {
			try { await coordinator.observe(ctx.signal); } catch (error) { if (!ctx.signal.aborted) throw error; }
		}
	});
	return runtime;
}

/** Caller-local state. Nested callers settle normally; startRun tracks their children across background wakeups. */
export function registerSessionRuntime(pi: ExtensionAPI, toolEvents = pi.events, backgroundCaller = false, coordinator = new Coordinator(pi, undefined, (type, data) => pi.appendEntry(type, data)), callerFast: () => boolean = () => inheritedFastGpt(toolEvents), displays = new Map<string, Display>(), onRunning: () => void = () => {}, basePrompt: (ctx: ExtensionContext) => string = ctx => ctx.getSystemPrompt(), labelPrefix = "", host?: CallerHost): RuntimeHandle {
	const name = "agent";
	const payloads = forkPayloads();
	/** A child's display label in RQW-tools notes: the path from the main session, "agent#1/agent#2". */
	const labelOf = (id: number) => `${labelPrefix}${name}#${id}`;
	const agents = new Map<number, Agent>();
	const savedSlots = new Map<number, SavedChild>();
	const restoring = new Map<number, { epoch: string; promise: Promise<void> }>();
	const lifetime = new AbortController();
	let generation = new AbortController();
	let counter = 0;
	let main: ExtensionContext | undefined;
	let hydrated = false;
	let branchIndex: { saved: Map<number, SavedChild>; delivered: Set<string>; waits: Map<string, WaitRecord> } | undefined;
	/** Base prompt texts by ref, as written on the selected branch; reset with the branch. */
	let bases: Map<string, string> | undefined;
	/** Waits this runtime restored from the session, so a later partial fold does not raise them again. */
	const restoredWaits = new Set<string>();
	let initialRecovery = true;
	const recoveryPending = new Set<number>();
	const recoveryErrors = new Map<number, { data?: SavedChild; error: string }>();
	const send: ExtensionAPI["sendMessage"] = host?.send ?? ((message, options) => pi.sendMessage(message, options));
	const callerIdle = () => host ? !host.busy() : main?.isIdle() !== false;
	let mainAborted = false;
	/** UUIDs survive reload/resume without matching an earlier delivery. */
	const unanswered = new Set<string>();
	let settling = false;
	let settlingSignal: AbortSignal | undefined;
	const markAborted = () => { mainAborted = true; };
	const late: Result[] = [];
	/** Runs whose display details this runtime stored in `displays`; removed at shutdown. */
	const ownRuns = new Set<string>();
	const catalogue = new ProfileCatalogue();

	async function refreshProfiles(ctx: ExtensionContext) {
		const extensionPaths: string[] = [];
		toolEvents.emit(PROFILES, { offer: (paths: string[]) => { if (Array.isArray(paths)) extensionPaths.push(...paths); } });
		const profiles = await catalogue.refresh({ cwd: ctx.cwd, agentDir: getAgentDir(), extensionPaths });
		const lines = profiles.map(profile => {
			const model = profile.model ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "caller default");
			const effort = profile.model_reasoning_effort === "none" ? "off" : profile.model_reasoning_effort ?? pi.getThinkingLevel();
			return `${profile.name}: ${profile.description}; model=${model}; effort=${effort}; source=${profile.path}${profile.not_applied ? `; not applied: ${profile.not_applied.join(", ")}` : ""}${profile.error ? "; invalid profile" : ""}`;
		});
		const description = `${DESCRIPTION}\n\nAvailable roles:\n${lines.join("\n") || "No profiles discovered."}`;
		const names = offeredFactory()?.catalogue?.names ?? [...TOOLS];
		definition.description = description;
		definition.parameters = toolParameters(names);
		pi.registerTool(definition);
	}

	function deliver(result: Result) {
		if (lifetime.signal.aborted) return;
		if (settling) {
			late.push(result);
			return;
		}
		if (!coordinator.message(result)) return;
		const message = resultMessage(result);
		coordinator.releaseMessage(result);
		// A previous abort pauses idle delivery only; a new busy run may still be in an earlier start hook.
		if (mainAborted && callerIdle()) {
			send(message, { triggerTurn: false });
			return;
		}
		if (callerIdle()) {
			send(message, { triggerTurn: true });
			return;
		}
		// Busy: keep the result outside Pi's follow-up queue, which Esc clears.
		unanswered.add(message.details.delivery);
		send(message, { triggerTurn: false });
	}

	// The message details: delivery and run as before, with the run's display fields flattened beside them (display only).
	function resultMessage(result: Result) {
		const display = displays.get(result.run);
		return { customType: name, content: `[${result.id}] ${result.text}\n\n${FOLLOW_UP}`, display: true, details: { delivery: result.delivery, run: result.run, ...display } };
	}

	/**
	 * Stores this run's display details under its unique run before publish, which may reserve the result for a wait
	 * synchronously and skip the push. Both paths look the details up by run; they stay until shutdown (failed-wait fallback).
	 */
	function publishRun(a: Agent, identity: { id: string; run: string }, text: string, outcome: "completed" | "error", meta: RunMeta) {
		a.state = "completed";
		const delivery = randomUUID();
		a.result = { run: identity.run, text, outcome, meta: { ...meta }, delivery };
		persist(a);
		displays.set(identity.run, displayOf(a, identity.id, outcome, meta));
		ownRuns.add(identity.run);
		coordinator.publish(identity.id, identity.run, text, outcome, deliver, delivery);
	}

	/** The display details of a run that ended, from its activity and this session's selected thinking. */
	function displayOf(a: Agent, id: string, outcome: "completed" | "error", meta: RunMeta): Display {
		return { ...resultDisplay(id, outcome, a.activity, meta, a.session.thinkingLevel, a.title),
			...(a.config.prompt_file ? { prompt_file: a.config.prompt_file } : {}),
			...(a.config.profile ? { profile: a.config.profile } : {}) };
	}

	/**
	 * Adds each result's display details to a copy of the wait details. The content text and the original body are
	 * kept byte for byte: the model never sees the display fields.
	 */
	function withDisplays<T extends { content: unknown; details: unknown }>(result: T): T {
		const details = result.details as { results?: Record<string, unknown>[] };
		if (!details.results?.length) return result;
		const results = details.results.map(r => {
			const display = displays.get(String(r.run));
			return display ? { ...r, display } : { ...r };
		});
		return { ...result, details: { ...details, results } };
	}

	/** Active assignments, including notification waits, plus nested callers; completed results count zero. */
	function runningCounts(): RunningCounts {
		let running = 0;
		for (const a of agents.values()) {
			if (a.activity.isRunning() || a.run || a.next?.length) running++;
			running += a.children?.runningCounts().agents ?? 0;
		}
		return { agents: running, reviews: 0 };
	}

	function recoveryFailure(id: number, error: unknown, data?: SavedChild) {
		const detail = error instanceof Error ? error.message : String(error);
		recoveryErrors.set(id, { data, error: detail });
		if (!agents.has(id)) coordinator.add({ id: `${name}#${id}`, run: "unavailable", active: () => false,
			snapshot: () => ({ state: "unavailable", error: detail }) });
	}

	function target(a: Agent) {
		return { id: `${name}#${a.id}`, run: `${a.epoch}:${a.runNumber}`,
			// A queued `send` task is about to start: wait must not see an idle child in between.
			recovers: a.recovers,
			active: () => !!a.run || !!a.next?.length || recoveryPending.has(a.id),
			checkpoint: () => a.activity.checkpoint(),
			alertVersion: () => a.activity.alertVersion(),
			snapshot: (messages?: number, checkpoint?: Map<string, number>, depth = 0) => ({ ...(a.title ? { title: a.title } : {}), ...(a.config.profile ? { profile: a.config.profile } : {}), ...a.activity.snapshot(messages, checkpoint),
				...(a.state === "paused" && !a.run ? { state: "paused" } : {}),
				...(recoveryErrors.has(a.id) ? { recovery_error: recoveryErrors.get(a.id)!.error } : {}),
				...(a.run?.quiet ? { cancellation_requested: true } : {}),
				...(a.next?.length ? { pending_sends: a.next.length } : {}),
				...(a.children?.pending() ? { pending_children: a.children.ids() } : {}),
				...(depth > 0 ? { children: a.children?.status?.(depth - 1) ?? [] } : {}) }),
		};
	}

	/** Whether a result sent while busy still waits for a main turn; drops the ones the model already saw. */
	function needsTurn(ctx: ExtensionContext): boolean {
		const entries = ctx.sessionManager.getEntries();
		const branch = ctx.sessionManager.getBranch();
		const lastAnswer = branch.findLastIndex((e) => e.type === "message" && e.message.role === "assistant");
		const isResult = (n: string) => (e: (typeof entries)[number]) =>
			e.type === "custom_message" && (e.customType === name || e.customType === "agent_progress") && (e.details as { delivery?: unknown } | undefined)?.delivery === n;
		for (const n of unanswered) {
			if (!entries.some(isResult(n))) continue; // still held by Pi until the turn ends
			const at = branch.findIndex(isResult(n));
			if (at < 0 || at < lastAnswer) unanswered.delete(n); // on another branch, or answered
		}
		return unanswered.size > 0;
	}

	/** The RQW-tools factory of subagent tools when RQW-tools is loaded; none (Pi's stock tools) otherwise. */
	function offeredFactory(): ToolOffer | undefined {
		let offer: ToolOffer | undefined;
		// Pi's event bus calls every handler synchronously inside emit.
		toolEvents.emit(SUBAGENT_TOOLS, {
			offer: (factory: ToolsFactory, catalogue?: ToolCatalogue) => { offer = { factory, catalogue }; },
		});
		return offer;
	}

	// Persist stock selector names, so the same subset works even when the offered extension is disabled.
	function selectors(names: string[], catalogue?: ToolCatalogue): string[] {
		const aliases = catalogue?.aliases ?? {};
		return [...new Set(names.map(name => Object.entries(aliases).find(([, value]) => value === name)?.[0] ?? name))];
	}

	function selectedNames(names: string[], catalogue?: ToolCatalogue): string[] {
		return [...new Set(names.map(name => catalogue?.aliases[name] ?? name))];
	}

	function toolParameters(names: string[]): typeof PARAMETERS {
		return { ...PARAMETERS, properties: { ...PARAMETERS.properties,
			tools: Type.Optional(Type.Array(StringEnum(names), { description: "Base subset; default all. Recursive agent delegation stays available." })) } } as typeof PARAMETERS;
	}

	/**
	 * The offered definitions of one subagent: its base tools, `job` (background jobs of its own calls; with every
	 * offered set) and, when it has `codemode`, that one as a call of its barrier. Without a returned `codemode`, Pi's
	 * own definition of the child stays.
	 */
	function offeredTools(factory: ToolsFactory, cwd: string, names: string[], codemode?: ToolDefinition, bridge?: NotificationBridge): ToolDefinition[] {
		const tools = factory(cwd, () => pi.getSettings(), { ...(codemode ? { codemode } : {}), ...(bridge ? {
			notify: (n: JobNotification) => bridge.deliver({ customType: "job", content: `[job] ${n.text}`, display: true, details: { delivery: n.id, ...n.details } }),
			retain: () => bridge.retain(),
		} : {}) })
			.filter((d) => names.includes(d.name) || d.name === "job" || (codemode && d.name === "codemode"));
		return codemode && !tools.some((d) => d.name === "codemode") ? [...tools, codemode] : tools;
	}

	/** User messages of the child's history; only parent commands create them, so the count numbers the batches. */
	const userMessages = (a: Agent) => a.session.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user").length;

	/** The saved commands; a record from before `pending_sends` and `history` has only its task, which counts as one batch. */
	const legacySends = (data: SavedChild): SendBatch[] => data.pending_sends ? data.pending_sends.map(batch => ({ n: batch.n, tasks: [...batch.tasks] }))
		: data.history === undefined && data.task !== undefined ? [{ n: 1, tasks: [data.task] }] : [];

	/** Accepted commands whose user message is not in the child's history. */
	const unsent = (a: Agent) => { const done = userMessages(a); return a.sends.filter(batch => batch.n > done); };

	/** Accepts a command: a new batch, or with `join` one more task of the last one. The caller persists. */
	function queueSend(a: Agent, task: string, join = false): SendBatch {
		const done = userMessages(a);
		a.sends = a.sends.filter(batch => batch.n > done);
		const last = a.sends.at(-1);
		if (join && last) { last.tasks.push(task); return last; }
		const batch = { n: Math.max(done, last?.n ?? 0) + 1, tasks: [task] };
		a.sends.push(batch);
		return batch;
	}

	function persist(a: Agent) {
		if (a.sends.length) {
			const done = userMessages(a);
			a.sends = a.sends.filter(batch => batch.n > done);
		}
		a.history ||= a.session.sessionManager.getBranch().some(entry => entry.type === "message" && entry.message.role === "user");
		const { model, system, base, ...config } = a.config;
		// Only the default prompt (base, reminder, role) is stored as its tail after the base the record keeps already; an own `system` stays whole.
		const head = base.trimEnd();
		// The base (the whole main prompt) is written once per branch as its own entry; records keep its ref.
		const ref = baseRef(base);
		const prompt = config.custom === undefined && head && system.startsWith(head) ? { system_tail: system.slice(head.length) } : { system };
		const data: SavedChild = {
			version: 1, kind: name, id: a.id, epoch: a.epoch,
			sessionFile: a.session.sessionManager.getSessionFile(), runNumber: a.runNumber, state: a.state,
			config: { ...prompt, ...config, base_ref: ref, model: { provider: model.provider, id: model.id } },
			fast: a.fast.on, progressSteps: a.progress.steps, ...(a.title ? { title: a.title } : {}), ...(a.task !== undefined ? { task: a.task } : {}),
			...(a.result ? { result: a.result } : {}),
			history: a.history,
			...(a.recovers ? { recovers: a.recovers } : {}),
			...(a.sends.length ? { pending_sends: a.sends.map(batch => ({ n: batch.n, tasks: [...batch.tasks] })) } : {}),
		};
		const record = childRecord(a, data);
		const known = branchBases();
		if ("config" in record && !known.has(ref)) {
			pi.appendEntry(BASE_ENTRY, { version: 1, ref, text: base });
			known.set(ref, base);
		}
		pi.appendEntry(CHILD_ENTRY, record);
		branchIndex?.saved.set(a.id, data);
		return data;
	}

	/** The base texts on the caller's selected branch, read once per branch. */
	function branchBases(): Map<string, string> {
		if (bases) return bases;
		if (!main) return new Map();
		bases = new Map();
		for (const entry of main.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== BASE_ENTRY) continue;
			const data = entry.data as { version?: unknown; ref?: unknown; text?: unknown } | undefined;
			if (data?.version === 1 && typeof data.ref === "string" && typeof data.text === "string") bases.set(data.ref, data.text);
		}
		return bases;
	}

	function saveSlot(data: SavedChild) {
		savedSlots.set(data.id, data);
		coordinator.add({ id: `${name}#${data.id}`, run: `${data.epoch}:${data.runNumber}`, recovers: data.recovers, active: () => false,
			snapshot: () => ({ state: "idle", run_active: false, model: data.config.model, ...(data.title ? { title: data.title } : {}),
				...(data.config.profile ? { profile: data.config.profile } : {}) }) });
	}

	function sleep(a: Agent) {
		if (agents.get(a.id) !== a || a.idleSince === undefined || performance.now() - a.idleSince < 300000
			|| a.state !== "completed" || !a.result || a.run || a.next?.length || a.activity.isRunning()
			|| a.session.agent.state.isStreaming || a.session.agent.hasQueuedMessages()
			|| a.session.getSteeringMessages().length || a.session.getFollowUpMessages().length
			|| a.bridge.pending() || a.children?.pending() || a.children?.runningCounts().agents
			|| coordinator.undelivered(`${name}#${a.id}`)) return;
		// A queued Pi message is not durable delivery yet. Wait for its actual branch entry.
		const delivered = main?.sessionManager.getBranch().some(entry => {
			const details = (entry.type === "custom_message" ? entry.details
				: entry.type === "message" && entry.message.role === "toolResult" ? entry.message.details : undefined) as
				{ run?: string; results?: { run?: string }[] } | undefined;
			return details?.run === a.result!.run || (Array.isArray(details?.results) && details.results.some(result => result?.run === a.result!.run));
		});
		if (!delivered && !coordinator.committed(`${name}#${a.id}`, a.result.run)) return;
		const parentFile = main?.sessionManager.getSessionFile();
		const childFile = a.session.sessionManager.getSessionFile();
		if (!parentFile || !childFile || !main) return;
		const data = persist(a);
		try {
			const durable = SessionManager.open(parentFile).getBranch().findLast(entry => entry.type === "custom" && entry.customType === CHILD_ENTRY
				&& (entry.data as SavedChild)?.id === a.id) as { data?: SavedChild } | undefined;
			if (durable?.data?.epoch !== a.epoch || durable.data.state !== "completed" || durable.data.sessionFile !== childFile) return;
			const manager = openChildManager(main.sessionManager, childFile, a.config.cwd ?? main.cwd, name, a.id);
			if (manager.getSessionId() !== a.session.sessionManager.getSessionId()
				|| !manager.buildSessionProjection().messages.some(message => message.role !== "system")) return;
		} catch { return; }
		agents.delete(a.id);
		saveSlot(data);
		releaseChildManager(main.sessionManager, name, a.id);
		close(a);
	}

	function touch(ids: string[]) {
		for (const id of ids) {
			const a = agents.get(localNumber(id)!);
			if (a?.state === "completed" && !a.run) { a.idleSince = performance.now(); armSleep(a); }
		}
	}

	function queueSleep(a: Agent) {
		if (a.idleSince === undefined || performance.now() - a.idleSince < 300000) return;
		const pending = coordinator.queue.then(() => sleep(a));
		coordinator.queue = pending.catch(() => {});
	}

	function armSleep(a: Agent) {
		a.cancelSleep?.();
		if (a.state !== "completed" || a.run || !a.result) return;
		a.idleSince ??= performance.now();
		a.bridge.wake = () => queueSleep(a);
		a.cancelSleep = deadlineTimer(Math.max(0, 300000 - (performance.now() - a.idleSince)), () => {
			a.cancelSleep = undefined;
			queueSleep(a);
		});
	}

	function selectedBranch(ctx: ExtensionContext) {
		if (branchIndex) return branchIndex;
		const saved = new Map<number, SavedChild>();
		const delivered = deliveredRuns(ctx.sessionManager);
		// Waits still open: an opening entry without a closing entry or a `child_wait` message of its own.
		const waits = new Map<string, WaitRecord>();
		// For waits closed by a replacement: the opening entries, who replaced whom, and the waits that got a `child_wait`.
		const opens = new Map<string, WaitRecord>(), replaced = new Map<string, string>(), sentIds = new Set<string>();
		// Waits that ran inside a codemode script count once the script's own result is saved; see AcceptRecord.
		const accepts: AcceptRecord[] = [];
		const results = new Map<string, boolean>();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message" && entry.message.role === "toolResult") results.set(entry.message.toolCallId, !entry.message.isError);
			if (entry.type === "custom" && entry.customType === ACCEPT_ENTRY) {
				const record = entry.data as AcceptRecord | undefined;
				if (record?.version === 1 && record.ok === true && typeof record.root === "string" && Array.isArray(record.results)) accepts.push(record);
			}
			if (entry.type === "custom" && entry.customType === WAIT_ENTRY) {
				const record = entry.data as WaitRecord | undefined;
				if (record?.version === 1 && typeof record.wait_id === "string") {
					if (record.open) { waits.set(record.wait_id, record); opens.set(record.wait_id, record); }
					else { waits.delete(record.wait_id); if (record.replaced_by) replaced.set(record.wait_id, record.replaced_by); }
				}
			}
			// A `child_wait` ends its wait whether it is a message of this session or, for a nested caller, saved in its durable inbox.
			const sent = entry.type === "custom_message" && entry.customType === "child_wait" ? entry
				: entry.type === "custom" && entry.customType === INBOX_ENTRY ? (entry.data as { message?: { customType?: string; details?: unknown } } | undefined)?.message : undefined;
			if (sent && (sent as { customType?: string }).customType === "child_wait") {
				const id = (sent.details as { wait_id?: unknown } | undefined)?.wait_id;
				if (typeof id === "string") { waits.delete(id); sentIds.add(id); }
			}
			if (entry.type === "custom" && entry.customType === CHILD_ENTRY) {
				const data = entry.data as SavedChild | undefined;
				if (data?.version === 1 && data.kind === name && Number.isSafeInteger(data.id) && data.id > 0)
					saved.set(data.id, mergeSaved(saved.get(data.id), data));
			}
			const details = (entry.type === "custom_message" ? entry.details
				: entry.type === "message" && entry.message.role === "toolResult" ? entry.message.details
					: entry.type === "custom" && entry.customType === INBOX_ENTRY
						? (entry.data as { message?: { details?: unknown } })?.message?.details : undefined) as
				{ run?: unknown; results?: { run?: unknown }[] } | undefined;
			if (typeof details?.run === "string") delivered.add(details.run);
			if (Array.isArray(details?.results)) for (const result of details.results)
				if (typeof result?.run === "string") delivered.add(result.run);
		}
		// A wait counts only once the tool result carrying its receipt is saved without error.
		const dropped = new Set<string>();
		for (const [id, wait] of waits) if (wait.call !== undefined && results.get(wait.call) !== true) { waits.delete(id); dropped.add(id); }
		// A replacement closed its old wait, but if the new one was dropped for lack of a saved tool result, the old one stays accepted.
		for (const [old, by] of replaced) {
			const wait = opens.get(old);
			if (wait && dropped.has(by) && !sentIds.has(old) && (wait.call === undefined || results.get(wait.call) === true)) waits.set(old, wait);
		}
		for (const accept of accepts) if (results.get(accept.root) === true)
			for (const result of accept.results) if (typeof result?.run === "string") delivered.add(result.run);
		// Allocation evidence belongs to the whole session, not just the selected branch.
		counter = Math.max(counter, lastNumber(ctx.sessionManager.getEntries(), name),
			...saved.keys());
		branchIndex = { saved, delivered, waits };
		return branchIndex;
	}

	function savedConfig(data: SavedChild): Omit<Config, "model"> & { model: { provider: string; id: string } } {
		const { system_tail: tail, base_ref: ref, ...stored } = data.config ?? {} as Partial<SavedChild["config"]>;
		const base = stored.base ?? (typeof ref === "string" ? branchBases().get(ref) : undefined);
		const c = data.config && { ...stored, base, system: stored.system ?? (typeof tail === "string" && typeof base === "string" ? base.trimEnd() + tail : undefined) } as Omit<Config, "model"> & { model: { provider: string; id: string } };
		if (c && Array.isArray(c.tools) && c.tools.every(tool => typeof tool === "string")) c.tools = selectors(c.tools, offeredFactory()?.catalogue);
		if (!c || typeof c.system !== "string" || typeof c.base !== "string" || !Array.isArray(c.tools)
			|| c.tools.some(tool => !TOOLS.includes(tool as typeof TOOLS[number])) || !THINKING.includes(c.thinking)
			|| (c.builtins !== undefined && (!Array.isArray(c.builtins) || c.builtins.some(tool => !BUILTIN_TOOLS.includes(tool as typeof BUILTIN_TOOLS[number]))))
			|| (c.settings !== undefined && (!c.settings || typeof c.settings !== "object" || Array.isArray(c.settings)))
			|| (c.cwd !== undefined && typeof c.cwd !== "string")
			|| (c.profile !== undefined && (!c.profile || typeof c.profile.name !== "string" || typeof c.profile.path !== "string" || typeof c.profile.sha256 !== "string"))
			|| (data.task !== undefined && typeof data.task !== "string") || (data.title !== undefined && typeof data.title !== "string")
			|| (data.sessionFile !== undefined && typeof data.sessionFile !== "string")
			|| (data.result !== undefined && (!data.result || typeof data.result.run !== "string" || typeof data.result.text !== "string"
				|| !["completed", "error"].includes(data.result.outcome) || !data.result.meta || typeof data.result.meta !== "object"
				|| (data.result.delivery !== undefined && typeof data.result.delivery !== "string")))
			|| !c.model || typeof c.model.provider !== "string" || typeof c.model.id !== "string"
			|| typeof data.fast !== "boolean" || typeof data.epoch !== "string" || !Number.isSafeInteger(data.runNumber)
			|| (data.history !== undefined && typeof data.history !== "boolean") || (data.recovers !== undefined && typeof data.recovers !== "string")
			|| (data.progressSteps !== undefined && (!Number.isSafeInteger(data.progressSteps) || data.progressSteps < 0))
			|| (data.pending_sends !== undefined && (!Array.isArray(data.pending_sends) || data.pending_sends.some(batch => !batch || !Number.isSafeInteger(batch.n) || batch.n < 1
				|| !Array.isArray(batch.tasks) || !batch.tasks.length || batch.tasks.some(task => typeof task !== "string"))))
			|| !["idle", "running", "interrupted", "paused", "completed"].includes(data.state))
			throw new Error(`Invalid persisted configuration for ${name}#${data.id}`);
		return c;
	}

	async function hydrate(ctx: ExtensionContext, signal: AbortSignal, onlyId?: number) {
		if (hydrated && onlyId === undefined) return;
		main = ctx;
		if (onlyId !== undefined) branchIndex = undefined;
		const { saved, delivered, waits } = selectedBranch(ctx);
		for (const data of saved.values()) {
			if (onlyId !== undefined && data.id !== onlyId) continue;
			if (data.state === "stopped") { recoveryErrors.delete(data.id); continue; }
			if (agents.has(data.id)) continue;
			const pending = restoring.get(data.id);
			if (pending?.epoch === data.epoch) { await pending.promise; continue; }
			const promise = (async () => {
			try {
			if (!data.sessionFile && !retainedChildManager(ctx.sessionManager, name, data.id)) {
				if (data.config?.fork_turns !== "all") return;
				if (onlyId !== undefined) throw new Error(`Cannot restore ${name}#${data.id}: fork history was lost on restart`);
				const result = data.result ?? { run: `${data.epoch}:${data.runNumber}`, text: `error: ${name}#${data.id} fork history was lost on restart; cannot continue`, outcome: "error" as const, meta: { stop: "error" as const }, delivery: randomUUID() };
				const lost: SavedChild = { ...data, state: "completed", result };
				if (!data.result) { pi.appendEntry(CHILD_ENTRY, lost); saved.set(data.id, lost); }
				saveSlot(lost);
				return;
			}
			const c = savedConfig(data);
			if (onlyId === undefined && data.state === "completed" && data.result && data.sessionFile) {
				saveSlot(data);
				return;
			}
			const model = ctx.modelRegistry.find(c.model.provider, c.model.id);
			if (!model) throw new Error(`Cannot restore ${name}#${data.id}: model ${c.model.provider}/${c.model.id} is unavailable`);
			const config: Config = { ...c, model, system: withCurrentReminder(c.system) };
			const neverRunIdle = data.state === "idle" && data.runNumber === 0 && data.task === undefined;
			// No history yet when saved: its file may be absent, and the accepted task still waits in `pending_sends`.
			const unflushed = data.history === false;
			let manager = retainedChildManager(ctx.sessionManager, name, data.id);
			try {
				if (data.sessionFile) manager = openChildManager(ctx.sessionManager, data.sessionFile, config.cwd ?? ctx.cwd, name, data.id);
			} catch (error) {
				// openChildManager checks ownership before an absent file may take this exception.
				if (!(neverRunIdle || unflushed) || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				manager ??= createChildManager(ctx.sessionManager, config.cwd ?? ctx.cwd, name, data.id);
			}
			if (!manager) throw new Error(`Cannot restore ${name}#${data.id}: missing child session`);
			// Only a never-run idle generation can legitimately have no transcript; saved tasks never authorize replay.
			if (data.sessionFile && !neverRunIdle && !unflushed && !manager.buildSessionProjection().messages.some(m => m.role !== "system"))
				throw new Error(`Cannot restore ${name}#${data.id}: saved child history is empty; refusing to rebuild it from task metadata`);
			const fast = { on: data.fast };
			const child = await createSession(config, ctx, signal, fast, labelOf(data.id), `${name}#${data.id}`, manager, true);
			child.progress.steps = data.progressSteps ?? 0;
			const a: Agent = { ...child, id: data.id, config, fast, epoch: data.epoch, runNumber: data.runNumber,
				state: data.state === "running" ? "interrupted" : data.state, title: data.title, task: data.task, result: data.result,
				written: { config: JSON.stringify(data.config), task: data.task }, history: data.history !== false, recovers: data.recovers, sends: legacySends(data) };
			if (signal.aborted) { close(a); signal.throwIfAborted(); }
			agents.set(a.id, a);
			savedSlots.delete(a.id);
			// A paused child with an accepted command that never arrived starts by itself; other paused children wait.
			if (initialRecovery && ctx.sessionManager.getSessionFile() && (a.state === "interrupted" || (a.state === "paused" && unsent(a).length))) recoveryPending.add(a.id);
			recoveryErrors.delete(a.id);
			coordinator.add(target(a));
			armSleep(a);
			} catch (error) {
				if (signal.aborted) throw error;
				recoveryPending.delete(data.id);
				recoveryFailure(data.id, error, data);
			}
			})();
			restoring.set(data.id, { epoch: data.epoch, promise });
			try { await promise; }
			finally { if (restoring.get(data.id)?.promise === promise) restoring.delete(data.id); }
		}
		hydrated = true;
		initialRecovery = false;
		const answers: Parameters<Coordinator["publishAll"]>[0] = [];
		for (const a of [...agents.values(), ...savedSlots.values()]) {
			const result = a.result;
			if (a.state !== "completed" || !result || recoveryErrors.has(a.id)) continue;
			if (!delivered.has(result.run)) {
				displays.set(result.run, "session" in a ? displayOf(a, `${name}#${a.id}`, result.outcome, result.meta) : {
					id: `${name}#${a.id}`, outcome: result.outcome === "error" || ["aborted", "length"].includes(result.meta.stop ?? "") ? "failed" : "finished",
					seconds: 0, thinking: a.config.thinking, ...(result.meta.model ? { model: result.meta.model } : {}),
					...(a.title ? { title: a.title } : {}), ...(a.config.profile ? { profile: a.config.profile } : {}),
					...(a.config.prompt_file ? { prompt_file: a.config.prompt_file } : {}) });
				ownRuns.add(result.run);
				answers.push({ id: `${name}#${a.id}`, run: result.run, text: result.text, outcome: result.outcome, push: deliver, delivery: result.delivery });
			}
		}
		// Open waits are raised after the saved answers are registered and before any is pushed, so they can claim them.
		coordinator.publishAll(answers, () => {
			for (const wait of waits.values()) {
				if (restoredWaits.has(wait.wait_id) || coordinator.hasWait(wait.wait_id)) continue;
				restoredWaits.add(wait.wait_id);
				coordinator.restoreWait(wait);
			}
		});
	}

	async function resumeOne(old: Agent, ctx: ExtensionContext, signal: AbortSignal, recoveredOnly = false): Promise<boolean> {
		if (old.run || old.session.agent.state.isStreaming) throw new Error(`${name}#${old.id}: active or cancellation pending; cannot resume`);
		const failed = old.state === "completed" && old.result?.meta.stop === "error";
		if (!["interrupted", "running", "paused"].includes(old.state) && !failed) throw new Error(`${name}#${old.id}: not interrupted or failed; use send for a new message`);
		const manager = old.session.sessionManager;
		let replacement: Agent | undefined;
		try {
			const config: Config = { ...old.config, system: withCurrentReminder(old.config.system) };
			const child = await createSession(config, ctx, signal, old.fast, labelOf(old.id), `${name}#${old.id}`, manager, true, old.bridge);
			child.progress.steps = old.progress.steps;
			const a: Agent = { ...old, ...child, config, next: undefined, run: undefined };
			replacement = a;
			// Accepted commands not yet in the history are sent once, in order, whatever the last request was.
			// The saved task is not a message by itself; only a batch, or the task of a record without `pending_sends`, is sent.
			const unsentBatches = unsent(a);
			const canContinue = repairInterrupted(a.session);
			const resumedChildren = await a.children?.resume?.(signal, recoveredOnly) ?? 0;
			const completed = !canContinue && !resumedChildren && !a.session.agent.hasQueuedMessages() && !a.bridge.pending() && !unsentBatches.length;
			const last = a.session.messages.at(-1);
			const waitingForChildren = last?.role === "toolResult" && last.toolName === "agent"
				&& (last.details as { reason?: string; wait_id?: string } | undefined)?.reason === "waiting"
				&& typeof (last.details as { wait_id?: string }).wait_id === "string"
				&& (resumedChildren > 0 || a.children?.pending());
			if (completed && (!last || !isAssistant(last))) throw new Error(`${name}#${a.id}: no saved request to resume`);
			if (!completed) {
				a.captureRun(ctx.sessionManager.getSessionId());
				const [first, ...rest] = unsentBatches;
				await startRun(a, first?.tasks.join("\n\n"), signal, { skipRequest: !first && (!canContinue || !!waitingForChildren), queued: true, recovery: recoveryPending.has(a.id) });
				for (const batch of rest) a.session.agent.steer({ role: "user", content: [{ type: "text", text: batch.tasks.join("\n\n") }], timestamp: Date.now() });
				signal.throwIfAborted();
				a.guard.signal = a.run?.controller.signal;
			}
			// Keep the old SDK session usable until the replacement has accepted its request.
			close(old, true);
			agents.set(a.id, a);
			recoveryPending.delete(a.id); recoveryErrors.delete(a.id);
			if (completed && last && isAssistant(last)) {
				coordinator.add(target(a));
				publishRun(a, target(a), textOf(last) || "(no text)", last.stopReason === "error" ? "error" : "completed", { model: `${last.provider}/${last.model}`, stop: last.stopReason });
			}
			return !completed;
		} catch (error) {
			if (replacement) close(replacement, true);
			persist(old);
			coordinator.add(target(old));
			recoveryFailure(old.id, error);
			throw error;
		}
	}

	async function resumeAll(signal: AbortSignal, recoveredOnly = false): Promise<number> {
		if (!main) return 0;
		await hydrate(main, signal);
		let count = 0;
		for (const a of [...agents.values()]) {
			if (recoveredOnly && !recoveryPending.has(a.id)) continue;
			if (a.run || !["interrupted", "running", "paused"].includes(a.state)) continue;
			try { count += Number(await resumeOne(a, main, signal, recoveredOnly)); }
			catch (error) {
				if (signal.aborted) throw error;
				recoveryPending.delete(a.id);
				recoveryFailure(a.id, error);
			}
		}
		return count;
	}

	async function createSession(config: Config, ctx: ExtensionContext, signal: AbortSignal, fast: { on: boolean }, label: string, childName: string, manager: SessionManager, coreMode = false, retainedBridge?: NotificationBridge, firstPayload?: { source: ForkPayload; task: string }): Promise<Child> {
		signal.throwIfAborted();
		const bridge = retainedBridge ?? new NotificationBridge(manager);
		const cwd = config.cwd ?? ctx.cwd;
		const controller = new AbortController();
		const guard: Child["guard"] = {};
		const core: Child["core"] = { on: coreMode, active: false };
		let childSession: AgentSession | undefined;
		let progress: ProgressReports | undefined;
		const childHost: CallerHost = {
			busy: () => core.on ? core.active || !!childSession?.agent.state.isStreaming : childSession?.isStreaming ?? false,
			send: (message, options) => {
				if (bridge.lifetime.signal.aborted) return;
				if (!childSession) throw new Error("Child session is not bound");
				if (!core.on && message.customType !== "agent_progress") { void childSession.sendCustomMessage(message, options).catch(error => activity?.reportError(String(error))); return; }
				bridge.deliver(message, options);
			},
		};
		const check = () => { controller.signal.throwIfAborted(); guard.signal?.throwIfAborted(); };
		let children: RuntimeHandle | undefined;
		let activity: Activity | undefined;
		const web = offeredWeb(toolEvents);
		// codemode and tool_search as the caller has them: Pi's own built-in factories, active only when the caller's are.
		const active = new Set(pi.getActiveTools());
		const builtins = config.builtins ?? BUILTIN_TOOLS.filter(name => active.has(name));
		const settingsManager = SettingsManager.inMemory(config.settings ?? childSettings(pi.getSettings()));
		settingsManager.setProjectTrusted(ctx.isProjectTrusted());
		// With RQW-tools, the child's codemode uses its job registry, like the main session's: Pi's own
		// definition built from the child's API, handed to the factory instead of being registered as it is. Without an
		// offer it is registered exactly as Pi's built-in factory does. The offer is asked for at that point of the reload
		// when the child has codemode, otherwise right after it.
		let offer: ToolOffer | undefined;
		let codemode: ToolDefinition | undefined;
		let childApi!: ExtensionAPI;
		const withCodemode = (sub: ExtensionAPI) => {
			offer = controller.signal.aborted || signal.aborted ? undefined : offeredFactory();
			// The built-in factory only calls `registerTool`; the rest of the API stays the child's for its callbacks.
			if (offer) createCodemodeExtension()(Object.assign(Object.create(sub), { registerTool: (d: ToolDefinition) => void (codemode = d) }));
			else createCodemodeExtension()(sub);
		};
		const childExtensions = collectExtensionFactories(toolEvents);
		const resourceLoader = new DefaultResourceLoader({
			cwd, agentDir: getAgentDir(), settingsManager,
			noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			systemPromptOverride: () => config.system,
			appendSystemPromptOverride: () => [],
			// Only a forced prompt avoids Pi's appended sections, such as <cwd>.
			extensionFactories: [
				...(builtins.includes("codemode") ? [withCodemode] : []),
				...(builtins.includes("tool_search") ? [createToolSearchExtension()] : []),
				(sub: ExtensionAPI) => {
					childApi = sub;
					fastGpt(sub, () => fast.on);
					sub.on("model_select", () => progress?.invalidate());
					sub.on("context_with_system", event => {
						if (!core.on) return;
						const tools = getCurrentTools(event.messages.filter(m => m.role === "system"));
						return { messages: [{ role: "system", content: config.system, toolsAdded: tools, timestamp: Date.now() }, ...event.messages.filter(m => m.role !== "system")] };
					});
					sub.on("before_agent_start", () => {
						check();
						return { systemPrompt: config.system };
					});
					children = registerCaller(sub, toolEvents, true, false, () => fast.on, onRunning, () => config.base, `${label}/`, childHost);
					web?.(sub);
				},
				...childExtensions,
			],
		});
		// Reload can create a nested caller; failure or cancellation ends its lifetime too.
		let creating: Promise<Child> | undefined;
		let jobs: JobControl | undefined;
		try {
			await untilAborted(resourceLoader.reload(), signal);
			if (!builtins.includes("codemode")) offer = offeredFactory();
			const names = selectedNames(config.tools, offer?.catalogue);
			const customTools = offer ? offeredTools(offer.factory, cwd, names, codemode, bridge) : [];
			const jobTool = customTools.find((d) => d.name === "job") as (ToolDefinition & { jobs?: JobControl }) | undefined;
			jobs = jobTool?.jobs;
			signal.throwIfAborted();
			creating = createAgentSession({
				cwd, modelRuntime: runtimeOf(ctx), model: config.model, thinkingLevel: config.thinking,
				tools: [...names, ...(jobTool ? ["job"] : []), "agent", ...(web ? ["web"] : []), ...builtins],
				customTools, resourceLoader,
				sessionManager: manager, settingsManager,
			}).then(async ({ session }) => {
				childSession = session;
				if (core.on) await session.bindExtensions({ mode: "tui" });
				// Before any prompt. A late create after an abort is released here too.
				let parent: string;
				try { parent = ctx.sessionManager.getSessionId(); } catch (error) { session.dispose(); throw error; }
				// The child's factory forces config.system as its prompt (before_agent_start returns it), so the prompt is forced.
				const policy = bindSessionPolicy(toolEvents, session, parent, "collab_spawn", config.system, childName, true, childApi);
				if (signal.aborted) { jobs?.dispose(); policy.release(); session.dispose(); signal.throwIfAborted(); }
				// prompt() may finish auth after abort()/dispose(). Never let an abandoned preflight reach inference.
				progress = new ProgressReports(toolEvents, childName, manager.getSessionId(), (message, current, delivered) => {
					const delivery = randomUUID();
					coordinator.notification({ ...message, details: { ...(message.details as Record<string, unknown> | undefined), delivery } }, current, delivered, (notice, options) => {
						// Like final results, busy-parent notices stay outside Pi's clearable follow-up queue.
						if (!callerIdle()) unanswered.add(delivery);
						send(notice, { triggerTurn: options?.triggerTurn === true && callerIdle() && !mainAborted });
					});
				});
				const stream = session.agent.streamFunction;
				let pendingPayload = firstPayload;
				session.agent.streamFunction = (model, context, options) => {
					check();
					progress!.capture(model, context);
					const first = pendingPayload;
					if (first && options?.sessionId !== manager.getSessionId()) return stream(model, context, options);
					if (first) {
						const onPayload = options?.onPayload;
						return stream(model, context, { ...options,
							...(model.api === "anthropic-messages"
								? { sessionId: first.source.options.sessionId, cacheRetention: first.source.options.cacheRetention }
								: { serviceTier: first.source.payload.service_tier ?? "default" }),
							async onPayload(payload, requestModel) {
								await onPayload?.(payload, requestModel);
								const copy = structuredClone(first.source.payload);
								if (model.api === "anthropic-messages") {
									(copy.messages as unknown[]).push({ role: "user", content: [{ type: "text", text: first.task }] });
								} else {
									delete copy.previous_response_id;
									(copy.input as unknown[]).push({ type: "message", role: "user", content: [{ type: "input_text", text: first.task }] });
								}
								pendingPayload = undefined;
								return copy;
							} });
					}
					// Ordinary child Anthropic requests use the built-in 5m tier.
					return stream(model, context, model.api === "anthropic-messages" ? { ...options, cacheRetention: "short" } : options);
				};
				activity = new Activity(session, () => {
					onRunning(); coordinator.notify();
					const a = agents.get(localNumber(childName)!);
					if (a?.session === session && !a.run && !a.controller.signal.aborted) {
						a.cancelSleep?.(); a.cancelSleep = undefined; a.idleSince = undefined;
						if (!activity?.isRunning()) armSleep(a);
					}
				}, { alert_after_ms: config.alert_after_ms });
				return { session, progress, controller, guard, children, activity, jobs, release: policy.release, captureRun: policy.capture, core, bridge };
			});
			return await untilAborted(creating, signal);
		} catch (error) {
			controller.abort();
			if (!retainedBridge) bridge.close();
			jobs?.dispose();
			void creating?.then(({ session, release }) => { release(); session.dispose(); }).catch(() => {});
			throw error;
		}
	}

	/** Wait only for an active SDK run, not its answer. Caller cancellation ends only an unaccepted run. */
	async function startRun(a: Agent, task: string | undefined, signal: AbortSignal, { skipRequest = false, communication: startsCommunication = false, queued = false, recovery = false } = {}): Promise<void> {
		let communication = startsCommunication;
		signal.throwIfAborted();
		const started = Promise.withResolvers<void>();
		const accept = () => {
			if (communication) { a.progress.reset(); communication = false; }
			started.resolve();
		};
		const session = a.session;
		a.cancelSleep?.(); a.cancelSleep = undefined; a.idleSince = undefined;
		a.progress.onCount = () => persist(a);
		a.runNumber++;
		a.recovers = recovery ? `${a.epoch}:${a.runNumber - 1}` : undefined;
		a.state = "running";
		recoveryErrors.delete(a.id);
		a.result = undefined;
		if (task !== undefined) a.task = task;
		const accepted = task !== undefined && !queued ? queueSend(a, task) : undefined;
		persist(a);
		a.core.active = true;
		a.core.wake = () => a.run?.parked?.abort();
		a.bridge.wake = a.core.wake;
		a.activity.startRun();
		const identity = target(a);
		// A wait restored after a crash follows the run that continues the interrupted one, and only that one.
		if (recovery) coordinator.follow(identity.id, `${a.epoch}:${a.runNumber - 1}`, identity.run);
		coordinator.begin(identity);
		// Keep error provenance with each contribution so retry/delegation trimming removes both together.
		const outputs: { text: string; error?: true }[] = [];
		// This logical run's record: fresh here, updated by every assistant message_end below, retries and wakeups included.
		const meta: RunMeta = {};
		let lastPushed = 0;
		let nativeRunStart = 0;
		let delegatedRunStart: number | undefined;
		const run: NonNullable<Agent["run"]> = { done: Promise.resolve(), quiet: false, controller: new AbortController() };
		a.guard.signal = AbortSignal.any([run.controller.signal, signal]);
		const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "agent_start") {
				// Multiple background wakeups may be deferred at settlement. Keep only their final native run's answer.
				if (delegatedRunStart !== undefined) { outputs.splice(delegatedRunStart); lastPushed = 0; }
				nativeRunStart = outputs.length;
			}
			if (event.type === "agent_end" && (a.children?.pending() || a.bridge.pending())) {
				// This native run ended before all delegated results were consumed. It is not a final answer to main.
				delegatedRunStart ??= nativeRunStart;
				outputs.splice(nativeRunStart);
				lastPushed = 0;
			}
			if (event.type === "compaction_start") {
				a.progress.invalidate();
				// A late prompt preflight may enter compaction after cancellation; stop its summary too.
				if (a.guard.signal?.aborted || a.controller.signal.aborted) void session.abort().catch(() => {});
				accept();
			}
			if (event.type === "auto_retry_start" || (event.type === "compaction_end" && event.willRetry)) {
				if (lastPushed) outputs.splice(outputs.length - lastPushed, lastPushed);
				lastPushed = 0;
			}
			if (event.type === "compaction_end" && !event.willRetry && event.errorMessage) {
				outputs.push({ text: `error: ${event.errorMessage}`, error: true });
				lastPushed = 0;
			}
			if (event.type !== "message_end" || !isAssistant(event.message)) return;
			const m = event.message;
			if (m.stopReason !== "toolUse") a.progress.invalidate();
			else if (a.config.fork_turns !== "all") a.progress.response(m, m.thinkingLevel as Parameters<ProgressReports["response"]>[1]);
			recordRunMessage(meta, m);
			lastPushed = 0;
			if (m.stopReason === "error") {
				outputs.push({ text: `error: ${m.errorMessage ?? "unknown error"}`, error: true });
				lastPushed = 1;
			} else if (m.stopReason === "stop" || m.stopReason === "length") {
				const text = textOf(m);
				if (text) { outputs.push({ text }); lastPushed++; }
				if (m.stopReason === "length") {
					a.activity.reportError("Response was truncated: the model reached its output token limit.");
					outputs.push({ text: "error: Response was truncated: the model reached its output token limit.", error: true });
					lastPushed++;
				}
			}
		});
		run.done = (async () => {
			try {
				if (skipRequest) started.resolve();
				else if (a.core.on) {
					const usage = session.getContextUsage();
					const settings = session.settingsManager.getCompactionSettings(session.model);
					if (usage?.tokens != null && shouldCompact(usage.tokens, usage.contextWindow, settings)) {
						await session.compact();
						a.guard.signal?.throwIfAborted();
					}
					const notifications = a.bridge.messages();
					accept();
					const pending = task !== undefined ? session.agent.prompt(task)
						: notifications.length ? session.agent.prompt(notifications.map(message => ({ role: "custom", ...message, timestamp: Date.now() })))
						: session.agent.continue();
					started.resolve();
					await pending;
					a.bridge.reconcile();
					a.children?.settle?.(a.guard.signal?.aborted ?? false);
				} else await session.prompt(task!, { preflightResult: accept });
				while (!run.quiet && !a.guard.signal?.aborted) {
					const signal = a.guard.signal ?? a.controller.signal;
					// A child may have woken a new native run after the original prompt settled.
					await untilAborted(a.core.on ? session.agent.waitForIdle() : session.waitForIdle(), signal);
					const notifications = a.bridge.messages();
					if (notifications.length) {
						if (a.core.on) {
							// continue() from a terminating tool result requests before draining follow-ups.
							// These are the real incoming notifications, not a synthetic resume message.
							await session.agent.prompt(notifications.map(message => ({ role: "custom", ...message, timestamp: Date.now() })));
							a.children?.settle?.(signal.aborted);
						} else {
							for (const message of notifications.slice(0, -1)) await session.sendCustomMessage(message, { triggerTurn: false });
							await session.sendCustomMessage(notifications.at(-1)!, { triggerTurn: true });
						}
						a.bridge.reconcile();
						continue;
					}
					if (a.core.on && session.agent.hasQueuedMessages()) {
						await session.agent.continue();
						a.children?.settle?.(signal.aborted);
						continue;
					}
					// A steering message that missed the agent loop's last poll waits here like a follow-up.
					if (!a.core.on && (session.getSteeringMessages().length > 0 || session.getFollowUpMessages().length > 0)) {
						const queued = session.clearQueue();
						// They arrive as one user message, so their batches become one numbered batch.
						const open = unsent(a);
						if (open.length > 1) {
							a.sends = [...a.sends.filter(batch => !open.includes(batch)), { n: open[0].n, tasks: open.flatMap(batch => batch.tasks) }];
							persist(a);
						}
						await session.prompt([...queued.steering, ...queued.followUp].join("\n\n"));
					}
					else if (a.children?.pending() || a.bridge.pending()) {
						// Parked until a child result: `send` aborts `parked` so a steering message is delivered at once.
						const park = run.parked = new AbortController();
						const parkedSignal = AbortSignal.any([signal, park.signal]);
						try {
							const observations: Promise<void>[] = [];
							if (a.children?.pending()) observations.push(a.children.wait(parkedSignal));
							if (a.bridge.pending()) observations.push(a.bridge.wait(parkedSignal));
							await untilAborted(Promise.race(observations), parkedSignal);
						}
						catch (error) { if (!park.signal.aborted || signal.aborted) throw error; }
						finally { park.abort(); run.parked = undefined; }
					}
					else break;
				}
				if (!run.quiet && !a.guard.signal?.aborted) {
					const outcome = outputs.some(output => output.error) ? "error" : "completed";
					// A core result can be claimed synchronously by wait; publish only after its diagnostics are final.
					if (a.core.on) a.activity.endRun(outcome, meta.stop !== undefined);
					publishRun(a, identity, outputs.map(output => output.text).join("\n\n") || "(no text)", outcome, meta);
				}
			} catch (error) {
				if (!run.quiet && !a.guard.signal?.aborted) {
					const detail = error instanceof Error ? error.message : String(error);
					a.activity.reportError(detail);
					outputs.push({ text: `error: ${detail}`, error: true });
					if (a.core.on) a.activity.endRun("error", meta.stop !== undefined);
					publishRun(a, identity, outputs.map(output => output.text).join("\n\n"), "error", meta);
				}
			} finally {
				a.progress.invalidate();
				unsubscribe();
				started.resolve();
				// The abort can end this loop while a child-woken native run still streams (a tool ignoring abort):
				// Pi would reject a new prompt then, so pending sends wait for it. This run stays current meanwhile.
				if (a.run === run && a.next?.length && !a.controller.signal.aborted) await (a.core.on ? session.agent.waitForIdle() : session.waitForIdle()).catch(() => {});
				if (a.run === run) {
					a.activity.endRun(run.quiet ? "interrupted" : outputs.some(output => output.error) ? "error" : "completed",
						a.core.on && meta.stop !== undefined);
					// `send` with `interrupt` (and sends after it) made while this run was stopping: start them now, once.
					// a.next keeps the child active until startRun has set the new a.run (synchronously), so wait and
					// the caller's fallback never see it idle in between.
					a.run = undefined;
					a.core.active = false;
					a.state = run.quiet || a.guard.signal?.aborted ? (a.state === "paused" ? "paused" : "interrupted") : "completed";
					if (agents.get(a.id) === a) persist(a);
					onRunning();
					const next = a.next;
					if (next?.length && !a.controller.signal.aborted)
						void startRun(a, next.join("\n\n"), a.controller.signal, { queued: true }).then(() => { a.guard.signal = a.run?.controller.signal; }, () => {});
					a.next = undefined;
					armSleep(a);
					coordinator.notify();
				}
			}
		})();
		a.run = run;
		onRunning();
		try {
			await untilAborted(started.promise, signal);
		} catch (error) {
			run.quiet = true;
			run.controller.abort();
			session.clearQueue();
			void session.abort().catch(() => {});
			// The caller got an error: this command was not accepted.
			if (accepted) { a.sends = a.sends.filter(batch => batch !== accepted); persist(a); }
			throw error;
		}
	}

	function close(a: Agent, preserveBridge = false) {
		a.cancelSleep?.(); a.cancelSleep = undefined;
		a.progress.invalidate();
		if (!preserveBridge) a.bridge.close();
		a.next = undefined;
		if (a.run) { a.run.quiet = true; a.run.controller.abort(); }
		a.controller.abort();
		a.release();
		a.activity.close();
		a.children?.close();
		a.jobs?.dispose();
		a.session.clearQueue();
		// abort first: dispose alone does not set Pi's abort flag for queued follow-ups or compaction.
		a.session.agent.abort();
		void (async () => {
			await Promise.all([a.session.abort().catch(() => {}), a.session.agent.waitForIdle()]);
			// Retained background jobs may still use their original API to persist results.
			if (preserveBridge) {
				try { while (a.bridge.retained()) await a.bridge.wait(a.bridge.lifetime.signal); }
				catch { /* Explicit stop ends retained work too. */ }
			}
			a.session.dispose();
		})();
		onRunning();
	}

	/** Request cancellation of the current run: the shared body of `interrupt` and `send` with `interrupt: true`. */
	function requestInterrupt(a: Agent, run: NonNullable<Agent["run"]>) {
		a.progress.invalidate();
		recoveryPending.delete(a.id);
		a.children?.abortAll();
		a.jobs?.abortAll();
		coordinator.change(`${name}#${a.id}`, "interrupt");
		run.quiet = true;
		a.state = "paused";
		a.sends = [];
		persist(a);
		run.controller.abort();
		a.session.clearQueue();
		void a.session.abort().catch(() => {});
		coordinator.add(target(a));
	}

	function localNumber(id: string | undefined): number | undefined {
		const local = id?.startsWith(`${name}#`) ? id.slice(name.length + 1) : id;
		return local && /^[1-9]\d*$/.test(local) && Number.isSafeInteger(Number(local)) ? Number(local) : undefined;
	}
	function find(id: string | undefined): Agent {
		const number = localNumber(id);
		const a = number === undefined ? undefined : agents.get(number);
		if (a) return a;
		const failed = number === undefined ? undefined : recoveryErrors.get(number);
		if (failed) throw new Error(`${name}#${number} unavailable: ${failed.error}`);
		const known = [...agents.keys()].map((k) => `${name}#${k}`).join(", ") || "none";
		throw new Error(`Unknown ${name} id: ${id ?? "(none)"}. Known: ${known}`);
	}

	function modelFor(value: string, ctx: ExtensionContext, bare = false): Model<Api> {
		const canonical = bare && !value.includes("/") && /^gpt-/.test(value) ? `openai-codex/${value}` : value;
		const slash = canonical.indexOf("/");
		const matches = slash > 0 ? [ctx.modelRegistry.find(canonical.slice(0, slash), canonical.slice(slash + 1))].filter(Boolean)
			: bare ? ctx.modelRegistry.getAll().filter(model => model.id === canonical) : [];
		if (matches.length !== 1) throw new Error(`${matches.length > 1 ? "Ambiguous" : "Unknown"} model: ${value}. Use provider/id from the model registry.`);
		return matches[0]!;
	}

	async function resolveConfig(params: Params, ctx: ExtensionContext, signal: AbortSignal, base?: Config): Promise<Config> {
		signal.throwIfAborted();
		const profileName = params.agent_type ?? base?.profile?.name;
		const profile = profileName === undefined ? undefined : catalogue.get(profileName);
		if (profileName !== undefined && !profile) throw new Error(`Unknown agent_type: ${profileName}`);
		if (profile?.error) throw new Error(`Invalid agent_type ${profile.name}: ${profile.error}`);
		// Reload profile defaults on restart, retaining the caller's explicit choices.
		const fallback: Partial<Config> | undefined = base && {
			...base,
			...(base.profile_defaults?.model ? { model: undefined } : {}),
			...(base.profile_defaults?.thinking ? { thinking: undefined } : {}),
			...(base.profile_defaults?.role ? { role: undefined } : {}),
		};
		const alertAfter = params.alert_after_ms ?? fallback?.alert_after_ms;
		if (alertAfter !== undefined && (!Number.isSafeInteger(alertAfter) || alertAfter <= 0))
			throw new Error("alert_after_ms must be a positive finite safe integer");
		if (params.system !== undefined && params.system_file !== undefined) throw new Error("Give system or system_file, not both");
		if (params.role !== undefined && params.role_file !== undefined) throw new Error("Give role or role_file, not both");
		const hasSystem = params.system !== undefined || params.system_file !== undefined;
		const hasRole = params.role !== undefined || params.role_file !== undefined;
		if (hasSystem && hasRole) throw new Error("Give system (the whole prompt) or role (added to the default prompt), not both; file variants follow the same rule");
		let custom = fallback?.custom;
		let role = fallback?.role;
		let promptFile = fallback?.prompt_file;
		if (given(params.system)) { custom = params.system; role = undefined; promptFile = undefined; }
		if (given(params.role)) { role = params.role.trim(); custom = undefined; promptFile = undefined; }
		const profileRole = !hasSystem && !hasRole && custom === undefined && role === undefined && promptFile === undefined && profile?.developer_instructions !== undefined;
		if (profileRole) role = profile.developer_instructions;
		const fileKind = params.system_file !== undefined ? "system" : params.role_file !== undefined ? "role" : promptFile?.kind;
		const filePath = params.system_file ?? params.role_file ?? promptFile?.path;
		if (fileKind !== undefined && filePath !== undefined) {
			const loaded = await untilAborted(loadPromptFile(fileKind, filePath, ctx.cwd), signal);
			promptFile = loaded.file;
			custom = fileKind === "system" ? loaded.text : undefined;
			role = fileKind === "role" ? loaded.text : undefined;
		}
		const root = basePrompt(ctx);
		const system = custom !== undefined ? `${custom}\n\n${SUBAGENT_REMINDER}` : subagentPrompt(root, role, promptFile?.kind === "role" || profileRole);
		const profileModel = !params.model && !fallback?.model && profile?.model !== undefined;
		const model = params.model ? modelFor(params.model, ctx) : fallback?.model ?? (profileModel ? modelFor(profile.model!, ctx, true) : ctx.model);
		if (!model) throw new Error("No model: give model as provider/id");
		let thinking = params.thinking ?? fallback?.thinking ?? pi.getThinkingLevel();
		const profileThinking = params.thinking === undefined && fallback?.thinking === undefined && profile?.model_reasoning_effort !== undefined;
		if (profileThinking) {
			const effort = profile.model_reasoning_effort === "none" ? "off" : profile.model_reasoning_effort;
			if (!THINKING.includes(effort as Thinking) || !getSupportedThinkingLevels(model).includes(effort as Thinking))
				throw new Error(`Unsupported model_reasoning_effort for agent_type ${profile.name}; no effort lowering is allowed`);
			thinking = effort as Thinking;
		}
		if (!ctx.modelRegistry.hasConfiguredAuth(model) && !(await untilAborted(runtimeOf(ctx).checkAuth(model.provider, { signal }), signal)))
			throw new Error(`No credentials for provider ${model.provider}`);
		signal.throwIfAborted();
		return { system, base: root, cwd: ctx.cwd, ...(custom !== undefined ? { custom } : {}), ...(role !== undefined ? { role } : {}),
			...(promptFile ? { prompt_file: promptFile } : {}), ...(profile ? { profile: { name: profile.name, path: profile.path, sha256: profile.sha256 },
				profile_defaults: { model: profileModel, thinking: profileThinking, role: profileRole } } : {}),
			model, thinking, tools: selectors(params.tools ?? fallback?.tools ?? [...TOOLS], offeredFactory()?.catalogue),
			...(alertAfter === undefined ? {} : { alert_after_ms: alertAfter }) };
	}

	const ok = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });
	const definition: ToolDefinition<typeof PARAMETERS> = {
		name,
		label: "Agent",
		description: DESCRIPTION,
		parameters: toolParameters(offeredFactory()?.catalogue?.names ?? [...TOOLS]),
		execute: (toolCallId, raw, callerSignal, _onUpdate, ctx) => {
			// Capture ctx.signal now: its getter can point at another run when the internal queue drains.
			const signal = AbortSignal.any([lifetime.signal, generation.signal, callerSignal, ctx.signal].filter((s): s is AbortSignal => !!s));
			if (!main) { main = ctx; counter = Math.max(counter, lastNumber(ctx.sessionManager.getEntries(), name)); }
			const params = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null)) as Params;
			if (params.fork_turns !== undefined && params.action !== "start") throw new Error("fork_turns is only supported on start");
			if (params.fork_turns === "all" && [params.model, params.thinking, params.agent_type, params.system, params.system_file, params.role, params.role_file, params.include].some(value => value !== undefined))
				throw new Error("fork_turns all cannot be combined with model, thinking, agent_type, system, system_file, role, role_file or include");
			const fork = params.fork_turns === "all" ? { seed: forkBranch(ctx.sessionManager.getBranch()), system: ctx.getSystemPrompt(), model: ctx.model, thinking: pi.getThinkingLevel(), tools: pi.getActiveTools(), payload: payloads.get() } : undefined;
			if (fork?.model && ["anthropic-messages", "openai-codex-responses"].includes(fork.model.api)) {
				const anthropic = fork.model.api === "anthropic-messages";
				if (!fork.payload || fork.payload.model.id !== fork.model.id || fork.payload.model.provider !== fork.model.provider || fork.payload.model.api !== fork.model.api || !Array.isArray(fork.payload.payload[anthropic ? "messages" : "input"]))
					throw new Error(`Cannot fork ${anthropic ? "Anthropic" : "Codex"}: caller's last provider payload is unavailable`);
			}
			// Queue only registration/snapshot, never the waiting Promise or a tool that ignores abort.
			if (params.action === "wait") {
				const registration = coordinator.queue.then(async () => {
					signal.throwIfAborted();
					await hydrate(ctx, signal);
					const ids = targetIds(params.ids), timeout = waitTimeout(params.timeout_ms);
					touch(ids);
					const options = { until: params.until as "first" | "all" | undefined, wake_on_alert: params.wake_on_alert };
					const blocking = toolCallId.includes("/") || (!backgroundCaller && (ctx.mode === "print" || ctx.mode === "json"));
					return { waiting: blocking ? coordinator.wait(ids, timeout, signal, toolCallId, options)
						: coordinator.notificationWait(ids, timeout, signal, toolCallId, options) };
				});
				coordinator.queue = registration.catch(() => {});
				return registration.then(({ waiting }) => waiting).then(withDisplays);
			}
			const next = coordinator.queue.then(() => { signal.throwIfAborted(); return act(params, ctx, signal, fork); });
			coordinator.queue = next.catch(() => {});
			return untilAborted(next, signal);
		},
	};
	pi.registerTool(definition);

	/** `params` has no null fields: `execute` removed them (strict-mode providers send null for omitted optional fields). */
	async function act(params: Params, ctx: ExtensionContext, signal: AbortSignal, fork?: { seed: SessionEntry[]; system: string; model: Model<Api> | undefined; thinking: Thinking; tools: string[]; payload?: ForkPayload }) {
		signal.throwIfAborted();
		await hydrate(ctx, signal);
		const number = localNumber(params.id);
		const saved = number === undefined ? undefined : savedSlots.get(number) ?? recoveryErrors.get(number)?.data;
		const lostFork = params.action === "restart" && number !== undefined && !agents.has(number)
			&& saved?.config?.fork_turns === "all" && !saved.sessionFile ? saved : undefined;
		if (params.action === "status") {
			for (const id of targetIds(params.ids)) {
				const number = localNumber(id)!;
				if (savedSlots.has(number)) await hydrate(ctx, signal, number);
				const depth = statusDepth(params.depth);
				if (depth > 0) await agents.get(number)?.children?.prepareStatus?.(depth - 1, signal);
			}
		} else if (!["start", "wait", "stop"].includes(params.action)) {
			const id = localNumber(params.id);
			if (id !== undefined && savedSlots.has(id) && !lostFork) await hydrate(ctx, signal, id);
		}
		if ((params.system_file !== undefined || params.role_file !== undefined || params.include !== undefined || params.agent_type !== undefined) && params.action !== "start" && params.action !== "restart")
			throw new Error("system_file, role_file, include and agent_type are only supported on start/restart");
		if (params.agent_type !== undefined || (params.action === "restart" && (lostFork ? lostFork.config.profile : find(params.id).config.profile))) await refreshProfiles(ctx);
		const task = params.include?.includes("user_messages") && params.task !== undefined
			? appendUserMessages(params.task, ctx.sessionManager.getBranch()) : params.task;
		switch (params.action) {
			case "status": touch(targetIds(params.ids)); return waitResult({ statuses: coordinator.status(targetIds(params.ids), messageCount(params.messages), undefined, statusDepth(params.depth)) });
			case "start": {
				if (!params.task) throw new Error("task is required");
				const config = await resolveConfig(params, ctx, signal);
				if (fork) {
					config.fork_turns = "all";
					if (!fork.model) throw new Error("No caller model for fork");
					config.model = fork.model;
					config.thinking = fork.thinking;
					config.system = fork.model.api === "anthropic-messages" ? fork.system : withCurrentReminder(fork.system);
					config.base = fork.system;
					const available = new Set(selectors(fork.tools, offeredFactory()?.catalogue));
					config.tools = config.tools.filter(tool => available.has(tool));
				}
				signal.throwIfAborted();
				if (counter >= Number.MAX_SAFE_INTEGER) throw new Error("Agent id space exhausted");
				const id = ++counter;
				pi.appendEntry(name, { id });
				const fast = { on: params.fast_gpt ?? callerFast() };
				config.settings = childSettings(pi.getSettings());
				config.builtins = BUILTIN_TOOLS.filter(name => (fork?.tools ?? pi.getActiveTools()).includes(name));
				const manager = createChildManager(ctx.sessionManager, ctx.cwd, name, id, fork?.seed);
				const firstPayload = fork?.model && ["anthropic-messages", "openai-codex-responses"].includes(fork.model.api) && fork.payload ? { source: fork.payload, task: task! } : undefined;
				const child = await createSession(config, ctx, signal, fast, labelOf(id), `${name}#${id}`, manager, false, undefined, firstPayload);
				const a: Agent = { id, config, epoch: randomUUID(), runNumber: 0, state: "idle", fast, sends: [], ...(given(params.title) ? { title: params.title.trim() } : {}), ...child };
				agents.set(id, a);
				try {
					signal.throwIfAborted();
					a.captureRun(ctx.sessionManager.getSessionId());
					await startRun(a, task!, signal);
					signal.throwIfAborted();
					a.guard.signal = a.run?.controller.signal;
					agents.set(id, a);
					onRunning();
				} catch (error) { agents.delete(id); a.state = "stopped"; a.sends = []; persist(a); coordinator.change(`${name}#${id}`, "canceled_start"); close(a); throw error; }
				return ok(`${name}#${id} started`);
			}
			case "resume": {
				const id = localNumber(params.id);
				if (id !== undefined && !agents.has(id) && recoveryErrors.has(id)) await hydrate(ctx, signal, id);
				const a = find(params.id);
				if (params.task !== undefined) throw new Error("resume does not accept task; use send for a new message");
				await resumeOne(a, ctx, signal);
				return ok(`${name}#${a.id} resumed`);
			}
			case "send": {
				const a = find(params.id);
				if (!params.task) throw new Error("task is required");
				if (a.run?.quiet && !params.interrupt && !a.next) throw new Error(`${name}#${a.id}: cancellation pending; inspect status before send`);
				a.captureRun(ctx.sessionManager.getSessionId());
				if (params.fast_gpt !== undefined) { a.fast.on = params.fast_gpt; persist(a); }
				if (a.run && (params.interrupt || a.run.quiet)) {
					// Abort now like `interrupt` and return at once: the task starts when the old run has stopped (the
					// finally of its run), after any earlier pending sends. No time limit: an uncooperative tool just delays it.
					if (!a.run.quiet) requestInterrupt(a, a.run);
					const joined = !!a.next?.length;
					(a.next ??= []).push(params.task);
					queueSend(a, params.task, joined); persist(a);
					a.progress.reset();
					return ok(`${name}#${a.id}: ${params.interrupt ? "interrupted, sent" : "sent"}`);
				}
				if (a.run) {
					// Steering: delivered after the child's current tool call, before its next request; nothing is aborted.
					const run = a.run;
					const batch = queueSend(a, params.task); persist(a);
					try {
						if (a.core.on) a.session.agent.steer({ role: "user", content: [{ type: "text", text: params.task }], timestamp: Date.now() });
						else await untilAborted(a.session.steer(params.task), signal);
					} catch (error) { a.sends = a.sends.filter(item => item !== batch); persist(a); throw error; }
					a.progress.reset();
					// The native run ended and the loop waits for this child's own children: wake it for steering.
					const parked = run.parked && !a.session.agent.state.isStreaming;
					run.parked?.abort();
					return ok(`${name}#${a.id}: ${parked ? "sent" : "queued after the current tool call"}`);
				}
				await startRun(a, params.task, signal, { communication: true });
				signal.throwIfAborted();
				a.guard.signal = (a.run as unknown as Agent["run"])?.controller.signal;
				return ok(`${name}#${a.id}: sent`);
			}
			case "interrupt": {
				const a = find(params.id);
				const snapshot = target(a).snapshot(8);
				const run = a.run;
				a.next = undefined; // an interrupt drops tasks still waiting for the stopping run
				const pending = a.sends.length > 0;
				a.sends = [];
				// An interrupt is the caller's abort of the child: its background jobs die too, also when it is idle.
				if (!run) {
					if (recoveryPending.delete(a.id)) {
						// A child waiting for its recovery is paused by hand: it is not resumed, and restored waits on it wake.
						coordinator.change(`${name}#${a.id}`, "interrupt");
						a.state = "paused"; persist(a); coordinator.add(target(a));
					} else if (pending) persist(a);
					a.children?.abortAll(); a.jobs?.abortAll(); touch([`${name}#${a.id}`]); return ok(`${name}#${a.id} is idle`); }
				requestInterrupt(a, run);
				return waitResult({ id: `${name}#${a.id}`, reason: "interruption_requested", cancellation_requested: true, snapshot });
			}
			case "stop": {
				const id = localNumber(params.id);
				const stopped = id === undefined ? undefined : savedSlots.get(id) ?? recoveryErrors.get(id)?.data;
				if (id !== undefined && !agents.has(id) && stopped) {
					const data = { ...stopped, state: "stopped" as const, pending_sends: undefined };
					pi.appendEntry(CHILD_ENTRY, data);
					branchIndex?.saved.set(id, data);
					savedSlots.delete(id);
					recoveryErrors.delete(id); recoveryPending.delete(id);
					coordinator.change(`${name}#${id}`, "stop");
					return ok(`${name}#${id} stopped`);
				}
				const a = find(params.id);
				recoveryErrors.delete(a.id);
				a.state = "stopped"; a.sends = []; persist(a);
				agents.delete(a.id);
				onRunning();
				coordinator.change(`${name}#${a.id}`, "stop");
				close(a);
				return ok(`${name}#${a.id} stopped`);
			}
			case "restart": {
				const old = lostFork ? undefined : find(params.id);
				const savedConfigValue = lostFork ? savedConfig(lostFork) : undefined;
				const model = savedConfigValue && (params.model ? modelFor(params.model, ctx) : ctx.modelRegistry.find(savedConfigValue.model.provider, savedConfigValue.model.id));
				if (savedConfigValue && !model) throw new Error(`Cannot restart ${name}#${lostFork!.id}: model ${savedConfigValue.model.provider}/${savedConfigValue.model.id} is unavailable`);
				const previous = old?.config ?? { ...savedConfigValue!, model: model! };
				const config = await resolveConfig(params, ctx, signal, previous);
				signal.throwIfAborted();
				const id = old?.id ?? lostFork!.id;
				if (old) { old.state = "stopped"; old.sends = []; persist(old); agents.delete(id); }
				else {
					const stopped = { ...lostFork!, state: "stopped" as const, pending_sends: undefined };
					pi.appendEntry(CHILD_ENTRY, stopped); branchIndex?.saved.set(id, stopped);
					savedSlots.delete(id); recoveryErrors.delete(id); recoveryPending.delete(id);
				}
				onRunning();
				coordinator.change(`${name}#${id}`, "restart");
				if (old) close(old);
				const fast = { on: params.fast_gpt ?? old?.fast.on ?? lostFork!.fast };
				config.settings = childSettings(pi.getSettings());
				config.builtins = BUILTIN_TOOLS.filter(name => pi.getActiveTools().includes(name));
				const manager = createChildManager(ctx.sessionManager, ctx.cwd, name, id);
				const child = await createSession(config, ctx, signal, fast, labelOf(id), `${name}#${id}`, manager);
				const title = given(params.title) ? params.title.trim() : old?.title ?? lostFork?.title;
				const a: Agent = { id, config, epoch: randomUUID(), runNumber: 0, state: "idle", fast, sends: [], ...(title ? { title } : {}), ...child };
				agents.set(a.id, a);
				persist(a);
				try {
					signal.throwIfAborted();
					a.captureRun(ctx.sessionManager.getSessionId());
					if (params.task) await startRun(a, task!, signal);
					else coordinator.add(target(a));
					signal.throwIfAborted();
					a.guard.signal = a.run?.controller.signal;
					agents.set(a.id, a);
					onRunning();
				} catch (error) { agents.delete(a.id); a.state = "stopped"; a.sends = []; persist(a); coordinator.change(`${name}#${a.id}`, "canceled_restart"); close(a); throw error; }
				return ok(`${name}#${a.id} restarted${params.task ? "" : ", idle"}`);
			}
			default: throw new Error(`Unknown action: ${params.action}`);
		}
	}

	pi.on("before_agent_start", async (_event, ctx) => {
		payloads.bind(ctx);
		main = ctx;
		await refreshProfiles(ctx);
		await resumeAll(ctx.signal ?? new AbortController().signal, true);
	});
	pi.on("session_start", async (_event, ctx) => {
		payloads.bind(ctx);
		main = ctx;
		counter = Math.max(counter, lastNumber(ctx.sessionManager.getEntries(), name));
		await refreshProfiles(ctx);
	});
	pi.on("session_tree", (_event, ctx) => {
		payloads.clear();
		generation.abort(new Error("The caller changed its session branch"));
		generation = new AbortController();
		for (const a of agents.values()) { coordinator.change(`${name}#${a.id}`, "branch_changed"); close(a); }
		for (const id of [...savedSlots.keys(), ...recoveryErrors.keys()]) coordinator.change(`${name}#${id}`, "branch_changed");
		agents.clear(); savedSlots.clear(); restoring.clear(); recoveryPending.clear(); recoveryErrors.clear(); hydrated = false; branchIndex = undefined; bases = undefined; restoredWaits.clear(); main = ctx;
		late.length = 0; unanswered.clear();
	});
	// agent_end still has the native run's live abort signal. before_settle no longer does.
	pi.on("agent_end", (_event, ctx) => {
		settling = true;
		settlingSignal?.removeEventListener("abort", markAborted);
		settlingSignal = ctx.signal;
		if (settlingSignal?.aborted) mainAborted = true;
		else settlingSignal?.addEventListener("abort", markAborted, { once: true });
	});
	pi.on("agent_before_settle", (_event, ctx) => {
		// Results held since agent_end must reach this boundary before it decides to continue.
		for (const result of late.splice(0)) {
			if (!coordinator.message(result)) continue;
			unanswered.add(result.delivery);
			send(resultMessage(result), { triggerTurn: false });
			coordinator.releaseMessage(result);
		}
		if (!mainAborted && needsTurn(ctx)) return { continue: true };
		settling = true;
	});
	pi.on("agent_start", () => { mainAborted = false; });
	pi.on("turn_start", () => { settling = false; });
	pi.on("agent_settled", (event) => {
		settlingSignal?.removeEventListener("abort", markAborted);
		settlingSignal = undefined;
		mainAborted = event.aborted;
		settling = false;
		const held = late.splice(0).filter(result => coordinator.message(result));
		held.forEach((result, i) => {
			send(resultMessage(result), { triggerTurn: !event.aborted && i === held.length - 1 });
			coordinator.releaseMessage(result);
		});
	});
	const runs = () => [...agents.values()].flatMap((a) => (a.run ? [a.run.done] : []));
	const abortAll = () => {
		// Fence queued/preflight starts as well as accepted children, but allow later assignments.
		generation.abort(new Error("The caller interrupted its children"));
		generation = new AbortController();
		for (const a of agents.values()) {
			if (a.state !== "paused" && (a.run || a.state === "running")) a.state = "interrupted";
			persist(a);
			coordinator.change(`${name}#${a.id}`, "shutdown"); close(a);
		}
		for (const id of savedSlots.keys()) coordinator.change(`${name}#${id}`, "shutdown");
		agents.clear();
		savedSlots.clear(); restoring.clear();
		hydrated = false;
		branchIndex = undefined;
		onRunning();
		late.length = 0;
		unanswered.clear();
	};
	const shutdown = () => {
		payloads.close();
		lifetime.abort(new Error("The caller session is shutting down"));
		abortAll();
		for (const run of ownRuns) displays.delete(run);
		ownRuns.clear();
	};
	pi.on("session_shutdown", shutdown);
	// Pi's switch (/new, /resume) and /fork run session_shutdown, which would abort the running children: refuse until they end.
	const blockSwitch = (_event: unknown, ctx: ExtensionContext) => {
		if (!runningCounts().agents) return undefined;
		ctx.ui.notify("дождись сабагентов", "warning");
		return { cancel: true };
	};
	pi.on("session_before_switch", blockSwitch);
	pi.on("session_before_fork", blockSwitch);
	// Delivery and queue settlement can remove a blocker after the idle deadline.
	const queueAll = () => {
		for (const a of agents.values()) queueSleep(a);
	};
	pi.on("turn_end", queueAll);
	pi.on("agent_settled", queueAll);
	return {
		pending: () => runs().length > 0 || late.some(result => result.state === "pending") || !!(main && needsTurn(main)),
		async wait(signal) {
			const active = runs();
			// Notification subscriptions are not active SDK calls; observe() deliberately yields to them.
			if (active.length) await untilAborted(Promise.all(active).then(() => {}), signal);
			else await coordinator.observe(signal);
		},
		ids: () => [...agents.values()].filter(a => a.run).map(a => `${name}#${a.id}`),
		status: depth => coordinator.status([...new Set([...agents.keys(), ...savedSlots.keys(), ...recoveryErrors.keys()])].map(id => `${name}#${id}`), undefined, undefined, statusDepth(depth)).map(compactStatus),
		async prepareStatus(depth, signal) {
			if (!main) return;
			await hydrate(main, signal);
			for (const id of [...savedSlots.keys()]) await hydrate(main, signal, id);
			touch([...agents.keys()].map(id => `${name}#${id}`));
			if (depth > 0) for (const a of agents.values()) await a.children?.prepareStatus?.(depth - 1, signal);
		},
		runningCounts,
		stopBackground() {
			const count = runningCounts().agents;
			mainAborted = true;
			coordinator.stopBackground();
			for (const a of agents.values()) {
				a.next = undefined;
				if (a.run && !a.run.quiet) requestInterrupt(a, a.run);
				else { a.children?.abortAll(); a.jobs?.abortAll(); }
			}
			return count;
		},
		resume: resumeAll,
		settle(aborted) {
			if (main) coordinator.settleCore(main, aborted);
			settling = false; mainAborted = aborted;
			const held = late.splice(0).filter(result => coordinator.message(result));
			for (const result of held) { send(resultMessage(result), { triggerTurn: !aborted }); coordinator.releaseMessage(result); }
		},
		abortAll,
		close: shutdown,
	};
}
