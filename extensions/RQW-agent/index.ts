// Extension 5: one tool `agent` that runs subagents as in-process Pi sessions. The main agent writes the whole system
// prompt and picks model, thinking and tools; the subagent's answer comes back later as a message `[agent#N] ...`.
import { randomUUID } from "node:crypto";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentSessionEvent, ExtensionAPI, ExtensionContext, ModelRuntime, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import rqwTools from "../RQW-tools/index.ts";

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
type Agent = {
	id: number;
	config: Config;
	session: AgentSession;
	/** The current run, undefined while idle. `quiet` (interrupt, stop, restart, shutdown) ends it without a message. */
	run?: { done: Promise<void>; quiet: boolean };
};

const textOf = (message: AssistantMessage): string =>
	message.content
		.flatMap((c) => (c.type === "text" ? [c.text] : []))
		.join("\n")
		.trim();

const isAssistant = (m: { role: string }): m is AssistantMessage => m.role === "assistant";

// The main session's runtime (a plain field of ModelRegistry): same credentials, OAuth refresh and providers.
const runtimeOf = (ctx: ExtensionContext) => (ctx.modelRegistry as unknown as { runtime: ModelRuntime }).runtime;

export default function agent(pi: ExtensionAPI) {
	const agents = new Map<number, Agent>();
	let counter = 0;
	let closed = false;
	let main: ExtensionContext | undefined;
	/**
	 * Results sent while the main session was busy, by delivery id, until the main model answers after them. The id is
	 * a UUID: a counter would restart in every new instance (/reload, /resume, /fork, `pi -c`) and match old entries.
	 */
	const unanswered = new Set<string>();
	/** Set once our agent_before_settle handler has run; results sent then wait for agent_settled in `late`. */
	let settling = false;
	const late: { customType: string; content: string; display: boolean; details: { delivery: string } }[] = [];

	function deliver(id: number, text: string) {
		if (closed) return;
		const message = { customType: "agent", content: `[agent#${id}] ${text}`, display: true, details: { delivery: randomUUID() } };
		if (settling) {
			late.push(message);
			return;
		}
		if (main?.isIdle() !== false) {
			pi.sendMessage(message, { triggerTurn: true });
			return;
		}
		// Busy: Pi appends a message without triggerTurn to the session at the end of the current turn, so Esc and abort
		// cannot drop it (a follow-up would wait in the agent's queue, which Esc clears). agent_before_settle adds the turn.
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

	/** The subagent's tools: RQW-tools definitions from a fresh instance, so it has its own barrier. */
	function toolDefinitions(names: string[]): ToolDefinition[] {
		const definitions: ToolDefinition[] = [];
		// RQW-tools only calls these three members while loading; bash reads the main session's settings per call.
		const host = { registerTool: (d: ToolDefinition) => definitions.push(d), on() {}, getSettings: () => pi.getSettings() };
		rqwTools(host as unknown as ExtensionAPI);
		return definitions.filter((d) => names.includes(d.name));
	}

	async function createSession(config: Config, ctx: ExtensionContext): Promise<AgentSession> {
		const settingsManager = SettingsManager.inMemory();
		const resourceLoader = new DefaultResourceLoader({
			cwd: ctx.cwd,
			agentDir: getAgentDir(),
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			systemPromptOverride: () => config.system,
			appendSystemPromptOverride: () => [],
			// Pi always appends sections such as <cwd> to a custom prompt; only a forced prompt is sent as is.
			extensionFactories: [(sub: ExtensionAPI) => sub.on("before_agent_start", () => ({ systemPrompt: config.system }))],
		});
		await resourceLoader.reload();
		const { session } = await createAgentSession({
			cwd: ctx.cwd,
			modelRuntime: runtimeOf(ctx),
			model: config.model,
			thinkingLevel: config.thinking,
			tools: config.tools,
			customTools: toolDefinitions(config.tools),
			resourceLoader,
			sessionManager: SessionManager.inMemory(ctx.cwd),
			settingsManager,
		});
		if (closed) {
			session.dispose();
			throw new Error("The main session is shutting down");
		}
		return session;
	}

	/** One run: the task plus any follow-ups queued meanwhile. Ends with one message unless it was made quiet. */
	/** Resolves once Pi has started the run (an abort or dispose then stops its request) or the run has ended. */
	function startRun(a: Agent, task: string): Promise<void> {
		const started = Promise.withResolvers<void>();
		const session = a.session;
		const texts: string[] = [];
		// Every final answer and every final error of the run, in order.
		let lastPushed = false; // whether texts ends with the last assistant message
		const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
			// Pi's run is active from here, so abort() also cancels a pre-run compaction: no need to wait for its summary.
			if (event.type === "compaction_start") started.resolve();
			// Pi repeats the last request after these events (a retry, or overflow compaction): that attempt is not a result.
			if (event.type === "auto_retry_start" || (event.type === "compaction_end" && event.willRetry)) {
				if (lastPushed) texts.pop();
				lastPushed = false;
			}
			if (event.type !== "message_end" || !isAssistant(event.message)) return;
			const m = event.message;
			lastPushed = false;
			if (m.stopReason === "error") {
				texts.push(`error: ${m.errorMessage ?? "unknown error"}`);
				lastPushed = true;
			} else if (m.stopReason === "stop" || m.stopReason === "length") {
				const text = textOf(m);
				if (text) {
					texts.push(text);
					lastPushed = true;
				}
			}
		});
		const run: NonNullable<Agent["run"]> = { done: Promise.resolve(), quiet: false };
		run.done = (async () => {
			try {
				await session.prompt(task, { preflightResult: () => started.resolve() });
				// A follow-up that came in after the run decided to stop is still queued: run it now.
				while (!run.quiet && session.getFollowUpMessages().length > 0) {
					await session.prompt(session.clearQueue().followUp.join("\n\n"));
				}
				if (run.quiet) return;
				deliver(a.id, texts.join("\n\n") || "(no text)");
			} catch (error) {
				if (!run.quiet) deliver(a.id, `error: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				unsubscribe();
				started.resolve();
				if (a.run === run) a.run = undefined;
			}
		})();
		a.run = run;
		return started.promise;
	}

	function close(a: Agent) {
		if (a.run) a.run.quiet = true;
		// dispose() aborts without Pi's abort flag, so Pi would run a queued follow-up on the disposed session.
		a.session.clearQueue();
		// abort() first, so Pi's run sees its abort flag (a pre-run compaction then sends no request), then dispose().
		const session = a.session;
		void session.abort().finally(() => session.dispose());
	}

	function find(id: string | undefined): Agent {
		const a = agents.get(Number((id ?? "").replace(/^agent#/, "")));
		if (a) return a;
		const known = [...agents.keys()].map((k) => `agent#${k}`).join(", ") || "none";
		throw new Error(`Unknown agent id: ${id ?? "(none)"}. Known: ${known}`);
	}

	async function resolveConfig(params: Params, ctx: ExtensionContext, base?: Config): Promise<Config> {
		const system = params.system ?? base?.system;
		if (!system) throw new Error("system is required");
		let model: Model<Api> | undefined = base?.model ?? ctx.model;
		if (params.model) {
			const slash = params.model.indexOf("/");
			model = slash > 0 ? ctx.modelRegistry.find(params.model.slice(0, slash), params.model.slice(slash + 1)) : undefined;
			if (!model) throw new Error(`Unknown model: ${params.model}. Use provider/id from the model registry.`);
		}
		if (!model) throw new Error("No model: give model as provider/id");
		// As Pi's prompt: the auth snapshot fills asynchronously, so a miss there is checked against the store.
		if (!ctx.modelRegistry.hasConfiguredAuth(model) && !(await runtimeOf(ctx).checkAuth(model.provider)))
			throw new Error(`No credentials for provider ${model.provider}`);
		const tools = params.tools ?? base?.tools ?? [...TOOLS];
		const thinking = params.thinking ?? base?.thinking ?? pi.getThinkingLevel();
		return { system, model, thinking, tools };
	}

	const ok = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });

	// Calls of this tool run one at a time in call order, so a batch such as interrupt + restart cannot interleave.
	let queue: Promise<unknown> = Promise.resolve();
	function inOrder<T>(work: () => Promise<T>): Promise<T> {
		const next = queue.then(work);
		queue = next.catch(() => {});
		return next;
	}

	pi.registerTool({
		name: "agent",
		label: "Agent",
		description: DESCRIPTION,
		parameters: PARAMETERS,
		execute: (_toolCallId, raw, _signal, _onUpdate, ctx) => inOrder(() => act(raw, ctx)),
	});

	async function act(raw: Params, ctx: ExtensionContext) {
		// Strict-mode providers send null for omitted optional fields.
		const params = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null)) as Params;
		switch (params.action) {
			case "start": {
				if (!params.task) throw new Error("task is required");
				const config = await resolveConfig(params, ctx);
				const a: Agent = { id: ++counter, config, session: await createSession(config, ctx) };
				agents.set(a.id, a);
				await startRun(a, params.task);
				return ok(`agent#${a.id} started`);
			}
			case "send": {
				const a = find(params.id);
				if (!params.task) throw new Error("task is required");
				if (a.run) {
					await a.session.followUp(params.task);
					return ok(`agent#${a.id}: queued after the current run`);
				}
				await startRun(a, params.task);
				return ok(`agent#${a.id}: sent`);
			}
			case "interrupt": {
				const a = find(params.id);
				const run = a.run;
				if (!run) return ok(`agent#${a.id} is idle`);
				run.quiet = true;
				await a.session.abort();
				await run.done;
				a.session.clearQueue(); // follow-ups of the interrupted run go too
				return ok(`agent#${a.id} interrupted`);
			}
			case "stop": {
				const a = find(params.id);
				agents.delete(a.id);
				close(a);
				return ok(`agent#${a.id} stopped`);
			}
			case "restart": {
				const a = find(params.id);
				const config = await resolveConfig(params, ctx, a.config);
				close(a);
				a.config = config;
				a.session = await createSession(config, ctx);
				a.run = undefined;
				if (params.task) await startRun(a, params.task);
				return ok(`agent#${a.id} restarted${params.task ? "" : ", idle"}`);
			}
			default:
				throw new Error(`Unknown action: ${params.action}`);
		}
	}

	pi.on("session_start", (_event, ctx) => {
		main = ctx;
		// A continued session (/reload, /resume, /fork, `pi -c`) already holds agent#N ids: new ones go above them.
		for (const e of ctx.sessionManager.getEntries()) {
			const text =
				e.type === "custom_message" && e.customType === "agent" && typeof e.content === "string"
					? e.content
					: e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "agent"
						? e.message.content.map((c) => (c.type === "text" ? c.text : "")).join("")
						: "";
			for (const match of text.matchAll(/agent#(\d+)/g)) counter = Math.max(counter, Number(match[1]));
		}
	});

	// Print and JSON modes exit when the main run settles, so there the main run waits for running subagents. A result
	// sent during the run continues it here; an idle main session gets a result as a new turn. After an abort the
	// result stays in the session without a turn, and the model sees it on the next one.
	pi.on("agent_before_settle", async (_event, ctx) => {
		if (ctx.mode === "print" || ctx.mode === "json")
			for (let running = runs(); running.length > 0; running = runs()) await Promise.all(running);
		if (needsTurn(ctx)) return { continue: true };
		settling = true;
	});
	// Another extension's agent_before_settle handler may run after ours, so a result can come in after our check and
	// before the run settles. It is sent here; Pi defers it until the settle ends and then starts its turn.
	pi.on("turn_start", () => {
		settling = false;
	});
	pi.on("agent_settled", (event) => {
		settling = false;
		// One turn for all of them: Pi defers each triggerTurn separately, so the earlier ones are appended at once and
		// only the last one starts the turn.
		const held = late.splice(0);
		held.forEach((message, i) => pi.sendMessage(message, { triggerTurn: !event.aborted && i === held.length - 1 }));
	});
	const runs = () => [...agents.values()].flatMap((a) => (a.run ? [a.run.done] : []));

	pi.on("session_shutdown", () => {
		closed = true;
		for (const a of agents.values()) close(a);
		agents.clear();
	});
}
