// Safe session projection. Pi 1.4.0 `buildContextEntries` (dist/core/session-manager.js:227) passes the whole tail after
// the latest compaction to `push(...)`; a tail of about 120000 entries throws `RangeError: Maximum call stack size
// exceeded` in every caller of the projection. This copy builds the same result with loops. It runs only after the stock
// call has thrown a RangeError. Append-only manager steps reuse the previous result after that guarded first call.
import * as Pi from "@earendil-works/pi-coding-agent";

type Entry = { id: string; parentId?: string | null; type: string; [key: string]: any };
type Message = { role: string; [key: string]: any };
type Projection = {
	entries: Array<{ sourceEntry: Entry; messages: Message[] }>;
	messages: Message[];
	thinkingLevel: string;
	model: { provider: string; modelId: string } | null;
};
type Index = Map<string, Entry>;
type Manager = { getEntries(): Entry[]; leafId: string | null | undefined; byId: Index; fileEntries?: Entry[] };
type Method = (this: Manager) => unknown;

/** Process-wide offer for code that calls Pi's free `buildSessionProjection(entries, leafId)` directly. */
export const SAFE_PROJECTION = Symbol.for("rqw:safe-projection:v1");
const INSTALLED = Symbol.for("rqw-history-edit/safe-projection");

function sessionPath(entries: Entry[], leafId: string | null | undefined, byId?: Index): Entry[] {
	if (leafId === null) return [];
	const index = byId ?? new Map(entries.map((entry) => [entry.id, entry]));
	const leaf = (leafId ? index.get(leafId) : undefined) ?? entries[entries.length - 1];
	const path: Entry[] = [];
	for (let current: Entry | undefined = leaf; current; current = current.parentId ? index.get(current.parentId) : undefined) path.push(current);
	return path.reverse();
}

export function safeContextEntries(entries: Entry[], leafId?: string | null, byId?: Index): Entry[] {
	const path = sessionPath(entries, leafId, byId);
	const at = path.findLastIndex((entry) => entry.type === "compaction");
	if (at < 0) return path;
	const compaction = path[at]!;
	const out: Entry[] = [compaction];
	let kept = false;
	for (let i = 0; i < at; i++) {
		const entry = path[i]!;
		if (entry.id === compaction.firstKeptEntryId) kept = true;
		if (kept && !(entry.type === "message" && entry.message.role === "system")) out.push(entry);
	}
	for (let i = at + 1; i < path.length; i++) out.push(path[i]!);
	return out;
}

function settingsOf(path: Entry[]): Pick<Projection, "thinkingLevel" | "model"> {
	let thinkingLevel = "off";
	let model: Projection["model"] = null;
	for (const entry of path) {
		if (entry.type === "thinking_level_change") thinkingLevel = entry.thinkingLevel;
		else if (entry.type === "model_change") model = { provider: entry.provider, modelId: entry.modelId };
		else if (entry.type === "message" && entry.message.role === "assistant") model = { provider: entry.message.provider, modelId: entry.message.model };
	}
	return { thinkingLevel, model };
}

function projectEntry(entry: Entry, edit: Entry | undefined): Message[] {
	const messages = Pi.sessionEntryToContextMessages(entry as never) as unknown as Message[];
	if (!edit) return messages;
	const replacement = edit.replacement;
	if (replacement === null) return [];
	return messages.map((message) => {
		if (message.role !== "user" && message.role !== "assistant" && message.role !== "toolResult" && message.role !== "custom") return message;
		const content = (message.role === "assistant" || message.role === "toolResult") && typeof replacement.content === "string"
			? [{ type: "text", text: replacement.content }]
			: replacement.content;
		return { ...message, content };
	});
}

