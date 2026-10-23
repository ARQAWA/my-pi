// Extension 5: asynchronous subagents and fixed-role workers, sharing one session lifecycle implementation.
import { randomUUID } from "node:crypto";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentSessionEvent, ExtensionAPI, ExtensionContext, ModelRuntime, SessionEntry, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { registerWorkers, type RuntimeHandle, sumCounts, type WorkerProfile } from "./workers.ts";
import { Activity } from "./activity.ts";
import { COUNTS_REQUEST, COUNTS_VERSION, type CountsRequest, createCountsProducer, type RunningCounts } from "./counts.ts";
import { fastGpt, inheritedFastGpt } from "./fast-gpt.ts";
import { Coordinator, type Result, waitTimeout, targetIds, messageCount, waitResult } from "./coordinator.ts";

const TOOLS = ["read", "bash", "edit", "write", "grep", "find"] as const;
const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type Thinking = (typeof THINKING)[number];

export const DESCRIPTION = [
	"Run a subagent: you supply its whole system prompt; it has its own model/tools, code_writer and shell_runner, no agent.",
	"Work in parallel while children run. When blocked, estimate their remaining duration and set timeout_ms somewhat longer on each wait; 300000 is only the omitted default, not an interval or maximum.",
	"wait: ids (full IDs, may mix your direct agents and workers), optional timeout_ms; mechanically returns the first result without model turns. Timeout returns status only; children keep running. Re-estimate and wait again if needed.",
	"status: ids, optional messages (5-10, default 8); last trimmed messages and in-flight tool calls. Decide whether to wait, send, interrupt, stop or restart. Do not busy-poll.",
	"Results arrive once, through wait or a later [agent#N] message; already-delivered results give a receipt.",
	"start: system (the whole system prompt), task, optional model (provider/id), thinking, tools; returns agent#N.",
	"send: id, task; reaches a running child after its current tool call, without aborting anything (a child parked in its own wait gets it after that call returns), or starts a new run with its history when idle; interrupt: true on send aborts a running child's turn and starts task as soon as it has stopped.",
	"interrupt: id; requests cancellation, keeps history; inspect status while cancellation is pending. stop: id; closes it.",
	"restart: id, optional task and new system/model/thinking/tools; a fresh session.",
	"Defaults: this session's model and thinking, all tools.",
	"By default children inherit GPT Fast; pass fast_gpt false when the user forbids Fast for subagents.",
].join(" ");

const PARAMETERS = Type.Object({
	action: StringEnum(["start", "wait", "status", "send", "interrupt", "stop", "restart"]),
	id: Type.Optional(Type.String({ description: "agent#N or N; management actions" })),
	ids: Type.Optional(Type.Array(Type.String(), { description: "Full direct child IDs; wait/status may mix agents and workers" })),
	timeout_ms: Type.Optional(Type.Integer({ minimum: 1, description: "Chosen wait duration, slightly longer than estimated remaining work; default 300000 only when omitted" })),
	messages: Type.Optional(Type.Integer({ minimum: 5, maximum: 10, description: "Status peek length; default 8" })),
	system: Type.Optional(Type.String({ description: "Whole system prompt; start, restart" })),
	task: Type.Optional(Type.String({ description: "Message to the subagent" })),
	model: Type.Optional(Type.String({ description: "provider/id" })),
	thinking: Type.Optional(StringEnum(THINKING)),
	tools: Type.Optional(Type.Array(StringEnum(TOOLS), { description: "Base subset; default all. Workers stay available." })),
	fast_gpt: Type.Optional(Type.Boolean({ description: "GPT Fast for this child; default: inherit yours. false when the user forbids Fast for subagents; send and restart may change it" })),
	interrupt: Type.Optional(Type.Boolean({ description: "send only: first interrupt a running child (drops its queued messages, aborts its current turn, keeps history), then start task as soon as it has stopped; a plain send when it is idle" })),
});
type Params = Static<typeof PARAMETERS>;

