import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import anthropic from "../../../extensions/RQW-anthropic/index.ts";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { normalizeContext, type AssistantMessage } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { AgentSession, ModelRuntime, createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { installRecoveryHooks } from "../../../extensions/RQW-anthropic/retry.ts";
import { createOverlay } from "../../../extensions/RQW-anthropic/transport.ts";

const ACCESS = "sk-ant-oat01-fake-retry";
const base = builtinProviders().find(provider => provider.id === "anthropic")!;
const model = base.getModels()[0];
const context = { messages: [{ role: "user" as const, content: "fake prompt", timestamp: 1 }] };
const overlay = createOverlay(base, () => undefined, "device");
const settle = () => new Promise(resolve => setImmediate(resolve));
const sse = (events: unknown[]) => new Response(events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
	headers: { "content-type": "text/event-stream" },
});
const start = { type: "message_start", message: { id: "fake", model: model.id, usage: { input_tokens: 1, output_tokens: 0 } } };
const partial = [start,
	{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
	{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "PARTIAL" } },
];

// Hooks and fake clocks are installed inside this suite only: tests of other extensions share the process.
describe("RQW-anthropic retry planning", () => {
	let release: () => void;
	beforeEach(() => { release = installRecoveryHooks(); });
	afterEach(() => { release(); mock.timers.reset(); });

	/** The error message Pi would see for an HTTP rejection; the SDK retries are off, so one fetch is one attempt. */
	async function rejected(status: number, type: string, headers: Record<string, string>) {
		let calls = 0;
		const message = await overlay.streamSimple(model, normalizeContext(context), { apiKey: ACCESS, fetch: async () => {
			calls++;
			return Response.json({ type: "error", error: { type, message: "fake" } }, { status, headers });
		} }).result();
		assert.equal(calls, 1, "one request per attempt: the SDK's own retries stay off");
		return message;
	}

	/** Pi's own retry methods on a minimal session: the real code runs, only the session around it is a stand-in. */
	function session(retry: { maxRetries?: number } = {}) {
		const events: { type: string; delayMs?: number; attempt?: number }[] = [];
		const settings = { enabled: true, maxRetries: 3, baseDelayMs: 2000, maxAgentDelayMs: 60_000, ...retry };
		const fake = {
			model, events, _retryAttempt: 0, _retryAbortController: undefined as AbortController | undefined,
			modelRuntime: { getRegisteredProviderConfig: () => ({ streamSimple: overlay.streamSimple }) },
			settingsManager: { getRetrySettings: () => settings },
			_modelForMessage: () => model, _emit: (event: { type: string }) => events.push(event), _omitRecoveryAttempt() {},
			_finishCancelledRetry: (AgentSession.prototype as unknown as { _finishCancelledRetry(): void })._finishCancelledRetry,
		};
		const proto = AgentSession.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
		return {
			fake,
			isRetryable: (message: AssistantMessage) => proto._isRetryableError.call(fake, message) as boolean,
			prepare: (message: AssistantMessage) => proto._prepareRetry.call(fake, message) as Promise<boolean>,
			abort: () => proto.abortRetry.call(fake),
		};
	}

	it("does not retry a 429 the server marked x-should-retry false", async () => {
		const message = await rejected(429, "rate_limit_error", { "x-should-retry": "false" });
		assert.equal(session().isRetryable(message), false);
	});

	it("retries an overload 529 api_error the server marked x-should-retry true", async () => {
		const message = await rejected(529, "api_error", { "x-should-retry": "true" });
		assert.equal(session().isRetryable(message), true);
	});

	it("waits the server's Retry-After, not Pi's two seconds, and keeps Pi's attempt count", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
		const message = await rejected(429, "rate_limit_error", { "retry-after": "30" });
		const { fake, prepare } = session({ maxRetries: 1 });
		let outcome: boolean | undefined;
		const first = prepare(message).then(value => { outcome = value; });
		await settle();
		assert.equal(fake.events[0]?.delayMs, 30_000);
		mock.timers.tick(2_000);
		await settle();
		assert.equal(outcome, undefined, "still waiting after Pi's own two seconds");
		mock.timers.tick(28_000);
		await first;
		assert.equal(outcome, true);
		assert.equal(fake.settingsManager.getRetrySettings().baseDelayMs, 2000, "Pi's settings are restored");
		assert.equal(await prepare(message), false, "one budget: Pi's maxRetries still ends the retries");
		assert.equal(fake.events.length, 1);
	});

	it("stops waiting for a server delay when the retry is aborted", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
		const message = await rejected(429, "rate_limit_error", { "retry-after": "30" });
		const { fake, prepare, abort } = session();
		const pending = prepare(message);
		await settle();
		assert.equal(fake.events[0]?.delayMs, 30_000);
		abort();
		assert.equal(await pending, false);
		assert.equal(fake.events.at(-1)?.type, "auto_retry_end");
	});

	it("ends with a clear error when the server delay is longer than the supported wait", async () => {
		const message = await rejected(429, "rate_limit_error", { "retry-after": "90" });
		const { fake, prepare } = session();
		assert.equal(await prepare(message), false);
		assert.match(message.errorMessage ?? "", /^Server requested 90s retry delay \(max: 60s\)/);
		assert.equal(fake.events.length, 0);
	});

	it("leaves a session whose runtime is not ours to stock behavior", async () => {
		const message = await rejected(429, "rate_limit_error", { "x-should-retry": "false" });
		const { fake, isRetryable } = session();
		for (const runtime of [{}, undefined]) {
			(fake as { modelRuntime: unknown }).modelRuntime = runtime;
			assert.equal(isRetryable(message), true, "Pi's own classification, not x-should-retry");
		}
	});

	it("never replays a turn that already produced output, whatever the server says", async () => {
		const message = await overlay.streamSimple(model, normalizeContext(context), { apiKey: ACCESS, fetch: async () =>
			sse([...partial, { type: "error", error: { type: "overloaded_error", message: "fake overload" } }]) }).result();
		message.diagnostics = [...(message.diagnostics ?? []),
			{ type: "rqw_anthropic_http", timestamp: 1, details: { status: 529, shouldRetry: true, retryAfterMs: 1000 } }];
		assert.equal(session().isRetryable(message), false);
	});

	// Compaction and branch summaries keep Pi's own retry loop; they only receive the server's directives.
	async function compaction(statuses: (Response | null)[], maxRetries = 3, maxAgentDelayMs?: number) {
		let gate: Promise<void> | undefined;
		const events: { type: string; delayMs?: number }[] = [];
		const times: number[] = [];
		const summary = () => sse([start,
			{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "SUMMARY" } },
			{ type: "content_block_stop", index: 0 },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }, { type: "message_stop" }]);
		const modelRuntime = {
			getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true, checkAuth: async () => ({}),
			getAuth: async () => { const wait = gate; gate = undefined; await wait; return { auth: { apiKey: ACCESS }, env: {}, source: "OAuth" }; }, isUsingOAuth: () => true,
			getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [], getProviderHeaders: () => undefined,
			getRegisteredProviderConfig: () => ({ streamSimple: overlay.streamSimple }),
			streamSimple: (m: typeof model, c: Parameters<typeof overlay.streamSimple>[1], o: object) => overlay.streamSimple(m, c, { ...o, apiKey: (o as { apiKey?: string }).apiKey ?? ACCESS, fetch: async () => {
				times.push(Date.now());
				return statuses.shift() ?? summary();
			} } as never),
		};
		const settingsManager = SettingsManager.inMemory({ compaction: { enabled: true, keepRecentTokens: 10 }, retry: { enabled: true, maxRetries, baseDelayMs: 2000, ...(maxAgentDelayMs === undefined ? {} : { maxAgentDelayMs }) } } as never);
		const resourceLoader = new DefaultResourceLoader({ cwd: process.cwd(), agentDir: process.cwd(), settingsManager, noExtensions: true,
			noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPromptOverride: () => "system" } as never);
		await resourceLoader.reload();
		const sessionManager = SessionManager.inMemory(process.cwd());
		for (let turn = 0; turn < 4; turn++) {
			sessionManager.appendMessage({ role: "user", content: `question ${turn} ${"x".repeat(400)}`, timestamp: turn });
			sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: `answer ${turn} ${"y".repeat(400)}` }], api: model.api,
				provider: model.provider, model: model.id, stopReason: "stop", timestamp: turn,
				usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
		}
		const { session } = await createAgentSession({ cwd: process.cwd(), modelRuntime: modelRuntime as never, model: model as never, resourceLoader,
			settingsManager, sessionManager, tools: [] });
		session.subscribe(event => events.push(event as never));
		// The next authentication waits until the returned function is called.
		const hold = () => { const held = Promise.withResolvers<void>(); gate = held.promise; return held.resolve; };
		return { session, events, times, hold };
	}

	it("waits a summary's server Retry-After through Pi's own retry loop", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
		const { session, events, times } = await compaction([Response.json({ type: "error", error: { type: "rate_limit_error", message: "fake" } },
			{ status: 429, headers: { "retry-after": "30" } })]);
		const done = session.compact();
		await settle();
		assert.equal(events.find(event => event.type === "summarization_retry_scheduled")?.delayMs, 30_000);
		// The server's delay is waited in two steps, so move the clock one second at a time.
		for (let second = 0; second < 30; second++) {
			mock.timers.tick(1_000);
			await settle();
		}
		await done;
		assert.deepEqual(times.slice(0, 2), [0, 30_000]);
	});

	const failure = (status: number, type: string, headers: Record<string, string>) =>
		Response.json({ type: "error", error: { type, message: "fake" } }, { status, headers });

	function warningsFor(session: Awaited<ReturnType<typeof compaction>>["session"]) {
		const root = mkdtempSync(join(tmpdir(), "retry-warning-"));
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = root;
		const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
		const warnings: unknown[] = [];
		try {
			anthropic({ events: { on: () => () => {}, emit: (name: string, value: unknown) => {
				if (name === "rqw:background-warning:v1") warnings.push(value);
			} }, on: (name: string, handler: (event: unknown, ctx: unknown) => void) => handlers.set(name, handler),
			registerProvider() {} } as never);
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
		}
		handlers.get("rqw-anthropic:session-bind")!({ session }, { sessionManager: session.sessionManager });
		return { warnings, close: () => { handlers.get("session_shutdown")!({}, {}); rmSync(root, { recursive: true, force: true }); } };
	}

	it("emits a session warning for a refused turn, compaction, branch and bug-report retry", async () => {
		for (const kind of ["turn", "compaction", "branch", "bug-report"]) {
			const { session } = await compaction([failure(429, "rate_limit_error", { "x-should-retry": "false" })]);
			const { warnings, close } = warningsFor(session);
			try {
				if (kind === "turn") await session.prompt("hello");
				else if (kind === "compaction") await assert.rejects(session.compact());
				else if (kind === "branch") {
					const target = session.sessionManager.getBranch().find(entry => entry.type === "message")!;
					await assert.rejects(session.navigateTree(target.id, { summarize: true }));
				} else await assert.rejects(session.summarizeForBugReport({ signal: new AbortController().signal }));
				assert.deepEqual(warnings, [{ sessionId: session.sessionId, text: "anthropic: no retry" }], kind);
			} finally { close(); }
		}
	});

	for (const scenario of ["bad request", "disabled", "exhausted"]) {
		it(`does not warn for a ${scenario} turn that would not retry`, async () => {
			const status = scenario === "bad request" ? 400 : 429;
			const { session, times } = await compaction([failure(status, status === 400 ? "invalid_request_error" : "rate_limit_error", { "x-should-retry": "false" })], scenario === "exhausted" ? 0 : 3);
			if (scenario === "disabled") session.settingsManager.setRetryEnabled(false);
			const { warnings, close } = warningsFor(session);
			try {
				await session.prompt("hello");
				assert.equal(times.length, 1);
				assert.deepEqual(warnings, []);
			} finally { close(); }
		});
	}

	it("does not retry a summary the server marked x-should-retry false", async () => {
		const { session, times } = await compaction([failure(429, "rate_limit_error", { "x-should-retry": "false" })]);
		await assert.rejects(session.compact(), /x-should-retry: false/);
		assert.equal(times.length, 1);
	});

	it("retries a summary overload 529 api_error the server marked x-should-retry true", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
		const { session, times } = await compaction([failure(529, "api_error", { "x-should-retry": "true" })]);
		const done = session.compact();
		await settle();
		for (let second = 0; second < 4; second++) {
			mock.timers.tick(1_000);
			await settle();
		}
		await done;
		assert.deepEqual(times.slice(0, 2), [0, 2_000]);
	});

	it("ends a summary with a clear error when the server delay is too long", async () => {
		const { session, times } = await compaction([failure(429, "rate_limit_error", { "retry-after": "90" })]);
		await assert.rejects(session.compact(), /Server requested 90s retry delay \(max: 60s\)/);
		assert.equal(times.length, 1);
	});

	it("does not retry a bug-report summary the server marked x-should-retry false", async () => {
		const { session, times } = await compaction([failure(429, "rate_limit_error", { "x-should-retry": "false" })]);
		await assert.rejects(session.summarizeForBugReport({ signal: new AbortController().signal }), /x-should-retry: false/);
		assert.equal(times.length, 1);
	});

	it("waits a bug-report summary's server Retry-After instead of Pi's backoff", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
		const { session, times } = await compaction([failure(429, "rate_limit_error", { "retry-after": "30" })]);
		const done = session.summarizeForBugReport({ signal: new AbortController().signal });
		await settle();
		mock.timers.tick(2_000);
		await settle();
		assert.deepEqual(times, [0], "Pi's own two seconds have passed");
		mock.timers.tick(28_000);
		await done;
		assert.deepEqual(times, [0, 30_000]);
	});

	it("stops a summary's server wait when the compaction is aborted", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
		const { session, times, events } = await compaction([failure(429, "rate_limit_error", { "retry-after": "30" })]);
		const done = session.compact();
		await settle();
		assert.equal(events.find(event => event.type === "summarization_retry_scheduled")?.delayMs, 30_000);
		session.abortCompaction();
		await assert.rejects(done, /Compaction cancelled/);
		mock.timers.tick(60_000);
		await settle();
		assert.equal(times.length, 1);
	});

	// Pi's private methods may change shape in an update: the planning must then stay stock, not break the session.
	it("keeps stock retry behavior when a private retry method has another shape", async () => {
		class FakeRuntime {}
		class FakeSession {}
		const copy = (target: object, source: object, skip?: string) => {
			for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(source))) {
				if (name !== "constructor" && name !== skip) Object.defineProperty(target, name, descriptor);
			}
		};
		copy(FakeRuntime.prototype, ModelRuntime.prototype);
		copy(FakeSession.prototype, AgentSession.prototype, "_prepareRetry");
		const stock = Object.getOwnPropertyDescriptor(FakeSession.prototype, "_isRetryableError")!.value;
		const undo = installRecoveryHooks(FakeRuntime as unknown as typeof ModelRuntime, FakeSession as unknown as typeof AgentSession);
		try {
			assert.equal("_prepareRetry" in FakeSession.prototype, false, "the missing method is not invented");
			assert.notEqual((FakeSession.prototype as unknown as Record<string, unknown>)._isRetryableError, stock, "the rest stays patched");
			assert.equal(typeof (FakeSession.prototype as unknown as Record<string, unknown>)._summarizationRetryCallbacks, "function");
		} finally { undo(); }
	});

	// A normal agent turn: Pi's real session classifies, plans and waits; only the network and the clock are fake.
	const lastAnswer = (session: Awaited<ReturnType<typeof compaction>>["session"]) =>
		[...session.messages].reverse().find(message => message.role === "assistant") as AssistantMessage;

	it("a turn does not retry a 429 marked x-should-retry false", async () => {
		const { session, times } = await compaction([failure(429, "rate_limit_error", { "x-should-retry": "false" })]);
		await session.prompt("hello");
		assert.equal(times.length, 1);
		assert.equal(lastAnswer(session).stopReason, "error");
	});

	it("a turn retries a 529 api_error marked x-should-retry true after Pi's own backoff", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
		const { session, times } = await compaction([failure(529, "api_error", { "x-should-retry": "true" })]);
		const done = session.prompt("hello");
		await settle();
		mock.timers.tick(2_000);
		await done;
		assert.deepEqual(times, [0, 2_000]);
		assert.equal(lastAnswer(session).stopReason, "stop");
	});

	it("a turn waits the server's Retry-After, not Pi's two seconds", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
		const { session, times } = await compaction([failure(429, "rate_limit_error", { "retry-after": "30" })]);
		const done = session.prompt("hello");
		await settle();
		mock.timers.tick(2_000);
		await settle();
		assert.deepEqual(times, [0]);
		mock.timers.tick(28_000);
		await done;
		assert.deepEqual(times, [0, 30_000]);
		assert.equal(lastAnswer(session).stopReason, "stop");
	});

	it("a turn ends with a clear error when the server delay is too long", async () => {
		const { session, times } = await compaction([failure(429, "rate_limit_error", { "retry-after": "90" })]);
		await session.prompt("hello");
		assert.equal(times.length, 1);
		assert.match(lastAnswer(session).errorMessage ?? "", /^Server requested 90s retry delay \(max: 60s\)/);
	});

	it("a turn stops waiting for the server delay when the retry is aborted", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
		const { session, times, events } = await compaction([failure(429, "rate_limit_error", { "retry-after": "30" })]);
		const done = session.prompt("hello");
		await settle();
		session.abortRetry();
		await done;
		mock.timers.tick(60_000);
		await settle();
		assert.equal(times.length, 1);
		assert.equal(events.find(event => event.type === "auto_retry_start")?.delayMs, 30_000);
		assert.equal(events.some(event => (event as { finalError?: string }).finalError === "Retry cancelled"), true);
	});

	it("a turn keeps Pi's single retry budget, however many server delays arrive", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
		const rejection = () => failure(429, "rate_limit_error", { "retry-after": "1" });
		const { session, times } = await compaction([rejection(), rejection(), rejection()], 1);
		const done = session.prompt("hello");
		await settle();
		mock.timers.tick(1_000);
		await done;
		assert.deepEqual(times, [0, 1_000], "one retry, as Pi's maxRetries says");
		assert.equal(lastAnswer(session).stopReason, "error");
	});

	// The branch summary has its own entry, navigating the tree.
	async function branch(answers: Response[]) {
		const made = await compaction(answers);
		const entries = made.session.sessionManager.getBranch();
		const target = entries.find(entry => entry.type === "message")!;
		return { ...made, summarize: () => made.session.navigateTree(target.id, { summarize: true }) };
	}

	it("a branch summary does not retry a 429 marked x-should-retry false", async () => {
		const { summarize, times } = await branch([failure(429, "rate_limit_error", { "x-should-retry": "false" })]);
		await assert.rejects(summarize(), /x-should-retry: false/);
		assert.equal(times.length, 1);
	});

	it("a branch summary waits the server's Retry-After through Pi's retry loop", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
		const { summarize, times, events } = await branch([failure(429, "rate_limit_error", { "retry-after": "30" })]);
		const done = summarize();
		await settle();
		assert.equal(events.find(event => event.type === "summarization_retry_scheduled")?.delayMs, 30_000);
		for (let second = 0; second < 30; second++) {
			mock.timers.tick(1_000);
			await settle();
		}
		await done;
		assert.deepEqual(times, [0, 30_000]);
	});

	// Pi's wait limit as a bound, through a normal agent turn.
	async function finishes(session: Awaited<ReturnType<typeof compaction>>["session"]) {
		return Promise.race([session.prompt("hello").then(() => "finished"), settle().then(() => "still waiting")]);
	}

	it("a turn treats Pi's wait limit of 0 as a bound, so a server delay is not waited", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
		const { session, times } = await compaction([failure(429, "rate_limit_error", { "retry-after": "5" })], 3, 0);
		assert.equal(await finishes(session), "finished");
		assert.equal(times.length, 1);
		assert.match(lastAnswer(session).errorMessage ?? "", /^Server requested 5s retry delay \(max: 0s\)/);
	});

	it("a turn never waits longer than a timer can hold, however high Pi's limit is", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
		const { session, times } = await compaction([failure(429, "rate_limit_error", { "retry-after": "3000000" })], 3, Number.MAX_SAFE_INTEGER);
		assert.equal(await finishes(session), "finished");
		assert.equal(times.length, 1);
		assert.match(lastAnswer(session).errorMessage ?? "", /^Server requested 3000000s retry delay \(max: 2147483s\)/);
	});

	// Two bug-report summaries share one settings manager: neither may remove the other's pacing.
	it("keeps the server's directives for overlapping bug-report summaries and restores Pi's settings", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
		const { session, times, hold } = await compaction([failure(429, "rate_limit_error", { "retry-after": "5" }),
			null, failure(429, "rate_limit_error", { "x-should-retry": "false" })]);
		const signal = new AbortController().signal;
		const first = session.summarizeForBugReport({ signal });
		await settle();
		const release = hold();
		const second = session.summarizeForBugReport({ signal }).then(() => "retried", (error: Error) => error.message);
		await settle();
		mock.timers.tick(5_000);
		await first;
		release();
		assert.match(await second, /x-should-retry: false/);
		assert.equal(times.length, 3);
		assert.equal(Object.hasOwn(session.settingsManager, "getRetrySettings"), false, "no wrapper stays behind");
	});
});
