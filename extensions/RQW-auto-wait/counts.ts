import type { EventBus } from "@earendil-works/pi-coding-agent";

type Counts = { agents: number; backgroundProcesses?: number };
type Source = { version: 1; snapshot(): Counts; subscribe(listener: (counts: Counts | null) => void): () => void };

export function countsWatch(events: EventBus, changed: () => void) {
	const sources = new Map<Source, () => void>();
	let stopOffer: (() => void) | undefined;
	let total: Counts | undefined;
	function refresh() {
		const next = sources.size ? { agents: 0, backgroundProcesses: 0 } : undefined;
		if (next) for (const source of sources.keys()) {
			const counts = source.snapshot();
			next.agents += counts.agents;
			next.backgroundProcesses += counts.backgroundProcesses ?? 0;
		}
		if (next?.agents === total?.agents && next?.backgroundProcesses === total?.backgroundProcesses) return;
		total = next;
		changed();
	}
	function adopt(source: Source) {
		if (!source || source.version !== 1 || typeof source.snapshot !== "function" || typeof source.subscribe !== "function" || sources.has(source)) return;
		let ended = false;
		const unsubscribe = source.subscribe(value => {
			if (value === null) { ended = true; sources.get(source)?.(); sources.delete(source); }
			refresh();
		});
		if (ended) unsubscribe(); else sources.set(source, unsubscribe);
		refresh();
	}
	return {
		start() {
			stopOffer = events.on("rqw:running-counts:offer", (offer: any) => { if (offer?.version === 1) adopt(offer.source); });
			events.emit("rqw:running-counts:request", { version: 1, reply: adopt });
		},
		stop() {
			stopOffer?.(); stopOffer = undefined;
			for (const unsubscribe of sources.values()) unsubscribe();
			sources.clear(); total = undefined;
		},
		get() { return total; },
	};
}
