// Deterministic checks of RQW-codex native backend compaction: request shape, atomic installation, retention,
// bounded retries and model fallback. Fake transport and fake session tree only. No network, no credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CODEX_ENDPOINT } from "../profile.ts";
import {
	COMPACTION_STREAM_RETRIES,
	CompactionError,
	type CompactRequest,
	PROVIDER_STREAM_MAX_RETRIES_DEFAULT,
	RETAINED_MESSAGE_TOKEN_BUDGET,
	UNSUPPORTED_IMAGE_TEXT,
	approxTokenCount,
	audioTokenCount,
	compactBackend,
	estimateItemTokens,
	imageDimensionsFromBytes,
	isHookPromptText,
	isImageResizeNoticeText,
	isStandardContextualUserText,
	matchesMarkedText,
	truncateRetained,
	truncateTokens,
	uuidv7,
} from "../compaction.ts";
import { WireHistory, type WireEnvelope, type WireSession, type WireSessionEntry } from "../history.ts";

function fakeSession() {
	const entries: WireSessionEntry[] = [];
	let leaf: string | null = null;
	let counter = 0;
	const session: WireSession & { entries: WireSessionEntry[]; pushMessage(text: string): string } = {
		entries,
		appendCustomEntry(customType, data) {
			const id = `e${++counter}`;
			entries.push({ id, type: "custom", customType, data: structuredClone(data), parentId: leaf } as WireSessionEntry);
			leaf = id;
			return id;
		},
		pushMessage(text: string) {
			const id = `m${++counter}`;
			entries.push({ id, type: "message", data: { text }, parentId: leaf } as WireSessionEntry);
			leaf = id;
			return id;
		},
		getBranch(fromId?: string) {
			const byId = new Map(entries.map((e) => [e.id, e]));
			const path: WireSessionEntry[] = [];
			let cursor: string | null = fromId ?? leaf;
			while (cursor) {
				const entry = byId.get(cursor) as (WireSessionEntry & { parentId?: string | null }) | undefined;
				if (!entry) break;
				path.unshift(entry);
				cursor = entry.parentId ?? null;
			}
			return path;
		},
		getLeafId: () => leaf,
	};
	return session;
}

const scope = { runtimeId: "rt", threadId: "thread", ownerId: "acct" };
const MODEL_HASH = "hash-primary";
const WINDOW = { number: 0, id: null };

function newHistory(session: WireSession, modelHash = MODEL_HASH) {
	return new WireHistory({ session, scope, modelHash });
}

/** Tokens-exact text: approxTokenCount(text) === tokens. */
const text = (tokens: number) => "a".repeat(tokens * 4);
const userMsg = (t: string) => ({ type: "message", role: "user", content: [{ type: "input_text", text: t }] });

const request = (overrides: Partial<CompactRequest> = {}): CompactRequest => ({
	model: "gpt-6.1-sol",
	useResponsesLite: false,
	inputModalities: ["text", "image"],
	contextWindow: null,
	tools: [{ type: "function", name: "bash" }],
	...overrides,
});

const COMPACTION = { type: "compaction", encrypted_content: "ENC+/==raw" };
const COMPACTION_NEXT = { type: "compaction", encrypted_content: "ENC+/==next" };
const completed = (responseId = "resp-c") => ({ type: "completed", responseId, usage: { input_tokens: 9 } });
const done = (item: unknown) => ({ type: "output_item_done", item });

/** Scripted transport: one entry per attempt; a thrown Error or a function of the call is allowed. */
function scripted(attempts: Array<unknown[] | Error>) {
	const calls: Array<{ endpoint: string; body: Record<string, unknown>; attempt: number }> = [];
	const send = async (call: { endpoint: string; body: Record<string, unknown>; attempt: number }) => {
		calls.push({ endpoint: call.endpoint, body: call.body, attempt: call.attempt });
		const next = attempts[Math.min(calls.length - 1, attempts.length - 1)];
		if (next instanceof Error) throw next;
		const events = next;
		return {
			async *[Symbol.asyncIterator]() {
				for (const e of events) yield e as { type: string };
			},
		};
	};
	return { calls, send };
}

function seed(session: WireSession, items: unknown[]) {
	const wh = newHistory(session);
	const attempt = wh.beginAttempt("seed");
	for (const item of items) attempt.addItem(item as { type: string });
	return wh;
}

