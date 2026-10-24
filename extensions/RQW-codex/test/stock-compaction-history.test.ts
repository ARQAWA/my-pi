// Stock Pi compaction is a persisted wire boundary, including restart before session_compact is delivered.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import { convertToLlm, SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { Context, Model, Api } from "@earendil-works/pi-ai";
import { WireHistory } from "../history.ts";
import { SessionWireState, type NativeInputArgs } from "../session-history.ts";
import { installPortableHistory } from "../portable-history.ts";
import { buildRequest, type WireModelInfo } from "../wire.ts";

const root = mkdtempSync(join(tmpdir(), "rqw-stock-compaction-history-"));
after(() => rmSync(root, { recursive: true, force: true }));
let counter = 0;
const MODEL = { id: "gpt-test", provider: "openai-codex", api: "openai-codex-responses", input: ["text"], contextWindow: 100_000 } as unknown as Model<Api>;
const CAPS = { slug: "gpt-test", supports_reasoning_effort_updates: true } as WireModelInfo;
const usage = { input: 100, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 101, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const user = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1700000000000 });
const reply = (text: string) => ({ role: "assistant", content: [{ type: "text", text }], api: MODEL.api, provider: MODEL.provider, model: MODEL.id, responseId: "old-response", usage, stopReason: "stop", timestamp: 1700000000000 });
const agent = (manager: SessionManager) => ({ sessionId: manager.getSessionId(), sessionManager: manager, subscribe: () => () => {} }) as unknown as AgentSession;
const context = (manager: SessionManager): Context => ({ systemPrompt: "SYSTEM", messages: convertToLlm(manager.buildSessionProjection().messages), tools: [] });
const args = (manager: SessionManager): NativeInputArgs => ({ model: MODEL, capabilities: CAPS, context: context(manager), options: { reasoningEffortOverride: true, reasoningEffort: "high" } });
const openState = (manager: SessionManager) => new SessionWireState({ session: agent(manager), ownerId: "owner", modelHash: "hash" });

function seed(state: SessionWireState, manager: SessionManager): void {
	const request = args(manager);
	assert.equal(state.nativeInput(request), undefined);
	const input = buildRequest({ model: MODEL, capabilities: CAPS, context: request.context, options: request.options, identity: { installationId: "test", windowId: "test", rootSessionId: manager.getSessionId(), threadId: manager.getSessionId() } }).input;
	state.rawHistory.preparedRequest?.({ input });
}

function fixture() {
	const dir = join(root, `session-${++counter}`);
	const manager = SessionManager.create(root, dir);
	manager.appendMessage(user("ORIGINAL LARGE HISTORY") as never);
	const state = openState(manager);
	seed(state, manager);
	state.rawHistory.recordItem?.("old-response", { type: "reasoning", id: "old-reasoning", encrypted_content: "OLD_ENCRYPTED_REASONING", summary: [] });
	manager.appendMessage(reply("old reply") as never);
	state.nativeInput(args(manager));
	state.history.installCompaction({ responseId: "old-native-compaction", compaction: { type: "compaction", encrypted_content: "OLD_NATIVE_CHECKPOINT" }, retained: [], window: { number: 3, id: "old-window" }, sourceEntryIds: state.sourceEntryIds, sourceDigest: "test" });
	state.history.appendEntry({ kind: "pin", effort: "low" });
	state.history.recordEffort("medium");
	const tailId = manager.appendMessage(user("KEPT TAIL") as never);
	const oldLeaf = manager.getLeafId()!;
	assert.equal(state.history.load().mode, "native");
	assert.ok(state.history.load().checkpointEntryId);
	return { manager, state, dir, tailId, oldLeaf };
}

it("stock compaction immediately supersedes native history, raw encrypted items, coverage and effort", () => {
	const { manager, state, tailId } = fixture();
	const original = readFileSync(manager.getSessionFile()!, "utf8");
	const stockId = manager.appendCompaction("PORTABLE SUMMARY", tailId, 1000);
	const loaded = state.history.load();
	assert.equal(loaded.checkpointEntryId, null, "persisted stock compaction invalidates the older native checkpoint");
	assert.equal(loaded.mode, "native");
	assert.deepEqual(loaded.items, []);
	assert.equal(loaded.effort, null);
	assert.equal(state.rawHistory.rawOutputs().size, 0);
	assert.deepEqual(state.sourceEntryIds, []);
	assert.equal(state.projectTokens(), undefined);
	assert.equal(state.previewNativeInput(args(manager), []), undefined, "prewarm cannot replay the superseded base");
	assert.equal(state.projectionBoundaryId, stockId);
	assert.ok(readFileSync(manager.getSessionFile()!, "utf8").startsWith(original), "physical history is append-only");
});

