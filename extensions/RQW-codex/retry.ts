// Codex retry decisions, ported from codex-rs stable 0.163.0:
// codex-client/src/retry.rs (HTTP request retries, backoff), core/src/responses_retry.rs (stream retries, sticky
// WebSocket→SSE fallback, unbounded connection-failed loop), core/src/session/turn.rs (sampling loop).
// Pure decisions: callers sleep with sleepAbortable, re-send the prepared body, and execute no tools here.
import { CodexError } from "./errors.ts";
import { CODEX_RETRY, connectionRetryDelayMs } from "./profile.ts";

/** Pi-side marker: a Codex-owned error whose retries are decided by this module (no second Pi retry). */
export const CODEX_RETRY_OWNED_DIAGNOSTIC = "rqw_codex_retry_owned";

export function isRetryOwnedDiagnostic(item: unknown): boolean {
	return typeof item === "object" && item !== null && (item as { type?: unknown }).type === CODEX_RETRY_OWNED_DIAGNOSTIC;
}

/** Epoch milliseconds. Injected so tests run on a fake clock. */
export interface RetryClock {
	now(): number;
}

/** Returns a value in [0, 1). Injected so tests control jitter. */
export type RetryRandom = () => number;

const SYSTEM_CLOCK: RetryClock = { now: () => Date.now() };

/** Native jitter: random_range(0.9..1.1) applied to the exponential base. Attempt 0 has no jitter (codex-client backoff). */
export function backoffMs(baseMs: number, attempt: number, random: RetryRandom = Math.random): number {
	if (attempt <= 0) return baseMs;
	const raw = baseMs * 2 ** (attempt - 1);
	const jitter = 0.9 + 0.2 * random();
	return Math.floor(raw * jitter);
}

/** Remaining delay to a server deadline, uncapped; an expired deadline gives zero. */
function serverDelayMs(error: CodexError, clock: RetryClock): number | undefined {
	return error.retryAt === undefined ? undefined : Math.max(0, error.retryAt - clock.now());
}

export interface HttpRetryOptions {
	maxRetries?: number;
	baseDelayMs?: number;
	clock?: RetryClock;
	random?: RetryRandom;
}

export interface HttpRetryDecision {
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

export type StreamRequestKind = "sampling" | "compaction";
export type StreamTransport = "websocket" | "sse";
export type StreamAction = "retry" | "fallback" | "fail";

export interface StreamDecision {
	action: StreamAction;
	delayMs: number;
	/** The next attempt must open a new transport connection (new socket, or a new SSE request after fallback). */
	reconnect: boolean;
}

export interface StreamRetryOptions {
	request?: StreamRequestKind;
	/** Bounded retries per transport. Defaults: sampling 5, compaction 2 (native V2 compaction). */
	maxRetries?: number;
	transport?: StreamTransport;
	/** Internal sessions never enter the unbounded connection loop (native `session_source.is_internal()`). */
	internalSession?: boolean;
	unboundedConnectionRetries?: boolean;
	clock?: RetryClock;
	random?: RetryRandom;
}

export const COMPACTION_STREAM_RETRIES = 2;

/**
 * Stream-level retry decisions for one sampling or compaction request (native `handle_response_stream_error`).
 * Order: terminal check, 426 upgrade fallback, unbounded connection loop (sampling only), bounded retries,
 * sticky WebSocket→SSE fallback with the retry count reset, then fail with the original error.
 * Quota, usage, auth, policy, context-overflow and other terminal kinds fail on the first call.
 */
export class RetryPolicy {
	readonly #request: StreamRequestKind;
	readonly #maxRetries: number;
	readonly #internal: boolean;
	readonly #unbounded: boolean;
	readonly #clock: RetryClock;
	readonly #random: RetryRandom;
	#transport: StreamTransport;
	#retries = 0;
	#connectionRetries = 0;

	constructor(options: StreamRetryOptions = {}) {
		this.#request = options.request ?? "sampling";
		this.#maxRetries =
			options.maxRetries ?? (this.#request === "compaction" ? COMPACTION_STREAM_RETRIES : CODEX_RETRY.streamMaxRetries);
		this.#internal = options.internalSession === true;
		this.#unbounded = options.unboundedConnectionRetries ?? CODEX_RETRY.unboundedConnectionRetries;
		this.#clock = options.clock ?? SYSTEM_CLOCK;
		this.#random = options.random ?? Math.random;
		this.#transport = options.transport ?? "websocket";
	}

	get transport(): StreamTransport {
		return this.#transport;
	}

	get retries(): number {
		return this.#retries;
	}

	get connectionRetries(): number {
		return this.#connectionRetries;
	}

	next(error: CodexError): StreamDecision {
		const fail: StreamDecision = { action: "fail", delayMs: 0, reconnect: false };
		if (!(error instanceof CodexError) || error.kind === "unauthorized" || !error.retryable) return fail;
		const serverDelay = serverDelayMs(error, this.#clock);

		if (this.#transport === "websocket" && error.status === 426) {
			this.#transport = "sse";
			this.#retries = 0;
			return { action: "fallback", delayMs: 0, reconnect: true };
		}

		if (
			this.#request === "sampling" &&
			error.kind === "connection_failed" &&
			this.#unbounded &&
			!this.#internal
		) {
			const delayMs = connectionRetryDelayMs(this.#connectionRetries);
			this.#connectionRetries++;
			return { action: "retry", delayMs, reconnect: true };
		}

		if (this.#retries >= this.#maxRetries && this.#transport === "websocket") {
			this.#transport = "sse";
			this.#retries = 0;
			return { action: "fallback", delayMs: serverDelay ?? 0, reconnect: true };
		}

		if (this.#retries < this.#maxRetries) {
			this.#retries++;
			const delayMs = serverDelay ?? backoffMs(CODEX_RETRY.requestBaseDelayMs, this.#retries, this.#random);
			return { action: "retry", delayMs, reconnect: reconnectsOnRetry(error) };
		}

		return fail;
	}
}

function reconnectsOnRetry(error: CodexError): boolean {
	return (
		error.connectionFailed ||
		error.transport ||
		error.kind === "previous_response_not_found" ||
		error.kind === "websocket_connection_limit_reached"
	);
}

/** Finite 401 recovery stages (native account-guarded reload, then authority refresh), each followed by one caller retry. */
export const AUTH_RECOVERY_STAGES = ["reload", "refresh"] as const;
export type AuthRecoveryAction = (typeof AUTH_RECOVERY_STAGES)[number] | "fail";

export class AuthRecoveryPolicy {
	#stage = 0;

	next(error: CodexError): { action: AuthRecoveryAction } {
		if (!(error instanceof CodexError) || error.kind !== "unauthorized" || this.#stage >= AUTH_RECOVERY_STAGES.length) {
			return { action: "fail" };
		}
		return { action: AUTH_RECOVERY_STAGES[this.#stage++] };
	}
}

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
