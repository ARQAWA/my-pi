import { setTimeout as sleep } from "node:timers/promises";
import type { CredentialStore, OAuthCredential } from "@earendil-works/pi-ai";

import { Type } from "typebox";
import { Compile } from "typebox/compile";

const TokenResponse = Compile(Type.Object({
    access_token: Type.String({ pattern: "^sk-ant-oat" }),
    refresh_token: Type.String({ minLength: 1 }),
    expires_in: Type.Number({ exclusiveMinimum: 300 }),
}));

const OAuthRecord = Compile(Type.Object({
    type: Type.Literal("oauth"), access: Type.String({ pattern: "^sk-ant-oat" }),
    refresh: Type.String({ minLength: 1 }), expires: Type.Number(),
}));

export function validateCredential(value: unknown): OAuthCredential {
    if (!OAuthRecord.Check(value) || !Number.isFinite(value.expires) || value.expires <= Date.now()) {
        throw new Error(LOGIN_HELP);
    }
    return value;
}

export const TOKEN_URL = "https://api.anthropic.com/v1/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const LOGIN_HELP = "RQW-anthropic: subscription authentication failed. Retry the turn; if it persists, use /login anthropic. Saved credentials were not removed.";

/** Only transport failures, 429 and 5xx merit a second refresh attempt. Never log response bodies. */
export async function refreshCredential(
	credential: OAuthCredential, signal: AbortSignal, transport: typeof fetch = globalThis.fetch,
): Promise<OAuthCredential> {
	for (let attempt = 0; attempt < 2; attempt++) {
		signal.throwIfAborted();
		let response: Response;
		try {
			response = await transport(TOKEN_URL, {
				method: "POST", redirect: "error", signal,
				headers: {
					"content-type": "application/json", "accept": "application/json",
					"anthropic-beta": "oauth-2025-04-20",
					"user-agent": "anthropic-sdk-typescript/0.112.1 userOAuthProvider",
				},
				body: JSON.stringify({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: credential.refresh }),
			});
		} catch {
			signal.throwIfAborted();
			if (attempt === 1) throw new Error(LOGIN_HELP);
			await sleep(100, undefined, { signal });
			continue;
		}
		if (!response.ok) {
			await response.body?.cancel();
			if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
				await sleep(100, undefined, { signal });
				continue;
			}
			throw new Error(`${LOGIN_HELP} Refresh HTTP ${response.status}.`);
		}
		let data: unknown;
		try { data = await response.json(); } catch { throw new Error(LOGIN_HELP); }
		if (!TokenResponse.Check(data)) {
			throw new Error(`${LOGIN_HELP} Invalid token response.`);
		}
		return { ...credential, type: "oauth", access: data.access_token, refresh: data.refresh_token,
			expires: Date.now() + data.expires_in * 1000 - 300_000 };
	}
	throw new Error(LOGIN_HELP);
}

/** Abort the wait promptly without abandoning a refresh token already rotating under the store lock. */
export async function recoverCredential(
	store: CredentialStore, rejected: string, signal: AbortSignal, transport: typeof fetch,
): Promise<string> {
	signal.throwIfAborted();
	const waiting = new AbortController();
	const abortWait = () => waiting.abort(signal.reason);
	signal.addEventListener("abort", abortWait, { once: true });
	const cancelled = Promise.withResolvers<never>();
	const cancel = () => cancelled.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
	signal.addEventListener("abort", cancel, { once: true });
	try {
		const operation = store.modify("anthropic", async current => {
			// From this point cancellation must not discard a rotated refresh token.
			signal.removeEventListener("abort", abortWait);
			signal.throwIfAborted();
			if (current?.type !== "oauth") throw new Error(LOGIN_HELP);
			if (current.access !== rejected) return undefined;
			return refreshCredential(current, AbortSignal.timeout(15_000), transport);
		}, { signal: waiting.signal });
		const result = await Promise.race([operation, cancelled.promise]);
		signal.throwIfAborted();
		if (result?.type !== "oauth" || result.access === rejected) throw new Error(LOGIN_HELP);
		return result.access;
	} catch {
		signal.throwIfAborted();
		throw new Error(LOGIN_HELP);
	} finally {
		signal.removeEventListener("abort", abortWait);
		signal.removeEventListener("abort", cancel);
	}
}
