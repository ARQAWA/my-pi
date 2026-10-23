// Model downshift through the real Pi 1.4.0 AgentSession: session.prompt on a registered RQW-codex extension (the owned facade ->
// registration -> session controller -> CodexThreadTransport -> compaction hook), a fake auth store and a fake Codex backend (SSE).
// The previous model is a known pinned slug with a larger window; the current model has a smaller window, so the preflight
// threshold of the current model triggers and the compaction runs on the previous model with the current model as fallback.
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

const compactionEvents = (id: string) => [created(id), { type: "response.output_item.done", output_index: 0, item: COMPACTION }, completed(id, 9)];

/** A non-retryable failed response (invalid request class): the primary attempt fails, no transport retry. */
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

function turnMetaOf(post: Post): Record<string, any> {
	return JSON.parse(post.body.client_metadata["x-codex-turn-metadata"] as string);
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
				installationId: INSTALLATION,
				dependencies: { connect: upgradeRefused as never, postEvents: postEvents as never, sleep: async () => undefined, clock: { now: () => Date.now() } },
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
			const { session } = await createAgentSession({ cwd: agentDir, agentDir, modelRuntime: runtime, model: oldModel as never, thinkingLevel: "off",
				resourceLoader: loader, sessionManager: SessionManager.inMemory(agentDir),
				settingsManager: SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: RESERVE }, retry: { enabled: false }, transport: "sse" }) });
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

