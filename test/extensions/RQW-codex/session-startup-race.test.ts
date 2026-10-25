// Startup race of the session controller on a real Pi 1.4.0 AgentSession: the startup setup (owner, projection, startup
// workspace capture, metadata, prewarm scheduling) is held deterministically by a gate in the workspace collector, and the
// real CodexThreadTransport runs behind a recording wrapper. The fake SSE and refused WebSocket upgrade are the only network.
// Fake clock for the budget origin, real timers for the 15 s budget (cases run about 15 s each).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import * as zlib from "node:zlib";
import * as pi from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Context, type CredentialStore, type Model } from "@earendil-works/pi-ai";

import { createSessionController, type SessionTransport } from "../../../extensions/RQW-codex/session.ts";
import { CodexThreadTransport } from "../../../extensions/RQW-codex/transport.ts";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";

const root = mkdtempSync(join(tmpdir(), "rqw-codex-startup-race-"));
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
const BUDGET_MS = 15_000;
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

const bodyOf = (bytes: Uint8Array): Record<string, any> => JSON.parse(zlib.zstdDecompressSync(Buffer.from(bytes)).toString("utf8"));

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
 * Controller over the real transport, with a recording wrapper: `events` lists the order of the controller's calls into the
 * transport (update, prewarm, stream); `prewarms` keeps the options each prewarm received; `updates` keeps each metadata update.
 * The workspace collector is the test gate: `collect(call)` returns the capture of the n-th call (1-based).
 */
