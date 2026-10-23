// Safety proof of the read-only idle-warm preview (SessionWireState.previewNativeInput) over real Pi SessionManagers with a
// verified own accepted checkpoint. The preview must accept only Pi's effective projection followed by exactly the known
// request-time messages; any rewrite, edited or deleted physical source, foreign owner or wrong known suffix gets undefined.
// No network, no credentials: request bodies are built by the native codec with a fake model record.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { convertToLlm, SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { Api, Context, Model } from "@earendil-works/pi-ai";

import { canonicalJson } from "../history.ts";
import { SessionWireState, type NativeInputArgs } from "../session-history.ts";
import { buildRequest, type WireItem, type WireModelInfo } from "../wire.ts";

const root = mkdtempSync(join(tmpdir(), "rqw-preview-native-input-"));
after(() => rmSync(root, { recursive: true, force: true }));

const MODEL = { id: "gpt-test", provider: "openai-codex", api: "openai-codex-responses", input: ["text"], contextWindow: 100_000 } as unknown as Model<Api>;
const CAPS = { slug: "gpt-test", supports_reasoning_effort_updates: true, default_reasoning_summary: "auto", supports_reasoning_summary_parameter: true } as WireModelInfo;
const MODEL_HASH = "caps-hash-preview";
const STAMP = 1700000000000;
const OPTIONS = { reasoningEffortOverride: true, reasoningEffort: "high" } as NativeInputArgs["options"];

let dirCounter = 0;
function newManager(): SessionManager {
	return SessionManager.create(root, join(root, `pv${++dirCounter}`));
}

function agent(manager: SessionManager): AgentSession {
	return { sessionId: manager.getSessionId(), sessionManager: manager } as unknown as AgentSession;
}

const userMsg = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: STAMP });
const assistantMsg = (text: string, responseId: string) => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "openai-codex-responses",
	provider: "openai-codex",
	model: "gpt-test",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "stop",
	timestamp: STAMP,
	responseId,
});
/** Known request-time system messages (the pending SDK section and tool patch shape, never persisted). */
const sysMsg = (text: string) => ({ role: "system", content: text, timestamp: STAMP });

function ctx(messages: unknown[]): Context {
	return { systemPrompt: "SYSTEM A", messages, tools: [] } as unknown as Context;
}

/** Pi's effective transcript: its projection converted to LLM messages. */
function effective(manager: SessionManager): unknown[] {
	return convertToLlm(manager.buildSessionProjection().messages as never) as unknown as unknown[];
}

function args(context: Context, options?: NativeInputArgs["options"]): NativeInputArgs {
	return { context, model: MODEL, capabilities: CAPS, options };
}

function builtInput(context: Context, threadId: string): WireItem[] {
	return buildRequest({ model: MODEL, context, options: {}, capabilities: CAPS, identity: { installationId: "", windowId: "", rootSessionId: threadId, threadId } as never }).input;
}

/** Transport stand-in for the first request: nativeInput (undefined without a base), then preparedRequest with the body. */
function send(state: SessionWireState, context: Context): void {
	const native = state.nativeInput(args(context));
	state.rawHistory.preparedRequest?.({ model: CAPS.slug, input: native ?? builtInput(context, state.history.scope.threadId) });
}

const texts = (items: readonly WireItem[] | undefined): string[] =>
	(items ?? []).flatMap((item) => (Array.isArray(item.content) ? (item.content as { text?: string }[]).map((c) => c.text ?? "") : []));
const typesOf = (items: readonly WireItem[] | undefined) => (items ?? []).map((item) => item.type);
const customEntries = (manager: SessionManager) => manager.getEntries().filter((e) => e.type === "custom").length;

/**
 * A verified own accepted checkpoint: user "a" is seeded by a real first request, then installCompaction covers it. Returns the
 * manager (with user "b" appended after the checkpoint), the state and the session file path.
 */
function accepted(owner = "acct-A"): { manager: SessionManager; state: SessionWireState; file: string } {
	const manager = newManager();
	manager.appendMessage(userMsg("a") as never);
	const file = manager.getSessionFile() as string;
	const state = new SessionWireState({ session: agent(manager), ownerId: owner, modelHash: MODEL_HASH });
	send(state, ctx([userMsg("a") as never]));
	state.history.installCompaction({
		responseId: "resp-c",
		compaction: { type: "compaction", encrypted_content: "ENC-CHECKPOINT" } as WireItem,
		retained: [],
		window: { number: 2, id: "win-2" },
		sourceEntryIds: state.sourceEntryIds,
		sourceDigest: "digest",
	});
	assert.equal(state.history.load().mode, "native", "fixture: checkpoint is native");
	assert.equal(state.history.load().reason, null, "fixture: no invalidation reason");
	assert.notEqual(state.history.load().checkpointEntryId, null, "fixture: checkpoint accepted");
	manager.appendMessage(userMsg("b") as never);
	return { manager, state, file };
}

