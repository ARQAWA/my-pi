// Deterministic checks of the durable session-to-wire adapter over real Pi SessionManagers (create, reopen, forkFrom
// with a new id). No network, no credentials: the request bodies are built by the native codec with a fake model record.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { Api, Context, Model } from "@earendil-works/pi-ai";

import type { CodexIdentity } from "../metadata.ts";
import { estimateItemTokens } from "../compaction.ts";
import { canonicalJson } from "../history.ts";
import { SessionWireState, type NativeInputArgs } from "../session-history.ts";
import { buildRequest, type WireItem, type WireModelInfo } from "../wire.ts";

const root = mkdtempSync(join(tmpdir(), "rqw-session-history-"));
after(() => rmSync(root, { recursive: true, force: true }));

const MODEL = { id: "gpt-test", provider: "openai-codex", api: "openai-codex-responses", input: ["text"], contextWindow: 100_000 } as unknown as Model<Api>;
const CAPS = { slug: "gpt-test", supports_reasoning_effort_updates: true, default_reasoning_summary: "auto", supports_reasoning_summary_parameter: true } as WireModelInfo;
const MODEL_HASH = "caps-hash-1";

let dirCounter = 0;
function sessionDir(): string {
	const dir = join(root, `d${++dirCounter}`);
	return dir;
}

/** Real SessionManager: a file exists only after the first user or assistant message, so a message is appended first. */
function newManager(): { manager: SessionManager; dir: string } {
	const dir = sessionDir();
	const manager = SessionManager.create(root, dir);
	return { manager, dir };
}

function agent(manager: SessionManager): AgentSession {
	return { sessionId: manager.getSessionId(), sessionManager: manager } as unknown as AgentSession;
}

const userMsg = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1700000000000 });
const assistantMsg = (text: string, responseId: string) => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "openai-codex-responses",
	provider: "openai-codex",
	model: "gpt-test",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "stop",
	timestamp: 1700000000000,
	responseId,
});
const toolResultMsg = (callId: string, text: string) => ({
	role: "toolResult",
	toolCallId: callId,
	toolName: "bash",
	content: [{ type: "text", text }],
	isError: false,
	timestamp: 1700000000000,
});

function identityFor(threadId: string): CodexIdentity {
	return { installationId: "inst-test", windowId: "win-test", rootSessionId: threadId, threadId } as unknown as CodexIdentity;
}

function args(context: Context, options?: NativeInputArgs["options"]): NativeInputArgs {
	return { context, model: MODEL, capabilities: CAPS, options };
}

function ctx(messages: unknown[], systemPrompt = "SYSTEM A"): Context {
	return { systemPrompt, messages, tools: [] } as unknown as Context;
}

/** The body the transport would send: the native codec output for this context (prefix plus transcript). */
function builtInput(context: Context, threadId: string): WireItem[] {
	return buildRequest({ model: MODEL, context, options: {}, capabilities: CAPS, identity: identityFor(threadId) }).input;
}

/** Simulates the transport's first request: nativeInput (undefined without a base), then preparedRequest with the body. */
function sendRequest(state: SessionWireState, context: Context, generate?: boolean): WireItem[] | undefined {
	const native = state.nativeInput(args(context));
	const body: Record<string, unknown> = { model: CAPS.slug, input: native ?? builtInput(context, state.history.scope.threadId), generate };
	state.rawHistory.preparedRequest?.(body);
	return native;
}

const typesOf = (items: readonly WireItem[] | undefined) => (items ?? []).map((item) => item.type);

