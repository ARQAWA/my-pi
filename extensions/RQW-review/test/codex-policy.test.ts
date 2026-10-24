// The optional `rqw-codex:session-policy` request of RQW-review, in real Pi sessions: this test loads only RQW-review. A
// stand-in listener on the main session's `pi.events` plays the RQW-codex binder: it records each request, refuses it
// or sets `release`. The reviewer runs on the real openai-codex provider with fake credentials; only the network is replaced.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
	createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import { REVIEWER } from "../index.ts";
import { codexAuth, installCodexWire } from "./codex-wire.ts";

const EXTENSION = join(import.meta.dirname, "..", "index.ts");
let root: string;
let counter = 0;
const codex = installCodexWire();
const { wire } = codex;

before(async () => { root = await mkdtemp(join(tmpdir(), "rqw-review-policy-")); });
after(async () => { codex.restore(); await rm(root, { recursive: true, force: true }); });

/** The system text of a Codex request as the provider received it. */
const systemOf = (body: Record<string, any>): string => body.instructions;

const until = async (check: () => boolean, what: string) => {
	const deadline = Date.now() + 60_000;
	while (!check()) {
		assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
};

type Request = { session: AgentSession; parentThreadId: string; kind: string; installCompactionHooks?: (api: ExtensionAPI) => void; release?: () => void; error?: string };
type Seen = { request: Request; wireAtEmit: number; messagesAtEmit: number };
type Capture = { callerThreadId?: string; wireAtCapture: number };

/** A main session on a faux Claude-named model: the reviewer is Codex whatever the main model is; the binder stand-in is optional. */
async function open(binder: boolean) {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "auth.json"), JSON.stringify(codexAuth()));
	const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	await runtime.refresh({ allowNetwork: false });
	const main = fauxProvider({ provider: `policy-main-${counter}`, api: `policy-main-${counter}`, models: [{ id: "claude-main", reasoning: true }] });
	main.setResponses(Array.from({ length: 20 }, () => () => fauxAssistantMessage("main ok")));
	runtime.registerNativeProvider(main.provider);
	const seen: Seen[] = [];
	const policy = { error: undefined as string | undefined, hookError: undefined as string | undefined, releases: 0 };
	const hookInstalls: Array<{ session: AgentSession; wireAtInstall: number }> = [];
	const hookContexts: string[] = [];
	const captures: Capture[] = [];
	const binderStandIn = (pi: ExtensionAPI) => {
		pi.events.on("rqw-codex:session-policy", (raw) => {
			const request = raw as Request;
			seen.push({ request, wireAtEmit: wire.length, messagesAtEmit: request.session.messages.length });
			if (policy.error !== undefined) request.error = policy.error;
			request.installCompactionHooks = (api: ExtensionAPI) => {
				if (policy.hookError) throw new Error(policy.hookError);
				hookInstalls.push({ session: request.session, wireAtInstall: wire.length });
				api.on("before_agent_start", (_event, ctx) => { hookContexts.push(ctx.sessionManager.getSessionId()); });
			};
			request.release = () => { policy.releases++; };
			request.captureRun = (callerThreadId) => { captures.push({ callerThreadId, wireAtCapture: wire.length }); };
		});
	};
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [EXTENSION],
		extensionFactories: binder ? [binderStandIn] : [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: main.getModel("claude-main"), thinkingLevel: "off",
		resourceLoader: loader, sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" }) });
	await session.bindExtensions({ mode: "tui" });
	const review = async () => {
		const result = await session.getToolDefinition("review")!.execute("t", { level: "blind", object: "a.ts", criterion: "c" } as never,
			undefined, undefined, session.extensionRunner.createContext());
		return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
	};
	const verdicts = () => session.messages.flatMap((m) => (m.role === "custom" && m.customType === "review" && typeof m.content === "string" ? [m.content] : []));
	const close = async () => { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); };
	return { session, seen, policy, captures, hookInstalls, hookContexts, review, verdicts, close, mainId: () => session.sessionManager.getSessionId() };
}

