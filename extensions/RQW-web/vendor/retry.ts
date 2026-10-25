// Source: extensions/RQW-codex/retry.ts @ a85b810e924010f35387045fc0cbbd9a1e7173cc
// Narrowed extraction: bounded pre-event HTTP retry decisions and abortable sleeps only.
import { CodexError } from "./errors.ts";
import { CODEX_RETRY } from "./profile.ts";

/** Epoch milliseconds. Injected so tests run on a fake clock. */
interface RetryClock {
	now(): number;
}

/** Returns a value in [0, 1). Injected so tests control jitter. */
type RetryRandom = () => number;

const SYSTEM_CLOCK: RetryClock = { now: () => Date.now() };

/** Native jitter: random_range(0.9..1.1) applied to the exponential base. Attempt 0 has no jitter (codex-client backoff). */
function backoffMs(baseMs: number, attempt: number, random: RetryRandom = Math.random): number {
	if (attempt <= 0) return baseMs;
	const raw = baseMs * 2 ** (attempt - 1);
	const jitter = 0.9 + 0.2 * random();
	return Math.floor(raw * jitter);
}

/** Remaining delay to a server deadline, uncapped; an expired deadline gives zero. */
function serverDelayMs(error: CodexError, clock: RetryClock): number | undefined {
	return error.retryAt === undefined ? undefined : Math.max(0, error.retryAt - clock.now());
}

interface HttpRetryOptions {
	maxRetries?: number;
	baseDelayMs?: number;
	clock?: RetryClock;
	random?: RetryRandom;
}

interface HttpRetryDecision {
	retry: boolean;
	delayMs: number;
}

/**
 * Request-level retries (native `run_with_retry`): 4 retries after the first attempt, so 5 attempts in total.
 * Retries 5xx and transport failures only; 429, 401/403, quota, usage, policy and other typed errors are not retried.
 * The caller re-sends the same prepared body for each retry.
 */
export class HttpRetryPolicy {
	readonly #maxRetries: number;
	readonly #baseDelayMs: number;
	readonly #clock: RetryClock;
	readonly #random: RetryRandom;
	#retries = 0;

	constructor(options: HttpRetryOptions = {}) {
		this.#maxRetries = options.maxRetries ?? CODEX_RETRY.requestMaxRetries;
		this.#baseDelayMs = options.baseDelayMs ?? CODEX_RETRY.requestBaseDelayMs;
		this.#clock = options.clock ?? SYSTEM_CLOCK;
		this.#random = options.random ?? Math.random;
	}

	next(error: CodexError): HttpRetryDecision {
		if (!(error instanceof CodexError) || !retryableAtHttp(error) || this.#retries >= this.#maxRetries) {
			return { retry: false, delayMs: 0 };
		}
		this.#retries++;
		const delayMs = serverDelayMs(error, this.#clock) ?? backoffMs(this.#baseDelayMs, this.#retries, this.#random);
		return { retry: true, delayMs };
	}
}

function retryableAtHttp(error: CodexError): boolean {
	if (error.transport) return error.kind !== "fatal";
	return error.status !== undefined && error.status >= 500 && error.status <= 599;
}

export type StreamTransport = "websocket" | "sse";
export type InjectedSleep = (delayMs: number, signal?: AbortSignal) => Promise<void>;

function abortError(): Error {
	const error = new Error("Retry sleep aborted");
	error.name = "AbortError";
	return error;
}

/**
 * Sleep that rejects with AbortError as soon as the signal fires. The default path clears its timer and listener
 * on abort, so no timer is left behind. An injected sleep receives the signal and is still raced against abort.
 */
export function sleepAbortable(delayMs: number, signal?: AbortSignal, injectedSleep?: InjectedSleep): Promise<void> {
	if (!Number.isFinite(delayMs) || delayMs < 0) return Promise.reject(new RangeError("delayMs must be a non-negative finite number"));
	if (signal?.aborted) return Promise.reject(abortError());
	if (injectedSleep) return raceAbort(injectedSleep(delayMs, signal), signal);
	return new Promise<void>((resolve, reject) => {
		const onAbort = (): void => {
			clearTimeout(timer);
			reject(abortError());
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, delayMs);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function raceAbort(promise: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
	if (!signal) return promise;
	return new Promise<void>((resolve, reject) => {
		const onAbort = (): void => reject(abortError());
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			() => {
				signal.removeEventListener("abort", onAbort);
				resolve();
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}
