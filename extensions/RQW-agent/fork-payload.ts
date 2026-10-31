import { AgentSession, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";

export type ForkPayload = { model: Model<Api>; payload: Record<string, unknown>; options: SimpleStreamOptions };

/** Find the session behind Pi 1.4's public context without keeping a prototype patch installed. */
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
			if (!session || typeof session.agent?.streamFunction !== "function") return;
			const original = session.agent.streamFunction;
			let active = true;
			const wrapped: typeof original = (model, context, options) => {
				if (!active || model.api !== "anthropic-messages" || options?.sessionId !== session.sessionManager.getSessionId()) return original(model, context, options);
				const onPayload = options.onPayload;
				return original(model, context, { ...options, async onPayload(payload, requestModel) {
					const transformed = await onPayload?.(payload, requestModel) ?? payload;
					if (active) {
						last = undefined;
						if (transformed && typeof transformed === "object" && !Array.isArray(transformed)) {
							try { last = { model, payload: structuredClone(transformed as Record<string, unknown>), options: { cacheRetention: options.cacheRetention, sessionId: options.sessionId, reasoning: options.reasoning } }; }
							catch { /* An uncopyable payload leaves forking unavailable, not the caller's request. */ }
						}
					}
					return transformed;
				} });
			};
			session.agent.streamFunction = wrapped;
			release = () => { active = false; if (session.agent.streamFunction === wrapped) session.agent.streamFunction = original; };
		},
		get() { return last && structuredClone(last); },
		clear() { last = undefined; },
		close() { release?.(); release = undefined; bound = undefined; last = undefined; },
	};
}
