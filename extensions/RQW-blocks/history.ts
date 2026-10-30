// Full scrollback after a compaction. Pi 1.4.0 draws only the compaction-aware context: on resume, on /tree, on /reload and
// on every compaction it clears the chat and renders `sessionManager.buildContextEntries()`, so the entries before the
// kept range vanish from the scroll. Display only: the model context is untouched. This wraps the four spots that feed
// that list to `renderSessionEntries` and, for that one call, swaps in the active branch, with each compaction at its
// chronological place. In Pi's fullscreen view only the part from the latest compaction's kept range on is drawn at once;
// the older part is loaded when the owner scrolls to the top (`lazy.ts`). Any other shape falls back to the whole branch.
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { createLazy, type Lazy } from "./lazy.ts";

const ACTIVE = Symbol.for("rqw-blocks.history");

type Entry = { id: string; type: string };
type Host = { transcriptScrollView?: { isFollowingEnd?: boolean }; editor?: { addToHistory?: (text: string) => void }; getUserMessageText?: (message: unknown) => string; sessionManager?: { getBranch?: () => Entry[]; buildContextEntries?: () => Entry[] } };
/** "all": the entries are the whole context (resume, /tree, rebuild). "prefix": the entries are the context without its
 * compaction entry (a fresh compaction); the kept range is replaced by everything before the compaction. */
type Mode = "all" | "prefix";

/** `keep`: the branch index the owner had drawn from before a fresh compaction; the intervals down to it are drawn again. */
interface Plan { shown: Entry[]; older?: Entry[]; from: number; starts: number[]; keep: number }

/** What to draw instead of `entries`, or undefined to draw `entries` as Pi gave them. `older` (with the branch index
 * `from` where `shown` starts and the interval starts `starts`) is the part that waits for the owner to scroll up. */
export function displayEntries(host: Host, entries: Entry[], mode: Mode, lazy?: Lazy): Plan | undefined {
	const manager = host.sessionManager;
	if (typeof manager?.getBranch !== "function" || typeof manager.buildContextEntries !== "function" || !Array.isArray(entries)) return undefined;
	const context = manager.buildContextEntries();
	const latest = context[0];
	if (latest?.type !== "compaction") return undefined;
	const branch = manager.getBranch();
	const at = branch.findIndex((entry) => entry.id === latest.id);
	if (at < 0) return undefined;
	let whole: Entry[];
	if (mode === "all") {
		if (entries[0] !== latest) return undefined;
		whole = branch;
	} else {
		if (entries.length > 0 && entries[0] !== context[1]) return undefined;
		// The entries after the compaction stay as Pi gives them; nothing earlier is left out.
		const after = new Set(branch.slice(at + 1).map((entry) => entry.id));
		whole = [...branch.slice(0, at), ...entries.filter((entry) => after.has(entry.id))];
	}
	if (!lazy?.available(host)) return { shown: whole, from: 0, starts: [], keep: 0 };
	const starts = intervalStarts(branch, at);
	if (!starts) return { shown: whole, from: 0, starts: [], keep: 0 };
	const from = starts[starts.length - 1];
	// A compaction while the owner reads above the bottom must not move his rows: what he had loaded is drawn again.
	const keep = mode === "prefix" && !host.transcriptScrollView?.isFollowingEnd ? Math.min(from, lazy.drawnFrom(host)) : from;
	return { shown: whole.slice(from), older: whole.slice(0, from), from, starts: starts.filter((start) => start < from), keep };
}

/** The interval starts of the branch up to its latest compaction at `at`: 0, then the kept-range start of every compaction.
 * Undefined unless they are strictly ascending, each before its own compaction (Pi 1.4.0 cuts that way), and the last is real. */
function intervalStarts(branch: Entry[], at: number): number[] | undefined {
	const where = new Map(branch.map((entry, index) => [entry.id, index]));
	const starts = [0];
	for (let index = 0; index <= at; index++) {
		const entry = branch[index] as Entry & { firstKeptEntryId?: string };
		if (entry.type !== "compaction") continue;
		const start = where.get(entry.firstKeptEntryId ?? "");
		if (start === undefined || start >= index || start <= starts[starts.length - 1]) return undefined;
		starts.push(start);
	}
	return starts.length > 1 ? starts : undefined;
}

