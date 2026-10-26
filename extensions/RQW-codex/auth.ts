import { setTimeout as sleepTimer } from "node:timers/promises";
import type { AuthEvent, AuthInteraction, OAuthCredential } from "@earendil-works/pi-ai";
import { localPlatform, userAgent } from "./metadata.ts";

// Native pins: codex-rs/login/src/auth/manager.rs (CLIENT_ID, refresh timing), device_code_auth.rs (device flow).
export const PROVIDER_ID = "openai-codex";
export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const ISSUER = "https://auth.openai.com";
export const TOKEN_URL = `${ISSUER}/oauth/token`;
export const DEVICE_USER_CODE_URL = `${ISSUER}/api/accounts/deviceauth/usercode`;
export const DEVICE_TOKEN_URL = `${ISSUER}/api/accounts/deviceauth/token`;
export const DEVICE_VERIFICATION_URL = `${ISSUER}/codex/device`;
export const DEVICE_REDIRECT_URI = `${ISSUER}/deviceauth/callback`;
export const LOGIN_HELP = "RQW-codex: ChatGPT subscription authentication failed. Retry the turn; if it persists, use /login openai-codex. Saved credentials were not removed.";

export const ORIGINATOR = "codex_cli_rs";
export const CODEX_VERSION = "0.163.0";

const DEVICE_BUDGET_MS = 15 * 60 * 1000;
const DEVICE_EXPIRES_SECONDS = 15 * 60;
const PROACTIVE_WINDOW_MS = 5 * 60 * 1000;
const NO_EXP_REFRESH_MS = 8 * 24 * 60 * 60 * 1000;
const JWT_AUTH_CLAIM = "https://api.openai.com/auth";

export type CodexIdentity = { originator: string; userAgent: string };

/** Truthful local identity: real OS type/release/arch and terminal program. Not another user's machine. */
export function defaultCodexIdentity(): CodexIdentity {
	return { originator: ORIGINATOR, userAgent: userAgent(localPlatform()) };
}

/** Safe failure. Messages never contain response bodies, tokens or URLs from upstream. */
export class AuthRecoveryError extends Error {
	readonly permanent: boolean;
	constructor(message = LOGIN_HELP, permanent = false) {
		super(message);
		this.permanent = permanent;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".");
	if (parts.length !== 3 || !parts[1]) return undefined;
	try {
		const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		return isRecord(payload) ? payload : undefined;
	} catch {
		return undefined;
	}
}

/** JWT `exp` in milliseconds; undefined when the access token carries no usable exp. */
export function jwtExpiryMs(token: string): number | undefined {
	const exp = decodeJwtPayload(token)?.exp;
	return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : undefined;
}

function jwtAccountId(token: string): string | undefined {
	const claim = decodeJwtPayload(token)?.[JWT_AUTH_CLAIM];
	const id = isRecord(claim) ? claim.chatgpt_account_id : undefined;
	return nonEmptyString(id) ? id : undefined;
}

/**
 * Account identity: the JWT auth claim when present, else the stored accountId.
 * A stored accountId that disagrees with the claim is invalid. Throws a safe error.
 */
export function credentialIdentity(value: unknown): string {
	const stored = isRecord(value) && nonEmptyString(value.access) ? jwtAccountId(value.access) : undefined;
	const storedId = isRecord(value) && nonEmptyString(value.accountId) ? value.accountId : undefined;
	if (stored !== undefined && storedId !== undefined && stored !== storedId) throw new AuthRecoveryError(`${LOGIN_HELP} Stored account does not match the access token.`, true);
	const identity = stored ?? storedId;
	if (identity === undefined) throw new AuthRecoveryError(`${LOGIN_HELP} Saved login has no account identity.`, true);
	return identity;
}

