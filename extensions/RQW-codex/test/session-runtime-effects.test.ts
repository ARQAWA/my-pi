// Runtime effects of the owned Codex facade on one real Pi 1.4.0 AgentSession: session.prompt, session.abort,
// session.compact (stock Pi compaction, summary through the Codex transport), session.sendCustomMessage, the session subscription and the extension's context event, with the owned
// facade (createCodexExtension -> registration -> session controller -> CodexThreadTransport). Only this extension is loaded
// (plus, in one case, a context handler registered by the same extension factory). The Codex backend is a fake postEvents
// (SSE); every request is recorded and a request beyond the scripted steps fails the test. Fake OAuth JWT, temporary agent
// directory, in-memory settings, no network, no auth homes.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { describe, it } from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installRuntimeAuth } from "../auth-runtime.ts";
import { createCodexExtension } from "../index.ts";
import { CODEX_PROVIDER } from "../profile.ts";
import { SocketError } from "../websocket.ts";

const ACCOUNT = "acct_runtime_effects_1";
const ACCOUNT_B = "acct_runtime_effects_b";
const INSTALLATION = "22222222-3333-4444-8555-666666666666";
const CASE_TIMEOUT_MS = 15_000;
const RESERVE = 10_000;
// Small keep budget: a long second user message (about 25 tokens) is the first kept entry, so the first turn is summarized away.
const KEEP_RECENT = 10;
const SUMMARY = "STOCK_SUMMARY_TEXT: the first turn is summarized here.";
const LONG = (text: string) => `${text} ${"padding-".repeat(12)}`;
const PROBE_TEXT = "hello-read-probe";

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeAccess(account = ACCOUNT): string {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return `${b64url({ alg: "none" })}.${b64url({ exp, "https://api.openai.com/auth": { chatgpt_account_id: account } })}.sig`;
}

const usageOf = (input: number) => ({ input_tokens: input, output_tokens: 1, total_tokens: input + 1, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } });
const created = (id: string) => ({ type: "response.created", response: { id } });
const completed = (id: string, input = 1) => ({ type: "response.completed", response: { id, status: "completed", usage: usageOf(input) } });

/** A complete assistant text generation. */
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

/** Encrypted reasoning with a chosen payload plus assistant text (physical thinkingSignature carries the reasoning item). */
function signedAnswer(id: string, encrypted: string, text: string) {
	return [
		created(id),
		{ type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: `rs_${id}`, encrypted_content: encrypted, summary: [] } },
		{ type: "response.output_item.done", output_index: 1, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
		completed(id, 1),
	];
}

/** Encrypted reasoning plus assistant text: the raw items the durable wire must replay exactly. */
function answerEvents(id: string, text: string) {
	return [
		created(id),
		{ type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: `rs_${id}`, encrypted_content: `ENC-${id}`, summary: [] } },
		{ type: "response.output_item.done", output_index: 1, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
		completed(id, 1),
	];
}

const functionCallDone = (index: number, id: string, callId: string, args: string) => ({
	type: "response.output_item.done",
	output_index: index,
	item: { type: "function_call", id, call_id: callId, name: "read", arguments: args },
});

/** One scripted backend request: `events` are yielded in order; with `holdAfter` the request then stays open until its signal aborts. */
type Step = { events: Array<Record<string, unknown>>; holdAfter?: boolean };
/** `account` is the ChatGPT-Account-ID label of the request only; no authorization bytes are recorded. */
type Post = { url: string; body: Record<string, any>; account?: string };
type Session = Awaited<ReturnType<typeof createAgentSession>>["session"];
type Ctx = { session: Session; posts: Post[]; events: Array<Record<string, any>>; agentDir: string; runtime: ModelRuntime };

