import { createHash } from "node:crypto";
import type { CredentialStore, OAuthCredential } from "@earendil-works/pi-ai";

import { Type } from "typebox";
import { retryHints, sleep } from "./retry-hints.ts";
import { Compile } from "typebox/compile";

const TokenResponse = Compile(Type.Object({
    access_token: Type.String({ pattern: "^sk-ant-oat" }),
    refresh_token: Type.Optional(Type.String({ minLength: 1, pattern: "^\\S+$" })),
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
export const AUTH_FAILURE = Symbol.for("rqw-anthropic/auth-failure");
const MAX_ROTATIONS = 256;
const REFRESH_BUDGET_MS = 15_000;
const RETRY_PAUSE_MS = 100;
const TokenHash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const RefreshProof = Compile(Type.Object({
	previous: Type.Array(TokenHash, { maxItems: MAX_ROTATIONS }),
	access: TokenHash, refresh: TokenHash,
}));
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function refreshHistory(credential: OAuthCredential): string[] {
	const proof = credential.rqwAnthropicRefresh;
	if (!RefreshProof.Check(proof) || proof.access !== hash(credential.access) || proof.refresh !== hash(credential.refresh)) return [];
	return proof.previous;
}

function recordRotation(previous: OAuthCredential, next: OAuthCredential): void {
	// Pi persists proof and the rotated grant together under its cross-process store lock.
	next.rqwAnthropicRefresh = {
		previous: [...refreshHistory(previous), hash(previous.access)].slice(-MAX_ROTATIONS),
		access: hash(next.access), refresh: hash(next.refresh),
	};
}

function provenRotation(previous: string, current: OAuthCredential): boolean {
	return refreshHistory(current).includes(hash(previous));
}

export class AuthRecoveryError extends Error {
	readonly [AUTH_FAILURE] = true;
	readonly status: number;
	constructor(message = LOGIN_HELP, status = 401) { super(message); this.status = status; }
}

/** Only transport failures, 429 and 5xx merit a second refresh attempt. Never log response bodies. */
export async function refreshCredential(
	credential: OAuthCredential, signal: AbortSignal, transport: typeof fetch = globalThis.fetch,
): Promise<OAuthCredential> {
	signal.throwIfAborted();
	if (typeof credential.refresh !== "string" || credential.refresh.trim().length === 0) {
		throw new AuthRecoveryError(`${LOGIN_HELP} Saved refresh token is invalid.`);
	}
	const started = Date.now();
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
			if (attempt === 1) throw new AuthRecoveryError(`${LOGIN_HELP} Token endpoint could not be reached.`);
			await sleep(RETRY_PAUSE_MS, signal);
			continue;
		}
		if (!response.ok) {
			await response.body?.cancel();
			const hints = retryHints(response.headers);
			if (attempt === 0 && (response.status === 429 || response.status >= 500) && hints.shouldRetry !== false) {
				const delay = hints.delayMs ?? RETRY_PAUSE_MS;
				if (Date.now() - started + delay >= REFRESH_BUDGET_MS) {
					throw new AuthRecoveryError(`${LOGIN_HELP} Refresh HTTP ${response.status}. Server retry delay exceeds the refresh deadline.`);
				}
				await sleep(delay, signal);
				continue;
			}
			const meaning = response.status === 400 ? " Refresh grant was rejected or invalid." :
				response.status === 401 ? " Refresh authentication was rejected." :
				response.status === 403 ? " Refresh permission was denied." : "";
			throw new AuthRecoveryError(`${LOGIN_HELP} Refresh HTTP ${response.status}.${meaning}`);
		}
		let data: unknown;
		try { data = await response.json(); } catch { throw new AuthRecoveryError(`${LOGIN_HELP} Invalid token response.`); }
		if (!TokenResponse.Check(data) || !Number.isFinite(data.expires_in)) {
			throw new AuthRecoveryError(`${LOGIN_HELP} Invalid token response.`);
		}
		// Pi already applies its five-minute minimum validity under the store lock.
		const next: OAuthCredential = { ...credential, type: "oauth", access: data.access_token, refresh: data.refresh_token ?? credential.refresh,
			expires: Date.now() + data.expires_in * 1000 };
		recordRotation(credential, next);
		return next;
	}
	throw new AuthRecoveryError();
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
			if (current?.type !== "oauth") throw new AuthRecoveryError();
			if (current.access !== rejected) {
				if (!provenRotation(rejected, current)) {
					throw new AuthRecoveryError(`${LOGIN_HELP} Saved login changed without a proven refresh. Start a new turn to use the current login.`);
				}
				return undefined;
			}
			return refreshCredential(current, AbortSignal.timeout(15_000), transport);
		}, { signal: waiting.signal });
		const result = await Promise.race([operation, cancelled.promise]);
		signal.throwIfAborted();
		if (result?.type !== "oauth" || result.access === rejected) throw new AuthRecoveryError();
		return result.access;
	} catch (error) {
		signal.throwIfAborted();
		if (error instanceof AuthRecoveryError) throw error;
		throw new AuthRecoveryError();
	} finally {
		signal.removeEventListener("abort", abortWait);
		signal.removeEventListener("abort", cancel);
	}
}