describe("compaction request shape", () => {
	it("posts to the same /codex/responses endpoint with exactly one trailing compaction_trigger", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("hello")]);
		const { calls, send } = scripted([[done(COMPACTION), completed()]]);
		await compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW });
		assert.equal(calls.length, 1);
		assert.equal(calls[0].endpoint, CODEX_ENDPOINT);
		assert.equal(CODEX_ENDPOINT, "https://chatgpt.com/backend-api/codex/responses");
		const input = calls[0].body.input as Array<{ type: string }>;
		assert.equal(input.filter((i) => i.type === "compaction_trigger").length, 1);
		assert.deepEqual(input[input.length - 1], { type: "compaction_trigger" });
		assert.equal(calls[0].body.store, false);
		assert.equal(calls[0].body.stream, true);
		assert.deepEqual(calls[0].body.include, ["reasoning.encrypted_content"]);
		assert.equal(calls[0].body.model, "gpt-6.1-sol");
	});

	it("Lite with tools already in history omits fresh tool declarations and base instructions", async () => {
		const session = fakeSession();
		const wh = seed(session, [{ type: "additional_tools", tools: [{ name: "bash" }] }, userMsg("hi")]);
		const { calls, send } = scripted([[done(COMPACTION), completed()]]);
		await compactBackend({
			request: request({ useResponsesLite: true, baseInstructions: "BASE" }),
			history: wh,
			send,
			modelHash: MODEL_HASH,
			window: WINDOW,
		});
		assert.equal("tools" in calls[0].body, false);
		assert.equal(calls[0].body.parallel_tool_calls, false);
		const input = calls[0].body.input as Array<{ role?: string }>;
		assert.equal(input.some((i) => i.role === "developer"), false, "no base instructions item");
	});

	it("non-Lite sends base instructions as a developer item and the declared tools", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("hi")]);
		const { calls, send } = scripted([[done(COMPACTION), completed()]]);
		await compactBackend({ request: request({ baseInstructions: "BASE" }), history: wh, send, modelHash: MODEL_HASH, window: WINDOW });
		const input = calls[0].body.input as Array<Record<string, unknown>>;
		assert.equal(input[0].role, "developer");
		assert.deepEqual(calls[0].body.tools, [{ type: "function", name: "bash" }]);
		assert.equal(calls[0].body.parallel_tool_calls, true);
	});

	it("normalizes media the compaction model does not accept into placeholders, never raw images", async () => {
		const session = fakeSession();
		const wh = seed(session, [
			{ type: "message", role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,AAA" }] },
		]);
		const { calls, send } = scripted([[done(COMPACTION), completed()]]);
		await compactBackend({
			request: request({ inputModalities: ["text"] }),
			history: wh,
			send,
			modelHash: MODEL_HASH,
			window: WINDOW,
		});
		const serialized = JSON.stringify(calls[0].body.input);
		assert.equal(serialized.includes("input_image"), false);
		assert.equal(serialized.includes(UNSUPPORTED_IMAGE_TEXT), true);
	});
});

describe("atomic installation", () => {
	it("installs the raw encrypted compaction item, advances the window and records the response id as provenance", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("hello")]);
		wh.recordEffort("high");
		const { send } = scripted([[done(COMPACTION), completed("resp-9")]]);
		const result = await compactBackend({
			request: request(),
			history: wh,
			send,
			modelHash: MODEL_HASH,
			window: { number: 4, id: "old" },
			newWindowId: () => "0190f2c4-0000-7000-8000-000000000001",
			sourceEntryIds: ["m1"],
		});
		assert.equal(result.window.number, 5);
		assert.equal(result.window.id, "0190f2c4-0000-7000-8000-000000000001");
		assert.equal(result.responseId, "resp-9");
		const loaded = wh.load();
		assert.equal(loaded.mode, "native");
		assert.deepEqual(loaded.items.at(-1)?.item, COMPACTION, "encrypted content is kept byte for byte");
		assert.equal(loaded.checkpointResponseId, "resp-9");
		assert.equal(loaded.effort, null, "successful compaction resets the effort pin");
		assert.equal(JSON.stringify(loaded.items).includes("compaction_trigger"), false);
	});

	it("a rejected stream leaves history, window and effort pin unchanged", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("hello")]);
		wh.recordEffort("high");
		const before = session.entries.length;
		const { send } = scripted([[done(COMPACTION), { type: "failed", message: "boom" }]]);
		await assert.rejects(
			compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW }),
			(e: unknown) => e instanceof CompactionError && e.code === "failed",
		);
		assert.equal(session.entries.length, before);
		assert.equal(wh.load().effort, "high");
		assert.equal(wh.load().window.number, 0);
	});

	it("abort before the request makes no request and no mutation", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("hello")]);
		const before = session.entries.length;
		const controller = new AbortController();
		controller.abort();
		const { calls, send } = scripted([[done(COMPACTION), completed()]]);
		await assert.rejects(
			compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW, signal: controller.signal }),
			(e: unknown) => e instanceof CompactionError && e.code === "aborted",
		);
		assert.equal(calls.length, 0);
		assert.equal(session.entries.length, before);
	});

	it("abort during the stream throws aborted and installs nothing", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("hello")]);
		const before = session.entries.length;
		const controller = new AbortController();
		const send = async () => ({
			async *[Symbol.asyncIterator]() {
				yield done(COMPACTION);
				controller.abort();
				yield completed();
			},
		});
		await assert.rejects(
			compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW, signal: controller.signal }),
			(e: unknown) => e instanceof CompactionError && e.code === "aborted",
		);
		assert.equal(session.entries.length, before);
	});

	it("incomplete responses fail once without retry and without mutation", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("x")]);
		const before = session.entries.length;
		const { calls, send } = scripted([[{ type: "incomplete", reason: "max_output_tokens" }]]);
		await assert.rejects(
			compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW }),
			(e: unknown) => e instanceof CompactionError && e.code === "incomplete",
		);
		assert.equal(calls.length, 1);
		assert.equal(session.entries.length, before);
	});

	it("zero or two compaction outputs are malformed and not retried", async () => {
		for (const events of [
			[done({ type: "message", role: "assistant", content: [] }), completed()],
			[done(COMPACTION), done({ type: "compaction", encrypted_content: "B" }), completed()],
		]) {
			const session = fakeSession();
			const wh = seed(session, [userMsg("x")]);
			const before = session.entries.length;
			const { calls, send } = scripted([events]);
			await assert.rejects(
				compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW }),
				(e: unknown) => e instanceof CompactionError && e.code === "malformed",
			);
			assert.equal(calls.length, 1);
			assert.equal(session.entries.length, before);
		}
	});

	it("a compaction item without encrypted content is malformed", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("x")]);
		const { send } = scripted([[done({ type: "compaction" }), completed()]]);
		await assert.rejects(
			compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW }),
			(e: unknown) => e instanceof CompactionError && e.code === "malformed",
		);
	});

	it("a stream that closes before response.completed is retried at most the bounded number of times", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("x")]);
		const before = session.entries.length;
		const { calls, send } = scripted([[done(COMPACTION)]]);
		await assert.rejects(
			compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW }),
			(e: unknown) => e instanceof CompactionError && e.code === "stream",
		);
		assert.equal(COMPACTION_STREAM_RETRIES, 2);
		assert.equal(calls.length, 1 + COMPACTION_STREAM_RETRIES);
		assert.equal(session.entries.length, before);
	});

	it("a retryable transport error succeeds on a later bounded attempt", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("x")]);
		const transient = Object.assign(new Error("reset"), { retryable: true });
		const { calls, send } = scripted([transient, [done(COMPACTION), completed()]]);
		const result = await compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW });
		assert.equal(result.installed, true);
		assert.deepEqual(
			calls.map((c) => c.attempt),
			[0, 1],
		);
	});

	it("a non-retryable transport error is not retried", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("x")]);
		const { calls, send } = scripted([new Error("401 unauthorized")]);
		await assert.rejects(compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW }), /401/);
		assert.equal(calls.length, 1);
	});

	it("a native checkpoint from another model hash is replayed: the compaction is accepted in one backend call with the prior opaque input and the current producer hash", async () => {
		const session = fakeSession();
		const first = seed(session, [userMsg("x")]);
		const firstRun = scripted([[done(COMPACTION), completed("resp-first")]]);
		await compactBackend({ request: request(), history: first, send: firstRun.send, modelHash: MODEL_HASH, window: { number: 4, id: "old" }, newWindowId: () => "win-1" });
		const other = newHistory(session, "hash-other");
		const loadedWindow = other.load().window;
		assert.equal(loadedWindow.number, 5);
		const before = structuredClone(session.entries);
		const { calls, send } = scripted([[done(COMPACTION_NEXT), completed("resp-other")]]);
		const result = await compactBackend({
			request: request(),
			history: other,
			send,
			modelHash: "hash-other",
			window: loadedWindow,
			newWindowId: () => "win-2",
		});
		assert.equal(calls.length, 1);
		const input = calls[0].body.input as Array<Record<string, unknown>>;
		assert.equal(input.some((i) => JSON.stringify(i) === JSON.stringify(COMPACTION)), true, "prior opaque compaction is in the replayed input");
		assert.equal(result.installed, true);
		assert.equal(result.modelHash, "hash-other");
		assert.equal(result.window.number, 6, "window advances from the loaded window, not from 0");
		assert.equal(result.responseId, "resp-other");
		assert.equal((session.entries.at(-1)?.data as { modelHash?: unknown }).modelHash, "hash-other");
		assert.equal(session.entries.length, before.length + 1);
		assert.deepEqual(session.entries.slice(0, before.length), before);
	});
});

