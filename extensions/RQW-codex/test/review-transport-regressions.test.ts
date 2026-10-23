// Regression tests for the admitted transport review findings (extensions/RQW-codex/transport.ts): WebSocket retirement on every
// exit before an accepted terminal, sticky turn state from response metadata events, prepared-owner refusal, and request header
// merging. Fake WebSocket queues that keep unread frames, fake SSE POST, in-memory fake credentials. No network, no real credentials.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as zlib from "node:zlib";
import { InMemoryCredentialStore, type Api, type Context, type Model } from "@earendil-works/pi-ai";

import { SocketError } from "../websocket.ts";
import { SseError } from "../sse.ts";
import { CodexThreadTransport } from "../transport.ts";

const ACCOUNT = "acct_test_1";
const OTHER_ACCOUNT = "acct_other";
const IDENTITY = {
	installationId: "11111111-2222-4333-8444-555555555555",
	windowId: "11111111-2222-4333-8444-555555555555:0",
	rootSessionId: "root-session-1",
	threadId: "thread-1",
};

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// One expiry for the whole file: the generator must return the same string for the same inputs when an assertion
// recomputes the expected bearer, also after a wall-clock second boundary (CI 39963174961 and 39966713960).
const TOKEN_EXP = Math.floor(Date.now() / 1000) + 3600;

function accessFor(account: string, tag = ""): string {
	return `${b64url({ alg: "none" })}.${b64url({ exp: TOKEN_EXP, tag, "https://api.openai.com/auth": { chatgpt_account_id: account } })}.sig`;
}

function grant(access: string, accountId = ACCOUNT) {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return { type: "oauth", access, refresh: "refresh-1", expires: exp * 1000, accountId } as never;
}

async function seededStore(access = accessFor(ACCOUNT, "first")): Promise<InMemoryCredentialStore> {
	const store = new InMemoryCredentialStore();
	await store.modify("openai-codex", async () => grant(access));
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

const completedEvent = (id: string) => ({
	type: "response.completed",
	response: { id, status: "completed", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } },
});

const textEvents = (id: string, text: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", content: [], status: "in_progress" } },
	{ type: "response.output_text.delta", item_id: `msg_${id}`, output_index: 0, content_index: 0, delta: text },
	{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
	completedEvent(id),
];

const staleText = (id: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", content: [], status: "in_progress" } },
	{ type: "response.output_text.delta", item_id: `msg_${id}`, output_index: 0, content_index: 0, delta: "STALE" },
	{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: "STALE", annotations: [] }] } },
	completedEvent(id),
];

const staleToolEvents = (id: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc_stale", call_id: "stale_call", name: "lookup", arguments: "{\"q\":1}", status: "completed" } },
	completedEvent(id),
];

// Same shape as transport.test.ts toolEvents: one completed function_call item (name lookup, arguments {"q":1}), not executed here.
const toolCallEvents = (id: string, callId: string) => [
	{ type: "response.created", response: { id } },
	{
		type: "response.output_item.done",
		output_index: 0,
		item: { type: "function_call", id: `fc_${callId}`, call_id: callId, name: "lookup", arguments: "{\"q\":1}", status: "completed" },
	},
	completedEvent(id),
];

const metadata = (headers: Record<string, unknown>) => ({ type: "response.metadata", headers });

function decodeBody(bytes: Uint8Array): Record<string, unknown> {
	return JSON.parse(zlib.zstdDecompressSync(Buffer.from(bytes)).toString("utf8")) as Record<string, unknown>;
}

async function collect(stream: AsyncIterable<{ type: string; [k: string]: unknown }>): Promise<{ type: string; [k: string]: unknown }[]> {
	const out: { type: string; [k: string]: unknown }[] = [];
	for await (const event of stream) out.push(event);
	return out;
}

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

/**
 * Fake WebSocket with a real unread queue. Each send consumes one scripted step: a batch is queued on THIS socket, an Error
 * makes the send reject. events() yields from the queue and stops early when the consumer stops; nothing drains the queue on
 * close, so frames left unread stay behind for any later reuse of the same socket.
 */
