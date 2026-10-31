import type { Credential } from "@earendil-works/pi-ai";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";

const PROVIDER = "openai-codex";
const JWT_AUTH_CLAIM = "https://api.openai.com/auth";

/** Production source of the prediction prompt, the same endpoint the Codex desktop app reads. */
export const PREDICTION_CONFIG_URL = "https://chatgpt.com/backend-api/wham/predictions/config";
/** Codex `staleTime: 3e5`: a result stays fresh for exactly five minutes. */
export const PREDICTION_PROMPT_TTL_MS = 300_000;
export const LOGIN_HELP = "Predictions read the saved openai-codex login read-only. Run /login openai-codex in Pi and retry.";

export interface PredictionPrompt {
	prompt: string;
	promptVersion: string;
}

export interface PromptSourceOptions {
	fetch?: typeof fetch;
	now?: () => number;
	readCredential?: () => Credential | undefined;
}

export interface PromptSource {
	/** Fresh cached prompt, a shared GET when stale, or null when the source gave nothing usable. Rejects on abort, missing login or account change. */
	get(signal?: AbortSignal): Promise<PredictionPrompt | null>;
	/** Drops every cached result and aborts running loads. */
	clear(): void;
}

/** No usable saved login, or the account changed under a running load. Messages never carry tokens. */
export class PredictionAuthError extends Error {
	constructor(message = LOGIN_HELP) {
		super(message);
	}
}

interface Owner {
	accountId: string;
	userId: string;
	access: string;
}

interface Load {
	promise: Promise<PredictionPrompt | null>;
	controller: AbortController;
	waiters: number;
	settled: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function authClaim(access: string): Record<string, unknown> | undefined {
	const parts = access.split(".");
	if (parts.length !== 3 || !parts[1]) return undefined;
	try {
		const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		const claim = isRecord(payload) ? payload[JWT_AUTH_CLAIM] : undefined;
		return isRecord(claim) ? claim : undefined;
	} catch {
		return undefined;
	}
}

function ownerOf(credential: Credential | undefined, now: number): Owner {
	if (credential?.type !== "oauth" || !nonEmptyString(credential.access)) throw new PredictionAuthError();
	if (typeof credential.expires !== "number" || credential.expires <= now) throw new PredictionAuthError();
	const claim = authClaim(credential.access);
	const fromToken = nonEmptyString(claim?.chatgpt_account_id) ? claim.chatgpt_account_id : undefined;
	const stored = nonEmptyString(credential.accountId) ? credential.accountId : undefined;
	if (fromToken !== undefined && stored !== undefined && fromToken !== stored) throw new PredictionAuthError();
	const accountId = fromToken ?? stored;
	if (accountId === undefined) throw new PredictionAuthError();
	const userId = nonEmptyString(claim?.chatgpt_user_id) ? claim.chatgpt_user_id : "";
	return { accountId, userId, access: credential.access };
}

const cacheKey = (owner: Owner): string => JSON.stringify(["cumberbatch-config", owner.userId, owner.accountId]);

function parseConfig(body: string): PredictionPrompt | null {
	try {
		const json: unknown = JSON.parse(body);
		if (!isRecord(json) || !nonEmptyString(json.prompt) || !nonEmptyString(json.prompt_version)) return null;
		return { prompt: json.prompt, promptVersion: json.prompt_version };
	} catch {
		return null;
	}
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	if (!signal) return promise;
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		if (signal.aborted) return onAbort();
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
	});
}

/**
 * Prompt source with Codex's cache policy: one entry per user and account, fresh for 300000 ms, refreshed by one
 * shared GET on the first read after that. Failures of the HTTP call or the schema are cached as null, as the
 * desktop app does; an abort is never cached. The saved login is only read, never refreshed or written.
 */
export function createPromptSource(options: PromptSourceOptions = {}): PromptSource {
	const doFetch = options.fetch ?? fetch;
	const now = options.now ?? Date.now;
	const readCredential = options.readCredential ?? (() => readStoredCredential(PROVIDER));
	const cache = new Map<string, { value: PredictionPrompt | null; at: number }>();
	const loads = new Map<string, Load>();
	let generation = 0;

	async function download(owner: Owner, signal: AbortSignal): Promise<PredictionPrompt | null> {
		const headers = { Authorization: `Bearer ${owner.access}`, "ChatGPT-Account-ID": owner.accountId, Accept: "application/json" };
		try {
			const response = await doFetch(PREDICTION_CONFIG_URL, { method: "GET", headers, signal });
			return response.ok ? parseConfig(await response.text()) : null;
		} catch {
			signal.throwIfAborted();
			return null;
		}
	}

	async function load(key: string, owner: Owner, signal: AbortSignal): Promise<PredictionPrompt | null> {
		const started = generation;
		const value = await download(owner, signal);
		signal.throwIfAborted();
		if (started !== generation) throw new PredictionAuthError("Prediction source was cleared.");
		if (cacheKey(ownerOf(readCredential(), now())) !== key) throw new PredictionAuthError("Account changed during the prediction prompt load.");
		cache.set(key, { value, at: now() });
		return value;
	}

	function start(key: string, owner: Owner): Load {
		const controller = new AbortController();
		const entry: Load = { promise: load(key, owner, controller.signal), controller, waiters: 0, settled: false };
		const finish = () => {
			entry.settled = true;
			if (loads.get(key) === entry) loads.delete(key);
		};
		entry.promise.then(finish, finish);
		loads.set(key, entry);
		return entry;
	}

	return {
		async get(signal) {
			signal?.throwIfAborted();
			const owner = ownerOf(readCredential(), now());
			const key = cacheKey(owner);
			const hit = cache.get(key);
			if (hit && now() - hit.at < PREDICTION_PROMPT_TTL_MS) return hit.value;
			const entry = loads.get(key) ?? start(key, owner);
			entry.waiters++;
			try {
				return await untilAborted(entry.promise, signal);
			} finally {
				entry.waiters--;
				if (entry.waiters === 0 && !entry.settled) {
					entry.controller.abort(signal?.reason);
					if (loads.get(key) === entry) loads.delete(key);
				}
			}
		},
		clear() {
			generation++;
			cache.clear();
			for (const entry of loads.values()) entry.controller.abort(new PredictionAuthError("Prediction source was cleared."));
			loads.clear();
		},
	};
}