describe("previous-model fallback", () => {
	it("a non-terminal failure on a different model retries once with the current model", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("x")]);
		const { calls, send } = scripted([[{ type: "failed", message: "model gone" }], [done(COMPACTION), completed("resp-f")]]);
		const result = await compactBackend({
			request: request({ model: "gpt-6-sol" }),
			history: wh,
			send,
			modelHash: "hash-old",
			window: WINDOW,
			fallback: { request: request({ model: "gpt-6.1-sol" }), modelHash: "hash-new" },
		});
		assert.equal(result.responseId, "resp-f");
		assert.equal(calls[1].body.model, "gpt-6.1-sol");
		assert.equal(calls.length, 2);
	});

	it("same model is not retried", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("x")]);
		const { calls, send } = scripted([[{ type: "failed", message: "x" }]]);
		await assert.rejects(
			compactBackend({
				request: request(),
				history: wh,
				send,
				modelHash: MODEL_HASH,
				window: WINDOW,
				fallback: { request: request(), modelHash: MODEL_HASH },
			}),
			(e: unknown) => e instanceof CompactionError && e.code === "failed",
		);
		assert.equal(calls.length, 1);
	});

	it("when the fallback also fails, the original error is reported", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("x")]);
		const { send } = scripted([[{ type: "failed", message: "primary" }], [{ type: "failed", message: "fallback" }]]);
		await assert.rejects(
			compactBackend({
				request: request({ model: "gpt-6-sol" }),
				history: wh,
				send,
				modelHash: "a",
				window: WINDOW,
				fallback: { request: request({ model: "gpt-6.1-sol" }), modelHash: "b" },
			}),
			/primary/,
		);
	});
});

