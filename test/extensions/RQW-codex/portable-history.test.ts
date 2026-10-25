// Real Pi 1.4.0 SDK, file-backed SessionManager and stock AgentSession; only a synthetic provider and OS temp homes.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createAssistantMessageEventStream, createProvider, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import * as pi from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

import { installPortableHistory } from "../../../extensions/RQW-codex/portable-history.ts";

const TIMEOUT = 15_000;
const PROVIDER = "openai-codex";
const API = "openai-codex-responses";
const NO_RESOURCES = { noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, noExtensions: true };
const WINDOW = 20_000;
const SETTINGS = { retry: { enabled: false }, compaction: { enabled: true, reserveTokens: 1_000, keepRecentTokens: 0 } };
let root: string;
let counter = 0;

before(async () => { root = await mkdtemp(join(tmpdir(), "rqw-codex-portable-usage-")); });
after(async () => { await rm(root, { recursive: true, force: true }); });

type Reply = { input: number; output?: number; stopReason?: "stop" | "error" | "aborted"; provider?: string; api?: string; zero?: boolean };
type Fake = { next: Reply[]; requests: number; models: Model<string>[] };

function usageOf(reply: Reply) {
	if (reply.zero) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const input = reply.input, output = reply.output ?? 10;
	return { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

async function runtimeWith(fake: Fake) {
	const dir = join(root, `home-${counter++}`);
	await mkdir(dir);
	const reply = (model: Model<string>) => {
		fake.requests++;
		const spec = fake.next.shift() ?? { input: 100 };
		const message: AssistantMessage = {
			role: "assistant", content: [{ type: "text", text: "ok" }],
			api: spec.api ?? model.api, provider: spec.provider ?? model.provider, model: model.id,
			usage: usageOf(spec), stopReason: spec.stopReason ?? "stop", timestamp: Date.now(),
		} as AssistantMessage;
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "stop", message } as never); stream.end(message); });
		return stream;
	};
	const runtime = await pi.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	runtime.registerNativeProvider(createProvider({
		id: PROVIDER, auth: { apiKey: { name: "Fake", resolve: async () => ({ auth: { apiKey: "synthetic-only" } }) } },
		models: [{ id: "fake-codex", name: "fake-codex", provider: PROVIDER, api: API, baseUrl: "http://127.0.0.1:0",
			reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: WINDOW, maxTokens: 4_000 }],
		api: { stream: reply, streamSimple: reply },
	} as Parameters<typeof createProvider>[0]));
	await runtime.refresh({ allowNetwork: false });
	return { dir, runtime, model: runtime.getModel(PROVIDER, "fake-codex")! };
}

const text = (n: number) => `${n}`.padEnd(800, "x");

/** Seeds a real session file: 20 user/assistant pairs of owned Codex turns; the last assistant has the given usage. */
async function seed(dir: string, lastInput: number) {
	const manager = pi.SessionManager.create(dir, join(dir, "sessions"));
	const stamp = Date.now();
	for (let i = 0; i < 20; i++) {
		manager.appendMessage({ role: "user", content: [{ type: "text", text: text(i) }], timestamp: stamp + i } as never);
		const last = i === 19;
		manager.appendMessage({ role: "assistant", content: [{ type: "text", text: text(i) }], api: API, provider: PROVIDER, model: "fake-codex",
			usage: usageOf({ input: last ? lastInput : 100 }), stopReason: "stop", timestamp: stamp + i + 0.5 } as never);
	}
	return manager.getSessionFile()!;
}

async function openSession(dir: string, file: string, model: Model<string>, runtime: pi.ModelRuntime, settings = SETTINGS) {
	const { session } = await pi.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model, thinkingLevel: "off",
		resourceLoader: new pi.DefaultResourceLoader({ cwd: dir, agentDir: dir, ...NO_RESOURCES }),
		sessionManager: pi.SessionManager.open(file, join(dir, "sessions")),
		settingsManager: pi.SettingsManager.inMemory(settings) });
	return session;
}

const contextEdits = (session: AgentSession) => session.sessionManager.getEntries().filter((entry) => entry.type === "context_edit");
const usageTokens = (session: AgentSession) => session.getContextUsage()?.tokens ?? null;
const snapshot = (session: AgentSession) => JSON.stringify(session.sessionManager.buildSessionProjection().messages);
const compactions = (session: AgentSession) => session.sessionManager.getEntries().filter((entry) => entry.type === "compaction").length;

