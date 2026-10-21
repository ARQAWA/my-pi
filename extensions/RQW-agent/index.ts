// Extension 5: one tool `agent` that runs subagents as in-process Pi sessions. The main agent writes the whole system
// prompt and picks model, thinking and tools; the subagent's answer comes back later as a message `[agent#N] ...`.
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

const TOOLS = ["read", "bash", "edit", "write", "grep", "find"] as const;
const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type Thinking = (typeof THINKING)[number];

export const DESCRIPTION = [
	"Run a subagent: a separate session with its own model and tools, no system prompt of its own and no agent tool.",
	"Its answer arrives later as a message [agent#N] ...; do not wait or poll.",
	"start: system (the whole system prompt), task, optional model (provider/id), thinking, tools; returns agent#N.",
	"send: id, task; queued after the current run, or a new run with its history when idle.",
	"interrupt: id; stops the run, keeps history. stop: id; ends it.",
	"restart: id, optional task and new system/model/thinking/tools; a fresh session.",
	"Defaults: this session's model and thinking, all tools.",
].join(" ");

const PARAMETERS = Type.Object({
	action: StringEnum(["start", "send", "interrupt", "stop", "restart"]),
	id: Type.Optional(Type.String({ description: "agent#N or N; all actions but start" })),
	system: Type.Optional(Type.String({ description: "Whole system prompt; start, restart" })),
	task: Type.Optional(Type.String({ description: "Message to the subagent" })),
	model: Type.Optional(Type.String({ description: "provider/id" })),
	thinking: Type.Optional(StringEnum(THINKING)),
	tools: Type.Optional(Type.Array(StringEnum(TOOLS), { description: "Subset; default all" })),
});
type Params = Static<typeof PARAMETERS>;

