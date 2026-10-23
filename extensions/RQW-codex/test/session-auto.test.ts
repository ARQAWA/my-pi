// Automatic and manual backend compaction through the real Pi 1.4.0 AgentSession: session.prompt, session.compact,
// session.abortCompaction, session.waitForIdle and the session subscription, with the owned facade (createCodexExtension ->
// registration -> session controller -> CodexThreadTransport -> compaction hook). Only this extension is loaded. The Codex
// backend is a fake postEvents (SSE); every request is recorded and a request beyond the scripted steps fails the test.
// Fake OAuth JWT, temporary agent directory, no network, no auth homes.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { describe, it } from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

import { installRuntimeAuth } from "../auth-runtime.ts";
import { createCodexExtension } from "../index.ts";
import { CODEX_PROVIDER } from "../profile.ts";
import { SocketError } from "../websocket.ts";

const ACCOUNT = "acct_session_auto_1";
const INSTALLATION = "11111111-2222-4333-8444-555555555555";
const CASE_TIMEOUT_MS = 15_000;
/** Explicit reserve (compaction.reserveTokens): the trigger is contextWindow - RESERVE, so the test does not depend on defaults. */
const RESERVE = 10_000;
const COMPACTION = { type: "compaction", encrypted_content: "ENC+/==raw" };

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeAccess(): string {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return `${b64url({ alg: "none" })}.${b64url({ exp, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;
}

const usageOf = (input: number) => ({ input_tokens: input, output_tokens: 1, total_tokens: input + 1, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } });
const created = (id: string) => ({ type: "response.created", response: { id } });
const completed = (id: string, input = 1) => ({ type: "response.completed", response: { id, status: "completed", usage: usageOf(input) } });

function textEvents(id: string, text: string, input = 1) {
	const item = `msg_${id}`;
	return [
		created(id),
		{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: item, role: "assistant", content: [], status: "in_progress" } },
		{ type: "response.output_text.delta", item_id: item, output_index: 0, content_index: 0, delta: text },
		{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: item, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
		completed(id, input),
	];
}

const compactionEvents = (id: string) => [
	created(id),
	{ type: "response.output_item.done", output_index: 0, item: COMPACTION },
	completed(id, 9),
];

/**
 * One scripted backend request. `events` are yielded in order; `fail` is thrown after them; `hold` keeps the request open
 * until its signal aborts (the abort rejects it like a real cancelled request).
 */
type Step = { events?: Array<Record<string, unknown>>; fail?: Error; hold?: boolean };
type Post = { url: string; body: Record<string, any> };
type Session = Awaited<ReturnType<typeof createAgentSession>>["session"];

async function waitFor(condition: () => boolean, label: string, ms = 10_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

async function withSession(steps: Step[], run: (ctx: { session: Session; posts: Post[]; events: Array<Record<string, any>>; agentDir: string }) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "rqw-codex-session-auto-"));
	try {
		const agentDir = join(root, "agent");
		await mkdir(agentDir, { recursive: true });
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const credential = { type: "oauth", access: fakeAccess(), refresh: "refresh-session-auto-1", expires: exp * 1000, accountId: ACCOUNT };
		const authPath = join(agentDir, "auth.json");
		await writeFile(authPath, JSON.stringify({ [CODEX_PROVIDER]: credential }));
		const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });

		const posts: Post[] = [];
		const events: Array<Record<string, any>> = [];
		const postEvents = (options: { url: string; headers: Record<string, string>; body: Uint8Array; signal?: AbortSignal; onResponse: (r: { status: number; headers: object }) => void }) => {
			const body = JSON.parse(zlib.zstdDecompressSync(Buffer.from(options.body)).toString("utf8")) as Record<string, any>;
			posts.push({ url: options.url, body });
			const step = steps[posts.length - 1];
			if (step === undefined) throw new Error(`unscripted backend request #${posts.length}`);
			return (async function* () {
				options.onResponse({ status: 200, headers: {} });
				if (step.hold) {
					await new Promise((_, reject) => {
						const abort = () => reject(Object.assign(new Error("Request was aborted"), { name: "AbortError" }));
						if (options.signal?.aborted) abort();
						else options.signal?.addEventListener("abort", abort, { once: true });
					});
				}
				for (const value of step.events ?? []) yield { text: JSON.stringify(value), value };
				if (step.fail) throw step.fail;
			})();
		};
		/** Refused WebSocket upgrade (426): the facade then uses SSE only. */
		const upgradeRefused = async (): Promise<never> => {
			throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
		};

		const loader = new DefaultResourceLoader({
			cwd: agentDir, agentDir, additionalExtensionPaths: [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: [createCodexExtension({
				installationId: INSTALLATION,
				dependencies: { connect: upgradeRefused as never, postEvents: postEvents as never, sleep: async () => undefined, clock: { now: () => Date.now() } },
			})],
		});
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert.equal(loader.getExtensions().extensions.length, 1, "exactly the RQW-codex extension is loaded");

		const release = installRuntimeAuth(runtime);
		try {
			const model = runtime.getModels(CODEX_PROVIDER)[0]!;
			const { session } = await createAgentSession({ cwd: agentDir, agentDir, modelRuntime: runtime, model, thinkingLevel: "off",
				resourceLoader: loader, sessionManager: SessionManager.inMemory(agentDir),
				settingsManager: SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: RESERVE }, retry: { enabled: false }, transport: "sse" }) });
			await session.bindExtensions({ mode: "tui" });
			await session.setModel(model);
			const unsubscribe = session.subscribe((event) => { events.push(event as Record<string, any>); });
			try {
				await run({ session, posts, events, agentDir });
			} finally {
				unsubscribe();
				session.dispose();
			}
		} finally {
			release();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

/** Model context window of the real Codex model record (the trigger is contextWindow - RESERVE). */
async function windowOf(session: Session): Promise<number> {
	const window = session.model?.contextWindow;
	assert.equal(typeof window, "number");
	return window as number;
}

describe("automatic and manual backend compaction through the real AgentSession", () => {
	it("first generation above contextWindow - reserve triggers one backend compaction; the next generation carries the opaque checkpoint once", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{ events: [] },
			{ events: compactionEvents("resp_auto_compact") },
			{ events: textEvents("resp_auto_2", "Second answer.") },
		];
		await withSession(steps, async ({ session, posts, events }) => {
			const window = await windowOf(session);
			// The first generation reports usage above the trigger (physical usage, reported by the backend).
			steps[0] = { events: textEvents("resp_auto_1", "First answer.", window - RESERVE + 1) };

			await session.prompt("first");
			await waitFor(() => posts.length === 2 && !session.isCompacting, "one compaction request");

			assert.equal(posts.length, 2, "exactly one backend compaction after the first generation");
			const trigger = posts[1]!.body.input as Array<Record<string, unknown>>;
			assert.deepEqual(trigger[trigger.length - 1], { type: "compaction_trigger" });
			assert.deepEqual(events.filter((e) => e.type === "compaction_start").map((e) => e.reason), ["threshold"]);
			assert.deepEqual(events.filter((e) => e.type === "compaction_end").map((e) => [e.reason, e.aborted, e.willRetry]), [["threshold", false, false]]);
			assert.equal(session.messages.some((m) => (m as { role?: string }).role === "compactionSummary"), false, "no Pi text summary entry");

			await session.prompt("second");
			assert.equal(posts.length, 3, "the next generation is a normal request, not a second compaction");
			const next = posts[2]!.body.input as Array<Record<string, any>>;
			assert.equal(next.filter((item) => item.type === "compaction").length, 1, "the opaque checkpoint appears exactly once");
			assert.equal(next.find((item) => item.type === "compaction")?.encrypted_content, "ENC+/==raw");
			const prefix = JSON.stringify(posts[0]!.body.input[0]);
			assert.equal(next.filter((item) => JSON.stringify(item) === prefix).length, 1, "the fresh prefix is sent once, not repeated");
			assert.equal(next.some((item) => item.type === "compaction_trigger"), false);

			assert.equal(events.filter((e) => e.type === "compaction_start").length, 1, "no repeat compaction from the physical usage of the old generation");
		});
	});

	it("manual compact held at the backend, then aborted: nothing installed, no query after the cancel, idle and events as Pi 1.4", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{ events: textEvents("resp_manual_1", "Before compaction.") },
			{ hold: true },
		];
		await withSession(steps, async ({ session, posts, events }) => {
			await session.prompt("first");
			const compacting = session.compact();
			const rejected = assert.rejects(compacting);
			await waitFor(() => posts.length === 2, "held compaction request");
			session.abortCompaction();
			await rejected;
			await session.waitForIdle();

			const queriesAtCancel = posts.length;
			await new Promise((resolve) => setTimeout(resolve, 200));
			assert.equal(posts.length, queriesAtCancel, "no backend query after the cancel");
			assert.equal(session.isCompacting, false);
			assert.equal(session.isStreaming, false);
			assert.equal(session.sessionManager.getBranch().some((e) => e.type === "compaction"), false, "no Pi compaction entry");
			assert.equal(session.sessionManager.getBranch().some((e) => e.type === "custom" && e.customType === "rqw-codex/wire-history" && (e.data as { kind?: string }).kind === "checkpoint"), false, "no checkpoint entry");
			const ends = events.filter((e) => e.type === "compaction_end");
			assert.deepEqual(ends.map((e) => [e.reason, e.aborted, e.willRetry, e.errorMessage]), [["manual", true, false, undefined]]);
			assert.deepEqual(events.filter((e) => e.type === "compaction_start").map((e) => e.reason), ["manual"]);
		});
	});

	it("automatic compaction held at the backend, then aborted: prompt settles, nothing installed, no query after the cancel", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [{ events: [] }, { hold: true }];
		await withSession(steps, async ({ session, posts, events }) => {
			const window = await windowOf(session);
			steps[0] = { events: textEvents("resp_auto_abort_1", "Above the trigger.", window - RESERVE + 1) };
			const prompting = session.prompt("first");
			await waitFor(() => posts.length === 2, "held automatic compaction request");
			session.abortCompaction();
			await prompting;
			await session.waitForIdle();

			const queriesAtCancel = posts.length;
			await new Promise((resolve) => setTimeout(resolve, 200));
			assert.equal(posts.length, queriesAtCancel, "no backend query after the cancel");
			assert.equal(session.isCompacting, false);
			assert.equal(session.sessionManager.getBranch().some((e) => e.type === "compaction"), false);
			assert.equal(session.sessionManager.getBranch().some((e) => e.type === "custom" && e.customType === "rqw-codex/wire-history" && (e.data as { kind?: string }).kind === "checkpoint"), false, "no checkpoint entry");
			const ends = events.filter((e) => e.type === "compaction_end");
			assert.deepEqual(ends.map((e) => [e.reason, e.aborted, e.willRetry, e.errorMessage]), [["threshold", true, false, undefined]]);
			const last = session.messages[session.messages.length - 1] as { role: string; stopReason?: string };
			assert.equal(last.role, "assistant");
			assert.equal(last.stopReason, "stop", "the completed generation is kept");
		});
	});

	it("typed context_length_exceeded goes through Pi's overflow branch, one backend compaction, then one retry with the opaque checkpoint and no Pi text summary", { timeout: CASE_TIMEOUT_MS }, async () => {
		const overflow = {
			type: "response.failed",
			response: { id: "resp_overflow_1", status: "failed", error: { type: "invalid_request_error", code: "context_length_exceeded", message: "Your input exceeds the context window of this model." } },
		};
		const steps: Step[] = [
			{ events: [created("resp_overflow_1"), overflow] },
			{ events: compactionEvents("resp_overflow_compact") },
			{ events: textEvents("resp_overflow_2", "Recovered answer.") },
		];
		await withSession(steps, async ({ session, posts, events }) => {
			await session.prompt("first");
			assert.equal(posts.length, 3, "failed generation, one compaction, one retry");
			const retry = posts[2]!.body.input as Array<Record<string, any>>;
			assert.equal(retry.filter((item) => item.type === "compaction").length, 1, "the retry carries the opaque checkpoint once");
			assert.equal(retry.some((item) => item.type === "compaction_trigger"), false);
			assert.deepEqual(events.filter((e) => e.type === "compaction_start").map((e) => e.reason), ["overflow"]);
			assert.deepEqual(events.filter((e) => e.type === "compaction_end").map((e) => [e.reason, e.aborted, e.willRetry]), [["overflow", false, true]]);
			assert.equal(session.messages.some((m) => (m as { role?: string }).role === "compactionSummary"), false, "no Pi text summary entry");
			const last = session.messages[session.messages.length - 1] as { role: string; stopReason?: string; content: Array<{ type: string; text?: string }> };
			assert.equal(last.stopReason, "stop");
			assert.equal(last.content.find((c) => c.type === "text")?.text, "Recovered answer.");
		});
	});
});