async function waitFor(condition: () => boolean, label: string, ms = 10_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Owned extension (plus an optional handler of the same factory). Every test owns its temporary root: the session is
 * aborted and disposed, the auth release runs and the root is removed in finally, also after a failed assertion.
 */
async function withSession(options: { steps: Step[]; extend?: (pi: ExtensionAPI) => void }, run: (ctx: Ctx) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "rqw-codex-runtime-effects-"));
	let session: Session | undefined;
	let release: (() => void) | undefined;
	try {
		const agentDir = join(root, "agent");
		await mkdir(agentDir, { recursive: true });
		await writeFile(join(agentDir, "probe.txt"), `${PROBE_TEXT}\n`);
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const credential = { type: "oauth", access: fakeAccess(), refresh: "refresh-runtime-effects-1", expires: exp * 1000, accountId: ACCOUNT };
		const authPath = join(agentDir, "auth.json");
		await writeFile(authPath, JSON.stringify({ [CODEX_PROVIDER]: credential }));
		const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });

		const posts: Post[] = [];
		const events: Array<Record<string, any>> = [];
		const postEvents = (req: { url: string; body: Uint8Array; headers?: Record<string, string>; signal?: AbortSignal; onResponse: (r: { status: number; headers: object }) => void }) => {
			const body = JSON.parse(zlib.zstdDecompressSync(Buffer.from(req.body)).toString("utf8")) as Record<string, any>;
			posts.push({ url: req.url, body, account: req.headers?.["ChatGPT-Account-ID"] });
			const step = options.steps[posts.length - 1];
			if (step === undefined) throw new Error(`unscripted backend request #${posts.length}`);
			return (async function* () {
				req.onResponse({ status: 200, headers: {} });
				for (const value of step.events) yield { text: JSON.stringify(value), value };
				if (step.holdAfter) {
					await new Promise((_, reject) => {
						const abort = () => reject(Object.assign(new Error("Request was aborted"), { name: "AbortError" }));
						if (req.signal?.aborted) abort();
						else req.signal?.addEventListener("abort", abort, { once: true });
					});
				}
			})();
		};
		/** Refused WebSocket upgrade (426): the facade then uses SSE only. */
		const upgradeRefused = async (): Promise<never> => {
			throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
		};
		const codex = createCodexExtension({
			installationId: INSTALLATION,
			dependencies: { connect: upgradeRefused as never, postEvents: postEvents as never, sleep: async () => undefined, clock: { now: () => Date.now() } },
		});
		const factory = (pi: ExtensionAPI) => {
			codex(pi);
			options.extend?.(pi);
		};

		const loader = new DefaultResourceLoader({
			cwd: agentDir, agentDir, additionalExtensionPaths: [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: [factory],
		});
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert.equal(loader.getExtensions().extensions.length, 1, "exactly one extension (the RQW-codex factory) is loaded");

		release = installRuntimeAuth(runtime);
		const model = runtime.getModels(CODEX_PROVIDER)[0]!;
		({ session } = await createAgentSession({ cwd: agentDir, agentDir, modelRuntime: runtime, model, thinkingLevel: "off",
			resourceLoader: loader, sessionManager: SessionManager.inMemory(agentDir),
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: RESERVE, keepRecentTokens: KEEP_RECENT }, retry: { enabled: false }, transport: "sse" }) }));
		await session.bindExtensions({ mode: "tui" });
		await session.setModel(model);
		const unsubscribe = session.subscribe((event) => { events.push(event as Record<string, any>); });
		try {
			await run({ session, posts, events, agentDir, runtime });
		} finally {
			unsubscribe();
		}
	} finally {
		// Failure cleanup: a still-open backend request is aborted before the session is disposed.
		if (session) {
			if (session.isStreaming) await session.abort().catch(() => undefined);
			session.dispose();
		}
		release?.();
		await rm(root, { recursive: true, force: true });
	}
}

/** Parsed `x-codex-turn-metadata` blob of the body (window_id, context_window_id, ...). */
const blobOf = (post: Post): Record<string, any> => JSON.parse((post.body.client_metadata as Record<string, string>)["x-codex-turn-metadata"]!);

const callIds = (input: Array<Record<string, any>>, callId: string) => input.filter((item) => item.call_id === callId);

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const firstUserEntry = (session: Session) => session.sessionManager.getBranch().find((e) => e.type === "message" && (e as { message: { role: string } }).message.role === "user") as { id: string; message: { content: unknown } } | undefined;

/** A normal full Responses request: no native compaction item or trigger and no continuation of an earlier response. */
function assertPlainRequest(post: Post): void {
	const input = post.body.input as Array<Record<string, any>>;
	assert.equal(input.some((item) => item.type === "compaction_trigger" || item.type === "compaction"), false, "no native compaction item or trigger");
	assert.equal(post.body.previous_response_id, undefined, "no continuation of an earlier response");
	// No compaction key in the body, its client metadata or the turn-metadata blob.
	const keys = [...Object.keys(post.body), ...Object.keys(post.body.client_metadata ?? {}), ...Object.keys(blobOf(post))];
	assert.deepEqual(keys.filter((key) => key.toLowerCase().includes("compaction")), [], "no compaction key");
}

