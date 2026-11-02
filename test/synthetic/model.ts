// The scripted model of the synthetic world. Pi's ModelRuntime.streamSimple is replaced by `streamSimple` below;
// every request is answered from rules and the script by the faux core of @earendil-works/pi-ai, so streaming,
// usage and abort are Pi's own. Time never passes here: replies stream in microtasks.
import { createFauxCore, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall, type Context, type Model } from "@earendil-works/pi-ai";

type Part =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string }
	| { type: "toolCall"; name: string; arguments: Record<string, any>; id?: string };

/** One answer to one model request: content parts, or a provider error, or an abort. */
export interface Reply {
	readonly parts: readonly Part[];
	readonly error?: string;
	readonly aborted?: boolean;
}

/** One request Pi or an extension sent to the model. */
export interface Request {
	readonly model: Model<any>;
	readonly context: Context;
	readonly options: { signal?: AbortSignal } | undefined;
	/** Set when the world answered it on its own, with the reason. */
	readonly background?: string;
}

export type Match = (request: Request) => boolean;

export const text = (content: string): Reply => ({ parts: [{ type: "text", text: content }] });
export const think = (content: string): Reply => ({ parts: [{ type: "thinking", thinking: content }] });
export const call = (name: string, args: Record<string, unknown>, id?: string): Reply => ({ parts: [{ type: "toolCall", name, arguments: args, id }] });
/** A provider error: Pi sees a failed request with this message. */
export const fail = (message: string): Reply => ({ parts: [], error: message });
/** One answer made of several parts, for example thinking, then text, then two tool calls. */
export const reply = (...replies: Reply[]): Reply => ({ parts: replies.flatMap((item) => item.parts) });

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((block) => (block?.type === "text" ? block.text : "")).join("");
}

/** The text of the first user message; for a subagent this is its task. */
export function firstUserText(request: Request): string {
	const first = request.context.messages.find((message) => message.role === "user");
	return first ? contentText(first.content) : "";
}

export const isTask = (task: string): Match => (request) => firstUserText(request) === task;

/** A request held open until the test answers it. */
export interface Hold {
	/** True once a matching request arrived and waits. */
	readonly arrived: boolean;
	readonly request: Request | undefined;
	/** Answers the held request, now or before it arrives. */
	reply(answer: Reply): void;
}

type FauxCore = ReturnType<typeof createFauxCore>;
type Rule = { match: Match; replies: Reply[]; hold?: HoldState };
type HoldState = Hold & { answer: Promise<Reply>; settle(answer: Reply): void; arrived: boolean; request: Request | undefined };

/**
 * Requests Pi or an extension sends on its own, outside the conversation. They are answered here, never from the
 * script, so the script order of a scenario is only the conversation. Each entry says why it exists.
 */
const background: { why: string; match: (context: Context) => boolean; reply: Reply }[] = [
	{
		why: "RQW-naming names the session after the first input and after each compaction",
		match: (context) => context.systemPrompt?.startsWith("You name chat sessions.") === true,
		reply: text('["Greeting"]'),
	},
];

export function createModel() {
	const script: Reply[] = [];
	const rules: Rule[] = [];
	const requests: Request[] = [];
	const unscripted: string[] = [];
	const cores = new Map<string, FauxCore>();
	const open = new Set<{ held: boolean }>();
	const holds: HoldState[] = [];
	let callCount = 0;

	// One faux core per api and provider, so the recorded messages carry the real model's names.
	const coreFor = (model: Model<any>): FauxCore => {
		const key = `${model.api}|${model.provider}`;
		let core = cores.get(key);
		if (!core) {
			core = createFauxCore({ api: model.api, provider: model.provider, models: [{ id: model.id }], tokenSize: { min: 4, max: 4 } });
			cores.set(key, core);
		}
		return core;
	};

	const toMessage = (answer: Reply) => {
		if (answer.aborted) return fauxAssistantMessage([], { stopReason: "aborted", errorMessage: "Request was aborted" });
		if (answer.error !== undefined) return fauxAssistantMessage([], { stopReason: "error", errorMessage: answer.error });
		const content = answer.parts.map((part) => {
			if (part.type === "text") return fauxText(part.text);
			if (part.type === "thinking") return fauxThinking(part.thinking);
			return fauxToolCall(part.name, part.arguments, { id: part.id ?? `call-${++callCount}` });
		});
		const toolCalls = answer.parts.some((part) => part.type === "toolCall");
		return fauxAssistantMessage(content, { stopReason: toolCalls ? "toolUse" : "stop" });
	};

	const createHold = (match: Match): Rule => {
		let settle!: (answer: Reply) => void;
		const answer = new Promise<Reply>((resolve) => { settle = resolve; });
		const state: HoldState = { arrived: false, request: undefined, answer, settle, reply: settle };
		holds.push(state);
		return { match, replies: [], hold: state };
	};

	/** The step the faux core runs for this request. User rules win over background answers, those over the script. */
	const stepFor = (request: Request, token: { held: boolean }): (() => unknown) => {
		const rule = rules.find((item) => item.match(request) && (item.hold ? !item.hold.arrived : item.replies.length > 0));
		if (rule?.hold) {
			const state = rule.hold;
			state.arrived = true;
			state.request = request;
			return async () => {
				token.held = true;
				const signal = request.options?.signal;
				const aborted = new Promise<Reply>((resolve) => {
					if (signal?.aborted) resolve({ parts: [], aborted: true });
					else signal?.addEventListener("abort", () => resolve({ parts: [], aborted: true }));
				});
				const answer = await Promise.race([state.answer, aborted]);
				token.held = false;
				return toMessage(answer);
			};
		}
		if (rule) return () => toMessage(rule.replies.shift()!);
		const known = background.find((entry) => entry.match(request.context));
		if (known) {
			(request as { background?: string }).background = known.why;
			return () => toMessage(known.reply);
		}
		const next = script.shift();
		if (!next) unscripted.push(`no scripted reply left for: ${firstUserText(request).slice(0, 60)}`);
		return () => toMessage(next ?? text("synthetic world: no scripted reply left"));
	};

	return {
		/** The test-facing side: `w.model`. */
		api: {
			/** Answers, one per request, in order, for requests no `when` or `hold` takes. */
			script: (...replies: Reply[]) => { script.push(...replies); },
			/** Answers, in order, for the requests `match` accepts; when they are used up, the request goes on to the script. */
			when: (match: Match, ...replies: Reply[]) => { rules.push({ match, replies: [...replies] }); },
			/** Keeps the first request `match` accepts open until `reply` is called. */
			hold: (match: Match): Hold => {
				const rule = createHold(match);
				rules.push(rule);
				return rule.hold!;
			},
			get unscripted() { return unscripted as readonly string[]; },
		},
		requests: requests as readonly Request[],
		/** True when no request waits for an answer except the held ones. */
		idle: () => [...open].every((token) => token.held),
		/** Gives every request still held an abort, so nothing hangs after the test. */
		release: () => { for (const state of holds) state.settle({ parts: [], aborted: true }); },
		streamSimple(model: Model<any>, context: Context, options?: { signal?: AbortSignal }) {
			const request: Request = { model, context, options };
			requests.push(request);
			const token = { held: false };
			open.add(token);
			const core = coreFor(model);
			core.setResponses([stepFor(request, token) as never]);
			const stream = core.streamSimple(model as never, context as never, options as never);
			void stream.result().finally(() => open.delete(token));
			return stream;
		},
	};
}
