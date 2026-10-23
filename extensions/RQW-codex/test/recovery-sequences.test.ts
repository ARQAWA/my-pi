// Recovery sequences through the owned facade (CodexThreadTransport) with fake WebSocket connect, fake SSE POST,
// injected sleep and a mutable injected clock. No network, no real credentials, no real waiting: every delay is recorded.
// Scenario 2 (partial handoff through the real Pi AgentSession and the native budget) lives in partial-session.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as zlib from "node:zlib";
import { InMemoryCredentialStore, type Api, type Context, type Model } from "@earendil-works/pi-ai";

import { SocketError } from "../websocket.ts";
import { CodexThreadTransport } from "../transport.ts";

const ACCOUNT = "acct_recovery_1";
const IDENTITY = {
	installationId: "11111111-2222-4333-8444-555555555555",
	windowId: "11111111-2222-4333-8444-555555555555:0",
	rootSessionId: "root-recovery-1",
	threadId: "thread-recovery-1",
};
const MINUTE_MS = 60_000;

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeAccess(): string {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return `${b64url({ alg: "none" })}.${b64url({ exp, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;
}

async function seededStore(): Promise<InMemoryCredentialStore> {
	const store = new InMemoryCredentialStore();
	const exp = Math.floor(Date.now() / 1000) + 3600;
	await store.modify("openai-codex", async () => ({ type: "oauth", access: fakeAccess(), refresh: "refresh-recovery-1", expires: exp * 1000, accountId: ACCOUNT }) as never);
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

async function collect(stream: AsyncIterable<{ type: string; [k: string]: unknown }>): Promise<{ type: string; [k: string]: unknown }[]> {
	const out: { type: string; [k: string]: unknown }[] = [];
	for await (const event of stream) out.push(event);
	return out;
}

/** Mutable injected clock: tests advance it instead of waiting. */
function fakeClock(start = 1_000_000) {
	let t = start;
	return {
		clock: { now: () => t },
		advance(ms: number) {
			t += ms;
		},
	};
}

/** One fake WebSocket: each send consumes the next scripted batch of raw events; close from the server is simulated by serverClose(). */
function fakeSocket(scripts: unknown[][][]) {
	const sent: Record<string, any>[] = [];
	let open = true;
	let current: unknown[] = [];
	const socket = {
		get isOpen() {
			return open;
		},
		socketIdentity: `socket-${Math.random().toString(36).slice(2, 8)}`,
		events() {
			const batch = current;
			return (async function* () {
				for (const value of batch) yield { text: JSON.stringify(value), value: value as Record<string, unknown> };
			})();
		},
		async send(object: Record<string, any>) {
			sent.push(object);
			current = (scripts.shift() ?? [])[0] ?? [];
		},
		async interrupt() {
			throw new Error("unexpected interrupt");
		},
		async close() {
			open = false;
		},
	};
	return { socket: socket as any, sent, serverClose: () => (open = false) };
}

/** connect plan: an Error is thrown by that connect call; a fake socket is handed out. Any further connect is a failure. */
function connectPlan(plan: Array<Error | ReturnType<typeof fakeSocket>>) {
	const connects: number[] = [];
	const connect = async () => {
		connects.push(connects.length);
		const next = plan.shift();
		if (next === undefined) throw new Error("unscripted connect");
		if (next instanceof Error) throw next;
		return next.socket;
	};
	return { connect: connect as any, connects };
}

const transportError = () => new SocketError(undefined, {}, "websocket transport error", "transport");

function sseNeverCalled() {
	const calls: unknown[] = [];
	return { fn: ((options: unknown) => {
		calls.push(options);
		throw new Error("SSE must not be used in this scenario");
	}) as any, calls };
}

test("connect-only ConnectionFailed: unbounded 5s..60s schedule past Pi's default limit, then connects; no SSE fallback", async () => {
	const failures = 7;
	const plan: Array<Error> = Array.from({ length: failures }, () => transportError());
	const socket = fakeSocket([[textEvents("resp_conn_ok", "connected")]]);
	const connections = connectPlan([...plan, socket]);
	const sleeps: number[] = [];
	const sse = sseNeverCalled();
	const time = fakeClock();
	const transport = new CodexThreadTransport({
		identity: IDENTITY,
		store: await seededStore(),
		dependencies: {
			clock: time.clock,
			random: () => 0.5,
			sleep: async (ms: number) => {
				sleeps.push(ms);
			},
			connect: connections.connect,
			postEvents: sse.fn,
		},
	});
	const events = await collect(transport.stream(MODEL, USER_1));
	assert.equal(events.at(-1)?.type, "done");
	assert.deepEqual(sleeps, [5000, 10000, 20000, 40000, 60000, 60000, 60000], "delays 5s doubling to the 60s cap, beyond Pi's default limit");
	assert.equal(connections.connects.length, failures + 1, "one connect per failure plus the successful one");
	assert.equal(transport.transport, "websocket", "connection failures never switch to SSE");
	assert.equal(sse.calls.length, 0, "no SSE request");
});

test("caller abort during a connection-retry wait stops at once: no further connect or query", async () => {
	const controller = new AbortController();
	const connections = connectPlan(Array.from({ length: 10 }, () => transportError()));
	const sleeps: number[] = [];
	const sse = sseNeverCalled();
	const time = fakeClock();
	const transport = new CodexThreadTransport({
		identity: IDENTITY,
		store: await seededStore(),
		dependencies: {
			clock: time.clock,
			random: () => 0.5,
			// The first two waits pass at once; the third never ends on its own, so only the caller's abort can finish it.
			sleep: (ms: number) => {
				sleeps.push(ms);
				if (sleeps.length < 3) return Promise.resolve();
				setTimeout(() => controller.abort(), 0);
				return new Promise<void>(() => undefined);
			},
			connect: connections.connect,
			postEvents: sse.fn,
		},
	});
	const events = await collect(transport.stream(MODEL, USER_1, { signal: controller.signal } as any));
	const terminals = events.filter((e) => e.type === "done" || e.type === "error");
	assert.equal(terminals.length, 1);
	assert.equal((terminals[0] as any).reason, "aborted");
	assert.deepEqual(sleeps, [5000, 10000, 20000]);
	assert.equal(connections.connects.length, 3, "three failed connects; the abort lands during the third wait");
	const attemptsAtAbort = connections.connects.length;
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(connections.connects.length, attemptsAtAbort, "no connect after the abort");
	assert.equal(sse.calls.length, 0);
});

test("startup prewarm failed; a healthy completed WebSocket generation marks its socket prepared, so the next prewarm is skipped", async () => {
	const socket = fakeSocket([[textEvents("resp_t1", "first")]]);
	const connections = connectPlan([transportError(), socket]);
	const time = fakeClock();
	const transport = new CodexThreadTransport({
		identity: IDENTITY,
		store: await seededStore(),
		dependencies: { clock: time.clock, random: () => 0.5, sleep: async () => undefined, connect: connections.connect },
	});
	await transport.prewarm(MODEL, USER_1);
	assert.equal(socket.sent.length, 0, "the startup prewarm never reached a socket");

	const events = await collect(transport.stream(MODEL, USER_1));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(socket.sent.length, 1);

	await transport.prewarm(MODEL, USER_1);
	assert.equal(socket.sent.length, 1, "the healthy socket with an accepted WebSocket response is not prewarmed again");
	assert.equal(connections.connects.length, 2);
});

test("idle sequence: a 55 min socket age does not evict; closed idle socket gets ONE overlapping-coalesced history prewarm; first post-idle request is a stable suffix", async () => {
	const first = fakeSocket([[textEvents("resp_t1", "first")], [textEvents("resp_t2", "second")]]);
	const idle = fakeSocket([[[{ type: "response.created", response: { id: "resp_idle_pw" } }, completedEvent("resp_idle_pw")]], [textEvents("resp_idle_t3", "after idle")]]);
	const connections = connectPlan([first, idle]);
	const time = fakeClock();
	const transport = new CodexThreadTransport({
		identity: IDENTITY,
		store: await seededStore(),
		dependencies: { clock: time.clock, random: () => 0.5, sleep: async () => undefined, connect: connections.connect },
	});

	const turn1 = await collect(transport.stream(MODEL, USER_1));
	assert.equal(turn1.at(-1)?.type, "done");

	// Advance the injected clock past 55 minutes with the server keeping the socket open: no age eviction, no reconnect.
	time.advance(56 * MINUTE_MS);
	const turn2Context = userTurn("again", USER_1);
	const turn2 = await collect(transport.stream(MODEL, turn2Context));
	assert.equal(turn2.at(-1)?.type, "done");
	assert.equal(connections.connects.length, 1, "no age eviction or reconnect while the server keeps the socket");
	assert.equal(first.sent.length, 2);

	// The server closes the idle socket. Two overlapping idle prewarms share one attempt.
	first.serverClose();
	const pre1 = transport.prewarm(MODEL, turn2Context);
	const pre2 = transport.prewarm(MODEL, turn2Context);
	assert.equal(pre1, pre2, "overlapping idle prewarm calls coalesce into one promise");
	await pre1;
	assert.equal(connections.connects.length, 2, "one reconnect for the idle prewarm");
	assert.equal(idle.sent.length, 1, "exactly one generate:false prewarm request");
	assert.equal(idle.sent[0].generate, false);

	// The first post-idle user request continues from the prewarm response and carries only the new suffix.
	const afterIdle = userTurn("after idle", turn2Context);
	const turn3 = await collect(transport.stream(MODEL, afterIdle));
	assert.equal(turn3.at(-1)?.type, "done");
	assert.equal(connections.connects.length, 2, "the prewarmed socket serves the first post-idle request");
	assert.equal(idle.sent.length, 2);
	assert.equal(idle.sent[1].previous_response_id, "resp_idle_pw");
	assert.equal(idle.sent[1].input.length, 1, "suffix after the prewarm prefix is the new user message only");
	assert.equal(idle.sent[1].generate, undefined, "the real request is not a prewarm");
});