/** Shape, subscription eligibility and identity check. Access may be opaque. Returns the same object untouched; valid legacy grants are never rewritten. */
export function validateCredential(value: unknown): OAuthCredential {
	if (!isRecord(value) || value.type !== "oauth" || !nonEmptyString(value.access) || !nonEmptyString(value.refresh)
		|| typeof value.expires !== "number" || !Number.isFinite(value.expires)) {
		throw new AuthRecoveryError(LOGIN_HELP, true);
	}
	const idClaim = typeof value.id_token === "string" ? decodeJwtPayload(value.id_token)?.[JWT_AUTH_CLAIM] : undefined;
	if (isRecord(idClaim) && idClaim.chatgpt_account_is_fedramp === true) {
		throw new AuthRecoveryError(`${LOGIN_HELP} FedRAMP subscriptions are not supported by this ordinary subscription profile.`, true);
	}
	credentialIdentity(value);
	return value as OAuthCredential;
}

/** Native proactive rule: JWT exp within 5 minutes, else last_refresh older than 8 days when there is no exp. */
export function needsRefresh(credential: OAuthCredential, now: number): boolean {
	const exp = jwtExpiryMs(credential.access);
	if (exp !== undefined) return exp <= now + PROACTIVE_WINDOW_MS;
	const lastRefresh = credential.last_refresh;
	return typeof lastRefresh === "number" && Number.isFinite(lastRefresh) && lastRefresh < now - NO_EXP_REFRESH_MS;
}

/** Expiry recorded for Pi: JWT exp, or last_refresh plus 8 days when the access token has no exp. */
function expiresFor(access: string, lastRefresh: number): number {
	return jwtExpiryMs(access) ?? lastRefresh + NO_EXP_REFRESH_MS;
}

const REFRESH_FAILURES: Record<string, string> = {
	refresh_token_expired: "Your refresh token has expired. Log in again with /login openai-codex.",
	refresh_token_reused: "Your refresh token was already used. Log in again with /login openai-codex.",
	refresh_token_invalidated: "Your refresh token was revoked. Log in again with /login openai-codex.",
};

/**
 * Refresh-token grant: JSON body ordered client_id, grant_type, refresh_token; one attempt, no timeout
 * (native policy); omitted access/refresh/id_token fields keep the prior values.
 */
export async function refreshCredential(
	credential: OAuthCredential,
	signal: AbortSignal,
	transport: typeof fetch = globalThis.fetch,
	options: { identity?: CodexIdentity; now?: () => number } = {},
): Promise<OAuthCredential> {
	signal.throwIfAborted();
	if (!nonEmptyString(credential.refresh)) throw new AuthRecoveryError(`${LOGIN_HELP} Saved refresh token is invalid.`, true);
	const identity = options.identity ?? defaultCodexIdentity();
	const prior = credentialIdentity(credential);
	let response: Response;
	try {
		response = await transport(TOKEN_URL, {
			method: "POST",
			redirect: "error",
			signal,
			headers: {
				"content-type": "application/json",
				accept: "application/json",
				originator: identity.originator,
				"user-agent": identity.userAgent,
			},
			body: JSON.stringify({ client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: credential.refresh }),
		});
	} catch {
		signal.throwIfAborted();
		throw new AuthRecoveryError(`${LOGIN_HELP} Token endpoint could not be reached.`);
	}
	if (!response.ok) {
		// Only a known error code selects a fixed message; the body is never copied anywhere.
		const text = await response.text().catch(() => "");
		let code: unknown;
		try {
			const parsed: unknown = JSON.parse(text);
			code = isRecord(parsed) ? (typeof parsed.error === "string" ? parsed.error : isRecord(parsed.error) ? parsed.error.code : undefined) : undefined;
		} catch {
			code = undefined;
		}
		const known = typeof code === "string" ? REFRESH_FAILURES[code.toLowerCase()] : undefined;
		if (known) throw new AuthRecoveryError(`${LOGIN_HELP} ${known}`, true);
		if (response.status === 400 || response.status === 401) {
			throw new AuthRecoveryError(`${LOGIN_HELP} Refresh grant was rejected (HTTP ${response.status}).`, true);
		}
		throw new AuthRecoveryError(`${LOGIN_HELP} Refresh failed (HTTP ${response.status}).`);
	}
	let data: unknown;
	try {
		data = await response.json();
	} catch {
		throw new AuthRecoveryError(`${LOGIN_HELP} Invalid token response.`);
	}
	if (!isRecord(data)) throw new AuthRecoveryError(`${LOGIN_HELP} Invalid token response.`);
	for (const field of ["access_token", "refresh_token", "id_token"]) {
		if (data[field] !== undefined && !nonEmptyString(data[field])) throw new AuthRecoveryError(`${LOGIN_HELP} Invalid token response.`);
	}
	const access = data.access_token as string | undefined;
	// Account guard: a refreshed JWT that carries an account claim must match the saved account. Absent or opaque: keep prior.
	const refreshedAccount = access !== undefined ? jwtAccountId(access) : undefined;
	if (refreshedAccount !== undefined && refreshedAccount !== prior) {
		throw new AuthRecoveryError(`${LOGIN_HELP} Refreshed token does not belong to the saved account.`, true);
	}
	const now = (options.now ?? Date.now)();
	const next = {
		...credential,
		type: "oauth" as const,
		access: access ?? credential.access,
		refresh: (data.refresh_token as string | undefined) ?? credential.refresh,
		expires: expiresFor(access ?? credential.access, now),
		last_refresh: now,
	} as OAuthCredential & Record<string, unknown>;
	if (data.id_token !== undefined) next.id_token = data.id_token;
	return validateCredential(next);
}

