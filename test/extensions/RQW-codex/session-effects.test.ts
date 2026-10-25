// Effects of physical session edits on the real Codex wire. A real Pi 1.4.0 AgentSession (temporary dir, no extensions)
// runs prompt() through the owned controller and the real CodexThreadTransport; only the SSE connector, the WebSocket
// connector and the saved login (in-memory store, test-only) are fakes. No network, no real credentials.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import * as zlib from "node:zlib";
import * as pi from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Context, type Model } from "@earendil-works/pi-ai";

import { createSessionController, type SessionController } from "../../../extensions/RQW-codex/session.ts";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";

const MODEL = {
	id: "gpt-6-luna",
	name: "GPT-6-Luna",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 500000,
	maxTokens: 100000,
	thinkingLevelMap: {},
} as unknown as Model<Api>;

const root = mkdtempSync(join(tmpdir(), "rqw-codex-effects-"));
after(() => rmSync(root, { recursive: true, force: true }));

const ACCOUNT = "acct-codex-effects";
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function seededStore(): Promise<InMemoryCredentialStore> {
	const store = new InMemoryCredentialStore();
	const exp = Math.floor(Date.now() / 1000) + 3600;
	const access = `${b64url({ alg: "none" })}.${b64url({ exp, tag: "e", "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;
	await store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "refresh-e", expires: exp * 1000, accountId: ACCOUNT }) as never);
	return store;
}

const completedEvent = (id: string) => ({
	type: "response.completed",
	response: { id, status: "completed", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } },
});

/** One encrypted reasoning item and one assistant text: the raw items the durable wire must replay exactly. */
const answerEvents = (id: string, text: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: `rs_${id}`, encrypted_content: `ENC-${id}`, summary: [] } },
	{ type: "response.output_item.done", output_index: 1, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
	completedEvent(id),
];

/** Fake SSE POST: one script per request, in order; records the bodies. */
function sseScript(steps: unknown[][]) {
	const calls: { body: Uint8Array }[] = [];
	const fn = (options: any) => {
		calls.push({ body: options.body });
		const events = steps.shift();
		if (!events) throw new Error("unexpected SSE request");
		return (async function* () {
			options.onResponse({ status: 200, headers: {} });
			for (const value of events) yield { text: JSON.stringify(value), value };
		})();
	};
	return { fn: fn as any, calls };
}

/** Every WebSocket attempt is refused with 426: the native sticky SSE fallback. */
const upgradeRequired = async (): Promise<never> => {
	throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
};

const timing = { clock: { now: () => 1_000_000 }, random: () => 0.5, sleep: async () => {} };

/** Request body the real transport sent (zstd, JSON). */
function bodyOf(bytes: Uint8Array): { input: unknown[] } {
	return JSON.parse(zlib.zstdDecompressSync(Buffer.from(bytes)).toString("utf8")) as { input: unknown[] };
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

let dirCounter = 0;

/** A real file-backed session with the owned controller over the real transport and the fake SSE connector. */
async function harness(steps: unknown[][]) {
	const dir = join(root, `s${++dirCounter}`);
	const resourceLoader = new pi.DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await resourceLoader.reload();
	const manager = pi.SessionManager.create(dir, join(dir, "sessions"));
	const { session } = await pi.createAgentSession({ cwd: dir, agentDir: dir, resourceLoader, model: MODEL, sessionManager: manager,
		settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false } }) });
	// Pi's prompt preflight asks its own runtime for a key; the owned login lives in the store above, so the preflight answer is faked.
	(session.modelRuntime as unknown as { hasConfiguredAuth: () => boolean }).hasConfiguredAuth = () => true;
	// The agent's stream function is the owned controller: Pi's own onPayload chain reaches the real transport unchanged.
	const sse = sseScript(steps);
	const controller: SessionController = createSessionController({
		session,
		installationId: "inst-effects",
		store: await seededStore(),
		dependencies: { ...timing, connect: upgradeRequired as never, postEvents: sse.fn },
	});
	(session.agent as unknown as { streamFunction: unknown }).streamFunction = (model: Model<Api>, context: Context, options: unknown) =>
		controller.stream(model, context, options as never);
	return { session, controller, sse, manager };
}

/** Entry id of the assistant message carrying this response id on the current branch. */
function assistantEntryId(manager: pi.SessionManager, responseId: string): string {
	const entry = manager.getBranch().find((e) => e.type === "message" && (e as { message?: { responseId?: unknown } }).message?.responseId === responseId);
	assert.ok(entry, `assistant entry for ${responseId}`);
	return entry.id;
}

describe("physical edits reach the real Codex wire", () => {
	it("a replaced assistant answer drops its raw text and opaque item from the next real request", async () => {
		const h = await harness([answerEvents("resp_1", "ANSWER-ONE"), answerEvents("resp_2", "ANSWER-TWO")]);
		await h.session.prompt("first");
		assert.equal(count(JSON.stringify(bodyOf(h.sse.calls[0].body).input), "ANSWER-ONE"), 0, "first request has no answer yet");
		const answer = assistantEntryId(h.manager, "resp_1");
		h.manager.appendContextEdit(answer, { content: [{ type: "text", text: "REPLACED-ANSWER" }] });
		await h.session.prompt("second");
		const input = JSON.stringify(bodyOf(h.sse.calls[1].body).input);
		assert.equal(count(input, "ANSWER-ONE"), 0, "old raw text is not replayed");
		assert.equal(count(input, "ENC-resp_1"), 0, "old opaque item is not replayed");
		assert.equal(count(input, "REPLACED-ANSWER"), 1, "replacement is projected once");
		h.controller.release();
	});

	it("a same-content edit keeps the raw answer, its opaque item included, in the next real request", async () => {
		const h = await harness([answerEvents("resp_1", "KEEP-ME"), answerEvents("resp_2", "NEXT")]);
		await h.session.prompt("first");
		const answer = assistantEntryId(h.manager, "resp_1");
		// The same content as the original message (every field), so the edit is a no-op for the projection.
		const original = (h.manager.getBranch().find((e) => e.id === answer) as unknown as { message: { content: unknown[] } }).message.content;
		h.manager.appendContextEdit(answer, { content: original } as never);
		await h.session.prompt("second");
		const input = JSON.stringify(bodyOf(h.sse.calls[1].body).input);
		assert.equal(count(input, "ENC-resp_1"), 1, "the raw opaque item is kept");
		assert.equal(count(input, "KEEP-ME"), 1);
		h.controller.release();
	});

	it("a deleted assistant answer leaves no raw text and no opaque item in the next real request", async () => {
		const h = await harness([answerEvents("resp_1", "GONE-ANSWER"), answerEvents("resp_2", "NEXT")]);
		await h.session.prompt("first");
		const answer = assistantEntryId(h.manager, "resp_1");
		h.manager.appendContextEdit(answer, null);
		await h.session.prompt("second");
		const input = JSON.stringify(bodyOf(h.sse.calls[1].body).input);
		assert.equal(count(input, "GONE-ANSWER"), 0);
		assert.equal(count(input, "ENC-resp_1"), 0);
		h.controller.release();
	});

	it("an edit does not move the window: number and UUID are unchanged after the source fallback", async () => {
		const h = await harness([answerEvents("resp_1", "WIN-ONE"), answerEvents("resp_2", "WIN-TWO")]);
		await h.session.prompt("first");
		const before = h.controller.wireState?.window;
		assert.ok(before?.id, "initial window id persisted");
		h.manager.appendContextEdit(assistantEntryId(h.manager, "resp_1"), { content: [{ type: "text", text: "WIN-EDITED" }] });
		assert.deepEqual(h.controller.wireState?.window, before, "same window after the edit");
		await h.session.prompt("second");
		assert.deepEqual(h.controller.wireState?.window, before, "same window after the next request");
		h.controller.release();
	});

	it("a custom message sent through the session reaches the backend exactly once", async () => {
		const h = await harness([answerEvents("resp_1", "FIRST"), answerEvents("resp_2", "SECOND")]);
		await h.session.prompt("first");
		await h.session.sendCustomMessage({ customType: "rqw-effects", content: "CUSTOM-NOTE-XYZ", display: true }, { triggerTurn: true });
		const input = JSON.stringify(bodyOf(h.sse.calls[1].body).input);
		assert.equal(count(input, "CUSTOM-NOTE-XYZ"), 1, "custom message once in the backend input");
		h.controller.release();
	});
});