describe("SessionWireState seed and source cursor", () => {
	it("seeds the actual built input once, without the prefix, and never on a generate:false prewarm", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("hello") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH, runtimeLeaseId: "rt-1" });
		const context = ctx([userMsg("hello") as never]);
		assert.equal(state.window.number, 0, "initial window number is 0");
		assert.equal(typeof state.window.id, "string", "initial window id is persisted");
		assert.equal(state.nativeInput(args(context)), undefined, "no base yet: the transport builds the request");
		state.rawHistory.preparedRequest?.({ model: CAPS.slug, input: builtInput(context, state.history.scope.threadId), generate: false });
		assert.equal(state.history.load().items.length, 0, "prewarm seeds nothing");
		state.rawHistory.preparedRequest?.({ model: CAPS.slug, input: builtInput(context, state.history.scope.threadId) });
		const loaded = state.history.load();
		assert.equal(loaded.mode, "native");
		assert.deepEqual(loaded.items.map((e) => e.item.type), ["message"], "only the transcript item, prefix stripped");
		const next = state.nativeInput(args(context)) as WireItem[];
		assert.deepEqual(typesOf(next), [...builtInput(ctx([], "SYSTEM A"), state.history.scope.threadId).map((i) => i.type), "message"]);
		assert.equal(next.filter((i) => i.type === "message" && (i as { role?: string }).role === "developer").length, 1, "one base prompt");
	});

	it("appends only new physical source messages each turn; a second request never duplicates the seed", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("one") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendRequest(state, ctx([userMsg("one") as never]));
		manager.appendMessage(assistantMsg("reply", "resp-1") as never);
		manager.appendMessage(userMsg("two") as never);
		const context = ctx([userMsg("one") as never, assistantMsg("reply", "resp-1") as never, userMsg("two") as never]);
		const first = state.nativeInput(args(context)) as WireItem[];
		const second = state.nativeInput(args(context)) as WireItem[];
		assert.deepEqual(first, second, "idempotent: nothing more is appended");
		assert.equal(state.history.projection().length, 3, "seed user, appended assistant (lossy, no raw), user two");
		assert.equal(state.sourceEntryIds.length, 3);
	});

	it("records raw completed items once: output item before a failure, then the new user and the tool result pair", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("run ls") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendRequest(state, ctx([userMsg("run ls") as never]));
		const reasoning = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "ENC==+/" };
		const call = { type: "function_call", call_id: "call_1", name: "bash", arguments: '{"cmd":"ls "}', namespace: "functions" };
		// Output item done before the stream fails: persisted immediately, the failed response has no Pi assistant entry.
		state.rawHistory.recordItem?.("resp-f", reasoning as WireItem);
		state.rawHistory.recordItem?.("resp-f", call as WireItem);
		manager.appendMessage(userMsg("retry with other words") as never);
		const context = ctx([userMsg("run ls") as never, userMsg("retry with other words") as never]);
		const input = state.nativeInput(args(context)) as WireItem[];
		assert.deepEqual(typesOf(input).slice(-3), ["reasoning", "function_call", "message"]);
		assert.equal(input.filter((i) => i.type === "function_call").length, 1, "the recorded call appears once");
		assert.deepEqual(state.rawHistory.rawOutputs().get("resp-f"), [reasoning, call]);
	});

	it("completed response: raw items recorded, assistant source entry skipped, tool output appended once", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("run ls") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendRequest(state, ctx([userMsg("run ls") as never]));
		const call = { type: "function_call", call_id: "call_9", name: "bash", arguments: "{}", namespace: "functions" };
		const text = { type: "message", role: "assistant", content: [{ type: "output_text", text: "ran" }] };
		state.rawHistory.recordItem?.("resp-2", call as WireItem);
		state.rawHistory.recordItem?.("resp-2", text as WireItem);
		state.rawHistory.recordOutputs("resp-2", [call, text] as WireItem[]);
		manager.appendMessage(assistantMsg("ran", "resp-2") as never);
		manager.appendMessage(toolResultMsg("call_9", "file.txt") as never);
		const context = ctx([userMsg("run ls") as never, assistantMsg("ran", "resp-2") as never, toolResultMsg("call_9", "file.txt") as never]);
		const input = state.nativeInput(args(context)) as WireItem[];
		assert.equal(input.filter((i) => i.type === "function_call").length, 1, "call once");
		assert.equal(input.filter((i) => i.type === "message" && (i as { role?: string }).role === "assistant").length, 1, "assistant once, raw");
		assert.equal(input.filter((i) => i.type === "function_call_output" && i.call_id === "call_9").length, 1, "output once");
		assert.equal(input.at(-1)?.type, "function_call_output");
		assert.deepEqual(state.rawHistory.rawOutputs().get("resp-2"), [call, text], "recordOutputs after recordItem writes nothing twice");
	});

	it("does not write a response's items twice when only recordOutputs is called", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("hi") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendRequest(state, ctx([userMsg("hi") as never]));
		const text = { type: "message", role: "assistant", id: "msg_1", content: [{ type: "output_text", text: "x" }] };
		state.rawHistory.recordOutputs("resp-3", [text] as WireItem[]);
		state.rawHistory.recordOutputs("resp-3", [text] as WireItem[]);
		assert.equal(state.history.load().items.length, 2);
	});

	it("prefix change: a changed system prompt is replaced in the fresh prefix once, the seed keeps no prefix", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("hi") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendRequest(state, ctx([userMsg("hi") as never], "SYSTEM A"));
		const input = state.nativeInput(args(ctx([userMsg("hi") as never], "SYSTEM B"))) as WireItem[];
		const texts = input.flatMap((i) => (Array.isArray(i.content) ? (i.content as { text?: string }[]).map((c) => c.text) : []));
		assert.equal(texts.filter((t) => t === "SYSTEM B").length, 1);
		assert.equal(texts.filter((t) => t === "SYSTEM A").length, 0, "old prefix is not kept");
		assert.equal(texts.filter((t) => t === "hi").length, 1, "transcript user once");
	});
});