it("summary and kept tail become the trusted seed without old checkpoint or effort after a stock boundary", () => {
	const { manager, state, tailId } = fixture();
	manager.appendCompaction("PORTABLE SUMMARY", tailId, 1000);
	seed(state, manager);
	const native = state.nativeInput(args(manager));
	assert.ok(native);
	const encoded = JSON.stringify(native);
	assert.ok(encoded.includes("PORTABLE SUMMARY"));
	assert.ok(encoded.includes("KEPT TAIL"));
	assert.equal(encoded.includes("ORIGINAL LARGE HISTORY"), false);
	assert.equal(encoded.includes("OLD_NATIVE_CHECKPOINT"), false);
	assert.equal(encoded.includes("OLD_ENCRYPTED_REASONING"), false);
	assert.equal(state.history.load().effort, null, "old medium pin is not inherited");
	assert.deepEqual(state.nativeInput(args(manager)), native, "seed and source coverage are idempotent");
});

it("cold restart after Pi append needs no compaction event and rollback restores the old native branch", () => {
	const { manager, state, tailId, oldLeaf, dir } = fixture();
	const oldCheckpoint = state.history.load().checkpointEntryId;
	const stockId = manager.appendCompaction("PORTABLE SUMMARY", tailId, 1000);
	const reopened = SessionManager.open(manager.getSessionFile()!, dir);
	const cold = openState(reopened);
	assert.equal(cold.history.load().checkpointEntryId, null);
	assert.equal(cold.projectionBoundaryId, stockId);
	assert.equal(cold.previewNativeInput(args(reopened), []), undefined);
	seed(cold, reopened);
	const compactedLeaf = reopened.getLeafId()!;
	reopened.branch(oldLeaf);
	assert.equal(cold.history.load().checkpointEntryId, oldCheckpoint);
	assert.equal(cold.projectionBoundaryId, null);
	assert.ok(JSON.stringify(cold.nativeInput(args(reopened))).includes("OLD_NATIVE_CHECKPOINT"));
	reopened.branch(compactedLeaf);
	assert.equal(cold.projectionBoundaryId, stockId);
	assert.equal(JSON.stringify(cold.nativeInput(args(reopened))).includes("OLD_NATIVE_CHECKPOINT"), false);
});

it("WireHistory ignores pre-boundary malformed records, retired calls and old seeds without altering them", () => {
	const manager = SessionManager.inMemory(root);
	const sourceId = manager.appendMessage(user("before") as never);
	const history = new WireHistory({ session: manager as never, scope: { runtimeId: "test", threadId: "thread", ownerId: "owner" }, modelHash: "hash" });
	history.seedBuiltRequest([{ type: "message", role: "user", content: [{ type: "input_text", text: "before" }] }]);
	history.appendEntry({ kind: "item", responseId: "old", item: { type: "function_call", call_id: "old-call", name: "bash", arguments: "{}" } });
	history.appendEntry({ kind: "unpaired_call_retired", responseId: "old", callId: "old-call" });
	manager.appendCustomEntry("rqw-codex/wire-history", { v: 1, digest: "bad-old-digest" });
	const originals = JSON.stringify(manager.getEntries());
	manager.appendCompaction("summary", sourceId, 100);
	assert.equal(history.load().mode, "native", "corrupt superseded wire records cannot poison the new projection");
	assert.deepEqual(history.load().items, []);
	assert.equal(history.retiredCalls().size, 0);
	history.seedBuiltRequest([{ type: "message", role: "user", content: [{ type: "input_text", text: "summary" }] }]);
	assert.equal(history.load().mode, "native");
	assert.equal(history.load().items.length, 1);
	assert.equal(JSON.stringify(manager.getEntries().slice(0, JSON.parse(originals).length)), originals);
});

it("portable usage invalidation stops after stock compaction even when a cached native-checkpoint predicate is stale", () => {
	const { manager, tailId } = fixture();
	manager.appendCompaction("PORTABLE SUMMARY", tailId, 1000);
	manager.appendMessage(reply("fresh stock-context response") as never);
	const guard = installPortableHistory(agent(manager), { hasNativeCheckpoint: () => true });
	const before = JSON.stringify(manager.getEntries());
	assert.equal(guard.invalidate(), false, "usage now describes the stock summary, not the retired native context");
	guard.release();
	assert.equal(JSON.stringify(manager.getEntries()), before, "no repeated no-op context edits");
});