function queueSockets(sends: Array<unknown[] | Error>, options: { connectErrors?: Array<Error | undefined>; upgradeHeaders?: Record<string, unknown> } = {}) {
	const sockets: { queue: unknown[]; closes: number; open: boolean }[] = [];
	const sent: any[] = [];
	const heads: Record<string, string>[] = [];
	const plan = [...(options.connectErrors ?? [])];
	const connect = async (connectOptions: any) => {
		heads.push(connectOptions.headers);
		const planned = plan.shift();
		if (planned) throw planned;
		connectOptions.onResponse?.({ status: 101, headers: options.upgradeHeaders ?? {} });
		const record = { queue: [] as unknown[], closes: 0, open: true };
		const queue = record.queue;
		sockets.push(record);
		return {
			get isOpen() {
				return record.open;
			},
			socketIdentity: `queue-socket-${sockets.length}`,
			events() {
				return (async function* () {
					while (queue.length > 0) {
						const value = queue.shift() as Record<string, unknown>;
						yield { text: JSON.stringify(value), value };
					}
				})();
			},
			async send(object: unknown) {
				sent.push(object);
				const step = sends.shift();
				if (step === undefined) throw new Error("unexpected send");
				if (step instanceof Error) throw step;
				queue.push(...step);
			},
			async interrupt() {
				return { acknowledged: true as const, completed: false };
			},
			async close() {
				record.open = false;
				record.closes++;
			},
		} as any;
	};
	return { connect: connect as any, sockets, sent, heads };
}

function sseScript(scripts: Array<{ events?: unknown[] }>) {
	const calls: { url: string; headers: Record<string, string>; body: Uint8Array }[] = [];
	const fn = (options: any) => {
		calls.push({ url: options.url, headers: options.headers, body: options.body });
		const step = scripts.shift();
		if (!step) throw new Error("unexpected SSE request");
		return (async function* () {
			options.onResponse({ status: 200, headers: {} });
			for (const value of step.events ?? []) yield { text: JSON.stringify(value), value };
		})();
	};
	return { fn: fn as any, calls };
}

// No WebSocket in SSE tests: every connect is refused with 426, the native sticky SSE fallback.
const upgradeRequired = async (): Promise<never> => {
	throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
};

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

function transportWith(connect: unknown, store: InMemoryCredentialStore, extra: Record<string, unknown> = {}) {
	const timing = clockAndSleep();
	return { timing, transport: new CodexThreadTransport({ identity: IDENTITY, store, dependencies: { ...timing.dependencies, connect: connect as any, ...extra } }) };
}

// ---- WebSocket retirement: any exit before an accepted terminal ------------------------------------------------------

test("onProviderStreamEvent failure on WebSocket: one local error, no retry, the next request reconnects and sees only fresh content", async () => {
	const ws = queueSockets([staleText("resp_stale"), textEvents("resp_fresh", "FRESH")]);
	const { transport } = transportWith(ws.connect, await seededStore());
	let failed = false;
	const first = await collect(transport.stream(MODEL, USER_1, {
		onProviderStreamEvent: (event: { type: string; delta?: string }) => {
			if (event.type === "response.output_text.delta" && event.delta === "STALE") {
				failed = true;
				throw new Error("hook refused");
			}
		},
	} as any));
	assert.equal(failed, true);
	assert.equal(first.at(-1)?.type, "error");
	assert.match(JSON.stringify(first.at(-1)), /onProviderStreamEvent hook failed/);
	assert.equal(ws.sent.length, 1);
	assert.equal(ws.sockets[0].open, false);
	const second = await collect(transport.stream(MODEL, userTurn("again", USER_1)));
	assert.equal(second.at(-1)?.type, "done");
	assert.equal(ws.sent.length, 2);
	assert.equal(ws.sockets.length, 2);
	assert.match(JSON.stringify(second), /FRESH/);
	assert.doesNotMatch(JSON.stringify(second), /STALE/);
});

test("onProviderStreamEvent failure on WebSocket: an unread stale tool call is never executed by the next request", async () => {
	const ws = queueSockets([staleToolEvents("resp_tool_stale"), textEvents("resp_clean", "clean")]);
	const { transport } = transportWith(ws.connect, await seededStore());
	const first = await collect(transport.stream(MODEL, USER_1, {
		onProviderStreamEvent: (event: { type: string }) => {
			if (event.type === "response.created") throw new Error("hook refused");
		},
	} as any));
	assert.equal(first.at(-1)?.type, "error");
	const second = await collect(transport.stream(MODEL, userTurn("again", USER_1)));
	assert.equal(second.at(-1)?.type, "done");
	assert.equal(ws.sockets.length, 2);
	assert.doesNotMatch(JSON.stringify(second), /stale_call/);
	assert.equal(second.some((event) => event.type === "toolcall_end"), false);
});