describe("retention boundary", () => {
	/** Retained items are what the installed checkpoint keeps (the request body carries the full projection). */
	async function retainedFor(items: unknown[], flags = {}) {
		const session = fakeSession();
		const wh = seed(session, items);
		const { send } = scripted([[done(COMPACTION), completed()]]);
		const result = await compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW, flags });
		const input = wh.load().items.map((e) => e.item) as Array<Record<string, unknown>>;
		return { result, input: input.slice(0, -1), wh };
	}

	it("keeps only the newest user messages up to the 64k budget and middle-truncates the boundary message", async () => {
		const old = userMsg(text(10_000));
		const mid = userMsg(text(30_000));
		const newest = userMsg(text(30_000));
		const { input } = await retainedFor([old, mid, newest]);
		assert.equal(input.length, 3, "boundary message + two newer messages");
		assert.deepEqual(input[2], newest);
		assert.deepEqual(input[1], mid);
		const boundary = (input[0].content as Array<{ text: string }>)[0].text;
		assert.equal(approxTokenCount(boundary) <= RETAINED_MESSAGE_TOKEN_BUDGET - 60_000 + 10, true, "budget left after the newer messages, plus the marker");
		assert.match(boundary, /tokens truncated/);
	});

	it("excludes assistant output, descendant progress, final answers and agent messages over 10k tokens", async () => {
		const progress = {
			type: "agent_message",
			author: "root/child",
			recipient: "root",
			content: [{ type: "input_text", text: "Message Type: MESSAGE\nprogress" }],
		};
		const completion = {
			type: "agent_message",
			author: "root/child",
			recipient: "root",
			content: [{ type: "input_text", text: "Message Type: FINAL_ANSWER\ndone" }],
		};
		const huge = {
			type: "agent_message",
			author: "root/child",
			recipient: "root",
			content: [{ type: "input_text", text: text(10_001) }],
		};
		const kept = {
			type: "agent_message",
			author: "sibling",
			recipient: "root",
			content: [{ type: "input_text", text: "Message Type: CHANNEL_POST\nshort" }],
		};
		const assistant = { type: "message", role: "assistant", content: [{ type: "output_text", text: "reply" }] };
		const { input } = await retainedFor([assistant, progress, completion, huge, kept, userMsg("u")]);
		const types = input.map((i) => `${i.type}:${i.role ?? ""}`);
		assert.deepEqual(types, ["agent_message:", "message:user"]);
		assert.equal((input[0].content as Array<{ text: string }>)[0].text.includes("CHANNEL_POST"), true);
	});

	it("keeps an image with its harness labels atomically, or drops the whole boundary when the budget is spent", async () => {
		const imageBoundary = {
			type: "message",
			role: "user",
			content: [
				{ type: "input_text", text: "<image>" },
				{ type: "input_image", image_url: "data:image/png;base64,AAA" },
				{ type: "input_text", text: "</image>" },
				{ type: "input_text", text: "after" },
			],
		};
		const newest = userMsg(text(63_000));
		const { input, result } = await retainedFor([imageBoundary, newest]);
		assert.equal(JSON.stringify(input).includes("input_image"), false, "image did not fit the remaining budget");
		assert.equal(JSON.stringify(input).includes("<image>"), false, "labels do not survive without their image");
		assert.equal(result.retainedImageCount, 0);
		assert.deepEqual(input.at(-1), newest);
	});

	it("an image that fits is kept whole and counted", async () => {
		const imageMsg = {
			type: "message",
			role: "user",
			content: [
				{ type: "input_text", text: "<image>" },
				{ type: "input_image", image_url: "data:image/png;base64,AAA" },
				{ type: "input_text", text: "</image>" },
			],
		};
		const { result, input } = await retainedFor([imageMsg]);
		assert.equal(result.retainedImageCount, 1);
		assert.equal(JSON.stringify(input).includes("input_image"), true);
	});

	it("image counts are not charged when the compaction image budget flag is off", async () => {
		const big = {
			type: "message",
			role: "user",
			content: [
				{ type: "input_image", image_url: "data:image/png;base64,AAA" },
				{ type: "input_text", text: "small" },
			],
		};
		const { result } = await retainedFor([userMsg(text(63_990)), big], { compactionImageBudget: false });
		assert.equal(result.retainedImageCount, 1, "image kept while uncharged");
	});

	it("client developer messages and client tool outputs are not retained by default", async () => {
		const dev = { type: "message", role: "developer", content: [{ type: "input_text", text: "client note" }] };
		const named = { type: "function_call_output", name: "shell", output: "out" };
		const { input } = await retainedFor([dev, named]);
		assert.deepEqual(input, []);
	});
});

describe("estimators and helpers", () => {
	it("approximate tokens are ceil(bytes / 4) and image content is 1844 tokens", () => {
		assert.equal(approxTokenCount("abcde"), 2);
		assert.equal(approxTokenCount(""), 0);
		assert.equal(estimateItemTokens({ type: "message", role: "user", content: [{ type: "input_image", image_url: "x" }] }), 1844);
		assert.equal(estimateItemTokens({ type: "compaction", encrypted_content: "x".repeat(300) }), 25);
		assert.equal(estimateItemTokens({ type: "reasoning", encrypted_content: "x".repeat(2000) }), Math.ceil((1500 - 650) / 4));
		assert.equal(estimateItemTokens({ type: "reasoning" }), 0);
	});

	it("middle truncation keeps both ends and counts removed tokens", () => {
		assert.equal(truncateTokens("middle1234", 2), "midd…1 tokens truncated…1234");
		assert.equal(truncateTokens("short", 10), "short");
	});

	it("uuidv7 has version 7 and RFC variant", () => {
		const id = uuidv7(1_700_000_000_000, () => new Uint8Array(10).fill(0xab));
		assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(id.slice(0, 8), (1_700_000_000_000).toString(16).padStart(12, "0").slice(0, 8));
	});

	it("function outputs are trimmed to the window newest-first when the compaction model is small", async () => {
		const session = fakeSession();
		const bigOutput = { type: "function_call_output", call_id: "c1", output: text(50_000) };
		const wh = seed(session, [userMsg("u"), { type: "function_call", call_id: "c1", name: "bash", arguments: "{}" }, bigOutput]);
		const { calls, send } = scripted([[done(COMPACTION), completed()]]);
		await compactBackend({ request: request({ contextWindow: 10_000 }), history: wh, send, modelHash: MODEL_HASH, window: WINDOW });
		const input = calls[0].body.input as Array<Record<string, unknown>>;
		const output = input.find((i) => i.type === "function_call_output") as { output: string };
		assert.equal(output.output, "Output exceeded the available model context and was truncated");
	});
});

