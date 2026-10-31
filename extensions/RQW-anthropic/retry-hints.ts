import type { AssistantMessage, AssistantMessageEventStream } from "@earendil-works/pi-ai";

/** The longest setTimeout delay; larger values fire at once. */
const MAX_TIMER_MS = 2_147_483_647;
export const HTTP_DIAGNOSTIC = "rqw_anthropic_http";

/** The server's retry control only: no other header is read, so no auth or account value can leak. */
export type RetryHints = { shouldRetry?: boolean; delayMs?: number; resetAt?: number };
export type HttpDiagnostic = RetryHints & { status: number };

/** Reads x-should-retry, retry-after-ms, Retry-After (seconds or HTTP-date) and the unified reset (epoch seconds). */
export function retryHints(headers: Headers, now = Date.now()): RetryHints {
	const hints: RetryHints = {};
	const shouldRetry = headers.get("x-should-retry");
	if (shouldRetry === "true" || shouldRetry === "false") hints.shouldRetry = shouldRetry === "true";
	const delayMs = serverDelayMs(headers, now);
	if (delayMs !== undefined) hints.delayMs = delayMs;
	const reset = Number.parseFloat(headers.get("anthropic-ratelimit-unified-reset") ?? "");
	if (Number.isFinite(reset)) hints.resetAt = reset * 1000;
	return hints;
}

function serverDelayMs(headers: Headers, now: number): number | undefined {
	const milliseconds = Number.parseFloat(headers.get("retry-after-ms") ?? "");
	if (Number.isFinite(milliseconds)) return Math.max(0, milliseconds);
	const retryAfter = headers.get("retry-after");
	if (!retryAfter) return undefined;
	const seconds = Number.parseFloat(retryAfter);
	const delayMs = Number.isNaN(seconds) ? Date.parse(retryAfter) - now : seconds * 1000;
	return Number.isFinite(delayMs) ? Math.max(0, delayMs) : undefined;
}

export function httpDiagnostic(status: number, headers: Headers, now = Date.now()): HttpDiagnostic {
	return { status, ...retryHints(headers, now) };
}

/** Where a summary request reports the server's retry control to the summary operation that owns its retry loop. */
export type SummarySink = (rejection: HttpDiagnostic, signal?: AbortSignal) => void;

/** Global setTimeout, so fake clocks can drive the wait; abort ends it at once. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	signal?.throwIfAborted();
	return new Promise((resolve, reject) => {
		const onAbort = () => { clearTimeout(timer); reject(signal!.reason); };
		const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/** The diagnostic this extension attached to an Anthropic error message, if any. */
export function readHttpDiagnostic(message: AssistantMessage): HttpDiagnostic | undefined {
	if (message.provider !== "anthropic") return undefined;
	const details = message.diagnostics?.find(item => item.type === HTTP_DIAGNOSTIC)?.details;
	if (typeof details?.status !== "number") return undefined;
	const found: HttpDiagnostic = { status: details.status };
	if (typeof details.shouldRetry === "boolean") found.shouldRetry = details.shouldRetry;
	if (typeof details.retryAfterMs === "number") found.delayMs = details.retryAfterMs;
	if (typeof details.resetAt === "number") found.resetAt = details.resetAt;
	return found;
}

/** The server's retry control against Pi's own wait limit: stop with a reason, or wait the server's delay. */
export type ServerPlan = { stop: string } | { delayMs?: number };
export function planServerRetry(rejection: HttpDiagnostic | undefined, maxDelayMs: number): ServerPlan {
	if (rejection?.shouldRetry === false) return { stop: "Server asked not to retry (x-should-retry: false)." };
	if (rejection?.delayMs === undefined) return {};
	// Pi's retryDelayMs treats a limit of 0 as no wait; a longer timer would overflow and fire at once.
	const bound = Math.min(Math.max(maxDelayMs, 0), MAX_TIMER_MS);
	if (rejection.delayMs > bound) {
		return { stop: `Server requested ${Math.ceil(rejection.delayMs / 1000)}s retry delay (max: ${Math.floor(bound / 1000)}s).` };
	}
	return { delayMs: Math.ceil(rejection.delayMs) };
}

/** Adds the last HTTP rejection to the terminal error message, which the SDK otherwise reduces to text. */
export function attachHttpDiagnostic(
	source: AssistantMessageEventStream, rejection: () => HttpDiagnostic | undefined, summary?: SummarySink, signal?: AbortSignal,
) {
	const push = source.push.bind(source);
	source.push = event => {
		const found = event.type === "error" ? rejection() : undefined;
		if (event.type === "error" && found) {
			const { status, shouldRetry, delayMs, resetAt } = found;
			const details: Record<string, number | boolean> = { status };
			if (shouldRetry !== undefined) details.shouldRetry = shouldRetry;
			if (delayMs !== undefined) details.retryAfterMs = delayMs;
			if (resetAt !== undefined) details.resetAt = resetAt;
			event.error.diagnostics = [...(event.error.diagnostics ?? []), { type: HTTP_DIAGNOSTIC, timestamp: Date.now(), details }];
			if (summary) {
				// Pi's summary retry loop only reads the error text; its classifier knows this phrase.
				if (found.shouldRetry === true) event.error.errorMessage = `${event.error.errorMessage ?? ""} (server allows retry: please retry your request)`;
				summary(found, signal);
			}
		}
		push(event);
	};
	return source;
}
