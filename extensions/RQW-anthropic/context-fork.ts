import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions, ThinkingLevel } from "@earendil-works/pi-ai";
import { AUTH_ORIGIN, STREAM_CONTRACT } from "./retry.ts";

type Stream = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => { result(): Promise<AssistantMessage> };
export interface ContextForkRequest {
	sessionId: string;
	model: Model<Api>;
	context: Context;
	reasoning?: ThinkingLevel;
	signal: AbortSignal;
	/** Prepare in small slices that yield to the event loop; the offer is still made synchronously. */
	cooperative?: boolean;
	/** Final refusal: the request must not be answered by any other path. Absent means a plain silent no-offer. */
	decline?(reason: string): void;
	offer(infer: () => Promise<AssistantMessage>): void;
}

/**
 * A cooperative `infer` rejects with this before any model request when the request turned out not to fit its source.
 * The caller may then use its ordinary path; every other rejection is final.
 */
export class ContextForkUnavailable extends Error {
	readonly reason: "context_mismatch" | "unfinished_tool_calls";
	constructor(reason: ContextForkUnavailable["reason"]) {
		super(`RQW-anthropic: context fork unavailable (${reason}); nothing was sent`);
		this.name = "ContextForkUnavailable";
		this.reason = reason;
	}
}

/** Hands control back to the event loop; injectable so a test can stop preparation between slices. */
export type Pause = () => Promise<void>;
const nextTurn: Pause = () => new Promise(resolve => setImmediate(resolve));
const SLICE = 16;

type Body = Record<string, any>;
type Snapshot = { model: Model<Api>; context: Context; options: SimpleStreamOptions; body: Body; local: boolean };

// Keep only transport/sampling data. Session observers and the child's signal never enter a fork.
function forkOptions(options: SimpleStreamOptions): SimpleStreamOptions {
	const keys = ["apiKey", "env", "headers", "identity", "timeoutMs", "maxRetryDelayMs", "temperature",
		"maxTokens", "cacheRetention", "sessionId", "metadata", "reasoning", "thinkingBudgets",
		"thinkingEnabled", "thinkingBudgetTokens", "thinkingDisplay", "interleavedThinking", "effort", "toolChoice"];
	const copy = Object.fromEntries(keys.filter(key => key in options).map(key =>
		[key, structuredClone((options as Record<string, unknown>)[key])]));
	return Object.assign(copy, { fetch: options.fetch,
		[AUTH_ORIGIN]: structuredClone((options as any)[AUTH_ORIGIN]),
		[STREAM_CONTRACT]: (options as any)[STREAM_CONTRACT] });
}

const isLocalTool = (tool: Body) => (tool.type === undefined || tool.type === "custom") && !!tool.input_schema;

function declaredToolsLocal(body: Body): boolean {
	return !body.tools?.some((tool: Body) => !isLocalTool(tool)) && !body.mcp_servers?.length;
}

function additionsLocal(message: Body): boolean {
	return !Array.isArray(message.content) || message.content.every((block: Body) =>
		block.type !== "tool_addition" || isLocalTool(block.tool?.definition ?? block.tool ?? block));
}

function localToolsOnly(body: Body): boolean {
	return declaredToolsLocal(body) && !!(body.messages ?? []).every(additionsLocal);
}

function withoutCache(message: Body): string {
	const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
	return JSON.stringify({ ...message, content }, (key, item) => key === "cache_control" ? undefined : item);
}

/** Visit items in slices; the generator yields after each slice, and a visitor returning false stops early. */
function* slices<T>(items: readonly T[], visit: (item: T, index: number) => boolean | void): Generator<void> {
	for (let i = 0; i < items.length; i++) {
		if (visit(items[i]!, i) === false) return;
		if ((i + 1) % SLICE === 0) yield;
	}
}

function drain<T>(steps: Generator<void, T>): T {
	for (let step = steps.next(); ; step = steps.next()) if (step.done) return step.value;
}

async function drainCooperatively<T>(steps: Generator<void, T>, signal: AbortSignal, pause: Pause): Promise<T> {
	for (let step = steps.next(); ; step = steps.next()) {
		if (step.done) return step.value;
		await pause();
		signal.throwIfAborted();
	}
}

type Forked = { model: Model<Api>; context: Context; body: Body; options: SimpleStreamOptions };

