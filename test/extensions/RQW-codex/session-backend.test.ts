// Stock Pi compaction through public hooks and the real session controller, with fake credentials and SSE only.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import * as pi from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Model } from "@earendil-works/pi-ai";
import { uuidv7 } from "../../../extensions/RQW-codex/compaction.ts";
import { createSessionController } from "../../../extensions/RQW-codex/session.ts";
import { registerCodex } from "../../../extensions/RQW-codex/registration.ts";
import { CodexThreadTransport } from "../../../extensions/RQW-codex/transport.ts";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";
import { installRuntimeAuth } from "../../../extensions/RQW-codex/auth-runtime.ts";

const MODEL = { id: "gpt-6-luna", name: "GPT-6-Luna", api: "openai-codex-responses", provider: "openai-codex", baseUrl: "https://chatgpt.com/backend-api", reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 500000, maxTokens: 100000, thinkingLevelMap: {} } as unknown as Model<Api>;
const SUMMARY = "STOCK_SUMMARY: preserve the task and continue.";
const OLD = "COMPACTED_AWAY_ORIGINAL_TASK";
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const userMsg = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1700000000000 });
const assistant = (text: string, input = 10) => ({ role: "assistant", content: [{ type: "text", text }], api: MODEL.api, provider: MODEL.provider, model: MODEL.id, stopReason: "stop", timestamp: 1700000000001, usage: { input, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: input + 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const completed = (id: string, input = 10) => ({ type: "response.completed", response: { id, status: "completed", usage: { input_tokens: input, output_tokens: 2, total_tokens: input + 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
const textEvents = (id: string, text: string, input = 10) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
	completed(id, input),
];
const failed = (id: string, code = "invalid_prompt") => [
	{ type: "response.created", response: { id } },
	{ type: "response.failed", response: { id, status: "failed", error: { code, message: code === "context_length_exceeded" ? "Your input exceeds the context window of this model." : "bad summary" } } },
];
const upgradeRequired = async (): Promise<never> => { throw new SocketError(426, {}, "upgrade required", "upgrade-rejected"); };
const timing = { clock: { now: () => 1000000 }, random: () => 0.5, sleep: async () => {} };
type Call = { body: Record<string, any>; headers: Record<string, string> };
type Step = unknown[] | ((options: any) => AsyncIterable<unknown>);

async function withSession(steps: Step[], run: (h: {
	session: pi.AgentSession; controller: ReturnType<typeof createSessionController>; calls: Call[];
	lifecycle: any[]; hooks: any[]; release: () => void; dir: string;
}) => Promise<void>, seed = true) {
	const dir = mkdtempSync(join(tmpdir(), "rqw-codex-stock-facade-"));
	let session: pi.AgentSession | undefined;
	const controllers: ReturnType<typeof createSessionController>[] = [];
	let releaseRegistration = () => {};
	let releaseAuth = () => {};
	const calls: Call[] = [];
	const hooks: any[] = [];
	try {
		const store = new InMemoryCredentialStore();
		const exp = Math.floor(Date.now() / 1000) + 3600;
		await store.modify("openai-codex", async () => ({ type: "oauth", access: `${b64({ alg: "none" })}.${b64({ exp, "https://api.openai.com/auth": { chatgpt_account_id: "acct-codex-1" } })}.sig`, refresh: "fake-refresh", expires: exp * 1000, accountId: "acct-codex-1" }) as never);
		const runtime = await pi.ModelRuntime.create({ credentials: store, modelsPath: null, refreshOnCreate: false });
		releaseAuth = installRuntimeAuth(runtime);
		const postEvents = ((options: any) => {
			calls.push({ body: JSON.parse(zstdDecompressSync(Buffer.from(options.body)).toString("utf8")), headers: options.headers });
			const events = steps.shift();
			if (!events) throw new Error("unexpected SSE request");
			if (typeof events === "function") return events(options);
			return (async function* () { options.onResponse({ status: 200, headers: {} }); for (const value of events) yield { text: JSON.stringify(value), value }; })();
		}) as any;
		const dependencies = { ...timing, connect: upgradeRequired, postEvents, fetch: async () => { throw new Error("real network forbidden"); } };
		const loader = new pi.DefaultResourceLoader({ cwd: dir, agentDir: dir, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalExtensionPaths: [], extensionFactories: [(api) => {
			api.on("before_provider_request", (event) => { hooks.push(event); });
			releaseRegistration = registerCodex(api, {
				installationId: "inst-1",
				createController: (created) => {
					const controller = createSessionController({ ...created, dependencies });
					controllers.push(controller);
					return controller;
				},
				createDirectTransport: () => ({
					stream(model, context, streamOptions) {
						const threadId = uuidv7();
						const transport = new CodexThreadTransport({
							identity: { installationId: "inst-1", windowId: `${threadId}:0`, windowNumber: 0, contextWindowId: uuidv7(), rootSessionId: threadId, threadId },
							store,
							dependencies,
						});
						const stream = transport.stream(model, context, streamOptions);
						const dispose = () => transport.dispose();
						void stream.result().then(dispose, dispose);
						return stream;
					},
				}),
			});
			api.on("session_shutdown", () => releaseRegistration());
		}] });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const manager = pi.SessionManager.create(dir, dir);
		if (seed) {
			manager.appendMessage(userMsg(OLD) as never);
			manager.appendMessage(assistant("old answer") as never);
			manager.appendMessage(userMsg("KEPT_TAIL ".repeat(100)) as never);
		}
		({ session } = await pi.createAgentSession({ cwd: dir, agentDir: dir, resourceLoader: loader, modelRuntime: runtime, model: MODEL, sessionManager: manager, settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: true, reserveTokens: 10000, keepRecentTokens: 100 } }) }));
		await session.bindExtensions({ mode: "tui" });
		const controller = controllers[0];
		assert.ok(controller, "production registration binds the session controller");
		const lifecycle: any[] = [];
		const unsubscribe = session.subscribe((event) => lifecycle.push(event));
		try { await run({ session, controller, calls, lifecycle, hooks, release: releaseRegistration, dir }); }
		finally { unsubscribe(); }
	} finally {
		releaseRegistration();
		session?.dispose();
		releaseAuth();
		rmSync(dir, { recursive: true, force: true });
	}
}

async function primeTurn(controller: ReturnType<typeof createSessionController>, messages = [userMsg(OLD)]) {
	controller.policy.beginRun({ kind: "run" });
	try { for await (const event of controller.stream(MODEL, { systemPrompt: "SYSTEM", messages, tools: [] }, {})) void event; }
	finally { controller.policy.endRun({ aborted: false }); }
}
function compactions(session: pi.AgentSession) { return session.sessionManager.getBranch().filter((entry) => entry.type === "compaction"); }
function assertNormalSummary(call: Call) {
	assert.equal(call.body.model, MODEL.id);
	assert.equal(call.body.input.some((item: any) => item.type === "compaction_trigger" || item.type === "compaction"), false);
	assert.equal(JSON.stringify(call.body.input).split(OLD).length - 1, 1, "conversation serialized once");
	assert.match(JSON.stringify(call.body.input), /<conversation>/);
	assert.match(JSON.stringify(call.body.input), /summary|summariz/i);
	assert.equal(JSON.parse(call.headers["x-codex-turn-metadata"] ?? "{}").compaction, undefined);
}

it("[stock facade] manual compact sends one normal summary request and installs one Pi entry without advancing the native window", async () => {
	await withSession([textEvents("r1", "ok"), textEvents("summary", SUMMARY)], async ({ session, controller, calls }) => {
		await primeTurn(controller);
		const keptId = session.sessionManager.getBranch().filter((e) => e.type === "message").at(-1)!.id;
		const tokensBefore = session.getContextUsage()!.tokens;
		const result = await session.compact();
		assert.equal(calls.length, 2);
		assertNormalSummary(calls[1]);
		assert.equal(controller.wireState?.window.number, 0);
		assert.equal(controller.wireState?.history.load().checkpointEntryId, null);
		const entries = compactions(session);
		assert.equal(entries.length, 1);
		assert.equal(entries[0].summary, SUMMARY);
		assert.equal(entries[0].firstKeptEntryId, result.firstKeptEntryId);
		assert.equal(entries[0].tokensBefore, result.tokensBefore);
		assert.equal(result.tokensBefore, tokensBefore);
		assert.equal(result.firstKeptEntryId, keptId);
		const summaries = session.sessionManager.buildSessionContext().messages.filter((m) => m.role === "compactionSummary");
		assert.equal(summaries.length, 1);
		assert.equal(summaries[0].summary, SUMMARY);
		assert.equal(summaries[0].tokensBefore, tokensBefore);
	});
});

it("[stock facade] failed, incomplete and malformed summaries write nothing and are not retried; a valid summary installs once", async () => {
	const incomplete = textEvents("incomplete", "PARTIAL");
	incomplete[incomplete.length - 1] = { type: "response.incomplete", response: { id: "incomplete", status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } } as never;
	const malformed = [{ type: "response.created", response: { id: "malformed" } }, { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "call_bad", call_id: "call_bad", name: "not_a_summary", arguments: "{}" } }, completed("malformed")];
	await withSession([textEvents("r1", "ok"), failed("failed"), incomplete, malformed, textEvents("valid", SUMMARY)], async ({ session, controller, calls }) => {
		await primeTurn(controller);
		const before = JSON.stringify(session.sessionManager.getBranch());
		const wireBefore = JSON.stringify(controller.wireState?.history.load());
		for (let i = 0; i < 3; i++) {
			await assert.rejects(session.compact());
			assert.equal(calls.length, i + 2, "each candidate is sent exactly once");
			assert.equal(JSON.stringify(session.sessionManager.getBranch()), before);
			assert.equal(JSON.stringify(controller.wireState?.history.load()), wireBefore);
			assert.equal(controller.wireState?.window.number, 0);
			assert.equal(compactions(session).length, 0);
		}
		await session.compact();
		assert.equal(calls.length, 5);
		assert.equal(compactions(session).length, 1);
	});
});

it("[stock facade] malformed tool-call summary leaves window and session unchanged without retry", async () => {
	const bad = [{ type: "response.created", response: { id: "bad" } }, { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "call_bad", call_id: "call_bad", name: "wrong", arguments: "{}" } }, completed("bad")];
	await withSession([textEvents("r1", "ok"), bad], async ({ session, controller, calls }) => {
		await primeTurn(controller);
		const before = JSON.stringify(session.sessionManager.getBranch());
		await assert.rejects(session.compact());
		assert.equal(calls.length, 2);
		assert.equal(JSON.stringify(session.sessionManager.getBranch()), before);
		assert.equal(controller.wireState?.window.number, 0);
		assert.equal(controller.wireState?.history.load().checkpointEntryId, null);
		assert.equal(compactions(session).length, 0);
	});
});

it("[stock facade] before_provider_request fires once per summary and selected reasoning reaches the normal body", async () => {
	await withSession([textEvents("r1", "ok"), textEvents("summary", SUMMARY)], async ({ session, controller, calls, hooks }) => {
		await primeTurn(controller);
		hooks.length = 0;
		session.setThinkingLevel("high");
		await session.compact();
		assert.equal(calls.length, 2);
		assert.equal(calls[1].body.reasoning.effort, "high");
		assert.equal(hooks.length, 1);
	});
});

it("[stock facade] public hook release removes its handler and stock session methods remain inherited throughout", async () => {
	await withSession([], async ({ session, controller, release, calls }) => {
		const methods = ["compact", "_runAutoCompaction", "_checkCompaction", "_exceedsCompactionThreshold", "_compactBeforeNextAssistantResponse", "getContextUsage"];
		for (const name of methods) assert.equal(Object.hasOwn(session, name), false, name);
		assert.equal(session.extensionRunner?.hasHandlers("session_before_compact"), true);
		release();
		controller.release();
		assert.equal(session.extensionRunner?.hasHandlers("session_before_compact"), false);
		assert.equal(session.extensionRunner?.hasHandlers("session_compact"), false);
		for (const name of methods) assert.equal(Object.hasOwn(session, name), false, name);
		assert.equal(calls.length, 0);
	});
});

it("[stock facade] manual compact without a prior turn sends exactly one normal request and writes a summary", async () => {
	await withSession([textEvents("summary", SUMMARY)], async ({ session, calls }) => {
		await session.compact();
		assert.equal(calls.length, 1);
		assertNormalSummary(calls[0]);
		assert.equal(compactions(session).length, 1);
		assert.equal(compactions(session)[0].summary, SUMMARY);
	});
});

it("[stock facade] Pi compaction preserves original physical messages and usage without a portable context-edit marker", async () => {
	await withSession([textEvents("r1", "ok"), textEvents("summary", SUMMARY)], async ({ session, controller }) => {
		const before = JSON.stringify(session.sessionManager.getBranch().filter((e) => e.type === "message"));
		await primeTurn(controller);
		await session.compact();
		const branch = session.sessionManager.getBranch();
		assert.equal(JSON.stringify(branch.filter((e) => e.type === "message")), before);
		assert.equal(branch.filter((e) => e.type === "context_edit").length, 0);
		assert.equal(compactions(session).length, 1);
		assert.equal(controller.wireState?.window.number, 0);
		assert.equal(controller.wireState?.history.load().checkpointEntryId, null);
	});
});

it("[stock facade] post-compaction usage and release persist a normal compaction entry visible to stock reopen", async () => {
	await withSession([textEvents("r1", "ok"), textEvents("summary", SUMMARY)], async ({ session, controller, calls, release, dir }) => {
		await primeTurn(controller);
		await session.compact();
		session.sessionManager.appendMessage(assistant("after") as never);
		controller.release();
		release();
		const manager = pi.SessionManager.open(session.sessionManager.getSessionFile()!, dir);
		const branch = manager.getBranch();
		assert.equal(branch.filter((e) => e.type === "compaction").length, 1);
		assert.equal(branch.filter((e) => e.type === "context_edit").length, 0);
		const messages = manager.buildSessionContext().messages;
		assert.equal(messages.filter((m) => m.role === "compactionSummary").length, 1);
		assert.match(JSON.stringify(messages), /STOCK_SUMMARY/);
		const after = branch.filter((e) => e.type === "message" && e.message.role === "assistant" && JSON.stringify(e.message.content).includes("after"));
		assert.equal(after.length, 1);
		assert.deepEqual(after[0].message.usage, assistant("after").usage);
		assert.equal(calls.length, 2, "release sends nothing");
	});
});

it("[stock facade] summary has normal operation identity; next turn has a fresh full-input request with summary instead of old history", async () => {
	await withSession([textEvents("r1", "ok"), textEvents("summary", SUMMARY), textEvents("r2", "next")], async ({ session, controller, calls }) => {
		await primeTurn(controller);
		await session.compact();
		const summary = calls[1];
		assertNormalSummary(summary);
		const meta = summary.body.client_metadata;
		const turn = JSON.parse(meta["x-codex-turn-metadata"]);
		const header = JSON.parse(summary.headers["x-codex-turn-metadata"]);
		assert.match(meta.session_id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(meta.session_id, meta.thread_id, "summary owns a request-local root thread");
		assert.notEqual(meta.session_id, calls[0].body.client_metadata.session_id);
		assert.equal(header.thread_id, meta.thread_id);
		assert.equal(turn.thread_id, meta.thread_id);
		assert.equal(meta.turn_id, undefined, "sessionless summary has no logical session turn");
		assert.equal(turn.compaction, undefined);
		assert.equal(header.compaction, undefined);
		const messages = session.sessionManager.buildSessionContext().messages;
		await primeTurn(controller, pi.convertToLlm(messages) as never);
		assert.equal(calls.length, 3);
		const next = calls[2].body;
		assert.equal(next.previous_response_id, undefined);
		assert.match(JSON.stringify(next.input), /STOCK_SUMMARY/);
		assert.equal(JSON.stringify(next.input).includes(OLD), false);
		assert.equal(typeof next.client_metadata.turn_id, "string");
		assert.notEqual(next.client_metadata.turn_id, calls[0].body.client_metadata.turn_id);
		assert.equal(JSON.parse(next.client_metadata["x-codex-turn-metadata"]).compaction, undefined);
		assert.equal(controller.wireState?.window.number, 0);
	});
});

it("[stock facade] aborting a held summary settles compact without installing an entry or sending another request", async () => {
	let started!: () => void;
	const ready = new Promise<void>((resolve) => { started = resolve; });
	const held = async function* (options: any) {
		options.onResponse({ status: 200, headers: {} });
		started();
		await new Promise<void>((_resolve, reject) => {
			const abort = () => reject(new Error("summary aborted"));
			if (options.signal.aborted) abort();
			else options.signal.addEventListener("abort", abort, { once: true });
		});
	};
	await withSession([held], async ({ session, calls, lifecycle }) => {
		const before = JSON.stringify(session.sessionManager.getBranch());
		const compact = session.compact();
		const rejected = assert.rejects(compact);
		await ready;
		assert.equal(session.isCompacting, true);
		session.abortCompaction();
		await rejected;
		assert.equal(session.isCompacting, false);
		assert.equal(calls.length, 1);
		assert.equal(JSON.stringify(session.sessionManager.getBranch()), before);
		assert.equal(compactions(session).length, 0);
		assert.deepEqual(lifecycle.filter((e) => e.type === "compaction_end").map((e) => [e.reason, e.aborted, e.willRetry]), [["manual", true, false]]);
	});
});

it("[stock facade] public lifecycle reports manual, threshold and overflow reasons instead of native phases", async () => {
	for (const reason of ["manual", "threshold", "overflow"] as const) {
		const steps = reason === "manual" ? [textEvents("summary", SUMMARY)] : reason === "threshold" ? [textEvents("turn", "large", 490001), textEvents("summary", SUMMARY)] : [failed("overflow", "context_length_exceeded"), textEvents("summary", SUMMARY), textEvents("retry", "recovered")];
		await withSession(steps, async ({ session, calls, lifecycle }) => {
			if (reason === "manual") await session.compact();
			else await session.prompt("Continue. ".repeat(100));
			await session.waitForIdle();
			assert.deepEqual(lifecycle.filter((e) => e.type === "compaction_start").map((e) => e.reason), [reason]);
			assert.deepEqual(lifecycle.filter((e) => e.type === "compaction_end").map((e) => [e.reason, e.aborted, e.willRetry]), [[reason, false, reason === "overflow"]]);
			assert.equal(calls.length, reason === "manual" ? 1 : reason === "threshold" ? 2 : 3);
			assert.equal(compactions(session).length, 1);
			assert.equal(lifecycle.filter((e) => e.type === "compaction_end")[0].result.summary, compactions(session)[0].summary);
			if (reason !== "manual") {
				steps.push(textEvents("next", "continued"));
				await session.prompt("Continue after compaction.");
				await session.waitForIdle();
				assert.equal(calls.length, reason === "threshold" ? 3 : 4);
				assert.match(JSON.stringify(calls.at(-1)!.body.input), /STOCK_SUMMARY/);
				assert.equal(calls.at(-1)!.body.previous_response_id, undefined);
				assert.equal(compactions(session).length, 1, "stale usage must not cause another compaction");
				assert.deepEqual(lifecycle.filter((e) => e.type === "compaction_start").map((e) => e.reason), [reason]);
			}
			for (const call of calls) assert.equal(JSON.parse(call.headers["x-codex-turn-metadata"] ?? "{}").compaction, undefined);
		}, reason !== "overflow");
	}
});