/** The editor's input history of the entries that are not drawn: Pi adds the user messages of what it draws, and that must
 * stay the whole branch's. Throws on an unexpected shape, before anything is added. */
function historyTexts(host: Host, older: Entry[]): string[] {
	if (typeof host.getUserMessageText !== "function" || typeof host.editor?.addToHistory !== "function") throw new Error("no input history");
	const texts: string[] = [];
	for (const entry of older as (Entry & { message?: { role?: string } })[]) {
		if (entry.type !== "message" || entry.message?.role !== "user") continue;
		const text = host.getUserMessageText(entry.message);
		if (text) texts.push(text);
	}
	return texts;
}

export function installHistory(prototype: any = InteractiveMode.prototype): () => void {
	const names = ["renderSessionEntries", "renderInitialMessages", "rebuildChatFromMessages", "handleEvent"];
	if (names.some((name) => typeof prototype?.[name] !== "function")) return () => {};
	const lazyNames = typeof prototype.switchTuiMode === "function" ? [...names, "switchTuiMode"] : names;
	(globalThis as any)[ACTIVE]?.();
	const own = Object.getOwnPropertyDescriptors(prototype);
	const render = prototype.renderSessionEntries;
	const initial = prototype.renderInitialMessages;
	const rebuild = prototype.rebuildChatFromMessages;
	const handle = prototype.handleEvent;
	const switchMode = prototype.switchTuiMode;
	// Lazy loading needs the mode switch too: inline mode and the exit transcript must get the whole history.
	const lazy = createLazy(render, typeof switchMode === "function");
	// Armed by a wrapper, used by the next `renderSessionEntries` call only.
	let armed: Mode | undefined;
	const arm = (mode: Mode, run: () => unknown) => {
		armed = mode;
		try { return run(); } finally { armed = undefined; }
	};
	prototype.renderSessionEntries = function (this: Host, entries: Entry[], options?: unknown) {
		const mode = armed;
		armed = undefined;
		let plan: Plan | undefined;
		let texts: string[] = [];
		if (mode) try {
			plan = displayEntries(this, entries, mode, lazy);
			if (plan?.older && (options as { populateHistory?: boolean } | undefined)?.populateHistory) texts = historyTexts(this, plan.older);
		} catch {
			// Whatever failed in the lazy path, the whole branch is drawn, never the compacted context alone.
			texts = [];
			try { plan = displayEntries(this, entries, mode); } catch { plan = undefined; }
		}
		if (mode) lazy.reset(this);
		// Oldest first, before Pi adds the drawn part's prompts: the order of the whole branch.
		for (const text of texts) this.editor?.addToHistory?.(text);
		const result = render.call(this, plan?.shown ?? entries, options);
		if (plan?.older?.length) {
			lazy.begin(this, plan.older, plan.from, plan.starts);
			if (plan.keep < plan.from) lazy.restore(this, plan.keep);
		}
		return result;
	};
	if (typeof switchMode === "function") prototype.switchTuiMode = function (this: any, mode: unknown, ...args: unknown[]) {
		if (mode !== "fullscreen") lazy.loadAll(this);
		return switchMode.call(this, mode, ...args);
	};
	prototype.renderInitialMessages = function (this: unknown, ...args: unknown[]) { return arm("all", () => initial.apply(this, args)); };
	prototype.rebuildChatFromMessages = function (this: unknown, ...args: unknown[]) { return arm("all", () => rebuild.apply(this, args)); };
	// Only the synchronous start of the handler matters: both compaction branches clear and draw before their first await.
	prototype.handleEvent = function (this: unknown, event: any, ...args: unknown[]) {
		const type = event?.type;
		const fresh = type === "compaction_end" ? event.result && !event.aborted : type === "entry_appended" && event.entry?.type === "compaction";
		return fresh ? arm("prefix", () => handle.call(this, event, ...args)) : handle.call(this, event, ...args);
	};
	const restore = () => {
		lazy.dispose();
		for (const key of lazyNames) if (own[key]) Object.defineProperty(prototype, key, own[key]); else delete prototype[key];
		if ((globalThis as any)[ACTIVE] === restore) delete (globalThis as any)[ACTIVE];
	};
	(globalThis as any)[ACTIVE] = restore;
	return restore;
}
