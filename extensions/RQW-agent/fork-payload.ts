import { AgentSession, VERSION, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";

// Shared by the capture extensions through a symbol, without cross-extension imports.
const REQUEST_OWNER = Symbol.for("rqw:request-owner:v1");
const REQUEST_LAYER = Symbol.for("rqw:request-stream-layer:v1");
const WARMER_LAYER = Symbol.for("rqw:request-warmer-layer:v1");
type RequestOwner = { sessionId: string | undefined; kind: "request" | "cache-replay" };
type CaptureOptions = import("@earendil-works/pi-ai").ModelsSimpleStreamOptions & { [REQUEST_OWNER]?: RequestOwner };
type CaptureStream = (model: Model<Api>, context: Context, options?: CaptureOptions) => unknown;

function installCapture(session: AgentSession, ctx: ExtensionContext, capture: (model: Model<Api>, context: Context, options: CaptureOptions) => CaptureOptions): (() => void) | undefined {
	const runtime = session.modelRuntime as unknown as Record<string, unknown> | undefined;
	const warmer = (session as unknown as { _cacheWarmer?: { models: Record<string, unknown> } })._cacheWarmer;
	const writable = (target: object, key: string) => {
		const own = Object.getOwnPropertyDescriptor(target, key);
		if (own) return "value" in own && own.writable === true;
		if (!Object.isExtensible(target)) return false;
		for (let proto = Object.getPrototypeOf(target); proto; proto = Object.getPrototypeOf(proto)) {
			const inherited = Object.getOwnPropertyDescriptor(proto, key);
			if (inherited) return "value" in inherited && inherited.writable === true;
		}
		return true;
	};
	if (VERSION !== "1.5.0" || !runtime || typeof runtime.stream !== "function" || typeof runtime.streamSimple !== "function" ||
		!writable(runtime, "stream") || !writable(runtime, "streamSimple") ||
		(!warmer || !warmer.models || typeof warmer.models.streamSimple !== "function" || !writable(warmer, "models"))) {
		ctx.ui?.notify("Request capture unavailable: incompatible Pi runtime.", "warning");
		return undefined;
	}
	let active = true;
	const seen = Symbol("capture");
	const restores: (() => void)[] = [];
	for (const key of ["stream", "streamSimple"]) {
		const descriptor = Object.getOwnPropertyDescriptor(runtime, key);
		const original = runtime[key] as CaptureStream;
		const wrapped: CaptureStream = function(this: unknown, model, context, options) {
			const marked = options as (CaptureOptions & { [seen]?: boolean }) | undefined;
			const owner = options?.[REQUEST_OWNER];
			const id = owner ? owner.sessionId : options?.sessionId;
			if (active && !marked?.[seen] && owner?.kind !== "cache-replay" && id !== undefined && id === session.sessionManager.getSessionId()) {
				const next = capture(model, context, options ?? {});
				options = { ...next, [seen]: true } as CaptureOptions;
			}
			return original.call(this, model, context, options);
		};
		const layer = { active: true, descriptor };
		Object.defineProperty(wrapped, REQUEST_LAYER, { value: layer });
		runtime[key] = wrapped;
		restores.push(() => {
			layer.active = false;
			if (runtime[key] !== wrapped) return;
			let previous = layer.descriptor;
			while (previous && typeof previous.value === "function" && previous.value[REQUEST_LAYER]?.active === false) {
				previous = previous.value[REQUEST_LAYER].descriptor;
			}
			if (previous) Object.defineProperty(runtime, key, previous);
			else delete runtime[key];
		});
	}
	if (warmer) {
		const original = warmer.models;
		const view = Object.create(original) as Record<string, unknown>;
		view.streamSimple = (model: Model<Api>, context: Context, options?: CaptureOptions) => {
			const owner = options?.[REQUEST_OWNER];
			const forwarded = active ? { ...options, [REQUEST_OWNER]: { sessionId: owner ? owner.sessionId : options?.sessionId, kind: "cache-replay" as const } } : options;
			return (original.streamSimple as CaptureStream).call(original, model, context, forwarded);
		};
		const layer = { active: true, previous: original };
		Object.defineProperty(view, WARMER_LAYER, { value: layer });
		warmer.models = view;
		restores.push(() => {
			layer.active = false;
			if (warmer.models !== view) return;
			let previous = layer.previous;
			let covered = Object.getOwnPropertyDescriptor(previous, WARMER_LAYER)?.value;
			while (covered?.active === false) {
				previous = covered.previous;
				covered = Object.getOwnPropertyDescriptor(previous, WARMER_LAYER)?.value;
			}
			warmer.models = previous;
		});
	}
	return () => { active = false; for (const restore of restores.reverse()) restore(); };
}


export type ForkPayload = { model: Model<Api>; payload: Record<string, unknown>; options: SimpleStreamOptions };

/** Find the session behind Pi 1.4's public context without keeping a prototype patch installed. */
export function sessionOf(ctx: ExtensionContext): AgentSession | undefined {
	const prototype = AgentSession.prototype;
	const descriptor = Object.getOwnPropertyDescriptor(prototype, "isIdle");
	if (typeof descriptor?.get !== "function" || !descriptor.configurable) return undefined;
	let captured: unknown;
	Object.defineProperty(prototype, "isIdle", { ...descriptor, get(this: unknown) { captured = this; return true; } });
	try { ctx.isIdle(); } catch { captured = undefined; } finally { Object.defineProperty(prototype, "isIdle", descriptor); }
	const session = captured as AgentSession | undefined;
	return session && session.sessionManager === ctx.sessionManager ? session : undefined;
}

/** Retain the last transformed provider payload for this caller only. */
export function forkPayloads() {
	let last: ForkPayload | undefined;
	let release: (() => void) | undefined;
	let bound: AgentSession | undefined;
	return {
		bind(ctx: ExtensionContext) {
			const session = sessionOf(ctx);
			if (session === bound) return;
			release?.();
			last = undefined;
			bound = session;
			if (!session) return;
			let active = true;
			const uninstall = installCapture(session, ctx, (model, _context, options) => {
				if (!["anthropic-messages", "openai-codex-responses"].includes(model.api)) return options;
				const onPayload = options.onPayload;
				const onPreparedPayload = (options as CaptureOptions & { onPreparedPayload?: (payload: unknown) => void }).onPreparedPayload;
				const capturePayload = (payload: unknown) => {
					if (!active) return;
					last = undefined;
					if (payload && typeof payload === "object" && !Array.isArray(payload)) {
						try { last = { model, payload: structuredClone(payload as Record<string, unknown>), options: { cacheRetention: options.cacheRetention, sessionId: options[REQUEST_OWNER] ? options[REQUEST_OWNER].sessionId : options.sessionId, reasoning: options.reasoning } }; }
						catch { /* An uncopyable payload leaves forking unavailable. */ }
					}
				};
				return { ...options, onPreparedPayload(payload: unknown) {
					onPreparedPayload?.(payload);
					capturePayload(payload);
				}, async onPayload(payload, requestModel) {
					const transformed = await onPayload?.(payload, requestModel) ?? payload;
					capturePayload(transformed);
					return transformed;
				} } as CaptureOptions;
			});
			release = () => { active = false; uninstall?.(); };
		},
		get() { return last && structuredClone(last); },
		clear() { last = undefined; },
		close() { release?.(); release = undefined; bound = undefined; last = undefined; },
	};
}