test("live display parser failure on WebSocket: the bad completed item closes the pump; the stale rest is dropped, the next request reconnects", async () => {
	const badItem = [
		{ type: "response.created", response: { id: "resp_bad" } },
		{ type: "response.output_item.done", output_index: 0, item: null },
		{ type: "response.output_text.delta", item_id: "msg_bad", output_index: 0, content_index: 0, delta: "STALE" },
		{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_bad", role: "assistant", status: "completed", content: [{ type: "output_text", text: "STALE", annotations: [] }] } },
		completedEvent("resp_bad"),
	];
	const ws = queueSockets([badItem, textEvents("resp_ok", "OK")]);
	const { transport } = transportWith(ws.connect, await seededStore());
	const first = await collect(transport.stream(MODEL, USER_1));
	assert.equal(first.at(-1)?.type, "error");
	assert.match(JSON.stringify(first.at(-1)), /display parser failed/);
	assert.doesNotMatch(JSON.stringify(first), /"done"/);
	assert.equal(ws.sent.length, 1, "a local parser failure is not retried");
	assert.equal(ws.sockets[0].open, false);
	const second = await collect(transport.stream(MODEL, userTurn("again", USER_1)));
	assert.equal(second.at(-1)?.type, "done");
	assert.equal(ws.sockets.length, 2);
	assert.doesNotMatch(JSON.stringify(second), /STALE/);
	assert.match(JSON.stringify(second), /OK/);
});

test("sendRaw consumer returns early on WebSocket: the socket with unread frames is retired and the next request reconnects", async () => {
	const ws = queueSockets([textEvents("resp_raw_stale", "STALE"), textEvents("resp_raw_fresh", "FRESH")]);
	const { transport } = transportWith(ws.connect, await seededStore());
	const gen = transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "turn" });
	const first = await gen.next();
	assert.equal(first.value?.type, "response.created");
	await gen.return(undefined);
	assert.equal(ws.sockets[0].open, false);
	const after = await collect(transport.stream(MODEL, userTurn("again", USER_1)));
	assert.equal(after.at(-1)?.type, "done");
	assert.equal(ws.sockets.length, 2);
	assert.doesNotMatch(JSON.stringify(after), /STALE/);
	assert.match(JSON.stringify(after), /FRESH/);
});

test("sendRaw completed on WebSocket: a caller return after the accepted terminal keeps the healthy socket", async () => {
	const ws = queueSockets([textEvents("resp_keep", "keep"), textEvents("resp_keep_next", "next")]);
	const { transport } = transportWith(ws.connect, await seededStore());
	const gen = transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "turn" });
	let last: { type?: string } | undefined;
	for (;;) {
		const step = await gen.next();
		if (step.done) break;
		last = step.value;
		if (step.value.type === "response.completed") break;
	}
	assert.equal(last?.type, "response.completed");
	await gen.return(undefined);
	const after = await collect(transport.stream(MODEL, userTurn("next", USER_1)));
	assert.equal(after.at(-1)?.type, "done");
	assert.equal(ws.sockets.length, 1, "the completed socket is reused");
	assert.equal(ws.sockets[0].closes, 0);
});

test("prewarm with a failing stream hook on WebSocket: silent, socket retired, the next real request reconnects", async () => {
	const ws = queueSockets([staleText("resp_pw"), textEvents("resp_pw_fresh", "FRESH")]);
	const { transport } = transportWith(ws.connect, await seededStore());
	await transport.prewarm(MODEL, USER_1, {
		onProviderStreamEvent: (event: { type: string }) => {
			if (event.type === "response.output_item.added") throw new Error("hook refused");
		},
	} as any);
	assert.equal(ws.sockets[0].open, false);
	const after = await collect(transport.stream(MODEL, userTurn("next", USER_1)));
	assert.equal(after.at(-1)?.type, "done");
	assert.equal(ws.sockets.length, 2);
	assert.doesNotMatch(JSON.stringify(after), /STALE/);
});

