import { AsyncLocalStorage } from "node:async_hooks";
import { type AssistantMessage, type AssistantMessageEventStream, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { AgentSession, ModelRuntime, VERSION } from "@earendil-works/pi-coding-agent";
import { isContextOverflow } from "@earendil-works/pi-ai/compat";
import { AUTH_FAILURE } from "./auth.ts";
import { type HttpDiagnostic, planServerRetry, readHttpDiagnostic, sleep, type SummarySink } from "./retry-hints.ts";
import { OVERLAY } from "./registration.ts";

export const STREAM_CONTRACT = Symbol.for("rqw-anthropic/stream-contract");
export const AUTH_ORIGIN = Symbol.for("rqw-anthropic/auth-origin");
export type AuthOrigin = { storedOAuth: boolean; bearer?: string };
const PATCH = Symbol.for("rqw-anthropic/recovery-hooks");
const NO_REPLAY = "rqw_anthropic_partial_stream";
type Original = [object, string, PropertyDescriptor];
type State = { count: number; originals: Original[] };
type SummaryOperation = { runtime: ModelRuntime; active: boolean; pacing?: boolean; pending?: { rejection: HttpDiagnostic; signal?: AbortSignal } };
const summaries = new AsyncLocalStorage<SummaryOperation>();
type SummaryHandoff = { operation: SummaryOperation; model: unknown; apiKey?: string; origin?: AuthOrigin };

/** Inside a native summary operation, where its requests report the server's retry control to Pi's retry loop. */
export function summarySink(): SummarySink | undefined {
	const operation = summaries.getStore();
	if (!operation?.active) return undefined;
	// A new request starts without the previous failure's directive.
	operation.pending = undefined;
	return (rejection, signal) => { operation.pending = { rejection, signal }; };
}

/** One shared wrapper per settings manager, counted by the operations that use it. */
const pacedManagers = new WeakMap<object, { count: number; restore(): void }>();
/**
 * Inside a bug-report operation only, Pi's retry policy reads that operation's directive when it computes a wait:
 * the delay replaces the backoff and a forbidden or too long retry ends the summary with a clear error.
 * Overlapping operations share the wrapper, which finds its operation by async context; the last one restores it.
 */
function paceByServer(manager: AgentSession["settingsManager"]): (() => void) | undefined {
	if (typeof manager?.getRetrySettings !== "function") return undefined;
	let held = pacedManagers.get(manager);
	if (!held) {
		const own = Object.getOwnPropertyDescriptor(manager, "getRetrySettings");
		const stock = manager.getRetrySettings.bind(manager);
		manager.getRetrySettings = () => {
			const settings = stock();
			const operation = summaries.getStore();
			if (!operation?.pacing) return settings;
			const served = (): number | undefined => {
				const plan = planServerRetry(operation.pending?.rejection, settings.maxAgentDelayMs ?? 60_000);
				if ("stop" in plan) throw new Error(plan.stop);
				return plan.delayMs;
			};
			return {
				...settings,
				get baseDelayMs() { return served() ?? settings.baseDelayMs; },
				get maxAgentDelayMs() { return served() ?? settings.maxAgentDelayMs; },
			};
		};
		held = {
			count: 0,
			restore() {
				if (own) Object.defineProperty(manager, "getRetrySettings", own);
				else delete (manager as { getRetrySettings?: unknown }).getRetrySettings;
			},
		};
		pacedManagers.set(manager, held);
	}
	const shared = held;
	shared.count++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--shared.count > 0) return;
		shared.restore();
		pacedManagers.delete(manager);
	};
}

