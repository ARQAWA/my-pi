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

function recorded(name: string, responses: number) {
	const session = new FileSession(join(root, `${name}.jsonl`), { type: "session", version: 3, id: `thread-${name}` });
	session.appendMessage(USER);
	const state = stateOf(session);
	assert.equal(nativeInput(state), undefined);
	const built = buildRequest({ model: MODEL, context: CONTEXT, options: {}, capabilities: CAPS, identity: { installationId: "inst", windowId: "win", rootSessionId: `thread-${name}`, threadId: `thread-${name}` } as never }).input;
	state.rawHistory.preparedRequest?.({ model: CAPS.slug, input: built });
	for (let i = 0; i < responses; i++) {
		state.rawHistory.recordItem?.(`resp-${i}`, { type: "reasoning", id: `rs_${i}`, summary: [], encrypted_content: `E${i}` } as WireItem);
		state.rawHistory.recordItem?.(`resp-${i}`, { type: "function_call", id: `fc_${i}`, call_id: `call_${i}`, name: "bash", arguments: "{}" } as WireItem);
	}
	return { session, state };
}

function drain<T>(steps: Generator<void, T>): { value: T; yields: number } {
	let yields = 0;
	let step = steps.next();
	for (; !step.done; step = steps.next()) yields++;
	return { value: step.value, yields };
}

const answered = (id: string, text: string) => ({ role: "assistant", responseId: id, content: [{ type: "text", text }], stopReason: "stop", timestamp: 2 });

it("the sliced raw-output read returns the same items as the whole read for the wanted responses, in many small steps", () => {
	const { state } = recorded("slices", 40);
	state.settleTurn();
	const wanted = new Set(["resp-3", "resp-39"]);
	const whole = state.rawHistory.rawOutputs();
	const { value, yields } = drain(state.rawHistory.bindRawOutputs!(CONTEXT)(wanted));
	assert.ok(yields >= 5, `the walk over ${whole.size * 3} entries must pause often (paused ${yields} times)`);
	assert.deepEqual([...value.keys()].sort(), ["resp-3", "resp-39"]);
	for (const id of wanted) assert.deepEqual(value.get(id), whole.get(id));
	assert.deepEqual(value.get("resp-3")!.map((item) => item.id), ["rs_3"], "a retired unpaired call stays out, as in the whole read");
});

it("a retired call comes back when the request carries its result, and the read never builds Pi's projection", () => {
	const { session, state } = recorded("paired", 6);
	const call = { role: "assistant", responseId: "resp-3", content: [{ type: "toolCall", id: "call_3", name: "bash", arguments: {} }], stopReason: "toolUse", timestamp: 2 };
	session.appendMessage(call);
	state.settleTurn();
	let projections = 0;
	const entries = session.getEntries.bind(session);
	session.getEntries = () => { projections++; return entries(); };
	const withResult = { messages: [USER, call,
		{ role: "toolResult", toolCallId: "call_3", toolName: "bash", content: [], isError: false, timestamp: 3 }] } as unknown as Context;
	const read = drain(state.rawHistory.bindRawOutputs!(withResult)(new Set(["resp-3"])));
	assert.deepEqual(read.value.get("resp-3")!.map((item) => item.id), ["rs_3", "fc_3"]);
	assert.equal(projections, 0, "no step walks the whole projected session");
});

it("a request that carries an edited answer gets no raw replay of it", () => {
	const { session, state } = recorded("edited", 2);
	session.appendMessage(answered("resp-1", "original"));
	const read = (text: string) => drain(state.rawHistory.bindRawOutputs!({ messages: [USER, answered("resp-1", text)] } as unknown as Context)(new Set(["resp-1"]))).value;
	assert.equal(read("original").has("resp-1"), true);
	assert.equal(read("edited by the user").has("resp-1"), false);
});

it("a bound read keeps the branch of the moment it was bound, whatever the session does later", () => {
	const { session, state } = recorded("bound", 4);
	const read = state.rawHistory.bindRawOutputs!(CONTEXT);
	const before = drain(read(new Set(["resp-2"]))).value;
	session.entries.splice(0);
	const after = drain(read(new Set(["resp-2"]))).value;
	assert.deepEqual(after, before);
	assert.equal(before.get("resp-2")!.length, 2);
});
