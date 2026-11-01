import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Source = { version: number; snapshot(): { agents?: number; backgroundProcesses?: number }; subscribe(listener: (value: unknown) => void): () => void };

export function registerRunningCounts(pi: ExtensionAPI) {
	const sources = new Map<Source, () => void>();
	const listeners = new Set<() => void>();
	let stopOffer = () => {};
	const changed = () => { for (const listener of [...listeners]) listener(); };
	const running = () => [...sources.keys()].some(source => {
		const value = source.snapshot();
		return (value.agents ?? 0) > 0 || (value.backgroundProcesses ?? 0) > 0;
	});
	const adopt = (source: Source) => {
		if (!source || source.version !== 1 || typeof source.snapshot !== "function" || typeof source.subscribe !== "function" || sources.has(source)) return;
		let ended = false;
		const unsubscribe = source.subscribe(value => {
			if (value === null) { ended = true; sources.get(source)?.(); sources.delete(source); }
			changed();
		});
		if (ended) unsubscribe(); else sources.set(source, unsubscribe);
		changed();
	};
	const stop = () => {
		stopOffer(); stopOffer = () => {};
		for (const unsubscribe of sources.values()) unsubscribe();
		sources.clear();
	};
	pi.on("session_start", () => {
		stop();
		stopOffer = pi.events.on("rqw:running-counts:offer", (offer: any) => { if (offer?.version === 1) adopt(offer.source); });
		pi.events.emit("rqw:running-counts:request", { version: 1, reply: adopt });
	});
	pi.on("session_shutdown", stop);
	return { running, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}

export type RunningCounts = ReturnType<typeof registerRunningCounts>;