it("stock trusts the native usage; invalidate adds one identical-content edit and changes nothing else", { timeout: TIMEOUT }, async () => {
	const fake: Fake = { next: [], requests: 0, models: [] };
	const { dir, runtime, model } = await runtimeWith(fake);
	const file = await seed(dir, 100);
	const session = await openSession(dir, file, model, runtime);
	const before = await readFile(file, "utf8");
	assert.ok(usageTokens(session)! < 1_000, "stock underestimates before the guard");
	const projected = snapshot(session);
	const entriesBefore = session.sessionManager.getEntries().length;
	const requests = fake.requests;

	const guard = installPortableHistory(session, { hasNativeCheckpoint: () => true });
	assert.equal(guard.invalidate(), true);
	assert.equal(snapshot(session), projected, "projected messages unchanged");
	assert.ok(usageTokens(session)! > 5_000, "stock now counts the full originals");
	assert.equal(session.sessionManager.getEntries().length, entriesBefore + 1);
	assert.equal(contextEdits(session).length, 1);
	assert.equal(compactions(session), 0);
	assert.equal(fake.requests, requests, "no model query");
	const appended = (await readFile(file, "utf8")).slice(before.length).trim().split("\n");
	assert.equal(appended.length, 1);
	assert.equal(JSON.parse(appended[0]!).type, "context_edit");
	assert.equal(await readFile(file, "utf8").then((text) => text.startsWith(before)), true, "existing lines untouched");

	assert.equal(guard.invalidate(), false, "no double mark");
	guard.release();
	guard.release();
	assert.equal(guard.invalidate(), false);
	assert.equal(contextEdits(session).length, 1);
	session.dispose();
});

it("a native reply after the checkpoint is invalidated once per persisted turn; errors, aborts and zero usage are ignored", { timeout: TIMEOUT }, async () => {
	const fake: Fake = { next: [], requests: 0, models: [] };
	const { dir, runtime, model } = await runtimeWith(fake);
	const file = await seed(dir, 100);
	const session = await openSession(dir, file, model, runtime);
	const guard = installPortableHistory(session, { hasNativeCheckpoint: () => true });

	fake.next = [{ input: 120 }];
	await session.prompt("first");
	await session.waitForIdle();
	assert.equal(contextEdits(session).length, 1, "one mark for the valid reply");

	fake.next = [{ input: 0, zero: true }, { input: 50, stopReason: "error" }, { input: 50, stopReason: "aborted" }];
	for (const _ of [0, 1, 2]) { await session.prompt("noise"); await session.waitForIdle(); }
	assert.equal(contextEdits(session).length, 1, "error, aborted and zero usage get no mark");

	fake.next = [{ input: 130, provider: "anthropic", api: "anthropic-messages" }];
	await session.prompt("foreign");
	await session.waitForIdle();
	assert.equal(contextEdits(session).length, 1, "foreign provider untouched");

	fake.next = [{ input: 140 }];
	await session.prompt("second");
	await session.waitForIdle();
	assert.equal(contextEdits(session).length, 2, "second valid native reply gets its own mark");
	guard.release();
	session.dispose();
});

it("reopened stock without the guard keeps the edit: compacts only when the physical history requires it", { timeout: TIMEOUT }, async () => {
	const fake: Fake = { next: [], requests: 0, models: [] };
	const { dir, runtime, model } = await runtimeWith(fake);
	const file = await seed(dir, 100);
	const first = await openSession(dir, file, model, runtime);
	const guard = installPortableHistory(first, { hasNativeCheckpoint: () => true });
	assert.equal(guard.invalidate(), true);
	guard.release();
	first.dispose();

	const small = await openSession(dir, file, model, runtime);
	fake.next = [{ input: 200 }];
	await small.prompt("fits");
	await small.waitForIdle();
	assert.equal(compactions(small), 0, "originals fit: no Pi compaction");
	assert.equal(fake.requests, 1, "only the ordinary generation");
	small.dispose();

	const large = await openSession(dir, file, model, runtime);
	fake.next = [{ input: WINDOW - 500 }, { input: 10 }];
	await large.prompt("does not fit");
	await large.waitForIdle();
	assert.equal(compactions(large), 1, "physical history over the threshold: one Pi compaction");
	assert.equal(fake.requests, 4, "ordinary generation, Pi's history summary and Pi's turn-prefix summary (stock split-turn compaction)");
	large.dispose();
});
