// What the prediction request sends: the main chat's full context as the model last saw it, plus one instruction.
// The mark is taken like /btw does: the last main request and what followed it, forked through the shared contract.
import { normalizeContext, type Api, type AssistantMessage, type Context, type Message, type Model, type SystemMessage, type ThinkingLevel } from "@earendil-works/pi-ai";
import { AgentSession, convertToLlm, type ExtensionAPI, type ExtensionContext, type MessageEndEvent } from "@earendil-works/pi-coding-agent";

export const CONTEXT_FORK = "rqw:context-fork:v1";
/** RQW-prompt's startup projection channel (literal, no import across folders). */
const STARTUP_PROJECTION = "rqw-prompt:startup-projection";
// Transport identity only; unlike sessionId, this never registers a main-request snapshot.
const SESSION_IDENTITY = Symbol.for("rqw-anthropic/session-identity");
/** The reply shape of Codex's own prediction call: `{ suggestion: string | null }`. */
const REPLY_SCHEMA = { type: "object", properties: { suggestion: { type: ["string", "null"] } }, required: ["suggestion"], additionalProperties: false };
export const SCHEMA_RULE = `Return only JSON matching this schema: ${JSON.stringify(REPLY_SCHEMA)}.`;
/** The owner's rule, appended after the text Codex serves; it is not part of that text. */
export const SILENCE_RULE = "If there is no obvious next user message, set suggestion to null.";
/** A piece to insert is at most this many words: the owner asked for small steps. */
export const MAX_WORDS = 6;
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

/** The text of the input around the cursor, as the model sees it. `key` names the exact text and cursor it was taken from. */
export type Draft = { before: string; after: string; key: string };
type Cursor = { line: number; col: number };

/** The identity of a draft: the text and where the cursor is in it. */
export const draftKey = (text: string, cursor: Cursor) => `${text}\u0000${cursor.line}:${cursor.col}`;

/** Splits the editor text at the cursor; `expand` turns paste markers back into their content. */
export function draftOf(text: string, cursor: Cursor, expand: (text: string) => string = value => value): Draft {
	const lines = text.split("\n");
	const line = lines[cursor.line] ?? "";
	const before = [...lines.slice(0, cursor.line), line.slice(0, cursor.col)].join("\n");
	const after = [line.slice(cursor.col), ...lines.slice(cursor.line + 1)].join("\n");
	return { before: expand(before), after: expand(after), key: draftKey(text, cursor) };
}

const part = (tag: string, value: string) => value === "" ? `<${tag}></${tag}>` : `<${tag}>\n${value}\n</${tag}>`;

/** The rule that turns the reply into a few words to insert at the cursor. It goes only into the last message. */
export function insertRule({ before, after }: Draft): string {
	return [
		"The user has already started typing the next message. The cursor sits between the two parts below.",
		part("before_cursor", before),
		part("after_cursor", after),
		`Set suggestion to only the next few words (at most ${MAX_WORDS}) to insert at the cursor, so that the text before, the suggestion and the text after read as one message.`,
		"Start with a space when the words need one. Never repeat text that is already before or after the cursor.",
	].join("\n");
}

