// Public version-1 counts source. Only the extension's main registry is connected, never child createTools.
import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { Jobs } from "./jobs.ts";

export const COUNTS_VERSION = 1;
export const COUNTS_REQUEST = "rqw:running-counts:request";
export const COUNTS_OFFER = "rqw:running-counts:offer";
export type RunningCounts = { agents: number; backgroundProcesses: number };
type Listener = (counts: RunningCounts | null) => void;
export type CountsSource = {
	readonly version: typeof COUNTS_VERSION;
	snapshot(): RunningCounts;
	subscribe(listener: Listener): () => void;
	dispose(): void;
};
const deliver = (listener: Listener, counts: RunningCounts | null) => {
	try { listener(counts); } catch { /* Consumer failures stay outside the job lifecycle. */ }
};

/** A fresh source per session, supporting either producer/consumer load order. */
export function createCountsProducer(jobs: Jobs, events: Pick<EventBus, "on" | "emit">) {
	let current: CountsSource | undefined;
	let stopRequest: (() => void) | undefined;
	return {
		start() {
			current?.dispose();
			stopRequest?.();
			let ended = false;
			let last = jobs.backgroundCount();
			const listeners = new Set<Listener>();
			const snapshot = (): RunningCounts => ({ agents: 0, backgroundProcesses: ended ? 0 : jobs.backgroundCount() });
			const unsubscribe = jobs.subscribeActivity(() => {
				const next = snapshot();
				if (next.backgroundProcesses === last) return;
				last = next.backgroundProcesses;
				for (const listener of [...listeners]) deliver(listener, { ...next });
			});
			const source: CountsSource = {
				version: COUNTS_VERSION,
				snapshot,
				subscribe(listener) {
					if (ended) { deliver(listener, null); return () => {}; }
					listeners.add(listener);
					return () => { listeners.delete(listener); };
				},
				dispose() {
					if (ended) return;
					ended = true;
					unsubscribe();
					const gone = [...listeners];
					listeners.clear();
					for (const listener of gone) deliver(listener, null);
				},
			};
			current = source;
			stopRequest = events.on(COUNTS_REQUEST, (raw) => {
				const request = raw as { version?: number; reply?: (source: CountsSource) => void } | undefined;
				if (!ended && request?.version === COUNTS_VERSION && typeof request.reply === "function") request.reply(source);
			});
			events.emit(COUNTS_OFFER, { version: COUNTS_VERSION, source });
		},
		stop() {
			stopRequest?.();
			stopRequest = undefined;
			current?.dispose();
			current = undefined;
		},
	};
}