type Config = { system: string; model: Model<Api>; thinking: Thinking; tools: string[] };
type Child = { session: AgentSession; controller: AbortController; guard: { signal?: AbortSignal } };
type Agent = Child & {
	id: number;
	config: Config;
	/** The current run, undefined while idle. `quiet` ends it without a message. */
	run?: { done: Promise<void>; quiet: boolean; controller: AbortController };
};

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
function lastNumber(entries: readonly SessionEntry[]): number {
	let max = 0;
	const take = (n: unknown) => {
		if (typeof n === "number" && Number.isSafeInteger(n) && n > 0) max = Math.max(max, n);
	};
	for (const e of entries) {
		if (e.type === "custom" && e.customType === "agent") take((e.data as { id?: unknown } | undefined)?.id);
		let match: RegExpExecArray | null = null;
		if (e.type === "custom_message" && e.customType === "agent" && typeof e.content === "string")
			match = /^\[agent#(\d+)\](?:\s|$)/.exec(e.content);
		else if (e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "agent") {
			const text = e.message.content.map((c) => c.type === "text" ? c.text : "").join("");
			match = /^agent#(\d+)(?: started| restarted| stopped| interrupted| is idle|: sent|: queued after the current run)(?:$|[\s,])/.exec(text);
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
	const agents = new Map<number, Agent>();
	const lifetime = new AbortController();
	let counter = 0;
	let main: ExtensionContext | undefined;
	let mainAborted = false;
	/** UUIDs survive reload/resume without matching an earlier delivery. */
	const unanswered = new Set<string>();
	let settling = false;
	const late: { customType: string; content: string; display: boolean; details: { delivery: string } }[] = [];

	function deliver(id: number, text: string) {
		if (lifetime.signal.aborted) return;
		const message = { customType: "agent", content: `[agent#${id}] ${text}`, display: true, details: { delivery: randomUUID() } };
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
			pi.sendMessage(message, { triggerTurn: true });
			return;
		}
		// Busy: keep the result outside Pi's follow-up queue, which Esc clears.
		unanswered.add(message.details.delivery);
		pi.sendMessage(message, { triggerTurn: false });
	}

	/** Whether a result sent while busy still waits for a main turn; drops the ones the model already saw. */
	function needsTurn(ctx: ExtensionContext): boolean {
		const entries = ctx.sessionManager.getEntries();
		const branch = ctx.sessionManager.getBranch();
		const lastAnswer = branch.findLastIndex((e) => e.type === "message" && e.message.role === "assistant");
		const isResult = (n: string) => (e: (typeof entries)[number]) =>
			e.type === "custom_message" && e.customType === "agent" && (e.details as { delivery?: unknown } | undefined)?.delivery === n;
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
		pi.events.emit(SUBAGENT_TOOLS, {
			offer: (f: ToolsFactory) => {
				factory = f;
			},
		});
		return factory ? factory(cwd, () => pi.getSettings()).filter((d) => names.includes(d.name)) : [];
	}

	async function createSession(config: Config, ctx: ExtensionContext, signal: AbortSignal): Promise<Child> {
		signal.throwIfAborted();
		const controller = new AbortController();
		const guard: Child["guard"] = {};
		const check = () => { controller.signal.throwIfAborted(); guard.signal?.throwIfAborted(); };
		const own = pi.getSettings();
		// Keep the main session's shell, including Git Bash on Windows, and read image settings.
		const settingsManager = SettingsManager.inMemory({
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
			extensionFactories: [(sub: ExtensionAPI) => sub.on("before_agent_start", () => {
				check();
				return { systemPrompt: config.system };
			})],
		});
		await untilAborted(resourceLoader.reload(), signal);
		const customTools = offeredTools(ctx.cwd, config.tools);
		signal.throwIfAborted();
		const creating = createAgentSession({
			cwd: ctx.cwd, modelRuntime: runtimeOf(ctx), model: config.model, thinkingLevel: config.thinking,
			tools: config.tools, customTools, resourceLoader,
			sessionManager: SessionManager.inMemory(ctx.cwd), settingsManager,
		}).then(({ session }) => {
			if (signal.aborted) { session.dispose(); signal.throwIfAborted(); }
			// prompt() may finish auth after abort()/dispose(). Never let an abandoned preflight reach inference.
			const stream = session.agent.streamFunction;
			session.agent.streamFunction = (model, context, options) => { check(); return stream(model, context, options); };
			return { session, controller, guard };
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
		const texts: string[] = [];
		let lastPushed = 0;
		const run: NonNullable<Agent["run"]> = { done: Promise.resolve(), quiet: false, controller: new AbortController() };
		a.guard.signal = AbortSignal.any([run.controller.signal, signal]);
		const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
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
				while (!run.quiet && !a.guard.signal?.aborted && session.getFollowUpMessages().length > 0)
					await session.prompt(session.clearQueue().followUp.join("\n\n"));
				if (!run.quiet && !a.guard.signal?.aborted) deliver(a.id, texts.join("\n\n") || "(no text)");
			} catch (error) {
				if (!run.quiet && !a.guard.signal?.aborted) {
					texts.push(`error: ${error instanceof Error ? error.message : String(error)}`);
					deliver(a.id, texts.join("\n\n"));
				}
			} finally {
				unsubscribe();
				started.resolve();
				if (a.run === run) a.run = undefined;
			}
		})();
		a.run = run;
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
		if (a.run) { a.run.quiet = true; a.run.controller.abort(); }
		a.controller.abort();
		a.session.clearQueue();
		// abort first: dispose alone does not set Pi's abort flag for queued follow-ups or compaction.
		void a.session.abort().catch(() => {}).finally(() => a.session.dispose());
	}

	function find(id: string | undefined): Agent {
		const a = agents.get(Number((id ?? "").replace(/^agent#/, "")));
		if (a) return a;
		const known = [...agents.keys()].map((k) => `agent#${k}`).join(", ") || "none";
		throw new Error(`Unknown agent id: ${id ?? "(none)"}. Known: ${known}`);
	}

	async function resolveConfig(params: Params, ctx: ExtensionContext, signal: AbortSignal, base?: Config): Promise<Config> {
		signal.throwIfAborted();
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
	let queue: Promise<unknown> = Promise.resolve();
	pi.registerTool({
		name: "agent",
		label: "Agent",
		description: DESCRIPTION,
		parameters: PARAMETERS,
		execute: (_toolCallId, raw, callerSignal, _onUpdate, ctx) => {
			// Capture ctx.signal now: its getter can point at another run when the internal queue drains.
			const signal = AbortSignal.any([lifetime.signal, callerSignal, ctx.signal].filter((s): s is AbortSignal => !!s));
			if (!main) { main = ctx; counter = Math.max(counter, lastNumber(ctx.sessionManager.getEntries())); }
			const next = queue.then(() => { signal.throwIfAborted(); return act(raw, ctx, signal); });
			queue = next.catch(() => {});
			return untilAborted(next, signal);
		},
	});

	async function act(raw: Params, ctx: ExtensionContext, signal: AbortSignal) {
		// Strict-mode providers send null for omitted optional fields.
		const params = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null)) as Params;
		signal.throwIfAborted();
		switch (params.action) {
			case "start": {
				if (!params.task) throw new Error("task is required");
				const config = await resolveConfig(params, ctx, signal);
				signal.throwIfAborted();
				if (counter >= Number.MAX_SAFE_INTEGER) throw new Error("Agent id space exhausted");
				const id = ++counter;
				pi.appendEntry("agent", { id });
				const child = await createSession(config, ctx, signal);
				const a: Agent = { id, config, ...child };
				try {
					signal.throwIfAborted();
					await startRun(a, params.task, signal);
					signal.throwIfAborted();
					a.guard.signal = a.run?.controller.signal;
					agents.set(id, a);
				} catch (error) { close(a); throw error; }
				return ok(`agent#${id} started`);
			}
			case "send": {
				const a = find(params.id);
				if (!params.task) throw new Error("task is required");
				if (a.run?.quiet) await untilAborted(a.run.done, signal);
				if (a.run) {
					await untilAborted(a.session.followUp(params.task), signal);
					return ok(`agent#${a.id}: queued after the current run`);
				}
				await startRun(a, params.task, signal);
				signal.throwIfAborted();
				a.guard.signal = a.run?.controller.signal;
				return ok(`agent#${a.id}: sent`);
			}
			case "interrupt": {
				const a = find(params.id);
				const run = a.run;
				if (!run) return ok(`agent#${a.id} is idle`);
				run.quiet = true;
				run.controller.abort();
				a.session.clearQueue();
				await untilAborted(a.session.abort(), signal);
				await untilAborted(run.done, signal);
				return ok(`agent#${a.id} interrupted`);
			}
			case "stop": {
				const a = find(params.id);
				agents.delete(a.id);
				close(a);
				return ok(`agent#${a.id} stopped`);
			}
			case "restart": {
				const old = find(params.id);
				const config = await resolveConfig(params, ctx, signal, old.config);
				signal.throwIfAborted();
				agents.delete(old.id);
				close(old);
				const child = await createSession(config, ctx, signal);
				const a: Agent = { id: old.id, config, ...child };
				try {
					signal.throwIfAborted();
					if (params.task) await startRun(a, params.task, signal);
					signal.throwIfAborted();
					a.guard.signal = a.run?.controller.signal;
					agents.set(a.id, a);
				} catch (error) { close(a); throw error; }
				return ok(`agent#${a.id} restarted${params.task ? "" : ", idle"}`);
			}
			default: throw new Error(`Unknown action: ${params.action}`);
		}
	}

	pi.on("session_start", (_event, ctx) => {
		main = ctx;
		counter = Math.max(counter, lastNumber(ctx.sessionManager.getEntries()));
	});
	// agent_end still has the native run's live abort signal. before_settle no longer does.
	pi.on("agent_end", async (_event, ctx) => {
		if (ctx.mode !== "print" && ctx.mode !== "json") return;
		const signal = ctx.signal;
		if (!signal) return;
		try {
			for (let running = runs(); running.length > 0; running = runs()) await untilAborted(Promise.all(running), signal);
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
	pi.on("agent_start", () => { mainAborted = false; });
	pi.on("turn_start", () => { settling = false; });
	pi.on("agent_settled", (event) => {
		mainAborted = event.aborted;
		settling = false;
		const held = late.splice(0);
		held.forEach((message, i) => pi.sendMessage(message, { triggerTurn: !event.aborted && i === held.length - 1 }));
	});
	const runs = () => [...agents.values()].flatMap((a) => (a.run ? [a.run.done] : []));
	pi.on("session_shutdown", () => {
		lifetime.abort(new Error("The main session is shutting down"));
		for (const a of agents.values()) close(a);
		agents.clear();
	});
}