describe("native contextual-user matchers and marked-text rule", () => {
	it("recognises every standard marked fragment, case-insensitively at the trimmed ends", () => {
		for (const t of [
			"# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nrules\n</INSTRUCTIONS>",
			"<environment_context>\n</environment_context>",
			"  <TURN_ABORTED>x</turn_aborted>",
			"<skill>body</skill>",
			"<user_shell_command>ls</user_shell_command>",
			"<subagent_notification>n</subagent_notification>",
			"<agent_message_board_notification>m</agent_message_board_notification>",
			"<recommended_plugins>p</recommended_plugins>",
			"<external_note>value</external_note>",
			'<codex_internal_context source="goal_1">body</codex_internal_context>',
			"<goal_context>legacy</goal_context>",
			"Warning: The maximum number of unified exec processes you can keep open is 64",
			"Warning: apply_patch was requested via exec_command. Use the apply_patch tool instead of exec_command.",
			"Warning: Your account was flagged for potentially high-risk cyber activity",
		]) {
			assert.equal(isStandardContextualUserText(t), true, t);
		}
	});

	it("does not treat near-miss text as contextual", () => {
		for (const t of [
			'<codex_internal_context source="Bad-Source">x</codex_internal_context>',
			"<external_key>value</external_other>",
			"<skill>unclosed",
			"Please read <skill>this</skill> later",
			"Warning: some other warning",
		]) {
			assert.equal(isStandardContextualUserText(t), false, t);
		}
	});

	it("matchesMarkedText needs both non-empty markers and ASCII case-insensitive ends", () => {
		assert.equal(matchesMarkedText("<a>", "</a>", "  <A>x</a>  "), true);
		assert.equal(matchesMarkedText("", "</a>", "</a>"), false);
		assert.equal(matchesMarkedText("<a>", "</a>", "<a>x</a> tail"), false);
	});

	it("hook prompt fragments need a non-empty hook_run_id", () => {
		assert.equal(isHookPromptText('<hook_prompt hook_run_id="run-1">text</hook_prompt>'), true);
		assert.equal(isHookPromptText('<hook_prompt hook_run_id="  ">text</hook_prompt>'), false);
	});

	it("image resize notice matches exactly, case-insensitively at the trimmed ends", () => {
		assert.equal(isImageResizeNoticeText("\n <IMAGE_RESIZE_NOTICE>\nImage 1 of 1 in the preceding user message was resized from 2x2 to 1x1 pixels.\n</image_resize_notice>\n"), true);
		assert.equal(isImageResizeNoticeText("<image_resize_notice>a</image_resize_notice> trailing"), false);
		assert.equal(isImageResizeNoticeText("<image_resize_notice>a"), false);
	});

	it("user messages: hook prompts are retained as hook input; contextual parts exclude the message", async () => {
		const session = fakeSession();
		const hookOnly = { type: "message", role: "user", content: [{ type: "input_text", text: '<hook_prompt hook_run_id="h1">hook text</hook_prompt>' }] };
		const hookPlusPlain = {
			type: "message",
			role: "user",
			content: [
				{ type: "input_text", text: '<hook_prompt hook_run_id="h2">h</hook_prompt>' },
				{ type: "input_text", text: "plain" },
			],
		};
		const turnAborted = userMsg("<turn_aborted>x</turn_aborted>");
		const agents = userMsg("# AGENTS.md instructions\n<INSTRUCTIONS>x</instructions>");
		const plain = userMsg("plain user");
		const wh = seed(session, [hookOnly, hookPlusPlain, turnAborted, agents, plain]);
		const { send } = scripted([[done(COMPACTION), completed()]]);
		await compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW });
		const kept = wh.load().items.slice(0, -1).map((e) => e.item);
		assert.deepEqual(kept, [hookOnly, plain]);
	});
});