describe("SessionWireState checkpoints, reopen, fork and invalidation", () => {
	it("a checkpoint plus later source messages projects to the wire; Pi's own entries are never rewritten", () => {
		const { manager, dir } = newManager();
		manager.appendMessage(userMsg("a") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendRequest(state, ctx([userMsg("a") as never]));
		const file = manager.getSessionFile() as string;
		const before = readFileSync(file, "utf8");
		assert.equal(state.projectTokens(), undefined, "no checkpoint, no estimate");
		const oldWindow = state.window;
		state.history.installCompaction({
			responseId: "resp-c",
			compaction: { type: "compaction", encrypted_content: "ENC" } as WireItem,
			retained: [],
			window: { number: 2, id: "win-2" },
			sourceEntryIds: state.sourceEntryIds,
			sourceDigest: "digest",
		});
		assert.equal(state.window.id, "win-2", "accepted checkpoint updates the window");
		assert.notEqual(oldWindow.id, "win-2");
		manager.appendMessage(userMsg("after compaction") as never);
		const context = ctx([userMsg("a") as never, userMsg("after compaction") as never]);
		const input = state.nativeInput(args(context)) as WireItem[];
		assert.deepEqual(typesOf(input).slice(-2), ["compaction", "message"]);
		assert.equal(input.filter((i) => i.type === "compaction").length, 1);
		assert.equal(input.at(-1) && (input.at(-1) as { content: { text: string }[] }).content[0].text, "after compaction");
		const projected = state.nativeInput(args(context)) as WireItem[];
		assert.equal(state.projectTokens(), projected.reduce((sum, item) => sum + estimateItemTokens(item), 0), "fresh prefix plus projection, each counted once");
		assert.ok(readFileSync(file, "utf8").startsWith(before), "original Pi bytes are a prefix, unchanged");
		assert.ok(existsSync(dir));
	});

	it("reopen: the same native input, the same window id, and no second window entry", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("a") as never);
		const file = manager.getSessionFile() as string;
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendRequest(state, ctx([userMsg("a") as never]));
		const windowId = state.window.id;
		const windowEntries = manager.getEntries().filter((e) => e.type === "custom" && canonicalJson(e).includes('"kind":"window"')).length;
		const context = ctx([userMsg("a") as never]);
		const first = state.nativeInput(args(context));

		const reopened = SessionManager.open(file, dir(file));
		const again = new SessionWireState({ session: agent(reopened), ownerId: "acct-A", modelHash: MODEL_HASH, runtimeLeaseId: "rt-new" });
		assert.equal(again.window.id, windowId, "window persisted and reused on resume");
		assert.deepEqual(again.nativeInput(args(context)), first, "replay is identical after a restart");
		const afterEntries = reopened.getEntries().filter((e) => e.type === "custom" && canonicalJson(e).includes('"kind":"window"')).length;
		assert.equal(afterEntries, windowEntries);
	});

	it("fork with a new id adopts the parent's proven history, and gets its own window", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("a") as never);
		const parentFile = manager.getSessionFile() as string;
		const parent = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendRequest(parent, ctx([userMsg("a") as never]));
		parent.rawHistory.recordItem?.("resp-p", { type: "function_call", call_id: "c1", name: "bash", arguments: "{}" } as WireItem);
		const parentInput = parent.nativeInput(args(ctx([userMsg("a") as never])));
		const childId = "019a0000-0000-7000-8000-000000000001";
		const child = SessionManager.forkFrom(parentFile, root, join(root, "fork-dir"), { id: childId });
		assert.equal(child.getSessionId(), childId);
		const childState = new SessionWireState({ session: agent(child), ownerId: "acct-A", modelHash: MODEL_HASH });
		assert.notEqual(childState.window.id, parent.window.id, "child has its own window");
		// The prefix ids depend on the thread (fresh per thread); the replayed history after it must be identical.
		const childPrefix = builtInput(ctx([]), childId).length;
		const parentPrefix = builtInput(ctx([]), parent.history.scope.threadId).length;
		assert.deepEqual(childState.nativeInput(args(ctx([userMsg("a") as never])))?.slice(childPrefix), parentInput?.slice(parentPrefix), "proven parent history replays");
	});

	it("fork ancestry is not proven for another owner: no sibling replay, fresh seed", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("a") as never);
		const parentFile = manager.getSessionFile() as string;
		const parent = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendRequest(parent, ctx([userMsg("a") as never]));
		parent.history.installCompaction({
			responseId: "resp-c",
			compaction: { type: "compaction", encrypted_content: "ENC" } as WireItem,
			retained: [],
			window: { number: 2, id: "win-2" },
			sourceEntryIds: parent.sourceEntryIds,
			sourceDigest: "d",
		});
		const child = SessionManager.forkFrom(parentFile, root, join(root, "fork-other"), { id: "019a0000-0000-7000-8000-000000000002" });
		const other = new SessionWireState({ session: agent(child), ownerId: "acct-B", modelHash: MODEL_HASH });
		assert.equal(other.nativeInput(args(ctx([userMsg("a") as never]))), undefined, "not adopted for a different owner");
		assert.equal(other.history.load().checkpointEntryId, null);
	});

	it("account change on the same thread: the other owner's checkpoint is not replayed; a rebase seed is built", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("a") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendRequest(state, ctx([userMsg("a") as never]));
		state.history.installCompaction({
			responseId: "resp-c",
			compaction: { type: "compaction", encrypted_content: "ENC" } as WireItem,
			retained: [],
			window: { number: 2, id: "win-2" },
			sourceEntryIds: state.sourceEntryIds,
			sourceDigest: "d",
		});
		const other = new SessionWireState({ session: agent(manager), ownerId: "acct-B", modelHash: MODEL_HASH });
		assert.equal(other.history.load().reason, "foreign-checkpoint");
		const context = ctx([userMsg("a") as never]);
		assert.equal(other.nativeInput(args(context)), undefined);
		sendRequest(other, context);
		const input = other.nativeInput(args(context)) as WireItem[];
		assert.equal(input.filter((i) => i.type === "compaction").length, 0, "no opaque from the other owner");
		assert.equal(other.history.load().mode, "native");
	});

	it("model hash change keeps an ordinary native checkpoint; only the explicit compat guard rejects it", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("a") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendRequest(state, ctx([userMsg("a") as never]));
		state.history.installCompaction({
			responseId: "resp-c",
			compaction: { type: "compaction", encrypted_content: "ENC" } as WireItem,
			retained: [],
			window: { number: 2, id: "win-2" },
			sourceEntryIds: state.sourceEntryIds,
			sourceDigest: "d",
		});
		const changed = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: "caps-hash-2" });
		assert.equal(changed.history.load().mode, "native", "ordinary replay has no model-hash guard");
		assert.equal(changed.history.load().reason, null);
		assert.notEqual(changed.history.load().checkpointEntryId, null, "the checkpoint is kept");
		assert.equal(changed.history.load(undefined, "caps-hash-2").reason, "model-hash", "explicit compat guard");
		const context = ctx([userMsg("a") as never]);
		assert.equal(typesOf(changed.nativeInput(args(context))).at(-1), "compaction", "the checkpoint projects after the prefix");
		assert.equal(changed.window.number, 2, "the accepted window is kept across the hash change");
	});

	it("an edit that changes entries before a base never reuses the stale base", () => {
		const { manager } = newManager();
		const first = manager.appendMessage(userMsg("a") as never);
		manager.appendMessage(userMsg("b") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendRequest(state, ctx([userMsg("a") as never, userMsg("b") as never]));
		manager.branch(first);
		manager.appendMessage(userMsg("a edited") as never);
		const edited = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		// Pi's effective transcript of this branch: the kept root "a" and the sibling's replacement, never "b".
		const context = ctx([userMsg("a") as never, userMsg("a edited") as never]);
		assert.equal(edited.nativeInput(args(context)), undefined, "the seed is not on the edited branch");
		sendRequest(edited, context);
		const input = edited.nativeInput(args(context)) as WireItem[];
		const texts = input.flatMap((i) => (Array.isArray(i.content) ? (i.content as { text?: string }[]).map((c) => c.text) : []));
		assert.ok(texts.includes("a edited"));
		assert.ok(!texts.includes("b"), "the sibling's entry is not replayed");
	});

	it("effort pin: updates persist as positions; the default (feature off) writes nothing", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("a") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendRequest(state, ctx([userMsg("a") as never]));
		const before = state.history.load().items.length;
		state.nativeInput(args(ctx([userMsg("a") as never])));
		assert.equal(state.history.load().items.length, before, "feature off: no configuration update");
		const on = { reasoningEffortOverride: true };
		state.nativeInput(args(ctx([userMsg("a") as never]), { ...on, reasoningEffort: "high" }));
		state.nativeInput(args(ctx([userMsg("a") as never]), { ...on, reasoningEffort: "low" }));
		const effort = state.history.load().effort;
		assert.equal(effort, "low");
		const updates = state.history.load().items.filter((e) => e.item.type === "configuration_update");
		assert.equal(updates.length, 1, "one persisted position for the change to low");
	});
});