describe("previewNativeInput: exact effective base plus known messages", () => {
	it("previews the accepted checkpoint once, with no stale assistant, and changes no physical or durable state", () => {
		const { manager, state, file } = accepted();
		const known = [sysMsg("PENDING SECTIONS")];
		const context = ctx([...effective(manager), ...known]);
		const bytes = readFileSync(file, "utf8");
		const entries = manager.getEntries().length;
		const custom = customEntries(manager);
		const ledger = canonicalJson(state.history.load());
		const window = canonicalJson(state.window);

		const first = state.previewNativeInput(args(context, OPTIONS), known) as WireItem[];
		assert.ok(first, "preview accepted for the exact effective base plus known");
		const prefixLength = builtInput(ctx([]), state.history.scope.threadId).length;
		assert.deepEqual(first.slice(0, prefixLength), builtInput(ctx([]), state.history.scope.threadId), "fresh prefix first");
		assert.equal(typesOf(first).filter((t) => t === "compaction").length, 1, "the accepted checkpoint appears once");
		assert.deepEqual(typesOf(first).slice(prefixLength), ["compaction", "message", "message"], "checkpoint, pending user b, transient system message");
		assert.deepEqual(texts(first).filter((t) => t === "a" || t === "b"), ["b"], "covered user a is not replayed; pending b once");
		assert.equal(first.some((i) => i.type === "message" && (i as { role?: string }).role === "assistant"), false, "no stale ordinary assistant");
		assert.equal(texts(first).filter((t) => t === "PENDING SECTIONS").length, 1, "known message appears once, in the returned input only");

		assert.equal(readFileSync(file, "utf8"), bytes, "session file bytes unchanged");
		assert.equal(manager.getEntries().length, entries, "no Pi entry appended");
		assert.equal(customEntries(manager), custom, "no custom entry appended (no pin, no item, no settings)");
		assert.equal(canonicalJson(state.history.load()), ledger, "item ledger, effort and checkpoint unchanged");
		assert.equal(canonicalJson(state.window), window, "window unchanged");
		assert.equal(state.history.load().effort, null, "no effort pin recorded by the preview");
	});

	it("a second identical preview is identical and read-only", () => {
		const { manager, state, file } = accepted();
		const known = [sysMsg("PENDING SECTIONS")];
		const context = ctx([...effective(manager), ...known]);
		const first = state.previewNativeInput(args(context, OPTIONS), known);
		const bytes = readFileSync(file, "utf8");
		const custom = customEntries(manager);
		const second = state.previewNativeInput(args(context, OPTIONS), known);
		assert.ok(first);
		assert.deepEqual(second, first, "identical result");
		assert.equal(readFileSync(file, "utf8"), bytes, "file unchanged by the second preview");
		assert.equal(customEntries(manager), custom, "no entry appended by the second preview");
	});

	it("the normal nativeInput keeps its own path: a pending user is persisted there, never by the preview", () => {
		const { manager, state } = accepted();
		const known = [sysMsg("PENDING SECTIONS")];
		const before = customEntries(manager);
		state.previewNativeInput(args(ctx([...effective(manager), ...known]), OPTIONS), known);
		assert.equal(customEntries(manager), before, "preview persisted nothing");
		const strict = state.nativeInput(args(ctx(effective(manager)), OPTIONS)) as WireItem[];
		assert.ok(strict, "strict input still available with the checkpoint");
		assert.equal(texts(strict).includes("PENDING SECTIONS"), false, "strict input never carries the known message");
		assert.equal(typesOf(strict).filter((t) => t === "compaction").length, 1);
	});
});

