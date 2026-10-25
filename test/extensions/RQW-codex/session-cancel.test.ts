// Cancelled and unpaired tool calls, and Pi thinking signatures, on the durable wire. Real Pi SessionManagers (temporary
// files) and the native codec only: no network, no credentials, no backend. A raw call without a paired Pi result is
// retired at logical settlement (one signed entry, no result created); a paired call is never retired.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { Api, Context, Model } from "@earendil-works/pi-ai";

import type { CodexIdentity } from "../../../extensions/RQW-codex/metadata.ts";
import { HISTORY_CUSTOM_TYPE, callPairKey } from "../../../extensions/RQW-codex/history.ts";
import { SessionWireState, type NativeInputArgs } from "../../../extensions/RQW-codex/session-history.ts";
import { buildRequest, transcriptItems, type WireItem, type WireModelInfo } from "../../../extensions/RQW-codex/wire.ts";

const root = mkdtempSync(join(tmpdir(), "rqw-session-cancel-"));
after(() => rmSync(root, { recursive: true, force: true }));

const MODEL = { id: "gpt-test", provider: "openai-codex", api: "openai-codex-responses", input: ["text"], contextWindow: 100_000 } as unknown as Model<Api>;
const CAPS = { slug: "gpt-test", supports_reasoning_effort_updates: true, default_reasoning_summary: "auto", supports_reasoning_summary_parameter: true } as WireModelInfo;
const MODEL_HASH = "caps-hash-cancel";

let dirCounter = 0;
function newManager(): SessionManager {
	return SessionManager.create(root, join(root, `c${++dirCounter}`));
}

function agent(manager: SessionManager): AgentSession {
	return { sessionId: manager.getSessionId(), sessionManager: manager } as unknown as AgentSession;
}

const USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const userMsg = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1700000000000 });
const assistantCall = (responseId: string, callId: string) => ({
	role: "assistant",
	content: [{ type: "toolCall", id: callId, name: "bash", arguments: { cmd: "ls" } }],
	api: "openai-codex-responses", provider: "openai-codex", model: "gpt-test", usage: USAGE, stopReason: "toolUse", timestamp: 1700000000000, responseId,
});
const toolResultMsg = (callId: string, isError = false) => ({
	role: "toolResult", toolCallId: callId, toolName: "bash", content: [{ type: "text", text: isError ? "cancelled" : "ok" }], isError, timestamp: 1700000000000,
});

function identityFor(threadId: string): CodexIdentity {
	return { installationId: "inst-test", windowId: "win-test", rootSessionId: threadId, threadId } as unknown as CodexIdentity;
}

function args(context: Context, options?: NativeInputArgs["options"]): NativeInputArgs {
	return { context, model: MODEL, capabilities: CAPS, options };
}

const ctx = (messages: unknown[]) => ({ systemPrompt: "SYSTEM A", messages, tools: [] }) as unknown as Context;

/** Simulates the transport's first request: a base is seeded from the built input (prefix stripped by the adapter). */
function seedBase(state: SessionWireState, context: Context): void {
	state.nativeInput(args(context));
	state.rawHistory.preparedRequest?.({ model: CAPS.slug, input: buildInput(context, state.history.scope.threadId) });
}

function buildInput(context: Context, threadId: string): WireItem[] {
	return buildRequest({ model: MODEL, context, options: {}, capabilities: CAPS, identity: identityFor(threadId) }).input;
}

const callsIn = (items: readonly WireItem[] | undefined) => (items ?? []).filter((i) => i.type === "function_call" || i.type === "custom_tool_call");
const retirementsOf = (manager: SessionManager) =>
	manager.getBranch().filter((e) => e.type === "custom" && e.customType === HISTORY_CUSTOM_TYPE && (e.data as { kind?: string }).kind === "unpaired_call_retired");

