// Backend compaction through the real session controller: real Pi 1.4.0 AgentSession (temporary file-backed manager),
// the real CodexThreadTransport with a fake SSE connector and a fake saved login in an in-memory store. No network.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import * as zlib from "node:zlib";
import * as pi from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Model } from "@earendil-works/pi-ai";

import { createSessionController } from "../session.ts";
import { SocketError } from "../websocket.ts";

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

const ACCOUNT = "acct-codex-1";
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function seededStore(): Promise<InMemoryCredentialStore> {
	const store = new InMemoryCredentialStore();
	const exp = Math.floor(Date.now() / 1000) + 3600;
	const access = `${b64url({ alg: "none" })}.${b64url({ exp, tag: "a", "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;
	await store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "refresh-a", expires: exp * 1000, accountId: ACCOUNT }) as never);
	return store;
}

const userMsg = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1_700_000_000_000 });

/** Assistant message of the owned Codex pair with a valid usage (what a stock agent loop would persist). */
const codexAssistant = (text: string) => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "openai-codex-responses",
	provider: "openai-codex",
	model: MODEL.id,
	usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "stop",
	timestamp: 1_700_000_000_000,
});

const completedEvent = (id: string) => ({
	type: "response.completed",
	response: { id, status: "completed", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } },
});

const compactionEvents = (id: string, encrypted: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.done", output_index: 0, item: { type: "compaction", encrypted_content: encrypted } },
	completedEvent(id),
];

/** Fake SSE POST: one script per request, in order; records the bodies. */
function sseScript(steps: unknown[][]) {
	const calls: { body: Uint8Array; headers?: Record<string, string> }[] = [];
	const fn = (options: any) => {
		calls.push({ body: options.body, headers: options.headers });
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

const bodyOf = (bytes: Uint8Array): Record<string, unknown> => JSON.parse(zlib.zstdDecompressSync(Buffer.from(bytes)).toString("utf8"));

const count = (text: string, needle: string) => text.split(needle).length - 1;

const textEvents = (id: string, text: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
	completedEvent(id),
];

/** One real turn first: its 426 on the socket makes the thread sticky SSE, which the compaction request then uses. */
async function primeTurn(controller: { policy: { beginRun(s?: { kind?: "run" | "steer" }): void; endRun(e?: { aborted?: boolean }): void }; stream(m: Model<Api>, c: unknown, o?: unknown): AsyncIterable<unknown> }) {
	controller.policy.beginRun({ kind: "run" });
	for await (const _event of controller.stream(MODEL, { systemPrompt: "SYSTEM", messages: [userMsg("hello")], tools: [] }, {})) void _event;
	controller.policy.endRun({ aborted: false });
}

/** Real session on a file-backed SessionManager holding one user message. */
async function withFileSession(run: (create: (manager: pi.SessionManager) => Promise<pi.AgentSession>) => Promise<void>) {
	const dir = mkdtempSync(join(tmpdir(), "rqw-codex-backend-"));
	const sessions: pi.AgentSession[] = [];
	const create = async (manager: pi.SessionManager) => {
		const resourceLoader = new pi.DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true,
			noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await resourceLoader.reload();
		const { session } = await pi.createAgentSession({ cwd: dir, agentDir: dir, resourceLoader, model: MODEL,
			sessionManager: manager, settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false } }) });
		sessions.push(session);
		return session;
	};
	try { await run(create); }
	finally {
		for (const session of sessions) session.dispose();
		rmSync(dir, { recursive: true, force: true });
	}
}

function fileManager(dir: string, text: string): pi.SessionManager {
	const manager = pi.SessionManager.create(dir, dir);
	manager.appendMessage(userMsg(text) as never);
	return manager;
}

it("[real facade] manual compact sends one compaction_trigger request; the accepted checkpoint advances the window 0 to 1 and writes no Pi compaction entry", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-backend-manual-"));
		try {
			const session = await create(fileManager(dir, "hello"));
			const sse = sseScript([textEvents("resp_1", "ok"), compactionEvents("resp_c", "ENC-C")]);
			const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
			await primeTurn(controller);
			const result = await session.compact();
			assert.equal(sse.calls.length, 2, "the turn, then one compaction request: no inference");
			const input = bodyOf(sse.calls[1].body).input as unknown[];
			assert.deepEqual(input.at(-1), { type: "compaction_trigger" });
			assert.equal(count(JSON.stringify(input), "compaction_trigger"), 1);
			assert.equal(count(JSON.stringify(input), "hello"), 1, "the transcript is sent once");
			assert.equal(controller.wireState?.window.number, 1, "accepted compaction: number 0 to 1");
			assert.ok(controller.wireState?.window.id, "new context window UUID");
			assert.equal(result.details.window.number, 1);
			assert.equal(controller.wireState?.history.load().checkpointEntryId !== null, true, "checkpoint installed");
			assert.equal(session.sessionManager.getBranch().some((e) => e.type === "compaction"), false, "no Pi compaction entry");
			controller.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("[real facade] failed, incomplete and malformed candidates after a compaction item write nothing; a valid candidate installs exactly one checkpoint", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-backend-atomic-"));
		try {
			const session = await create(fileManager(dir, "hello"));
			const item = (index: number, id: string) => ({ type: "response.output_item.done", output_index: index, item: { type: "compaction", id, encrypted_content: id } });
			const failed = [
				{ type: "response.created", response: { id: "resp_f" } },
				item(0, "cmp_f"),
				{ type: "response.output_item.done", output_index: 1, item: { type: "message", id: "msg_f", role: "assistant", content: [] } },
				{ type: "response.failed", response: { id: "resp_f", status: "failed", error: { code: "invalid_prompt", message: "bad" } } },
			];
			const incomplete = [
				{ type: "response.created", response: { id: "resp_i" } },
				item(0, "cmp_i"),
				{ type: "response.incomplete", response: { id: "resp_i", status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } },
			];
			const malformed = [
				{ type: "response.created", response: { id: "resp_b" } },
				item(0, "cmp_b1"),
				item(1, "cmp_b2"),
				completedEvent("resp_b"),
			];
			const sse = sseScript([textEvents("resp_1", "ok"), failed, incomplete, malformed, compactionEvents("resp_ok", "ENC-OK")]);
			const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
			await primeTurn(controller);
			const state = () => controller.wireState!;
			const customEntries = () => session.sessionManager.getBranch().filter((e) => e.type === "custom").length;
			const before = { items: state().history.load().items.length, entries: customEntries() };
			for (let i = 0; i < 3; i++) {
				await assert.rejects(session.compact());
				assert.equal(state().window.number, 0, "window unchanged");
				assert.equal(state().history.load().checkpointEntryId, null, "no checkpoint written");
				assert.equal(state().history.load().items.length, before.items, "no candidate item in the live history");
				assert.equal(customEntries(), before.entries, "no custom history entry written by the candidate");
			}
			assert.equal(sse.calls.length, 4, "each failed candidate is sent once: the turn, then three candidates");
			await session.compact();
			assert.equal(state().window.number, 1, "valid candidate accepted");
			assert.equal(customEntries(), before.entries + 1, "exactly one checkpoint entry installed");
			controller.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("[real facade] a malformed candidate (two compaction outputs) leaves window and checkpoint unchanged and is not retried", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-backend-bad-"));
		try {
			const session = await create(fileManager(dir, "hello"));
			const bad = [
				{ type: "response.created", response: { id: "resp_b" } },
				{ type: "response.output_item.done", output_index: 0, item: { type: "compaction", encrypted_content: "A" } },
				{ type: "response.output_item.done", output_index: 1, item: { type: "compaction", encrypted_content: "B" } },
				completedEvent("resp_b"),
			];
			const sse = sseScript([textEvents("resp_1", "ok"), bad]);
			const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
			await primeTurn(controller);
			await assert.rejects(session.compact());
			assert.equal(sse.calls.length, 2, "malformed is not retried");
			assert.equal(controller.wireState?.window.number, 0, "window unchanged");
			assert.equal(controller.wireState?.history.load().checkpointEntryId, null, "no checkpoint written");
			assert.equal(session.sessionManager.getBranch().some((e) => e.type === "compaction"), false);
			controller.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("[real facade] one before_provider_request hook per compaction attempt, with the selected reasoning in the body", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-backend-hook-"));
		try {
			const session = await create(fileManager(dir, "hello"));
			const runner = session.extensionRunner as unknown as { emitBeforeProviderRequest: (p: unknown) => Promise<unknown>; hasHandlers?: (n: string) => boolean };
			let hooks = 0;
			runner.emitBeforeProviderRequest = async (payload) => {
				hooks++;
				return payload;
			};
			runner.hasHandlers = () => true;
			session.setThinkingLevel("high");
			const sse = sseScript([textEvents("resp_1", "ok"), compactionEvents("resp_c", "ENC-C")]);
			const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
			await primeTurn(controller);
			hooks = 0;
			await session.compact();
			assert.equal(hooks, 1, "one final hook for the one attempt");
			assert.equal(count(JSON.stringify(bodyOf(sse.calls[1].body)), "\"effort\":\"high\""), 1, "selected reasoning reaches the compaction body");
			controller.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("[real facade] release restores the stock session methods: no hook slot remains on the session", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-backend-release-"));
		try {
			const session = await create(fileManager(dir, "hello"));
			const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sseScript([]).fn } });
			assert.equal(Object.prototype.hasOwnProperty.call(session, "compact"), true, "hook installed on the controller");
			controller.release();
			assert.equal(Object.prototype.hasOwnProperty.call(session, "compact"), false, "released: stock method again");
			assert.equal(Object.prototype.hasOwnProperty.call(session, "_runAutoCompaction"), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("[real facade] manual compact without a prior turn: the baseline seed carries no trigger; the one request carries exactly one trigger at the end", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-backend-seed-"));
		try {
			const session = await create(fileManager(dir, "hello"));
			const sse = sseScript([compactionEvents("resp_c", "ENC-C")]);
			const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
			await session.compact();
			assert.equal(sse.calls.length, 1);
			const input = bodyOf(sse.calls[0].body).input as unknown[];
			assert.deepEqual(input.at(-1), { type: "compaction_trigger" });
			assert.equal(count(JSON.stringify(input), "compaction_trigger"), 1);
			controller.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("[real facade] accepted V2 compaction appends the portable no-op marker; original messages and the owned usage are unchanged", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-backend-portable-"));
		try {
			const manager = fileManager(dir, "hello");
			manager.appendMessage(codexAssistant("ok") as never);
			const session = await create(manager);
			const sse = sseScript([textEvents("resp_1", "ok"), compactionEvents("resp_c", "ENC-C")]);
			const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
			const messagesBefore = JSON.stringify(manager.getBranch().filter((e) => e.type === "message"));
			await primeTurn(controller);
			await session.compact();
			const branch = session.sessionManager.getBranch();
			assert.equal(JSON.stringify(branch.filter((e) => e.type === "message")), messagesBefore, "original messages and usage unchanged");
			const usageIndex = branch.findIndex((e) => e.type === "message" && e.message.role === "assistant");
			assert.ok(branch.slice(usageIndex + 1).some((e) => e.type === "context_edit"), "the no-op marker follows the owned usage");
			assert.equal(controller.wireState?.window.number, 1);
			controller.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("[real facade] release after a post-compaction owned usage keeps the marker after it on the file; a stock reopen sees the marker", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-backend-release-usage-"));
		try {
			const manager = fileManager(dir, "hello");
			const session = await create(manager);
			const sse = sseScript([textEvents("resp_1", "ok"), compactionEvents("resp_c", "ENC-C")]);
			const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
			await primeTurn(controller);
			await session.compact();
			manager.appendMessage(codexAssistant("after") as never);
			controller.release();
			const file = manager.getSessionFile() as string;
			const branch = pi.SessionManager.open(file, dir).getBranch();
			const usageIndex = branch.findIndex((e) => e.type === "message" && (e.message as { role: string; content: { text?: string }[] }).role === "assistant" && (e.message as { content: { text?: string }[] }).content[0]?.text === "after");
			assert.ok(usageIndex >= 0, "post-compaction usage persisted");
			assert.ok(branch.slice(usageIndex + 1).some((e) => e.type === "context_edit"), "marker persists after the post-compaction usage");
			assert.equal(sse.calls.length, 2, "release sends no request");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("[real facade] manual compaction: header and body carry one operation identity, standalone phase and memento strategy; the next turn has a new turn id and no compaction block", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-backend-op-"));
		try {
			const session = await create(fileManager(dir, "hello"));
			const sse = sseScript([textEvents("resp_1", "ok"), compactionEvents("resp_c", "ENC-C"), textEvents("resp_2", "ok")]);
			const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
			await primeTurn(controller);
			await session.compact();
			const compaction = sse.calls[1];
			const bodyMeta = bodyOf(compaction.body).client_metadata as Record<string, string>;
			const bodyTurn = JSON.parse(bodyMeta["x-codex-turn-metadata"]);
			const headerTurn = JSON.parse(compaction.headers?.["x-codex-turn-metadata"] ?? "{}");
			assert.equal(typeof bodyMeta.turn_id, "string");
			assert.equal(bodyMeta.turn_id, bodyTurn.turn_id);
			assert.equal(headerTurn.turn_id, bodyMeta.turn_id, "header and body share the operation turn");
			assert.equal(bodyMeta.root_turn_id, bodyMeta.turn_id, "root thread: root turn is the operation turn");
			assert.equal(bodyTurn.turn_started_at_unix_ms, 1_000_000);
			assert.deepEqual(bodyTurn.compaction, { trigger: "manual", reason: "user_requested", implementation: "responses_compaction_v2", phase: "standalone_turn", strategy: "memento" });
			assert.deepEqual(headerTurn.compaction, bodyTurn.compaction);
			await primeTurn(controller);
			const next = JSON.parse((bodyOf(sse.calls[2].body).client_metadata as Record<string, string>)["x-codex-turn-metadata"]);
			assert.notEqual(next.turn_id, bodyTurn.turn_id, "next turn has its own id");
			assert.equal(next.compaction, undefined, "next turn carries no compaction block");
			controller.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("[real facade] compaction phase: a direct threshold call is pre_turn even inside a run; the post-sampling check and overflow are mid_turn", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-backend-phase-"));
		try {
			const session = await create(fileManager(dir, "hello"));
			const sse = sseScript([textEvents("resp_1", "ok"), compactionEvents("resp_a", "A"), compactionEvents("resp_b", "B"), compactionEvents("resp_c", "C"), compactionEvents("resp_d", "D")]);
			const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
			await primeTurn(controller);
			const auto = session as unknown as { _runAutoCompaction(reason: "threshold" | "overflow", willRetry: boolean): Promise<boolean>; _checkCompaction(message: { stopReason: string }, skipAbortedCheck?: boolean): Promise<boolean> };
			const phaseOf = (index: number) => JSON.parse((bodyOf(sse.calls[index].body).client_metadata as Record<string, string>)["x-codex-turn-metadata"]).compaction.phase;
			await auto._runAutoCompaction("threshold", false);
			assert.equal(phaseOf(1), "pre_turn");
			controller.policy.beginRun({ kind: "run" });
			// Outside the post-sampling check, a threshold call keeps the pre-turn phase even while a run is active.
			await auto._runAutoCompaction("threshold", false);
			assert.equal(phaseOf(2), "pre_turn");
			// The real post-sampling check (Pi's _checkCompaction after a turn) runs the threshold when it is exceeded: reserve the whole window.
			session.settingsManager.getCompactionSettings = () => ({ enabled: true, reserveTokens: 500000, keepRecentTokens: 20000 });
			await auto._checkCompaction({ stopReason: "stop" }, true);
			assert.equal(phaseOf(3), "mid_turn");
			await auto._runAutoCompaction("overflow", false);
			assert.equal(phaseOf(4), "mid_turn");
			controller.policy.endRun({ aborted: false });
			controller.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
