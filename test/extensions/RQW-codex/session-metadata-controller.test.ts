// Production request metadata through the real session controller: real Pi 1.4.0 AgentSession on a temporary git workspace
// (sanitized remote, no network, no real repository), the real CodexThreadTransport with a fake SSE connector, a fake saved
// login in an in-memory store and a fake clock. Nothing is written into the workspace; the agent dir and sessions live outside it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import * as zlib from "node:zlib";
import * as pi from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Context, type Model } from "@earendil-works/pi-ai";

import { createCodexExtension } from "../../../extensions/RQW-codex/index.ts";
import { installRuntimeAuth } from "../../../extensions/RQW-codex/auth-runtime.ts";
import { createSessionController, type SessionTransport } from "../../../extensions/RQW-codex/session.ts";
import { CodexThreadTransport } from "../../../extensions/RQW-codex/transport.ts";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";

const root = mkdtempSync(join(tmpdir(), "rqw-codex-metadata-"));
after(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
const scratch = (label: string) => {
	const dir = join(root, `${label}-${++counter}`);
	mkdirSync(dir, { recursive: true });
	return dir;
};

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
const INSTALLATION = "11111111-1111-4111-8111-111111111111";
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function seededStore(): Promise<InMemoryCredentialStore> {
	const store = new InMemoryCredentialStore();
	const exp = Math.floor(Date.now() / 1000) + 3600;
	const access = `${b64url({ alg: "none" })}.${b64url({ exp, tag: "a", "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;
	await store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "refresh-a", expires: exp * 1000, accountId: ACCOUNT }) as never);
	return store;
}

/** Git workspace with one commit, one sanitized remote (credentials in the URL) and no changes. */
function gitWorkspace(): string {
	const dir = scratch("repo");
	const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "-c", "user.name=rqw", "-c", "user.email=rqw@example.invalid", ...args], { stdio: "ignore" });
	git("init", "-q");
	git("commit", "--allow-empty", "-q", "-m", "init");
	git("remote", "add", "origin", "https://user:secret@example.invalid/repo.git");
	return dir;
}

const userMsg = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1_700_000_000_000 });
const tool = (name: string) => ({ name, description: name, parameters: { type: "object", properties: {} } });
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

let clockMs = 1_000_000;
const timing = { clock: { now: () => clockMs }, random: () => 0.5, sleep: async () => {} };

const bodyOf = (bytes: Uint8Array): Record<string, any> => JSON.parse(zlib.zstdDecompressSync(Buffer.from(bytes)).toString("utf8"));

/** Turn metadata as the body carries it; the header copy must equal it minus the tool namespaces. */
function turnMetaOf(body: Record<string, any>): Record<string, any> {
	return JSON.parse(body.client_metadata["x-codex-turn-metadata"]);
}

function withoutNamespaces(meta: Record<string, any>): Record<string, any> {
	const { tool_namespaces_info: _namespaces, ...rest } = meta;
	return rest;
}

/** Real session on a file-backed SessionManager in the given workspace. */
async function withSession(
	manager: (repo: string, sessionDir: string) => pi.SessionManager,
	run: (session: pi.AgentSession, repo: string) => Promise<void>,
) {
	const repo = gitWorkspace();
	const agentDir = scratch("agent");
	const sessionDir = scratch("sessions");
	const resourceLoader = new pi.DefaultResourceLoader({ cwd: repo, agentDir, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({ cwd: repo, agentDir, resourceLoader, model: MODEL, sessionManager: manager(repo, sessionDir), settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false } }) });
	try {
		await run(session, repo);
	} finally {
		session.dispose();
	}
}

/** One logical run with one request; returns the request's stream events. */
async function runOnce(controller: ReturnType<typeof createSessionController>, context: Context, options: Record<string, unknown> = {}) {
	controller.policy.beginRun({ kind: "run" });
	try {
		for await (const _event of controller.stream(MODEL, context, options as never)) void _event;
	} finally {
		controller.policy.endRun({ aborted: false });
	}
}

const helloContext = (tools: unknown[] = []): Context => ({ systemPrompt: "SYSTEM", messages: [userMsg("hello") as never], tools: tools as never });

it("[real facade] a normal turn carries the actual policy, root name, tool catalog, selected effort, workspace facts and one onPayload call", { timeout: 15000 }, async () => {
	await withSession((repo, sessionDir) => {
		const manager = pi.SessionManager.create(repo, sessionDir);
		manager.appendMessage(userMsg("hello") as never);
		return manager;
	}, async (session) => {
		const sse = sseScript([textEvents("resp_1", "ok")]);
		const controller = createSessionController({ session, installationId: INSTALLATION, store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
		clockMs = 1_000;
		let payloads = 0;
		await runOnce(controller, helloContext([tool("read"), tool("bash")]), { reasoningEffort: "high", onPayload: () => void payloads++ });
		controller.release();

		assert.equal(payloads, 1, "onPayload runs once per request");
		const body = bodyOf(sse.calls[0].body);
		const meta = turnMetaOf(body);
		assert.deepEqual(withoutNamespaces(meta), withoutNamespaces(JSON.parse(sse.calls[0].headers!["x-codex-turn-metadata"])), "header and body metadata agree");
		assert.equal(meta.agent_name, "/root");
		assert.equal(meta.sandbox, "none");
		assert.equal(meta.sandbox_mode, "danger-full-access");
		assert.equal(meta.auto_review_enabled, false);
		assert.equal(meta.reasoning_effort, "high");
		assert.deepEqual(Object.keys(meta.tool_namespaces_info.functions.functions).sort(), ["bash", "read"]);
		assert.equal(meta.history_initialization, "supplied_history");
		assert.equal(meta.turn_started_at_unix_ms, 1_000);
		assert.equal(meta.root_turn_id, meta.turn_id, "root turn is the active own turn");
		const workspace = Object.values(meta.workspaces as Record<string, any>);
		assert.equal(workspace.length, 1);
		assert.equal(workspace[0].associated_remote_urls.origin, "https://example.invalid/repo.git", "credentials removed from the remote");
		assert.equal(workspace[0].has_changes, false);
		assert.match(workspace[0].latest_git_commit_hash, /^[0-9a-f]{40}$/);
		assert.equal(JSON.stringify(body).includes("secret"), false, "no credential reaches the body");
		for (const key of ["analytics_enabled", "node_repl_auto_review_required", "node_repl_disabled", "history_ingest_requested"]) {
			assert.equal(Object.hasOwn(meta, key), false, key);
		}
		assert.equal(body.client_metadata.guardian_credits_requested, "true", "ordinary subscription request flag only");
	});
});

it("[real facade] one logical run keeps one start time; a new run gets a new one", { timeout: 15000 }, async () => {
	await withSession((repo, sessionDir) => {
		const manager = pi.SessionManager.create(repo, sessionDir);
		manager.appendMessage(userMsg("hello") as never);
		return manager;
	}, async (session) => {
		const sse = sseScript([textEvents("resp_1", "a"), textEvents("resp_2", "b"), textEvents("resp_3", "c")]);
		const controller = createSessionController({ session, installationId: INSTALLATION, store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
		controller.policy.beginRun({ kind: "run" });
		clockMs = 1_000;
		for await (const _e of controller.stream(MODEL, helloContext(), {})) void _e;
		clockMs = 2_000;
		for await (const _e of controller.stream(MODEL, helloContext(), {})) void _e;
		controller.policy.endRun({ aborted: false });
		clockMs = 5_000;
		await runOnce(controller, helloContext());
		controller.release();
		const starts = sse.calls.map((call) => turnMetaOf(bodyOf(call.body)).turn_started_at_unix_ms);
		assert.deepEqual(starts, [1_000, 1_000, 5_000]);
	});
});

it("[real facade] the cold prewarm updates metadata before it is sent: no turn, no time, no root turn, empty messages", { timeout: 15000 }, async () => {
	await withSession((repo, sessionDir) => pi.SessionManager.create(repo, sessionDir), async (session) => {
		const events: string[] = [];
		const updates: Record<string, any>[] = [];
		let warmContext: Context | undefined;
		let warmDone: Promise<unknown> = Promise.resolve();
		const sse = sseScript([]);
		const transportFactory = (identity: any, store: any, history: any): SessionTransport => {
			const real = new CodexThreadTransport({ identity, store, history, dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
			return {
				stream: (model, context, options) => real.stream(model, context, options),
				prewarm(model, context, options) {
					events.push("prewarm");
					warmContext = context;
					warmDone = real.prewarm(model, context, options);
					return warmDone;
				},
				beginTurn: (info) => real.beginTurn(info),
				endTurn: () => real.endTurn(),
				updateMetadata(update) {
					events.push("update");
					updates.push(structuredClone(update));
					real.updateMetadata(update);
				},
				sendRaw: (args) => real.sendRaw(args),
				dispose: () => real.dispose(),
			};
		};
		const controller = createSessionController({ session, installationId: INSTALLATION, store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn, transportFactory } });
		await controller.start();
		await warmDone.catch(() => undefined);
		controller.release();

		assert.deepEqual(events, ["update", "prewarm"], "metadata is applied before the prewarm");
		const snapshot = updates[0];
		assert.equal(snapshot.agentName, "/root");
		assert.equal(snapshot.turnStartedAtUnixMs, undefined);
		assert.equal(snapshot.rootTurnId, undefined);
		assert.equal(snapshot.turnId, undefined);
		assert.equal(snapshot.historyInitialization, "new");
		assert.deepEqual(warmContext?.messages, [], "no user turn in the prewarm");
		assert.equal(sse.calls.length, 0, "a prewarm never sends a turn");
	});
});

it("[real facade] stock compaction has isolated normal-request metadata, not native compaction metadata", { timeout: 15000 }, async () => {
	const repo = gitWorkspace();
	const agentDir = scratch("stock-agent");
	const sessionDir = scratch("stock-sessions");
	const store = await seededStore();
	const runtime = await pi.ModelRuntime.create({ credentials: store, modelsPath: null, refreshOnCreate: false });
	const releaseAuth = installRuntimeAuth(runtime);
	const sse = sseScript([textEvents("resp_1", "ok"), textEvents("resp_summary", "PORTABLE_SUMMARY")]);
	const resourceLoader = new pi.DefaultResourceLoader({ cwd: repo, agentDir, additionalExtensionPaths: [], noSkills: true,
		noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [createCodexExtension({
			installationId: INSTALLATION, agentDir, dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn,
				fetch: async () => { throw new Error("real network forbidden"); } },
		})] });
	let session: pi.AgentSession | undefined;
	try {
		await resourceLoader.reload();
		assert.deepEqual(resourceLoader.getExtensions().errors, []);
		const model = runtime.getModels("openai-codex").find((item) => item.id === MODEL.id)!;
		assert.ok(model);
		const manager = pi.SessionManager.create(repo, sessionDir);
		manager.appendMessage(userMsg("ORIGINAL_TASK ".repeat(500)) as never);
		manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Earlier source progress" }], api: model.api,
			provider: model.provider, model: model.id, stopReason: "stop", timestamp: 1_700_000_000_001,
			usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } as never);
		manager.appendMessage(userMsg("kept tail") as never);
		({ session } = await pi.createAgentSession({ cwd: repo, agentDir, resourceLoader, modelRuntime: runtime, model,
			thinkingLevel: "off", sessionManager: manager, settingsManager: pi.SettingsManager.inMemory({
				retry: { enabled: false }, compaction: { enabled: true, reserveTokens: 10000, keepRecentTokens: 100 }, transport: "sse",
			}) }));
		await session.bindExtensions({ mode: "tui" });
		await session.prompt("continue");
		const result = await session.compact();
		assert.equal(sse.calls.length, 2, "one ordinary turn and one summary request");
		assert.equal(result.summary, "PORTABLE_SUMMARY");
		assert.equal(manager.getBranch().filter((entry) => entry.type === "compaction").length, 1);
		const normal = turnMetaOf(bodyOf(sse.calls[0].body));
		assert.equal(normal.agent_name, "/root");
		assert.equal(normal.sandbox_mode, "danger-full-access");
		assert.equal(Object.keys(normal.workspaces).length, 1, "ordinary turns retain the actual workspace facts");
		const body = bodyOf(sse.calls[1].body);
		const meta = turnMetaOf(body);
		assert.equal(meta.request_kind, "turn", "a Pi summary is a normal request, not native backend compaction");
		assert.equal(Object.hasOwn(meta, "compaction"), false);
		assert.equal(JSON.stringify(body).includes("responses_compaction_v2"), false);
		assert.equal(body.input.some((item: any) => item.type === "compaction_trigger" || item.type === "compaction"), false);
		assert.match(JSON.stringify(body.input), /<conversation>/);
		assert.match(JSON.stringify(body.input), /ORIGINAL_TASK/);
		assert.notEqual(meta.thread_id, session.sessionId, "summary uses an independent request-local thread");
		assert.equal(meta.session_id, meta.thread_id);
		assert.equal(meta.window_number, 0);
		assert.match(meta.context_window_id, /^[0-9a-f-]{36}$/);
		assert.equal(Object.hasOwn(meta, "root_turn_id"), false, "no completed turn is borrowed by a standalone summary");
		assert.equal(Object.hasOwn(meta, "turn_started_at_unix_ms"), false);
		assert.equal(Object.hasOwn(meta, "workspaces"), false, "summary does not invent a workspace snapshot");
		assert.deepEqual(withoutNamespaces(meta), withoutNamespaces(JSON.parse(sse.calls[1].headers!["x-codex-turn-metadata"])), "header and body agree");
		assert.equal(JSON.stringify(body).includes("secret"), false, "sanitized workspace credentials never enter the summary request");
	} finally {
		session?.dispose();
		releaseAuth();
	}
});

it("[real facade] a fresh empty session's first turn is initialized as new", { timeout: 15000 }, async () => {
	await withSession((repo, sessionDir) => pi.SessionManager.create(repo, sessionDir), async (session) => {
		const sse = sseScript([textEvents("resp_1", "ok")]);
		const controller = createSessionController({ session, installationId: INSTALLATION, store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
		await runOnce(controller, helloContext());
		controller.release();
		assert.equal(turnMetaOf(bodyOf(sse.calls[0].body)).history_initialization, "new");
	});
});