describe("SessionWireState raw custom calls and tokens", () => {
	it("a pending tool result of a raw custom call is custom_tool_call_output even when the current catalog has no grammar tool", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("run") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendRequest(state, ctx([userMsg("run") as never]));
		const custom = { type: "custom_tool_call", id: "ctc_1", call_id: "call_c", name: "exec", input: "echo 1" };
		state.rawHistory.recordItem?.("resp-cc", custom as WireItem);
		manager.appendMessage(toolResultMsg("call_c", "1") as never);
		const input = state.nativeInput(args(ctx([userMsg("run") as never, toolResultMsg("call_c", "1") as never]))) as WireItem[];
		assert.deepEqual(input.slice(-2), [custom, { type: "custom_tool_call_output", call_id: "call_c", output: "1" }]);
	});
});

describe("SessionWireState real session stays plain Pi", () => {
	it("Pi's own context never shows the opaque checkpoint or the seed", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("a") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendRequest(state, ctx([userMsg("a") as never]));
		state.history.installCompaction({
			responseId: "resp-c",
			compaction: { type: "compaction", encrypted_content: "ENC" } as WireItem,
			retained: [],
			window: { number: 2, id: "win-2" },
			sourceEntryIds: state.sourceEntryIds,
			sourceDigest: "d",
		});
		const messages = manager.buildSessionContext().messages;
		assert.equal(messages.length, 1);
		assert.equal((messages[0] as { role: string }).role, "user");
	});
});