test("a failed WebSocket send retires the socket: the next request reconnects and sends on a new socket only", async () => {
	const ws = queueSockets([new Error("send failed"), textEvents("resp_after_send", "after")]);
	const { transport } = transportWith(ws.connect, await seededStore());
	await assert.rejects(collect(transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "compaction" }) as any));
	assert.equal(ws.sockets[0].open, false);
	const after = await collect(transport.stream(MODEL, USER_1));
	assert.equal(after.at(-1)?.type, "done");
	assert.equal(ws.sockets.length, 2);
	assert.equal(ws.sent.length, 2);
});

// ---- sticky turn state from the response metadata event -----------------------------------------------------------------

test("metadata event without an upgrade token: the next WebSocket request carries the turn state in client_metadata", async () => {
	const ws = queueSockets([[metadata({ "x-codex-turn-state": "tok-meta" }), ...textEvents("resp_m1", "one")], textEvents("resp_m2", "two")]);
	const { transport } = transportWith(ws.connect, await seededStore());
	const first = await collect(transport.stream(MODEL, USER_1));
	assert.equal(first.at(-1)?.type, "done");
	assert.equal(ws.sent[0].client_metadata["x-codex-turn-state"], undefined);
	const second = await collect(transport.stream(MODEL, userTurn("two", USER_1)));
	assert.equal(second.at(-1)?.type, "done");
	assert.equal(ws.sent[1].client_metadata["x-codex-turn-state"], "tok-meta");
	assert.equal(ws.sockets.length, 1);
});

test("tool-loop retry after a failed send carries the metadata turn state on both frames", async () => {
	const ws = queueSockets([[metadata({ "x-codex-turn-state": "tok-retry" }), ...toolCallEvents("resp_r1", "call_r1")], new Error("send dropped"), textEvents("resp_r2", "two")]);
	const { transport } = transportWith(ws.connect, await seededStore());
	const first = await collect(transport.stream(MODEL, USER_1));
	const done = first.at(-1) as any;
	assert.equal(done.type, "done");
	assert.equal(done.reason, "toolUse");
	assert.equal(done.message.stopReason, "toolUse");
	const calls = done.message.content.filter((c: any) => c.type === "toolCall");
	assert.equal(calls.length, 1);
	const toolResult = { role: "toolResult", toolCallId: calls[0].id, toolName: "lookup", content: [{ type: "text", text: "42" }], isError: false, timestamp: 4 };
	const second = await collect(transport.stream(MODEL, { ...USER_1, messages: [...USER_1.messages, done.message, toolResult] } as any));
	assert.equal(second.at(-1)?.type, "done");
	assert.equal(ws.sent.length, 3);
	assert.equal(ws.sent[1].client_metadata["x-codex-turn-state"], "tok-retry");
	assert.equal(ws.sent[2].client_metadata["x-codex-turn-state"], "tok-retry");
	for (const frame of [ws.sent[1], ws.sent[2]]) {
		const outputs = (frame.input as any[]).filter((i) => i.type === "function_call_output" && i.call_id === calls[0].id.split("|")[0]);
		assert.equal(outputs.length, 1, "exactly one tool result item per frame");
	}
	assert.equal(ws.sockets.length, 2);
});

test("invalid or empty metadata values are ignored; the first valid value wins and a second token is ignored", async () => {
	const ws = queueSockets([
		[
			metadata({ "x-codex-turn-state": "" }),
			metadata({ "x-codex-turn-state": 7 }),
			metadata({ "x-codex-turn-state": "bad\u0001value" }),
			metadata({ "X-Codex-Turn-State": "tok-first" }),
			metadata({ "x-codex-turn-state": "tok-second" }),
			...textEvents("resp_v1", "one"),
		],
		textEvents("resp_v2", "two"),
	]);
	const { transport } = transportWith(ws.connect, await seededStore());
	await collect(transport.stream(MODEL, USER_1));
	await collect(transport.stream(MODEL, userTurn("two", USER_1)));
	assert.equal(ws.sent[1].client_metadata["x-codex-turn-state"], "tok-first");
});

