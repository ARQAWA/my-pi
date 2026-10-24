// Running counts by kind for one top-level Pi session, offered on pi.events. RQW-agent counts only its own
// children: agents in native activity (their Pi session is not idle), nested children included; not
// logical active runs. RQW-review offers its own reviews in the same shape (no import).
//
// Contract, version 1. Producer and consumer may load in either order:
// - request: a consumer emits COUNTS_REQUEST with { version, reply(source) }; a live producer replies synchronously.
// - offer: a producer emits COUNTS_OFFER with { version, source } at its session_start.
// - source.snapshot(): running counts now, zero once the source has ended.
// - source.subscribe(listener): the listener gets the counts on each change, and null when the source ends;
//   the returned function unsubscribes. Subscribing to an ended source calls the listener with null at once.
// - source.dispose(): ends the source (producer-owned lifecycle); idempotent, and the same end the producer uses.
//   The producer ends its source at session_shutdown or at the next session_start; its listeners are cleared,
//   so nothing is kept after the session. Consumers call only the returned unsubscribe, never dispose.
// - A throwing listener is isolated: it never breaks the producer or the other listeners.
// Running means an active run, never an undelivered result.
import type { EventBus } from "@earendil-works/pi-coding-agent";

export const COUNTS_VERSION = 1;
export const COUNTS_REQUEST = "rqw:running-counts:request";
export const COUNTS_OFFER = "rqw:running-counts:offer";

export type RunningCounts = { agents: number; reviews: number };
export type CountsListener = (counts: RunningCounts | null) => void;
export type CountsSource = {
	readonly version: typeof COUNTS_VERSION;
	snapshot(): RunningCounts;
	subscribe(listener: CountsListener): () => void;
	dispose(): void;
};
export type CountsRequest = { version: typeof COUNTS_VERSION; reply(source: CountsSource): void };
export type CountsOffer = { version: typeof COUNTS_VERSION; source: CountsSource };

const ZERO: RunningCounts = { agents: 0, reviews: 0 };
const same = (a: RunningCounts, b: RunningCounts) => a.agents === b.agents && a.reviews === b.reviews;
// A consumer's error stays with the consumer: it must never reach the run that changed the counts.
const deliver = (listener: CountsListener, counts: RunningCounts | null) => {
	try {
		listener(counts);
	} catch {
		// isolated
	}
};

/** One source over `read`. `refresh` notifies the listeners only when the counts changed. */
function makeSource(read: () => RunningCounts) {
	let last = read();
	let ended = false;
	const listeners = new Set<CountsListener>();
	// The one end: `dispose` on the source and the producer's stop/replacement both run this closure.
	const end = () => {
		if (ended) return;
		ended = true;
		const gone = [...listeners];
		listeners.clear();
		for (const listener of gone) deliver(listener, null);
	};
	const value: CountsSource = {
		version: COUNTS_VERSION,
		snapshot: () => (ended ? { ...ZERO } : read()),
		subscribe(listener) {
			if (ended) {
				deliver(listener, null);
				return () => {};
			}
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		dispose: end,
	};
	return {
		value,
		refresh() {
			if (ended) return;
			const next = read();
			if (same(next, last)) return;
			last = next;
			for (const listener of [...listeners]) deliver(listener, next);
		},
		end,
	};
}

/** The producer of one extension: a fresh source per session start, the previous one ended first. */
export function createCountsProducer(read: () => RunningCounts, events: EventBus) {
	let current: ReturnType<typeof makeSource> | undefined;
	return {
		start() {
			current?.end();
			current = makeSource(read);
			const offer: CountsOffer = { version: COUNTS_VERSION, source: current.value };
			events.emit(COUNTS_OFFER, offer);
		},
		stop() {
			current?.end();
			current = undefined;
		},
		reply(request: CountsRequest) {
			if (current) request.reply(current.value);
		},
		refresh() {
			current?.refresh();
		},
	};
}