// Turn settings: a known pinned model (profile slug) with normal turn bodies built by the native codec with requestKind 'turn'.
const KNOWN_MODEL = { id: "gpt-5.6-luna", provider: "openai-codex", api: "openai-codex-responses", input: ["text", "image"], contextWindow: 272000 } as unknown as Model<Api>;
const KNOWN_CAPS = {
	slug: "gpt-5.6-luna",
	supports_reasoning_summary_parameter: true,
	default_reasoning_summary: "auto",
	supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
	service_tiers: [{ id: "priority" }],
	input_modalities: ["text", "image"],
} as WireModelInfo;

function knownArgs(context: Context, options?: NativeInputArgs["options"]): NativeInputArgs {
	return { context, model: KNOWN_MODEL, capabilities: KNOWN_CAPS, options };
}

/** One normal turn: nativeInput, then the prepared body the transport would send (turn blob, built input). */
function sendTurn(state: SessionWireState, context: Context, turnId: string, options?: NativeInputArgs["options"], requestKind: "turn" | "prewarm" | "compaction" = "turn", generate?: boolean): WireItem[] | undefined {
	const native = state.nativeInput(knownArgs(context, options));
	const identity = { ...identityFor(state.history.scope.threadId), turnId } as unknown as CodexIdentity;
	const body = buildRequest({ model: KNOWN_MODEL, context, options: options ?? {}, capabilities: KNOWN_CAPS, identity, requestKind }) as unknown as Record<string, unknown>;
	if (generate !== undefined) body.generate = generate;
	state.rawHistory.preparedRequest?.(body);
	return native;
}

