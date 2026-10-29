// Full scrollback after a compaction. Pi 1.4.0 draws only the compaction-aware context: on resume, on /tree, on /reload and
// on every compaction it clears the chat and renders `sessionManager.buildContextEntries()`, so the entries before the
// kept range vanish from the scroll. Display only: the model context is untouched. This wraps the four spots that feed
// that list to `renderSessionEntries` and, for that one call, swaps in the whole active branch, with each compaction at
// its chronological place. Any other shape falls back to stock.
import { InteractiveMode } from "@earendil-works/pi-coding-agent";

const ACTIVE = Symbol.for("rqw-blocks.history");

type Entry = { id: string; type: string };
type Host = { sessionManager?: { getBranch?: () => Entry[]; buildContextEntries?: () => Entry[] } };
/** "all": the entries are the whole context (resume, /tree, rebuild). "prefix": the entries are the context without its
 * compaction entry (a fresh compaction); the kept range is replaced by everything before the compaction. */
type Mode = "all" | "prefix";

/** The entries to draw instead of `entries`, or undefined to draw `entries` as Pi gave them. */
export function displayEntries(host: Host, entries: Entry[], mode: Mode): Entry[] | undefined {
	const manager = host.sessionManager;
	if (typeof manager?.getBranch !== "function" || typeof manager.buildContextEntries !== "function" || !Array.isArray(entries)) return undefined;
	const context = manager.buildContextEntries();
	const latest = context[0];
	if (latest?.type !== "compaction") return undefined;
	const branch = manager.getBranch();
	const at = branch.findIndex((entry) => entry.id === latest.id);
	if (at < 0) return undefined;
	if (mode === "all") return entries[0] === latest ? branch : undefined;
	if (entries.length > 0 && entries[0] !== context[1]) return undefined;
	// The entries after the compaction stay as Pi gives them; nothing earlier is left out.
	const after = new Set(branch.slice(at + 1).map((entry) => entry.id));
	return [...branch.slice(0, at), ...entries.filter((entry) => after.has(entry.id))];
}

export function installHistory(prototype: any = InteractiveMode.prototype): () => void {
	const names = ["renderSessionEntries", "renderInitialMessages", "rebuildChatFromMessages", "handleEvent"];
	if (names.some((name) => typeof prototype?.[name] !== "function")) return () => {};
	(globalThis as any)[ACTIVE]?.();
	const own = Object.getOwnPropertyDescriptors(prototype);
	const render = prototype.renderSessionEntries;
	const initial = prototype.renderInitialMessages;
	const rebuild = prototype.rebuildChatFromMessages;
	const handle = prototype.handleEvent;
	// Armed by a wrapper, used by the next `renderSessionEntries` call only.
	let armed: Mode | undefined;
	const arm = (mode: Mode, run: () => unknown) => {
		armed = mode;
		try { return run(); } finally { armed = undefined; }
	};
	prototype.renderSessionEntries = function (this: Host, entries: Entry[], options?: unknown) {
		const mode = armed;
		armed = undefined;
		let shown: Entry[] | undefined;
		if (mode) try { shown = displayEntries(this, entries, mode); } catch { shown = undefined; }
		return render.call(this, shown ?? entries, options);
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
		for (const key of names) if (own[key]) Object.defineProperty(prototype, key, own[key]); else delete prototype[key];
		if ((globalThis as any)[ACTIVE] === restore) delete (globalThis as any)[ACTIVE];
	};
	(globalThis as any)[ACTIVE] = restore;
	return restore;
}