function recorder(store: CredentialStore, collect: (call: number) => Promise<Record<string, unknown>>, steps: unknown[][] = []) {
	const events: string[] = [];
	const prewarms: Record<string, any>[] = [];
	const updates: Record<string, any>[] = [];
	const sse = sseScript(steps);
	let calls = 0;
	const dependencies = {
		...timing,
		connect: upgradeRequired,
		postEvents: sse.fn,
		collectWorkspaceMetadata: (() => collect(++calls)) as never,
		transportFactory: (identity: any, storeArg: any, history: any): SessionTransport => {
			const real = new CodexThreadTransport({ identity, store: storeArg, history, dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
			return {
				stream: (model, context, options) => {
					events.push("stream");
					return real.stream(model, context, options);
				},
				prewarm(model, context, options) {
					events.push("prewarm");
					prewarms.push({ ...options });
					return real.prewarm(model, context, options);
				},
				beginTurn: (info) => real.beginTurn(info),
				endTurn: () => real.endTurn(),
				updateMetadata(update) {
					events.push("update");
					updates.push(structuredClone(update) as Record<string, any>);
					real.updateMetadata(update);
				},
				sendRaw: (args) => real.sendRaw(args),
				dispose: () => real.dispose(),
			};
		},
	};
	return { dependencies, events, prewarms, updates, sse, store, captures: () => calls };
}

const helloContext = (): Context => ({ systemPrompt: "SYSTEM", messages: [userMsg("hello") as never], tools: [] });

/** One logical run: begin, stream to the end, end. */
async function runOnce(controller: ReturnType<typeof createSessionController>, options: Record<string, unknown> = {}) {
	controller.policy.beginRun({ kind: "run" });
	try {
		for await (const _event of controller.stream(MODEL, helloContext(), options as never)) void _event;
	} finally {
		controller.policy.endRun({ aborted: false });
	}
}

it("[startup gate] the first normal stream waits for the held setup; the warm is scheduled once, before the one generation", { timeout: 20_000 }, async () => {
	await withSession(async (session) => {
		clockMs = 1_000;
		const store = await seededStore();
		const held = gate<Record<string, unknown>>();
		const rec = recorder(store, (call) => (call === 1 ? held.promise : Promise.resolve({})), [textEvents("resp_1", "ok")]);
		const controller = createSessionController({ session, installationId: INSTALLATION, store, dependencies: rec.dependencies as never });
		const started = controller.start();
		await waitFor(() => rec.captures() === 1, "the startup capture");
		const generation = runOnce(controller);
		await pause(200);
		assert.deepEqual(rec.events, [], "no transport call before the startup setup is scheduled");
		assert.equal(rec.sse.calls.length, 0, "no model request while the setup is held");

		held.open({ "startup-workspace": { latest_git_commit_hash: "a".repeat(40) } });
		await started;
		await generation;
		controller.release();

		assert.deepEqual(rec.events, ["update", "prewarm", "update", "stream"], "warm first, then one generation");
		assert.equal(rec.prewarms.length, 1, "one warm");
		assert.equal(rec.prewarms[0].prewarmStartedAt, 1_000, "the warm carries the setup origin, not a new one");
		assert.equal(rec.sse.calls.length, 1, "one generation");
		assert.equal(bodyOf(rec.sse.calls[0]!.body).generate, undefined, "the generation is a real turn");
	});
});

it("[startup gate] budget spent while the capture is held: the stream goes on with a fresh capture and no late warm", { timeout: 30_000 }, async () => {
	await withSession(async (session) => {
		clockMs = 1_000;
		const store = await seededStore();
		const held = gate<Record<string, unknown>>();
		const rec = recorder(store, (call) => (call === 1 ? held.promise : Promise.resolve({ [`call-${call}`]: { latest_git_commit_hash: "b".repeat(40) } })), [textEvents("resp_2", "ok")]);
		const controller = createSessionController({ session, installationId: INSTALLATION, store, dependencies: rec.dependencies as never });
		const started = controller.start();
		await waitFor(() => rec.captures() === 1, "the startup capture");
		const begun = Date.now();
		// No run: the stream takes its own fresh capture (call 2) once the setup budget is spent.
		for await (const _event of controller.stream(MODEL, helloContext(), {})) void _event;
		const waited = Date.now() - begun;
		assert.ok(waited >= BUDGET_MS - 50, `the stream waited the remaining budget (${waited} ms)`);
		assert.equal(rec.captures(), 2, "a fresh capture for the stream");
		assert.deepEqual(rec.events, ["update", "stream"], "no prewarm: the spent setup never warms");

		held.open({ "call-1": { latest_git_commit_hash: "c".repeat(40) } });
		await started;
		controller.release();

		assert.deepEqual(rec.events, ["update", "stream"], "the old setup launches no warm and no metadata update");
		assert.equal(rec.prewarms.length, 0);
		assert.equal(rec.updates.some((u) => JSON.stringify(u).includes("call-1")), false, "the old capture never reaches a request");
		assert.ok(rec.updates.at(-1)!.workspaces && "call-2" in (rec.updates.at(-1)!.workspaces as object), "the stream carries the fresh capture");
		assert.equal(rec.sse.calls.length, 1, "one generation, no extended deadline");
	});
});

it("[startup gate] caller abort while the capture is held settles the stream promptly; the late capture sends nothing", { timeout: 20_000 }, async () => {
	await withSession(async (session) => {
		clockMs = 1_000;
		const store = await seededStore();
		const held = gate<Record<string, unknown>>();
		const rec = recorder(store, (call) => (call === 1 ? held.promise : Promise.resolve({})));
		const controller = createSessionController({ session, installationId: INSTALLATION, store, dependencies: rec.dependencies as never });
		const started = controller.start();
		await waitFor(() => rec.captures() === 1, "the startup capture");
		const caller = new AbortController();
		const begun = Date.now();
		const stream = (async () => {
			for await (const _event of controller.stream(MODEL, helloContext(), { signal: caller.signal })) void _event;
		})();
		await pause(100);
		caller.abort();
		await stream.catch(() => undefined);
		assert.ok(Date.now() - begun < 3_000, "the aborted stream settles promptly");
		assert.equal(rec.sse.calls.length, 0, "no request was sent");
		assert.equal(rec.events.includes("stream"), false, "the transport never got the stream");

		held.open({});
		await started;
		controller.release();
		assert.equal(rec.sse.calls.length, 0, "the late capture sends no generation");
	});
});

it("[startup gate] release while the capture is held settles the waiting stream; the late setup updates nothing", { timeout: 20_000 }, async () => {
	await withSession(async (session) => {
		clockMs = 1_000;
		const store = await seededStore();
		const held = gate<Record<string, unknown>>();
		const rec = recorder(store, (call) => (call === 1 ? held.promise : Promise.resolve({})), [textEvents("resp_3", "ok")]);
		const controller = createSessionController({ session, installationId: INSTALLATION, store, dependencies: rec.dependencies as never });
		const started = controller.start();
		await waitFor(() => rec.captures() === 1, "the startup capture");
		const begun = Date.now();
		const stream = (async () => {
			for await (const _event of controller.stream(MODEL, helloContext(), {})) void _event;
		})();
		await pause(100);
		controller.release();
		await stream.catch(() => undefined);
		assert.ok(Date.now() - begun < 3_000, "the released stream settles promptly");

		held.open({});
		await started;
		assert.deepEqual(rec.events, [], "a released setup updates no metadata and warms nothing");
		assert.equal(rec.sse.calls.length, 0, "no request, no seed");
	});
});

it("[startup gate] no usable login: the setup fails quietly and a later start may still warm", { timeout: 20_000 }, async () => {
	await withSession(async (session) => {
		clockMs = 1_000;
		const store = new InMemoryCredentialStore();
		const rec = recorder(store, () => Promise.resolve({}));
		const controller = createSessionController({ session, installationId: INSTALLATION, store, dependencies: rec.dependencies as never });
		await controller.start();
		assert.deepEqual(rec.events, [], "no transport call without a login");
		await seed(store);
		await controller.start();
		await pause(50);
		controller.release();
		assert.deepEqual(rec.events, ["update", "prewarm"], "the eligible latch warms on the later start");
		assert.equal(rec.prewarms[0]!.prewarmStartedAt, 1_000);
	});
});
