// Model downshift through the real Pi 1.4.0 AgentSession: session.prompt on a registered RQW-codex extension (the owned facade ->
// registration -> session controller -> CodexThreadTransport -> compaction hook), a fake auth store and a fake Codex backend (SSE).
// The previous model is a known pinned slug with a larger window; the current model has a smaller window, so the preflight
// threshold of the current model triggers. Stock Pi summarizes with the current model and has no previous-model fallback.
// Only this extension is loaded. Every backend request is recorded; a request beyond the scripted steps fails the test.
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

const ACCOUNT = "acct_session_downshift_1";
const INSTALLATION = "11111111-2222-4333-8444-555555555555";
const CASE_TIMEOUT_MS = 15_000;
/** Explicit reserve: the trigger of a model with window W is W - RESERVE. */
const RESERVE = 10_000;
const OLD_SLUG = "gpt-6.1-sol";
const CURRENT_SLUG = "gpt-6-luna";
const OLD_WINDOW = 100_000;
const CURRENT_WINDOW = 50_000;
const SUMMARY = "STOCK_PI_SUMMARY: preserve the task and continue.";
const OLD_HISTORY = `COMPACTED_HISTORY_ONLY: ${"old detail ".repeat(100)}`;

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

const compactionEvents = (id: string) => textEvents(id, SUMMARY, 9);

/** Non-retryable invalid-request responses must not start a second summary request. */
const failedEvents = (id: string, code: string) => [
	created(id),
	{ type: "response.failed", response: { id, status: "failed", error: { type: "invalid_request_error", code, message: code } } },
];

/** A terminal incomplete response (max output): never falls back. */
const incompleteEvents = (id: string) => [created(id), { type: "response.incomplete", response: { id, status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } }];

/** One scripted backend request. `events` are yielded in order; `fail` is thrown after them. */
type Step = { events?: Array<Record<string, unknown>>; fail?: Error };
type Post = { url: string; body: Record<string, any>; headers: Record<string, string> };
type Session = Awaited<ReturnType<typeof createAgentSession>>["session"];

/** The compaction block of a request, from the body metadata (the header carries the same block). */
function compactionBlockOf(post: Post): Record<string, any> | undefined {
	return JSON.parse(post.body.client_metadata["x-codex-turn-metadata"] as string).compaction;
}