test("upgrade token wins over a later metadata event token", async () => {
	const ws = queueSockets([[metadata({ "x-codex-turn-state": "ev-tok" }), ...textEvents("resp_u1", "one")], textEvents("resp_u2", "two")], { upgradeHeaders: { "x-codex-turn-state": "up-tok" } });
	const { transport } = transportWith(ws.connect, await seededStore());
	await collect(transport.stream(MODEL, USER_1));
	await collect(transport.stream(MODEL, userTurn("two", USER_1)));
	assert.equal(ws.sent[1].client_metadata["x-codex-turn-state"], "up-tok");
});

test("a new logical turn clears the metadata turn state: the next request omits it", async () => {
	const ws = queueSockets([[metadata({ "x-codex-turn-state": "tok-turn" }), ...textEvents("resp_t1", "one")], textEvents("resp_t2", "two")]);
	const { transport } = transportWith(ws.connect, await seededStore());
	await collect(transport.stream(MODEL, USER_1));
	transport.beginTurn({ turnId: "turn-2" });
	await collect(transport.stream(MODEL, userTurn("two", USER_1)));
	assert.equal(ws.sent[1].client_metadata["x-codex-turn-state"], undefined);
});

test("SSE metadata event: the turn state is replayed in the next SSE request headers", async () => {
	const sse = sseScript([{ events: [metadata({ "x-codex-turn-state": "tok-sse" }), ...textEvents("resp_s1", "one")] }, { events: textEvents("resp_s2", "two") }]);
	const { transport } = transportWith(upgradeRequired, await seededStore(), { postEvents: sse.fn });
	await collect(transport.stream(MODEL, USER_1));
	assert.equal(sse.calls[0].headers["x-codex-turn-state"], undefined);
	await collect(transport.stream(MODEL, userTurn("two", USER_1)));
	assert.equal(sse.calls[1].headers["x-codex-turn-state"], "tok-sse");
});

// ---- request header merge (adapter headers after configured headers; no stale casing variants) --------------------------

test("configured alternate-cased authorization and turn state never survive: one Authorization, one account header, no sticky reset leftovers", async () => {
	const sse = sseScript([{ events: textEvents("resp_h1", "one") }, { events: textEvents("resp_h2", "two") }]);
	const { transport } = transportWith(upgradeRequired, await seededStore(accessFor(ACCOUNT, "headers")), { postEvents: sse.fn });
	const configured = { authorization: "Bearer stale-configured", "chatgpt-account-id": "old-account", "X-Codex-Turn-State": "cfg-token", "X-Custom": "keep" };
	await collect(transport.stream(MODEL, USER_1, { headers: configured } as any));
	const first = sse.calls[0].headers;
	assert.deepEqual(Object.keys(first).filter((name) => name.toLowerCase() === "authorization"), ["Authorization"]);
	assert.equal(first.Authorization, `Bearer ${accessFor(ACCOUNT, "headers")}`);
	assert.deepEqual(Object.keys(first).filter((name) => name.toLowerCase() === "chatgpt-account-id"), ["ChatGPT-Account-ID"]);
	assert.equal(first["ChatGPT-Account-ID"], ACCOUNT);
	assert.equal(first["X-Custom"], "keep");
	assert.equal(Object.keys(first).some((name) => name.toLowerCase() === "x-codex-turn-state"), false, "a configured turn token is not sent without sticky state");
	assert.equal(Object.values(first).some((value) => value.includes(", ")), false);
	await collect(transport.stream(MODEL, userTurn("two", USER_1), { headers: configured } as any));
	assert.equal(sse.calls[1].headers.Authorization, `Bearer ${accessFor(ACCOUNT, "headers")}`);
	assert.equal(sse.calls[1].headers["ChatGPT-Account-ID"], ACCOUNT);
});

test("WebSocket upgrade headers: configured alternate-cased authorization is replaced by one canonical bearer and account", async () => {
	const ws = queueSockets([textEvents("resp_wh", "one")]);
	const { transport } = transportWith(ws.connect, await seededStore(accessFor(ACCOUNT, "ws")));
	await collect(transport.stream(MODEL, USER_1, { headers: { authorization: "Bearer stale", "CHATGPT-ACCOUNT-ID": "old" } } as any));
	const head = ws.heads[0];
	assert.deepEqual(Object.keys(head).filter((name) => name.toLowerCase() === "authorization"), ["Authorization"]);
	assert.equal(head.Authorization, `Bearer ${accessFor(ACCOUNT, "ws")}`);
	assert.deepEqual(Object.keys(head).filter((name) => name.toLowerCase() === "chatgpt-account-id"), ["ChatGPT-Account-ID"]);
	assert.equal(head["ChatGPT-Account-ID"], ACCOUNT);
});

