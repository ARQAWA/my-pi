// Explicit idle history prewarm of the session controller on a real Pi 1.4.0 AgentSession: the real CodexThreadTransport runs
// behind a recording wrapper. The WebSocket upgrade is refused (426) and no SSE request is made by a prewarm, so the only
// network is the refused upgrade. Real timers only for the 15 s budget (no case waits for it).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import * as pi from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type CredentialStore, type Model } from "@earendil-works/pi-ai";

import { createSessionController, type SessionTransport } from "../session.ts";
import { CodexThreadTransport } from "../transport.ts";
import { SocketError } from "../websocket.ts";

const root = mkdtempSync(join(tmpdir(), "rqw-codex-idle-prewarm-"));
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

const ACCOUNT = "acct-idle-prewarm-1";
const INSTALLATION = "33333333-4444-4555-8666-888888888888";
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function seededStore(): Promise<InMemoryCredentialStore> {
	const store = new InMemoryCredentialStore();
	const exp = Math.floor(Date.now() / 1000) + 3600;
	const access = `${b64url({ alg: "none" })}.${b64url({ exp, tag: "a", "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;
	await store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "refresh-idle-prewarm", expires: exp * 1000, accountId: ACCOUNT }) as never);
	return store;
}

/** Git workspace with one commit and no changes. */
function gitWorkspace(): string {
	const dir = scratch("repo");
	const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "-c", "user.name=rqw", "-c", "user.email=rqw@example.invalid", ...args], { stdio: "ignore" });
	git("init", "-q");
	git("commit", "--allow-empty", "-q", "-m", "init");
	return dir;
}

/** Every WebSocket attempt is refused with 426: the prewarm fails quietly. */
const upgradeRequired = async (): Promise<never> => {
	throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
};

let clockMs = 1_000_000;
const timing = { clock: { now: () => clockMs }, random: () => 0.5, sleep: async () => {} };

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

/** Controller over the real transport with a recording wrapper: `events` lists the transport calls, `prewarms` their options. */
function recorder(collect: () => Promise<Record<string, unknown>>) {
	const events: string[] = [];
	const prewarms: Record<string, any>[] = [];
	let collects = 0;
	const dependencies = {
		...timing,
		connect: upgradeRequired,
		collectWorkspaceMetadata: (() => {
			collects++;
			return collect();
		}) as never,
		transportFactory: (identity: any, storeArg: any, history: any): SessionTransport => {
			const real = new CodexThreadTransport({ identity, store: storeArg, history, dependencies: { ...timing, connect: upgradeRequired } });
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
				updateMetadata: (update) => {
					events.push("update");
					real.updateMetadata(update);
				},
				sendRaw: (args) => real.sendRaw(args),
				dispose: () => real.dispose(),
			};
		},
	};
	return { dependencies, events, prewarms, collects: () => collects };
}

it("[idle prewarm] a busy session is refused at invocation: no workspace capture, no transport call", { timeout: 15000 }, async () => {
	await withSession(async (session) => {
		const store = await seededStore();
		const rec = recorder(async () => ({}));
		const controller = createSessionController({ session, installationId: INSTALLATION, store: store as CredentialStore, dependencies: rec.dependencies });
		controller.policy.beginRun({ kind: "run" });
		try {
			// The run's own capture starts on a microtask: let it settle before the baseline is read.
			await new Promise((resolve) => setImmediate(resolve));
			const collectsBefore = rec.collects();
			const eventsBefore = rec.events.length;
			await controller.prewarmWithHistory();
			assert.equal(rec.collects(), collectsBefore, "no capture while busy");
			assert.equal(rec.events.length, eventsBefore, "no transport call while busy");
			assert.equal(rec.prewarms.length, 0);
		} finally {
			controller.policy.endRun({ aborted: false });
			controller.release();
		}
	});
});

it("[idle prewarm] concurrent calls coalesce into ONE setup and ONE history prewarm, carrying the setup origin", { timeout: 15000 }, async () => {
	await withSession(async (session) => {
		const store = await seededStore();
		const rec = recorder(async () => ({}));
		const controller = createSessionController({ session, installationId: INSTALLATION, store: store as CredentialStore, dependencies: rec.dependencies });
		try {
			const first = controller.prewarmWithHistory();
			const second = controller.prewarmWithHistory();
			assert.equal(first, second, "the same in-flight setup promise is shared");
			await Promise.all([first, second]);
			assert.equal(rec.collects(), 1, "one workspace capture");
			assert.deepEqual(rec.events.filter((e) => e === "prewarm"), ["prewarm"], "one prewarm");
			assert.equal(rec.prewarms[0]!.prewarmInput, "history", "the idle pass carries the history");
			assert.equal(typeof rec.prewarms[0]!.prewarmStartedAt, "number", "its own setup origin");
			assert.equal(rec.prewarms[0]!.signal?.aborted, false);
		} finally {
			controller.release();
		}
	});
});

it("[idle prewarm] a pending startup setup is joined, not duplicated", { timeout: 15000 }, async () => {
	await withSession(async (session) => {
		const store = await seededStore();
		const rec = recorder(async () => ({}));
		const controller = createSessionController({ session, installationId: INSTALLATION, store: store as CredentialStore, dependencies: rec.dependencies });
		try {
			const startup = controller.start();
			assert.equal(controller.prewarmWithHistory(), startup, "the idle call joins the startup setup");
			await startup;
			assert.equal(rec.collects(), 1, "one workspace capture for the joined setup");
		} finally {
			controller.release();
		}
	});
});

it("[idle prewarm] after release a new call is a no-op: no capture, no transport call", { timeout: 15000 }, async () => {
	await withSession(async (session) => {
		const store = await seededStore();
		const rec = recorder(async () => ({}));
		const controller = createSessionController({ session, installationId: INSTALLATION, store: store as CredentialStore, dependencies: rec.dependencies });
		controller.release();
		await controller.prewarmWithHistory();
		assert.equal(rec.collects(), 0);
		assert.equal(rec.events.length, 0);
	});
});