type Config = { system: string; model: Model<Api>; thinking: Thinking; tools: string[] };
/** Display details of a delivered result: flattened beside delivery and run in a message's details, and under `display` in a wait result. For cards only, never part of the delivered text. */
type Display = { id: string; outcome: "finished" | "failed"; model?: string; thinking?: string; seconds: number };
type Child = { session: AgentSession; controller: AbortController; guard: { signal?: AbortSignal }; workers?: RuntimeHandle; activity: Activity };
type Agent = Child & {
	id: number;
	/** GPT Fast of this child for its life: inherited at start, or the caller's `fast_gpt`. Its own workers inherit it. */
	fast: { on: boolean };
	config: Config;
	epoch: string;
	runNumber: number;
	/** The current run, undefined while idle. `quiet` ends it without a message. */
	run?: { done: Promise<void>; quiet: boolean; controller: AbortController; parked?: AbortController };
	/** Tasks of `send` calls made while an interrupted run is still stopping; they start, in order, once it has. */
	next?: string[];
};

/** The run's own record (startRun), from its assistant message_end events: last executed model and last stop reason. */
export type RunMeta = { model?: string; stop?: string };

/**
 * The display details of a run that ended: its executed model (only an actually executed one, if any), the session's
 * selected thinking (if any), monotonic seconds rounded to 0.1. A final aborted or length stop counts as failed.
 */
