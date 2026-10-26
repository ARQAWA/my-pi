// Deterministic integration tests for the owned Codex streaming facade (extensions/RQW-codex/transport.ts).
// Fake SSE POST, fake WebSocket connector, injected clock/sleep/random, in-memory credential store, fake JWT.
// No network, no real credentials, no timers left running.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import * as zlib from "node:zlib";
import { InMemoryCredentialStore, type Api, type Context, type Model } from "@earendil-works/pi-ai";

import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";
import { SseError } from "../../../extensions/RQW-codex/sse.ts";
import { CODEX_AUTH_ORIGIN } from "../../../extensions/RQW-codex/auth-runtime.ts";
import { CodexThreadTransport, createOverlay } from "../../../extensions/RQW-codex/transport.ts";

const ACCOUNT = "acct_test_1";
const IDENTITY = {
	installationId: "11111111-2222-4333-8444-555555555555",
	windowId: "11111111-2222-4333-8444-555555555555:0",
	rootSessionId: "root-session-1",
	threadId: "thread-1",
};

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeAccess(tag = ""): string {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return `${b64url({ alg: "none" })}.${b64url({ exp, tag, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;
}

async function seededStore(access = fakeAccess()): Promise<InMemoryCredentialStore> {
	const store = new InMemoryCredentialStore();
	const exp = Math.floor(Date.now() / 1000) + 3600;
	await store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "refresh-1", expires: exp * 1000, accountId: ACCOUNT }) as never);
	return store;
}

const MODEL = {
	id: "gpt-6-luna",
	name: "GPT-6-Luna",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 500000,
	maxTokens: 100000,
	thinkingLevelMap: {},
} as unknown as Model<Api>;

const USER_1: Context = { systemPrompt: "Be brief.", messages: [{ role: "user", content: "hello", timestamp: 1 }], tools: [] };

function userTurn(text: string, prior: Context): Context {
	return { ...prior, messages: [...prior.messages, { role: "user", content: text, timestamp: 2 }] } as Context;
}

const completedEvent = (id: string, usage = { input_tokens: 10, output_tokens: 2, total_tokens: 12 }) => ({
	type: "response.completed",
	response: { id, status: "completed", usage: { ...usage, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } },
});

const rawUsage = (inputTokens: number, outputTokens: number, cachedTokens = 0, reasoningTokens = 0) => ({
	input_tokens: inputTokens,
	output_tokens: outputTokens,
	total_tokens: inputTokens + outputTokens,
	input_tokens_details: { cached_tokens: cachedTokens },
	output_tokens_details: { reasoning_tokens: reasoningTokens },
});

const textEvents = (id: string, text: string, item = `msg_${id}`) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: item, role: "assistant", content: [], status: "in_progress" } },
	{ type: "response.output_text.delta", item_id: item, output_index: 0, content_index: 0, delta: text },
	{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: item, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
	completedEvent(id),
];

const toolEvents = (id: string, callId: string) => [
	{ type: "response.created", response: { id } },
	{
		type: "response.output_item.done",
		output_index: 0,
		item: { type: "function_call", id: `fc_${callId}`, call_id: callId, name: "lookup", arguments: "{\"q\":1}", status: "completed" },
	},
	completedEvent(id),
];

function decodeBody(bytes: Uint8Array): Record<string, unknown> {
	return JSON.parse(zlib.zstdDecompressSync(Buffer.from(bytes)).toString("utf8")) as Record<string, unknown>;
}

async function collect(stream: AsyncIterable<{ type: string; [k: string]: unknown }>): Promise<{ type: string; [k: string]: unknown }[]> {
	const out: { type: string; [k: string]: unknown }[] = [];
	for await (const event of stream) out.push(event);
	return out;
}

function sseScript(scripts: Array<{ events?: unknown[]; error?: Error; status?: number }>) {
	const calls: { url: string; headers: Record<string, string>; body: Uint8Array; signal: AbortSignal }[] = [];
	const fn = (options: any) => {
		calls.push({ url: options.url, headers: options.headers, body: options.body, signal: options.signal });
		const step = scripts.shift();
		if (!step) throw new Error("unexpected SSE request");
		return (async function* () {
			options.onResponse({ status: step.status ?? 200, headers: {} });
			if (step.error) throw step.error;
			for (const value of step.events ?? []) yield { text: JSON.stringify(value), value };
		})();
	};
	return { fn: fn as any, calls };
}

function fakeSocketFactory(scripts: unknown[][][], options: { connectErrors?: Error[] } = {}) {
	const connects: number[] = [];
	const sent: any[] = [];
	const heads: Record<string, string>[] = [];
	const connectErrors = options.connectErrors ?? [];
	const connect = async (connectOptions: any) => {
		heads.push(connectOptions.headers);
		connects.push(connects.length);
		const error = connectErrors.shift();
		if (error) throw error;
		let open = true;
		let current: unknown[] = [];
		const socket = {
			get isOpen() {
				return open;
			},
			socketIdentity: `socket-${connects.length}`,
			events() {
				const batch = current;
				return (async function* () {
					for (const value of batch) {
						if (value instanceof Error) throw value;
						yield { text: JSON.stringify(value), value: value as Record<string, unknown> };
					}
				})();
			},
			async send(object: unknown) {
				sent.push(object);
				current = (scripts.shift() ?? [])[0] ?? [];
			},
			async interrupt() {
				return { acknowledged: true as const, completed: false };
			},
			async close() {
				open = false;
			},
		};
		return socket as any;
	};
	return { connect: connect as any, connects, sent, heads };
}

// No WebSocket in SSE tests: every connect attempt is refused with 426, which is the native sticky SSE fallback.
const upgradeRequired = async (): Promise<never> => {
	throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
};

function clockAndSleep() {
	const sleeps: number[] = [];
	return {
		sleeps,
		dependencies: {
			clock: { now: () => 1_000_000 },
			random: () => 0.5,
			sleep: async (ms: number) => {
				sleeps.push(ms);
			},
		},
	};
}

test("SSE: onPayload runs once, Fast priority survives, bytes are zstd and carry the native headers", async () => {
	const sse = sseScript([{ events: textEvents("resp_1", "Hi") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	let hookCalls = 0;
	const events = await collect(transport.stream(MODEL, USER_1, {
		serviceTier: "fast",
		onPayload: (payload: any) => {
			hookCalls++;
			assert.equal(payload.service_tier, "priority");
			return undefined;
		},
	} as any));
	assert.equal(hookCalls, 1);
	assert.equal(events.filter((e) => e.type === "done").length, 1);
	assert.equal(events.at(-1)?.type, "done");
	assert.deepEqual((events.at(-1) as any).message.content.map(({ type, text }: any) => ({ type, text })), [{ type: "text", text: "Hi" }], "successful completion still keeps its text");
	const body = decodeBody(sse.calls[0].body);
	assert.equal(body.service_tier, "priority");
	assert.equal(body.store, false);
	assert.equal(body.model, "gpt-6-luna");
	assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
	assert.equal(sse.calls[0].headers["Content-Encoding"], "zstd");
	assert.equal(sse.calls[0].headers.Authorization.startsWith("Bearer "), true);
	assert.equal(sse.calls[0].headers["ChatGPT-Account-ID"], ACCOUNT);
	assert.equal(sse.calls[0].headers["OpenAI-Beta"], undefined);
	assert.equal(sse.calls[0].url, "https://chatgpt.com/backend-api/codex/responses");
});

test("final body: a hook that removes priority or adds a non-native field is rejected before any send", async () => {
	const sse = sseScript([{ events: textEvents("resp_x", "never") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const removed = await collect(transport.stream(MODEL, USER_1, {
		serviceTier: "fast",
		onPayload: (payload: any) => ({ ...payload, service_tier: undefined }),
	} as any));
	assert.equal(removed.at(-1)?.type, "error");
	assert.match(String((removed.at(-1) as any).error.errorMessage), /changed or removed by a hook/);
	const extra = await collect(transport.stream(MODEL, USER_1, {
		onPayload: (payload: any) => ({ ...payload, temperature: 0.2 }),
	} as any));
	assert.equal(extra.at(-1)?.type, "error");
	assert.equal(sse.calls.length, 0);
});

test("a poisoned ambient OPENAI_API_KEY does not affect a request sent with the stored OAuth grant", async () => {
	const previous = process.env.OPENAI_API_KEY;
	process.env.OPENAI_API_KEY = "sk-ambient-poison";
	try {
		const access = fakeAccess();
		const sse = sseScript([{ events: textEvents("resp_env", "ok") }]);
		const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(access), dependencies: { connect: upgradeRequired, postEvents: sse.fn } });
		const events = await collect(transport.stream(MODEL, USER_1, {} as any));
		assert.equal(events.at(-1)?.type, "done");
		assert.equal(sse.calls.length, 1);
		assert.equal(sse.calls[0].headers.Authorization, `Bearer ${access}`);
		assert.equal(JSON.stringify(sse.calls[0].headers).includes("sk-ambient-poison"), false);
	} finally {
		if (previous === undefined) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = previous;
	}
});

test("explicit API keys are refused before the credential is read", async () => {
	const sse = sseScript([]);
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1, { apiKey: "sk-explicit" } as any));
	assert.equal(events.at(-1)?.type, "error");
	assert.equal(sse.calls.length, 0);
});

test("401: reload then retry with the exact same prepared compressed bytes; onPayload not repeated", async () => {
	const unauthorized = new SseError(401, {}, "request failed with HTTP 401", "status");
	const sse = sseScript([{ error: unauthorized, status: 401 }, { events: textEvents("resp_2", "ok") }]);
	const timing = clockAndSleep();
	let hookCalls = 0;
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1, { onPayload: () => { hookCalls++; return undefined; } } as any));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(sse.calls.length, 2);
	assert.equal(hookCalls, 1);
	assert.equal(Buffer.compare(Buffer.from(sse.calls[0].body), Buffer.from(sse.calls[1].body)), 0);
});

test("SSE 503 retries reuse the exact bytes with the native 200ms backoff; no hook repeat", async () => {
	const sse = sseScript([{ error: new SseError(503, {}, "request failed with HTTP 503", "status"), status: 503 }, { events: textEvents("resp_3", "back") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1));
	assert.equal(events.at(-1)?.type, "done");
	assert.deepEqual(timing.sleeps, [200]);
	assert.equal(Buffer.compare(Buffer.from(sse.calls[0].body), Buffer.from(sse.calls[1].body)), 0);
});

test("quota is terminal: one request, one error event with the safe quota message", async () => {
	const failed = {
		type: "response.failed",
		response: { id: "resp_q", error: { code: "insufficient_quota", message: "raw server text must not leak", type: "x" } },
	};
	const sse = sseScript([{ events: [{ type: "response.created", response: { id: "resp_q" } }, failed] }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1));
	assert.equal(sse.calls.length, 1);
	assert.deepEqual(timing.sleeps, []);
	const terminals = events.filter((e) => e.type === "done" || e.type === "error");
	assert.equal(terminals.length, 1);
	assert.equal(terminals[0].type, "error");
	assert.match(String((terminals[0] as any).error.errorMessage), /Quota exceeded/);
	assert.doesNotMatch(String((terminals[0] as any).error.errorMessage), /raw server text/);
	assert.deepEqual((terminals[0] as any).error.content, [], "an error without completed output stays empty");
	assert.equal((terminals[0] as any).error.diagnostics[0].type, "rqw_codex_retry_owned");
});

test("completed text survives a terminal error without turning the failure into success", async () => {
	const events = textEvents("resp_terminal_text", "COMPLETED TEXT");
	events[events.length - 1] = {
		type: "response.failed",
		response: { id: "resp_terminal_text", status: "failed", error: { code: "insufficient_quota", message: "raw server text must not leak", type: "x" } },
	};
	const sse = sseScript([{ events }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const stream = await collect(transport.stream(MODEL, USER_1));
	const terminal = stream.at(-1) as any;
	assert.equal(terminal.type, "error");
	assert.equal(terminal.error.stopReason, "error");
	assert.deepEqual(terminal.error.content.map(({ type, text }: any) => ({ type, text })), [{ type: "text", text: "COMPLETED TEXT" }]);
	assert.match(terminal.error.errorMessage, /Quota exceeded/);
	assert.doesNotMatch(terminal.error.errorMessage, /raw server text/);
	assert.equal(terminal.error.diagnostics[0].type, "rqw_codex_retry_owned");
	assert.equal(terminal.error.responseId, "resp_terminal_text");
	assert.equal(terminal.error.providerThinkingLevel, "medium");
	assert.equal(sse.calls.length, 1);
	assert.deepEqual(timing.sleeps, []);
});

test("completed text also survives when the native retry budget is already exhausted", async () => {
	const events = textEvents("resp_retry_terminal_text", "COMPLETED TEXT");
	events[events.length - 1] = {
		type: "response.failed",
		response: { id: "resp_retry_terminal_text", status: "failed", error: { code: "server_error", message: "temporary upstream failure" } },
	};
	const sse = sseScript([{ events }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, providerRetries: { streamMaxRetries: 0 }, connect: upgradeRequired, postEvents: sse.fn } });
	const terminal = (await collect(transport.stream(MODEL, USER_1))).at(-1) as any;
	assert.equal(terminal.type, "error");
	assert.equal(terminal.error.stopReason, "error");
	assert.deepEqual(terminal.error.content.map(({ type, text }: any) => ({ type, text })), [{ type: "text", text: "COMPLETED TEXT" }]);
	assert.match(terminal.error.errorMessage, /stream disconnected before completion/);
	assert.equal(terminal.error.diagnostics[0].type, "rqw_codex_retry_owned");
	assert.equal(sse.calls.length, 1);
	assert.deepEqual(timing.sleeps, []);
});

test("completed text survives a terminal auth recovery failure with the recovery error", async () => {
	let posts = 0;
	let refreshes = 0;
	const postEvents = (options: any) => {
		posts++;
		return (async function* () {
			options.onResponse({ status: 200, headers: {} });
			if (posts === 1) {
				for (const value of textEvents("resp_auth_terminal_text", "COMPLETED TEXT").slice(0, -1)) yield { text: JSON.stringify(value), value };
			}
			throw new SseError(401, {}, "request failed with HTTP 401", "status");
		})();
	};
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents, fetch: async () => {
		refreshes++;
		return Response.json({ error: { code: "refresh_token_invalidated" } }, { status: 401 });
	} } });
	const terminal = (await collect(transport.stream(MODEL, USER_1))).at(-1) as any;
	assert.equal(terminal.type, "error");
	assert.equal(terminal.error.stopReason, "error");
	assert.deepEqual(terminal.error.content.map(({ type, text }: any) => ({ type, text })), [{ type: "text", text: "COMPLETED TEXT" }]);
	assert.match(terminal.error.errorMessage, /refresh token was revoked/);
	assert.equal(terminal.error.responseId, "resp_auth_terminal_text");
	assert.equal(terminal.error.providerThinkingLevel, "medium");
	assert.equal(terminal.error.diagnostics[0].type, "rqw_codex_retry_owned");
	assert.equal(posts, 2, "reload and refresh each allow exactly one retry");
	assert.equal(refreshes, 1);
	assert.deepEqual(timing.sleeps, []);
});

test("completed text survives a local refusal on the attempt after a retry", async () => {
	const failed = textEvents("resp_local_terminal_text", "COMPLETED TEXT");
	failed[failed.length - 1] = {
		type: "response.failed",
		response: { id: "resp_local_terminal_text", status: "failed", error: { code: "server_error", message: "temporary upstream failure" } },
	};
	const sse = sseScript([{ events: failed }, { events: [] }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	let heads = 0;
	const terminal = (await collect(transport.stream(MODEL, USER_1, { onResponse: () => {
		heads++;
		if (heads === 2) throw new Error("local secret must not leak");
	} } as any))).at(-1) as any;
	assert.equal(terminal.type, "error");
	assert.equal(terminal.error.stopReason, "error");
	assert.deepEqual(terminal.error.content.map(({ type, text }: any) => ({ type, text })), [{ type: "text", text: "COMPLETED TEXT" }]);
	assert.equal(terminal.error.errorMessage, "RQW-codex: the onResponse hook failed. Request stopped.");
	assert.equal(terminal.error.responseId, "resp_local_terminal_text");
	assert.equal(terminal.error.providerThinkingLevel, "medium");
	assert.equal(terminal.error.diagnostics, undefined, "a local refusal keeps its existing non-Codex metadata");
	assert.equal(sse.calls.length, 2);
	assert.deepEqual(timing.sleeps, [200]);
});

test("usage accounting: terminal failure after a retry counts each attempt exactly once", async () => {
	const sse = sseScript([
		{ events: [
			{ type: "response.created", response: { id: "resp_retry_usage" } },
			{ type: "response.incomplete", response: { id: "resp_retry_usage", incomplete_details: { reason: "content_filter" }, usage: rawUsage(11, 3, 4, 1) } },
		] },
		{ events: [
			{ type: "response.created", response: { id: "resp_terminal_usage" } },
			{ type: "response.incomplete", response: { id: "resp_terminal_usage", incomplete_details: { reason: "max_tokens_custom" }, usage: rawUsage(20, 5, 6, 2) } },
		] },
	]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1));
	const terminal = events.at(-1) as any;
	assert.equal(terminal.type, "error");
	assert.equal(sse.calls.length, 2);
	assert.deepEqual(timing.sleeps, [200]);
	assert.deepEqual(terminal.error.usage, {
		input: 21,
		output: 8,
		cacheRead: 10,
		cacheWrite: 0,
		reasoning: 3,
		totalTokens: 39,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	});
});

test("usage accounting: a successful retry sums the distinct attempt values once", async () => {
	const sse = sseScript([
		{ events: [
			{ type: "response.created", response: { id: "resp_retry_success" } },
			{ type: "response.incomplete", response: { id: "resp_retry_success", incomplete_details: { reason: "content_filter" }, usage: rawUsage(7, 2, 1, 1) } },
		] },
		{ events: textEvents("resp_success_after_retry", "ok").slice(0, -1).concat(completedEvent("resp_success_after_retry", rawUsage(13, 4))) },
	]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1));
	const terminal = events.at(-1) as any;
	assert.equal(terminal.type, "done");
	assert.equal(sse.calls.length, 2);
	assert.deepEqual(timing.sleeps, [200]);
	assert.deepEqual(terminal.message.usage, {
		input: 19,
		output: 6,
		cacheRead: 1,
		cacheWrite: 0,
		reasoning: 1,
		totalTokens: 26,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	});
});

test("usage accounting: a single successful attempt keeps its reported usage", async () => {
	const sse = sseScript([{ events: textEvents("resp_single_usage", "ok").slice(0, -1).concat(completedEvent("resp_single_usage", rawUsage(9, 2))) }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1));
	const terminal = events.at(-1) as any;
	assert.equal(terminal.type, "done");
	assert.equal(sse.calls.length, 1);
	assert.deepEqual(terminal.message.usage, {
		input: 9,
		output: 2,
		cacheRead: 0,
		cacheWrite: 0,
		reasoning: 0,
		totalTokens: 11,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	});
});

test("WebSocket 426 falls back to SSE and the fallback is sticky for the thread", async () => {
	const sockets = fakeSocketFactory([], { connectErrors: [new SocketError(426, {}, "upgrade required", "upgrade-rejected")] });
	const sse = sseScript([{ events: textEvents("resp_f1", "a") }, { events: textEvents("resp_f2", "b") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: sockets.connect, postEvents: sse.fn } });
	const first = await collect(transport.stream(MODEL, USER_1));
	assert.equal(first.at(-1)?.type, "done");
	assert.equal(transport.transport, "sse");
	const second = await collect(transport.stream(MODEL, userTurn("again", USER_1)));
	assert.equal(second.at(-1)?.type, "done");
	assert.equal(sockets.connects.length, 1);
	assert.equal(sse.calls.length, 2);
});

test("WebSocket connection failures retry unbounded with 5s then 10s, then continue on the socket", async () => {
	const transportError = () => new SocketError(undefined, {}, "websocket transport error", "transport");
	const sockets = fakeSocketFactory([[textEvents("resp_c1", "ok")]], { connectErrors: [transportError(), transportError()] });
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: sockets.connect } });
	const events = await collect(transport.stream(MODEL, USER_1));
	assert.equal(events.at(-1)?.type, "done");
	assert.deepEqual(timing.sleeps, [5000, 10000]);
	assert.equal(transport.transport, "websocket");
});

for (const [kind, failureAt] of (["transport", "closed"] as const).flatMap((kind) =>
	(["send", "before-created", "after-created"] as const).map((phase) => [kind, phase] as const))) {
	test(`established WebSocket ${kind} at ${failureAt} exhausts five stream retries, then succeeds over SSE`, async () => {
		const failure = () => new SocketError(undefined, {}, "established socket failed", kind);
		const scripts = Array.from({ length: 6 }, (_, i) => [[
			...(failureAt === "after-created" ? [{ type: "response.created", response: { id: `resp_failed_${i}` } }] : []),
			failure(),
		]]);
		const sockets = fakeSocketFactory(scripts);
		const sse = sseScript([{ events: textEvents("resp_fallback", "recovered") }]);
		const timing = clockAndSleep();
		const controller = new AbortController();
		const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: {
			...timing.dependencies,
			connect: async (options) => {
				// Stop the broken unbounded path without leaving a hung test.
				if (sockets.connects.length === 6) controller.abort();
				const socket = await sockets.connect(options);
				if (failureAt === "send") {
					const send = socket.send.bind(socket);
					socket.send = async (object: unknown) => {
						await send(object);
						throw failure();
					};
				}
				return socket;
			},
			postEvents: sse.fn,
		} });
		try {
			const events = await collect(transport.stream(MODEL, USER_1, { signal: controller.signal }));
			assert.equal(events.at(-1)?.type, "done");
			assert.equal(sockets.connects.length, 6);
			assert.equal(sockets.sent.length, 6);
			assert.equal(sse.calls.length, 1);
			assert.equal(transport.transport, "sse");
			assert.deepEqual(timing.sleeps, [200, 400, 800, 1600, 3200]);
			assert.equal((events.at(-1) as any).message.content[0].text, "recovered");
		} finally {
			transport.dispose();
		}
	});
}

test("WebSocket: second turn is incremental (previous_response_id + suffix only) on the same socket", async () => {
	const sockets = fakeSocketFactory([[textEvents("resp_w1", "one")], [textEvents("resp_w2", "two")]]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: sockets.connect } });
	await collect(transport.stream(MODEL, USER_1));
	const turn2 = userTurn("second", { ...USER_1, messages: [...USER_1.messages, { role: "assistant", content: [{ type: "text", text: "one" }], api: "openai-codex-responses", provider: "openai-codex", model: "gpt-6-luna", responseId: "resp_w1", usage: {}, stopReason: "stop", timestamp: 3 }] } as any);
	const events = await collect(transport.stream(MODEL, turn2));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(sockets.connects.length, 1);
	assert.equal(sockets.sent.length, 2);
	assert.equal(sockets.sent[0].type, "response.create");
	assert.equal(sockets.sent[0].previous_response_id, undefined);
	assert.equal(sockets.sent[1].previous_response_id, "resp_w1");
	assert.equal(sockets.sent[1].input.length, 1);
	assert.equal(sockets.sent[1].input[0].role, "user");
	assert.equal(typeof sockets.sent[1].client_metadata["x-codex-ws-stream-request-start-ms"], "string");
	assert.equal(sockets.sent[1].client_metadata["x-codex-ws-stream-request-start-ms"], "1000000");
});

test("partial completed raw items become one tool handoff: exactly one tool event, no immediate retry, raw call replayed on resume", async () => {
	const midStreamFailure = new SseError(200, {}, "stream closed before response.completed", "eof");
	const sse = sseScript([
		{ events: [{ type: "response.created", response: { id: "resp_p1" } }, ...toolEvents("resp_p1", "call_1").slice(0, 2), { type: "response.output_text.delta", output_index: 1, item_id: "m", content_index: 0, delta: "PARTIAL" }] },
		{ events: [{ type: "response.created", response: { id: "resp_p2" } }, ...textEvents("resp_p2", "final")] },
	]);
	// The first attempt ends without a terminal event: the stream error carries the completed function_call.
	const first = sse.fn;
	const timing = clockAndSleep();
	let attempt = 0;
	const postEvents = (options: any) => {
		attempt++;
		if (attempt === 1) {
			const iterator = first(options)[Symbol.asyncIterator]();
			return (async function* () {
				for (;;) {
					const next = await iterator.next();
					if (next.done) throw midStreamFailure;
					yield next.value;
				}
			})();
		}
		return first(options);
	};
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: postEvents as any } });
	const events = await collect(transport.stream(MODEL, USER_1));
	const done = events.at(-1) as any;
	assert.equal(done.type, "done");
	assert.equal(done.reason, "toolUse");
	assert.equal(events.filter((e) => e.type === "toolcall_end").length, 1);
	assert.equal(events.some((e) => e.type === "text_delta" && (e as any).delta === "PARTIAL"), false);
	assert.equal(sse.calls.length, 1);
	assert.deepEqual(timing.sleeps, []);
	assert.equal(done.message.responseId, "resp_p1");
	const calls = done.message.content.filter((c: any) => c.type === "toolCall");
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0].arguments, { q: 1 });
	// Pi runs the call and resumes: the raw completed call is replayed verbatim, with its paired output.
	const toolResult = { role: "toolResult", toolCallId: calls[0].id, toolName: "lookup", content: [{ type: "text", text: "42" }], isError: false, timestamp: 4 };
	const resumed = await collect(transport.stream(MODEL, { ...USER_1, messages: [...USER_1.messages, done.message, toolResult] } as any));
	assert.equal(resumed.at(-1)?.type, "done");
	const resumedInput = decodeBody(sse.calls[1].body).input as any[];
	const replayed = resumedInput.filter((i) => i.type === "function_call" && i.call_id === "call_1");
	assert.equal(replayed.length, 1);
	assert.equal(replayed[0].arguments, "{\"q\":1}");
	assert.equal(resumedInput.filter((i) => i.type === "function_call_output" && i.call_id === "call_1").length, 1);
});

test("tool-call turn: the completed call is emitted exactly once with its arguments", async () => {
	const sse = sseScript([{ events: toolEvents("resp_t", "call_t") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1));
	const done = events.at(-1) as any;
	assert.equal(done.type, "done");
	assert.equal(done.reason, "toolUse");
	const calls = done.message.content.filter((c: any) => c.type === "toolCall");
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0].arguments, { q: 1 });
});

test("caller abort: one aborted error terminal, no further events", async () => {
	const controller = new AbortController();
	const postEvents = (options: any) => {
		options.onResponse({ status: 200, headers: {} });
		return (async function* () {
			yield { text: "", value: { type: "response.created", response: { id: "resp_a" } } };
			await new Promise<void>((_, reject) => {
				options.signal.addEventListener("abort", () => {
					const error = new Error("aborted");
					error.name = "AbortError";
					reject(error);
				}, { once: true });
			});
		})();
	};
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: postEvents as any } });
	const pending = collect(transport.stream(MODEL, USER_1, { signal: controller.signal } as any));
	setTimeout(() => controller.abort(), 5);
	const events = await pending;
	const terminals = events.filter((e) => e.type === "done" || e.type === "error");
	assert.equal(terminals.length, 1);
	assert.equal((terminals[0] as any).reason, "aborted");
	assert.equal(events.at(-1), terminals[0]);
});

test("prewarm: generate:false once, coalesced, no output, and the first real turn reuses the socket", async () => {
	const sockets = fakeSocketFactory([[[{ type: "response.created", response: { id: "resp_pre" } }, completedEvent("resp_pre")]], [textEvents("resp_real", "real")]]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: sockets.connect } });
	const p1 = transport.prewarm(MODEL, USER_1);
	const p2 = transport.prewarm(MODEL, USER_1);
	await Promise.all([p1, p2]);
	assert.equal(sockets.connects.length, 1);
	assert.equal(sockets.sent.length, 1);
	assert.equal(sockets.sent[0].generate, false);
	const events = await collect(transport.stream(MODEL, userTurn("next", USER_1)));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(sockets.connects.length, 1);
	assert.equal(sockets.sent[1].previous_response_id, "resp_pre");
	assert.equal(sockets.sent[1].generate, undefined);
});

test("failed prewarm is silent and the normal path still answers", async () => {
	const sockets = fakeSocketFactory([[[]], [textEvents("resp_after", "after")]], { connectErrors: [new SocketError(undefined, {}, "down", "transport")] });
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: sockets.connect } });
	await transport.prewarm(MODEL, USER_1);
	const events = await collect(transport.stream(MODEL, USER_1));
	assert.equal(events.at(-1)?.type, "done");
});

test("overlay returns one transport per thread and disposeAll closes it", async () => {
	const overlay = createOverlay({ store: await seededStore(), dependencies: { connect: upgradeRequired } });
	const a = overlay.forThread(IDENTITY);
	assert.equal(overlay.forThread(IDENTITY), a);
	overlay.disposeAll();
	const events = await collect(a.stream(MODEL, USER_1));
	assert.equal(events.at(-1)?.type, "error");
});

// ---- mechanical sendRaw, prewarm, revision, hook and provenance cases -----------------------------------------------

const RAW_REQUEST = {
	model: "gpt-6-luna",
	stream: true,
	input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "compact me" }] }],
	tool_choice: "auto",
	parallel_tool_calls: false,
	reasoning: {},
	store: false,
	include: ["reasoning.encrypted_content"],
	client_metadata: {},
} as any;

test("sendRaw compaction: one attempt; a connection failure is not retried by the transport", async () => {
	let connects = 0;
	const connect = async () => {
		connects++;
		throw new SocketError(undefined, {}, "down", "transport");
	};
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: connect as any } });
	await assert.rejects(collect(transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "compaction" }) as any));
	assert.equal(connects, 1);
	assert.deepEqual(timing.sleeps, []);
});

test("sendRaw SSE: HTTP 5xx is retried 4 times with identical bytes, then one error; no stream-level retry", async () => {
	const fail = () => ({ error: new SseError(503, {}, "request failed with HTTP 503", "status"), status: 503 });
	const sse = sseScript([fail(), fail(), fail(), fail(), fail(), { events: textEvents("resp_never", "x") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	await assert.rejects(collect(transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "compaction", transport: "sse" }) as any));
	assert.equal(sse.calls.length, 5);
	for (const call of sse.calls) assert.equal(Buffer.compare(Buffer.from(call.body), Buffer.from(sse.calls[0].body)), 0);
	assert.deepEqual(timing.sleeps, [200, 400, 800, 1600]);
});

test("HTTP 429 usage_limit_reached with control fields: one request, terminal, plan and reset kept, no generic retry", async () => {
	const control = { code: "usage_limit_reached", type: "usage_limit_reached", planType: "plus", limitWindowMinutes: 300, resetsAt: 1_700_003_600 };
	const sse = sseScript([{ error: new SseError(429, {}, "request failed with HTTP 429", "status", control), status: 429 }, { events: textEvents("resp_u", "x") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1));
	assert.equal(sse.calls.length, 1);
	assert.deepEqual(timing.sleeps, []);
	const terminals = events.filter((e) => e.type === "done" || e.type === "error");
	assert.equal(terminals.length, 1);
	assert.equal(terminals[0].type, "error");
	assert.match(String((terminals[0] as any).error.errorMessage), /usage limit/);
});

test("HTTP 429 rate_limit_exceeded with Retry-After: obeys the uncapped server delay within the native budget", async () => {
	const sse = sseScript([{ error: new SseError(429, { "retry-after": "7" }, "request failed with HTTP 429", "status", { code: "rate_limit_exceeded" }), status: 429 }, { events: textEvents("resp_r", "ok") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(sse.calls.length, 2);
	assert.deepEqual(timing.sleeps, [7000]);
});

test("sendRaw: 429 is not retried at HTTP level", async () => {
	const sse = sseScript([{ error: new SseError(429, {}, "request failed with HTTP 429", "status"), status: 429 }, { events: textEvents("resp_429", "x") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	await assert.rejects(collect(transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "compaction", transport: "sse" }) as any));
	assert.equal(sse.calls.length, 1);
	assert.deepEqual(timing.sleeps, []);
});

test("sendRaw turn yields raw events; recordItem runs before the terminal event; preparedRequest once; outputs after success", async () => {
	const log: string[] = [];
	const history = {
		rawOutputs: () => new Map(),
		recordOutputs: (id: string) => log.push(`out:${id}`),
		preparedRequest: () => log.push("prepared"),
		recordItem: (_id: string, item: { id?: string }) => log.push(`item:${item.id}`),
	};
	const sse = sseScript([{ events: textEvents("resp_raw", "compacted") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), history, dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.sendRaw({
		request: RAW_REQUEST,
		model: MODEL,
		requestKind: "turn",
		transport: "sse",
		options: { onProviderStreamEvent: (event: { type: string }) => { if (event.type === "response.completed") log.push("terminal"); } } as any,
	}) as any);
	assert.deepEqual(log, ["prepared", "item:msg_resp_raw", "terminal", "out:resp_raw"]);
	assert.equal(events.at(-1)?.type, "response.completed");
	assert.equal(events.filter((e) => e.type === "response.output_item.done").length, 1);
});

const recordingHistory = (log: string[]) => ({
	rawOutputs: () => new Map(),
	recordOutputs: (id: string) => log.push(`out:${id}`),
	preparedRequest: () => log.push("prepared"),
	recordItem: (_id: string, item: { id?: string }) => log.push(`item:${item.id}`),
});

test("sendRaw compaction candidate: no preparedRequest, recordItem or recordOutputs, even when it fails after a compaction item", async () => {
	const log: string[] = [];
	const candidate = [
		{ type: "response.created", response: { id: "resp_bad" } },
		{ type: "response.output_item.done", output_index: 0, item: { type: "compaction", id: "cmp_bad", encrypted_content: "ENC" } },
		{ type: "response.output_item.done", output_index: 1, item: { type: "message", id: "msg_bad", role: "assistant", content: [] } },
		{ type: "response.failed", response: { id: "resp_bad", status: "failed", error: { code: "invalid_prompt", message: "bad" } } },
	];
	const sse = sseScript([{ events: candidate }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), history: recordingHistory(log), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "compaction", transport: "sse" }) as any);
	assert.equal(events.at(-1)?.type, "response.failed");
	assert.deepEqual(log, []);
});

test("sendRaw compaction candidate: an abort after its compaction item writes nothing to the durable history", async () => {
	const log: string[] = [];
	const controller = new AbortController();
	const sse = sseScript([{ events: [{ type: "response.created", response: { id: "resp_abort" } }, { type: "response.output_item.done", output_index: 0, item: { type: "compaction", id: "cmp_abort", encrypted_content: "ENC" } }, completedEvent("resp_abort")] }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), history: recordingHistory(log), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	await assert.rejects(collect(transport.sendRaw({
		request: RAW_REQUEST,
		model: MODEL,
		requestKind: "compaction",
		transport: "sse",
		signal: controller.signal,
		options: { onProviderStreamEvent: (event: { type: string }) => { if (event.type === "response.output_item.done") controller.abort(); } } as any,
	}) as any), { name: "AbortError" });
	assert.deepEqual(log, []);
});

test("prewarm generate:false: unexpected output never enters the durable history; the first real turn still persists its own items", async () => {
	const log: string[] = [];
	const sockets = fakeSocketFactory([
		[[{ type: "response.created", response: { id: "resp_pre_out" } }, { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_pre_out", role: "user", content: [] } }, completedEvent("resp_pre_out")]],
		[textEvents("resp_real_out", "real")],
	]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), history: recordingHistory(log), dependencies: { ...timing.dependencies, connect: sockets.connect } });
	await transport.prewarm(MODEL, USER_1);
	assert.deepEqual(log, []);
	const events = await collect(transport.stream(MODEL, userTurn("next", USER_1)));
	assert.equal(events.at(-1)?.type, "done");
	assert.deepEqual(log, ["prepared", "item:msg_resp_real_out", "out:resp_real_out"]);
});

test("sendRaw request identity: the scoped turn, timestamp and compaction metadata reach the body blob and SSE headers; the thread identity is untouched", async () => {
	const sse = sseScript([{ events: textEvents("resp_scoped", "ok") }, { events: textEvents("resp_after_scoped", "after") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	let hooks = 0;
	const scoped = {
		...IDENTITY,
		authProfile: "api_key",
		turnId: "turn_cmp",
		rootTurnId: "root_cmp",
		turnStartedAtUnixMs: 1234,
		compaction: { trigger: "manual", reason: "user_requested", phase: "standalone_turn", implementation: "responses" },
	} as any;
	const events = await collect(transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "compaction", transport: "sse", identity: scoped, options: { onPayload: () => { hooks++; } } as any }) as any);
	assert.equal(events.at(-1)?.type, "response.completed");
	assert.equal(hooks, 1);
	const body = decodeBody(sse.calls[0].body) as { client_metadata: Record<string, string> };
	const blob = JSON.parse(body.client_metadata["x-codex-turn-metadata"]);
	assert.equal(body.client_metadata.turn_id, "turn_cmp");
	assert.equal(blob.turn_id, "turn_cmp");
	assert.equal(blob.turn_started_at_unix_ms, 1234);
	assert.equal(blob.request_kind, "compaction");
	assert.equal(blob.compaction.trigger, "manual");
	assert.equal(body.client_metadata.guardian_credits_requested, "true");
	assert.equal(JSON.parse(sse.calls[0].headers["x-codex-turn-metadata"]).turn_id, "turn_cmp");
	assert.equal(transport.identity.turnId, undefined);
	assert.equal(transport.identity.authProfile, "subscription");
	assert.equal(transport.identity.compaction, undefined);
	const turn = await collect(transport.stream(MODEL, USER_1));
	assert.equal(turn.at(-1)?.type, "done");
	const later = decodeBody(sse.calls[1].body) as { client_metadata: Record<string, string> };
	assert.equal(later.client_metadata.turn_id, undefined);
	assert.equal(JSON.parse(sse.calls[1].headers["x-codex-turn-metadata"]).turn_id, undefined);
});

test("sendRaw request identity with another lineage is refused before any credential is read or sent", async () => {
	const sse = sseScript([]);
	let connects = 0;
	const connect = async () => {
		connects++;
		throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
	};
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: connect as any, postEvents: sse.fn } });
	for (const bad of [{ ...IDENTITY, threadId: "other-thread" }, { ...IDENTITY, rootSessionId: "other-root" }, { ...IDENTITY, subagentKind: "review" }]) {
		await assert.rejects(collect(transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "compaction", transport: "sse", identity: bad as any }) as any), /does not match the thread/);
	}
	assert.equal(connects, 0);
	assert.equal(sse.calls.length, 0);
});

test("hook exceptions are local refusals: onPayload and onProviderStreamEvent end in one error with no network retry", async () => {
	const sse = sseScript([{ events: textEvents("resp_h", "x") }, { events: textEvents("resp_h2", "y") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const first = await collect(transport.stream(MODEL, USER_1, { onPayload: () => { throw new Error("secret-in-hook"); } } as any));
	assert.equal(first.at(-1)?.type, "error");
	assert.doesNotMatch(String((first.at(-1) as any).error.errorMessage), /secret-in-hook/);
	assert.equal(sse.calls.length, 0);
	const second = await collect(transport.stream(MODEL, USER_1, { onProviderStreamEvent: () => { throw new Error("boom"); } } as any));
	assert.equal(second.at(-1)?.type, "error");
	assert.equal(sse.calls.length, 1);
	assert.deepEqual(timing.sleeps, []);
});

test("explicit API key: refused without origin proof or with a different key; accepted only with the matching stored origin", async () => {
	const access = fakeAccess();
	const digest = createHash("sha256").update(access).digest("hex").slice(0, 16);
	const origin = { provider: "openai-codex", accountId: ACCOUNT, accessRevision: digest, source: "resolved-bearer" };
	const sse = sseScript([{ events: textEvents("resp_k", "ok") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(access), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const bare = await collect(transport.stream(MODEL, USER_1, { apiKey: access } as any));
	assert.equal(bare.at(-1)?.type, "error");
	const wrong = await collect(transport.stream(MODEL, USER_1, { apiKey: "sk-other", [CODEX_AUTH_ORIGIN]: origin } as any));
	assert.equal(wrong.at(-1)?.type, "error");
	assert.doesNotMatch(String((wrong.at(-1) as any).error.errorMessage), /sk-other/);
	assert.equal(sse.calls.length, 0);
	const ok = await collect(transport.stream(MODEL, USER_1, { apiKey: access, [CODEX_AUTH_ORIGIN]: origin } as any));
	assert.equal(ok.at(-1)?.type, "done");
	assert.equal(sse.calls[0].headers.Authorization, `Bearer ${access}`);
});

test("rotated stored bearer invalidates the continuation: next turn is full on a new connection", async () => {
	const sockets = fakeSocketFactory([[textEvents("resp_r1", "one")], [textEvents("resp_r2", "two")]]);
	const store = await seededStore();
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store, dependencies: { ...timing.dependencies, connect: sockets.connect } });
	await collect(transport.stream(MODEL, USER_1));
	const exp = Math.floor(Date.now() / 1000) + 3600;
	await store.modify("openai-codex", async () => ({ type: "oauth", access: fakeAccess("rotated"), refresh: "refresh-1", expires: exp * 1000, accountId: ACCOUNT }) as never);
	const turn2 = userTurn("second", { ...USER_1, messages: [...USER_1.messages, { role: "assistant", content: [{ type: "text", text: "one" }], api: "openai-codex-responses", provider: "openai-codex", model: "gpt-6-luna", responseId: "resp_r1", usage: {}, stopReason: "stop", timestamp: 3 }] } as any);
	const events = await collect(transport.stream(MODEL, turn2));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(sockets.connects.length, 2);
	assert.equal(sockets.sent[1].previous_response_id, undefined);
});

test("served model that differs is reported as responseModel; the requested model is never replaced", async () => {
	const sse = sseScript([{ events: [{ type: "response.created", response: { id: "resp_m", model: "gpt-served-other" } }, ...textEvents("resp_m", "hi").slice(1)] }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1));
	const done = events.at(-1) as any;
	assert.equal(done.type, "done");
	assert.equal(done.message.model, "gpt-6-luna");
	assert.equal(done.message.responseModel, "gpt-served-other");
});

test("prewarm: cold start carries no history messages; a healthy prewarmed socket is not prewarmed again", async () => {
	const sockets = fakeSocketFactory([
		[[{ type: "response.created", response: { id: "resp_pw" } }, completedEvent("resp_pw")]],
		[textEvents("resp_pt", "turn")],
	]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: sockets.connect } });
	await transport.prewarm(MODEL, USER_1);
	await transport.prewarm(MODEL, USER_1);
	assert.equal(sockets.sent.length, 1);
	assert.equal(sockets.sent[0].generate, false);
	assert.equal(sockets.sent[0].input.some((item: { role?: string }) => item.role === "user"), false);
	const events = await collect(transport.stream(MODEL, userTurn("next", USER_1)));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(sockets.sent.length, 2);
	assert.equal(sockets.sent[1].previous_response_id, "resp_pw");
	// The cold prewarm had no messages, so the suffix after its prefix is both user messages (hello, next).
	assert.equal(sockets.sent[1].input.length, 2);
	await transport.prewarm(MODEL, USER_1);
	assert.equal(sockets.sent.length, 2);
});

// ---- routing hint, caller abort and head-hook failures --------------------------------------------------------------

test("routing hint: SSE carries the model and the Fast tier from the final body", async () => {
	const sse = sseScript([{ events: textEvents("resp_hint", "ok") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1, { serviceTier: "fast" } as any));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(decodeBody(sse.calls[0].body).service_tier, "priority");
	assert.equal(sse.calls[0].headers["x-codex-routing-hint"], "model=gpt-6-luna;tier=priority");
});

test("routing hint: a default tier is omitted, the hint is the model only", async () => {
	const sse = sseScript([{ events: textEvents("resp_def", "ok") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(decodeBody(sse.calls[0].body).service_tier, undefined);
	assert.equal(sse.calls[0].headers["x-codex-routing-hint"], "model=gpt-6-luna");
});

test("routing hint: a new WebSocket handshake carries it; a healthy cached socket is reused with no new handshake", async () => {
	const sockets = fakeSocketFactory([[textEvents("resp_wh1", "one")], [textEvents("resp_wh2", "two")]]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: sockets.connect } });
	await collect(transport.stream(MODEL, USER_1, { serviceTier: "fast" } as any));
	const turn2 = userTurn("second", { ...USER_1, messages: [...USER_1.messages, { role: "assistant", content: [{ type: "text", text: "one" }], api: "openai-codex-responses", provider: "openai-codex", model: "gpt-6-luna", responseId: "resp_wh1", usage: {}, stopReason: "stop", timestamp: 3 }] } as any);
	const events = await collect(transport.stream(MODEL, turn2, { serviceTier: "fast" } as any));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(sockets.connects.length, 1);
	assert.equal(sockets.heads.length, 1);
	assert.equal(sockets.heads[0]["x-codex-routing-hint"], "model=gpt-6-luna;tier=priority");
	assert.equal(sockets.sent.length, 2);
});

test("caller abort on WebSocket: the socket is closed and no response.interrupt is sent", async () => {
	const controller = new AbortController();
	let interrupts = 0;
	let closes = 0;
	let release: (() => void) | undefined;
	const connect = async () => {
		let open = true;
		return {
			get isOpen() {
				return open;
			},
			socketIdentity: "socket-abort",
			events() {
				return (async function* () {
					yield { text: "", value: { type: "response.created", response: { id: "resp_ab" } } };
					await new Promise<void>((resolve) => {
						release = resolve;
					});
					throw new SocketError(undefined, {}, "closed", "closed");
				})();
			},
			async send() {},
			async interrupt() {
				interrupts++;
				throw new Error("unexpected interrupt");
			},
			async close() {
				open = false;
				closes++;
				release?.();
			},
		} as any;
	};
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: connect as any } });
	const pending = collect(transport.stream(MODEL, USER_1, { signal: controller.signal } as any));
	setTimeout(() => controller.abort(), 5);
	const events = await pending;
	const terminals = events.filter((e) => e.type === "done" || e.type === "error");
	assert.equal(terminals.length, 1);
	assert.equal((terminals[0] as any).reason, "aborted");
	assert.equal(interrupts, 0);
	assert.equal(closes >= 1, true);
	assert.deepEqual(timing.sleeps, []);
});

test("onResponse sync throw on SSE: one local error terminal, one request, no hook repeat, no network retry", async () => {
	const sse = sseScript([{ events: textEvents("resp_oh", "x") }]);
	const timing = clockAndSleep();
	let hookCalls = 0;
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1, { onResponse: () => {
		hookCalls++;
		throw new Error("sync-secret");
	} } as any));
	const terminals = events.filter((e) => e.type === "done" || e.type === "error");
	assert.equal(terminals.length, 1);
	assert.equal(events.at(-1)?.type, "error");
	assert.equal((events.at(-1) as any).error.errorMessage, "RQW-codex: the onResponse hook failed. Request stopped.");
	assert.doesNotMatch(String((events.at(-1) as any).error.errorMessage), /sync-secret/);
	assert.equal(hookCalls, 1);
	assert.equal(sse.calls.length, 1);
	assert.deepEqual(timing.sleeps, []);
});

test("onResponse async rejection on SSE: same single local error terminal, no unhandled rejection", async () => {
	const sse = sseScript([{ events: textEvents("resp_oa", "x") }]);
	const timing = clockAndSleep();
	let hookCalls = 0;
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1, { onResponse: async () => {
		hookCalls++;
		throw new Error("async-secret");
	} } as any));
	const terminals = events.filter((e) => e.type === "done" || e.type === "error");
	assert.equal(terminals.length, 1);
	assert.equal((events.at(-1) as any).error.errorMessage, "RQW-codex: the onResponse hook failed. Request stopped.");
	assert.doesNotMatch(String((events.at(-1) as any).error.errorMessage), /async-secret/);
	assert.equal(hookCalls, 1);
	assert.equal(sse.calls.length, 1);
	assert.deepEqual(timing.sleeps, []);
});

test("onResponse sync throw on WebSocket handshake: one local error, socket closed, no reconnect", async () => {
	let connects = 0;
	let closes = 0;
	let hookCalls = 0;
	const connect = async (connectOptions: any) => {
		connects++;
		connectOptions.onResponse({ status: 101, headers: {} });
		return {
			isOpen: true,
			socketIdentity: "socket-hook",
			events() {
				return (async function* () {})();
			},
			async send() {},
			async interrupt() {
				throw new Error("unexpected interrupt");
			},
			async close() {
				closes++;
			},
		} as any;
	};
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: connect as any } });
	const events = await collect(transport.stream(MODEL, USER_1, { onResponse: () => {
		hookCalls++;
		throw new Error("ws-secret");
	} } as any));
	assert.equal(events.at(-1)?.type, "error");
	assert.equal((events.at(-1) as any).error.errorMessage, "RQW-codex: the onResponse hook failed. Request stopped.");
	assert.equal(hookCalls, 1);
	assert.equal(connects, 1);
	assert.equal(closes, 1);
	assert.deepEqual(timing.sleeps, []);
});

// ---- live display through LiveResponsesPump -----------------------------------------------------------------------

function withDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), ms);
	});
	return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

test("live display: the first text delta reaches the consumer before the gated terminal is released", async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const postEvents = (options: any) => {
		options.onResponse({ status: 200, headers: {} });
		return (async function* () {
			const [created, added, delta, done, completed] = textEvents("resp_live", "Live");
			for (const value of [created, added, delta]) yield { text: JSON.stringify(value), value };
			await gate;
			for (const value of [done, completed]) yield { text: JSON.stringify(value), value };
		})();
	};
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: postEvents as any } });
	const seen: string[] = [];
	let released = false;
	const consume = (async () => {
		for await (const event of transport.stream(MODEL, USER_1)) {
			seen.push(event.type);
			if (event.type === "text_delta" && !released) {
				released = true;
				release();
			}
		}
	})();
	await withDeadline(consume, 2000, "text_delta was not delivered before the terminal");
	assert.equal(released, true);
	assert.equal(seen[0], "start");
	assert.ok(seen.indexOf("text_delta") < seen.indexOf("done"));
	assert.equal(seen.filter((type) => type === "done" || type === "error").length, 1);
	assert.equal(seen.at(-1), "done");
});

test("live display: onProviderStreamEvent runs before the display event of the same delta; one start, one terminal", async () => {
	const log: string[] = [];
	const sse = sseScript([{ events: textEvents("resp_order", "Hi") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const consume = (async () => {
		for await (const event of transport.stream(MODEL, USER_1, {
			onProviderStreamEvent: (event: { type: string }) => {
				log.push(`hook:${event.type}`);
			},
		} as any)) {
			log.push(`display:${event.type}`);
		}
	})();
	await withDeadline(consume, 2000, "stream did not finish");
	assert.equal(log[0], "display:start");
	assert.ok(log.indexOf("hook:response.output_text.delta") < log.indexOf("display:text_delta"));
	assert.equal(log.filter((entry) => entry === "display:start").length, 1);
	assert.equal(log.filter((entry) => entry === "display:done" || entry === "display:error").length, 1);
	assert.equal(log.at(-1), "display:done");
});

test("live display: a retried attempt's unfinished text is closed and dropped; the final text is not doubled", async () => {
	let attempt = 0;
	const postEvents = (options: any) => {
		attempt++;
		const n = attempt;
		return (async function* () {
			options.onResponse({ status: 200, headers: {} });
			if (n === 1) {
				const [created, added, delta] = textEvents("resp_rt1", "PARTIAL");
				for (const value of [created, added, delta]) yield { text: JSON.stringify(value), value };
				throw new SseError(200, {}, "stream closed before response.completed", "eof");
			}
			for (const value of textEvents("resp_rt2", "final")) yield { text: JSON.stringify(value), value };
		})();
	};
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: postEvents as any } });
	const events = await withDeadline(collect(transport.stream(MODEL, USER_1)), 2000, "stream did not finish");
	assert.equal(attempt, 2);
	assert.equal(events.filter((e) => e.type === "start").length, 1);
	assert.equal(events.filter((e) => e.type === "done" || e.type === "error").length, 1);
	const done = events.at(-1) as any;
	assert.equal(done.type, "done");
	const text = done.message.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("");
	assert.equal(text, "final");
	assert.ok(events.some((e) => e.type === "text_end" && (e as any).content === "PARTIAL"));
	assert.deepEqual(timing.sleeps, [200]);
});

test("quota after a completed call: the call is handed to Pi once, then the pending error ends the turn with no query or extra usage", async () => {
	const failed = {
		type: "response.failed",
		response: { id: "resp_qc", error: { code: "insufficient_quota", message: "raw server text must not leak", type: "x" }, usage: rawUsage(12, 4, 3, 2) },
	};
	const sse = sseScript([{ events: [{ type: "response.created", response: { id: "resp_qc" } }, toolEvents("resp_qc", "call_qc")[1], failed] }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const first = await collect(transport.stream(MODEL, USER_1));
	const done = first.at(-1) as any;
	assert.equal(done.type, "done");
	assert.equal(done.reason, "toolUse");
	assert.equal(first.filter((e) => e.type === "toolcall_end").length, 1);
	assert.equal(done.message.content.filter((c: any) => c.type === "toolCall").length, 1);
	assert.deepEqual(done.message.usage, {
		input: 9,
		output: 4,
		cacheRead: 3,
		cacheWrite: 0,
		reasoning: 2,
		totalTokens: 16,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	});
	assert.equal(sse.calls.length, 1);
	const toolResult = { role: "toolResult", toolCallId: done.message.content[0].id, toolName: "lookup", content: [{ type: "text", text: "42" }], isError: false, timestamp: 4 };
	const second = await collect(transport.stream(MODEL, { ...USER_1, messages: [...USER_1.messages, done.message, toolResult] } as any));
	assert.equal(second.filter((e) => e.type === "done" || e.type === "error").length, 1);
	assert.equal(second.at(-1)?.type, "error");
	const pending = second.at(-1) as any;
	assert.match(String(pending.error.errorMessage), /Quota exceeded/);
	assert.deepEqual(pending.error.usage, {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	});
	assert.equal(done.message.usage.totalTokens + pending.error.usage.totalTokens, 16);
	assert.equal(sse.calls.length, 1);
	assert.deepEqual(timing.sleeps, []);
});

// ---- metadata update (owned identity, no socket or turn-state side effects) ----------------------------------------

test("updateMetadata: window, workspaces and compaction reach the next sample's body and headers", async () => {
	const sse = sseScript([{ events: textEvents("resp_m1", "one") }, { events: textEvents("resp_m2", "two") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	await collect(transport.stream(MODEL, USER_1));
	transport.updateMetadata({
		windowId: "22222222-2222-4333-8444-555555555555:1",
		windowNumber: 2,
		contextWindowId: "ctx-2",
		workspaces: { "/repo": { has_changes: true } },
		compaction: { trigger: "auto", reason: "context_limit", implementation: "memento", phase: "pre_turn" },
	});
	const events = await collect(transport.stream(MODEL, userTurn("second", USER_1)));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(sse.calls.length, 2);
	assert.equal(sse.calls[0].headers["x-codex-window-id"], IDENTITY.windowId);
	assert.equal(sse.calls[1].headers["x-codex-window-id"], "22222222-2222-4333-8444-555555555555:1");
	const meta = JSON.parse(sse.calls[1].headers["x-codex-turn-metadata"]);
	assert.equal(meta.window_number, 2);
	assert.equal(meta.context_window_id, "ctx-2");
	assert.deepEqual(meta.workspaces, { "/repo": { has_changes: true } });
	const body = decodeBody(sse.calls[1].body);
	assert.equal(body.client_metadata["x-codex-window-id"], "22222222-2222-4333-8444-555555555555:1");
	assert.equal(JSON.parse(body.client_metadata["x-codex-turn-metadata"]).window_number, 2);
});

test("updateMetadata: a healthy shared WebSocket is not reconnected and keeps its turn state and continuation", async () => {
	const sockets = fakeSocketFactory([[textEvents("resp_u1", "one")], [textEvents("resp_u2", "two")]]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: sockets.connect } });
	transport.beginTurn({ turnId: "turn_u" });
	await collect(transport.stream(MODEL, USER_1));
	transport.updateMetadata({ windowId: "33333333-2222-4333-8444-555555555555:2", windowNumber: 3 });
	assert.equal(transport.identity.turnId, "turn_u");
	const turn2 = userTurn("second", { ...USER_1, messages: [...USER_1.messages, { role: "assistant", content: [{ type: "text", text: "one" }], api: "openai-codex-responses", provider: "openai-codex", model: "gpt-6-luna", responseId: "resp_u1", usage: {}, stopReason: "stop", timestamp: 3 }] } as any);
	const events = await collect(transport.stream(MODEL, turn2));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(sockets.connects.length, 1);
	assert.equal(sockets.heads.length, 1);
	assert.equal(sockets.sent[1].previous_response_id, "resp_u1");
	assert.equal(sockets.sent[1].client_metadata["x-codex-window-id"], "33333333-2222-4333-8444-555555555555:2");
	assert.equal(sockets.sent[1].client_metadata.turn_id, "turn_u");
});

test("updateMetadata: two threads do not share metadata changes", async () => {
	const shared = { ...IDENTITY };
	const other = { ...IDENTITY, threadId: "thread-2", windowId: "44444444-2222-4333-8444-555555555555:0" };
	const sse = sseScript([{ events: textEvents("resp_t1", "a") }, { events: textEvents("resp_t2", "b") }]);
	const timing = clockAndSleep();
	const first = new CodexThreadTransport({ identity: shared, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const second = new CodexThreadTransport({ identity: other, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	first.updateMetadata({ windowId: "55555555-2222-4333-8444-555555555555:9", windowNumber: 9 });
	assert.equal(second.identity.windowId, other.windowId);
	assert.equal(second.identity.windowNumber, undefined);
	assert.equal(shared.windowId, IDENTITY.windowId);
	await collect(second.stream(MODEL, USER_1));
	assert.equal(sse.calls[0].headers["x-codex-window-id"], other.windowId);
	assert.equal(JSON.parse(sse.calls[0].headers["x-codex-turn-metadata"]).window_number, undefined);
	await collect(first.stream(MODEL, USER_1));
	assert.equal(sse.calls[1].headers["x-codex-window-id"], "55555555-2222-4333-8444-555555555555:9");
});

test("updateMetadata: lineage and turn id changes fail before anything is sent, and a same value is a no-op", async () => {
	const sse = sseScript([{ events: textEvents("resp_i1", "a") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const changes: Array<Record<string, unknown>> = [
		{ installationId: "other-install" },
		{ threadId: "thread-9" },
		{ rootSessionId: "root-9" },
		{ parentThreadId: "parent-9" },
		{ subagentKind: "review" },
		{ turnId: "turn_x" },
	];
	for (const change of changes) {
		assert.throws(() => transport.updateMetadata(change as any), /cannot be updated|managed only/);
	}
	// A mixed update is refused as a whole: the window change is not applied.
	assert.throws(() => transport.updateMetadata({ windowId: "66666666-2222-4333-8444-555555555555:3", threadId: "thread-9" }), /fixed at construction/);
	assert.equal(transport.identity.windowId, IDENTITY.windowId);
	assert.equal(transport.identity.threadId, IDENTITY.threadId);
	assert.equal(transport.identity.turnId, undefined);
	assert.doesNotThrow(() => transport.updateMetadata({ threadId: IDENTITY.threadId, installationId: IDENTITY.installationId, rootSessionId: IDENTITY.rootSessionId }));
	assert.doesNotThrow(() => transport.updateMetadata({ parentThreadId: undefined, subagentKind: undefined, turnId: undefined }));
	assert.throws(() => transport.updateMetadata({ extra: { turn_id: "x" } }), /reserved/);
	const events = await collect(transport.stream(MODEL, USER_1));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(sse.calls.length, 1);
	assert.equal(sse.calls[0].headers["x-codex-window-id"], IDENTITY.windowId);
});

test("prewarm first-turn race: a prewarm body and headers carry request_kind prewarm and no turn_id", async () => {
	const sockets = fakeSocketFactory([[[{ type: "response.created", response: { id: "resp_race" } }, completedEvent("resp_race")]], [textEvents("resp_race_turn", "real")]]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: sockets.connect } });
	const pre = transport.prewarm(MODEL, USER_1);
	transport.beginTurn({ turnId: "turn_first" });
	await pre;
	assert.equal(sockets.sent[0].generate, false);
	assert.equal(sockets.sent[0].client_metadata.turn_id, undefined);
	const prewarmMeta = JSON.parse(sockets.sent[0].client_metadata["x-codex-turn-metadata"]);
	assert.equal(prewarmMeta.request_kind, "prewarm");
	assert.equal(prewarmMeta.turn_id, undefined);
	assert.equal(prewarmMeta.turn_started_at_unix_ms, undefined);
	assert.equal(JSON.parse(sockets.heads[0]["x-codex-turn-metadata"]).turn_id, undefined);
	const events = await collect(transport.stream(MODEL, userTurn("next", USER_1)));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(sockets.connects.length, 1);
	assert.equal(sockets.sent[1].previous_response_id, "resp_race");
	assert.equal(sockets.sent[1].client_metadata.turn_id, "turn_first");
	assert.equal(JSON.parse(sockets.sent[1].client_metadata["x-codex-turn-metadata"]).request_kind, "turn");
});

// ---- owner guard after payload hooks and sendRaw auth recovery (reload, then refresh) -------------------------------

function accessForAccount(account: string, tag: string): string {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return `${b64url({ alg: "none" })}.${b64url({ exp, tag, "https://api.openai.com/auth": { chatgpt_account_id: account } })}.sig`;
}

function storedGrant(access: string, accountId = ACCOUNT) {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return { type: "oauth", access, refresh: "refresh-1", expires: exp * 1000, accountId } as never;
}

function refreshingFetch(access: string) {
	const calls: string[] = [];
	const fetch = async (url: string) => {
		calls.push(url);
		return Response.json({ access_token: access, refresh_token: "refresh-2", expires_in: 3600 });
	};
	return { fetch: fetch as any, calls };
}

test("sendRaw SSE 401: reload, then refresh, each followed by a retry of the same bytes; onPayload once; success", async () => {
	const unauthorized = () => ({ error: new SseError(401, {}, "request failed with HTTP 401", "status"), status: 401 });
	const refreshed = fakeAccess("refreshed");
	const sse = sseScript([unauthorized(), unauthorized(), { events: textEvents("resp_auth", "ok") }]);
	const refresh = refreshingFetch(refreshed);
	const timing = clockAndSleep();
	const store = await seededStore();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store, dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn, fetch: refresh.fetch } });
	let hookCalls = 0;
	const events = await collect(transport.sendRaw({
		request: RAW_REQUEST,
		model: MODEL,
		requestKind: "compaction",
		transport: "sse",
		options: { onPayload: () => { hookCalls++; return undefined; } } as any,
	}) as any);
	assert.equal(events.at(-1)?.type, "response.completed");
	assert.equal(hookCalls, 1);
	assert.equal(sse.calls.length, 3);
	assert.equal(refresh.calls.length, 1);
	for (const call of sse.calls) assert.equal(Buffer.compare(Buffer.from(call.body), Buffer.from(sse.calls[0].body)), 0);
	assert.equal(sse.calls[1].headers.Authorization, sse.calls[0].headers.Authorization);
	assert.equal(sse.calls[2].headers.Authorization, `Bearer ${refreshed}`);
	const stored = (await store.read("openai-codex")) as any;
	assert.equal(stored.access, refreshed);
});

test("sendRaw SSE 401 three times: one terminal auth error, no fourth request, no token in the error", async () => {
	const unauthorized = () => ({ error: new SseError(401, {}, "request failed with HTTP 401", "status"), status: 401 });
	const refreshed = fakeAccess("refreshed-terminal");
	const sse = sseScript([unauthorized(), unauthorized(), unauthorized(), { events: textEvents("resp_never", "x") }]);
	const refresh = refreshingFetch(refreshed);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn, fetch: refresh.fetch } });
	await assert.rejects(collect(transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "compaction", transport: "sse" }) as any), (error: Error) => {
		assert.equal((error as any).kind, "unauthorized");
		const text = `${error.message} ${(error as any).code ?? ""}`;
		assert.equal(text.includes(refreshed), false);
		assert.equal(text.includes("refresh-2"), false);
		assert.equal(text.includes("Bearer"), false);
		return true;
	});
	assert.equal(sse.calls.length, 3);
	assert.equal(refresh.calls.length, 1);
	assert.deepEqual(timing.sleeps, []);
});

test("sendRaw WebSocket upgrade 401: reload then retry on a new handshake with the same body; success", async () => {
	const sockets = fakeSocketFactory([[textEvents("resp_wsauth", "ok")]], { connectErrors: [new SocketError(401, {}, "unauthorized", "upgrade-rejected")] });
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: sockets.connect } });
	const events = await collect(transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "compaction", transport: "websocket" }) as any);
	assert.equal(events.at(-1)?.type, "response.completed");
	assert.equal(sockets.heads.length, 2);
	assert.equal(sockets.heads[1].Authorization, sockets.heads[0].Authorization);
	assert.equal(sockets.sent.length, 1);
	assert.equal(sockets.sent[0].generate, undefined);
	assert.deepEqual(timing.sleeps, []);
});

test("sendRaw: a 401 after an event was yielded is not replayed", async () => {
	const calls: number[] = [];
	const postEvents = (options: any) => {
		calls.push(calls.length);
		options.onResponse({ status: 200, headers: {} });
		return (async function* () {
			yield { text: "", value: { type: "response.created", response: { id: "resp_partial" } } };
			throw new SseError(401, {}, "request failed with HTTP 401", "status");
		})();
	};
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: postEvents as any } });
	const seen: string[] = [];
	await assert.rejects(async () => {
		for await (const event of transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "compaction", transport: "sse" }) as any) seen.push(event.type);
	}, (error: Error) => (error as any).kind === "unauthorized");
	assert.deepEqual(seen, ["response.created"]);
	assert.equal(calls.length, 1);
});

test("account switched during onPayload (stream): one local terminal, zero network calls, no borrowed login", async () => {
	const store = await seededStore();
	const other = accessForAccount("acct_other", "switched");
	const sse = sseScript([{ events: textEvents("resp_sw", "never") }]);
	let connects = 0;
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store, dependencies: { ...timing.dependencies, connect: async () => { connects++; throw new SocketError(426, {}, "upgrade required", "upgrade-rejected"); }, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1, {
		onPayload: async () => {
			await store.modify("openai-codex", async () => storedGrant(other, "acct_other"));
		},
	} as any));
	assert.equal(events.at(-1)?.type, "error");
	assert.match(String((events.at(-1) as any).error.errorMessage), /changed while the request was prepared/);
	assert.equal(String((events.at(-1) as any).error.errorMessage).includes(other), false);
	assert.equal(sse.calls.length, 0);
	assert.equal(connects, 0);
});

test("account switched during onPayload (sendRaw WebSocket): zero connects, zero sends, one local error", async () => {
	const store = await seededStore();
	const other = accessForAccount("acct_other", "switched-raw");
	const sockets = fakeSocketFactory([[textEvents("resp_never_ws", "x")]]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store, dependencies: { ...timing.dependencies, connect: sockets.connect } });
	await assert.rejects(collect(transport.sendRaw({
		request: RAW_REQUEST,
		model: MODEL,
		requestKind: "compaction",
		transport: "websocket",
		options: { onPayload: async () => { await store.modify("openai-codex", async () => storedGrant(other, "acct_other")); } } as any,
	}) as any), /changed while the request was prepared/);
	assert.equal(sockets.heads.length, 0);
	assert.equal(sockets.sent.length, 0);
});

test("logout during onPayload: one local terminal and zero network calls", async () => {
	const store = await seededStore();
	const sse = sseScript([{ events: textEvents("resp_lo", "never") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store, dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	await assert.rejects(collect(transport.sendRaw({
		request: RAW_REQUEST,
		model: MODEL,
		requestKind: "compaction",
		transport: "sse",
		options: { onPayload: async () => { await store.delete("openai-codex"); } } as any,
	}) as any), /changed while the request was prepared/);
	assert.equal(sse.calls.length, 0);
	const events = await collect(transport.stream(MODEL, USER_1, { onPayload: async () => { await store.delete("openai-codex"); } } as any));
	assert.equal(events.at(-1)?.type, "error");
	assert.equal(sse.calls.length, 0);
});

test("same-account access rotation during onPayload is allowed and the fresh grant is sent", async () => {
	const store = await seededStore();
	const rotated = fakeAccess("rotated-in-hook");
	const sse = sseScript([{ events: textEvents("resp_rot", "ok") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store, dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER_1, {
		onPayload: async () => {
			await store.modify("openai-codex", async () => storedGrant(rotated));
		},
	} as any));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(sse.calls.length, 1);
	assert.equal(sse.calls[0].headers.Authorization, `Bearer ${rotated}`);
	assert.equal(sse.calls[0].headers["ChatGPT-Account-ID"], ACCOUNT);
});

test("hung send: abort settles at once, the frame is not repeated, and a late send callback changes nothing", async () => {
	const controller = new AbortController();
	let sends = 0;
	let closes = 0;
	let sendStarted: () => void = () => undefined;
	const started = new Promise<void>((resolve) => {
		sendStarted = resolve;
	});
	let releaseSend: () => void = () => undefined;
	const blocked = new Promise<void>((resolve) => {
		releaseSend = resolve;
	});
	const connect = async () => {
		let open = true;
		return {
			get isOpen() {
				return open;
			},
			socketIdentity: "socket-hung-send",
			events() {
				return (async function* () {
					await new Promise<void>(() => undefined);
				})();
			},
			async send() {
				sends++;
				sendStarted();
				await blocked;
			},
			async interrupt() {
				throw new Error("unexpected interrupt");
			},
			async close() {
				open = false;
				closes++;
			},
		} as any;
	};
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: connect as any } });
	const pending = collect(transport.stream(MODEL, USER_1, { signal: controller.signal } as any));
	await started;
	const abortedAt = Date.now();
	controller.abort();
	const events = await pending;
	assert.ok(Date.now() - abortedAt < 1000, "abort during a hung send settles at once");
	const terminals = events.filter((e) => e.type === "done" || e.type === "error");
	assert.equal(terminals.length, 1);
	assert.equal((terminals[0] as any).reason, "aborted");
	assert.equal(sends, 1);
	assert.equal(closes >= 1, true);
	releaseSend();
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(sends, 1, "a late send callback sends nothing and no retry follows");
	assert.deepEqual(timing.sleeps, []);
});

test("reused socket: an abort before the next credential send sends nothing", async () => {
	const sockets = fakeSocketFactory([[textEvents("resp_r1", "one")]]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: sockets.connect } });
	const first = await collect(transport.stream(MODEL, USER_1));
	assert.equal(first.at(-1)?.type, "done");
	const controller = new AbortController();
	const events = await collect(transport.stream(MODEL, userTurn("again", USER_1), { signal: controller.signal, onPayload: () => controller.abort() } as any));
	assert.equal((events.at(-1) as any).reason, "aborted");
	assert.equal(sockets.sent.length, 1, "no frame sent after the abort");
	assert.equal(sockets.connects.length, 1);
});

// ---- subscription identity, canonical client_metadata, 426 upgrade fallback, actual effort -----------------------------

test("ordinary transport is subscription-only: the guardian credit request is on for every kind even when the identity says otherwise", async () => {
	const sse = sseScript([{ events: textEvents("resp_sub", "ok") }, { events: textEvents("resp_sub2", "ok") }, { events: textEvents("resp_sub3", "ok") }]);
	const timing = clockAndSleep();
	const identity = { ...IDENTITY, authProfile: "api_key" } as any;
	const transport = new CodexThreadTransport({ identity, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const turn = await collect(transport.stream(MODEL, USER_1));
	assert.equal(turn.at(-1)?.type, "done");
	const raw = await collect(transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "prewarm", transport: "sse" }) as any);
	assert.equal(raw.at(-1)?.type, "response.completed");
	const review = await collect(transport.sendRaw({ request: { ...RAW_REQUEST, client_metadata: { session_id: "root-session-1" } }, model: MODEL, requestKind: "turn", transport: "sse" }) as any);
	assert.equal(review.at(-1)?.type, "response.completed");
	for (const call of sse.calls) {
		const body = decodeBody(call.body) as { client_metadata: Record<string, string> };
		assert.equal(body.client_metadata.guardian_credits_requested, "true");
		assert.equal(Object.keys(call.headers).some((key) => /guardian/i.test(key)), false);
	}
	assert.equal(transport.identity.authProfile, "subscription");
	assert.throws(() => transport.updateMetadata({ authProfile: "api_key" } as any), /authProfile is fixed/);
});

test("sendRaw keeps the caller's client_metadata blob and adds the canonical identity and credit default under it", async () => {
	const sse = sseScript([{ events: textEvents("resp_meta", "ok") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	await collect(transport.sendRaw({ request: { ...RAW_REQUEST, client_metadata: { custom_blob: "kept", thread_id: "provided-thread" } }, model: MODEL, requestKind: "compaction", transport: "sse" }) as any);
	const body = decodeBody(sse.calls[0].body) as { client_metadata: Record<string, string> };
	assert.equal(body.client_metadata.custom_blob, "kept");
	assert.equal(body.client_metadata.thread_id, "provided-thread");
	assert.equal(body.client_metadata.session_id, "root-session-1");
	assert.equal(body.client_metadata.guardian_credits_requested, "true");
});

test("sendRaw 426 before any event: immediate SSE with the same prepared body, onPayload once, sticky for this thread only", async () => {
	let connects = 0;
	const connect = async () => {
		connects++;
		throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
	};
	const sse = sseScript([{ events: textEvents("resp_426", "compacted") }, { events: textEvents("resp_turn_after", "after") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: connect as any, postEvents: sse.fn } });
	let hooks = 0;
	const events = await collect(transport.sendRaw({
		request: RAW_REQUEST,
		model: MODEL,
		requestKind: "compaction",
		transport: "websocket",
		options: { onPayload: () => { hooks++; } } as any,
	}) as any);
	assert.equal(events.at(-1)?.type, "response.completed");
	assert.equal(connects, 1);
	assert.equal(hooks, 1);
	assert.equal(sse.calls.length, 1);
	assert.deepEqual(timing.sleeps, []);
	assert.equal(transport.transport, "sse");
	const turn = await collect(transport.stream(MODEL, USER_1));
	assert.equal(turn.at(-1)?.type, "done");
	assert.equal(connects, 1, "the sticky SSE thread never reconnects a WebSocket");
	assert.equal(sse.calls.length, 2);
});

test("actual providerThinkingLevel: default resolves to medium, explicit override is reported, a valid onPayload effort change is reflected", async () => {
	const sse = sseScript([{ events: textEvents("resp_e1", "a") }, { events: textEvents("resp_e2", "b") }, { events: textEvents("resp_e3", "c") }]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const defaulted = await collect(transport.stream(MODEL, USER_1));
	assert.equal((defaulted.at(-1) as any).message.providerThinkingLevel, "medium");
	const explicit = await collect(transport.stream(MODEL, userTurn("again", USER_1), { reasoningEffort: "low" } as any));
	assert.equal((explicit.at(-1) as any).message.providerThinkingLevel, "low");
	const hooked = await collect(transport.stream(MODEL, userTurn("third", USER_1), {
		reasoningEffort: "low",
		onPayload: (body: any) => ({ ...body, reasoning: { ...body.reasoning, effort: "high" } }),
	} as any));
	assert.equal((hooked.at(-1) as any).message.providerThinkingLevel, "high");
	assert.equal((decodeBody(sse.calls[2].body) as { reasoning: { effort: string } }).reasoning.effort, "high");
});

test("direct transport signature scope: an unknown Pi thinkingSignature is dropped, the owner's completed raw item is kept, and owner A cannot fall back to A's encrypted signature after B", async () => {
	const reasoning = (encrypted: string) => ({ type: "reasoning", id: `rs_${encrypted}`, encrypted_content: encrypted, summary: [] });
	const sse = sseScript([
		{ events: [
			{ type: "response.created", response: { id: "resp_A" } },
			{ type: "response.output_item.done", output_index: 0, item: reasoning("ENC_A") },
			{ type: "response.output_item.added", output_index: 1, item: { type: "message", id: "msg_A", role: "assistant", content: [], status: "in_progress" } },
			{ type: "response.output_item.done", output_index: 1, item: { type: "message", id: "msg_A", role: "assistant", status: "completed", content: [{ type: "output_text", text: "hi", annotations: [] }] } },
			completedEvent("resp_A"),
		] },
		{ events: textEvents("resp_2", "second") },
		{ events: textEvents("resp_3", "third") },
		{ events: textEvents("resp_B", "b") },
	]);
	const timing = clockAndSleep();
	const store = await seededStore();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store, dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const first = await collect(transport.stream(MODEL, USER_1));
	const owned = (first.at(-1) as any).message;
	assert.equal(owned.responseId, "resp_A");
	const reasoningIn = (index: number) => (decodeBody(sse.calls[index].body).input as any[]).filter((item) => item.type === "reasoning").map((item) => item.encrypted_content);

	// Owner A, same account: the completed raw reasoning item of resp_A is replayed verbatim.
	const ownerTurn = { ...USER_1, messages: [...USER_1.messages, owned, { role: "user", content: "again", timestamp: 3 }] } as unknown as Context;
	await collect(transport.stream(MODEL, ownerTurn));
	assert.deepEqual(reasoningIn(1), ["ENC_A"]);

	// An unproven Pi thinkingSignature (no raw entry for its response) is never replayed.
	const unknown = { role: "assistant", content: [{ type: "thinking", thinking: "", thinkingSignature: JSON.stringify(reasoning("ENC_X")) }, { type: "text", text: "x" }], api: MODEL.api, provider: MODEL.provider, model: MODEL.id, usage: {}, stopReason: "stop", responseId: "resp_unknown", timestamp: 3 };
	await collect(transport.stream(MODEL, { ...USER_1, messages: [...USER_1.messages, unknown, { role: "user", content: "third", timestamp: 4 }] } as unknown as Context));
	assert.deepEqual(reasoningIn(2), []);
	assert.equal(JSON.stringify(decodeBody(sse.calls[2].body)).includes("ENC_X"), false);

	// Owner A -> B: the private ledger is cleared; A's encrypted signature in Pi's message is not replayed for B.
	await store.modify("openai-codex", async () => storedGrant(accessForAccount("acct_B", "owner-b"), "acct_B"));
	const bTurn = { ...USER_1, messages: [...USER_1.messages, owned, { role: "user", content: "after switch", timestamp: 5 }] } as unknown as Context;
	const bDone = await collect(transport.stream(MODEL, bTurn));
	assert.equal((bDone.at(-1) as any).type, "done");
	assert.deepEqual(reasoningIn(3), []);
	assert.equal(JSON.stringify(decodeBody(sse.calls[3].body)).includes("ENC_A"), false);
});

// ---- abort during hung hooks and the prewarm budget origin ----------------------------------------------------------

test("hung onPayload: an abort settles the turn as one aborted terminal with no send and no history seed", async () => {
	const sse = sseScript([{ events: textEvents("resp_hang", "x") }]);
	const sockets = fakeSocketFactory([[textEvents("resp_hang_ws", "x")]]);
	const log: string[] = [];
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), history: recordingHistory(log) as any, dependencies: { ...timing.dependencies, connect: sockets.connect, postEvents: sse.fn } });
	const controller = new AbortController();
	const pending = collect(transport.stream(MODEL, USER_1, { signal: controller.signal, onPayload: () => new Promise(() => undefined) } as any));
	setTimeout(() => controller.abort(), 5);
	const events = await withDeadline(pending, 2000, "hung onPayload abort");
	const terminals = events.filter((e) => e.type === "done" || e.type === "error");
	assert.equal(terminals.length, 1);
	assert.equal((terminals[0] as any).reason, "aborted");
	assert.equal(events.at(-1), terminals[0]);
	assert.equal(sockets.connects.length, 0);
	assert.equal(sockets.sent.length, 0);
	assert.equal(sse.calls.length, 0);
	assert.deepEqual(log, []);
});

test("late onPayload resolve after an abort sends nothing and seeds no history", async () => {
	const sse = sseScript([{ events: textEvents("resp_late", "x") }]);
	const sockets = fakeSocketFactory([[textEvents("resp_late_ws", "x")]]);
	const log: string[] = [];
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), history: recordingHistory(log) as any, dependencies: { ...timing.dependencies, connect: sockets.connect, postEvents: sse.fn } });
	const controller = new AbortController();
	let release: (value: unknown) => void = () => undefined;
	const pending = collect(transport.stream(MODEL, USER_1, { signal: controller.signal, onPayload: () => new Promise((resolve) => { release = resolve; }) } as any));
	setTimeout(() => controller.abort(), 5);
	const events = await withDeadline(pending, 2000, "late onPayload abort");
	assert.equal((events.at(-1) as any).reason, "aborted");
	release({ model: MODEL.id });
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(sockets.connects.length, 0);
	assert.equal(sockets.sent.length, 0);
	assert.equal(sse.calls.length, 0);
	assert.deepEqual(log, []);
});

test("hung prewarm hook: the first turn after the 15 s budget aborts the prewarm and proceeds", async () => {
	let now = 1_000_000;
	const sockets = fakeSocketFactory([[textEvents("resp_budget", "real")]]);
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { random: () => 0.5, sleep: async () => undefined, clock: { now: () => now }, connect: sockets.connect } });
	const pre = transport.prewarm(MODEL, USER_1, { onPayload: () => new Promise(() => undefined) } as any);
	now += 15_001;
	const events = await withDeadline(collect(transport.stream(MODEL, userTurn("next", USER_1))), 2000, "hung prewarm budget");
	await withDeadline(pre, 2000, "hung prewarm settle");
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(sockets.connects.length, 1);
	assert.equal(sockets.sent.length, 1);
	assert.equal(sockets.sent[0].generate, undefined);
});

test("prewarm budget origin: a supplied older start leaves only the remaining budget; the default starts at the prewarm call", async () => {
	const cases = [
		{ name: "supplied older start", supplied: true, advance: 0 },
		{ name: "default start", supplied: false, advance: 14_990 },
	];
	for (const kase of cases) {
		let now = 1_000_000;
		const sockets = fakeSocketFactory([[textEvents("resp_origin", "real")]]);
		const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { random: () => 0.5, sleep: async () => undefined, clock: { now: () => now }, connect: sockets.connect } });
		const pre = transport.prewarm(MODEL, USER_1, {
			onPayload: () => new Promise(() => undefined),
			...(kase.supplied ? { prewarmStartedAt: now - 14_990 } : {}),
		} as any);
		now += kase.advance;
		const started = Date.now();
		const events = await withDeadline(collect(transport.stream(MODEL, userTurn("next", USER_1))), 5000, kase.name);
		await withDeadline(pre, 2000, `${kase.name} prewarm settle`);
		assert.ok(Date.now() - started < 5000, `${kase.name}: waited beyond the remaining budget`);
		assert.equal(events.at(-1)?.type, "done");
		assert.equal(sockets.sent.length, 1);
		assert.equal(sockets.sent[0].generate, undefined);
	}
});

test("held stream-event hook: an abort ends the turn as aborted with no continued request", async () => {
	const sse = sseScript([{ events: textEvents("resp_held", "x") }, { events: textEvents("resp_held2", "y") }]);
	const controller = new AbortController();
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await withDeadline(collect(transport.stream(MODEL, USER_1, {
		signal: controller.signal,
		onProviderStreamEvent: () => {
			setTimeout(() => controller.abort(), 5);
			return new Promise(() => undefined);
		},
	} as any)), 2000, "held stream-event hook");
	const terminals = events.filter((e) => e.type === "done" || e.type === "error");
	assert.equal(terminals.length, 1);
	assert.equal((terminals[0] as any).reason, "aborted");
	assert.equal(events.at(-1), terminals[0]);
	assert.equal(sse.calls.length, 1);
	assert.deepEqual(timing.sleeps, []);
});

// ---- explicit prewarm input mode ------------------------------------------------------------------------------------

const userTexts = (input: any[]): string[] =>
	input.filter((item) => item.role === "user").map((item) => JSON.stringify(item.content));

test("explicit prewarm history: before any generation the history is sent once, with the prefix once", async () => {
	const sockets = fakeSocketFactory([[[{ type: "response.created", response: { id: "resp_hist" } }, completedEvent("resp_hist")]]]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: sockets.connect } });
	await transport.prewarm(MODEL, USER_1, { prewarmInput: "history" } as any);
	assert.equal(sockets.sent.length, 1);
	assert.equal(sockets.sent[0].generate, false);
	const texts = userTexts(sockets.sent[0].input);
	assert.equal(texts.length, 1);
	assert.match(texts[0], /hello/);
	assert.equal(sockets.sent[0].input.filter((item: { role?: string }) => item.role === "system" || item.role === "developer").length <= 1, true);
});

test("explicit prewarm base: an empty history is sent; the caller history is not", async () => {
	const sockets = fakeSocketFactory([[[{ type: "response.created", response: { id: "resp_base" } }, completedEvent("resp_base")]]]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: sockets.connect } });
	await transport.prewarm(MODEL, USER_1, { prewarmInput: "base" } as any);
	assert.equal(sockets.sent.length, 1);
	assert.equal(sockets.sent[0].generate, false);
	assert.equal(userTexts(sockets.sent[0].input).length, 0);
});

test("explicit prewarm history: a healthy socket is not prewarmed again (no hook, no extra frame)", async () => {
	const sockets = fakeSocketFactory([[[{ type: "response.created", response: { id: "resp_again" } }, completedEvent("resp_again")]]]);
	const timing = clockAndSleep();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing.dependencies, connect: sockets.connect } });
	let hooks = 0;
	const options = { prewarmInput: "history", onPayload: () => { hooks++; return undefined; } } as any;
	await transport.prewarm(MODEL, USER_1, options);
	await transport.prewarm(MODEL, USER_1, options);
	assert.equal(hooks, 1);
	assert.equal(sockets.sent.length, 1);
	assert.equal(sockets.connects.length, 1);
});