/** Pi's summary request: a normal Responses request with the serialized conversation and Pi's summarization prompt. */
function assertSummaryRequest(post: Post, session: Session, text: { includes: string[]; excludes: string[]; effort?: string }): void {
	assertPlainRequest(post);
	const json = JSON.stringify(post.body.input);
	assert.ok(json.includes("<conversation>"), "the input holds the serialized conversation");
	assert.ok(json.includes("The messages above are a conversation to summarize"), "the input holds Pi's summarization prompt");
	for (const needle of text.includes) assert.ok(json.includes(needle), `${needle} is summarized`);
	for (const needle of text.excludes) assert.equal(json.includes(needle), false, `${needle} is not summarized`);
	assert.equal(post.body.model, session.model!.id, "the summary uses the selected model");
	// Pi passes reasoning only for a level above off; the transport's default effort then applies.
	assert.equal(post.body.reasoning?.effort, text.effort ?? "medium", "reasoning effort of the summary request");
	// Request-local routing: a fresh thread, never the session's own thread or cache key.
	const metadata = post.body.client_metadata as Record<string, string>;
	for (const value of [metadata.thread_id, metadata.session_id, post.body.prompt_cache_key]) {
		assert.equal(typeof value, "string");
		assert.notEqual(value, session.sessionId, "the summary request does not reuse the session's thread");
	}
	assert.equal(metadata.thread_id, metadata.session_id);
	assert.equal(metadata["x-codex-window-id"], `${metadata.thread_id}:0`, "request-local window thread:0");
}

/** Pi's own compaction entry and summary message: no wire-history checkpoint entry exists. */
function assertStockCompaction(session: Session, summary: string, entries: number): void {
	const branch = session.sessionManager.getBranch();
	const compactions = branch.filter((e) => e.type === "compaction") as unknown as Array<{ id: string; summary: string; firstKeptEntryId: string; tokensBefore: number }>;
	assert.equal(compactions.length, entries, "one Pi compaction entry per compaction");
	const latest = compactions.at(-1)!;
	assert.equal(latest.summary, summary, "the entry holds the generated summary text");
	assert.ok(branch.some((e) => e.id === latest.firstKeptEntryId), "firstKeptEntryId is an entry of the branch");
	assert.ok(latest.tokensBefore > 0, "tokensBefore is recorded");
	const summaries = session.sessionManager.buildSessionContext().messages.filter((m) => m.role === "compactionSummary");
	assert.equal(summaries.length, 1, "the context holds one compaction summary message");
	assert.ok(JSON.stringify(summaries[0]).includes(summary));
	assert.equal(branch.some((e) => JSON.stringify(e).includes("rqw-codex/wire-history") && JSON.stringify(e).includes("checkpoint")), false, "no native checkpoint entry");
}

