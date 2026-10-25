import type { Credential, CredentialStore, OAuthCredential } from "@earendil-works/pi-ai";

import { AuthRecoveryError, LOGIN_HELP, PROVIDER_ID, credentialIdentity, jwtExpiryMs, needsRefresh, refreshCredential, validateCredential } from "./auth.ts";

/**
 * "reload": the saved login of the same account is revalidated under the lock and returned as the current
 * grant, with no refresh and no network, even when its access token is unchanged. "refresh": the saved
 * login is refreshed under the same lock regardless.
 */
export type RecoveryStage = "reload" | "refresh";
/** Identity of the login a request was sent with: its account and the access token that was rejected. */
export type RejectedIdentity = { accountId: string; access: string };
export type AuthDependencies = { fetch?: typeof fetch; now?: () => number };

const SUBSCRIPTION_ORIGIN = "https://chatgpt.com";
const SUBSCRIPTION_ENDPOINT = `${SUBSCRIPTION_ORIGIN}/backend-api/codex/responses`;
const SUBSCRIPTION_PATHS = new Set(["/backend-api", "/backend-api/codex/responses"]);

function requireOAuth(value: Credential | undefined): OAuthCredential {
	if (value?.type !== "oauth") throw new AuthRecoveryError(`${LOGIN_HELP} No saved openai-codex login.`, true);
	return validateCredential(value);
}

/**
 * One serialized store transaction. The caller may stop waiting on abort; once the transaction
 * has entered the lock, the refresh and its persistence are never cancelled, so a rotated refresh
 * token is not discarded. No timeout is added: native refresh has none.
 */
async function transact(
	store: CredentialStore,
	signal: AbortSignal,
	body: (current: Credential | undefined) => Promise<{ credential: OAuthCredential; write: boolean }>,
): Promise<OAuthCredential> {
	signal.throwIfAborted();
	const waiting = new AbortController();
	const abortWait = () => waiting.abort(signal.reason);
	signal.addEventListener("abort", abortWait, { once: true });
	const cancelled = Promise.withResolvers<never>();
	const cancel = () => cancelled.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
	signal.addEventListener("abort", cancel, { once: true });
	let settled: OAuthCredential | undefined;
	try {
		const operation = store.modify(PROVIDER_ID, async current => {
			// Inside the lock, cancellation of the wait no longer applies.
			signal.removeEventListener("abort", abortWait);
			const outcome = await body(current);
			settled = outcome.credential;
			return outcome.write ? outcome.credential : undefined;
		}, { signal: waiting.signal });
		await Promise.race([operation, cancelled.promise]);
		signal.throwIfAborted();
		if (settled === undefined) throw new AuthRecoveryError();
		return settled;
	} catch (error) {
		signal.throwIfAborted();
		if (error instanceof AuthRecoveryError) throw error;
		throw new AuthRecoveryError();
	} finally {
		signal.removeEventListener("abort", abortWait);
		signal.removeEventListener("abort", cancel);
	}
}

/**
 * Owner-bound read of the openai-codex slot. A proactively expiring login is refreshed once under the
 * store lock; the returned account identity is the owner snapshot to bind later requests to.
 */
export async function resolveStoredCredential(
	store: CredentialStore,
	signal: AbortSignal,
	dependencies: AuthDependencies = {},
): Promise<{ credential: OAuthCredential; accountId: string }> {
	signal.throwIfAborted();
	const now = dependencies.now ?? Date.now;
	let stored: Credential | undefined;
	try {
		stored = await store.read(PROVIDER_ID, { signal });
	} catch {
		signal.throwIfAborted();
		throw new AuthRecoveryError();
	}
	const credential = requireOAuth(stored);
	const current = needsRefresh(credential, now())
		? await transact(store, signal, async latest => {
			const fresh = requireOAuth(latest);
			if (!needsRefresh(fresh, now())) return { credential: fresh, write: false };
			try {
				const refreshed = await refreshCredential(fresh, new AbortController().signal, dependencies.fetch, { now });
				return { credential: refreshed, write: true };
			} catch (error) {
				// Native proactive failure keeps a bearer that has not genuinely expired.
				const exp = jwtExpiryMs(fresh.access);
				if (exp === undefined || exp > now()) return { credential: fresh, write: false };
				throw error;
			}
		})
		: credential;
	return { credential: current, accountId: credentialIdentity(current) };
}

/**
 * Bounded recovery after a rejected request. Runs under the store lock; never switches to a login of
 * another account. Throws a safe AuthRecoveryError when no usable login results.
 */
export async function recoverCredential(
	store: CredentialStore,
	rejectedIdentity: RejectedIdentity,
	stage: RecoveryStage,
	signal: AbortSignal,
	dependencies: AuthDependencies = {},
): Promise<OAuthCredential> {
	const now = dependencies.now ?? Date.now;
	const result = await transact(store, signal, async latest => {
		const current = requireOAuth(latest);
		if (credentialIdentity(current) !== rejectedIdentity.accountId) {
			throw new AuthRecoveryError(`${LOGIN_HELP} The saved login belongs to another account; it was not used for this request.`, true);
		}
		if (stage === "reload") return { credential: current, write: false };
		const refreshed = await refreshCredential(current, new AbortController().signal, dependencies.fetch, { now });
		return { credential: refreshed, write: true };
	});
	if (stage === "refresh" && result.access === rejectedIdentity.access) {
		throw new AuthRecoveryError(`${LOGIN_HELP} Refresh did not replace the rejected access token.`);
	}
	return result;
}

/**
 * Subscription destination only: official https origin and path, no credentials, query or port,
 * redirects must be errors. Explicit API keys are rejected. The ambient OPENAI_API_KEY is irrelevant here:
 * it is never read, never used as a bearer and never a billing fallback, so an unrelated value in the
 * environment does not refuse a request that is sent with the stored OAuth grant. `env` is accepted for
 * compatibility and ignored.
 * Returns the Codex responses URL.
 */
export function validateSubscriptionEndpoint(
	baseUrl: string,
	options: { redirect?: string; apiKey?: string; env?: Record<string, string | undefined> } = {},
): string {
	if (options.apiKey !== undefined && options.apiKey.length > 0) {
		throw new Error("RQW-codex: explicit API keys are not accepted; use /login openai-codex. Request not sent.");
	}
	if (options.redirect !== undefined && options.redirect !== "error") {
		throw new Error("RQW-codex: subscription requests must use redirect: \"error\". Request not sent.");
	}
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		throw new Error("RQW-codex: subscription endpoint is not a valid URL. Request not sent.");
	}
	const path = url.pathname.replace(/\/+$/, "");
	if (url.protocol !== "https:" || url.origin !== SUBSCRIPTION_ORIGIN || url.port !== "" || url.username !== "" || url.password !== ""
		|| url.search !== "" || url.hash !== "" || !SUBSCRIPTION_PATHS.has(path)) {
		throw new Error("RQW-codex: subscription tokens may only be sent to https://chatgpt.com/backend-api. Request not sent.");
	}
	return SUBSCRIPTION_ENDPOINT;
}