describe("media estimators (native original detail, audio duration, fallbacks)", () => {
	const pngDataUrl = (width: number, height: number) => {
		const b = Buffer.alloc(33);
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
		b.writeUInt32BE(13, 8);
		b.write("IHDR", 12, "latin1");
		b.writeUInt32BE(width, 16);
		b.writeUInt32BE(height, 20);
		return `data:image/png;base64,${b.toString("base64")}`;
	};
	const imageItem = (image_url: string, detail?: string) => ({
		type: "message",
		role: "user",
		content: [{ type: "input_image", image_url, ...(detail ? { detail } : {}) }],
	});

	it("reads PNG and GIF dimensions from the header bytes", () => {
		const gif = Buffer.alloc(10);
		gif.write("GIF89a", 0, "latin1");
		gif.writeUInt16LE(100, 6);
		gif.writeUInt16LE(33, 8);
		assert.deepEqual(imageDimensionsFromBytes(Buffer.from(pngDataUrl(64, 96).split(",")[1], "base64")), { width: 64, height: 96 });
		assert.deepEqual(imageDimensionsFromBytes(gif), { width: 100, height: 33 });
		assert.equal(imageDimensionsFromBytes(Buffer.from("not an image at all, nope")), null);
	});

	it("original detail on an inline image uses 32px patches of the decoded size", () => {
		assert.equal(estimateItemTokens(imageItem(pngDataUrl(64, 96), "original")), 6);
		assert.equal(estimateItemTokens(imageItem(pngDataUrl(1000, 1000), "original")), 1024);
		assert.equal(estimateItemTokens(imageItem(pngDataUrl(40_000, 40_000), "original")), 10_000, "capped at 10000 patches");
	});

	it("without original detail, or when dimensions are absent, the native 1844-token estimate applies", () => {
		assert.equal(estimateItemTokens(imageItem(pngDataUrl(64, 96))), 1844);
		assert.equal(estimateItemTokens(imageItem(pngDataUrl(64, 96), "high")), 1844);
		assert.equal(estimateItemTokens(imageItem("data:image/png;base64,AAA", "original")), 1844, "undecodable inline");
		assert.equal(estimateItemTokens(imageItem("https://example.test/a.png", "original")), 1844, "non-data URL");
	});

	it("a file reference with original detail has no dimensions and uses the maximum patch count", () => {
		const fileRef = { type: "message", role: "user", content: [{ type: "input_image", file_id: "file-1", detail: "original" }] };
		assert.equal(estimateItemTokens(fileRef), 10_000);
	});

	const wavDataUrl = (seconds: number, byteRate = 16_000) => {
		const dataSize = seconds * byteRate;
		const b = Buffer.alloc(44 + dataSize);
		b.write("RIFF", 0, "latin1");
		b.writeUInt32LE(36 + dataSize, 4);
		b.write("WAVE", 8, "latin1");
		b.write("fmt ", 12, "latin1");
		b.writeUInt32LE(16, 16);
		b.writeUInt16LE(1, 20);
		b.writeUInt16LE(1, 22);
		b.writeUInt32LE(16_000, 24);
		b.writeUInt32LE(byteRate, 28);
		b.writeUInt16LE(2, 32);
		b.writeUInt16LE(16, 34);
		b.write("data", 36, "latin1");
		b.writeUInt32LE(dataSize, 40);
		return `data:audio/wav;base64,${b.toString("base64")}`;
	};

	it("WAV raw bytes give the duration: 10 tokens per second, then 4 bytes per token", () => {
		const url = wavDataUrl(2);
		assert.equal(audioTokenCount(url), 20);
		assert.equal(estimateItemTokens({ type: "message", role: "user", content: [{ type: "input_audio", audio_url: url }] }), 20);
	});

	it("audio without a readable duration falls back to the native approximation of the URL", () => {
		for (const url of ["data:audio/mpeg;base64,AAAA", "data:audio/wav;base64,AAAA"]) {
			assert.equal(audioTokenCount(url), approxTokenCount(url));
		}
	});
});

describe("native retry policy, transport switch and abort", () => {
	const retryable = () => Object.assign(new Error("reset"), { retryable: true });
	const recorder = () => {
		const delays: number[] = [];
		return { delays, sleep: async (ms: number) => void delays.push(ms) };
	};

	it("foreground: min(provider retries, 2) per transport with 200 ms doubling backoff, then one transport switch resets the budget", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("x")]);
		const rec = recorder();
		let switches = 0;
		const { calls, send } = scripted([retryable()]);
		await assert.rejects(
			compactBackend({
				request: request(),
				history: wh,
				send,
				modelHash: MODEL_HASH,
				window: WINDOW,
				sleep: rec.sleep,
				random: () => 0.5,
				switchTransport: () => ++switches === 1,
			}),
			/reset/,
		);
		assert.equal(switches, 1);
		assert.equal(calls.length, 6);
		assert.deepEqual(rec.delays, [200, 400, 200, 400]);
	});

	it("without a transport switch the budget is the bounded per-transport count", async () => {
		const wh = seed(fakeSession(), [userMsg("x")]);
		const { calls, send } = scripted([retryable()]);
		await assert.rejects(compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW, sleep: recorder().sleep }), /reset/);
		assert.equal(calls.length, 1 + COMPACTION_STREAM_RETRIES);
	});

	it("the provider stream_max_retries lowers the budget; the native default is 5, capped at 2", async () => {
		assert.equal(PROVIDER_STREAM_MAX_RETRIES_DEFAULT, 5);
		const wh = seed(fakeSession(), [userMsg("x")]);
		const { calls, send } = scripted([retryable()]);
		await assert.rejects(compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW, sleep: recorder().sleep, streamMaxRetries: 1 }), /reset/);
		assert.equal(calls.length, 2);
	});

	it("background transport makes one attempt with no retry and no transport switch", async () => {
		const wh = seed(fakeSession(), [userMsg("x")]);
		const { calls, send } = scripted([retryable()]);
		let switched = false;
		await assert.rejects(
			compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW, transport: "background", switchTransport: () => ((switched = true), true) }),
			/reset/,
		);
		assert.equal(calls.length, 1);
		assert.equal(switched, false);
	});

	it("a server retry-after delay replaces the local backoff", async () => {
		const wh = seed(fakeSession(), [userMsg("x")]);
		const rec = recorder();
		const delayed = Object.assign(new Error("slow down"), { retryable: true, retryAfterMs: 1234 });
		const { calls, send } = scripted([delayed, [done(COMPACTION), completed()]]);
		await compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW, sleep: rec.sleep });
		assert.deepEqual(rec.delays, [1234]);
		assert.equal(calls.length, 2);
	});

	it("failed with a retryable class is retried; incomplete interrupted completes; content_filter is retried", async () => {
		const wh = seed(fakeSession(), [userMsg("x")]);
		const a = scripted([[{ type: "failed", message: "rate", retryable: true }], [done(COMPACTION), completed("resp-r")]]);
		const r1 = await compactBackend({ request: request(), history: wh, send: a.send, modelHash: MODEL_HASH, window: WINDOW, sleep: recorder().sleep });
		assert.equal(r1.responseId, "resp-r");
		assert.equal(a.calls.length, 2);

		const wh2 = seed(fakeSession(), [userMsg("x")]);
		const b = scripted([[done(COMPACTION), { type: "incomplete", reason: "interrupted", responseId: "resp-i" }]]);
		const r2 = await compactBackend({ request: request(), history: wh2, send: b.send, modelHash: MODEL_HASH, window: WINDOW });
		assert.equal(r2.responseId, "resp-i");

		const wh3 = seed(fakeSession(), [userMsg("x")]);
		const c = scripted([[{ type: "incomplete", reason: "content_filter" }], [done(COMPACTION), completed("resp-cf")]]);
		const r3 = await compactBackend({ request: request(), history: wh3, send: c.send, modelHash: MODEL_HASH, window: WINDOW, sleep: recorder().sleep });
		assert.equal(r3.responseId, "resp-cf");
		assert.equal(c.calls.length, 2);
	});

	it("an abort during the backoff ends the request as aborted and installs nothing", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("x")]);
		const before = session.entries.length;
		const controller = new AbortController();
		const { send } = scripted([retryable()]);
		await assert.rejects(
			compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW, signal: controller.signal, sleep: async () => controller.abort() }),
			(e: unknown) => e instanceof CompactionError && e.code === "aborted",
		);
		assert.equal(session.entries.length, before);
	});
});