// ---- prepared owner: refusal before any adoption or send; same-account rotation still allowed ---------------------------

test("preparedOwner mismatch on stream: one local error terminal, zero connects, zero sends, the cached socket is not touched", async () => {
	const ws = queueSockets([textEvents("resp_po1", "one")]);
	const store = await seededStore();
	const { transport } = transportWith(ws.connect, store);
	await collect(transport.stream(MODEL, USER_1));
	assert.equal(ws.sockets.length, 1);
	await store.modify("openai-codex", async () => grant(accessFor(OTHER_ACCOUNT, "other"), OTHER_ACCOUNT));
	const events = await collect(transport.stream(MODEL, userTurn("two", USER_1), { preparedOwner: ACCOUNT } as any));
	assert.equal(events.at(-1)?.type, "error");
	assert.match(JSON.stringify(events.at(-1)), /changed while the request was prepared/);
	assert.equal(JSON.stringify(events).includes("other"), false);
	assert.equal(ws.sent.length, 1);
	assert.equal(ws.sockets.length, 1);
	assert.equal(ws.sockets[0].open, true, "the owner-A socket is not closed by a refused request for owner B");
});

test("preparedOwner mismatch on sendRaw: refused before any connect or send", async () => {
	const ws = queueSockets([textEvents("resp_never", "never")]);
	const store = await seededStore();
	await store.modify("openai-codex", async () => grant(accessFor(OTHER_ACCOUNT, "other"), OTHER_ACCOUNT));
	const { transport } = transportWith(ws.connect, store);
	await assert.rejects(collect(transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "compaction", options: { preparedOwner: ACCOUNT } as any }) as any), /changed while the request was prepared/);
	assert.equal(ws.heads.length, 0);
	assert.equal(ws.sent.length, 0);
});

test("preparedOwner mismatch on prewarm: refused before any connect or send; the prewarm is silent", async () => {
	const ws = queueSockets([[{ type: "response.created", response: { id: "resp_never_pw" } }, completedEvent("resp_never_pw")]]);
	const store = await seededStore(accessFor(OTHER_ACCOUNT, "other"));
	await store.modify("openai-codex", async () => grant(accessFor(OTHER_ACCOUNT, "other"), OTHER_ACCOUNT));
	const { transport } = transportWith(ws.connect, store);
	await transport.prewarm(MODEL, USER_1, { preparedOwner: ACCOUNT } as any);
	assert.equal(ws.heads.length, 0);
	assert.equal(ws.sent.length, 0);
});

test("matching preparedOwner: the request proceeds normally", async () => {
	const ws = queueSockets([textEvents("resp_match", "match")]);
	const { transport } = transportWith(ws.connect, await seededStore());
	const events = await collect(transport.stream(MODEL, USER_1, { preparedOwner: ACCOUNT } as any));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(ws.sent.length, 1);
});

test("preparedOwner with same-account token rotation during onPayload: allowed, the fresh grant is sent", async () => {
	const ws = queueSockets([textEvents("resp_rot", "rot")]);
	const store = await seededStore(accessFor(ACCOUNT, "before"));
	const rotated = accessFor(ACCOUNT, "after");
	const { transport } = transportWith(ws.connect, store);
	const events = await collect(transport.stream(MODEL, USER_1, {
		preparedOwner: ACCOUNT,
		onPayload: async () => {
			await store.modify("openai-codex", async () => grant(rotated));
		},
	} as any));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(ws.heads[0].Authorization, `Bearer ${rotated}`);
});

test("preparedOwner A with a switch to account B during onPayload: one local error, zero connects, zero sends", async () => {
	const ws = queueSockets([textEvents("resp_switch", "never")]);
	const store = await seededStore();
	const { transport } = transportWith(ws.connect, store);
	const events = await collect(transport.stream(MODEL, USER_1, {
		preparedOwner: ACCOUNT,
		onPayload: async () => {
			await store.modify("openai-codex", async () => grant(accessFor(OTHER_ACCOUNT, "switched"), OTHER_ACCOUNT));
		},
	} as any));
	assert.equal(events.at(-1)?.type, "error");
	assert.equal(ws.heads.length, 0);
	assert.equal(ws.sent.length, 0);
});

