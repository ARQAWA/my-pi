// Adapted from extensions/RQW-codex/auth.ts at git commit a85b810e924010f35387045fc0cbbd9a1e7173cc.
// Narrowed extraction: saved OAuth shape, account identity and expiry checks; no device login or token exchange.
import type { OAuthCredential } from "@earendil-works/pi-ai";

export const PROVIDER_ID = "openai-codex";
export const LOGIN_HELP = "RQW-web: ChatGPT subscription authentication failed. Refresh it in Pi with /login openai-codex, then repeat the request. Saved credentials were not changed.";
const PROACTIVE_WINDOW_MS = 5 * 60 * 1000;
const NO_EXP_REFRESH_MS = 8 * 24 * 60 * 60 * 1000;
const JWT_AUTH_CLAIM = "https://api.openai.com/auth";

/** Safe failure. Messages never contain response bodies, tokens or URLs from upstream. */
export class AuthRecoveryError extends Error {
	constructor(message = LOGIN_HELP) {
		super(message);
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
function jwtExpiryMs(token: string): number | undefined {
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
	if (stored !== undefined && storedId !== undefined && stored !== storedId) throw new AuthRecoveryError(`${LOGIN_HELP} Stored account does not match the access token.`);
	const identity = stored ?? storedId;
	if (identity === undefined) throw new AuthRecoveryError(`${LOGIN_HELP} Saved login has no account identity.`);
	return identity;
}

/** Shape and identity check only. The access token is a bearer and may be opaque; a JWT is read only for its claim. Returns the same object untouched; valid legacy grants are never rewritten. */
export function validateCredential(value: unknown): OAuthCredential {
	if (!isRecord(value) || value.type !== "oauth" || !nonEmptyString(value.access) || !nonEmptyString(value.refresh)
		|| typeof value.expires !== "number" || !Number.isFinite(value.expires)) {
		throw new AuthRecoveryError();
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

