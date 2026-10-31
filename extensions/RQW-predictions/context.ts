// What the prediction request sends: the main chat's full context as the model last saw it, plus one instruction.
// The mark is taken like /btw does: the last main request and what followed it, forked through the shared contract.
import { normalizeContext, type Api, type AssistantMessage, type Context, type Message, type Model, type SystemMessage, type ThinkingLevel } from "@earendil-works/pi-ai";
import { AgentSession, convertToLlm, type ExtensionAPI, type ExtensionContext, type MessageEndEvent } from "@earendil-works/pi-coding-agent";

export const CONTEXT_FORK = "rqw:context-fork:v1";
/** The reply shape of Codex's own prediction call: `{ suggestion: string | null }`. */
const REPLY_SCHEMA = { type: "object", properties: { suggestion: { type: ["string", "null"] } }, required: ["suggestion"], additionalProperties: false };
export const SCHEMA_RULE = `Return only JSON matching this schema: ${JSON.stringify(REPLY_SCHEMA)}.`;
/** The owner's rule, appended after the text Codex serves; it is not part of that text. */
export const SILENCE_RULE = "If there is no obvious next user message, set suggestion to null.";
/** The reason a transport gives when it cannot fork without running hosted tools. */
export const HOSTED_TOOLS = "unsupported_hosted_tools";

/** The shared fork contract RQW-anthropic and RQW-codex answer; each folder keeps its own copy. */
type ContextForkRequest = {
	sessionId: string;
	model: Model<Api>;
	context: Context;
	reasoning?: ThinkingLevel;
	signal: AbortSignal;
	/** Ask the transport to prepare the request in small steps that yield to the event loop. */
	cooperative?: boolean;
	offer(infer: () => Promise<AssistantMessage>): void;
	/** A final refusal: the request must not be sent in any other way. */
	decline?(reason: string): void;
};

type Snapshot = { sessionId: string; model: Model<Api>; messages: Message[]; after: MessageEndEvent["message"][] };

/** A light mark taken at the answer; the heavy conversion waits until the request is built. */
export type Capture = {
	model: Model<Api>;
	reasoning?: ThinkingLevel;
	shot?: { sessionId: string; messages: Message[]; after: MessageEndEvent["message"][] };
};

export type PredictionContext = {
	/** Starts recording main requests for this session. */
	bind(ctx: ExtensionContext): void;
	release(): void;
	record(message: MessageEndEvent["message"]): void;
	drop(): void;
	/** True when the branch holds an assistant message: a fresh or empty chat has nothing to predict from. */
	hasAnswer(ctx: ExtensionContext): boolean;
	capture(ctx: ExtensionContext): Capture | undefined;
	/** One model call with `prompt` (the served text) plus the reply rules as the last user message. Rejects with Declined when no safe call exists. */
	infer(ctx: ExtensionContext, capture: Capture, prompt: string, signal: AbortSignal): Promise<AssistantMessage>;
};

export class Declined extends Error {}

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

/** No request may carry a tool call without its result: the messages end before the first unanswered call. */
function settle(messages: Message[]): Message[] {
	const answered = new Set(messages.flatMap(message => message.role === "toolResult" ? [message.toolCallId] : []));
	const index = messages.findIndex(message => message.role === "assistant" &&
		message.content.some(part => part.type === "toolCall" && !answered.has(part.id)));
	return index < 0 ? messages : messages.slice(0, index);
}

/** The text blocks of one answer as the model's suggestion; undefined when it has none to show. */
export function parseSuggestion(message: AssistantMessage): string | undefined {
	if (message.stopReason === "error" || message.stopReason === "aborted") {
		throw new Error(message.errorMessage ?? "the model request failed");
	}
	if (message.content.some(part => part.type === "toolCall")) return undefined;
	const text = message.content.flatMap(part => part.type === "text" ? [part.text] : []).join("");
	let value: unknown;
	try { value = JSON.parse(text.trim()); } catch { return undefined; }
	const suggestion = (value as { suggestion?: unknown } | null)?.suggestion;
	return typeof suggestion === "string" ? safeText(suggestion) || undefined : undefined;
}

