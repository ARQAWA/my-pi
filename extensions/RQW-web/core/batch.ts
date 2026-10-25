// Adapted from cli/web/batch.ts at git a85b810e924010f35387045fc0cbbd9a1e7173cc.
import { mapPool } from "./pool.ts";
import { safeMessage } from "./safe-text.ts";
import type { RunOptions, TargetResult, TargetRunner, WebTarget } from "./types.ts";

export const CONCURRENCY = 3;
/** Time limit for one target's whole search loop; the engine enforces it and reports its own error. */
export const TARGET_TIMEOUT_MS = 120_000;
/** Extra wait so the engine's own timeout error arrives first; the CLI stops waiting after this. */
export const TIMEOUT_GRACE_MS = 5_000;

export interface BatchSettings {
	signal: AbortSignal;
	concurrency?: number;
	timeoutMs?: number;
	graceMs?: number;
}

function failure(options: RunOptions, target: WebTarget, code: string, message: string): TargetResult {
	return {
		target, model: options.search.model, effort: options.search.effort,
		mode: options.mode, responseLength: options.responseLength,
		status: "error", summary: "", sources: [], citations: [], actions: [], results: [],
		error: { code, message },
	};
}

/** Rejects as soon as `signal` aborts, even when the engine ignores it. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
	});
}

/** A successful result must carry real text; a status of "ok" with an empty answer is an error. */
function checked(options: RunOptions, target: WebTarget, result: TargetResult): TargetResult {
	if (result.status === "ok") {
		if (typeof result.summary !== "string" || !result.summary.trim()) return failure(options, target, "empty_result", "The search returned no answer.");
		return { ...result, target };
	}
	const error = result.error ?? { code: "error", message: "The target failed." };
	return { ...result, target, summary: "", error: { code: String(error.code), message: safeMessage(error.message) } };
}

async function runTarget(options: RunOptions, target: WebTarget, runner: TargetRunner, settings: BatchSettings): Promise<TargetResult> {
	if (settings.signal.aborted) return failure(options, target, "cancelled", "Cancelled before it started.");
	const timeout = new AbortController();
	const timeoutMs = settings.timeoutMs ?? TARGET_TIMEOUT_MS;
	const timer = setTimeout(() => timeout.abort(new Error("timeout")), timeoutMs + (settings.graceMs ?? TIMEOUT_GRACE_MS));
	const signal = AbortSignal.any([settings.signal, timeout.signal]);
	try {
		const run = { ...options.search, target, mode: options.mode, responseLength: options.responseLength, timeoutMs, signal };
		return checked(options, target, await abortable(runner(run), signal));
	} catch (error) {
		if (timeout.signal.aborted) return failure(options, target, "timeout", "Timed out; no answer was produced.");
		if (settings.signal.aborted) return failure(options, target, "cancelled", "Cancelled.");
		return failure(options, target, "error", safeMessage(error));
	} finally {
		clearTimeout(timer);
	}
}

/** Runs every target with bounded concurrency. One failure never affects its siblings; order is input order. */
export function runBatch(options: RunOptions, runner: TargetRunner, settings: BatchSettings): Promise<TargetResult[]> {
	return mapPool(options.targets, settings.concurrency ?? CONCURRENCY, target => runTarget(options, target, runner, settings));
}