test("preparedOwner mismatch on the SSE path: refused before any HTTP request", async () => {
	const sse = sseScript([{ events: textEvents("resp_sse_never", "never") }]);
	const store = await seededStore();
	await store.modify("openai-codex", async () => grant(accessFor(OTHER_ACCOUNT, "other"), OTHER_ACCOUNT));
	const { transport } = transportWith(upgradeRequired, store, { postEvents: sse.fn });
	const events = await collect(transport.stream(MODEL, USER_1, { preparedOwner: ACCOUNT } as any));
	assert.equal(events.at(-1)?.type, "error");
	assert.equal(sse.calls.length, 0);
});

// ---- owner await gap: the saved owner is re-read before every credential-bearing frame and every SSE attempt -----------

const switchToB = (store: InMemoryCredentialStore) => store.modify("openai-codex", async () => grant(accessFor(OTHER_ACCOUNT, "switched"), OTHER_ACCOUNT));

/** A connector that performs the given owner change while the connect is held, after the socket is already open. */
function connectDuring(ws: ReturnType<typeof queueSockets>, during: () => Promise<unknown>) {
	return async (options: any) => {
		const socket = await ws.connect(options);
		await during();
		return socket;
	};
}

test("owner gap: A->B during a held connect, normal stream sends no frame, retires the opened A socket, no retry", async () => {
	const ws = queueSockets([textEvents("resp_gap_stream", "A")]);
	const store = await seededStore();
	const { transport } = transportWith(connectDuring(ws, () => switchToB(store)), store);
	const events = await collect(transport.stream(MODEL, USER_1));
	assert.equal(events.at(-1)?.type, "error");
	assert.match(JSON.stringify(events.at(-1)), /changed while the request was prepared/);
	assert.equal(ws.heads.length, 1, "no reconnect");
	assert.equal(ws.sent.length, 0, "no response.create frame");
	assert.equal(ws.sockets[0].open, false);
	assert.equal(ws.sockets[0].closes, 1);
});

test("owner gap: A->B during a held connect, sendRaw compaction sends no frame and retires the socket", async () => {
	const ws = queueSockets([textEvents("resp_gap_compact", "A")]);
	const store = await seededStore();
	const { transport } = transportWith(connectDuring(ws, () => switchToB(store)), store);
	await assert.rejects(collect(transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "compaction" }) as any), /changed while the request was prepared/);
	assert.equal(ws.heads.length, 1);
	assert.equal(ws.sent.length, 0);
	assert.equal(ws.sockets[0].open, false);
});

test("owner gap: A->B during a held connect, history prewarm sends no frame and retires the socket", async () => {
	const ws = queueSockets([[{ type: "response.created", response: { id: "resp_gap_pw" } }, completedEvent("resp_gap_pw")]]);
	const store = await seededStore();
	const { transport } = transportWith(connectDuring(ws, () => switchToB(store)), store);
	await transport.prewarm(MODEL, USER_1);
	assert.equal(ws.heads.length, 1);
	assert.equal(ws.sent.length, 0, "no response.create frame");
	assert.equal(ws.sockets[0].open, false);
});

test("owner gap: logout during a held connect refuses the normal stream before any frame", async () => {
	const ws = queueSockets([textEvents("resp_gap_logout", "A")]);
	const store = await seededStore();
	const { transport } = transportWith(connectDuring(ws, () => store.delete("openai-codex")), store);
	const events = await collect(transport.stream(MODEL, USER_1));
	assert.equal(events.at(-1)?.type, "error");
	assert.match(JSON.stringify(events.at(-1)), /changed while the request was prepared/);
	assert.equal(ws.sent.length, 0);
	assert.equal(ws.sockets[0].open, false);
});

test("owner gap: async onResponse hook switches A->B: normal stream sends no frame and retires the socket", async () => {
	const ws = queueSockets([textEvents("resp_gap_hook", "A")]);
	const store = await seededStore();
	const { transport } = transportWith(ws.connect, store);
	const events = await collect(transport.stream(MODEL, USER_1, { onResponse: async () => { await switchToB(store); } } as any));
	assert.equal(events.at(-1)?.type, "error");
	assert.match(JSON.stringify(events.at(-1)), /changed while the request was prepared/);
	assert.equal(ws.heads.length, 1);
	assert.equal(ws.sent.length, 0);
	assert.equal(ws.sockets[0].open, false);
});