// Escape sequences first, then any other control character; line breaks stay, tabs become one space.
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
export function safeText(value: string): string {
	return value.replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(ESCAPES, "").replace(CONTROLS, "").trim();
}

export function installContext(pi: ExtensionAPI): PredictionContext {
	let snapshot: Snapshot | undefined;
	let release: (() => void) | undefined;

	/** The prompt and the active tool declarations; only the chat without a recorded request needs it. */
	function systemOf(ctx: ExtensionContext): SystemMessage {
		const active = new Set(pi.getActiveTools());
		const tools = pi.getAllTools().filter(tool => active.has(tool.name))
			.map(({ name, description, parameters }) => ({ name, description, parameters }));
		return { role: "system", content: ctx.getSystemPrompt(), toolsAdded: tools, timestamp: Date.now() };
	}

	function messagesOf(ctx: ExtensionContext, capture: Capture): Message[] {
		const { shot } = capture;
		if (shot) return settle([...shot.messages, ...convertToLlm(shot.after)]);
		const history = convertToLlm(ctx.sessionManager.buildSessionProjection().messages).filter(message => message.role !== "system");
		return settle([systemOf(ctx), ...history]);
	}

	/** One fork request; undefined when no transport answered it. */
	function fork(capture: Capture, messages: Message[], signal: AbortSignal): (() => Promise<AssistantMessage>) | undefined {
		if (!capture.shot) return undefined;
		let infer: (() => Promise<AssistantMessage>) | undefined;
		let declined = false;
		pi.events.emit(CONTEXT_FORK, {
			sessionId: capture.shot.sessionId, model: capture.model, context: { messages }, reasoning: capture.reasoning, signal,
			cooperative: true,
			offer: run => { infer = run; },
			decline: reason => { if (reason === HOSTED_TOOLS) declined = true; },
		} satisfies ContextForkRequest);
		if (declined) throw new Declined(HOSTED_TOOLS);
		return infer;
	}

	return {
		bind(ctx) {
			release?.();
			release = undefined;
			snapshot = undefined;
			const session = sessionOf(ctx);
			const agent = session?.agent;
			if (!session || typeof agent?.streamFunction !== "function") return;
			const manager = session.sessionManager;
			const original = agent.streamFunction;
			let active = true;
			const wrapped: typeof original = function(this: unknown, model, context, options) {
				// Requests with another routing id (summaries, compaction) are not the chat's.
				if (active && options?.sessionId !== undefined && options.sessionId === manager.getSessionId()) {
					snapshot = { sessionId: options.sessionId, model, messages: context.messages, after: [] };
				}
				return original.call(this, model, context, options);
			};
			agent.streamFunction = wrapped;
			release = () => {
				active = false;
				if (agent.streamFunction === wrapped) agent.streamFunction = original;
			};
		},
		release() {
			release?.();
			release = undefined;
			snapshot = undefined;
		},
		record(message) { snapshot?.after.push(message); },
		drop() { snapshot = undefined; },
		hasAnswer: ctx => ctx.sessionManager.getEntries().some(entry => entry.type === "message" && entry.message.role === "assistant"),
		capture(ctx) {
			const model = ctx.model;
			if (!model) return undefined;
			const level = pi.getThinkingLevel();
			const reasoning = level === "off" ? undefined : level;
			const shot = snapshot && sameModel(snapshot.model, model) && snapshot.sessionId === ctx.sessionManager.getSessionId()
				? { sessionId: snapshot.sessionId, messages: snapshot.messages, after: snapshot.after.slice() } : undefined;
			return { model, reasoning, shot };
		},
		async infer(ctx, capture, prompt, signal) {
			const instruction: Message = { role: "user", content: `${prompt}\n${SCHEMA_RULE}\n${SILENCE_RULE}`, timestamp: Date.now() };
			const messages = [...messagesOf(ctx, capture), instruction];
			const run = fork(capture, messages, signal);
			if (run) return run();
			// No sessionId: a transport would route the main session id into the main thread's controller.
			const { model, reasoning } = capture;
			return ctx.modelRegistry.streamSimple(model, normalizeContext({ messages }), { reasoning, signal }).result();
		},
	};
}
