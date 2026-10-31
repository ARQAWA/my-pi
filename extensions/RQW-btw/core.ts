// Shared /btw core: freezes what the main model sees now and sends side turns from that mark.
// Nothing here writes to the chat, the session file or the model context of the main session.
import { isContextOverflow, normalizeContext, type Api, type AssistantMessage, type Context, type Message, type Model, type SystemMessage, type ThinkingLevel, type UserMessage } from "@earendil-works/pi-ai";
import { AgentSession, convertToLlm, DEFAULT_COMPACTION_SETTINGS, estimateTokens, type ExtensionAPI, type ExtensionContext, type MessageEndEvent } from "@earendil-works/pi-coding-agent";

export const CONTEXT_FORK = "rqw:context-fork:v1";
export const INSTRUCTION = "Side chat from the user via /btw. Answer only from this conversation. Tools are unavailable: do not call or write tool calls. Do not continue the main task.";

/** The shared fork contract RQW-anthropic and RQW-codex answer; each folder keeps its own copy. */
type ContextForkRequest = {
	sessionId: string;
	model: Model<Api>;
	context: Context;
	reasoning?: ThinkingLevel;
	signal: AbortSignal;
	offer(infer: () => Promise<AssistantMessage>): void;
};
type Snapshot = {
	sessionId: string;
	model: Model<Api>;
	messages: Message[];
	reasoning?: ThinkingLevel;
	after: MessageEndEvent["message"][];
};

/** What the main model saw when the side chat opened. Frozen: later main progress never changes it. */
export type Mark = {
	/** The main session id when the mark is the last main request; the fork can then reuse its cached prefix. */
	sessionId: string | undefined;
	model: Model<Api>;
	reasoning?: ThinkingLevel;
	messages: readonly Message[];
	/** Messages after the sent part, as text for the first question: an unfinished tool call or a cut tail. */
	tail: string;
	/** The prompt and active tools at opening, and the branch leaf then; the overflow retry reads only these. */
	system: SystemMessage;
	leafId: string | null;
};

export type BtwCore = {
	mark(ctx: ExtensionContext): Mark | undefined;
	/** How many leading side turns no longer fit the model window and are not sent. */
	unsent(mark: Mark, turns: readonly Message[]): number;
	/** `turns` are the side chat's own user and assistant messages, ending with the user's newest message. */
	send(ctx: ExtensionContext, mark: Mark, turns: readonly Message[], signal: AbortSignal): Promise<SideAnswer>;
};

/** `short` is true when the answer came from the one shorter retry after a context overflow. */
type SideAnswer = { message: AssistantMessage; short: boolean };

/**
 * Pi 1.4.0 gives extensions no session handle; borrow it for one synchronous call through the prototype getter
 * isIdle, which ctx.isIdle() reads as `this.isIdle`. The exact descriptor is restored in finally.
 */
function sessionOf(ctx: ExtensionContext): AgentSession | undefined {
	const prototype = AgentSession.prototype;
	const descriptor = Object.getOwnPropertyDescriptor(prototype, "isIdle");
	if (typeof descriptor?.get !== "function" || !descriptor.configurable) return undefined;
	let captured: unknown;
	Object.defineProperty(prototype, "isIdle", { ...descriptor, get(this: unknown) { captured = this; return true; } });
	try { ctx.isIdle(); } catch { captured = undefined; } finally { Object.defineProperty(prototype, "isIdle", descriptor); }
	const session = captured as AgentSession | undefined;
	return session && session.sessionManager === ctx.sessionManager ? session : undefined;
}

const sameModel = (a: Model<Api>, b: Model<Api>) => a.provider === b.provider && a.id === b.id && a.api === b.api;

/** No request may carry a tool call without its result. */
function settle(messages: Message[]): { kept: Message[]; running: Message[] } {
	const answered = new Set(messages.flatMap(message => message.role === "toolResult" ? [message.toolCallId] : []));
	const index = messages.findIndex(message => message.role === "assistant" &&
		message.content.some(part => part.type === "toolCall" && !answered.has(part.id)));
	return index < 0 ? { kept: messages, running: [] } : { kept: messages.slice(0, index), running: messages.slice(index) };
}

const tokens = (messages: readonly Message[]) => messages.reduce((sum, message) => sum + estimateTokens(message), 0);
/** The physical model window minus Pi's default output reserve; RQW-context compacts the main chat well below it. */
const budget = (model: Model<Api>) => model.contextWindow - DEFAULT_COMPACTION_SETTINGS.reserveTokens;
const CUT = "[earlier part cut] ";
/** Tokens left for the side chat's own messages when a cut tail fills the rest. */
const QUESTION_ROOM = 8192;