describe("built request seeding and fallback durability", () => {
	it("a Pi transcript without native history is refused until its built request is seeded, then compacts exactly that input", async () => {
		const session = fakeSession();
		session.pushMessage("legacy");
		const wh = newHistory(session);
		const { calls, send } = scripted([[done(COMPACTION), completed()]]);
		await assert.rejects(
			compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW }),
			(e: unknown) => e instanceof CompactionError && e.code === "no-native-base",
		);
		assert.equal(calls.length, 0);
		wh.seedBuiltRequest([userMsg("built user input")]);
		await compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW });
		const input = calls[0].body.input as Array<Record<string, unknown>>;
		assert.deepEqual(input[0], userMsg("built user input"));
		assert.deepEqual(input.at(-1), { type: "compaction_trigger" });
	});

	it("Pi entries are untouched: exactly one appended custom entry per installed compaction", async () => {
		const session = fakeSession();
		session.pushMessage("u1");
		const wh = newHistory(session);
		wh.seedBuiltRequest([userMsg("built")]);
		const before = structuredClone(session.entries);
		const { send } = scripted([[done(COMPACTION), completed()]]);
		await compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW });
		assert.equal(session.entries.length, before.length + 1);
		assert.deepEqual(session.entries.slice(0, before.length), before);
	});

	it("a fallback checkpoint is replayed under any model hash; the explicit compatibility check still rejects an unrelated hash", async () => {
		const session = fakeSession();
		const wh = seed(session, [userMsg("x")]);
		const { send } = scripted([[{ type: "failed", message: "primary" }], [done(COMPACTION), completed("resp-fb")]]);
		const result = await compactBackend({
			request: request({ model: "gpt-6-sol" }),
			history: wh,
			send,
			modelHash: "hash-primary-x",
			window: WINDOW,
			fallback: { request: request({ model: "gpt-6.1-sol" }), modelHash: "hash-fallback-x" },
		});
		assert.equal(result.modelHash, "hash-fallback-x");
		const primary = newHistory(session, "hash-primary-x").load();
		assert.equal(primary.mode, "native");
		assert.equal(primary.checkpointResponseId, "resp-fb");
		assert.equal(newHistory(session, "hash-fallback-x").load().mode, "native");
		const unrelated = newHistory(session, "hash-unrelated").load();
		assert.equal(unrelated.mode, "native");
		assert.deepEqual(unrelated.items.at(-1)?.item, COMPACTION);
		assert.equal(newHistory(session).load(undefined, "hash-unrelated").reason, "model-hash", "explicit compatibility check still rejects an unrelated hash");
	});
});

const retentionFixture = JSON.parse(
	readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "retention-native.json"), "utf8"),
) as { pin: { commit: string }; hookPrompt: Array<{ id: string; text: string; expected: boolean; why: string }> };

describe("hook prompt XML golden cases (upstream quick-xml semantics, fixture pinned to rust-v0.163.0)", () => {
	it("fixture is pinned to the verified commit", () => {
		assert.equal(retentionFixture.pin.commit, "83086188ae0614bd882818ff1aa23f3194962012");
	});
	for (const c of retentionFixture.hookPrompt) {
		it(`${c.id}: ${c.why}`, () => {
			assert.equal(isHookPromptText(c.text), c.expected);
		});
	}
});

