// Lineage of the per-session controller through the real facade: real Pi 1.4.0 AgentSessions (temporary file-backed managers),
// the real CodexThreadTransport with a fake SSE connector and a fake saved login. No network. Root and child controllers are
// created with explicit known ids; the child's request carries the lineage the caller gave it (name, parent, turns, header).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import * as zlib from "node:zlib";
import * as pi from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Model } from "@earendil-works/pi-ai";

import { createSessionController, type SessionController } from "../session.ts";
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

const completedEvent = (id: string) => ({
	type: "response.completed",
	response: { id, status: "completed", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } },
});

const textEvents = (id: string, text: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
	completedEvent(id),
];

/** Fake SSE POST: one script per request, in order; records the bodies and headers. */
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

/** Turn metadata (`x-codex-turn-metadata`) of one captured request, from its body. */
const turnOf = (bytes: Uint8Array): Record<string, unknown> => JSON.parse((bodyOf(bytes).client_metadata as Record<string, string>)["x-codex-turn-metadata"]);

/** Real session on a file-backed SessionManager holding one user message. */
async function withFileSession(run: (create: (manager: pi.SessionManager) => Promise<pi.AgentSession>) => Promise<void>) {
	const dir = mkdtempSync(join(tmpdir(), "rqw-codex-lineage-"));
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

/** One complete request of the controller (a run must be active for the turn fields to appear). */
async function send(controller: SessionController): Promise<void> {
	for await (const _event of controller.stream(MODEL, { systemPrompt: "SYSTEM", messages: [userMsg("hello")], tools: [] }, {})) void _event;
}

it("[lineage] root snapshot: label /root; the turn and root turn exist only while a run is active; a fresh object each time", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-lineage-root-"));
		try {
			const session = await create(fileManager(dir, "hello"));
			const root = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sseScript([]).fn } });
			const before = root.lineageSnapshot;
			assert.deepEqual(before, { threadId: session.sessionId, rootSessionId: session.sessionId, agentName: "/root" });
			root.policy.beginRun({ kind: "run" });
			const active = root.lineageSnapshot;
			assert.equal(typeof active.turnId, "string");
			assert.equal(active.rootTurnId, active.turnId, "root: its own active turn is the root turn");
			assert.notEqual(root.lineageSnapshot, active, "fresh object");
			root.policy.beginRun({ kind: "steer" });
			assert.deepEqual(root.lineageSnapshot, active, "a steer keeps the current turn and root");
			root.policy.endRun({ aborted: false });
			assert.deepEqual(root.lineageSnapshot, before, "after the settled turn the turn ids are absent");
			root.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("[lineage] child request: name, parent thread, parent turn, subagent header and captured root reach the body, headers and turn metadata", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-lineage-child-"));
		try {
			const parentSession = await create(fileManager(dir, "parent"));
			const childSession = await create(fileManager(dir, "child"));
			const parent = createSessionController({ session: parentSession, installationId: "inst-1", store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sseScript([]).fn } });
			parent.policy.beginRun({ kind: "run" });
			const parentTurn = parent.lineageSnapshot.turnId as string;
			const sse = sseScript([textEvents("resp_c1", "ok")]);
			const child = createSessionController({
				session: childSession, installationId: "inst-1", store: await seededStore(),
				parentThreadId: parent.threadId, rootSessionId: parent.rootSessionId, subagentKind: "collab_spawn", agentName: "/root/worker#1",
				parentTurnId: parentTurn, rootTurnId: parentTurn,
				dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn },
			} as never);
			child.policy.beginRun({ kind: "run" });
			await send(child);
			const call = sse.calls[0];
			const meta = bodyOf(call.body).client_metadata as Record<string, string>;
			const turn = turnOf(call.body);
			assert.equal(call.headers?.["x-openai-subagent"], "collab_spawn", "header: subagent kind");
			assert.equal(meta["x-openai-subagent"], "collab_spawn", "body: subagent kind");
			assert.equal(call.headers?.["x-codex-parent-thread-id"], parent.threadId, "header: parent thread");
			assert.equal(meta["x-codex-parent-thread-id"], parent.threadId, "body: parent thread");
			assert.equal(meta.parent_turn_id, parentTurn, "body: creation parent turn");
			assert.equal(meta.root_turn_id, parentTurn, "body: captured root turn");
			assert.equal(turn.agent_name, "/root/worker#1", "turn metadata: actual label");
			assert.equal(turn.parent_thread_id, parent.threadId);
			assert.equal(turn.parent_turn_id, parentTurn);
			assert.equal(turn.root_turn_id, parentTurn);
			assert.equal(turn.subagent_kind, "collab_spawn");
			assert.equal(turn.turn_id, meta.turn_id, "the child's own turn, not the parent's");
			assert.notEqual(meta.turn_id, parentTurn);
			child.release();
			parent.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("[lineage] parent turn ends, child begins: the child keeps the root it captured; a fresh run of the same child captures its own root and gets a new turn", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-lineage-capture-"));
		try {
			const parent = createSessionController({ session: await create(fileManager(dir, "parent")), installationId: "inst-1", store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sseScript([]).fn } });
			const child = createSessionController({
				session: await create(fileManager(dir, "child")), installationId: "inst-1", store: await seededStore(),
				parentThreadId: parent.threadId, rootSessionId: parent.rootSessionId, subagentKind: "review", agentName: "/root/reviewer#1",
				dependencies: { ...timing, connect: upgradeRequired, postEvents: sseScript([]).fn },
			} as never);
			parent.policy.beginRun({ kind: "run" });
			const firstParentTurn = parent.lineageSnapshot.turnId as string;
			child.captureRunOrigin({ rootTurnId: firstParentTurn });
			parent.policy.endRun({ aborted: false });
			child.policy.beginRun({ kind: "run" });
			const first = child.lineageSnapshot;
			assert.equal(first.agentName, "/root/reviewer#1");
			assert.equal(first.rootTurnId, firstParentTurn, "the captured root survives the parent's settled turn");
			const firstRoot = first.rootTurnId;
			child.policy.endRun({ aborted: false });
			assert.equal(child.lineageSnapshot.rootTurnId, undefined, "settled: no stale root");

			parent.policy.beginRun({ kind: "run" });
			const second = parent.lineageSnapshot.turnId as string;
			child.captureRunOrigin({ rootTurnId: second });
			parent.policy.endRun({ aborted: false });
			child.policy.beginRun({ kind: "run" });
			assert.equal(child.lineageSnapshot.rootTurnId, second, "fresh capture B");
			assert.notEqual(child.lineageSnapshot.rootTurnId, firstRoot);
			assert.notEqual(child.lineageSnapshot.turnId, first.turnId, "own new turn");
			child.policy.endRun({ aborted: false });
			parent.release();
			child.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("[lineage] nested child: the grandchild's root is the ancestor's root, not the immediate parent's turn", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-lineage-nested-"));
		try {
			const root = createSessionController({ session: await create(fileManager(dir, "root")), installationId: "inst-1", store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sseScript([]).fn } });
			root.policy.beginRun({ kind: "run" });
			const rootTurn = root.lineageSnapshot.turnId as string;
			const childSse = sseScript([]);
			const child = createSessionController({
				session: await create(fileManager(dir, "child")), installationId: "inst-1", store: await seededStore(),
				parentThreadId: root.threadId, rootSessionId: root.rootSessionId, subagentKind: "collab_spawn", agentName: "/root/worker#1",
				parentTurnId: rootTurn, rootTurnId: rootTurn,
				dependencies: { ...timing, connect: upgradeRequired, postEvents: childSse.fn },
			} as never);
			child.policy.beginRun({ kind: "run" });
			const childTurn = child.lineageSnapshot.turnId as string;
			assert.equal(child.lineageSnapshot.rootTurnId, rootTurn);
			const sse = sseScript([textEvents("resp_g", "ok")]);
			const grandchild = createSessionController({
				session: await create(fileManager(dir, "grandchild")), installationId: "inst-1", store: await seededStore(),
				parentThreadId: child.threadId, rootSessionId: root.rootSessionId, subagentKind: "review", agentName: "/root/worker#1/reviewer#1",
				parentTurnId: childTurn, rootTurnId: child.lineageSnapshot.rootTurnId,
				dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn },
			} as never);
			grandchild.policy.beginRun({ kind: "run" });
			await send(grandchild);
			const meta = bodyOf(sse.calls[0].body).client_metadata as Record<string, string>;
			assert.equal(meta.root_turn_id, rootTurn, "the ancestor's root turn");
			assert.equal(meta.parent_turn_id, childTurn, "the immediate parent's turn");
			assert.equal(meta["x-codex-parent-thread-id"], child.threadId);
			grandchild.release();
			child.release();
			root.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("[lineage] unknown origin: a child with no captured or birth root sends no root turn, and a later run never reuses an older root", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-lineage-unknown-"));
		try {
			const sse = sseScript([textEvents("resp_1", "ok"), textEvents("resp_2", "ok")]);
			const child = createSessionController({
				session: await create(fileManager(dir, "child")), installationId: "inst-1", store: await seededStore(),
				parentThreadId: "parent-fake", rootSessionId: "root-fake", subagentKind: "collab_spawn", agentName: "/root/worker#1",
				dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn },
			} as never);
			child.policy.beginRun({ kind: "run" });
			await send(child);
			const meta = bodyOf(sse.calls[0].body).client_metadata as Record<string, string>;
			assert.equal("root_turn_id" in meta, false, "no root turn in the body");
			assert.equal("root_turn_id" in turnOf(sse.calls[0].body), false, "no root turn in the turn metadata");
			child.policy.endRun({ aborted: false });
			child.captureRunOrigin({ rootTurnId: "R1" });
			child.policy.beginRun({ kind: "run" });
			child.policy.endRun({ aborted: false });
			child.policy.beginRun({ kind: "run" });
			assert.equal(child.lineageSnapshot.rootTurnId, undefined, "the captured R1 is not reused by a later run");
			child.policy.endRun({ aborted: false });
			child.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("[lineage] pending origin: a steer inside an active run discards the origin captured in it; an uncaptured end keeps it for the next run; capture after release is a no-op", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-lineage-pending-"));
		try {
			const child = createSessionController({
				session: await create(fileManager(dir, "child")), installationId: "inst-1", store: await seededStore(),
				parentThreadId: "parent-fake", rootSessionId: "root-fake", subagentKind: "review", agentName: "/root/reviewer#1", rootTurnId: "A",
				dependencies: { ...timing, connect: upgradeRequired, postEvents: sseScript([]).fn },
			} as never);
			child.policy.beginRun({ kind: "run" });
			assert.equal(child.lineageSnapshot.rootTurnId, "A", "birth root reaches the first run");
			child.captureRunOrigin({ rootTurnId: "R" });
			child.policy.beginRun({ kind: "steer" });
			assert.equal(child.lineageSnapshot.rootTurnId, "A", "a steer keeps the active root");
			child.policy.endRun({ aborted: false });
			child.policy.beginRun({ kind: "run" });
			assert.equal(child.lineageSnapshot.rootTurnId, undefined, "the origin captured inside the steered run was discarded");
			child.policy.endRun({ aborted: false });

			child.captureRunOrigin({ rootTurnId: "Q" });
			child.policy.endRun({ aborted: false });
			child.policy.beginRun({ kind: "run" });
			assert.equal(child.lineageSnapshot.rootTurnId, "Q", "an origin set while no run is active waits for the next run");
			child.policy.endRun({ aborted: false });
			child.release();
			assert.doesNotThrow(() => child.captureRunOrigin({ rootTurnId: "Z" }));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("[lineage] lineage is sealed once a Codex request has been prepared", async () => {
	await withFileSession(async (create) => {
		const dir = mkdtempSync(join(tmpdir(), "rqw-codex-lineage-seal-"));
		try {
			const child = createSessionController({
				session: await create(fileManager(dir, "child")), installationId: "inst-1", store: await seededStore(),
				parentThreadId: "parent-fake", rootSessionId: "root-fake", subagentKind: "review", agentName: "/root/reviewer#1",
				dependencies: { ...timing, connect: upgradeRequired, postEvents: sseScript([textEvents("resp_1", "ok")]).fn },
			} as never);
			child.policy.beginRun({ kind: "run" });
			await send(child);
			assert.throws(() => child.updateLineage({ agentName: "/root/other" }), /before start/);
			child.policy.endRun({ aborted: false });
			child.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