async function withSession(steps: Step[], run: (ctx: { session: Session; posts: Post[]; events: Array<Record<string, any>>; runtime: ModelRuntime }) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "rqw-codex-session-downshift-"));
	try {
		const agentDir = join(root, "agent");
		await mkdir(agentDir, { recursive: true });
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const credential = { type: "oauth", access: fakeAccess(), refresh: "refresh-session-downshift-1", expires: exp * 1000, accountId: ACCOUNT };
		const authPath = join(agentDir, "auth.json");
		await writeFile(authPath, JSON.stringify({ [CODEX_PROVIDER]: credential }));
		const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });

		const posts: Post[] = [];
		const events: Array<Record<string, any>> = [];
		const postEvents = (options: { url: string; headers: Record<string, string>; body: Uint8Array; signal?: AbortSignal; onResponse: (r: { status: number; headers: object }) => void }) => {
			const body = JSON.parse(zlib.zstdDecompressSync(Buffer.from(options.body)).toString("utf8")) as Record<string, any>;
			posts.push({ url: options.url, body, headers: options.headers });
			const step = steps[posts.length - 1];
			if (step === undefined) throw new Error(`unscripted backend request #${posts.length}`);
			return (async function* () {
				options.onResponse({ status: 200, headers: {} });
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
				installationId: INSTALLATION, agentDir,
				dependencies: { connect: upgradeRefused as never, postEvents: postEvents as never, fetch: async () => { throw new Error("real network forbidden"); }, sleep: async () => undefined, clock: { now: () => Date.now() } },
			})],
		});
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert.equal(loader.getExtensions().extensions.length, 1, "exactly the RQW-codex extension is loaded");

		const release = installRuntimeAuth(runtime);
		try {
			const models = runtime.getModels(CODEX_PROVIDER);
			const pick = (id: string, window: number) => {
				const model = models.find((m) => m.id === id);
				assert.ok(model, `model ${id} is listed`);
				return { ...model!, contextWindow: window };
			};
			const oldModel = pick(OLD_SLUG, OLD_WINDOW);
			const manager = SessionManager.inMemory(agentDir);
			manager.appendMessage({ role: "user", content: OLD_HISTORY, timestamp: 1 });
			manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Earlier progress." }], api: oldModel.api, provider: CODEX_PROVIDER, model: oldModel.id, stopReason: "stop", timestamp: 2,
				usage: { input: 9, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
			const { session } = await createAgentSession({ cwd: agentDir, agentDir, modelRuntime: runtime, model: oldModel as never, thinkingLevel: "off",
				resourceLoader: loader, sessionManager: manager,
				settingsManager: SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: RESERVE, keepRecentTokens: 100 }, retry: { enabled: false }, transport: "sse" }) });
			await session.bindExtensions({ mode: "tui" });
			await session.setModel(oldModel as never);
			const unsubscribe = session.subscribe((event) => { events.push(event as Record<string, any>); });
			try {
				await run({ session, posts, events, runtime });
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

/** The current (smaller) model: same pinned slug family, the window of the test. */
function currentOf(runtime: ModelRuntime) {
	const model = runtime.getModels(CODEX_PROVIDER).find((m) => m.id === CURRENT_SLUG);
	assert.ok(model, `model ${CURRENT_SLUG} is listed`);
	return { ...model!, contextWindow: CURRENT_WINDOW };
}

/** Generation 1 on the previous model: usage 60000 is below its trigger (90000), so no compaction runs. */
const FIRST_GENERATION = textEvents("resp_first", "First answer.", 60_000);

function assertStockRequest(post: Post, effort?: string) {
	assert.equal(post.body.model, CURRENT_SLUG, "stock Pi summarizes with the selected smaller model");
	assert.equal(post.body.previous_response_id, undefined);
	assert.equal(post.body.input.some((item: { type?: string }) => item.type === "compaction_trigger" || item.type === "compaction"), false);
	assert.match(JSON.stringify(post.body.input), /<conversation>/);
	assert.match(JSON.stringify(post.body.input), /Create a structured context checkpoint summary/);
	assert.ok(JSON.stringify(post.body.input).includes(OLD_HISTORY));
	assert.equal(compactionBlockOf(post), undefined, "no native compaction metadata");
	assert.equal(JSON.parse(post.headers["x-codex-turn-metadata"] ?? "{}").compaction, undefined);
	if (effort !== undefined) assert.equal(post.body.reasoning.effort, effort);
}

function assertNoInstallation(session: Session, posts: Post[], events: Array<Record<string, any>>, error: RegExp) {
	assert.equal(posts.length, 3, "first generation, one failed summary, current generation; no model fallback");
	assertStockRequest(posts[1]!);
	assert.equal(posts[2]!.body.model, CURRENT_SLUG);
	assert.equal(posts[2]!.body.input.some((item: { type?: string }) => item.type === "compaction_trigger" || item.type === "compaction"), false);
	assert.ok(JSON.stringify(posts[2]!.body.input).includes(OLD_HISTORY), "failure preserves the original context");
	assert.deepEqual(events.filter((e) => e.type === "compaction_start").map((e) => e.reason), ["threshold"]);
	const ends = events.filter((e) => e.type === "compaction_end");
	assert.equal(ends.length, 1);
	assert.equal(session.sessionManager.getBranch().some((e) => e.type === "compaction"), false);
	assert.equal(session.sessionManager.getBranch().some((e) => e.type === "custom" && e.customType === "rqw-codex/wire-history" && (e.data as { kind?: string })?.kind === "checkpoint"), false);
	assert.equal(session.messages.some((message) => message.role === "compactionSummary"), false);
	assert.equal(session.isCompacting, false);
	assert.deepEqual([ends[0]!.reason, ends[0]!.aborted, ends[0]!.willRetry, ends[0]!.result], ["threshold", false, false, undefined]);
	assert.match(ends[0]!.errorMessage, error);
}

describe("model downshift through the real AgentSession", () => {
	it("pre-turn current-model threshold after a larger model uses one current-model summary, then generates from Pi's summary", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [{ events: FIRST_GENERATION }, { events: compactionEvents("resp_downshift_compact") }, { events: textEvents("resp_current_2", "Second answer.") }];
		await withSession(steps, async ({ session, posts, events, runtime }) => {
			await session.prompt("first");
			assert.equal(posts.length, 1, "usage is below the previous model's threshold");
			await session.setModel(currentOf(runtime) as never);
			session.setThinkingLevel("high");
			await session.prompt("second");
			await session.waitForIdle();
			assert.equal(posts.length, 3, "generation, one summary, current generation");
			assert.equal(posts[0]!.body.model, OLD_SLUG);
			assertStockRequest(posts[1]!, "high");
			assert.equal(posts[2]!.body.model, CURRENT_SLUG);
			assert.deepEqual(events.filter((e) => e.type === "compaction_start").map((e) => e.reason), ["threshold"]);
			assert.deepEqual(events.filter((e) => e.type === "compaction_end").map((e) => [e.reason, e.aborted, e.willRetry]), [["threshold", false, false]]);
			const entries = session.sessionManager.getBranch();
			const compactions = entries.filter((e) => e.type === "compaction");
			assert.equal(compactions.length, 1);
			assert.equal(compactions[0]!.summary, SUMMARY);
			const kept = entries.find((e) => e.type === "message" && e.message.role === "user" && JSON.stringify(e.message.content) === JSON.stringify([{ type: "text", text: "first" }]))!;
			assert.equal(compactions[0]!.firstKeptEntryId, kept.id);
			assert.equal(compactions[0]!.tokensBefore, 60_001, "pre-run compaction precedes appending the new user message");
			assert.equal(events.find((e) => e.type === "compaction_end")!.result.tokensBefore, compactions[0]!.tokensBefore);
			assert.equal(session.messages.filter((m) => m.role === "compactionSummary").length, 1);
			assert.equal(session.messages.find((m) => m.role === "compactionSummary")?.summary, SUMMARY);
			assert.equal(posts[2]!.body.previous_response_id, undefined, "new transport starts with full summarized input");
			assert.ok(JSON.stringify(posts[2]!.body.input).includes(SUMMARY));
			assert.equal(JSON.stringify(posts[2]!.body.input).includes(OLD_HISTORY), false);
			assert.equal(JSON.stringify(posts[2]!.body.input).includes("First answer."), true, "the recent kept turn stays alongside the summary");
			assert.equal(posts[2]!.body.input.some((item: { type?: string }) => item.type === "compaction" || item.type === "compaction_trigger"), false);
			assert.equal(entries.some((e) => e.type === "custom" && (e.data as { kind?: string } | undefined)?.kind === "checkpoint"), false);
			for (const name of ["compact", "_runAutoCompaction", "_checkCompaction", "_exceedsCompactionThreshold", "_compactBeforeNextAssistantResponse", "getContextUsage"]) {
				assert.equal(Object.hasOwn(session, name), false, name + " remains inherited from Pi");
			}
		});
	});

	it("non-retryable current-model summary failure is reported once without a previous-model fallback", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [{ events: FIRST_GENERATION }, { events: failedEvents("resp_summary_fail", "invalid_prompt") }, { events: textEvents("resp_current_2", "Second answer.") }];
		await withSession(steps, async ({ session, posts, events, runtime }) => {
			await session.prompt("first");
			await session.setModel(currentOf(runtime) as never);
			session.setThinkingLevel("high");
			await session.prompt("second");
			await session.waitForIdle();
			assertStockRequest(posts[1]!, "high");
			assertNoInstallation(session, posts, events, /Invalid request\./);
		});
	});

	it("policy failure never tries another model and installs neither a summary nor a checkpoint", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [{ events: FIRST_GENERATION }, { events: failedEvents("resp_summary_policy", "cyber_policy") }, { events: textEvents("resp_current_2", "Second answer.") }];
		await withSession(steps, async ({ session, posts, events, runtime }) => {
			await session.prompt("first");
			await session.setModel(currentOf(runtime) as never);
			await session.prompt("second");
			await session.waitForIdle();
			assertNoInstallation(session, posts, events, /cybersecurity/i);
		});
	});

	it("an incomplete current-model summary is rejected without fallback or installing partial text", { timeout: CASE_TIMEOUT_MS }, async () => {
		const partial = textEvents("resp_incomplete", "UNSAFE_PARTIAL_SUMMARY").slice(0, -1);
		const steps: Step[] = [{ events: FIRST_GENERATION }, { events: [...partial, ...incompleteEvents("resp_incomplete").slice(1)] }, { events: textEvents("resp_current_2", "Second answer.") }];
		await withSession(steps, async ({ session, posts, events, runtime }) => {
			await session.prompt("first");
			await session.setModel(currentOf(runtime) as never);
			await session.prompt("second");
			await session.waitForIdle();
			assert.equal(JSON.stringify(posts[2]!.body.input).includes("UNSAFE_PARTIAL_SUMMARY"), false);
			assertNoInstallation(session, posts, events, /Summarization failed: Incomplete response returned, reason: max_output_tokens/);
		});
	});

	it("below the current threshold there is no downshift and no extra query", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [{ events: FIRST_GENERATION }, { events: textEvents("resp_current_2", "Second answer.") }];
		await withSession(steps, async ({ session, posts, events, runtime }) => {
			await session.prompt("first");
			const model = runtime.getModels(CODEX_PROVIDER).find((m) => m.id === CURRENT_SLUG)!;
			await session.setModel({ ...model, contextWindow: 80_000 } as never);
			await session.prompt("second");
			await session.waitForIdle();
			assert.equal(posts.length, 2, "two generations, no summary request");
			assert.equal(posts[1]!.body.model, CURRENT_SLUG);
			assert.equal(events.some((e) => e.type === "compaction_start"), false);
			assert.equal(events.some((e) => e.type === "compaction_end"), false);
			assert.equal(session.sessionManager.getBranch().some((e) => e.type === "compaction"), false);
		});
	});

	it("exactly at the selected model threshold stock Pi does not compact", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [{ events: FIRST_GENERATION }, { events: textEvents("resp_current_2", "Second answer.") }];
		await withSession(steps, async ({ session, posts, events, runtime }) => {
			await session.prompt("first");
			const model = currentOf(runtime);
			// 60001 tokens of reported usage plus ceil(6 / 4) tokens for "second".
			await session.setModel({ ...model, contextWindow: 60_003 + RESERVE } as never);
			await session.prompt("second");
			await session.waitForIdle();
			assert.equal(posts.length, 2, "the threshold comparison is strict greater-than");
			assert.equal(posts[1]!.body.model, CURRENT_SLUG);
			assert.deepEqual(events.filter((e) => e.type === "compaction_start" || e.type === "compaction_end"), []);
			assert.equal(session.messages.some((m) => m.role === "compactionSummary"), false);
		});
	});
});