/** Messages as text, cut from the start to at most `limit` characters. */
function asText(messages: readonly Message[], limit = Infinity): string {
	if (messages.length === 0) return "";
	const text = JSON.stringify(messages.map(item => ({ role: item.role, content: item.content })));
	return text.length <= limit ? text : CUT + text.slice(text.length - Math.max(0, limit - CUT.length));
}

function firstQuestion(message: UserMessage, tail: string): UserMessage {
	const note = tail === "" ? "" : `\nLatest messages after the conversation above; tools may still be running:\n${tail}`;
	const text = typeof message.content === "string" ? message.content :
		message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
	return { ...message, content: `${INSTRUCTION}${note}\n\nQuestion: ${text}` };
}

/** Side answers go back as text only: no unexecuted tool call, no thinking replay. */
function sideTurns(turns: readonly Message[], tail: string): Message[] {
	let first = true;
	return turns.map(message => {
		if (message.role === "user" && first) { first = false; return firstQuestion(message, tail); }
		if (message.role !== "assistant") return message;
		const text = message.content.filter(part => part.type === "text");
		// An answer that only called a tool still needs content on the wire.
		return { ...message, content: text.length > 0 ? text : [{ type: "text" as const, text: "(no text; tool calls were not executed)" }] };
	});
}

/** Drops whole leading side exchanges until the rest fits the window; the newest question is always sent. */
function unsent(mark: Mark, turns: readonly Message[]): number {
	const room = budget(mark.model) - tokens(mark.messages) - Math.ceil((mark.tail.length + INSTRUCTION.length) / 4);
	let skip = 0;
	while (tokens(turns.slice(skip)) > room) {
		const next = turns.findIndex((message, i) => i > skip && message.role === "user");
		if (next < 0) break;
		skip = next;
	}
	return skip;
}