export function safeSessionProjection(entries: Entry[], leafId?: string | null, byId?: Index): Projection {
	const { thinkingLevel, model } = settingsOf(sessionPath(entries, leafId, byId));
	const context = safeContextEntries(entries, leafId, byId);
	const edits = new Map<string, Entry>();
	for (const entry of context) if (entry.type === "context_edit") edits.set(entry.targetId, entry);
	const projected = context.map((sourceEntry, index) => ({
		sourceEntry,
		// Only the newest compaction, at index zero, contributes a summary, as in Pi.
		messages: sourceEntry.type === "compaction" && index > 0 ? [] : projectEntry(sourceEntry, edits.get(sourceEntry.id)),
	}));
	const messages: Message[] = [];
	for (const item of projected) for (const message of item.messages) messages.push(message);
	return { entries: projected, messages, thinkingLevel, model };
}

/** For tests only: puts Pi's own methods back and removes the offer. Production keeps the patch for the process. */
export function uninstallSafeProjection(proto: Record<string | symbol, any>): void {
	const stock = proto[INSTALLED] as Record<string, Method> | undefined;
	if (!stock) return;
	proto.buildContextEntries = stock.buildContextEntries;
	proto.buildSessionProjection = stock.buildSessionProjection;
	delete proto[INSTALLED];
	delete (globalThis as Record<symbol, unknown>)[SAFE_PROJECTION];
}

const isOverflow = (error: unknown) => error instanceof RangeError;

/** Pi's `buildSessionProjection(entries, leafId)` with the safe copy as the answer to a stack overflow. */
function guardedProjection(entries: Entry[], leafId?: string | null, byId?: Index): Projection {
	try {
		return Pi.buildSessionProjection(entries as never, leafId, byId as never) as unknown as Projection;
	} catch (error) {
		if (!isOverflow(error)) throw error;
		return safeSessionProjection(entries, leafId, byId);
	}
}

/** A tiny branch that exercises a compaction, a dropped system message, an edit and the settings entries. */
function probeManager(): Manager {
	const stamp = "2026-01-01T00:00:00.000Z";
	const user = (id: string, parentId: string | null, text: string): Entry =>
		({ type: "message", id, parentId, timestamp: stamp, message: { role: "user", content: text, timestamp: 1 } });
	const entries: Entry[] = [
		user("a", null, "one"),
		{ type: "message", id: "s", parentId: "a", timestamp: stamp, message: { role: "system", content: "rules", timestamp: 1 } },
		user("b", "s", "two"),
		{ type: "model_change", id: "m", parentId: "b", timestamp: stamp, provider: "p", modelId: "x" },
		{ type: "compaction", id: "c", parentId: "m", timestamp: stamp, summary: "sum", firstKeptEntryId: "b", tokensBefore: 1 },
		user("d", "c", "three"),
		{ type: "thinking_level_change", id: "t", parentId: "d", timestamp: stamp, thinkingLevel: "low" },
		{ type: "context_edit", id: "e", parentId: "t", timestamp: stamp, targetId: "d", replacement: { content: "edited" } },
	];
	return { getEntries: () => entries.slice(), leafId: "e", byId: new Map(entries.map((entry) => [entry.id, entry])) };
}

const sameResult = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

type Cached = { file: Entry[]; index: Index; size: number; leaf: Entry | undefined; result: Entry[] | Projection };

// Pi gives messages to its mutable agent state. Never expose the cache's arrays to that state.
function copyResult(result: Entry[] | Projection): Entry[] | Projection {
	return Array.isArray(result) ? result.slice() : { ...result, entries: result.entries.slice(), messages: result.messages.slice() };
}

