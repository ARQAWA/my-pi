// What the upper border says: the main agent's planning or tool action, running agents (counts
// read from RQW-agent's `pi.events` offers, not a second registry), and the compaction. Pure text
// plus a small consumer of the counts channel; nothing here draws.
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { singleLine } from "./render.ts";

// Channel names of the counts contract (RQW-agent README "Contract for P6"); spelled here, nothing imported.
export const COUNTS_VERSION = 1;
export const COUNTS_REQUEST = "rqw:running-counts:request";
export const COUNTS_OFFER = "rqw:running-counts:offer";

export interface RunningCounts {
	agents: number;
	/** Optional on existing version-1 agent sources. Only the main session's jobs contribute here. */
	backgroundProcesses?: number;
}

type CountsListener = (counts: RunningCounts | null) => void;
interface CountsSource {
	readonly version: number;
	snapshot(): RunningCounts;
	subscribe(listener: CountsListener): () => void;
}

const zero = (): RunningCounts => ({ agents: 0 });
const same = (a: RunningCounts, b: RunningCounts) => a.agents === b.agents && (a.backgroundProcesses ?? 0) === (b.backgroundProcesses ?? 0);

/** Sums the live agent counts of this session; a source that ends (`null`) is dropped at once. */
export class CountsWatch {
	private readonly events: Pick<EventBus, "emit" | "on">;
	private readonly changed: () => void;
	private readonly sources = new Map<CountsSource, () => void>();
	private stopOffer: (() => void) | undefined;
	private total: RunningCounts = zero();

	constructor(events: Pick<EventBus, "emit" | "on">, changed: () => void) {
		this.events = events;
		this.changed = changed;
	}

	/** Listens for offers first, then asks the live producers to reply (either load order works). Idempotent. */
	start(): void {
		if (this.stopOffer) return;
		this.stopOffer = this.events.on(COUNTS_OFFER, (offer) => {
			const message = offer as { version?: unknown; source?: unknown } | undefined;
			if (message?.version === COUNTS_VERSION) this.adopt(message.source);
		});
		this.events.emit(COUNTS_REQUEST, { version: COUNTS_VERSION, reply: (source: CountsSource) => this.adopt(source) });
	}

	/** Unsubscribes from the offers and from every source; the counts drop to zero. */
	stop(): void {
		this.stopOffer?.();
		this.stopOffer = undefined;
		for (const unsubscribe of this.sources.values()) unsubscribe();
		this.sources.clear();
		this.total = zero();
	}

	get(): RunningCounts {
		return { ...this.total };
	}

	private adopt(offered: unknown): void {
		const source = offered as CountsSource | undefined;
		if (!source || typeof source !== "object" || source.version !== COUNTS_VERSION) return;
		if (typeof source.snapshot !== "function" || typeof source.subscribe !== "function") return;
		if (this.sources.has(source)) return;
		let ended = false;
		const unsubscribe = source.subscribe((counts) => {
			if (counts === null) {
				ended = true;
				this.drop(source);
			} else this.refresh();
		});
		// A source that has already ended answers `null` during subscribe: it is never kept.
		if (ended) {
			unsubscribe();
			this.refresh();
			return;
		}
		this.sources.set(source, unsubscribe);
		this.refresh();
	}

	private drop(source: CountsSource): void {
		const unsubscribe = this.sources.get(source);
		this.sources.delete(source);
		unsubscribe?.();
		this.refresh();
	}

	private refresh(): void {
		const next = zero();
		for (const source of this.sources.keys()) {
			const counts = source.snapshot();
			next.agents += counts.agents;
			if (counts.backgroundProcesses) next.backgroundProcesses = (next.backgroundProcesses ?? 0) + counts.backgroundProcesses;
		}
		const changed = !same(next, this.total);
		this.total = next;
		if (changed) this.changed();
	}
}

/** Agent count with the correct plural; zero is omitted. */
export function countParts(counts: RunningCounts): string[] {
	const parts: string[] = [];
	if (counts.agents > 0) parts.push(`${counts.agents} ${counts.agents === 1 ? "agent" : "agents"}`);
	const processes = counts.backgroundProcesses ?? 0;
	if (processes > 0) parts.push(`${processes} background ${processes === 1 ? "process" : "processes"}`);
	return parts;
}

export interface StatusInput {
	compacting: boolean;
	/** The main agent run is in progress (agent_start until agent_settled). */
	running: boolean;
	/** The latest running tool's action phrase while tools run. */
	action?: string;
	counts: RunningCounts;
}

/** The status text of the upper border, or undefined when fully idle (no label, no reserved gap). */
export function statusText(input: StatusInput): { text: string; compacting: boolean } | undefined {
	if (input.compacting) return { text: "Compacting context", compacting: true };
	// Main's active thinking/tool text keeps its existing agent suffix, not a background-job action.
	const parts = countParts(input.running ? { agents: input.counts.agents } : input.counts);
	if (input.running) {
		const head = input.action ?? "Planning next moves";
		return { text: parts.length > 0 ? `${head} · ${parts.join(", ")}` : head, compacting: false };
	}
	if (parts.length > 0) return { text: `Waiting for ${parts.join(", ")}`, compacting: false };
	return undefined;
}

const lastPathPart = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? "";

/** The action phrase of a running tool: `Running npm test`, `Editing app.ts`; other tools name themselves. */
export function actionPhrase(toolName: string, args: unknown): string {
	const record = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
	const text = (value: unknown) => (typeof value === "string" ? singleLine(value) : "");
	const path = (): string => {
		const direct = text(record.path);
		if (direct) return direct;
		const first = Array.isArray(record.edits) ? (record.edits[0] as Record<string, unknown> | undefined) : undefined;
		return text(first?.path);
	};
	switch (toolName) {
		case "bash": {
			const command = text(record.command);
			return command ? `Running ${command}` : "Running command";
		}
		case "read":
			return `Reading ${lastPathPart(path()) || "file"}`;
		case "edit":
			return `Editing ${lastPathPart(path()) || "file"}`;
		case "write":
			return `Writing ${lastPathPart(path()) || "file"}`;
		case "grep":
		case "find":
			return "Searching files";
		default:
			return `Running ${singleLine(toolName) || "tool"}`;
	}
}