test("owner gap: async onResponse hook switches A->B: sendRaw compaction sends no frame and retires the socket", async () => {
	const ws = queueSockets([textEvents("resp_gap_hook_raw", "A")]);
	const store = await seededStore();
	const { transport } = transportWith(ws.connect, store);
	await assert.rejects(collect(transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "compaction", options: { onResponse: async () => { await switchToB(store); } } as any }) as any), /changed while the request was prepared/);
	assert.equal(ws.sent.length, 0);
	assert.equal(ws.sockets[0].open, false);
});

test("owner gap: same-account rotation during a held connect still sends the frame on the same socket", async () => {
	const ws = queueSockets([textEvents("resp_gap_rot", "rot")]);
	const store = await seededStore(accessFor(ACCOUNT, "before"));
	const rotated = accessFor(ACCOUNT, "rotated");
	const { transport } = transportWith(connectDuring(ws, () => store.modify("openai-codex", async () => grant(rotated))), store);
	const events = await collect(transport.stream(MODEL, USER_1));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(ws.sent.length, 1);
	assert.equal(ws.sockets.length, 1);
	assert.equal(ws.sockets[0].closes, 0);
});

test("owner gap: SSE retry delay switches to B: no further HTTP request, prepared hook count preserved", async () => {
	const store = await seededStore();
	const sse = sseScript([{ events: textEvents("resp_sse_gap1", "one") }]);
	let failing = false;
	const attempts: unknown[] = [];
	const postEvents = (options: any) => {
		attempts.push(options);
		if (failing) throw new SseError(500, {}, "server error", "status");
		return sse.fn(options);
	};
	const { transport } = transportWith(upgradeRequired, store, { postEvents, sleep: async () => { await switchToB(store); } });
	await collect(transport.stream(MODEL, USER_1));
	failing = true;
	let hooks = 0;
	const events = await collect(transport.stream(MODEL, userTurn("two", USER_1), { onPayload: (payload: unknown) => { hooks++; return payload; } } as any));
	assert.equal(events.at(-1)?.type, "error");
	assert.match(JSON.stringify(events.at(-1)), /changed while the request was prepared/);
	assert.equal(attempts.length, 2, "turn 1 and one failed turn 2 attempt; the retry never goes out");
	assert.equal(hooks, 1, "onPayload ran once");
});

test("owner gap: sendRaw SSE retry delay switches to B: no further HTTP request, onPayload once", async () => {
	const store = await seededStore();
	const attempts: unknown[] = [];
	const postEvents = (options: any) => {
		attempts.push(options);
		throw new SseError(500, {}, "server error", "status");
	};
	const { transport } = transportWith(upgradeRequired, store, { postEvents, sleep: async () => { await switchToB(store); } });
	let hooks = 0;
	await assert.rejects(collect(transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "compaction", transport: "sse", options: { onPayload: () => { hooks++; } } as any }) as any), /changed while the request was prepared/);
	assert.equal(attempts.length, 1);
	assert.equal(hooks, 1);
});

// ---- codex.response.metadata is not a sticky turn-state producer (only response.metadata is) -----------------------------

test("codex.response.metadata with a bogus token first does not seed the turn state; the next valid response.metadata does", async () => {
	const ws = queueSockets([
		[{ type: "codex.response.metadata", headers: { "x-codex-turn-state": "tok-bogus" } }, metadata({ "x-codex-turn-state": "tok-real" }), ...textEvents("resp_cm1", "one")],
		textEvents("resp_cm2", "two"),
	]);
	const { transport } = transportWith(ws.connect, await seededStore());
	const first = await collect(transport.stream(MODEL, USER_1));
	assert.equal(first.at(-1)?.type, "done");
	const second = await collect(transport.stream(MODEL, userTurn("two", USER_1)));
	assert.equal(second.at(-1)?.type, "done");
	assert.equal(ws.sent[1].client_metadata["x-codex-turn-state"], "tok-real");
	assert.doesNotMatch(JSON.stringify(ws.sent), /tok-bogus/);
});

