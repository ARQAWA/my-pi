// Runtime effects of the owned Codex facade on one real Pi 1.4.0 AgentSession: session.prompt, session.abort,
// session.compact, session.sendCustomMessage, the session subscription and the extension's context event, with the owned
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

/** Compaction output item with a chosen encrypted payload. */
const compactionWith = (id: string, encrypted: string) => [
	created(id),
	{ type: "response.output_item.done", output_index: 0, item: { type: "compaction", encrypted_content: encrypted } },
	completed(id, 9),
];

/** Encrypted reasoning plus assistant text: the raw items the durable wire must replay exactly. */
function answerEvents(id: string, text: string) {
	return [
		created(id),
		{ type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: `rs_${id}`, encrypted_content: `ENC-${id}`, summary: [] } },
		{ type: "response.output_item.done", output_index: 1, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
		completed(id, 1),
	];
}

const compactionEvents = (id: string) => [
	created(id),
	{ type: "response.output_item.done", output_index: 0, item: { type: "compaction", encrypted_content: "ENC+/==raw" } },
	completed(id, 9),
];

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
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: RESERVE }, retry: { enabled: false }, transport: "sse" }) }));
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

	it("accepted manual checkpoint: a triggerTurn custom message reaches the backend once with the checkpoint once and no trigger", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{ events: textEvents("resp_d1", "First.") },
			{ events: compactionEvents("resp_d_compact") },
			{ events: textEvents("resp_d2", "After checkpoint.") },
		];
		await withSession({ steps }, async ({ session, posts, events }) => {
			await session.prompt("first");
			await session.compact();
			assert.equal(posts.length, 2);
			assert.deepEqual(events.filter((e) => e.type === "compaction_end").map((e) => [e.reason, e.aborted]), [["manual", false]]);

			await session.sendCustomMessage({ customType: "rqw-runtime-probe", content: "CUSTOM-PROBE", display: false }, { triggerTurn: true });
			await session.waitForIdle();
			assert.equal(posts.length, 3, "the triggered turn reaches the backend exactly once");
			const input = posts[2]!.body.input as Array<Record<string, any>>;
			assert.equal(input.filter((item) => item.type === "compaction").length, 1, "the accepted checkpoint is sent once");
			assert.ok(JSON.stringify(input).includes("CUSTOM-PROBE"), "the custom message is in the request");
			assert.equal(input.some((item) => item.type === "compaction_trigger"), false);
		});
	});

	it("same-content public context edit after the accepted checkpoint keeps the checkpoint: the next request still carries it once", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{ events: textEvents("resp_e1", "First.") },
			{ events: compactionEvents("resp_e_compact") },
			{ events: textEvents("resp_e2", "Still checkpointed.") },
		];
		await withSession({ steps }, async ({ session, posts }) => {
			await session.prompt("first");
			await session.compact();
			const userEntry = session.sessionManager.getBranch().find((e) => e.type === "message" && (e as { message: { role: string } }).message.role === "user") as { id: string; message: { content: unknown } };
			assert.ok(userEntry, "a physical user entry exists");
			session.sessionManager.appendContextEdit(userEntry.id, { content: structuredClone(userEntry.message.content) } as never);

			await session.prompt("second");
			assert.equal(posts.length, 3);
			const input = posts[2]!.body.input as Array<Record<string, any>>;
			assert.equal(input.filter((item) => item.type === "compaction").length, 1, "the checkpoint survives the same-content edit");
		});
	});

	it("accepted manual checkpoint, then a different-content public edit of a source entry before it: the next request drops the checkpoint, carries the new content once, and keeps window thread:1 with the same context id", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{ events: textEvents("resp_f1", "F1-ANSWER") },
			{ events: compactionEvents("resp_f_compact") },
			{ events: textEvents("resp_f2", "F2-ANSWER") },
			{ events: textEvents("resp_f3", "F3-ANSWER") },
		];
		await withSession({ steps }, async ({ session, posts }) => {
			const thread = session.sessionId;
			await session.prompt("ORIGINAL-SOURCE");
			assert.equal(blobOf(posts[0]!).window_id, `${thread}:0`, "first request: window thread:0");
			const firstContext = blobOf(posts[0]!).context_window_id as string;
			assert.equal(typeof firstContext, "string");

			await session.compact();
			await session.prompt("NORMAL-AFTER-CP");
			assert.equal(blobOf(posts[2]!).window_id, `${thread}:1`, "accepted checkpoint: the normal request is window thread:1");
			const afterCp = blobOf(posts[2]!).context_window_id as string;
			assert.notEqual(afterCp, firstContext, "accepted checkpoint: a new context id");
			assert.equal((posts[2]!.body.input as Array<Record<string, any>>).filter((item) => item.type === "compaction").length, 1, "the accepted checkpoint is sent");

			const userEntry = session.sessionManager.getBranch().find((e) => e.type === "message" && (e as { message: { role: string } }).message.role === "user") as { id: string };
			session.sessionManager.appendContextEdit(userEntry.id, { content: "EDITED-SOURCE" } as never);

			await session.prompt("SMALL-SOURCE");
			assert.equal(posts.length, 4);
			const next = posts[3]!;
			const input = next.body.input as Array<Record<string, any>>;
			assert.equal(input.filter((item) => item.type === "compaction").length, 0, "the old opaque checkpoint is not sent");
			const json = JSON.stringify(input);
			assert.equal(json.split("EDITED-SOURCE").length - 1, 1, "the new content is sent exactly once");
			assert.equal(json.includes("ORIGINAL-SOURCE"), false, "the replaced content is not sent");
			assert.equal(blobOf(next).window_id, `${thread}:1`, "the rebase keeps window thread:1 (not 0, not 2)");
			assert.equal(blobOf(next).context_window_id, afterCp, "the rebase keeps the context id of window thread:1");
			assert.equal(next.body.client_metadata["x-codex-window-id"], `${thread}:1`);
		});
	});

	it("public navigateTree to the leaf before the accepted checkpoint: agent messages and branch are restored, and the next request has no checkpoint and the initial window thread:0 with the first context id", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{ events: textEvents("resp_g1", "G1-ANSWER") },
			{ events: compactionEvents("resp_g_compact") },
			{ events: textEvents("resp_g2", "G2-ANSWER") },
		];
		await withSession({ steps }, async ({ session, posts }) => {
			const thread = session.sessionId;
			await session.prompt("G-SOURCE");
			assert.equal(blobOf(posts[0]!).window_id, `${thread}:0`);
			const firstContext = blobOf(posts[0]!).context_window_id;
			const leaf = session.sessionManager.getLeafId();
			assert.ok(leaf, "a leaf before the checkpoint exists");
			const messagesBefore = JSON.stringify(session.messages);

			await session.compact();
			assert.equal(posts.length, 2);
			const result = await session.navigateTree(leaf, { summarize: false });
			assert.equal(result.cancelled, false);
			assert.equal(result.aborted, undefined);
			assert.equal(session.sessionManager.getLeafId(), leaf, "the branch leaf is restored");
			assert.equal(JSON.stringify(session.messages), messagesBefore, "the agent messages are restored");
			assert.equal(posts.length, 2, "navigation without summary sends no request");

			await session.prompt("G-AFTER-NAV");
			assert.equal(posts.length, 3);
			const next = posts[2]!;
			const input = next.body.input as Array<Record<string, any>>;
			assert.equal(input.filter((item) => item.type === "compaction").length, 0, "the accepted checkpoint is not an ancestor: not sent");
			assert.equal(blobOf(next).window_id, `${thread}:0`, "initial window thread:0");
			assert.equal(blobOf(next).context_window_id, firstContext, "initial context id of the first request");
			assert.ok(JSON.stringify(input).includes("G-SOURCE"), "the pre-checkpoint source is sent");
		});
	});

	it("real facade account rotation A to B: the physical thinking signature holds ENC_A2, the B manual compaction request carries visible text and no ENC_A1/ENC_A2/ENC_CPA, and only the B fresh scope accepts MEMENTO_B", { timeout: CASE_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{ events: signedAnswer("resp_h1", "ENC_A1", "A1-ANSWER-VISIBLE") },
			{ events: compactionWith("resp_h_cpa", "ENC_CPA") },
			{ events: signedAnswer("resp_h2", "ENC_A2", "A2-ANSWER-VISIBLE") },
			{ events: compactionWith("resp_h_b", "MEMENTO_B") },
			{ events: textEvents("resp_h3", "B-ANSWER") },
		];
		await withSession({ steps }, async ({ session, posts, events, runtime }) => {
			await session.prompt("A1-USER-VISIBLE");
			await session.compact();
			await session.prompt("A2-USER-VISIBLE");
			assert.equal(posts[0]!.account, ACCOUNT, "account A serves the first turn");

			const signatures = (session.messages as unknown as Array<Record<string, any>>).flatMap((m) =>
				m.role === "assistant" && Array.isArray(m.content) ? m.content.filter((b: Record<string, any>) => b.type === "thinking").map((b: Record<string, any>) => String(b.thinkingSignature ?? "")) : []);
			assert.ok(signatures.some((s) => s.includes("ENC_A2")), "the physical thinking signature carries ENC_A2");

			// Rotate the fake stored login to account B (fake JWT, same store the facade reads).
			const store = (runtime as unknown as { credentials: { modify(p: string, fn: () => Promise<unknown>): Promise<unknown> } }).credentials;
			await store.modify(CODEX_PROVIDER, async () => ({ type: "oauth", access: fakeAccess(ACCOUNT_B), refresh: "refresh-runtime-effects-b", expires: Date.now() + 3600_000, accountId: ACCOUNT_B }));

			await session.compact();
			assert.equal(posts.length, 4);
			const candidate = posts[3]!;
			assert.equal(candidate.account, ACCOUNT_B, "the candidate request is owned by account B");
			const candidateJson = JSON.stringify(candidate.body);
			for (const secret of ["ENC_A1", "ENC_A2", "ENC_CPA"]) assert.equal(candidateJson.includes(secret), false, `${secret} is not sent to account B`);
			for (const visible of ["A1-USER-VISIBLE", "A1-ANSWER-VISIBLE", "A2-USER-VISIBLE", "A2-ANSWER-VISIBLE"]) assert.ok(candidateJson.includes(visible), `${visible} is sent as visible text`);
			assert.equal((candidate.body.input as Array<Record<string, any>>).filter((item) => item.type === "compaction").length, 0, "no checkpoint of account A is sent to B");
			const compactions = events.filter((e) => e.type === "compaction_end").map((e) => [e.reason, e.aborted]);
			assert.deepEqual(compactions.at(-1), ["manual", false], "the B candidate is accepted");

			await session.prompt("B-SOURCE");
			assert.equal(posts.length, 5);
			const afterB = posts[4]!;
			assert.equal(afterB.account, ACCOUNT_B);
			const afterJson = JSON.stringify(afterB.body.input);
			assert.equal(afterJson.split("MEMENTO_B").length - 1, 1, "MEMENTO_B is carried once in the fresh B scope");
			for (const secret of ["ENC_A1", "ENC_A2", "ENC_CPA"]) assert.equal(afterJson.includes(secret), false, `${secret} is not carried by the B scope`);
		});
	});
});
