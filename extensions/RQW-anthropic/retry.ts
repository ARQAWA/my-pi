import { AsyncLocalStorage } from "node:async_hooks";
import { type AssistantMessage, type AssistantMessageEventStream, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { AgentSession, ModelRuntime, VERSION } from "@earendil-works/pi-coding-agent";
import { AUTH_FAILURE } from "./auth.ts";
import { OVERLAY } from "./visibility.ts";

export const STREAM_CONTRACT = Symbol.for("rqw-anthropic/stream-contract");
export const AUTH_ORIGIN = Symbol.for("rqw-anthropic/auth-origin");
export type AuthOrigin = { storedOAuth: boolean; bearer?: string };
const PATCH = Symbol.for("rqw-anthropic/recovery-hooks");
const NO_REPLAY = "rqw_anthropic_partial_stream";
type Original = [object, string, PropertyDescriptor];
type State = { count: number; originals: Original[] };
type SummaryOperation = { runtime: ModelRuntime; active: boolean };
type SummaryHandoff = { operation: SummaryOperation; model: unknown; apiKey?: string; origin?: AuthOrigin };

function enabled(runtime: ModelRuntime): boolean {
	return (runtime.getRegisteredProviderConfig("anthropic")?.streamSimple as unknown as Record<symbol, unknown>)?.[OVERLAY] === true;
}
function protectedMessage(message: AssistantMessage): boolean {
	return message.provider === "anthropic" && message.api === "anthropic-messages" &&
		(message.stopReason === "error" || message.stopReason === "length") &&
		message.diagnostics?.some(item => item.type === NO_REPLAY) === true;
}

function hasOutput(message: AssistantMessage): boolean {
	return message.content.some(block => block.type === "toolCall" ||
		(block.type === "text" && block.text.length > 0) ||
		(block.type === "thinking" && block.thinking.length > 0));
}

/** Keep the original message and diagnostic, adding durable provenance rather than changing error text. */
export function protectPartialStream(source: AssistantMessageEventStream) {
	const push = source.push.bind(source);
	let outputStarted = false;
	// Preserve the native stream object and queue; observe parser events without a second consumer.
	source.push = event => {
		if (event.type === "toolcall_start" ||
			((event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta") && event.delta.length > 0)) outputStarted = true;
		const message = event.type === "error" ? event.error : event.type === "done" ? event.message : undefined;
		if (message && (outputStarted || hasOutput(message)) &&
			(message.stopReason === "error" || message.stopReason === "length")) {
			message.diagnostics = [...(message.diagnostics ?? []), { type: NO_REPLAY, timestamp: Date.now() }];
		}
		push(event);
	};
	return source;
}

/** Pi 1.4 has neither a before-retry hook nor separate extension stream contracts. */
export function installRecoveryHooks(Runtime = ModelRuntime, Session = AgentSession): () => void {
	const owner = Runtime as unknown as { [PATCH]?: State };
	let state = owner[PATCH];
	if (!state) {
		const requests = new AsyncLocalStorage<{ runtime: ModelRuntime; origin?: AuthOrigin }>();
		const summaries = new AsyncLocalStorage<SummaryOperation>();
		// Native summaries forward resolved auth as an explicit key. The unique env carries its provenance.
		const handoffs = new WeakMap<object, SummaryHandoff>();
		const summaryFor = (runtime: ModelRuntime, model: unknown, options?: SimpleStreamOptions) => {
			const summary = options?.env && handoffs.get(options.env);
			return summary?.operation.active && summary.operation.runtime === runtime &&
				summary.operation === summaries.getStore() && summary.model === model &&
				summary.apiKey === options?.apiKey && options?.cacheRetention === "none" ? summary : undefined;
		};
		const originals: Original[] = [
			...(["stream", "streamSimple", "prepareRequest", "getAuth"].map(name =>
				[Runtime.prototype, name, Object.getOwnPropertyDescriptor(Runtime.prototype, name)])),
			...(["_isRetryableError", "_checkCompaction", "_runDefaultCompaction", "navigateTree", "summarizeForBugReport",
				"_getSummarizationRequestAuth"].map(name =>
				[Session.prototype, name, Object.getOwnPropertyDescriptor(Session.prototype, name)])),
		] as Original[];
		if (VERSION !== "1.4.0" || originals.some(([, , d]) => typeof d?.value !== "function" || !d.configurable)) {
			throw new Error("RQW-anthropic: incompatible Pi recovery hooks; requires Pi 1.4.0. Nothing was patched.");
		}
		for (const [prototype, name, descriptor] of originals) {
			const original = descriptor.value;
			let wrapped;
			if (name === "stream" || name === "streamSimple") {
				wrapped = function(this: ModelRuntime, model: Parameters<ModelRuntime["stream"]>[0], context: unknown, options?: SimpleStreamOptions) {
					if (model.provider !== "anthropic" || !enabled(this)) return original.call(this, model, context, options);
					return original.call(this, model, context, { ...options, [STREAM_CONTRACT]: name === "stream" ? "native" : "simple" });
				};
			} else if (name === "prepareRequest") {
				wrapped = function(this: ModelRuntime, model: Parameters<ModelRuntime["stream"]>[0], options?: SimpleStreamOptions) {
					if (model.provider !== "anthropic" || !enabled(this)) return original.call(this, model, options);
					const request: { runtime: ModelRuntime; origin?: AuthOrigin } = { runtime: this };
					return requests.run(request, async () => {
						const prepared = await original.call(this, model, options);
						const nativeOrigin = summaryFor(this, model, options)?.origin;
						prepared.options[AUTH_ORIGIN] = nativeOrigin && nativeOrigin.bearer === prepared.options.apiKey ? nativeOrigin :
							request.origin ?? { storedOAuth: false };
						return prepared;
					});
				};
			} else if (name === "getAuth") {
				wrapped = async function(this: ModelRuntime, provider: Parameters<ModelRuntime["getAuth"]>[0], ...args: unknown[]) {
					try {
						const resolution = await original.call(this, provider, ...args);
						const request = requests.getStore();
						if (request?.runtime === this && !request.origin &&
							(typeof provider === "string" ? provider : provider.provider) === "anthropic") {
							request.origin = { storedOAuth: resolution?.source === "OAuth", bearer: resolution?.auth.apiKey };
						}
						return resolution;
					}
					catch (error) {
						if ((typeof provider === "string" ? provider : provider.provider) === "anthropic" && enabled(this)) {
							// Pi wraps proactive refresh failures, then lazyStream keeps only message.
							let cause: unknown = error;
							for (let depth = 0; depth < 4 && cause instanceof Error; depth++) {
								if ((cause as unknown as Record<symbol, unknown>)[AUTH_FAILURE]) throw cause;
								cause = cause.cause;
							}
						}
						throw error;
					}
				};
			} else if (name === "_runDefaultCompaction" || name === "navigateTree" || name === "summarizeForBugReport") {
				wrapped = function(this: AgentSession, ...args: unknown[]) {
					if (!enabled(this.modelRuntime)) return original.apply(this, args);
					const operation: SummaryOperation = { runtime: this.modelRuntime, active: true };
					return summaries.run(operation, async () => {
						try { return await original.apply(this, args); }
						finally { operation.active = false; }
					});
				};
			} else if (name === "_getSummarizationRequestAuth") {
				wrapped = function(this: AgentSession, ...args: unknown[]) {
					const operation = summaries.getStore();
					if (!operation?.active || operation.runtime !== this.modelRuntime) return original.apply(this, args);
					const request: { runtime: ModelRuntime; origin?: AuthOrigin } = { runtime: this.modelRuntime };
					return requests.run(request, async () => {
						const resolved = await original.apply(this, args);
						if (resolved.model.provider !== "anthropic") return resolved;
						const env = { ...resolved.env };
						handoffs.set(env, { operation, model: resolved.model, apiKey: resolved.apiKey, origin: request.origin });
						return { ...resolved, env };
					});
				};
			} else {
				wrapped = function(this: AgentSession, message: AssistantMessage, ...args: unknown[]) {
					if (enabled(this.modelRuntime) && protectedMessage(message)) {
						// Only agent-turn recovery is blocked. Native internal summary retry stays stock.
						return name === "_checkCompaction" ? Promise.resolve(false) : false;
					}
					return original.call(this, message, ...args);
				};
			}
			Object.defineProperty(prototype, name, { ...descriptor, value: wrapped });
		}
		state = { count: 0, originals };
		owner[PATCH] = state;
	}
	state.count++;
	const installed = state;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--installed.count !== 0) return;
		for (const [prototype, name, descriptor] of installed.originals) Object.defineProperty(prototype, name, descriptor);
		delete owner[PATCH];
	};
}