/** Independent copies of the source and the requested context, or the reason the request does not fit the source. */
function* prepare(source: Snapshot, requested: Context): Generator<void, Forked | ContextForkUnavailable["reason"]> {
	const pending = new Set<string>();
	yield* slices(requested.messages, message => {
		if (message.role === "assistant") {
			for (const block of message.content) if (block.type === "toolCall") pending.add(block.id);
		} else if (message.role === "toolResult") pending.delete(message.toolCallId);
	});
	if (pending.size > 0) return "unfinished_tool_calls";
	let matches = true;
	const own = source.context.messages;
	yield* slices(own, (message, i) => matches = JSON.stringify(message) === JSON.stringify(requested.messages[i]));
	if (!matches) return "context_mismatch";
	const { messages, ...rest } = requested;
	const context: Context = { ...structuredClone(rest), messages: [] };
	yield* slices(messages, message => { context.messages.push(structuredClone(message)); });
	// Copy key by key to keep the wire key order; only the message list is cut into slices.
	const body: Body = {};
	for (const key of Object.keys(source.body)) body[key] = key === "messages" ? [] : structuredClone(source.body[key]);
	yield* slices(source.body.messages ?? [], message => { body.messages.push(structuredClone(message)); });
	return { model: structuredClone(source.model), context, body, options: forkOptions(source.options) };
}

/** In-memory last-request state; inference uses the provider builder, never a session or executor. */
export function contextForks(captureStream: (single: boolean) => Stream, pause: Pause = nextTurn) {
	// An empty slot is a real SDK session registered by its lifecycle, not an arbitrary request routing id.
	const snapshots = new Map<string, Snapshot | undefined>();
	return {
		clear() { snapshots.clear(); },
		registerSource(sessionId: string) { if (!snapshots.has(sessionId)) snapshots.set(sessionId, undefined); },
		release(sessionId: string) { snapshots.delete(sessionId); },
		capture(model: Model<Api>, context: Context, options: SimpleStreamOptions, raw: string) {
			if (!options.sessionId || !snapshots.has(options.sessionId) || options.signal?.aborted) return;
			const body = JSON.parse(raw);
			snapshots.set(options.sessionId, { model: structuredClone(model), context: structuredClone(context),
				options: forkOptions(options), body, local: localToolsOnly(body) });
		},
		offer(request: ContextForkRequest) {
			if (request.model.provider !== "anthropic" || request.model.api !== "anthropic-messages") return;
			const source = snapshots.get(request.sessionId);
			if (!source || source.model.id !== request.model.id || source.model.baseUrl !== request.model.baseUrl) return;
			if (!source.local) return request.decline?.("unsupported_hosted_tools");
			if (request.context.messages.length < source.context.messages.length) return;
			// Capture now, not when the consumer invokes infer after another child turn. The source snapshot is replaced, never mutated.
			const requested = { ...request.context, messages: [...request.context.messages] };
			const cooperative = request.cooperative === true;
			const ready = cooperative ? undefined : drain(prepare(source, requested));
			if (typeof ready === "string") return;
			const signal = request.signal;
			const stream = captureStream(cooperative);
			const reasoning = request.reasoning;
			let used = false;
			request.offer(async () => {
				if (used) throw new Error("RQW-anthropic: context fork already consumed");
				used = true;
				signal.throwIfAborted();
				const forked = ready ?? await drainCooperatively(prepare(source, requested), signal, pause);
				if (typeof forked === "string") throw new ContextForkUnavailable(forked);
				const { model, context, body, options } = forked;
				const between = cooperative ? pause : async () => {};
				if (reasoning !== undefined) {
					options.reasoning = reasoning;
					Object.assign(options, { [STREAM_CONTRACT]: "simple" });
				}
				const result = await stream(model, context, { ...options, signal, async onPayload(payload) {
					const next = payload as Body;
					if (!declaredToolsLocal(next)) throw new Error("unsupported_hosted_tools");
					await drainCooperatively(slices(next.messages, (message: Body) => {
						if (!additionsLocal(message)) throw new Error("unsupported_hosted_tools");
					}), signal, between);
					next.system = structuredClone(body.system);
					next.tools = structuredClone(body.tools);
					// Preserve matching wire prefix blocks, including their original cache breakpoints.
					let matching = true;
					await drainCooperatively(slices(body.messages, (message: Body, i) => {
						matching = i < next.messages.length && withoutCache(message) === withoutCache(next.messages[i]);
						if (matching) next.messages[i] = structuredClone(message);
						return matching;
					}), signal, between);
					// Pi adds a breakpoint to the new last user message. Keep the earlier cached prefix first.
					let count = 0;
					const limit = (block: Body) => { if (block.cache_control && ++count > 4) delete block.cache_control; };
					[...(next.tools ?? []), ...(next.system ?? [])].forEach(limit);
					await drainCooperatively(slices(next.messages, (message: Body) => {
						if (Array.isArray(message.content)) message.content.forEach(limit);
					}), signal, between);
					return next;
				} }).result();
				signal.throwIfAborted();
				return result;
			});
		},
	};
}
