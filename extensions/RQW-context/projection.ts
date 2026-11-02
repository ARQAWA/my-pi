// Local equivalent of Pi's projection, used only after a stack overflow and a successful shape probe.
import * as Pi from "@earendil-works/pi-coding-agent";

type Entry = { id: string; parentId?: string | null; type: string; [key: string]: any };
type Message = { role: string; [key: string]: any };
type Index = Map<string, Entry>;
type Projection = { entries: Array<{ sourceEntry: Entry; messages: Message[] }>; messages: Message[]; thinkingLevel: string; model: { provider: string; modelId: string } | null };
type Project = (entries: Entry[], leafId?: string | null, byId?: Index) => Projection;

function pathOf(entries: Entry[], leafId?: string | null, byId?: Index): Entry[] {
	if (leafId === null) return [];
	const index = byId ?? new Map(entries.map(entry => [entry.id, entry]));
	let entry = (leafId ? index.get(leafId) : undefined) ?? entries.at(-1);
	const path: Entry[] = [];
	while (entry) {
		path.push(entry);
		entry = entry.parentId ? index.get(entry.parentId) : undefined;
	}
	return path.reverse();
}

function safeProjection(entries: Entry[], leafId?: string | null, byId?: Index): Projection {
	const path = pathOf(entries, leafId, byId);
	let thinkingLevel = "off";
	let model: Projection["model"] = null;
	for (const entry of path) {
		if (entry.type === "thinking_level_change") thinkingLevel = entry.thinkingLevel;
		else if (entry.type === "model_change") model = { provider: entry.provider, modelId: entry.modelId };
		else if (entry.type === "message" && entry.message.role === "assistant") model = { provider: entry.message.provider, modelId: entry.message.model };
	}
	const at = path.findLastIndex(entry => entry.type === "compaction");
	let context = path;
	if (at >= 0) {
		const compaction = path[at]!;
		context = [compaction];
		let kept = false;
		for (let i = 0; i < at; i++) {
			const entry = path[i]!;
			if (entry.id === compaction.firstKeptEntryId) kept = true;
			if (kept && !(entry.type === "message" && entry.message.role === "system")) context.push(entry);
		}
		for (let i = at + 1; i < path.length; i++) context.push(path[i]!);
	}
	const edits = new Map<string, Entry>();
	for (const entry of context) if (entry.type === "context_edit") edits.set(entry.targetId, entry);
	const projected = context.map((sourceEntry, index) => {
		let messages = sourceEntry.type === "compaction" && index > 0 ? [] : Pi.sessionEntryToContextMessages(sourceEntry as never) as unknown as Message[];
		const edit = edits.get(sourceEntry.id);
		if (edit) {
			const replacement = edit.replacement;
			messages = replacement === null ? [] : messages.map(message => {
				if (!["user", "assistant", "toolResult", "custom"].includes(message.role)) return message;
				const content = (message.role === "assistant" || message.role === "toolResult") && typeof replacement.content === "string"
					? [{ type: "text", text: replacement.content }] : replacement.content;
				return { ...message, content };
			});
		}
		return { sourceEntry, messages };
	});
	const messages: Message[] = [];
	for (const entry of projected) for (const message of entry.messages) messages.push(message);
	return { entries: projected, messages, thinkingLevel, model };
}

function compatible(stock: Project): boolean {
	const timestamp = "2026-01-01T00:00:00.000Z";
	const user = (id: string, parentId: string | null): Entry => ({ type: "message", id, parentId, timestamp, message: { role: "user", content: id, timestamp: 1 } });
	const entries: Entry[] = [
		user("a", null),
		{ type: "message", id: "s", parentId: "a", timestamp, message: { role: "system", content: "rules", timestamp: 1 } },
		user("b", "s"),
		{ type: "model_change", id: "m", parentId: "b", timestamp, provider: "p", modelId: "x" },
		{ type: "compaction", id: "c", parentId: "m", timestamp, summary: "sum", firstKeptEntryId: "b", tokensBefore: 1 },
		user("d", "c"),
		{ type: "thinking_level_change", id: "t", parentId: "d", timestamp, thinkingLevel: "low" },
		{ type: "context_edit", id: "e", parentId: "t", timestamp, targetId: "d", replacement: { content: "edited" } },
	];
	try { return JSON.stringify(stock(entries)) === JSON.stringify(safeProjection(entries)); }
	catch { return false; }
}

/** Keep stock behavior unless it overflows and the local projection matches its shape. */
export function guardedProjection(stock: Project): Project {
	let supported: boolean | undefined;
	return (entries, leafId, byId) => {
		try { return stock(entries, leafId, byId); }
		catch (error) {
			if (!(error instanceof RangeError)) throw error;
			supported ??= compatible(stock);
			if (!supported) throw error;
			return safeProjection(entries, leafId, byId);
		}
	};
}

export const projectSession = guardedProjection(Pi.buildSessionProjection as unknown as Project);
