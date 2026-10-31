import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const REQUEST = "rqw:running-counts:request";
const OFFER = "rqw:running-counts:offer";
type Source = { version: number; snapshot(): { agents?: number; backgroundProcesses?: number }; subscribe(listener: (value: unknown) => void): () => void };

/** The real final of the main session: no running agents, no background jobs, no waiting `wait`, no undelivered notification. */
export type RealFinal = {
	held(): boolean;
	/** Runs `action` at the real final; at once when nothing is held. The same key replaces an earlier action. */
	defer(key: string, action: () => unknown): void;
	drop(key: string): void;
	/** The hold may have changed without a count change, for example a cancelled wait. */
	poke(): void;
	onChange(listener: () => void): () => void;
};

/** One shared gate: the running-count intake and `held()` of the follow-up hold, plus actions that wait for the real final. A new turn cancels them. */
export function registerRealFinal(pi: ExtensionAPI, waiting: (background: boolean) => boolean): RealFinal {
	const sources = new Map<Source, () => void>();
	const actions = new Map<string, () => unknown>();
	const listeners = new Set<() => void>();
	let stopOffer = () => {};
	let queued = false;
	const held = () => waiting([...sources.keys()].some(source => { const count = source.snapshot(); return (count.agents ?? 0) > 0 || (count.backgroundProcesses ?? 0) > 0; }));
	const run = (action: () => unknown) => {
		// A failed terminal write must not break the session.
		try { void Promise.resolve(action()).catch(() => {}); } catch { /* Best effort. */ }
	};
	const runAll = () => { const ready = [...actions.values()]; actions.clear(); ready.forEach(run); };
	// One microtask later, so a delivery that starts a turn right after the hold ends is seen first.
	const settle = () => {
		if (queued) return;
		queued = true;
		queueMicrotask(() => { queued = false; if (actions.size && !held()) runAll(); });
	};
	const changed = () => { for (const listener of [...listeners]) listener(); settle(); };
	const adopt = (value: unknown) => {
		const source = value as Source;
		if (!source || source.version !== 1 || typeof source.snapshot !== "function" || typeof source.subscribe !== "function" || sources.has(source)) return;
		let ended = false;
		const unsubscribe = source.subscribe(counts => { if (counts === null) { ended = true; sources.get(source)?.(); sources.delete(source); } changed(); });
		if (ended) unsubscribe(); else sources.set(source, unsubscribe);
	};
	const stopSources = () => {
		stopOffer(); stopOffer = () => {};
		for (const unsubscribe of sources.values()) unsubscribe();
		sources.clear();
	};
	pi.on("session_start", () => {
		stopSources();
		stopOffer = pi.events.on(OFFER, (offer: any) => { if (offer?.version === 1) adopt(offer.source); });
		pi.events.emit(REQUEST, { version: 1, reply: adopt });
	});
	pi.on("agent_start", () => actions.clear());
	pi.on("agent_settled", () => changed());
	// Nothing may stay "working" in the terminal after the session ends.
	pi.on("session_shutdown", () => { runAll(); stopSources(); });
	return {
		held,
		defer(key, action) { if (held()) actions.set(key, action); else { actions.delete(key); run(action); } },
		drop(key) { actions.delete(key); },
		poke: changed,
		onChange(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
	};
}