/** Every session in the process passes through these hooks; a runtime of another shape or provider stays stock. */
function enabled(runtime: ModelRuntime | undefined): boolean {
	if (typeof runtime?.getRegisteredProviderConfig !== "function") return false;
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
		// Retry planning is optional: a private method of another shape stays stock, the rest keeps working.
		for (const name of ["_prepareRetry", "_summarizationRetryCallbacks"]) {
			const descriptor = Object.getOwnPropertyDescriptor(Session.prototype, name);
			if (typeof descriptor?.value === "function" && descriptor.configurable) originals.push([Session.prototype, name, descriptor]);
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
						// The bug-report summary has no retry callbacks: its policy follows the server instead.
						operation.pacing = name === "summarizeForBugReport";
						const unpace = operation.pacing ? paceByServer(this.settingsManager) : undefined;
						try { return await original.apply(this, args); }
						finally {
							operation.active = false;
							unpace?.();
						}
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
			} else if (name === "_isRetryableError") {
				wrapped = function(this: AgentSession, message: AssistantMessage, ...args: unknown[]) {
					if (!enabled(this.modelRuntime)) return original.call(this, message, ...args);
					if (protectedMessage(message)) return false;
					const rejection = readHttpDiagnostic(message);
					if (rejection?.shouldRetry === false) return false;
					const retryable = original.call(this, message, ...args);
					if (retryable || rejection?.shouldRetry !== true || message.stopReason !== "error") return retryable;
					const modelFor = (this as unknown as { _modelForMessage?(message: AssistantMessage): { contextWindow?: number } | undefined })._modelForMessage;
					if (typeof modelFor !== "function") return retryable;
					const window = (modelFor.call(this, message) ?? this.model)?.contextWindow ?? 0;
					return !isContextOverflow(message, window);
				};
			} else if (name === "_prepareRetry") {
				wrapped = function(this: AgentSession, message: AssistantMessage, ...args: unknown[]) {
					const rejection = enabled(this.modelRuntime) && !protectedMessage(message) ? readHttpDiagnostic(message) : undefined;
					const manager = this.settingsManager;
					if (typeof manager?.getRetrySettings !== "function") return original.call(this, message, ...args);
					const settings = manager.getRetrySettings();
					const plan = planServerRetry(rejection, settings.maxAgentDelayMs ?? 60_000);
					if ("stop" in plan) {
						message.errorMessage = `${plan.stop} ${message.errorMessage ?? ""}`.trim();
						return Promise.resolve(false);
					}
					if (plan.delayMs === undefined) return original.call(this, message, ...args);
					// Pi reads its settings once, before its first await: its own budget and attempt count stay, only the wait differs.
					const own = Object.getOwnPropertyDescriptor(manager, "getRetrySettings");
					manager.getRetrySettings = () => ({ ...settings, baseDelayMs: plan.delayMs!, maxAgentDelayMs: plan.delayMs! });
					try { return original.call(this, message, ...args); }
					finally {
						if (own) Object.defineProperty(manager, "getRetrySettings", own);
						else delete (manager as { getRetrySettings?: unknown }).getRetrySettings;
					}
				};
			} else if (name === "_summarizationRetryCallbacks") {
				wrapped = function(this: AgentSession, ...args: unknown[]) {
					const callbacks = original.apply(this, args);
					const operation = summaries.getStore();
					if (!operation?.active || operation.runtime !== this.modelRuntime || typeof this.settingsManager?.getRetrySettings !== "function") return callbacks;
					return { ...callbacks, onRetryScheduled: async (attempt: number, maxAttempts: number, delayMs: number, errorMessage: string) => {
						const pending = operation.pending;
						operation.pending = undefined;
						const plan = planServerRetry(pending?.rejection, this.settingsManager.getRetrySettings().maxAgentDelayMs ?? 60_000);
						if ("stop" in plan) {
							await callbacks.onRetryFinished?.(false, attempt, errorMessage);
							throw new Error(`${plan.stop} ${errorMessage}`);
						}
						const wait = Math.max(delayMs, plan.delayMs ?? 0);
						await callbacks.onRetryScheduled?.(attempt, maxAttempts, wait, errorMessage);
						// Pi's loop sleeps delayMs right after this callback; the rest of the server's delay is waited here.
						if (wait > delayMs) await sleep(wait - delayMs, pending?.signal).catch(() => undefined);
					} };
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