export function resultDisplay(id: string, outcome: "completed" | "error", activity: Activity, meta: RunMeta, thinking?: string): Display {
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
 * `{ offer(factory) }` gets a factory of fresh definitions with a barrier of their own. Nothing here imports RQW-tools.
 */
const SUBAGENT_TOOLS = "rqw-tools:subagent-tools";
type ToolsFactory = (cwd: string, settings: () => unknown) => ToolDefinition[];

const isAssistant = (m: { role: string }): m is AssistantMessage => m.role === "assistant";

// The main session's runtime (a plain field of ModelRegistry): same credentials, OAuth refresh and providers.
const runtimeOf = (ctx: ExtensionContext) => (ctx.modelRegistry as unknown as { runtime: ModelRuntime }).runtime;

export default function agent(pi: ExtensionAPI) {
	registerCaller(pi, pi.events, false, true, () => inheritedFastGpt(pi.events));
}

/** `callerFast`: this caller's GPT Fast state at the moment it starts a child (the main chat's, or a child's own). */
function registerCaller(pi: ExtensionAPI, toolEvents: ExtensionAPI["events"], background: boolean, general: boolean, callerFast: () => boolean, refresh: () => void = () => {}): RuntimeHandle {
	const coordinator = new Coordinator(pi);
	// Display details of delivered results, by run, until shutdown (see publishRun).
	const displays = new Map<string, Display>();
	let agentRuntime: RuntimeHandle | undefined;
	// Running counts of the whole tree, offered by the top-level caller only (see counts.ts). Nested callers get its refresh.
	const counts = general ? createCountsProducer(() => sumCounts(runtimes.map(runtime => runtime.runningCounts())), pi.events) : undefined;
	const notify = counts ? () => counts.refresh() : refresh;
	if (general) agentRuntime = registerSessionRuntime(pi, undefined, toolEvents, background, coordinator, callerFast, displays, notify);
	const workers = registerWorkers(pi, (caller, profile) => registerSessionRuntime(caller, profile, toolEvents, background, coordinator, callerFast, displays, notify));
	const runtimes: RuntimeHandle[] = agentRuntime ? [agentRuntime, workers] : [workers];
	if (counts) {
		pi.events.on(COUNTS_REQUEST, (request) => {
			const r = request as CountsRequest;
			if (r?.version === COUNTS_VERSION) counts.reply(r);
		});
		pi.on("session_start", () => counts.start());
		pi.on("session_shutdown", () => counts.stop());
	}
	pi.on("agent_end", async (_event, ctx) => {
		if (!background && (ctx.mode === "print" || ctx.mode === "json") && ctx.signal) {
			try { await coordinator.observe(ctx.signal); } catch (error) { if (!ctx.signal.aborted) throw error; }
		}
	});
	return {
		pending: () => runtimes.some(runtime => runtime.pending()),
		wait: signal => coordinator.observe(signal, undefined, () => runtimes.some(runtime => runtime.pending())),
		ids: () => runtimes.flatMap(runtime => runtime.ids()),
		runningCounts: () => sumCounts(runtimes.map(runtime => runtime.runningCounts())),
		abortAll() { for (const runtime of runtimes) runtime.abortAll(); },
		close() { for (const runtime of runtimes) runtime.close(); },
	};
}

/** Caller-local state. Nested callers settle normally; startRun tracks their workers across background wakeups. */
export function registerSessionRuntime(pi: ExtensionAPI, worker?: WorkerProfile, toolEvents = pi.events, backgroundCaller = false, coordinator = new Coordinator(pi), callerFast: () => boolean = () => inheritedFastGpt(toolEvents), displays = new Map<string, Display>(), onRunning: () => void = () => {}): RuntimeHandle {
	const name = worker?.name ?? "agent";
	const agents = new Map<number, Agent>();
	const lifetime = new AbortController();
	let generation = new AbortController();
	let counter = 0;
	let main: ExtensionContext | undefined;
	let mainAborted = false;
	/** UUIDs survive reload/resume without matching an earlier delivery. */
	const unanswered = new Set<string>();
	let settling = false;
	let settlingSignal: AbortSignal | undefined;
	const markAborted = () => { mainAborted = true; };
	const late: Result[] = [];
	/** Runs whose display details this runtime stored in `displays`; removed at shutdown. */
	const ownRuns = new Set<string>();

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
		if (mainAborted && main?.isIdle() !== false) {
			pi.sendMessage(message, { triggerTurn: false });
			return;
		}
		if (main?.isIdle() !== false) {
			pi.sendMessage(message, { triggerTurn: true });
			return;
		}
		// Busy: keep the result outside Pi's follow-up queue, which Esc clears.
		unanswered.add(message.details.delivery);
		pi.sendMessage(message, { triggerTurn: false });
	}

	// The message details: delivery and run as before, with the run's display fields flattened beside them (display only).
	function resultMessage(result: Result) {
		const display = displays.get(result.run);
		return { customType: name, content: `[${result.id}] ${result.text}`, display: true, details: { delivery: result.delivery, run: result.run, ...display } };
	}

	/**
	 * Stores this run's display details under its unique run before publish, which may reserve the result for a wait
	 * synchronously and skip the push. Both paths look the details up by run; they stay until shutdown (failed-wait fallback).
	 */
	function publishRun(a: Agent, identity: { id: string; run: string }, text: string, outcome: "completed" | "error", meta: RunMeta) {
		displays.set(identity.run, displayOf(a, identity.id, outcome, meta));
		ownRuns.add(identity.run);
		coordinator.publish(identity.id, identity.run, text, outcome, deliver);
	}

	/** The display details of a run that ended, from its activity and this session's selected thinking. */
	function displayOf(a: Agent, id: string, outcome: "completed" | "error", meta: RunMeta): Display {
		return resultDisplay(id, outcome, a.activity, meta, a.session.thinkingLevel);
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

	/** Running children of this runtime by kind, plus those of their nested callers. Native activity only; pending results count zero. */
	function runningCounts(): RunningCounts {
		let total: RunningCounts = { agents: 0, workers: 0, reviews: 0 };
		for (const a of agents.values()) {
			if (a.activity.isRunning()) total = sumCounts([total, { agents: worker ? 0 : 1, workers: worker ? 1 : 0, reviews: 0 }]);
			if (a.workers) total = sumCounts([total, a.workers.runningCounts()]);
		}
		return total;
	}

	function target(a: Agent) {
		return { id: `${name}#${a.id}`, run: `${a.epoch}:${a.runNumber}`,
			// A queued `send` task is about to start: wait must not see an idle child in between.
			active: () => !!a.run || !!a.next?.length,
			checkpoint: () => a.activity.checkpoint(),
			snapshot: (messages?: number, checkpoint?: Map<string, number>) => ({ ...a.activity.snapshot(messages, checkpoint),
				...(a.run?.quiet ? { cancellation_requested: true } : {}),
				...(a.next?.length ? { pending_sends: a.next.length } : {}),
				...(a.workers?.pending() ? { pending_children: a.workers.ids() } : {}) }),
		};
	}

	/** Whether a result sent while busy still waits for a main turn; drops the ones the model already saw. */
	function needsTurn(ctx: ExtensionContext): boolean {
		const entries = ctx.sessionManager.getEntries();
		const branch = ctx.sessionManager.getBranch();
		const lastAnswer = branch.findLastIndex((e) => e.type === "message" && e.message.role === "assistant");
		const isResult = (n: string) => (e: (typeof entries)[number]) =>
			e.type === "custom_message" && e.customType === name && (e.details as { delivery?: unknown } | undefined)?.delivery === n;
		for (const n of unanswered) {
			if (!entries.some(isResult(n))) continue; // still held by Pi until the turn ends
			const at = branch.findIndex(isResult(n));
			if (at < 0 || at < lastAnswer) unanswered.delete(n); // on another branch, or answered
		}
		return unanswered.size > 0;
	}

	/** RQW-tools definitions for one subagent session when RQW-tools is loaded; none (Pi's stock tools) otherwise. */
	function offeredTools(cwd: string, names: string[]): ToolDefinition[] {
		let factory = undefined as ToolsFactory | undefined;
		// Pi's event bus calls every handler synchronously inside emit, so an offer is in place when emit returns.
		toolEvents.emit(SUBAGENT_TOOLS, {
			offer: (f: ToolsFactory) => {
				factory = f;
			},
		});
		return factory ? factory(cwd, () => pi.getSettings()).filter((d) => names.includes(d.name)) : [];
	}

	async function createSession(config: Config, ctx: ExtensionContext, signal: AbortSignal, fast: { on: boolean }): Promise<Child> {
		signal.throwIfAborted();
		const controller = new AbortController();
		const guard: Child["guard"] = {};
		const check = () => { controller.signal.throwIfAborted(); guard.signal?.throwIfAborted(); };
		const own = pi.getSettings();
		let workers: RuntimeHandle | undefined;
		// Keep the main session's shell, including Git Bash on Windows, and read image settings.
		const settingsManager = SettingsManager.inMemory({
			cacheWarming: "off",
			shellPath: own.shellPath,
			shellCommandPrefix: own.shellCommandPrefix,
			images: { autoResize: own.images?.autoResize },
		});
		const resourceLoader = new DefaultResourceLoader({
			cwd: ctx.cwd, agentDir: getAgentDir(), settingsManager,
			noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			systemPromptOverride: () => config.system,
			appendSystemPromptOverride: () => [],
			// Only a forced prompt avoids Pi's appended sections, such as <cwd>.
			extensionFactories: [(sub: ExtensionAPI) => {
				fastGpt(sub, () => fast.on);
				sub.on("before_agent_start", () => {
					check();
					return { systemPrompt: config.system };
				});
				if (worker) worker.configure(sub);
				else workers = registerCaller(sub, toolEvents, true, false, () => fast.on, onRunning);
			}],
		});
		await untilAborted(resourceLoader.reload(), signal);
		const customTools = offeredTools(ctx.cwd, config.tools);
		signal.throwIfAborted();
		const creating = createAgentSession({
			cwd: ctx.cwd, modelRuntime: runtimeOf(ctx), model: config.model, thinkingLevel: config.thinking,
			tools: worker ? config.tools : [...config.tools, "code_writer", "shell_runner"], customTools, resourceLoader,
			sessionManager: SessionManager.inMemory(ctx.cwd), settingsManager,
		}).then(({ session }) => {
			if (signal.aborted) { session.dispose(); signal.throwIfAborted(); }
			// prompt() may finish auth after abort()/dispose(). Never let an abandoned preflight reach inference.
			const stream = session.agent.streamFunction;
			session.agent.streamFunction = (model, context, options) => {
				check();
				// Child Anthropic requests use the built-in 5m tier, before any adapter's OAuth fallback.
				return stream(model, context, model.api === "anthropic-messages" ? { ...options, cacheRetention: "short" } : options);
			};
			return { session, controller, guard, workers, activity: new Activity(session, onRunning) };
		});
		try {
			return await untilAborted(creating, signal);
		} catch (error) {
			controller.abort();
			void creating.then(({ session }) => session.dispose()).catch(() => {});
			throw error;
		}
	}

	/** Wait only for an active SDK run, not its answer. Caller cancellation ends only an unaccepted run. */
	async function startRun(a: Agent, task: string, signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		const started = Promise.withResolvers<void>();
		const session = a.session;
		a.runNumber++;
		a.activity.startRun();
		const identity = target(a);
		coordinator.begin(identity);
		const texts: string[] = [];
		// This logical run's record: fresh here, updated by every assistant message_end below, retries and wakeups included.
		const meta: RunMeta = {};
		let lastPushed = 0;
		let nativeRunStart = 0;
		let workerRunStart: number | undefined;
		const run: NonNullable<Agent["run"]> = { done: Promise.resolve(), quiet: false, controller: new AbortController() };
		a.guard.signal = AbortSignal.any([run.controller.signal, signal]);
		const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "agent_start") {
				// Multiple background wakeups may be deferred at settlement. Keep only their final native run's answer.
				if (workerRunStart !== undefined) { texts.splice(workerRunStart); lastPushed = 0; }
				nativeRunStart = texts.length;
			}
			if (event.type === "agent_end" && a.workers?.pending()) {
				// This native run ended before all delegated results were consumed. It is not a final answer to main.
				workerRunStart ??= nativeRunStart;
				texts.splice(nativeRunStart);
				lastPushed = 0;
			}
			if (event.type === "compaction_start") {
				// A late prompt preflight may enter compaction after cancellation; stop its summary too.
				if (a.guard.signal?.aborted || a.controller.signal.aborted) void session.abort().catch(() => {});
				started.resolve();
			}
			if (event.type === "auto_retry_start" || (event.type === "compaction_end" && event.willRetry)) {
				if (lastPushed) texts.splice(texts.length - lastPushed, lastPushed);
				lastPushed = 0;
			}
			if (event.type === "compaction_end" && !event.willRetry && event.errorMessage) {
				texts.push(`error: ${event.errorMessage}`);
				lastPushed = 0;
			}
			if (event.type !== "message_end" || !isAssistant(event.message)) return;
			const m = event.message;
			recordRunMessage(meta, m);
			lastPushed = 0;
			if (m.stopReason === "error") {
				texts.push(`error: ${m.errorMessage ?? "unknown error"}`);
				lastPushed = 1;
			} else if (m.stopReason === "stop" || m.stopReason === "length") {
				const text = textOf(m);
				if (text) { texts.push(text); lastPushed++; }
				if (m.stopReason === "length") {
					texts.push("error: Response was truncated: the model reached its output token limit.");
					lastPushed++;
				}
			}
		});
		run.done = (async () => {
			try {
				await session.prompt(task, { preflightResult: () => started.resolve() });
				while (!run.quiet && !a.guard.signal?.aborted) {
					const signal = a.guard.signal ?? a.controller.signal;
					// A worker may have woken a new native run after the original prompt settled.
					await untilAborted(session.waitForIdle(), signal);
					// A steering message that missed the agent loop's last poll waits here like a follow-up.
					if (session.getSteeringMessages().length > 0 || session.getFollowUpMessages().length > 0) {
						const queued = session.clearQueue();
						await session.prompt([...queued.steering, ...queued.followUp].join("\n\n"));
					}
					else if (a.workers?.pending()) {
						// Parked until a worker result: `send` aborts `parked` so a steering message is delivered at once.
						const park = run.parked = new AbortController();
						const parkedSignal = AbortSignal.any([signal, park.signal]);
						try { await untilAborted(a.workers.wait(parkedSignal), parkedSignal); }
						catch (error) { if (!park.signal.aborted || signal.aborted) throw error; }
						finally { run.parked = undefined; }
					}
					else break;
				}
				if (!run.quiet && !a.guard.signal?.aborted) {
					const outcome = texts.some(t => t.startsWith("error:")) ? "error" : "completed";
					publishRun(a, identity, texts.join("\n\n") || "(no text)", outcome, meta);
				}
			} catch (error) {
				if (!run.quiet && !a.guard.signal?.aborted) {
					texts.push(`error: ${error instanceof Error ? error.message : String(error)}`);
					publishRun(a, identity, texts.join("\n\n"), "error", meta);
				}
			} finally {
				unsubscribe();
				started.resolve();
				// The abort can end this loop while a worker-woken native run still streams (a tool ignoring abort):
				// Pi would reject a new prompt then, so pending sends wait for it. This run stays current meanwhile.
				if (a.run === run && a.next?.length && !a.controller.signal.aborted) await session.waitForIdle().catch(() => {});
				if (a.run === run) {
					a.activity.endRun(run.quiet ? "interrupted" : texts.some(t => t.startsWith("error:")) ? "error" : "completed");
					// `send` with `interrupt` (and sends after it) made while this run was stopping: start them now, once.
					// a.next keeps the child active until startRun has set the new a.run (synchronously), so wait and
					// the caller's fallback never see it idle in between.
					a.run = undefined;
					onRunning();
					const next = a.next;
					if (next?.length && !a.controller.signal.aborted)
						void startRun(a, next.join("\n\n"), a.controller.signal).then(() => { a.guard.signal = a.run?.controller.signal; }, () => {});
					a.next = undefined;
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
			throw error;
		}
	}

	function close(a: Agent) {
		a.next = undefined;
		if (a.run) { a.run.quiet = true; a.run.controller.abort(); }
		a.controller.abort();
		a.activity.close();
		a.workers?.close();
		a.session.clearQueue();
		// abort first: dispose alone does not set Pi's abort flag for queued follow-ups or compaction.
		void a.session.abort().catch(() => {}).finally(() => a.session.dispose());
		onRunning();
	}

	/** Request cancellation of the current run: the shared body of `interrupt` and `send` with `interrupt: true`. */
	function requestInterrupt(a: Agent, run: NonNullable<Agent["run"]>) {
		a.workers?.abortAll();
		coordinator.change(`${name}#${a.id}`, "interrupt");
		run.quiet = true;
		run.controller.abort();
		a.session.clearQueue();
		void a.session.abort().catch(() => {});
		coordinator.add(target(a));
	}

	function find(id: string | undefined): Agent {
		const local = id?.startsWith(`${name}#`) ? id.slice(name.length + 1) : id;
		const a = local && (!worker || id?.startsWith(`${name}#`)) && /^[1-9]\d*$/.test(local) && Number.isSafeInteger(Number(local)) ? agents.get(Number(local)) : undefined;
		if (a) return a;
		const known = [...agents.keys()].map((k) => `${name}#${k}`).join(", ") || "none";
		throw new Error(`Unknown ${name} id: ${id ?? "(none)"}. Known: ${known}`);
	}

	async function resolveConfig(params: Params, ctx: ExtensionContext, signal: AbortSignal, base?: Config): Promise<Config> {
		signal.throwIfAborted();
		if (worker) {
			const selected = await untilAborted(worker.resolve(ctx), signal);
			return { system: worker.system, tools: [...worker.tools], ...selected };
		}
		const system = params.system ?? base?.system;
		if (!system) throw new Error("system is required");
		let model: Model<Api> | undefined = base?.model ?? ctx.model;
		if (params.model) {
			const slash = params.model.indexOf("/");
			model = slash > 0 ? ctx.modelRegistry.find(params.model.slice(0, slash), params.model.slice(slash + 1)) : undefined;
			if (!model) throw new Error(`Unknown model: ${params.model}. Use provider/id from the model registry.`);
		}
		if (!model) throw new Error("No model: give model as provider/id");
		if (!ctx.modelRegistry.hasConfiguredAuth(model) && !(await untilAborted(runtimeOf(ctx).checkAuth(model.provider, { signal }), signal)))
			throw new Error(`No credentials for provider ${model.provider}`);
		signal.throwIfAborted();
		const tools = params.tools ?? base?.tools ?? [...TOOLS];
		const thinking = params.thinking ?? base?.thinking ?? pi.getThinkingLevel();
		return { system, model, thinking, tools };
	}

	const ok = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });
	pi.registerTool({
		name,
		label: worker?.name ?? "Agent",
		description: worker?.description ?? DESCRIPTION,
		parameters: worker ? Type.Object({
			action: Type.Optional(StringEnum(["start", "wait", "status", "send", "interrupt", "stop", "restart"])),
			task: Type.Optional(Type.String({ minLength: 1 })),
			id: Type.Optional(Type.String({ description: `${name}#N; management actions` })), ids: PARAMETERS.properties.ids,
			timeout_ms: PARAMETERS.properties.timeout_ms, messages: PARAMETERS.properties.messages,
			fast_gpt: PARAMETERS.properties.fast_gpt, interrupt: PARAMETERS.properties.interrupt,
		}) : PARAMETERS,
		execute: (toolCallId, raw, callerSignal, _onUpdate, ctx) => {
			// Capture ctx.signal now: its getter can point at another run when the internal queue drains.
			const signal = AbortSignal.any([lifetime.signal, generation.signal, callerSignal, ctx.signal].filter((s): s is AbortSignal => !!s));
			if (!main) { main = ctx; counter = Math.max(counter, lastNumber(ctx.sessionManager.getEntries(), name)); }
			const params = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null)) as Params;
			if (worker) params.action ??= "start";
			// Queue only registration/snapshot, never the waiting Promise or a tool that ignores abort.
			if (params.action === "wait") {
				const registration = coordinator.queue.then(() => {
					signal.throwIfAborted();
					return { waiting: coordinator.wait(targetIds(params.ids), waitTimeout(params.timeout_ms), signal, toolCallId) };
				});
				coordinator.queue = registration.catch(() => {});
				return registration.then(({ waiting }) => waiting).then(withDisplays);
			}
			const next = coordinator.queue.then(() => { signal.throwIfAborted(); return act(params, ctx, signal); });
			coordinator.queue = next.catch(() => {});
			return untilAborted(next, signal);
		},
	});

	async function act(raw: Params, ctx: ExtensionContext, signal: AbortSignal) {
		// Strict-mode providers send null for omitted optional fields.
		const params = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null)) as Params;
		signal.throwIfAborted();
		switch (params.action) {
			case "status": return waitResult({ statuses: coordinator.status(targetIds(params.ids), messageCount(params.messages)) });
			case "start": {
				if (!params.task) throw new Error("task is required");
				const config = await resolveConfig(params, ctx, signal);
				signal.throwIfAborted();
				if (counter >= Number.MAX_SAFE_INTEGER) throw new Error("Agent id space exhausted");
				const id = ++counter;
				pi.appendEntry(name, { id });
				const fast = { on: params.fast_gpt ?? callerFast() };
				const child = await createSession(config, ctx, signal, fast);
				const a: Agent = { id, config, epoch: randomUUID(), runNumber: 0, fast, ...child };
				try {
					signal.throwIfAborted();
					await startRun(a, params.task, signal);
					signal.throwIfAborted();
					a.guard.signal = a.run?.controller.signal;
					agents.set(id, a);
					onRunning();
				} catch (error) { coordinator.change(`${name}#${id}`, "canceled_start"); close(a); throw error; }
				return ok(`${name}#${id} started`);
			}
			case "send": {
				const a = find(params.id);
				if (!params.task) throw new Error("task is required");
				if (a.run?.quiet && !params.interrupt && !a.next) throw new Error(`${name}#${a.id}: cancellation pending; inspect status before send`);
				if (params.fast_gpt !== undefined) a.fast.on = params.fast_gpt;
				if (a.run && (params.interrupt || a.run.quiet)) {
					// Abort now like `interrupt` and return at once: the task starts when the old run has stopped (the
					// finally of its run), after any earlier pending sends. No time limit: an uncooperative tool just delays it.
					if (!a.run.quiet) requestInterrupt(a, a.run);
					(a.next ??= []).push(params.task);
					return ok(`${name}#${a.id}: ${params.interrupt ? "interrupted, sent" : "sent"}`);
				}
				if (a.run) {
					// Steering: delivered after the child's current tool call, before its next request; nothing is aborted.
					const run = a.run;
					await untilAborted(a.session.steer(params.task), signal);
					// The native run ended and the loop waits for this child's own workers: nothing polls the queue, so wake it.
					const parked = run.parked && !a.session.isStreaming;
					run.parked?.abort();
					return ok(`${name}#${a.id}: ${parked ? "sent" : "queued after the current tool call"}`);
				}
				await startRun(a, params.task, signal);
				signal.throwIfAborted();
				a.guard.signal = a.run?.controller.signal;
				return ok(`${name}#${a.id}: sent`);
			}
			case "interrupt": {
				const a = find(params.id);
				const snapshot = target(a).snapshot(8);
				const run = a.run;
				a.next = undefined; // an interrupt drops tasks still waiting for the stopping run
				if (!run) { a.workers?.abortAll(); return ok(`${name}#${a.id} is idle`); }
				requestInterrupt(a, run);
				return waitResult({ id: `${name}#${a.id}`, reason: "interruption_requested", cancellation_requested: true, snapshot });
			}
			case "stop": {
				const a = find(params.id);
				agents.delete(a.id);
				onRunning();
				coordinator.change(`${name}#${a.id}`, "stop");
				close(a);
				return ok(`${name}#${a.id} stopped`);
			}
			case "restart": {
				const old = find(params.id);
				const config = await resolveConfig(params, ctx, signal, old.config);
				signal.throwIfAborted();
				agents.delete(old.id);
				onRunning();
				coordinator.change(`${name}#${old.id}`, "restart");
				close(old);
				const fast = { on: params.fast_gpt ?? old.fast.on };
				const child = await createSession(config, ctx, signal, fast);
				const a: Agent = { id: old.id, config, epoch: randomUUID(), runNumber: 0, fast, ...child };
				try {
					signal.throwIfAborted();
					if (params.task) await startRun(a, params.task, signal);
					else coordinator.add(target(a));
					signal.throwIfAborted();
					a.guard.signal = a.run?.controller.signal;
					agents.set(a.id, a);
					onRunning();
				} catch (error) { coordinator.change(`${name}#${a.id}`, "canceled_restart"); close(a); throw error; }
				return ok(`${name}#${a.id} restarted${params.task ? "" : ", idle"}`);
			}
			default: throw new Error(`Unknown action: ${params.action}`);
		}
	}

	pi.on("session_start", (_event, ctx) => {
		main = ctx;
		counter = Math.max(counter, lastNumber(ctx.sessionManager.getEntries(), name));
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
			pi.sendMessage(resultMessage(result), { triggerTurn: false });
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
			pi.sendMessage(resultMessage(result), { triggerTurn: !event.aborted && i === held.length - 1 });
			coordinator.releaseMessage(result);
		});
	});
	const runs = () => [...agents.values()].flatMap((a) => (a.run ? [a.run.done] : []));
	const abortAll = () => {
		// Fence queued/preflight starts as well as accepted children, but allow later assignments.
		generation.abort(new Error("The caller interrupted its children"));
		generation = new AbortController();
		for (const a of agents.values()) { coordinator.change(`${name}#${a.id}`, "shutdown"); close(a); }
		agents.clear();
		onRunning();
		late.length = 0;
		unanswered.clear();
	};
	const shutdown = () => {
		lifetime.abort(new Error("The caller session is shutting down"));
		abortAll();
		for (const run of ownRuns) displays.delete(run);
		ownRuns.clear();
	};
	pi.on("session_shutdown", shutdown);
	return {
		pending: () => runs().length > 0 || late.some(result => result.state === "pending") || !!(main && needsTurn(main)),
		wait: signal => coordinator.observe(signal),
		ids: () => [...agents.values()].filter(a => a.run).map(a => `${name}#${a.id}`),
		runningCounts,
		abortAll,
		close: shutdown,
	};
}