/** Pi's entries are append-only. A new file, index, branch, edit or compaction rebuilds through the guarded path. */
function incremental(original: Method, safe: (manager: Manager) => Entry[] | Projection, projection: boolean, overflowed: WeakSet<object>): Method {
	const cache = new WeakMap<Manager, Cached>();
	return function (this: Manager) {
		const file = Array.isArray(this.fileEntries) ? this.fileEntries : undefined;
		const leaf = this.leafId ? this.byId.get(this.leafId) : undefined;
		const old = cache.get(this);
		if (file && old && old.file === file && old.index === this.byId && this.byId.size >= old.size &&
			(!old.leaf || this.byId.get(old.leaf.id) === old.leaf)) {
			const added: Entry[] = [];
			let at = leaf;
			while (at && at !== old.leaf && added.length <= this.byId.size - old.size) {
				added.push(at);
				at = at.parentId ? this.byId.get(at.parentId) : undefined;
			}
			if (at === old.leaf && !added.some((entry) => entry.type === "context_edit" || entry.type === "compaction")) {
				added.reverse();
				let result = old.result;
				if (added.length) {
					if (projection) {
						const previous = result as Projection;
						const projected = added.map((sourceEntry) => ({ sourceEntry, messages: projectEntry(sourceEntry, undefined) }));
						const messages = projected.flatMap((entry) => entry.messages);
						let { thinkingLevel, model } = previous;
						for (const entry of added) {
							if (entry.type === "thinking_level_change") thinkingLevel = entry.thinkingLevel;
							else if (entry.type === "model_change") model = { provider: entry.provider, modelId: entry.modelId };
							else if (entry.type === "message" && entry.message.role === "assistant") model = { provider: entry.message.provider, modelId: entry.message.model };
						}
						result = { entries: previous.entries.concat(projected), messages: messages.length ? previous.messages.concat(messages) : previous.messages, thinkingLevel, model };
					} else result = (result as Entry[]).concat(added);
				}
				cache.set(this, { file, index: this.byId, size: this.byId.size, leaf, result });
				return copyResult(result);
			}
		}
		let result: Entry[] | Projection;
		if (overflowed.has(this)) result = safe(this);
		else {
			try { result = original.call(this) as Entry[] | Projection; }
			catch (error) {
				if (!isOverflow(error)) throw error;
				overflowed.add(this);
				result = safe(this);
			}
		}
		if (file && (this.leafId === null || leaf)) {
			cache.set(this, { file, index: this.byId, size: this.byId.size, leaf, result });
			return copyResult(result);
		}
		return result;
	};
}

/**
 * Wraps `buildContextEntries` and `buildSessionProjection` of the SessionManager prototype. The probe compares Pi's two
 * methods with the safe copy on a tiny branch; any other shape leaves the stock methods. A manager that overflowed once
 * skips the stock call afterwards. The wrappers stay for the process (they are transparent) and a reload keeps them.
 * Returns whether the patch is installed.
 */
export function installSafeProjection(proto: Record<string | symbol, any>): boolean {
	if (proto[INSTALLED]) return true;
	const stock: Record<string, Method> = {};
	for (const name of ["buildContextEntries", "buildSessionProjection"]) {
		const descriptor = Object.getOwnPropertyDescriptor(proto, name);
		if (typeof descriptor?.value !== "function" || !descriptor.configurable || !descriptor.writable) return false;
		stock[name] = descriptor.value as Method;
	}
	if (typeof Pi.buildSessionProjection !== "function" || typeof Pi.sessionEntryToContextMessages !== "function") return false;
	try {
		const probe = probeManager();
		if (!sameResult(stock.buildContextEntries!.call(probe), safeContextEntries(probe.getEntries(), probe.leafId, probe.byId))) return false;
		if (!sameResult(stock.buildSessionProjection!.call(probe), safeSessionProjection(probe.getEntries(), probe.leafId, probe.byId))) return false;
	} catch {
		return false;
	}
	const overflowed = new WeakSet<object>();
	proto.buildContextEntries = incremental(stock.buildContextEntries!, (manager) => safeContextEntries(manager.getEntries(), manager.leafId, manager.byId), false, overflowed);
	proto.buildSessionProjection = incremental(stock.buildSessionProjection!, (manager) => safeSessionProjection(manager.getEntries(), manager.leafId, manager.byId), true, overflowed);
	proto[INSTALLED] = stock;
	(globalThis as Record<symbol, unknown>)[SAFE_PROJECTION] = guardedProjection;
	return true;
}
