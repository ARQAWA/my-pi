import { randomUUID } from "node:crypto";
import type { CredentialStore, Provider, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { AuthRecoveryError, LOGIN_HELP, recoverCredential } from "./auth.ts";
import { assertAnthropicAuthBoundary } from "./auth-boundary.ts";
import { subscriptionCacheOptions } from "./cache.ts";
import { AUTH_ORIGIN, protectPartialStream, STREAM_CONTRACT, summarySink, type AuthOrigin } from "./retry.ts";
import { billingBody, versionState, type VersionState } from "./wire.ts";
import { OVERLAY } from "./registration.ts";
import { contextForks } from "./context-fork.ts";
import { attachHttpDiagnostic, httpDiagnostic, type HttpDiagnostic } from "./retry-hints.ts";

// Shared side-request contract: preserve Claude Code identity without replacing the main snapshot.
const SESSION_IDENTITY = Symbol.for("rqw-anthropic/session-identity");

/** Retries HTTP rejections only, before any stream bytes can escape to the agent. */
export function subscriptionFetch(
	transport: typeof fetch, store: CredentialStore | undefined, version: VersionState,
	sessionId: string, deviceId: string, initialSignal?: AbortSignal, origin?: AuthOrigin,
	observe?: (response: Response | undefined) => void,
	/** False for a cooperative context fork: a rejected request is never sent again (no 401 recovery, no version replay). */
	repeat = true,
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
		const bearer = headers.get("authorization")?.replace(/^Bearer /i, "");
		// Runtime provenance precedes payload hooks. Direct helpers require first-fetch store equality.
		const initial = origin === undefined ? await store?.read("anthropic", { signal }) : undefined;
		const owned = origin === undefined ? initial?.type === "oauth" && initial.access === bearer :
			origin.storedOAuth && origin.bearer === bearer;
		let authRetried = false;
		let versionRetried = false;
		for (;;) {
			signal.throwIfAborted();
			// A resend starts clean: only the final answer, or none, may describe the failure.
			observe?.(undefined);
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
			observe?.(response);
			if (response.status === 401) {
				await response.body?.cancel();
				if (!repeat || authRetried || !store || !owned || !bearer) throw new AuthRecoveryError();
				authRetried = true;
				headers.set("authorization", `Bearer ${await recoverCredential(store, bearer, signal, transport)}`);
				continue;
			}
			if (response.status === 400 && repeat && !versionRetried) {
				const text = await response.clone().text();
				if (version.adopt(text, sentVersion)) {
					await response.body?.cancel();
					versionRetried = true;
					continue;
				}
			}
			if (response.status === 403) {
				await response.body?.cancel();
				throw new AuthRecoveryError("RQW-anthropic: subscription access denied, HTTP 403. Check account permissions and quota; use /login anthropic if access changed.", 403);
			}
			return response;
		}
	};
}

export function createOverlay(
	base: Provider, getStore: () => CredentialStore | undefined, deviceId: string,
	version = versionState(),
	repeat = true,
) {
	const forks = contextForks(single => {
		const store = getStore();
		const isolated = createOverlay(base, () => store, deviceId, version.fork(), !single);
		return (model, context, options) => isolated.streamSimple(model, context as Parameters<Provider["streamSimple"]>[1], options);
	});
	const handler = (model: Parameters<Provider["streamSimple"]>[0], context: Parameters<Provider["streamSimple"]>[1], options?: SimpleStreamOptions) => {
		// Pi merges both entrypoints into this handler; retain the original options contract.
		const provenance = options as (SimpleStreamOptions & { [STREAM_CONTRACT]?: string; [AUTH_ORIGIN]?: AuthOrigin; [SESSION_IDENTITY]?: string }) | undefined;
		const contract = provenance?.[STREAM_CONTRACT];
		const simple = contract === "simple" || (!contract && options && ("reasoning" in options || "thinkingBudgets" in options));
		const delegate = simple ? base.streamSimple.bind(base) : base.stream.bind(base);
		if (!assertAnthropicAuthBoundary(model, options, process.env.ANTHROPIC_CUSTOM_HEADERS)) return delegate(model, context, options);
		const transport = options?.fetch ?? globalThis.fetch;
		let rejection: HttpDiagnostic | undefined;
		const subscription = subscriptionFetch(transport, getStore(), version, provenance?.[SESSION_IDENTITY] ?? options?.sessionId ?? randomUUID(), deviceId,
			options?.signal, provenance?.[AUTH_ORIGIN],
			// The server's own answer, before 401 and 403 are replaced by recovery or a synthetic error.
			response => { rejection = response && !response.ok ? httpDiagnostic(response.status, response.headers) : undefined; },
			repeat);
		const effective = subscriptionCacheOptions(options);
		const retention = effective?.cacheRetention ??
			((effective?.env?.PI_CACHE_RETENTION ?? process.env.PI_CACHE_RETENTION) === "long" ? "long" : "short");
		const fetch: typeof globalThis.fetch = async (input, init) => {
			const request = new Request(input, init);
			forks.capture(model, context, { ...effective, cacheRetention: retention, fetch: transport }, await request.clone().text());
			try { return await subscription(request); }
			catch (error) {
				options?.signal?.throwIfAborted();
				if (!(error instanceof AuthRecoveryError)) throw error;
				// A fetch exception becomes SDK APIConnectionError. An HTTP response keeps auth semantics.
				return Response.json({ type: "error", error: {
					type: error.status === 403 ? "permission_error" : "authentication_error", message: error.message || LOGIN_HELP,
				} }, { status: error.status, headers: { "x-should-retry": "false" } });
			}
		};
		// A supplied SDK client skips Pi's OAuth builder and ignores this protected fetch.
		const stream = delegate(model, context, { ...subscriptionCacheOptions(options), client: undefined, maxRetries: 0, fetch });
		return protectPartialStream(attachHttpDiagnostic(stream, () => rejection, summarySink(), options?.signal));
	};
	Object.assign(handler, { [OVERLAY]: true });
	return { api: "anthropic-messages", streamSimple: handler, forks };
}
