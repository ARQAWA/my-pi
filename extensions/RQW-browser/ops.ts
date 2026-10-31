import { untilAborted } from "./abort.ts";

// Adapted from oh-my-pi 18.8.9 (browser/op-timeouts.ts, browser/tab-worker.ts), MIT; see THIRD-PARTY-NOTICES.md.

/** Ceiling of one interactive action; also the default of the wait helpers. */
const ACTION_OP_MS = 8_000;
/** Ceiling of page-coupled reads that should answer fast, such as a screenshot. */
const QUICK_OP_MS = 20_000;
/** Part of the call budget kept free so a stalled helper fails with its own name, not the call timeout. */
const BUDGET_SLACK_MS = 1_000;

/** Largest per-operation deadline of a call: strictly below the call's own timeout. */
export function budgetBound(budgetMs: number): number {
	return Math.max(1, budgetMs - BUDGET_SLACK_MS);
}

export function actionMs(budgetMs: number): number {
	return Math.min(budgetBound(budgetMs), ACTION_OP_MS);
}

export function quickMs(budgetMs: number): number {
	return Math.min(budgetBound(budgetMs), QUICK_OP_MS);
}

/**
 * Deadline of a `waitFor*` helper. A positive explicit timeout is honored but clamped to the call budget; no timeout means
 * the action ceiling; Puppeteer's "disable" values (0, Infinity) mean the longest bounded wait, never an unbounded one.
 */
export function waitMs(budgetMs: number, explicit?: number): number {
	if (explicit === undefined) return actionMs(budgetMs);
	if (explicit === 0 || explicit === Number.POSITIVE_INFINITY) return budgetBound(budgetMs);
	if (Number.isFinite(explicit) && explicit > 0) return Math.min(explicit, budgetBound(budgetMs));
	return actionMs(budgetMs);
}

export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await untilAborted(new Promise<void>(resolve => { timer = setTimeout(resolve, ms); }), signal);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Run `work` under its own deadline. When the deadline (or Puppeteer's equal timeout) fires before the call is cancelled,
 * fail with the operation's name and `hint` instead of the opaque call timeout.
 */
export async function withDeadline<T>(
	label: string,
	ms: number,
	signal: AbortSignal,
	work: (signal: AbortSignal) => Promise<T>,
	hint?: (error: unknown) => Promise<string>,
): Promise<T> {
	const deadline = new AbortController();
	const timer = setTimeout(() => deadline.abort(new Error(`${label} timed out after ${ms}ms`)), ms);
	try {
		return await work(AbortSignal.any([signal, deadline.signal]));
	} catch (error) {
		const expired = deadline.signal.aborted || (error instanceof Error && error.name === "TimeoutError");
		if (signal.aborted || !expired) throw error;
		throw new Error(`${label} timed out after ${ms}ms${hint ? await hint(error) : ""}`);
	} finally {
		clearTimeout(timer);
	}
}