describe("runtime effects of the owned Codex facade on a real AgentSession", () => {
	it("abort with a completed function_call held before the terminal event: no tool execution, and the next request replays neither that call nor the unfinished call", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{
				events: [
					created("resp_a1"),
					functionCallDone(0, "fc_a1", "call_a1", JSON.stringify({ path: "probe.txt" })),
					{ type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "fc_a2", call_id: "call_a2", name: "read", arguments: "" } },
					{ type: "response.function_call_arguments.delta", item_id: "fc_a2", output_index: 1, delta: '{"pa' },
				],
				holdAfter: true,
			},
			{ events: textEvents("resp_a2", "After abort.") },
		];
		await withSession({ steps }, async ({ session, posts, events }) => {
			const prompting = session.prompt("first");
			await waitFor(() => posts.length === 1, "held backend request");
			await pause(100);
			await session.abort();
			await prompting;
			await session.waitForIdle();
			assert.equal(events.filter((e) => e.type === "tool_execution_start").length, 0, "no registered tool executed");

			await session.prompt("second");
			assert.equal(posts.length, 2, "one new request after the abort");
			const input = posts[1]!.body.input as Array<Record<string, any>>;
			assert.equal(callIds(input, "call_a1").length, 0, "the completed but unanswered call is not replayed");
			assert.equal(callIds(input, "call_a2").length, 0, "the unfinished call (added/delta only) is not replayed");
			assert.equal(JSON.stringify(input).includes("call_a"), false, "no orphan call of this turn in the next request");
		});
	});

	it("normal completed function_call: the tool executes once, the next request carries the exact call and its output once, and no request is retried", { timeout: CASE_TIMEOUT_MS }, async () => {
		const rawArgs = `{ "path" : "probe.txt" }`;
		const steps: Step[] = [
			{ events: [created("resp_b1"), functionCallDone(0, "fc_b1", "call_b1", rawArgs), completed("resp_b1", 1)] },
			{ events: textEvents("resp_b2", "Done.") },
		];
		await withSession({ steps }, async ({ session, posts, events }) => {
			await session.prompt("read it");
			assert.equal(posts.length, 2, "exactly two backend requests: sampling, then the request after the tool loop");
			assert.equal(events.filter((e) => e.type === "tool_execution_start").length, 1, "the tool executed once");
			const input = posts[1]!.body.input as Array<Record<string, any>>;
			const pair = callIds(input, "call_b1");
			assert.deepEqual(pair.map((item) => item.type), ["function_call", "function_call_output"]);
			assert.equal(pair[0]!.arguments, rawArgs, "the call arguments are the raw string of the stream");
			assert.equal(typeof pair[1]!.output, "string");
			assert.ok((pair[1]!.output as string).includes(PROBE_TEXT), "the output is the tool result");
		});
	});

	it("context handler replaces an assistant message for one generation only: that request carries the modified text and not the native raw items; the next generation restores the native base", { timeout: CASE_TIMEOUT_MS }, async () => {
		let rewrite = false;
		const extend = (pi: ExtensionAPI) => {
			pi.on("context", ((event: { messages: Array<Record<string, any>> }) => {
				if (!rewrite) return undefined;
				rewrite = false;
				return {
					messages: event.messages.map((message) => message.role === "assistant" && message.responseId === "resp_c1"
						? { ...message, content: [{ type: "text", text: "MODIFIED-CONTEXT" }] }
						: message),
				};
			}) as never);
		};
		const steps: Step[] = [
			{ events: answerEvents("resp_c1", "Native answer.") },
			{ events: answerEvents("resp_c2", "Modified generation.") },
			{ events: answerEvents("resp_c3", "Restored generation.") },
		];
		await withSession({ steps, extend }, async ({ session, posts }) => {
			await session.prompt("first");
			rewrite = true;
			await session.prompt("second");
			const modified = JSON.stringify(posts[1]!.body.input);
			assert.ok(modified.includes("MODIFIED-CONTEXT"), "the modified text reaches the backend");
			assert.equal(modified.includes("ENC-resp_c1"), false, "the native encrypted reasoning of the modified generation is not sent");

			await session.prompt("third");
			const restored = JSON.stringify(posts[2]!.body.input);
			assert.equal(restored.includes("MODIFIED-CONTEXT"), false, "the modified text does not persist");
			assert.ok(restored.includes("ENC-resp_c1"), "the next normal generation replays the native raw item again");
			const first = session.messages.find((m) => (m as { role?: string }).role === "assistant") as { responseId?: string };
			assert.equal(first.responseId, "resp_c1", "the physical message keeps its response id");
		});
	});

	it("stock compaction, then a triggerTurn custom message reaches the backend exactly once with the summary once and no compacted-away history", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{ events: textEvents("resp_d1", "D1-ANSWER") },
			{ events: textEvents("resp_d2", "D2-ANSWER") },
			{ events: textEvents("resp_d_summary", SUMMARY, 9) },
			{ events: textEvents("resp_d3", "After summary.") },
		];
		await withSession({ steps }, async ({ session, posts, events }) => {
			await session.prompt("D-ORIGINAL-SOURCE");
			await session.prompt(LONG("D-KEPT-TURN"));
			session.setThinkingLevel("high");
			assert.equal(session.thinkingLevel, "high");
			await session.compact();
			assert.equal(posts.length, 3, "the summary is exactly one request");
			assert.deepEqual(events.filter((e) => e.type === "compaction_start").map((e) => e.reason), ["manual"]);
			assert.deepEqual(events.filter((e) => e.type === "compaction_end").map((e) => [e.reason, e.aborted, e.willRetry]), [["manual", false, false]]);
			assertSummaryRequest(posts[2]!, session, { includes: ["D-ORIGINAL-SOURCE", "D1-ANSWER"], excludes: ["D-KEPT-TURN"], effort: "high" });
			assertStockCompaction(session, SUMMARY, 1);

			await session.sendCustomMessage({ customType: "rqw-runtime-probe", content: "CUSTOM-PROBE", display: false }, { triggerTurn: true });
			await session.waitForIdle();
			assert.equal(posts.length, 4, "the triggered turn reaches the backend exactly once");
			assertPlainRequest(posts[3]!);
			const json = JSON.stringify(posts[3]!.body.input);
			assert.equal(count(json, SUMMARY), 1, "the summary is carried once");
			assert.equal(count(json, "CUSTOM-PROBE"), 1, "the custom message is carried once");
			assert.equal(count(json, "D-KEPT-TURN"), 1, "the kept tail is carried once");
			assert.equal(json.includes("D-ORIGINAL-SOURCE"), false, "the compacted-away user message is not carried");
			assert.equal(json.includes("D1-ANSWER"), false, "the compacted-away answer is not carried");
			const before = blobOf(posts[1]!);
			const after = blobOf(posts[3]!);
			assert.equal(after.window_id, `${session.sessionId}:0`, "stock compaction does not advance the window number");
			assert.equal(after.window_number, 0);
			assert.equal(after.window_id, before.window_id);
			assert.equal(typeof after.context_window_id, "string");
			assert.notEqual(after.context_window_id, before.context_window_id, "the summary starts a new context window id inside the same window number");
		});
	});

	it("same-content public context edit of a compacted-away source entry keeps the compaction: the next request still carries the summary once", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{ events: textEvents("resp_e1", "E1-ANSWER") },
			{ events: textEvents("resp_e2", "E2-ANSWER") },
			{ events: textEvents("resp_e_summary", SUMMARY, 9) },
			{ events: textEvents("resp_e3", "Still summarized.") },
		];
		await withSession({ steps }, async ({ session, posts }) => {
			await session.prompt("E-ORIGINAL-SOURCE");
			await session.prompt(LONG("E-KEPT-TURN"));
			await session.compact();
			const userEntry = firstUserEntry(session);
			assert.ok(userEntry, "a physical user entry exists");
			session.sessionManager.appendContextEdit(userEntry.id, { content: structuredClone(userEntry.message.content) } as never);

			await session.prompt("E-AFTER-EDIT");
			assert.equal(posts.length, 4, "the edit sends no request of its own");
			assertPlainRequest(posts[3]!);
			const json = JSON.stringify(posts[3]!.body.input);
			assert.equal(count(json, SUMMARY), 1, "the summary survives the same-content edit");
			assert.equal(count(json, "E-KEPT-TURN"), 1);
			assert.equal(count(json, "E-AFTER-EDIT"), 1);
			assert.equal(json.includes("E-ORIGINAL-SOURCE"), false, "the compacted-away source stays out");
			assertStockCompaction(session, SUMMARY, 1);
		});
	});

	it("different-content public edit: of a compacted-away source entry the next request keeps the summary and never carries the edit; of a kept entry it carries the new content once and the old content not at all", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{ events: textEvents("resp_f1", "F1-ANSWER") },
			{ events: textEvents("resp_f2", "F2-ANSWER") },
			{ events: textEvents("resp_f_summary", SUMMARY, 9) },
			{ events: textEvents("resp_f3", "F3-ANSWER") },
			{ events: textEvents("resp_f4", "F4-ANSWER") },
		];
		await withSession({ steps }, async ({ session, posts }) => {
			await session.prompt("ORIGINAL-SOURCE");
			await session.prompt(LONG("F-KEPT-ORIGINAL"));
			await session.compact();
			assertStockCompaction(session, SUMMARY, 1);
			const before = blobOf(posts[1]!);

			session.sessionManager.appendContextEdit(firstUserEntry(session)!.id, { content: "EDITED-SOURCE" } as never);
			await session.prompt("F-AFTER-SOURCE-EDIT");
			assert.equal(posts.length, 4);
			assertPlainRequest(posts[3]!);
			const sourceEdited = JSON.stringify(posts[3]!.body.input);
			assert.equal(count(sourceEdited, SUMMARY), 1, "the summary is still the only trace of the compacted-away turn");
			assert.equal(sourceEdited.includes("EDITED-SOURCE"), false, "the edit of a compacted-away entry is not carried");
			assert.equal(sourceEdited.includes("ORIGINAL-SOURCE"), false);
			assert.equal(blobOf(posts[3]!).window_id, before.window_id, "no window change by the edit or the compaction");

			const kept = session.sessionManager.getBranch().find((e) => e.type === "message" && JSON.stringify((e as { message: { content: unknown } }).message.content).includes("F-KEPT-ORIGINAL")) as { id: string };
			session.sessionManager.appendContextEdit(kept.id, { content: "F-KEPT-EDITED" } as never);
			await session.prompt("F-AFTER-KEPT-EDIT");
			assert.equal(posts.length, 5);
			assertPlainRequest(posts[4]!);
			const keptEdited = JSON.stringify(posts[4]!.body.input);
			assert.equal(count(keptEdited, "F-KEPT-EDITED"), 1, "the new content of the kept entry is carried exactly once");
			assert.equal(keptEdited.includes("F-KEPT-ORIGINAL"), false, "the replaced content is not carried");
			assert.equal(count(keptEdited, SUMMARY), 1, "the summary is carried once");
			assert.equal(keptEdited.includes("EDITED-SOURCE"), false);
			assert.equal(blobOf(posts[4]!).window_id, before.window_id);
			assert.equal(blobOf(posts[4]!).context_window_id, blobOf(posts[3]!).context_window_id, "edits after the compaction keep the post-compaction context window id");
			assert.notEqual(blobOf(posts[3]!).context_window_id, before.context_window_id, "the post-compaction context window id differs from the pre-compaction one");
		});
	});

	it("public navigateTree to the leaf before the compaction: messages and branch are restored without the summary, and the next request is a normal full request with the original source", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{ events: textEvents("resp_g1", "G1-ANSWER") },
			{ events: textEvents("resp_g2", "G2-ANSWER") },
			{ events: textEvents("resp_g_summary", SUMMARY, 9) },
			{ events: textEvents("resp_g3", "G3-ANSWER") },
		];
		await withSession({ steps }, async ({ session, posts }) => {
			await session.prompt("G-SOURCE");
			await session.prompt(LONG("G-SECOND"));
			const leaf = session.sessionManager.getLeafId();
			assert.ok(leaf, "a leaf before the compaction exists");
			const messagesBefore = JSON.stringify(session.messages);

			await session.compact();
			assert.equal(posts.length, 3);
			assertStockCompaction(session, SUMMARY, 1);
			assert.equal(JSON.stringify(session.messages).includes(SUMMARY), true, "the compacted context carries the summary");
			const result = await session.navigateTree(leaf, { summarize: false });
			assert.equal(result.cancelled, false);
			assert.equal(result.aborted, undefined);
			assert.equal(session.sessionManager.getLeafId(), leaf, "the branch leaf is restored");
			assert.equal(session.sessionManager.getBranch().some((e) => e.type === "compaction"), false, "the compaction entry is not an ancestor of the restored leaf");
			assert.equal(JSON.stringify(session.messages), messagesBefore, "the agent messages are restored");
			assert.equal(JSON.stringify(session.messages).includes(SUMMARY), false, "the summary is gone from the context");
			assert.equal(posts.length, 3, "navigation without summary sends no request");

			await session.prompt("G-AFTER-NAV");
			assert.equal(posts.length, 4);
			const next = posts[3]!;
			assertPlainRequest(next);
			const json = JSON.stringify(next.body.input);
			assert.equal(json.includes(SUMMARY), false, "the summary is not carried");
			for (const text of ["G-SOURCE", "G1-ANSWER", "G-SECOND", "G2-ANSWER", "G-AFTER-NAV"]) assert.equal(count(json, text), 1, `${text} is carried once`);
		});
	});

	it("real facade account rotation A to B: B's summary request carries visible text and no account A ciphertext, and every later request stays free of ENC_A* while the session keeps working under B", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{ events: signedAnswer("resp_h1", "ENC_A1", "A1-ANSWER-VISIBLE") },
			{ events: signedAnswer("resp_h2", "ENC_A2", "A2-ANSWER-VISIBLE") },
			{ events: textEvents("resp_h_summary_b", "SUMMARY_FROM_B", 9) },
			{ events: textEvents("resp_h3", "B-ANSWER") },
			{ events: textEvents("resp_h4", "B-ANSWER-2") },
		];
		const secrets = ["ENC_A1", "ENC_A2"];
		await withSession({ steps }, async ({ session, posts, events, runtime }) => {
			await session.prompt("A1-USER-VISIBLE");
			await session.prompt(LONG("A2-USER-VISIBLE"));
			assert.equal(posts[0]!.account, ACCOUNT, "account A serves the first turn");
			assert.equal(posts[1]!.account, ACCOUNT, "account A serves the second turn");
			assert.ok(JSON.stringify(posts[1]!.body.input).includes("ENC_A1"), "control: account A itself replays its own ciphertext, so the later absence under B is meaningful");

			const signatures = (session.messages as unknown as Array<Record<string, any>>).flatMap((m) =>
				m.role === "assistant" && Array.isArray(m.content) ? m.content.filter((b: Record<string, any>) => b.type === "thinking").map((b: Record<string, any>) => String(b.thinkingSignature ?? "")) : []);
			assert.ok(signatures.some((s) => s.includes("ENC_A1")) && signatures.some((s) => s.includes("ENC_A2")), "the physical thinking signatures carry ENC_A1 and ENC_A2");

			// Rotate the fake stored login to account B (fake JWT, same store the facade reads).
			const store = (runtime as unknown as { credentials: { modify(p: string, fn: () => Promise<unknown>): Promise<unknown> } }).credentials;
			await store.modify(CODEX_PROVIDER, async () => ({ type: "oauth", access: fakeAccess(ACCOUNT_B), refresh: "refresh-runtime-effects-b", expires: Date.now() + 3600_000, accountId: ACCOUNT_B }));

			await session.compact();
			assert.equal(posts.length, 3, "the summary is exactly one request");
			const candidate = posts[2]!;
			assert.equal(candidate.account, ACCOUNT_B, "the summary request is owned by account B");
			assertSummaryRequest(candidate, session, { includes: ["A1-USER-VISIBLE", "A1-ANSWER-VISIBLE"], excludes: ["A2-USER-VISIBLE"] });
			const candidateJson = JSON.stringify(candidate.body);
			for (const secret of secrets) assert.equal(candidateJson.includes(secret), false, `${secret} is not sent to account B`);
			assert.deepEqual(events.filter((e) => e.type === "compaction_end").map((e) => [e.reason, e.aborted, e.willRetry]), [["manual", false, false]], "the summary under B is accepted");
			assertStockCompaction(session, "SUMMARY_FROM_B", 1);

			await session.prompt("B-SOURCE");
			assert.equal(posts.length, 4);
			const afterB = posts[3]!;
			assert.equal(afterB.account, ACCOUNT_B);
			assertPlainRequest(afterB);
			const afterJson = JSON.stringify(afterB.body);
			assert.equal(count(afterJson, "SUMMARY_FROM_B"), 1, "B's summary is carried once");
			assert.equal(count(afterJson, "A2-USER-VISIBLE"), 1, "the kept visible user text is carried once");
			assert.equal(count(afterJson, "A2-ANSWER-VISIBLE"), 1, "the kept visible answer is carried once, as text");
			assert.equal(afterJson.includes("A1-USER-VISIBLE"), false, "the compacted-away text is not carried");
			for (const secret of secrets) assert.equal(afterJson.includes(secret), false, `${secret} is not carried to account B`);

			await session.prompt("B-SOURCE-2");
			assert.equal(posts.length, 5, "the stored session keeps working under B");
			assert.equal(posts[4]!.account, ACCOUNT_B);
			assertPlainRequest(posts[4]!);
			const later = JSON.stringify(posts[4]!.body);
			for (const secret of secrets) assert.equal(later.includes(secret), false, `${secret} is not carried by a later B request`);
			assert.equal(count(later, "SUMMARY_FROM_B"), 1);
			assert.equal(count(later, "B-ANSWER"), 1, "the earlier B answer is carried once");
		});
	});
});