describe("unpaired call retirement at logical settlement", () => {
	it("retires a cancelled raw call without a Pi result: no result created, rawOutputs keeps the response as []", () => {
		const manager = newManager();
		manager.appendMessage(userMsg("run ls") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH, runtimeLeaseId: "rt-1" });
		seedBase(state, ctx([userMsg("run ls")]));
		state.rawHistory.recordItem?.("resp-c", { type: "reasoning", id: "rs_c", summary: [], encrypted_content: "ENC-C" } as WireItem);
		state.rawHistory.recordItem?.("resp-c", { type: "function_call", call_id: "call_c", name: "bash", arguments: "{}" } as WireItem);
		manager.appendMessage(userMsg("next") as never);

		assert.equal(callsIn(state.history.load().items.map((e) => e.item)).length, 1, "live before settlement");
		state.settleTurn();
		state.settleTurn();

		const loaded = state.history.load();
		assert.equal(callsIn(loaded.items.map((e) => e.item)).length, 0, "retired call is gone from the projection");
		assert.ok(loaded.items.some((e) => e.item.type === "reasoning"), "completed reasoning is kept");
		assert.deepEqual(state.rawHistory.rawOutputs().get("resp-c")?.map((i) => i.type), ["reasoning"]);
		const entries = retirementsOf(manager);
		assert.equal(entries.length, 1, "idempotent: one signed entry");
		const data = entries[0]!.data as Record<string, unknown>;
		assert.equal(data.responseId, "resp-c");
		assert.equal(data.callId, "call_c");
		assert.equal("executed" in data, false, "no executed flag");
		assert.equal(manager.getBranch().some((e) => e.type === "message" && (e as { message?: { role?: string } }).message?.role === "toolResult"), false, "no tool result created");
	});

	it("never retires a call with a real paired Pi result, including a cancelled-tool error result", () => {
		const manager = newManager();
		manager.appendMessage(userMsg("run ls") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		seedBase(state, ctx([userMsg("run ls")]));
		state.rawHistory.recordItem?.("resp-p", { type: "function_call", call_id: "call_p", name: "bash", arguments: "{}" } as WireItem);
		manager.appendMessage(assistantCall("resp-p", "call_p") as never);
		manager.appendMessage(toolResultMsg("call_p", true) as never);

		state.settleTurn();
		assert.equal(retirementsOf(manager).length, 0);
		assert.equal(callsIn(state.history.load().items.map((e) => e.item)).length, 1);
	});

	it("pairs by response id and call id: a reused call id in another response is still retired", () => {
		const manager = newManager();
		manager.appendMessage(userMsg("run ls") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		seedBase(state, ctx([userMsg("run ls")]));
		state.rawHistory.recordItem?.("resp-x", { type: "function_call", call_id: "call_same", name: "bash", arguments: "{}" } as WireItem);
		state.rawHistory.recordItem?.("resp-y", { type: "function_call", call_id: "call_same", name: "bash", arguments: "{}" } as WireItem);
		manager.appendMessage(assistantCall("resp-y", "call_same") as never);
		manager.appendMessage(toolResultMsg("call_same") as never);

		state.settleTurn();
		const entries = retirementsOf(manager).map((e) => e.data as { responseId: string });
		assert.deepEqual(entries.map((d) => d.responseId), ["resp-x"], "only the unpaired response's call is retired");
		assert.equal(callsIn(state.history.load().items.map((e) => e.item)).length, 1);
	});

	it("a later real result for a retired pair brings the call back with its result", () => {
		const manager = newManager();
		manager.appendMessage(userMsg("run ls") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		seedBase(state, ctx([userMsg("run ls")]));
		state.rawHistory.recordItem?.("resp-r", { type: "function_call", call_id: "call_r", name: "bash", arguments: "{}" } as WireItem);
		state.settleTurn();
		assert.equal(callsIn(state.history.load().items.map((e) => e.item)).length, 0);

		manager.appendMessage(assistantCall("resp-r", "call_r") as never);
		manager.appendMessage(toolResultMsg("call_r") as never);
		const context = ctx([userMsg("run ls"), assistantCall("resp-r", "call_r"), toolResultMsg("call_r")]);
		const input = state.nativeInput(args(context)) as WireItem[];
		assert.equal(callsIn(input).length, 1, "the call is back");
		assert.equal(input.filter((i) => i.type === "function_call_output").length, 1, "its real result follows once");
	});

	it("the pair key normalizes Pi's call|item form and never matches across responses", () => {
		assert.equal(callPairKey("resp-a", "call_1|fc_1"), callPairKey("resp-a", "call_1"));
		assert.notEqual(callPairKey("resp-a", "call_1"), callPairKey("resp-b", "call_1"));
	});
});

describe("Pi thinking signatures and aborted assistant messages", () => {
	const signature = JSON.stringify({ type: "reasoning", id: "rs_sig", summary: [], encrypted_content: "ENC-SIG" });
	const assistant = (extra: Record<string, unknown>) => ({
		role: "assistant" as const,
		content: [{ type: "thinking" as const, thinking: "", thinkingSignature: signature }, { type: "text" as const, text: "visible" }],
		api: "openai-codex-responses", provider: "openai-codex", model: "gpt-test", usage: USAGE, timestamp: 2, ...extra,
	});

	it("a thinkingSignature is replayed only when the caller does not disable it; the visible text stays", () => {
		const context = { systemPrompt: "S", tools: [], messages: [assistant({ stopReason: "stop", responseId: "resp-s" })] } as unknown as Context;
		const base = { context, model: MODEL, capabilities: CAPS, overrideEnabled: false, incrementalToolsEnabled: false };
		assert.ok(transcriptItems(base).some((i) => i.type === "reasoning"), "default true (bare SDK)");
		const off = transcriptItems({ ...base, history: { allowThinkingSignatures: false } });
		assert.equal(off.some((i) => i.type === "reasoning"), false, "unproven signature dropped");
		assert.deepEqual(off.map((i) => i.type), ["message"]);
	});

	it("an owner-proven raw item stays verbatim even when signatures are disabled", () => {
		const raw = [{ type: "reasoning", id: "rs_own", summary: [], encrypted_content: "ENC-OWN" }] as WireItem[];
		const context = { systemPrompt: "S", tools: [], messages: [assistant({ stopReason: "stop", responseId: "resp-o" })] } as unknown as Context;
		const items = transcriptItems({ context, model: MODEL, capabilities: CAPS, overrideEnabled: false, incrementalToolsEnabled: false, history: { rawOutputs: new Map([["resp-o", raw]]), allowThinkingSignatures: false } });
		assert.deepEqual(items, raw);
	});

	it("an aborted or failed assistant message without a raw entry is skipped entirely; a raw entry (even empty) wins", () => {
		const aborted = assistant({ stopReason: "aborted", responseId: "resp-ab" });
		const failed = assistant({ stopReason: "error", responseId: "resp-er" });
		const context = { systemPrompt: "S", tools: [], messages: [aborted, failed] } as unknown as Context;
		const base = { context, model: MODEL, capabilities: CAPS, overrideEnabled: false, incrementalToolsEnabled: false };
		assert.deepEqual(transcriptItems(base), []);
		const completed = [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }], status: "completed" }] as WireItem[];
		const withRaw = transcriptItems({ ...base, history: { rawOutputs: new Map([["resp-ab", completed], ["resp-er", []]]) } });
		assert.deepEqual(withRaw, completed, "completed raw items only; the empty raw entry adds nothing");
	});

	it("a Pi assistant with a thinkingSignature reaches the native request without its reasoning item in the adapter", () => {
		const manager = newManager();
		manager.appendMessage(userMsg("hi") as never);
		const state = new SessionWireState({ session: agent(manager), ownerId: "acct-A", modelHash: MODEL_HASH });
		seedBase(state, ctx([userMsg("hi")]));
		manager.appendMessage(assistant({ stopReason: "stop", responseId: "resp-pi" }) as never);
		manager.appendMessage(userMsg("again") as never);
		const input = state.nativeInput(args(ctx([userMsg("hi"), assistant({ stopReason: "stop", responseId: "resp-pi" }), userMsg("again")]))) as WireItem[];
		assert.equal(input.some((i) => i.type === "reasoning"), false, "encrypted Pi signature is not replayed");
		assert.ok(input.some((i) => i.type === "message" && JSON.stringify(i).includes("visible")), "visible text is kept");
	});
});
