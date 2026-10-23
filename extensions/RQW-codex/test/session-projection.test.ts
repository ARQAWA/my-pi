// Projection integrity of the durable session-to-wire adapter over real Pi 1.4.0 SessionManagers: custom messages and
// context edits go through Pi's own projection (buildSessionProjection + convertToLlm). No network, no credentials.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { convertToLlm, SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { Api, Context, Model } from "@earendil-works/pi-ai";

import { canonicalJson } from "../history.ts";
import { SessionWireState, type NativeInputArgs } from "../session-history.ts";
import { buildRequest, type WireItem, type WireModelInfo } from "../wire.ts";

const root = mkdtempSync(join(tmpdir(), "rqw-session-projection-"));
after(() => rmSync(root, { recursive: true, force: true }));

const MODEL = { id: "gpt-test", provider: "openai-codex", api: "openai-codex-responses", input: ["text"], contextWindow: 100_000 } as unknown as Model<Api>;
const CAPS = { slug: "gpt-test", supports_reasoning_effort_updates: true, default_reasoning_summary: "auto", supports_reasoning_summary_parameter: true } as WireModelInfo;
const MODEL_HASH = "caps-hash-projection";
const STAMP = 1700000000000;

let dirCounter = 0;
function newManager(): SessionManager {
	return SessionManager.create(root, join(root, `p${++dirCounter}`));
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

function ctx(messages: unknown[], systemPrompt = "SYSTEM A"): Context {
	return { systemPrompt, messages, tools: [] } as unknown as Context;
}

/** The transcript Pi really sends: its projection converted to LLM messages. */
function effective(manager: SessionManager): Context {
	return ctx(convertToLlm(manager.buildSessionProjection().messages as never) as unknown[]);
}

function args(context: Context): NativeInputArgs {
	return { context, model: MODEL, capabilities: CAPS };
}

/** Transport stand-in: nativeInput (undefined without a base), then preparedRequest with the body it would send. */
function send(state: SessionWireState, context: Context): WireItem[] | undefined {
	const native = state.nativeInput(args(context));
	const built = buildRequest({ model: MODEL, context, options: {}, capabilities: CAPS, identity: { installationId: "", windowId: "", rootSessionId: state.history.scope.threadId, threadId: state.history.scope.threadId } as never }).input;
	state.rawHistory.preparedRequest?.({ model: CAPS.slug, input: native ?? built });
	return native;
}

/** Native input for the next request (after the base exists), with the transcript from Pi's projection. */
function next(state: SessionWireState, context: Context): WireItem[] {
	const input = state.nativeInput(args(context));
	assert.ok(input, "native input expected");
	return input;
}

const texts = (items: readonly WireItem[]): string[] =>
	items.flatMap((item) => (Array.isArray(item.content) ? (item.content as { text?: string }[]).map((c) => c.text ?? "") : []));

describe("custom messages and context edits follow Pi's projection", () => {
	it("a custom message appended after the seed reaches the next request exactly once, as Pi's wire text", () => {
		const manager = newManager();
		manager.appendMessage(userMsg("start") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		send(state, effective(manager));
		manager.appendCustomMessageEntry("rqw-test", "CUSTOM-NOTE", true);
		const input = next(state, effective(manager));
		assert.equal(texts(input).filter((t) => t === "CUSTOM-NOTE").length, 1, "custom message once");
		assert.equal(input.at(-1)?.type, "message");
		const again = next(state, effective(manager));
		assert.deepEqual(again, input, "a repeated request appends nothing");
		assert.equal(state.sourceEntryIds.length, 2, "seed user and custom message are both covered");
	});

	it("a custom message sent after a backend checkpoint is delivered once too", () => {
		const manager = newManager();
		manager.appendMessage(userMsg("a") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		send(state, effective(manager));
		state.history.installCompaction({
			responseId: "resp-c",
			compaction: { type: "compaction", encrypted_content: "ENC" } as WireItem,
			retained: [],
			window: { number: 1, id: "win-1" },
			sourceEntryIds: state.sourceEntryIds,
			sourceDigest: "d",
		});
		manager.appendCustomMessageEntry("rqw-test", "AFTER-CP", true);
		const input = next(state, effective(manager));
		assert.equal(input.filter((i) => i.type === "compaction").length, 1);
		assert.equal(texts(input).filter((t) => t === "AFTER-CP").length, 1);
	});

	it("replacing a covered user's content drops the old opaque base and the old text; the new text is projected", () => {
		const manager = newManager();
		const secret = manager.appendMessage(userMsg("SECRET-TEXT") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		send(state, effective(manager));
		assert.ok(texts(next(state, effective(manager))).includes("SECRET-TEXT"));
		manager.appendContextEdit(secret, { content: [{ type: "text", text: "REDACTED" }] });
		assert.equal(state.nativeInput(args(effective(manager))), undefined, "the covered entry changed: no native base");
		assert.notEqual(state.history.load().reason, null);
		send(state, effective(manager));
		const input = next(state, effective(manager));
		assert.ok(!texts(input).includes("SECRET-TEXT"), "old text is gone");
		assert.ok(texts(input).includes("REDACTED"), "replacement is projected");
	});

	it("deleting a covered user (null replacement) removes its text from the rebased base", () => {
		const manager = newManager();
		manager.appendMessage(userMsg("keep") as never);
		const gone = manager.appendMessage(userMsg("DELETE-ME") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		send(state, effective(manager));
		manager.appendContextEdit(gone, null);
		assert.equal(state.nativeInput(args(effective(manager))), undefined);
		send(state, effective(manager));
		const input = next(state, effective(manager));
		assert.ok(!texts(input).includes("DELETE-ME"), "deleted text is not replayed");
		assert.ok(texts(input).includes("keep"));
	});

	it("a same-content context edit is a no-op: the native base is retained", () => {
		const manager = newManager();
		const first = manager.appendMessage(userMsg("same") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		send(state, effective(manager));
		const before = next(state, effective(manager));
		const checkpointsBefore = state.history.load().items.length;
		manager.appendContextEdit(first, { content: [{ type: "text", text: "same" }] });
		assert.equal(state.history.load(undefined).reason, null, "no invalidation");
		const after = next(state, effective(manager));
		assert.deepEqual(after, before);
		assert.equal(state.history.load().items.length, checkpointsBefore);
	});

	it("a temporary context filter gets no native input, seeds nothing, and the next normal request is valid", () => {
		const manager = newManager();
		manager.appendMessage(userMsg("base") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		send(state, effective(manager));
		const normal = next(state, effective(manager));
		const persisted = state.history.load().items.length;
		const filtered = ctx([]);
		assert.equal(state.nativeInput(args(filtered)), undefined, "filtered transcript bypasses the native base");
		state.rawHistory.preparedRequest?.({ model: CAPS.slug, input: [{ type: "message", role: "user", content: [] }] });
		assert.equal(state.history.load().items.length, persisted, "nothing persisted from the filtered request");
		assert.equal(state.history.load().reason, null, "the persisted base is not poisoned");
		assert.deepEqual(next(state, effective(manager)), normal, "next normal request is valid");
	});

	it("a filtered first request seeds no base; the next normal request seeds from Pi's own transcript", () => {
		const manager = newManager();
		manager.appendMessage(userMsg("hello") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		assert.equal(state.nativeInput(args(ctx([])), ), undefined);
		state.rawHistory.preparedRequest?.({ model: CAPS.slug, input: [] });
		assert.equal(state.history.load().items.length, 0, "no seed from an untrusted request");
		send(state, effective(manager));
		assert.ok(texts(next(state, effective(manager))).includes("hello"));
	});

	it("save and reopen replay the same native input after a context edit", () => {
		const manager = newManager();
		const target = manager.appendMessage(userMsg("before") as never);
		const file = manager.getSessionFile() as string;
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		send(state, effective(manager));
		manager.appendContextEdit(target, { content: [{ type: "text", text: "after" }] });
		send(state, effective(manager));
		const first = next(state, effective(manager));
		const reopened = SessionManager.open(file, join(root, `p${dirCounter}`));
		const again = new SessionWireState({ session: agent(reopened), ownerId: "acct-A", modelHash: MODEL_HASH, runtimeLeaseId: "rt-2" });
		assert.deepEqual(next(again, effective(reopened)), first, "same native input after reopen");
		assert.ok(canonicalJson(first).includes("after"));
	});
});

const rawText = (text: string): WireItem => ({ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] } as WireItem);

describe("raw responses and the window follow the physical source", () => {
	it("a raw response replays while its assistant message is unchanged, and not after a genuine edit or removal", () => {
		const manager = newManager();
		manager.appendMessage(userMsg("q") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		send(state, effective(manager));
		const answer = manager.appendMessage(assistantMsg("ANSWER", "resp-a") as never);
		state.rawHistory.recordOutputs("resp-a", [rawText("ANSWER")]);
		assert.equal(state.history.load().mode, "native");
		const original = (manager.getBranch().find((e) => e.id === answer) as unknown as { message: { content: unknown[] } }).message.content;
		manager.appendContextEdit(answer, { content: original } as never);
		assert.equal(state.history.load().reason, null, "same content: no invalidation");
		assert.equal(state.rawHistory.acceptRawResponse?.("resp-a", effective(manager)), true);
		manager.appendContextEdit(answer, { content: [{ type: "text", text: "CHANGED" }] } as never);
		assert.equal(state.history.load().reason, "source-edited");
		assert.equal(state.rawHistory.acceptRawResponse?.("resp-a", effective(manager)), false, "edited response is never replayed raw");
		manager.appendContextEdit(answer, null);
		assert.equal(state.history.load().reason, "source-edited", "removed response is invalid");
		assert.equal(state.rawHistory.acceptRawResponse?.("resp-none", effective(manager)), true, "absent response: nothing to deny");
	});

	it("the window stays the signed-down checkpoint window when the branch falls back to source", () => {
		const manager = newManager();
		const first = manager.appendMessage(userMsg("a") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		send(state, effective(manager));
		const initial = state.window;
		state.history.installCompaction({
			responseId: "resp-c",
			compaction: { type: "compaction", encrypted_content: "ENC" } as WireItem,
			retained: [],
			window: { number: 1, id: "win-1" },
			sourceEntryIds: state.sourceEntryIds,
			sourceDigest: "d",
		});
		state.refresh();
		assert.deepEqual(state.window, { number: 1, id: "win-1" });
		manager.appendContextEdit(first, { content: [{ type: "text", text: "EDITED" }] });
		assert.equal(state.history.load().mode, "source");
		assert.deepEqual(state.window, { number: 1, id: "win-1" }, "source fallback keeps the checkpoint window");
		assert.notDeepEqual(state.window, initial);
		state.refresh();
		assert.deepEqual(state.window, { number: 1, id: "win-1" }, "refresh keeps it too");
	});
});