export type PredictionContext = {
	/** Starts recording main requests for this session. */
	bind(ctx: ExtensionContext): void;
	release(): void;
	record(message: MessageEndEvent["message"]): void;
	drop(): void;
	/** True when the branch holds an assistant message: a fresh or empty chat has nothing to predict from. */
	hasAnswer(ctx: ExtensionContext): boolean;
	capture(ctx: ExtensionContext): Capture | undefined;
	/** One model call with `prompt` (the served text) plus the reply rules as the last user message; a `draft` adds the insert rule. Rejects with Declined when no safe call exists. */
	infer(ctx: ExtensionContext, capture: Capture, prompt: string, signal: AbortSignal, draft?: Draft): Promise<AssistantMessage>;
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

/** The raw `suggestion` string of one answer; undefined when it has none. Throws when the request failed. */
function replyOf(message: AssistantMessage): string | undefined {
	if (message.stopReason === "error" || message.stopReason === "aborted") {
		throw new Error(message.errorMessage ?? "the model request failed");
	}
	if (message.content.some(part => part.type === "toolCall")) return undefined;
	const text = message.content.flatMap(part => part.type === "text" ? [part.text] : []).join("");
	let value: unknown;
	try { value = JSON.parse(text.trim()); } catch { return undefined; }
	const suggestion = (value as { suggestion?: unknown } | null)?.suggestion;
	return typeof suggestion === "string" ? suggestion : undefined;
}

/** The text blocks of one answer as the model's suggestion; undefined when it has none to show. */
export function parseSuggestion(message: AssistantMessage): string | undefined {
	const suggestion = replyOf(message);
	return suggestion === undefined ? undefined : safeText(suggestion) || undefined;
}

/** The text up to the end of the first `limit` words; all of it when there are fewer. */
function firstWords(value: string, limit: number): string {
	const words = [...value.matchAll(/\S+/g)];
	const last = words[limit - 1];
	return words.length > limit && last ? value.slice(0, last.index + last[0].length) : value;
}

/**
 * The few words to insert at the cursor of `draft`; undefined when there is none. Unlike a suggestion the edges keep
 * their space, because it separates the piece from its neighbours: it is dropped only where the text before or
 * after the cursor already has one.
 */
export function parsePiece(message: AssistantMessage, draft: Pick<Draft, "before" | "after">): string | undefined {
	const reply = replyOf(message);
	if (reply === undefined) return undefined;
	let piece = firstWords(cleanText(reply).split("\n")[0], MAX_WORDS);
	if (/\s$/.test(draft.before)) piece = piece.trimStart();
	if (/^\s/.test(draft.after)) piece = piece.trimEnd();
	return piece.trim() === "" ? undefined : piece;
}

// Escape sequences first, then any other control character; line breaks stay, tabs become one space.
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
function cleanText(value: string): string {
	return value.replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(ESCAPES, "").replace(CONTROLS, "");
}
export const safeText = (value: string): string => cleanText(value).trim();

export function installContext(pi: ExtensionAPI): PredictionContext {
	let snapshot: Snapshot | undefined;
	let release: (() => void) | undefined;

	/**
	 * Before the first run of this process, e.g. right after a resume, Pi's prompt is still its stock one: extensions
	 * replace the prefix only in before_agent_start. The startup projection gives the prompt the next main request
	 * will carry. Undefined when a run has already set the prompt or Pi's shape is not the expected one.
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
			const options = structuredClone(internals._baseSystemPromptOptions);
			options.selectedTools = session.getActiveToolNames();
			options.hiddenTools = [...internals._hiddenDeclarations];
			const request = { options, model: ctx.model, error: undefined as string | undefined };
			pi.events.emit(STARTUP_PROJECTION, request);
			if (request.error) return undefined;
			internals._runSystemPromptOptions = options;
			try {
				const projected: unknown = getter.call(session);
				return typeof projected === "string" && projected.trim() ? projected : undefined;
			} finally { internals._runSystemPromptOptions = undefined; }
		} catch { return undefined; }
	}

	/** The prompt and the active tool declarations; only the chat without a recorded request needs it. */
	function systemOf(ctx: ExtensionContext): SystemMessage {
		const active = new Set(pi.getActiveTools());
		const tools = pi.getAllTools().filter(tool => active.has(tool.name))
			.map(({ name, description, parameters }) => ({ name, description, parameters }));
		const prompt = startupPrompt(ctx) ?? ctx.getSystemPrompt();
		return { role: "system", content: prompt, toolsAdded: tools, timestamp: Date.now() };
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
		async infer(ctx, capture, prompt, signal, draft) {
			// The draft is new text, so it sits at the very end: everything before it keeps the cached prefix.
			const insert = draft ? `${insertRule(draft)}\n` : "";
			const instruction: Message = { role: "user", content: `${prompt}\n${insert}${SCHEMA_RULE}\n${SILENCE_RULE}`, timestamp: Date.now() };
			const messages = [...messagesOf(ctx, capture), instruction];
			const run = fork(capture, messages, signal);
			if (run) return run();
			const { model, reasoning } = capture;
			// Anthropic uses this as Claude Code identity. Codex must not reuse the main thread's controller.
			const sessionId = model.provider === "anthropic" && model.api === "anthropic-messages"
				? ctx.sessionManager.getSessionId() : undefined;
			return ctx.modelRegistry.streamSimple(model, normalizeContext({ messages }), {
				reasoning, signal, [SESSION_IDENTITY]: sessionId,
			}).result();
		},
	};
}