describe("RQW-review: optional rqw-codex:session-policy request", () => {
	it("installs offered hooks on the real reviewer's API before its first prompt", async () => {
		wire.length = 0;
		const f = await open(true);
		try {
			await f.review();
			await until(() => f.verdicts().length === 1, "the verdict");
			assert.equal(f.hookInstalls.length, 1);
			const child = f.seen[0].request.session;
			assert.equal(f.hookInstalls[0].session, child);
			assert.equal(f.hookInstalls[0].wireAtInstall, 0);
			assert.deepEqual(f.hookContexts, [child.sessionId], "the registered callback belongs to the reviewer, not its parent");
			assert.equal(f.policy.releases, 1, "the existing policy release owns hook cleanup");
		} finally { await f.close(); }
	});

	it("releases the policy and fails the review before prompting if hook installation throws", async () => {
		wire.length = 0;
		const f = await open(true);
		try {
			f.policy.hookError = "hook installation failed";
			await f.review();
			await until(() => f.verdicts().length === 1, "the failed verdict");
			assert.match(f.verdicts()[0], /Session policy refused: hook installation failed/);
			assert.equal(f.policy.releases, 1);
			assert.equal(wire.length, 0);
		} finally { await f.close(); }
	});
	it("is emitted after the reviewer exists and before its prompt, with the caller's session id and kind review", async () => {
		wire.length = 0;
		const f = await open(true);
		try {
			await f.review();
			await until(() => f.verdicts().length === 1, "the verdict");
			assert.equal(f.seen.length, 1);
			const [{ request, wireAtEmit, messagesAtEmit }] = f.seen;
			assert.equal(request.kind, "review");
			assert.equal(request.startupSystemPrompt, systemOf(wire[0].body), "the startup prompt is exactly the reviewer's sent system text, cwd block included");
			assert.ok(request.startupSystemPrompt?.startsWith(REVIEWER), "the startup prompt starts with REVIEWER");
			assert.equal(request.parentThreadId, f.mainId(), "parent is the main session's id");
			assert.notEqual(request.session, f.session, "the request carries the reviewer, not the main session");
			assert.equal(wireAtEmit, 0, "no request reached the provider when the binder saw it");
			assert.equal(messagesAtEmit, 0, "no reviewer prompt had been recorded");
			assert.equal(wire.length, 1);
			assert.equal(wire[0].body.model, "gpt-6.1-sol");
			assert.ok(systemOf(wire[0].body).startsWith(REVIEWER), "the request starts with exactly the reviewer prompt");
			assert.match(f.verdicts()[0], /^\[review#1\] CLEAN\nCHECKED:\n- criterion \(source\) fulfilled \(object\)/);
			assert.equal(f.policy.releases, 1, "the reviewer's end releases it");
		} finally { await f.close(); }
	});

	it("without a listener the review reaches its verdict exactly as before", async () => {
		wire.length = 0;
		const f = await open(false);
		try {
			await f.review();
			await until(() => f.verdicts().length === 1, "the verdict");
			assert.match(f.verdicts()[0], /^\[review#1\] CLEAN\nCHECKED:\n- criterion \(source\) fulfilled \(object\)/);
			assert.equal(wire.length, 1);
		} finally { await f.close(); }
	});

	it("a refused request fails the review before any prompt, and releases the reviewer", async () => {
		wire.length = 0;
		const f = await open(true);
		try {
			f.policy.error = "codex refused\nsecond line";
			await f.review();
			await until(() => f.verdicts().length === 1, "the failed verdict");
			assert.match(f.verdicts()[0], /Review failed: Session policy refused: codex refused/);
			assert.doesNotMatch(f.verdicts()[0], /second line/);
			assert.equal(wire.length, 0, "no prompt reached the provider");
			assert.equal(f.policy.releases, 1);
		} finally { await f.close(); }
	});

	it("labels the reviewer review#N and captures its run origin from the caller before its prompt", async () => {
		wire.length = 0;
		const f = await open(true);
		try {
			await f.review();
			await until(() => f.verdicts().length === 1, "the verdict");
			assert.equal(f.seen[0].request.childName, "review#1");
			assert.deepEqual(f.captures.map((c) => c.callerThreadId), [f.mainId()]);
			assert.equal(f.captures[0].wireAtCapture, 0, "the capture precedes the reviewer's request");
			assert.equal(f.policy.releases, 1);
		} finally { await f.close(); }
	});
});