export type DeviceLoginDependencies = {
	fetch?: typeof fetch;
	now?: () => number;
	sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
	signal?: AbortSignal;
};

type DeviceStart = { deviceAuthId: string; userCode: string; intervalSeconds: number };

async function postJson(transport: typeof fetch, url: string, body: unknown, signal: AbortSignal): Promise<Response> {
	try {
		// Raw auth client: no Codex default headers on device start or poll.
		return await transport(url, { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
	} catch {
		signal.throwIfAborted();
		throw new AuthRecoveryError("RQW-codex device login: the auth endpoint could not be reached.");
	}
}

async function startDeviceCode(transport: typeof fetch, signal: AbortSignal): Promise<DeviceStart> {
	const response = await postJson(transport, DEVICE_USER_CODE_URL, { client_id: CLIENT_ID }, signal);
	if (!response.ok) {
		await response.body?.cancel();
		if (response.status === 404) throw new AuthRecoveryError("RQW-codex device login is not enabled for this server. Verify the server before retrying.");
		throw new AuthRecoveryError(`RQW-codex device code request failed with status ${response.status}.`);
	}
	const json: unknown = await response.json().catch(() => undefined);
	if (!isRecord(json)) throw new AuthRecoveryError("RQW-codex device code response is invalid.");
	const userCode = json.user_code ?? json.usercode;
	// Native: interval is a trimmed string u64; absent means 0.
	let interval = 0;
	if (json.interval !== undefined) {
		if (typeof json.interval !== "string" || !/^\s*\d+\s*$/.test(json.interval)) throw new AuthRecoveryError("RQW-codex device code response is invalid.");
		interval = Number(json.interval.trim());
		if (!Number.isSafeInteger(interval)) throw new AuthRecoveryError("RQW-codex device code response is invalid.");
	}
	if (!nonEmptyString(json.device_auth_id) || !nonEmptyString(userCode)) throw new AuthRecoveryError("RQW-codex device code response is invalid.");
	return { deviceAuthId: json.device_auth_id, userCode, intervalSeconds: interval };
}

type DeviceGrant = { authorizationCode: string; codeVerifier: string };

async function pollDeviceCode(
	transport: typeof fetch,
	device: DeviceStart,
	signal: AbortSignal,
	now: () => number,
	sleep: (ms: number, signal: AbortSignal) => Promise<void>,
): Promise<DeviceGrant> {
	const start = now();
	for (;;) {
		signal.throwIfAborted();
		// Immediate first poll; afterwards only 403/404 sleep the server interval.
		const response = await postJson(transport, DEVICE_TOKEN_URL, { device_auth_id: device.deviceAuthId, user_code: device.userCode }, signal);
		if (response.ok) {
			const json: unknown = await response.json().catch(() => undefined);
			if (!isRecord(json) || !nonEmptyString(json.authorization_code) || !nonEmptyString(json.code_challenge) || !nonEmptyString(json.code_verifier)) {
				throw new AuthRecoveryError("RQW-codex device auth returned an invalid code.");
			}
			return { authorizationCode: json.authorization_code, codeVerifier: json.code_verifier };
		}
		await response.body?.cancel();
		if (response.status === 403 || response.status === 404) {
			const elapsed = now() - start;
			if (elapsed >= DEVICE_BUDGET_MS) throw new AuthRecoveryError("RQW-codex device auth timed out after 15 minutes.");
			await sleep(Math.min(device.intervalSeconds * 1000, DEVICE_BUDGET_MS - elapsed), signal);
			continue;
		}
		throw new AuthRecoveryError(`RQW-codex device auth failed with status ${response.status}.`);
	}
}

/**
 * Device-only ChatGPT login. Emits Pi's device_code event directly; no selector, callback server or
 * browser fallback. Returns the grant for the caller to persist; saves nothing itself.
 */
export async function loginDevice(
	interaction: Pick<AuthInteraction, "notify"> & { signal?: AbortSignal },
	dependencies: DeviceLoginDependencies = {},
): Promise<OAuthCredential> {
	const signal = dependencies.signal ?? interaction.signal ?? new AbortController().signal;
	signal.throwIfAborted();
	const transport = dependencies.fetch ?? globalThis.fetch;
	const now = dependencies.now ?? Date.now;
	const sleep = dependencies.sleep ?? ((ms: number, abort: AbortSignal) => sleepTimer(ms, undefined, { signal: abort }).then(() => undefined));
	const device = await startDeviceCode(transport, signal);
	const notice: AuthEvent = {
		type: "device_code",
		userCode: device.userCode,
		verificationUri: DEVICE_VERIFICATION_URL,
		intervalSeconds: device.intervalSeconds,
		expiresInSeconds: DEVICE_EXPIRES_SECONDS,
	};
	interaction.notify(notice);
	const grant = await pollDeviceCode(transport, device, signal, now, sleep);
	let response: Response;
	try {
		response = await transport(TOKEN_URL, {
			method: "POST",
			redirect: "error",
			signal,
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				client_id: CLIENT_ID,
				code: grant.authorizationCode,
				redirect_uri: DEVICE_REDIRECT_URI,
				code_verifier: grant.codeVerifier,
			}),
		});
	} catch {
		signal.throwIfAborted();
		throw new AuthRecoveryError("RQW-codex device code exchange could not reach the token endpoint.");
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new AuthRecoveryError(`RQW-codex device code exchange failed with status ${response.status}.`);
	}
	const json: unknown = await response.json().catch(() => undefined);
	if (!isRecord(json) || !nonEmptyString(json.access_token) || !nonEmptyString(json.refresh_token) || (json.id_token !== undefined && !nonEmptyString(json.id_token))) {
		throw new AuthRecoveryError("RQW-codex device code exchange returned an invalid token response.");
	}
	const lastRefresh = now();
	const credential = {
		type: "oauth" as const,
		access: json.access_token,
		refresh: json.refresh_token,
		expires: expiresFor(json.access_token, lastRefresh),
		last_refresh: lastRefresh,
		...(json.id_token !== undefined ? { id_token: json.id_token } : {}),
	} as OAuthCredential & Record<string, unknown>;
	// Native persists the account from the id_token claim; the access token claim is the fallback. Never invented.
	const idAccount = typeof json.id_token === "string" ? jwtAccountId(json.id_token) : undefined;
	const accessAccount = jwtAccountId(json.access_token);
	if (idAccount !== undefined && accessAccount !== undefined && idAccount !== accessAccount) {
		throw new AuthRecoveryError("RQW-codex device login: the id token and access token belong to different accounts.", true);
	}
	const accountId = idAccount ?? accessAccount;
	if (accountId === undefined) throw new AuthRecoveryError("RQW-codex device login: the tokens carry no account identity.", true);
	return validateCredential({ ...credential, accountId });
}