describe("model downshift through the real AgentSession", () => {
	it("pre-turn threshold after a larger previous model compacts on that model; the current model generates with the checkpoint once", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [{ events: FIRST_GENERATION }, { events: compactionEvents("resp_downshift_compact") }, { events: textEvents("resp_current_2", "Second answer.") }];
		await withSession(steps, async ({ session, posts, events, runtime }) => {
			await session.prompt("first");
			assert.equal(posts.length, 1, "the first generation alone: usage below the previous model's trigger");
			await session.setModel(currentOf(runtime) as never);
			await session.prompt("second");
			await session.waitForIdle();

			assert.equal(posts.length, 3, "generation, one compaction, current generation");
			assert.equal(posts[0]!.body.model, OLD_SLUG);
			assert.equal(posts[1]!.body.model, OLD_SLUG, "the compaction is primary on the previous model");
			assert.equal(posts[2]!.body.model, CURRENT_SLUG, "the next generation is on the current model");
			const trigger = posts[1]!.body.input as Array<Record<string, unknown>>;
			assert.deepEqual(trigger[trigger.length - 1], { type: "compaction_trigger" });
			assert.deepEqual(compactionBlockOf(posts[1]!), { trigger: "auto", reason: "model_downshift", implementation: "responses_compaction_v2", phase: "pre_turn", strategy: "memento" });
			assert.deepEqual(JSON.parse(posts[1]!.headers["x-codex-turn-metadata"] ?? "{}").compaction, compactionBlockOf(posts[1]!));
			assert.deepEqual(events.filter((e) => e.type === "compaction_start").map((e) => e.reason), ["threshold"]);
			assert.deepEqual(events.filter((e) => e.type === "compaction_end").map((e) => [e.reason, e.aborted, e.willRetry]), [["threshold", false, false]]);
			assert.equal(session.messages.some((m) => (m as { role?: string }).role === "compactionSummary"), false, "no Pi text summary entry");

			const next = posts[2]!.body.input as Array<Record<string, any>>;
			assert.equal(next.filter((item) => item.type === "compaction").length, 1, "the opaque checkpoint appears exactly once");
			assert.equal(next.find((item) => item.type === "compaction")?.encrypted_content, "ENC+/==raw");
			assert.equal(next.some((item) => item.type === "compaction_trigger"), false);
			const checkpoint = session.sessionManager.getBranch().find((e) => e.type === "custom" && (e.data as { kind?: string } | undefined)?.kind === "checkpoint") as { data: { window: { number: number } } } | undefined;
			assert.equal(checkpoint?.data.window.number, 1, "the accepted checkpoint advanced the window once");
		});
	});

	it("primary previous-model compaction fails non-retryably: the current model compacts the same operation, with its own efforts", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{ events: FIRST_GENERATION },
			{ events: failedEvents("resp_old_fail", "invalid_prompt") },
			{ events: compactionEvents("resp_current_compact") },
			{ events: textEvents("resp_current_2", "Second answer.") },
		];
		await withSession(steps, async ({ session, posts, events, runtime }) => {
			await session.prompt("first");
			await session.setModel(currentOf(runtime) as never);
			// Explicit selection supported by both models (Pi clamps the thinking level after a model switch).
			session.setThinkingLevel("high");
			await session.prompt("second");
			await session.waitForIdle();

			assert.equal(posts.length, 4, "generation, failed primary compaction, fallback compaction, current generation");
			assert.equal(posts[1]!.body.model, OLD_SLUG);
			assert.equal(posts[2]!.body.model, CURRENT_SLUG);
			assert.equal(posts[3]!.body.model, CURRENT_SLUG);
			const primaryMeta = turnMetaOf(posts[1]!);
			const fallbackMeta = turnMetaOf(posts[2]!);
			assert.equal(primaryMeta.turn_id, fallbackMeta.turn_id, "both attempts are one operation");
			assert.equal(primaryMeta.compaction.reason, "model_downshift");
			assert.equal(fallbackMeta.compaction.reason, "model_downshift");
			// The current selection (high) is supported by the previous model, so both attempts send high.
			assert.equal(posts[1]!.body.reasoning.effort, "high");
			assert.equal(posts[1]!.body.reasoning.context, "all_turns", "Lite compaction keeps the native reasoning context");
			assert.equal(posts[2]!.body.reasoning.effort, "high");
			assert.equal(posts[2]!.body.reasoning.context, "all_turns");
			assert.equal(JSON.parse(posts[1]!.headers["x-codex-turn-metadata"] ?? "{}").model, OLD_SLUG);
			assert.equal(JSON.parse(posts[2]!.headers["x-codex-turn-metadata"] ?? "{}").model, CURRENT_SLUG);
			assert.deepEqual(events.filter((e) => e.type === "compaction_end").map((e) => [e.aborted, e.errorMessage === undefined]), [[false, true]]);
			const checkpoint = session.sessionManager.getBranch().find((e) => e.type === "custom" && (e.data as { kind?: string } | undefined)?.kind === "checkpoint") as { data: { modelHash: string; primaryModelHash?: string } } | undefined;
			assert.equal(checkpoint?.data.modelHash, "3000", "the checkpoint records the model that produced it");
			assert.equal(checkpoint?.data.primaryModelHash, "3000");
		});
	});

	it("both previous and current compaction fail: the original (primary) error is reported and nothing is installed", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{ events: FIRST_GENERATION },
			{ events: failedEvents("resp_old_fail", "invalid_prompt") },
			{ events: failedEvents("resp_current_fail", "cyber_policy") },
			{ events: textEvents("resp_current_2", "Second answer.") },
		];
		await withSession(steps, async ({ session, posts, events, runtime }) => {
			await session.prompt("first");
			await session.setModel(currentOf(runtime) as never);
			await session.prompt("second");
			await session.waitForIdle();

			assert.equal(posts.length, 4);
			const end = events.filter((e) => e.type === "compaction_end").at(-1);
			assert.equal(end?.aborted, false);
			assert.match(String(end?.errorMessage), /Invalid request\./, "the original error is reported");
			assert.doesNotMatch(String(end?.errorMessage), /cybersecurity/);
			assert.equal(session.sessionManager.getBranch().some((e) => e.type === "custom" && (e.data as { kind?: string } | undefined)?.kind === "checkpoint"), false, "no checkpoint installed");
		});
	});

	it("an incomplete previous-model compaction never falls back to the current model", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [{ events: FIRST_GENERATION }, { events: incompleteEvents("resp_old_incomplete") }, { events: textEvents("resp_current_2", "Second answer.") }];
		await withSession(steps, async ({ session, posts, events, runtime }) => {
			await session.prompt("first");
			await session.setModel(currentOf(runtime) as never);
			await session.prompt("second");
			await session.waitForIdle();

			assert.equal(posts.length, 3, "no fallback compaction request after an incomplete response");
			assert.equal(posts[1]!.body.model, OLD_SLUG);
			assert.equal(posts[2]!.body.input.some((item: { type?: string }) => item.type === "compaction_trigger"), false);
			assert.equal(events.filter((e) => e.type === "compaction_end").at(-1)?.aborted, false);
		});
	});

	it("below the current threshold there is no downshift and no extra query", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [{ events: FIRST_GENERATION }, { events: textEvents("resp_current_2", "Second answer.") }];
		await withSession(steps, async ({ session, posts, events, runtime }) => {
			await session.prompt("first");
			// Window 80000: trigger 70000, usage 60000 stays below it although the previous window is larger.
			const model = runtime.getModels(CODEX_PROVIDER).find((m) => m.id === CURRENT_SLUG)!;
			await session.setModel({ ...model, contextWindow: 80_000 } as never);
			await session.prompt("second");
			await session.waitForIdle();

			assert.equal(posts.length, 2, "two generations, no compaction request");
			assert.equal(posts[1]!.body.model, CURRENT_SLUG);
			assert.equal(events.some((e) => e.type === "compaction_start"), false);
		});
	});
});