describe("previewNativeInput: rewrites and edited or deleted sources are never accepted", () => {
	it("an extra unknown assistant message, an extra unknown user or a non-suffix known message gives undefined", () => {
		const { manager, state } = accepted();
		const known = [sysMsg("PENDING SECTIONS")];
		const extraAssistant = ctx([...effective(manager), assistantMsg("REWRITTEN", "resp-x"), ...known]);
		assert.equal(state.previewNativeInput(args(extraAssistant), known), undefined, "extra assistant after the base");
		const extraUser = ctx([...effective(manager), ...known, userMsg("extra") as never]);
		assert.equal(state.previewNativeInput(args(extraUser), known), undefined, "extra message after the known suffix");
		const nonSuffix = ctx([effective(manager)[0], ...known, effective(manager)[1]]);
		assert.equal(state.previewNativeInput(args(nonSuffix), known), undefined, "known message not at the end");
		const rewritten = ctx([userMsg("a rewritten") as never, ...effective(manager).slice(1), ...known]);
		assert.equal(state.previewNativeInput(args(rewritten), known), undefined, "rewritten covered user");
		assert.equal(state.nativeInput(args(extraAssistant)), undefined, "normal path keeps its protection");
	});

	it("an edited covered source (checkpoint-sources) gives undefined and no checkpoint opaque", () => {
		const { manager, state } = accepted();
		const known = [sysMsg("PENDING SECTIONS")];
		const covered = manager.getBranch().find((e) => e.type === "message" && (e.message as { role?: string }).role === "user") as { id: string };
		manager.appendContextEdit(covered.id, { content: [{ type: "text", text: "a EDITED" }] } as never);
		const context = ctx([...effective(manager), ...known]);
		assert.notEqual(state.history.load().reason, null, "checkpoint no longer trusted");
		assert.equal(state.previewNativeInput(args(context), known), undefined, "no preview over an edited covered source");
		assert.equal(state.nativeInput(args(ctx(effective(manager)))), undefined, "normal path: no native base either");
	});

	it("an edited or deleted raw response after the checkpoint (source-edited) gives undefined", () => {
		const { manager, state } = accepted();
		const known = [sysMsg("PENDING SECTIONS")];
		const answer = manager.appendMessage(assistantMsg("ANSWER", "resp-a") as never);
		state.rawHistory.recordOutputs("resp-a", [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ANSWER" }] } as WireItem]);
		assert.equal(state.history.load().reason, null, "fixture: unchanged response is replayable");
		assert.notEqual(state.previewNativeInput(args(ctx([...effective(manager), ...known])), known), undefined, "fixture: unchanged response previews");
		manager.appendContextEdit(answer, { content: [{ type: "text", text: "CHANGED" }] } as never);
		assert.equal(state.history.load().reason, "source-edited");
		assert.equal(state.previewNativeInput(args(ctx([...effective(manager), ...known])), known), undefined, "edited response: no preview");
		manager.appendContextEdit(answer, null);
		assert.equal(state.history.load().reason, "source-edited", "removed response stays invalid");
		assert.equal(state.previewNativeInput(args(ctx([...effective(manager), ...known])), known), undefined, "deleted response: no preview");
	});
});

describe("previewNativeInput: foreign owner, wrong suffix, order and truncation", () => {
	it("a foreign owner never borrows the own checkpoint, neither on the same thread nor through a fork", () => {
		const { manager, file } = accepted("acct-A");
		const known = [sysMsg("PENDING SECTIONS")];
		const context = ctx([...effective(manager), ...known]);
		const other = new SessionWireState({ session: agent(manager), ownerId: "acct-B", modelHash: MODEL_HASH });
		assert.equal(other.history.load().reason, "foreign-checkpoint");
		assert.equal(other.previewNativeInput(args(context), known), undefined, "same thread, other owner");
		const child = SessionManager.forkFrom(file, root, join(root, `fork-foreign-${++dirCounter}`), { id: "019a0000-0000-7000-8000-0000000000f1" });
		const forked = new SessionWireState({ session: agent(child), ownerId: "acct-B", modelHash: MODEL_HASH });
		assert.equal(forked.previewNativeInput(args(ctx([...effective(child), ...known])), known), undefined, "fork, other owner");
	});

	it("wrong known content, order, truncation or a missing suffix fail equality; the exact known is accepted", () => {
		const { manager, state } = accepted();
		const s1 = sysMsg("SECTIONS");
		const s2 = sysMsg("TOOLS");
		const base = effective(manager);
		assert.ok(state.previewNativeInput(args(ctx([...base, s1, s2])), [s1, s2]), "control: exact known accepted");
		assert.equal(state.previewNativeInput(args(ctx([...base, s1, s2])), [sysMsg("OTHER"), s2]), undefined, "wrong known content");
		assert.equal(state.previewNativeInput(args(ctx([...base, s2, s1])), [s1, s2]), undefined, "reversed order in the context");
		assert.equal(state.previewNativeInput(args(ctx([...base, s1])), [s1, s2]), undefined, "truncated context under a longer known");
		assert.equal(state.previewNativeInput(args(ctx([...base, s1, s2])), [s1]), undefined, "truncated known under a longer context");
		assert.equal(state.previewNativeInput(args(ctx([...base])), [s1]), undefined, "missing known suffix");
		assert.equal(state.previewNativeInput(args(ctx([...base, s1, s2])), [s2, s1]), undefined, "reversed known");
	});
});
