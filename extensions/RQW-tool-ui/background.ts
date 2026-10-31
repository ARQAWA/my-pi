// The real final: an answer given while agents or background processes still run is not the end of the task, so it
// must not close the worked-for fold. Busy state comes from the shared running-counts channel on `pi.events`
// (names spelled here, nothing imported). The verdict is saved as invisible `rqw-tool-ui-final` entries, because a
// reloaded history cannot know whether something still ran (README.md, DECISIONS.md «Compact tool display»).
import type { EventBus, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { record } from "./classify.ts";
import { FINAL_ENTRY, isFinal, messageKey } from "./groups.ts";

type ReadonlySessionManager = ExtensionContext["sessionManager"];

const COUNTS_VERSION = 1;
const COUNTS_REQUEST = "rqw:running-counts:request";
const COUNTS_OFFER = "rqw:running-counts:offer";
/** After the background ends in an idle session, a woken run may still be about to start: wait this long first. */
const SETTLE_MS = 500;

interface CountsSource {
	readonly version: number;
	snapshot(): { agents: number; backgroundProcesses?: number };
	subscribe(listener: (counts: unknown) => void): () => void;
}

export class RealFinal {
	private readonly events: Pick<EventBus, "emit" | "on">;
	private readonly append: (data: { key: string; final: boolean }) => void;
	private readonly changed: () => void;
	private readonly sources = new Map<CountsSource, () => void>();
	private stopOffer: (() => void) | undefined;
	private manager: ReadonlySessionManager | undefined;
	private running = false;
	/** The key of the answer last marked `final: false`, until its final mark is written or given up. */
	private pending: string | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(events: Pick<EventBus, "emit" | "on">, append: (data: { key: string; final: boolean }) => void, changed: () => void) {
		this.events = events;
		this.append = append;
		this.changed = changed;
	}

	/** A TUI session started: listen to the counts producers, either load order works. */
	start(manager: ReadonlySessionManager): void {
		this.stop();
		this.manager = manager;
		this.stopOffer = this.events.on(COUNTS_OFFER, (offer) => {
			const message = record(offer);
			if (message.version === COUNTS_VERSION) this.adopt(message.source);
		});
		this.events.emit(COUNTS_REQUEST, { version: COUNTS_VERSION, reply: (source: unknown) => this.adopt(source) });
	}

	stop(): void {
		this.cancel();
		this.stopOffer?.();
		this.stopOffer = undefined;
		for (const unsubscribe of this.sources.values()) unsubscribe();
		this.sources.clear();
		this.manager = undefined;
		this.running = false;
		this.pending = undefined;
	}

	agentStart(): void {
		this.running = true;
	}

	/** A run settled: an answer that ended it while something still runs is marked as not final. */
	settled(aborted: boolean): void {
		this.running = false;
		if (!this.manager || aborted || !this.busy()) return;
		const answer = lastAnswer(this.manager);
		const key = answer === undefined ? undefined : messageKey(answer);
		if (key === undefined) return;
		this.write(key, false);
		this.pending = key;
	}

	private busy(): boolean {
		for (const source of this.sources.keys()) {
			const counts = source.snapshot();
			if (counts.agents > 0 || (counts.backgroundProcesses ?? 0) > 0) return true;
		}
		return false;
	}

	private adopt(offered: unknown): void {
		const source = offered as CountsSource | undefined;
		if (!source || typeof source !== "object" || source.version !== COUNTS_VERSION) return;
		if (typeof source.snapshot !== "function" || typeof source.subscribe !== "function" || this.sources.has(source)) return;
		let ended = false;
		const unsubscribe = source.subscribe((counts) => {
			if (counts === null) {
				ended = true;
				this.sources.get(source)?.();
				this.sources.delete(source);
			}
			this.countsChanged();
		});
		if (ended) unsubscribe();
		else this.sources.set(source, unsubscribe);
	}

	/** Nothing runs any more in an idle session whose last answer is marked: write the final after a short pause. */
	private countsChanged(): void {
		if (this.quiet()) this.timer ??= setTimeout(() => this.finish(), SETTLE_MS);
		else this.cancel();
	}

	private quiet(): boolean {
		return this.pending !== undefined && !this.running && !this.busy();
	}

	private finish(): void {
		this.timer = undefined;
		const key = this.pending;
		if (key === undefined || !this.quiet() || !this.manager) return;
		this.pending = undefined;
		if (untouchedSince(this.manager, key)) this.write(key, true);
	}

	private cancel(): void {
		if (this.timer !== undefined) clearTimeout(this.timer);
		this.timer = undefined;
	}

	private write(key: string, final: boolean): void {
		this.append({ key, final });
		this.changed();
	}
}

/** The entries of the active branch from the leaf back; the walk stops where the caller stops reading. */
function* fromLeaf(manager: ReadonlySessionManager): Generator<SessionEntry> {
	let entry = manager.getLeafEntry();
	while (entry) {
		yield entry;
		entry = entry.parentId ? manager.getEntry(entry.parentId) : undefined;
	}
}

/** The last answer of the branch, when it is a successful one and no message or card follows it. */
function lastAnswer(manager: ReadonlySessionManager): unknown {
	for (const e of fromLeaf(manager)) {
		if (e.type === "custom_message") return undefined;
		if (e.type === "message") return isFinal(e.message) ? e.message : undefined;
	}
	return undefined;
}

/** True when the newest `final: false` entry of `key` is followed by no message or card. */
function untouchedSince(manager: ReadonlySessionManager, key: string): boolean {
	for (const e of fromLeaf(manager)) {
		if (e.type === "message" || e.type === "custom_message") return false;
		if (e.type === "custom" && e.customType === FINAL_ENTRY) return record(e.data).key === key && record(e.data).final === false;
	}
	return false;
}
