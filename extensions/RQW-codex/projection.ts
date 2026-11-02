// Local Pi 1.4.0 projection fallback for a stack overflow on a long post-compaction tail.
import { buildSessionProjection, sessionEntryToContextMessages, type SessionEntry } from "@earendil-works/pi-coding-agent";

type Entry = { id: string; parentId?: string | null; type: string; [key: string]: any };
type Projection = ReturnType<typeof buildSessionProjection>;
type Manager = { getEntries(): SessionEntry[]; getLeafId(): string | null; buildSessionProjection(): Projection };

function safeProjection(entries: Entry[], leafId: string | null): Projection {
	const index = new Map(entries.map((entry) => [entry.id, entry]));
	const path: Entry[] = [];
	for (let entry = leafId === null ? undefined : index.get(leafId) ?? entries.at(-1); entry; entry = entry.parentId ? index.get(entry.parentId) : undefined) path.push(entry);
	path.reverse();
	let thinkingLevel = "off";
	let model: { provider: string; modelId: string } | null = null;
	for (const entry of path) {
		if (entry.type === "thinking_level_change") thinkingLevel = entry.thinkingLevel;
		else if (entry.type === "model_change") model = { provider: entry.provider, modelId: entry.modelId };
		else if (entry.type === "message" && entry.message.role === "assistant") model = { provider: entry.message.provider, modelId: entry.message.model };
	}
	const at = path.findLastIndex((entry) => entry.type === "compaction");
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
	const projected = context.map((sourceEntry, i) => {
		let messages = sourceEntry.type === "compaction" && i > 0 ? [] : sessionEntryToContextMessages(sourceEntry as never);
		const edit = edits.get(sourceEntry.id);
		if (edit) {
			if (edit.replacement === null) messages = [];
			else messages = messages.map((message: any) => {
				if (!["user", "assistant", "toolResult", "custom"].includes(message.role)) return message;
				const replacement = edit.replacement.content;
				const content = (message.role === "assistant" || message.role === "toolResult") && typeof replacement === "string" ? [{ type: "text", text: replacement }] : replacement;
				return { ...message, content };
			});
		}
		return { sourceEntry, messages };
	});
	const messages = projected.flatMap((entry) => entry.messages);
	return { entries: projected, messages, thinkingLevel, model } as unknown as Projection;
}

const stamp = "2026-01-01T00:00:00.000Z";
const probe: Entry[] = [
	{ type: "message", id: "a", parentId: null, timestamp: stamp, message: { role: "user", content: "one", timestamp: 1 } },
	{ type: "message", id: "s", parentId: "a", timestamp: stamp, message: { role: "system", content: "rules", timestamp: 1 } },
	{ type: "model_change", id: "m", parentId: "s", timestamp: stamp, provider: "p", modelId: "x" },
	{ type: "compaction", id: "c", parentId: "m", timestamp: stamp, summary: "sum", firstKeptEntryId: "a", tokensBefore: 1 },
	{ type: "message", id: "b", parentId: "c", timestamp: stamp, message: { role: "user", content: "two", timestamp: 1 } },
	{ type: "thinking_level_change", id: "t", parentId: "b", timestamp: stamp, thinkingLevel: "low" },
	{ type: "context_edit", id: "e", parentId: "t", timestamp: stamp, targetId: "b", replacement: { content: "edited" } },
];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function compatible(manager?: Manager): boolean {
	try {
		const expected = safeProjection(probe, "e");
		if (!same(buildSessionProjection(probe as never, "e"), expected)) return false;
		if (!manager) return true;
		const sample = { entries: probe, fileEntries: probe, leafId: "e", byId: new Map(probe.map((entry) => [entry.id, entry])), getEntries: () => probe, getLeafId: () => "e" };
		return same(manager.buildSessionProjection.call(sample), expected);
	} catch { return false; }
}

export function project(entries: SessionEntry[], leafId: string | null): Projection {
	try { return buildSessionProjection(entries, leafId); }
	catch (error) {
		if (!(error instanceof RangeError) || !compatible()) throw error;
		return safeProjection(entries as unknown as Entry[], leafId);
	}
}

export function projectManager(manager: Manager): Projection {
	try { return manager.buildSessionProjection(); }
	catch (error) {
		if (!(error instanceof RangeError) || !compatible(manager)) throw error;
		return safeProjection(manager.getEntries() as unknown as Entry[], manager.getLeafId());
	}
}
