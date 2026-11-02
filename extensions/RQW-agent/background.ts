// A child's own background (its agents and jobs): the shared automatic result source, one inbox message, one sleep.
import { randomUUID } from "node:crypto";

type AutoResult = { id: string; run?: string; delivery?: string; outcome: string; text: string; title?: string; exit_code?: number; output_path?: string };

/** The source shape RQW-auto-wait adopts for the main chat; here a child's loop takes from it as well. */
export type AutoSource = {
	version: 1;
	snapshot(): { targets: string[]; titles?: Record<string, string>; ready: boolean };
	subscribe(listener: (value: true | null) => void): () => void;
	claim(): { token: string; results: AutoResult[] } | undefined;
	commit(token: string): void;
	release(token: string): void;
};

type InboxMessage = { customType: string; content: string; display: boolean; details: object };

export const AUTO_RESULTS = "rqw-auto-wait-results";

/** Some work of these sources is still running. */
export const backgroundLive = (sources: AutoSource[]) => sources.some(source => source.snapshot().targets.length > 0);

/** Some finished result of these sources is not delivered yet. */
export const backgroundReady = (sources: AutoSource[]) => sources.some(source => source.snapshot().ready);

/**
 * Takes every ready result of the sources into one message of the child's durable inbox, in the format of the main chat.
 * The inbox entry is saved before the sources commit, so a result is delivered once; false when nothing was ready.
 */
export function takeBackground(sources: AutoSource[], deliver: (message: InboxMessage) => void): boolean {
	const claims = sources.flatMap(source => {
		const claim = source.claim();
		return claim ? [{ source, ...claim }] : [];
	});
	if (!claims.length) return false;
	const results = claims.flatMap(claim => claim.results);
	try {
		deliver({
			customType: AUTO_RESULTS,
			content: JSON.stringify({ results: results.map(({ run: _run, delivery: _delivery, ...result }) => result) }),
			display: false,
			details: { batch: randomUUID(), results: results.map(({ id, run, delivery }) => ({ id, run, delivery })) },
		});
	} catch (error) {
		for (const claim of claims) claim.source.release(claim.token);
		throw error;
	}
	for (const claim of claims) claim.source.commit(claim.token);
	return true;
}

/**
 * Sleeps with no model call and no timer until a source changes, `subscribe` wakes it, or `signal` aborts.
 * The sources are looked at again after subscribing, so a change that came in between is not lost.
 */
export async function untilBackgroundChange(options: { sources: AutoSource[]; subscribe(wake: () => void): () => void; settled(): boolean; signal: AbortSignal }): Promise<void> {
	const { sources, signal } = options;
	const changed = Promise.withResolvers<void>();
	const abort = () => changed.reject(signal.reason ?? new Error("aborted"));
	const stops = [...sources.map(source => source.subscribe(() => changed.resolve())), options.subscribe(changed.resolve)];
	signal.addEventListener("abort", abort, { once: true });
	try {
		if (signal.aborted) abort();
		else if (backgroundReady(sources) || !backgroundLive(sources) || options.settled()) changed.resolve();
		await changed.promise;
	} finally {
		for (const stop of stops) stop();
		signal.removeEventListener("abort", abort);
	}
}