function turnSettingsEntries(manager: SessionManager): number {
	return manager.getBranch().filter((e) => e.type === "custom" && (e.data as { kind?: unknown } | undefined)?.kind === "turn-settings").length;
}

describe("SessionWireState previousTurnSettings", () => {
	const SETTINGS = {
		model: "gpt-5.6-luna",
		compHash: "3000",
		contextWindow: 272000,
		inputModalities: ["text", "image"],
		supportsStrictMode: true,
		supportsOpenAIGrammarTools: false,
		reasoningEffort: "high",
		reasoningSummary: "concise",
		serviceTier: "priority",
		turnId: "turn-1",
	};
	const OPTIONS = { reasoningEffort: "high", reasoningSummary: "concise", serviceTier: "priority" } as NativeInputArgs["options"];

	it("records the whitelisted settings of a normal turn body and returns a clone", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("hello") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH, runtimeLeaseId: "rt-1" });
		assert.equal(state.previousTurnSettings, undefined, "absent before any turn");
		sendTurn(state, ctx([userMsg("hello") as never]), "turn-1", OPTIONS);
		const got = state.previousTurnSettings as Record<string, unknown>;
		assert.deepEqual(got, SETTINGS);
		assert.equal(/"input"\s*:/.test(JSON.stringify(got)), false, "no body or transcript is persisted");
		got.model = "changed";
		assert.equal((state.previousTurnSettings as { model: string }).model, "gpt-5.6-luna", "getter returns a clone");
	});

	it("dedupes equal settings of one logical turn and writes again only for a new turnId; native input unchanged", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("hello") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		const context = ctx([userMsg("hello") as never]);
		sendTurn(state, context, "turn-1", OPTIONS);
		const once = turnSettingsEntries(manager);
		const before = state.nativeInput(knownArgs(context));
		sendTurn(state, context, "turn-1", OPTIONS);
		assert.equal(turnSettingsEntries(manager), once, "same logical turn: no redundant entry");
		assert.deepEqual(state.nativeInput(knownArgs(context)), before, "native input unchanged by the settings entries");
		sendTurn(state, context, "turn-2", OPTIONS);
		assert.equal(turnSettingsEntries(manager), once + 1, "new turn id writes one entry");
		assert.equal((state.previousTurnSettings as { turnId: string }).turnId, "turn-2");
	});

	it("skips manual baselines, prewarm, compaction and generate:false bodies", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("hello") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		const context = ctx([userMsg("hello") as never]);
		state.nativeInput(knownArgs(context));
		state.rawHistory.preparedRequest?.({ model: KNOWN_CAPS.slug, input: builtInput(context, state.history.scope.threadId) });
		assert.equal(state.previousTurnSettings, undefined, "manual baseline without request_kind blob");
		sendTurn(state, context, "turn-p", OPTIONS, "prewarm");
		sendTurn(state, context, "turn-c", OPTIONS, "compaction");
		sendTurn(state, context, "turn-g", OPTIONS, "turn", false);
		assert.equal(state.previousTurnSettings, undefined);
		assert.equal(turnSettingsEntries(manager), 0);
	});

	it("a saved entry survives a restart with a new runtime lease and a fork proves the same owner", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("hello") as never);
		const file = manager.getSessionFile() as string;
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH, runtimeLeaseId: "rt-1" });
		sendTurn(state, ctx([userMsg("hello") as never]), "turn-1", OPTIONS);
		const reopened = SessionManager.open(file, dir(file));
		const restarted = new SessionWireState({ session: agent(reopened), ownerId: "acct-A", modelHash: MODEL_HASH, runtimeLeaseId: "rt-2" });
		assert.deepEqual(restarted.previousTurnSettings, SETTINGS, "runtime lease is not a match key");
		const childId = "019a0000-0000-7000-8000-000000000003";
		const child = SessionManager.forkFrom(file, root, join(root, "fork-settings"), { id: childId });
		const forked = new SessionWireState({ session: agent(child), ownerId: "acct-A", modelHash: MODEL_HASH });
		assert.deepEqual(forked.previousTurnSettings, SETTINGS, "fork with proven ancestry adopts the settings");
	});

	it("another owner ignores the old owner's settings", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("hello") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendTurn(state, ctx([userMsg("hello") as never]), "turn-1", OPTIONS);
		const other = new SessionWireState({ session: agent(manager), ownerId: "acct-B", modelHash: MODEL_HASH });
		assert.equal(other.previousTurnSettings, undefined);
	});

	it("the actual branch selects the older settings entry, not the latest one in the file", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("one") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendTurn(state, ctx([userMsg("one") as never]), "turn-A", OPTIONS);
		const turnAEntry = manager.getLeafId() as string;
		manager.appendMessage(userMsg("two") as never);
		const later = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendTurn(later, ctx([userMsg("one") as never, userMsg("two") as never]), "turn-B", { ...OPTIONS, reasoningEffort: "low" });
		assert.equal((later.previousTurnSettings as { turnId: string }).turnId, "turn-B");
		manager.branch(turnAEntry);
		manager.appendMessage(userMsg("alt") as never);
		const alt = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		assert.equal((alt.previousTurnSettings as { turnId: string }).turnId, "turn-A");
	});

	it("a tampered settings entry is ignored and the previous verified one is returned", () => {
		const { manager } = newManager();
		manager.appendMessage(userMsg("one") as never);
		const file = manager.getSessionFile() as string;
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		sendTurn(state, ctx([userMsg("one") as never]), "turn-1", OPTIONS);
		manager.appendMessage(userMsg("two") as never);
		sendTurn(state, ctx([userMsg("one") as never, userMsg("two") as never]), "turn-2", { ...OPTIONS, reasoningEffort: "low" });
		const text = readFileSync(file, "utf8");
		const tampered = text.replace('"turnId":"turn-2"', '"turnId":"turn-X"');
		assert.notEqual(tampered, text, "the tamper changed the stored entry");
		writeFileSync(file, tampered);
		const reopened = SessionManager.open(file, dir(file));
		const after = new SessionWireState({ session: agent(reopened), ownerId: "acct-A", modelHash: MODEL_HASH });
		assert.equal((after.previousTurnSettings as { turnId: string }).turnId, "turn-1");
		assert.equal(after.history.load().reason, "invalid-entry", "existing source reason for a tampered history entry");
	});
});

/** Directory of a session file (the test sessions live in their own directory). */
function dir(file: string): string {
	return file.slice(0, file.lastIndexOf("/"));
}
