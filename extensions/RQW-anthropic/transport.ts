import { randomUUID } from "node:crypto";
import type { CredentialStore, Provider, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { LOGIN_HELP, recoverCredential } from "./auth.ts";
import { billingBody, versionState } from "./wire.ts";
import type { VersionState } from "./wire.ts";
import { assertAnthropicAuthBoundary } from "./auth-boundary.ts";
import { OVERLAY } from "./visibility.ts";

/** Retries HTTP rejections only, before any stream bytes can escape to the agent. */
export function subscriptionFetch(
	transport: typeof fetch, store: CredentialStore | undefined, version: VersionState,
	sessionId: string, deviceId: string, initialSignal?: AbortSignal,
): typeof fetch {
	return async (input, init) => {
		const request = new Request(input, { ...init, redirect: "error" });
		if (new URL(request.url).origin !== "https://api.anthropic.com") {
			throw new Error("RQW-anthropic: subscription tokens may only be sent to https://api.anthropic.com");
		}
		const signal = initialSignal ? AbortSignal.any([initialSignal, request.signal]) : request.signal;
		signal.throwIfAborted();
		const raw = await request.text();
		const headers = new Headers(request.headers);
		let authRetried = false;
		let versionRetried = false;
		for (;;) {
			signal.throwIfAborted();
			const sentVersion = version.value;
			headers.set("user-agent", `claude-cli/${sentVersion} (external, cli)`);
			headers.set("x-app", "cli");
			headers.set("x-client-request-id", randomUUID());
			headers.set("x-claude-code-session-id", sessionId);
			headers.delete("x-api-key");
			headers.delete("content-length");
			const response = await transport(request.url, {
				method: request.method, headers, signal, redirect: "error",
				body: billingBody(raw, sentVersion, sessionId, deviceId),
			});
			if (response.status === 401) {
				await response.body?.cancel();
				if (authRetried || !store) throw new Error(LOGIN_HELP);
				authRetried = true;
				const bearer = headers.get("authorization")?.replace(/^Bearer /i, "");
				if (!bearer) throw new Error(LOGIN_HELP);
				headers.set("authorization", `Bearer ${await recoverCredential(store, bearer, signal, transport)}`);
				continue;
			}
			if (response.status === 400 && !versionRetried) {
				const text = await response.clone().text();
				if (version.adopt(text, sentVersion)) {
					await response.body?.cancel();
					versionRetried = true;
					continue;
				}
			}
			if (response.status === 403) {
				await response.body?.cancel();
				throw new Error("RQW-anthropic: subscription access denied, HTTP 403. Check account permissions and quota; use /login anthropic if access changed.");
			}
			return response;
		}
	};
}

export function createOverlay(
	base: Provider, getStore: () => CredentialStore | undefined, deviceId: string,
	version = versionState(),
) {
	const handler = (model: Parameters<Provider["streamSimple"]>[0], context: Parameters<Provider["streamSimple"]>[1], options?: SimpleStreamOptions) => {
		// The Pi composer sends both stream contracts here. Keep explicit API-shaped thinking options.
		const apiShaped = options && ["thinkingEnabled", "effort", "thinkingBudgetTokens"].some(key => key in options);
		const delegate = apiShaped ? base.stream.bind(base) : base.streamSimple.bind(base);
		if (!assertAnthropicAuthBoundary(model, options, process.env.ANTHROPIC_CUSTOM_HEADERS)) return delegate(model, context, options);
		const transport = options?.fetch ?? globalThis.fetch;
		return delegate(model, context, { ...options, maxRetries: 0,
			fetch: subscriptionFetch(transport, getStore(), version, options?.sessionId ?? randomUUID(), deviceId, options?.signal) });
	};
	Object.assign(handler, { [OVERLAY]: true });
	return { api: "anthropic-messages", streamSimple: handler };
}