describe("native retained selection (ported from compact_remote_v2.rs and compact_remote_v2_image_budget_tests.rs)", () => {
	const env = (item: unknown, clientAuthored = false) =>
		(clientAuthored ? { item, clientAuthored: true } : { item }) as unknown as WireEnvelope;
	const msg = (role: string, content: unknown[]) => ({ type: "message", role, content });
	const img = () => ({ type: "input_image", image_url: "data:image/png;base64,abc" });
	const fileImg = () => ({ type: "input_image", file_id: "file_123", detail: "original" });
	const txt = (t: string) => ({ type: "input_text", text: t });
	const audio = () => ({ type: "input_audio", audio_url: "data:audio/wav;base64,abc" });
	const items = (out: WireEnvelope[]) => out.map((e) => e.item);

	it("keeps newest messages first and middle-truncates the boundary (retained_history_truncation_keeps_newest_messages_first)", () => {
		const out = truncateRetained(
			[env(msg("user", [txt("old-old")])), env(msg("user", [txt("middle1234")])), env(msg("user", [txt("new")]))],
			3,
			false,
		);
		assert.deepEqual(items(out), [msg("user", [txt("midd…1 tokens truncated…1234")]), msg("user", [txt("new")])]);
	});

	it("truncates later text parts and keeps images whole (retained_history_truncation_preserves_images_and_truncates_later_text_parts)", () => {
		const parts = [txt("abcdef"), img(), { type: "output_text", text: "uvwxyz" }, txt("discarded after the text budget is exhausted"), fileImg()];
		const out = truncateRetained([env(msg("user", parts))], 3, false);
		assert.deepEqual(items(out), [
			msg("user", [txt("abcdef"), img(), { type: "output_text", text: "uv…1 tokens truncated…yz" }, fileImg()]),
		]);
	});

	it("image-only boundary is atomic and never backfilled by older messages (image_only_boundary_is_atomic_and_does_not_backfill_older_messages)", () => {
		const newest = msg("user", [txt("new")]);
		for (const [image, tokens] of [[img(), 1844], [fileImg(), 10_000]] as const) {
			const source = [env(msg("user", [txt("old")])), env(msg("user", [image])), env(newest)];
			assert.deepEqual(items(truncateRetained(source, tokens + 1, true)), [msg("user", [image]), newest]);
			assert.deepEqual(items(truncateRetained(source, tokens, true)), [newest]);
			assert.deepEqual(items(truncateRetained(source, 1, true)), [newest]);
		}
	});

	it("image-only message is kept when uncharged and dropped after the budget is spent (charges_image_only / drops_after_budget)", () => {
		const newest = msg("user", [txt("new")]);
		assert.deepEqual(
			items(truncateRetained([env(msg("user", [txt("old")])), env(msg("user", [img()])), env(newest)], 2, false)),
			[msg("user", [img()]), newest],
		);
		assert.deepEqual(items(truncateRetained([env(msg("user", [img()])), env(newest)], 1, false)), [newest]);
	});

	it("later image parts keep harness labels, audio and order atomically (later_image_parts_preserve_labels_audio_and_annotations)", () => {
		const label = '<image name=[Image #7] path="image.png">';
		const close = "</image>";
		const parts = [txt("earlier text"), txt(label), img(), txt(close), txt("keep"), audio()];
		const imageTokens = approxTokenCount(label) + 1844 + approxTokenCount(close);
		assert.deepEqual(items(truncateRetained([env(msg("user", parts))], imageTokens, true)), [msg("user", parts.slice(4))]);
		assert.deepEqual(items(truncateRetained([env(msg("user", parts))], imageTokens + 1, true)), [msg("user", parts.slice(1))]);
	});

	it("text-only boundaries are identical with and without the image budget (image_treatment_preserves_text_only_boundary_behavior)", () => {
		const source = [env(msg("user", [txt("earlier text"), txt("middle".repeat(20)), txt("later text"), audio()]))];
		for (const budget of [0, 1, 4, 16, 100]) {
			assert.deepEqual(truncateRetained(source, budget, true), truncateRetained(source, budget, false));
		}
	});

	it("client developer boundaries are identical with the image budget (image_treatment_preserves_client_developer_boundary_behavior)", () => {
		const source = [env(msg("developer", [img(), txt("a".repeat(1000))]), true)];
		for (const budget of [1871, 1879, 1880, 1950, 2200]) {
			assert.deepEqual(truncateRetained(source, budget, true), truncateRetained(source, budget, false));
		}
	});

	it("discards messages before truncating: oversized developer and contextual user messages are not retained (build_v2_compacted_history_discards_messages_before_truncating)", async () => {
		const dev = msg("developer", [txt(text(RETAINED_MESSAGE_TOKEN_BUDGET + 1))]);
		const contextual = msg("user", [txt(`<environment_context>\n${text(RETAINED_MESSAGE_TOKEN_BUDGET + 1)}\n</environment_context>`)]);
		const old = userMsg("old");
		const fresh = userMsg("new");
		const session = fakeSession();
		const wh = seed(session, [old, dev, contextual, fresh]);
		const { send } = scripted([[done(COMPACTION), completed()]]);
		await compactBackend({ request: request(), history: wh, send, modelHash: MODEL_HASH, window: WINDOW });
		assert.deepEqual(wh.load().items.slice(0, -1).map((e) => e.item), [old, fresh]);
	});

	it("retention runs on the projected prompt: a text-only compaction model keeps the placeholder, not the raw image, in the budget", async () => {
		const session = fakeSession();
		const imageBoundary = msg("user", [txt("<image>"), img(), txt("</image>")]);
		const newest = userMsg(text(RETAINED_MESSAGE_TOKEN_BUDGET - 40));
		const wh = seed(session, [imageBoundary, newest]);
		const { calls, send } = scripted([[done(COMPACTION), completed()]]);
		await compactBackend({ request: request({ inputModalities: ["text"] }), history: wh, send, modelHash: MODEL_HASH, window: WINDOW });
		const kept = wh.load().items.slice(0, -1).map((e) => e.item) as Array<Record<string, unknown>>;
		assert.equal(kept.length, 2);
		assert.deepEqual(kept[1], newest);
		assert.deepEqual(kept[0].content, [txt("<image>"), txt(UNSUPPORTED_IMAGE_TEXT), txt("</image>")]);
		assert.equal(JSON.stringify(calls[0].body.input).includes("input_image"), false);
	});
});
