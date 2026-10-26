import type { CredentialStore } from "@earendil-works/pi-ai";

// Claude Code 2.1.310's plain usage read. Provenance: notes/anthropic-quota.md.
export const QUOTA_URL = "https://api.anthropic.com/api/oauth/usage";
export const QUOTA_EVENT = "rqw-anthropic:quota:v1";
export const QUOTA_WINDOWS = [
	"five_hour", "seven_day", "seven_day_oauth_apps", "seven_day_opus", "seven_day_sonnet",
	"cinder_cove", "wattle_ember",
] as const;
export type QuotaWindowName = typeof QUOTA_WINDOWS[number];
export type QuotaWindow = {
	utilization: number | null;
	remainingPercent: number | null;
	resetsAt: string | null;
};
export type QuotaSnapshot = {
	fetchedAt: number;
	windows: Partial<Record<QuotaWindowName, QuotaWindow | null>>;
};
export type QuotaAccess = {
	read(): QuotaSnapshot | undefined;
	refresh(signal?: AbortSignal): Promise<QuotaSnapshot>;
};
export type QuotaRequest = { sessionId: string; offer(access: QuotaAccess): void };

export class QuotaError extends Error {
	readonly kind: "auth" | "http" | "response" | "network";
	readonly status?: number;
	readonly retryAfter?: string;
	constructor(kind: QuotaError["kind"], status?: number, retryAfter?: string) {
		super(`RQW-anthropic: quota ${kind} error${status === undefined ? "" : `, HTTP ${status}`}.`);
		this.name = "QuotaError";
		this.kind = kind;
		this.status = status;
		this.retryAfter = retryAfter;
	}
}

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseQuota(value: unknown): QuotaSnapshot["windows"] {
	if (!object(value)) throw new QuotaError("response");
	const windows: QuotaSnapshot["windows"] = {};
	for (const name of QUOTA_WINDOWS) {
		const window = value[name];
		if (window === undefined) continue;
		if (window === null) { windows[name] = null; continue; }
		if (!object(window) ||
			!(window.utilization === null || typeof window.utilization === "number" && Number.isFinite(window.utilization)) ||
			!(window.resets_at === null || typeof window.resets_at === "string")) {
			throw new QuotaError("response");
		}
		windows[name] = {
			utilization: window.utilization,
			remainingPercent: window.utilization === null ? null : Math.max(0, 100 - window.utilization),
			resetsAt: window.resets_at,
		};
	}
	return windows;
}

/** A status read never rotates credentials, retries, or sends a model request. */
export async function fetchQuota(
	store: CredentialStore | undefined, signal: AbortSignal, transport: typeof fetch = globalThis.fetch,
): Promise<QuotaSnapshot> {
	const bounded = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
	bounded.throwIfAborted();
	let credential;
	try { credential = await store?.read("anthropic", { signal: bounded }); }
	catch { bounded.throwIfAborted(); throw new QuotaError("auth"); }
	bounded.throwIfAborted();
	if (credential?.type !== "oauth" || !/^sk-ant-oat\S+$/.test(credential.access)) throw new QuotaError("auth");
	let response: Response;
	try {
		response = await transport(QUOTA_URL, {
			method: "GET", redirect: "error", signal: bounded,
			headers: {
				Authorization: `Bearer ${credential.access}`,
				"anthropic-beta": "oauth-2025-04-20",
				"Content-Type": "application/json",
				"User-Agent": "claude-cli/2.1.310 (external, cli)",
			},
		});
	} catch { bounded.throwIfAborted(); throw new QuotaError("network"); }
	bounded.throwIfAborted();
	if (!response.ok) {
		await response.body?.cancel();
		throw new QuotaError("http", response.status, response.headers.get("retry-after") ?? undefined);
	}
	let data: unknown;
	try { data = await response.json(); }
	catch { bounded.throwIfAborted(); throw new QuotaError("response"); }
	bounded.throwIfAborted();
	return { fetchedAt: Date.now(), windows: parseQuota(data) };
}

/** The consumer owns its refresh cadence; loading the provider alone sends nothing. */
export function createQuotaCache(getStore: () => CredentialStore | undefined): QuotaAccess & { dispose(): void } {
	const lifetime = new AbortController();
	let cached: QuotaSnapshot | undefined;
	let revision = 0;
	let cachedRevision = 0;
	return {
		read: () => cached && structuredClone(cached),
		async refresh(signal = new AbortController().signal) {
			const current = ++revision;
			const combined = AbortSignal.any([lifetime.signal, signal]);
			const result = await fetchQuota(getStore(), combined);
			combined.throwIfAborted();
			// Failed newer refreshes do not block an earlier success from becoming the latest cached success.
			if (current > cachedRevision) {
				cachedRevision = current;
				cached = structuredClone(result);
			}
			return result;
		},
		dispose() { lifetime.abort(); cached = undefined; },
	};
}