export function installBtwCore(pi: ExtensionAPI): BtwCore {
	let snapshot: Snapshot | undefined;
	let hasMainRequest = false;
	let release: (() => void) | undefined;
	const drop = () => { snapshot = undefined; };

	/** Records each main request; requests with another routing id (summaries, compaction) are not the chat's. */
	function bind(ctx: ExtensionContext): void {
		release?.();
		release = undefined;
		drop();
		hasMainRequest = false;
		const session = sessionOf(ctx);
		const agent = session?.agent;
		if (!session || typeof agent?.streamFunction !== "function") return;
		const manager = session.sessionManager;
		const original = agent.streamFunction;
		let active = true;
		const wrapped: typeof original = function(this: unknown, model, context, options) {
			if (active && options?.sessionId !== undefined && options.sessionId === manager.getSessionId()) {
				hasMainRequest = true;
				snapshot = { sessionId: options.sessionId, model, messages: context.messages, reasoning: options.reasoning, after: [] };
			}
			return original.call(this, model, context, options);
		};
		agent.streamFunction = wrapped;
		release = () => {
			active = false;
			if (agent.streamFunction === wrapped) agent.streamFunction = original;
		};
	}

	/**
	 * Before the first run of this process, e.g. right after a resume, Pi's prompt is still its stock one: extensions
	 * replace the prefix only in before_agent_start. The startup projection gives the prompt the next main request
	 * will carry. Undefined when a run set the prompt, another extension changed it, or Pi's shape is not the expected one.
	 */
	function startupPrompt(ctx: ExtensionContext): string | undefined {
		const session = sessionOf(ctx);
		if (!session) return undefined;
		const internals = session as unknown as { _baseSystemPromptOptions?: Record<string, unknown>; _runSystemPromptOptions?: unknown; _hiddenDeclarations?: Set<string> };
		const getter = (Object.getOwnPropertyDescriptor(session, "systemPrompt")
			?? Object.getOwnPropertyDescriptor(AgentSession.prototype, "systemPrompt"))?.get;
		if (internals._runSystemPromptOptions !== undefined || !internals._baseSystemPromptOptions) return undefined;
		if (!(internals._hiddenDeclarations instanceof Set) || typeof getter !== "function" || typeof session.getActiveToolNames !== "function") return undefined;
		try {
			// A prompt that is not Pi's stock one was set by another extension and stays.
			if (ctx.getSystemPrompt() !== getter.call(session)) return undefined;
			const options = structuredClone(internals._baseSystemPromptOptions);
			options.selectedTools = session.getActiveToolNames();
			options.hiddenTools = [...internals._hiddenDeclarations];
			const request = { options, model: ctx.model, error: undefined as string | undefined };
			pi.events.emit("rqw-prompt:startup-projection", request);
			if (request.error) return undefined;
			internals._runSystemPromptOptions = options;
			try {
				const projected: unknown = getter.call(session);
				return typeof projected === "string" && projected.trim() ? projected : undefined;
			} finally { internals._runSystemPromptOptions = undefined; }
		} catch { return undefined; }
	}

	/** The current prompt and the active tool declarations. */
	function systemOf(ctx: ExtensionContext): SystemMessage {
		const prompt = (hasMainRequest ? undefined : startupPrompt(ctx)) ?? ctx.getSystemPrompt();
		const active = new Set(pi.getActiveTools());
		const tools = pi.getAllTools().filter(tool => active.has(tool.name))
			.map(({ name, description, parameters }) => ({ name, description, parameters }));
		return { role: "system", content: prompt, toolsAdded: tools, timestamp: Date.now() };
	}

	/** The current branch (after a compaction: summary and kept tail) after the given prompt and active tools. */
	function fallback(ctx: ExtensionContext, system: SystemMessage): Message[] {
		const history = convertToLlm(ctx.sessionManager.buildSessionProjection().messages).filter(message => message.role !== "system");
		return [system, ...history];
	}

	/** The latest compaction summary at or before the leaf saved at opening; later compactions stay out. */
	function summaryAt(ctx: ExtensionContext, leafId: string | null): string | undefined {
		const seen = new Set<string>();
		for (let id = leafId; id !== null && !seen.has(id);) {
			seen.add(id);
			const entry = ctx.sessionManager.getEntry(id);
			if (!entry) return undefined;
			if (entry.type === "compaction") return entry.summary;
			id = entry.parentId;
		}
		return undefined;
	}

	/**
	 * The one retry after a provider overflow: the latest compaction summary in full, then the newest part of the
	 * mark as text within half of the window. No compaction runs; the cut is local and immediate.
	 */
	function shortMark(ctx: ExtensionContext, mark: Mark): Mark {
		const system = mark.system;
		const latest = summaryAt(ctx, mark.leafId);
		const summary = latest !== undefined ? `Summary of the earlier conversation:\n${latest}\n\n` : "";
		const room = Math.floor(budget(mark.model) / 2 - tokens([system])) * 4 - summary.length;
		const rest = mark.messages.filter(message => message.role !== "system");
		const cut = asText(rest, room - mark.tail.length) + (mark.tail ? `\n${mark.tail}` : "");
		return { ...mark, sessionId: undefined, messages: [system], tail: summary + cut };
	}

	function request(ctx: ExtensionContext, mark: Mark, turns: readonly Message[], signal: AbortSignal): Promise<AssistantMessage> {
		const messages = [...mark.messages, ...sideTurns(turns.slice(unsent(mark, turns)), mark.tail)];
		const { model, reasoning } = mark;
		if (mark.sessionId !== undefined) {
			let infer: (() => Promise<AssistantMessage>) | undefined;
			pi.events.emit(CONTEXT_FORK, {
				sessionId: mark.sessionId, model, context: { messages }, reasoning, signal, offer: (run) => { infer = run; },
			} satisfies ContextForkRequest);
			if (infer) return infer();
		}
		// No sessionId: RQW-codex would route the main session id into the main thread's controller.
		return ctx.modelRegistry.streamSimple(model, normalizeContext({ messages }), { reasoning, signal }).result();
	}

	pi.on("session_start", (_event, ctx) => bind(ctx));
	pi.on("message_end", (event) => { snapshot?.after.push(event.message); });
	pi.on("session_compact", drop);
	pi.on("session_tree", drop);
	pi.on("session_shutdown", () => {
		release?.();
		release = undefined;
		drop();
	});

	return {
		mark(ctx) {
			const model = ctx.model;
			if (!model) return undefined;
			const shot = snapshot && sameModel(snapshot.model, model) ? snapshot : undefined;
			const level = pi.getThinkingLevel();
			const reasoning = shot ? shot.reasoning : level === "off" ? undefined : level;
			const frozen = { system: systemOf(ctx), leafId: ctx.sessionManager.getLeafId() };
			const { kept, running } = settle(shot ? [...shot.messages, ...convertToLlm(shot.after)] : fallback(ctx, frozen.system));
			if (!shot || tokens(kept) + tokens(running) <= budget(model)) {
				return { sessionId: shot?.sessionId, model, reasoning, messages: kept, tail: asText(running), ...frozen };
			}
			// Right before the main compaction a large tail may not fit: the last main request did fit, so it stays
			// whole and the newest part of what followed goes as text. Nothing waits for or runs a compaction.
			const base = settle(shot.messages);
			const room = (budget(model) - tokens(base.kept) - QUESTION_ROOM) * 4;
			const rest = [...base.running, ...convertToLlm(shot.after)];
			return { sessionId: shot.sessionId, model, reasoning, messages: base.kept, tail: asText(rest, room), ...frozen };
		},
		unsent,
		async send(ctx, mark, turns, signal) {
			// The token estimate can be wrong: one automatic shorter retry, then the provider's error stands.
			const message = await request(ctx, mark, turns, signal);
			if (signal.aborted || !isContextOverflow(message, mark.model.contextWindow)) return { message, short: false };
			return { message: await request(ctx, shortMark(ctx, mark), turns, signal), short: true };
		},
	};
}
