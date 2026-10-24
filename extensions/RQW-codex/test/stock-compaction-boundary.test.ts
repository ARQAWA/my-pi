// Stock Pi compaction boundary on the session controller (real Pi 1.4.0 AgentSession, real SessionManager.appendCompaction):
// a held startup or idle setup must never warm after the boundary, and the next stream gets a fresh transport. The public
// controller.afterPiCompaction() is the trigger; the boundary is also seen without it. Fake SSE and refused WebSocket only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import * as pi from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Context, type CredentialStore, type Model } from "@earendil-works/pi-ai";

import { createSessionController, type SessionTransport } from "../session.ts";
import { CodexThreadTransport } from "../transport.ts";
import { SocketError } from "../websocket.ts";

const root = mkdtempSync(join(tmpdir(), "rqw-codex-compaction-boundary-"));
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

const ACCOUNT = "acct-startup-race-1";
const INSTALLATION = "33333333-4444-4555-8666-777777777777";
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function seededStore(): Promise<InMemoryCredentialStore> {
	const store = new InMemoryCredentialStore();
	await seed(store);
	return store;
}

async function seed(store: CredentialStore): Promise<void> {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	const access = `${b64url({ alg: "none" })}.${b64url({ exp, tag: "a", "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;
	await store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "refresh-startup-race", expires: exp * 1000, accountId: ACCOUNT }) as never);
}

/** Git workspace with one commit and no changes. */
function gitWorkspace(): string {
	const dir = scratch("repo");
	const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "-c", "user.name=rqw", "-c", "user.email=rqw@example.invalid", ...args], { stdio: "ignore" });
	git("init", "-q");
	git("commit", "--allow-empty", "-q", "-m", "init");
	return dir;
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

/** Every WebSocket attempt is refused with 426: the prewarm fails quietly and the turn uses SSE. */
const upgradeRequired = async (): Promise<never> => {
	throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
};

let clockMs = 1_000_000;
const timing = { clock: { now: () => clockMs }, random: () => 0.5, sleep: async () => {} };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, label: string, ms = 5_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
		await pause(5);
	}
}

/** A promise the test resolves by hand. */
function gate<T>() {
	let open!: (value: T) => void;
	const promise = new Promise<T>((resolve) => {
		open = resolve;
	});
	return { promise, open };
}

/** Real session on a temporary git workspace (no extensions, no network). */
async function withSession(run: (session: pi.AgentSession) => Promise<void>) {
	const repo = gitWorkspace();
	const agentDir = scratch("agent");
	const sessionDir = scratch("sessions");
	const resourceLoader = new pi.DefaultResourceLoader({ cwd: repo, agentDir, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({
		cwd: repo,
		agentDir,
		resourceLoader,
		model: MODEL,
		sessionManager: pi.SessionManager.create(repo, sessionDir),
		settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false } }),
	});
	try {
		await run(session);
	} finally {
		session.dispose();
	}
}

/**
 * Controller over the real transport, with a recording wrapper: `events` lists the controller's calls into the transport
 * (update, prewarm, stream); `created` keeps every transport built (identity, disposal, turns begun).
 * The workspace collector is the test gate: `collect(call)` returns the capture of the n-th call (1-based).
 */
function recorder(store: CredentialStore, collect: (call: number) => Promise<Record<string, unknown>>, steps: unknown[][] = []) {
	const events: string[] = [];
	const created: { identity: any; disposed: boolean; begun: (string | undefined)[] }[] = [];
	const sse = sseScript(steps);
	let calls = 0;
	const dependencies = {
		...timing,
		connect: upgradeRequired,
		postEvents: sse.fn,
		collectWorkspaceMetadata: (() => collect(++calls)) as never,
		transportFactory: (identity: any, storeArg: any, history: any): SessionTransport => {
			const real = new CodexThreadTransport({ identity, store: storeArg, history, dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
			const record = { identity, disposed: false, begun: [] as (string | undefined)[] };
			created.push(record);
			return {
				stream: (model, context, options) => {
					events.push("stream");
					return real.stream(model, context, options);
				},
				prewarm(model, context, options) {
					events.push("prewarm");
					return real.prewarm(model, context, options);
				},
				beginTurn: (info) => {
					record.begun.push(info?.turnId);
					real.beginTurn(info);
				},
				endTurn: () => real.endTurn(),
				updateMetadata(update) {
					events.push("update");
					real.updateMetadata(update);
				},
				sendRaw: (args) => real.sendRaw(args),
				dispose: () => {
					record.disposed = true;
					real.dispose();
				},
			};
		},
	};
	return { dependencies, events, created, sse, captures: () => calls };
}

const helloContext = (): Context => ({ systemPrompt: "SYSTEM", messages: [userMsg("hello") as never], tools: [] });

/** Adds a user turn to the real session and then a real stock Pi compaction entry, as Pi does before session_compact. */
function appendStockCompaction(session: pi.AgentSession): string {
	const manager = session.sessionManager as unknown as { appendMessage(m: object): string; appendCompaction(...args: unknown[]): string };
	const kept = manager.appendMessage(userMsg("kept tail"));
	return manager.appendCompaction("PORTABLE SUMMARY", kept, 1000);
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
	for await (const _event of stream) void _event;
}

it("[boundary] a held startup setup never warms after afterPiCompaction; the next stream builds a fresh transport", { timeout: 20_000 }, async () => {
	await withSession(async (session) => {
		clockMs = 1_000;
		const store = await seededStore();
		const held = gate<Record<string, unknown>>();
		const rec = recorder(store, (call) => (call === 1 ? held.promise : Promise.resolve({})), [textEvents("resp_b1", "ok")]);
		const controller = createSessionController({ session, installationId: INSTALLATION, store, dependencies: rec.dependencies as never });
		const started = controller.start();
		await waitFor(() => rec.captures() === 1, "the startup capture");
		assert.equal(rec.created.length, 1, "the startup setup built its transport");
		const oldWindow = rec.created[0]!.identity.windowId;
		const oldContextWindow = rec.created[0]!.identity.contextWindowId;

		appendStockCompaction(session);
		controller.afterPiCompaction();
		assert.equal(rec.created[0]!.disposed, true, "the pre-boundary transport is disposed at the boundary");
		await started;
		held.open({ "startup-workspace": { latest_git_commit_hash: "a".repeat(40) } });
		await pause(100);
		assert.deepEqual(rec.events, [], "the late capture sends no metadata update and no prewarm");

		await drain(controller.stream(MODEL, helloContext(), {}));
		controller.release();
		assert.equal(rec.created.length, 2, "the stream built a fresh transport");
		assert.notEqual(rec.created[1], rec.created[0]);
		assert.equal(rec.created[1]!.disposed, true, "released with the controller");
		assert.deepEqual(rec.events, ["update", "stream"], "one generation, no warm");
		assert.equal(rec.sse.calls.length, 1);
		assert.equal(rec.created[1]!.identity.windowId, oldWindow, "stock summaries start a new native base at window zero");
		assert.notEqual(rec.created[1]!.identity.contextWindowId, oldContextWindow, "the new base has a fresh context window identity");
	});
});

it("[boundary] a held explicit idle warm sends nothing after afterPiCompaction", { timeout: 20_000 }, async () => {
	await withSession(async (session) => {
		clockMs = 1_000;
		const store = await seededStore();
		const held = gate<Record<string, unknown>>();
		const rec = recorder(store, (call) => (call === 1 ? held.promise : Promise.resolve({})));
		const controller = createSessionController({ session, installationId: INSTALLATION, store, dependencies: rec.dependencies as never });
		const warm = controller.prewarmWithHistory();
		await waitFor(() => rec.captures() === 1, "the idle capture");

		appendStockCompaction(session);
		controller.afterPiCompaction();
		await warm;
		held.open({});
		await pause(100);
		controller.release();
		assert.deepEqual(rec.events, [], "the late idle setup updates nothing and warms nothing");
		assert.equal(rec.created[0]!.disposed, true);
	});
});

it("[boundary] the boundary is seen without afterPiCompaction: a stream after a persisted stock summary gets a fresh transport", { timeout: 20_000 }, async () => {
	await withSession(async (session) => {
		clockMs = 1_000;
		const store = await seededStore();
		const rec = recorder(store, () => Promise.resolve({}), [textEvents("resp_b3", "one"), textEvents("resp_b4", "two")]);
		const controller = createSessionController({ session, installationId: INSTALLATION, store, dependencies: rec.dependencies as never });
		await drain(controller.stream(MODEL, helloContext(), {}));
		assert.equal(rec.created.length, 1);

		appendStockCompaction(session);
		await drain(controller.stream(MODEL, helloContext(), {}));
		controller.release();
		assert.equal(rec.created.length, 2, "a fresh transport after the boundary");
		assert.equal(rec.created[0]!.disposed, true);
		assert.equal(rec.sse.calls.length, 2);
	});
});

it("[boundary] the active logical run keeps its turn: the fresh transport begins the same turn again", { timeout: 20_000 }, async () => {
	await withSession(async (session) => {
		clockMs = 1_000;
		const store = await seededStore();
		const rec = recorder(store, () => Promise.resolve({}), [textEvents("resp_b5", "one"), textEvents("resp_b6", "two")]);
		const controller = createSessionController({ session, installationId: INSTALLATION, store, dependencies: rec.dependencies as never });
		controller.policy.beginRun({ kind: "run" });
		await drain(controller.stream(MODEL, helloContext(), {}));
		const turn = controller.lineageSnapshot.turnId;
		assert.ok(turn);
		assert.deepEqual(rec.created[0]!.begun, [turn]);

		appendStockCompaction(session);
		controller.afterPiCompaction();
		assert.equal(controller.lineageSnapshot.turnId, turn, "the logical turn is preserved");
		await drain(controller.stream(MODEL, helloContext(), {}));
		controller.policy.endRun({ aborted: false });
		controller.release();
		assert.equal(rec.created.length, 2);
		assert.deepEqual(rec.created[1]!.begun, [turn], "the new transport begins the current turn");
	});
});
