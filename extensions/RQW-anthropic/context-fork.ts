import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-coding-agent";
import { AUTH_ORIGIN, STREAM_CONTRACT } from "./retry.ts";

type Stream = (model: Model, context: Context, options?: SimpleStreamOptions) => { result(): Promise<AssistantMessage> };
export interface ContextForkRequest {
	sessionId: string;
	model: Model;
	context: Context;
	reasoning?: ThinkingLevel;
	signal: AbortSignal;
	offer(infer: () => Promise<AssistantMessage>): void;
}

type Body = Record<string, any>;
type Snapshot = { model: Model; context: Context; options: SimpleStreamOptions; body: Body };

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

function localToolsOnly(body: Body): boolean {
	const local = (tool: Body) => (tool.type === undefined || tool.type === "custom") && !!tool.input_schema;
	if (body.tools?.some((tool: Body) => !local(tool)) || body.mcp_servers?.length) return false;
	return !body.messages?.some((message: Body) => Array.isArray(message.content) &&
		message.content.some((block: Body) => block.type === "tool_addition" && !local(block.tool?.definition ?? block.tool ?? block)));
}

function withoutCache(message: Body): string {
	const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
	return JSON.stringify({ ...message, content }, (key, item) => key === "cache_control" ? undefined : item);
}

function completedTools(context: Context): boolean {
	const pending = new Set<string>();
	for (const message of context.messages) {
		if (message.role === "assistant") {
			for (const block of message.content) if (block.type === "toolCall") pending.add(block.id);
		} else if (message.role === "toolResult") pending.delete(message.toolCallId);
	}
	return pending.size === 0;
}

/** In-memory last-request state; inference uses the provider builder, never a session or executor. */
export function contextForks(captureStream: () => Stream) {
	// An empty slot is a real SDK session registered by its lifecycle, not an arbitrary request routing id.
	const snapshots = new Map<string, Snapshot | undefined>();
	return {
		clear() { snapshots.clear(); },
		registerSource(sessionId: string) { if (!snapshots.has(sessionId)) snapshots.set(sessionId, undefined); },
		release(sessionId: string) { snapshots.delete(sessionId); },
		capture(model: Model, context: Context, options: SimpleStreamOptions, raw: string) {
			if (!options.sessionId || !snapshots.has(options.sessionId) || options.signal?.aborted) return;
			snapshots.set(options.sessionId, { model: structuredClone(model), context: structuredClone(context),
				options: forkOptions(options), body: JSON.parse(raw) });
		},
		offer(request: ContextForkRequest) {
			if (request.model.provider !== "anthropic" || request.model.api !== "anthropic-messages") return;
			const source = snapshots.get(request.sessionId);
			if (!source || source.model.id !== request.model.id || source.model.baseUrl !== request.model.baseUrl) return;
			// Capture now, not when the consumer invokes infer after another child turn.
			const model = structuredClone(source.model);
			const context = structuredClone(request.context);
			const body = structuredClone(source.body);
			const options = forkOptions(source.options);
			const signal = request.signal;
			if (!localToolsOnly(body) || !completedTools(context) || source.context.messages.some((message, i) =>
				JSON.stringify(message) !== JSON.stringify(context.messages[i]))) return;
			const stream = captureStream();
			if (request.reasoning !== undefined) {
				options.reasoning = request.reasoning;
				Object.assign(options, { [STREAM_CONTRACT]: "simple" });
			}
			let used = false;
			request.offer(async () => {
				if (used) throw new Error("RQW-anthropic: context fork already consumed");
				used = true;
				signal.throwIfAborted();
				const result = await stream(model, context, { ...options, signal, onPayload(payload) {
					const next = payload as Body;
					if (!localToolsOnly(next)) throw new Error("unsupported_hosted_tools");
					next.system = structuredClone(body.system);
					next.tools = structuredClone(body.tools);
					// Preserve matching wire prefix blocks, including their original cache breakpoints.
					for (let i = 0; i < body.messages.length && i < next.messages.length; i++) {
						if (withoutCache(body.messages[i]) !== withoutCache(next.messages[i])) break;
						next.messages[i] = structuredClone(body.messages[i]);
					}
					return next;
				} }).result();
				signal.throwIfAborted();
				return result;
			});
		},
	};
}
