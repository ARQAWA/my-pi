import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { isOAuth } from "./auth-boundary.ts";
import { OVERLAY } from "./visibility.ts";

/** Explicit request and environment preferences retain stock Pi semantics, even empty values. */
export function subscriptionCacheOptions(options: SimpleStreamOptions | undefined): SimpleStreamOptions | undefined {
	if (options?.cacheRetention !== undefined || options?.env?.PI_CACHE_RETENTION !== undefined ||
		process.env.PI_CACHE_RETENTION !== undefined) return options;
	return { ...options, cacheRetention: "long" };
}

/** Run before sdk.js starts CacheWarmer, not just before provider dispatch. */
export function bindSessionCache(session: AgentSession): () => void {
	const agent = session.agent;
	const original = agent.streamFunction;
	const wrapped: typeof original = async (model, context, options) => {
		const overlay = session.modelRuntime.getRegisteredProviderConfig("anthropic")?.streamSimple;
		if (model.provider !== "anthropic" || model.api !== "anthropic-messages" ||
			!(overlay as unknown as Record<symbol, unknown>)?.[OVERLAY] ||
			subscriptionCacheOptions(options) === options) return original(model, context, options);
		// Resolve through Pi so API keys, scoped env and model auth have their normal precedence.
		// Do not forward the resolved key: native request preparation must retain OAuth provenance.
		const auth = await session.modelRuntime.getAuth(model, {
			apiKey: options?.apiKey, env: options?.env, signal: options?.signal,
		});
		if (!isOAuth(auth?.auth.apiKey)) return original(model, context, options);
		const scoped = { ...options, env: { ...auth?.env, ...options?.env } };
		return original(model, context, subscriptionCacheOptions(scoped));
	};
	agent.streamFunction = wrapped;
	return () => { if (agent.streamFunction === wrapped) agent.streamFunction = original; };
}
