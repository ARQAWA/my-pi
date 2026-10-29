import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import { buildSessionProjection, type AgentSession, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import { SessionWireState } from "../../../extensions/RQW-codex/session-history.ts";
import { buildRequest, type WireItem, type WireModelInfo } from "../../../extensions/RQW-codex/wire.ts";

const root = mkdtempSync(join(tmpdir(), "rqw-session-forks-"));
after(() => rmSync(root, { recursive: true, force: true }));

const MODEL = { id: "gpt-test", provider: "openai-codex", api: "openai-codex-responses", input: ["text"], contextWindow: 100_000 } as unknown as Model<Api>;
const CAPS = { slug: "gpt-test", supports_reasoning_effort_updates: true, default_reasoning_summary: "auto", supports_reasoning_summary_parameter: true } as WireModelInfo;
const USER = { role: "user", content: [{ type: "text", text: "turn A" }], timestamp: 1700000000000 };
const CONTEXT = { systemPrompt: "SYSTEM", messages: [USER], tools: [] } as unknown as Context;
const RAW = [
	{ type: "reasoning", id: "rs_raw_a", summary: [], encrypted_content: "EXACT-RAW-A" },
	{ type: "function_call", id: "fc_raw_a", call_id: "call_raw_a", name: "bash", arguments: '{"command": "printf EXACT-RAW-A"}' },
] as WireItem[];

/** Minimal file-backed session: a JSONL file with a header, and just the manager surface our state reads. */
class FileSession {
	readonly entries: SessionEntry[];
	readonly sessionId: string;
	readonly path: string;
	readonly header: Record<string, unknown>;
	constructor(path: string, header: Record<string, unknown>, entries: SessionEntry[] = []) {
		this.path = path;
		this.header = header;
		this.sessionId = header.id as string;
		this.entries = entries;
		writeFileSync(path, [header, ...entries].map((line) => JSON.stringify(line)).join("\n") + "\n");
	}
	get sessionManager() {
		return this;
	}
	private append(entry: Record<string, unknown>) {
		const full = { ...entry, id: `${this.sessionId}-${this.entries.length + 1}`, parentId: this.entries.at(-1)?.id ?? null, timestamp: "2026-01-01T00:00:00.000Z" } as unknown as SessionEntry;
		this.entries.push(full);
		appendFileSync(this.path, JSON.stringify(full) + "\n");
		return full;
	}
	appendMessage(message: unknown) {
		return this.append({ type: "message", message });
	}
	appendCustomEntry(customType: string, data: unknown) {
		return this.append({ type: "custom", customType, data });
	}
	getHeader() {
		return this.header;
	}
	getEntries() {
		return [...this.entries];
	}
	getLeafId() {
		return this.entries.at(-1)?.id ?? null;
	}
	getBranch(fromId?: string) {
		const byId = new Map(this.entries.map((entry) => [entry.id, entry]));
		const path: SessionEntry[] = [];
		for (let current = byId.get(fromId ?? this.getLeafId() ?? ""); current; current = current.parentId ? byId.get(current.parentId) : undefined) path.unshift(current);
		return path;
	}
	buildSessionProjection() {
		return buildSessionProjection(this.entries, this.getLeafId());
	}
	/** A fork file: new id, parent path in the header, and every parent entry copied unchanged. */
	fork(id: string) {
		return new FileSession(join(root, `${id}.jsonl`), { type: "session", version: 3, id, parentSession: this.path }, structuredClone(this.entries));
	}
}

const stateOf = (session: FileSession) => new SessionWireState({ session: session as unknown as AgentSession, ownerId: "acct", modelHash: "caps-1" });
const nativeInput = (state: SessionWireState) => state.nativeInput({ context: CONTEXT, model: MODEL, capabilities: CAPS });
const prefixLength = (threadId: string) => buildRequest({ model: MODEL, context: { ...CONTEXT, messages: [] }, options: {}, capabilities: CAPS, identity: { installationId: "inst", windowId: "win", rootSessionId: threadId, threadId } as never }).input.length;

it("regression: a fork of a fork replays the first session's raw history exactly once", () => {
	const a = new FileSession(join(root, "a.jsonl"), { type: "session", version: 3, id: "thread-a" });
	a.appendMessage(USER);
	const stateA = stateOf(a);
	assert.equal(nativeInput(stateA), undefined);
	const built = buildRequest({ model: MODEL, context: CONTEXT, options: {}, capabilities: CAPS, identity: { installationId: "inst", windowId: "win", rootSessionId: "thread-a", threadId: "thread-a" } as never }).input;
	stateA.rawHistory.preparedRequest?.({ model: CAPS.slug, input: built });
	for (const item of RAW) stateA.rawHistory.recordItem?.("resp-a", item);
	const historyOfA = nativeInput(stateA)!.slice(prefixLength("thread-a"));
	assert.deepEqual(historyOfA.filter((item) => item.id === "rs_raw_a" || item.id === "fc_raw_a"), RAW);

	const b = a.fork("thread-b");
	stateOf(b);
	const c = b.fork("thread-c");
	const inputC = nativeInput(stateOf(c))!;
	assert.deepEqual(inputC.slice(prefixLength("thread-c")), historyOfA);
	assert.deepEqual(inputC.filter((item) => item.id === "rs_raw_a" || item.id === "fc_raw_a"), RAW);
});
