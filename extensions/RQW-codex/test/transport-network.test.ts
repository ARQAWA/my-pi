// Real loopback regression for the owned WebSocket reuse path: the actual `ws` WebSocketServer on 127.0.0.1, the actual
// owned connect() from websocket.ts and the actual CodexThreadTransport. The only seam is the injected connect wrapper,
// which maps the official Codex URL to the local server (tests only). OAuth is a fake grant in an in-memory store.
// No external network, no real credentials; the authorization value is never printed or saved.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryCredentialStore, type Api, type Context, type Model } from "@earendil-works/pi-ai";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";

import { CODEX_ENDPOINT } from "../profile.ts";
import { CodexThreadTransport } from "../transport.ts";
import { connect, WS_BETA_HEADER } from "../websocket.ts";

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

function fakeAccess(): string {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return `${b64url({ alg: "none" })}.${b64url({ exp, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;
}

async function seededStore(access: string): Promise<InMemoryCredentialStore> {
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

const userMessage = (text: string, timestamp: number) => ({ role: "user", content: text, timestamp });

const assistantMessage = (text: string, responseId: string) =>
	({
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-codex-responses",
		provider: "openai-codex",
		model: "gpt-6-luna",
		responseId,
		usage: {},
		stopReason: "stop",
		timestamp: 3,
	}) as any;

type Frame = { type: string; [k: string]: unknown };

// A deterministic native-shaped responder: the Nth response.create gets created, optional output, completed.
// generate:false (prewarm) produces no output. A "hang" request stops after response.created (caller abort case).
type Loopback = {
	readonly url: string;
	readonly handshakes: { authorization: string | undefined; beta: string | undefined; account: string | undefined; deflate: boolean }[];
	readonly requests: Record<string, unknown>[];
	readonly interrupts: Frame[];
	hangNext: boolean;
	texts: string[];
	close(): Promise<void>;
};

async function startLoopback(): Promise<Loopback> {
	const wss = new WebSocketServer({ host: "127.0.0.1", port: 0, path: "/backend-api/codex/responses", perMessageDeflate: true });
	await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
	const port = (wss.address() as AddressInfo).port;
	const handshakes: Loopback["handshakes"] = [];
	const requests: Record<string, unknown>[] = [];
	const interrupts: Frame[] = [];
	const clients = new Set<ServerSocket>();
	const texts: string[] = [];
	const loop: Loopback = {
		url: `ws://127.0.0.1:${port}/backend-api/codex/responses`,
		handshakes,
		requests,
		interrupts,
		hangNext: false,
		texts,
		close: () =>
			new Promise<void>((resolve) => {
				for (const client of clients) client.terminate();
				wss.close(() => resolve());
			}),
	};
	wss.on("connection", (ws, request) => {
		clients.add(ws);
		ws.on("close", () => clients.delete(ws));
		const header = (name: string) => {
			const value = request.headers[name];
			return Array.isArray(value) ? value[0] : value;
		};
		handshakes.push({
			authorization: header("authorization"),
			beta: header("openai-beta"),
			account: header("chatgpt-account-id"),
			deflate: String(ws.extensions).includes("permessage-deflate"),
		});
		ws.on("message", (data) => {
			const value = JSON.parse(data.toString("utf8")) as Frame;
			if (value.type === "response.interrupt") {
				interrupts.push(value);
				return;
			}
			if (value.type !== "response.create") return;
			requests.push(value as Record<string, unknown>);
			const id = `resp_${requests.length}`;
			const send = (frame: Frame) => ws.send(JSON.stringify(frame));
			send({ type: "response.created", response: { id } });
			if (loop.hangNext) {
				loop.hangNext = false;
				return;
			}
			if (value.generate === false) {
				send({ type: "response.completed", response: completed(id) });
				return;
			}
			const text = loop.texts.shift() ?? `text-${requests.length}`;
			const item = `msg_${id}`;
			send({
				type: "response.output_item.done",
				output_index: 0,
				item: { type: "message", id: item, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] },
			});
			send({ type: "response.completed", response: completed(id) });
		});
	});
	return loop;
}

function completed(id: string) {
	return { id, status: "completed", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
}

describe("owned WebSocket reuse over a real loopback server", () => {
	it("prewarm, then turns on the same connection (incremental), then caller abort retires the socket", { timeout: 15000 }, async () => {
		const loop = await startLoopback();
		const access = fakeAccess();
		const dialed: string[] = [];
		// Test-only seam: the official URL is mapped to the loopback server. Everything else is the owned connect().
		const dial = (options: Parameters<typeof connect>[0]) => {
			dialed.push(options.url);
			return connect({ ...options, url: loop.url });
		};
		let sseCalls = 0;
		const transport = new CodexThreadTransport({
			identity: IDENTITY,
			store: await seededStore(access),
			dependencies: {
				clock: { now: () => 1_000_000 },
				random: () => 0.5,
				sleep: async () => undefined,
				connect: dial as any,
				postEvents: (() => {
					sseCalls++;
					throw new Error("SSE fallback must not run");
				}) as any,
			},
		});
		try {
			// 1. Startup prewarm: generate:false on the owned socket, no output.
			await transport.prewarm(MODEL, USER_1);
			assert.equal(loop.requests.length, 1);
			assert.equal(loop.requests[0].generate, false);
			assert.equal(loop.handshakes.length, 1);
			assert.equal(dialed[0], CODEX_ENDPOINT);

			// 2. First real turn reuses the SAME connection and chains on the prewarm response.
			const turn1 = await collectTypes(transport.stream(MODEL, { ...USER_1, messages: [...USER_1.messages, userMessage("next", 2)] } as Context));
			assert.equal(turn1.at(-1), "done");
			assert.equal(loop.handshakes.length, 1, "first turn must not reconnect");
			assert.equal(loop.requests[1].previous_response_id, "resp_1");
			assert.equal((loop.requests[1].input as unknown[]).length, 2, "suffix after the cold prewarm prefix: hello and next");

			// 3. Second user turn: same connection, previous_response_id from the first turn, only the new user delta.
			const turn2Context: Context = {
				...USER_1,
				messages: [...USER_1.messages, userMessage("next", 2), assistantMessage("text-2", "resp_2"), userMessage("second", 4)],
			} as Context;
			const turn2 = await collectTypes(transport.stream(MODEL, turn2Context));
			assert.equal(turn2.at(-1), "done");
			assert.equal(loop.handshakes.length, 1, "second turn must not reconnect");
			assert.equal(loop.requests[2].previous_response_id, "resp_2");
			const delta = loop.requests[2].input as { role?: string }[];
			assert.equal(delta.length, 1);
			assert.equal(delta[0].role, "user");

			// 4. Caller abort mid-response: the socket is retired (closed, not reused); no response.interrupt is sent.
			loop.hangNext = true;
			const controller = new AbortController();
			const aborted = await collectTypes(
				transport.stream(MODEL, { ...turn2Context, messages: [...turn2Context.messages, assistantMessage("text-3", "resp_3"), userMessage("third", 5)] } as Context, {
					signal: controller.signal,
					onProviderStreamEvent: (event: { type?: string }) => {
						if (event.type === "response.created") controller.abort();
					},
				} as any),
			);
			assert.notEqual(aborted.at(-1), "done");
			assert.equal(loop.interrupts.length, 0);

			// 5. The next turn opens a new owned connection (the aborted one was not reused).
			const turn4 = await collectTypes(transport.stream(MODEL, { ...turn2Context, messages: [...turn2Context.messages, userMessage("fourth", 6)] } as Context));
			assert.equal(turn4.at(-1), "done");
			assert.equal(loop.handshakes.length, 2);

			// Handshake: official URL mapped only in the test seam; auth present (never printed); beta and deflate native.
			for (const handshake of loop.handshakes) {
				assert.equal(handshake.authorization, `Bearer ${access}`);
				assert.equal(handshake.beta, WS_BETA_HEADER);
				assert.equal(handshake.account, ACCOUNT);
				assert.equal(handshake.deflate, true);
			}
			assert.equal(sseCalls, 0, "no SSE fallback, reconnect or drop on the healthy path");
		} finally {
			transport.dispose();
			await loop.close();
		}
	});
});

async function collectTypes(stream: AsyncIterable<{ type: string }>): Promise<string[]> {
	const types: string[] = [];
	for await (const event of stream) types.push(event.type);
	return types;
}

async function collectEvents(stream: AsyncIterable<any>): Promise<any[]> {
	const events: any[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

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

// Held upgrade: the real ws client reaches a loopback HTTP server that reads each upgrade and never answers it.
async function startHeldUpgrade() {
	const server = createServer();
	const held: Duplex[] = [];
	let upgrades = 0;
	const waiters: (() => void)[] = [];
	server.on("upgrade", (_request, socket: Duplex) => {
		socket.on("error", () => undefined);
		held.push(socket);
		upgrades++;
		for (const wake of waiters.splice(0)) wake();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
	const port = (server.address() as AddressInfo).port;
	return {
		url: `ws://127.0.0.1:${port}/backend-api/codex/responses`,
		upgrades: () => upgrades,
		seen: () =>
			new Promise<void>((resolve) => {
				if (upgrades > 0) resolve();
				else waiters.push(resolve);
			}),
		close: () =>
			new Promise<void>((resolve) => {
				for (const socket of held) socket.destroy();
				server.close(() => resolve());
			}),
	};
}

describe("caller abort and disposal on a real held WebSocket upgrade", () => {
	it("stream: abort after the server sees the upgrade settles within 1 s, with no frames, no SSE and no reconnect", { timeout: 15000 }, async () => {
		const held = await startHeldUpgrade();
		let sseCalls = 0;
		const transport = new CodexThreadTransport({
			identity: IDENTITY,
			store: await seededStore(fakeAccess()),
			dependencies: {
				clock: { now: () => 1_000_000 },
				random: () => 0.5,
				sleep: async () => undefined,
				connect: ((options: Parameters<typeof connect>[0]) => connect({ ...options, url: held.url })) as any,
				postEvents: (() => {
					sseCalls++;
					throw new Error("SSE fallback must not run");
				}) as any,
			},
		});
		try {
			const controller = new AbortController();
			const pending = collectEvents(transport.stream(MODEL, USER_1, { signal: controller.signal } as any));
			await held.seen();
			const abortedAt = Date.now();
			controller.abort();
			const events = await pending;
			const elapsed = Date.now() - abortedAt;
			assert.ok(elapsed <= 1000, `abort settled in ${elapsed} ms`);
			assert.equal(events.some((event) => String(event.type).startsWith("text")), false, "no text frame");
			const terminal = events.at(-1);
			assert.ok(terminal.type === "done" || terminal.type === "error");
			assert.equal(terminal.reason, "aborted");
			assert.equal(held.upgrades(), 1, "no reconnect after the abort");
			assert.equal(sseCalls, 0);
		} finally {
			transport.dispose();
			await held.close();
		}
	});

	it("sendRaw WebSocket: abort after the server sees the upgrade settles within 1 s, with no event, no SSE and no retry", { timeout: 15000 }, async () => {
		const held = await startHeldUpgrade();
		let sseCalls = 0;
		const transport = new CodexThreadTransport({
			identity: IDENTITY,
			store: await seededStore(fakeAccess()),
			dependencies: {
				clock: { now: () => 1_000_000 },
				random: () => 0.5,
				sleep: async () => undefined,
				connect: ((options: Parameters<typeof connect>[0]) => connect({ ...options, url: held.url })) as any,
				postEvents: (() => {
					sseCalls++;
					throw new Error("SSE fallback must not run");
				}) as any,
			},
		});
		try {
			const controller = new AbortController();
			const received: unknown[] = [];
			const pending = (async () => {
				for await (const event of transport.sendRaw({ request: RAW_REQUEST, model: MODEL, requestKind: "compaction", transport: "websocket", signal: controller.signal })) received.push(event);
			})();
			await held.seen();
			const abortedAt = Date.now();
			controller.abort();
			await assert.rejects(pending, (error: Error) => error.name === "AbortError");
			const elapsed = Date.now() - abortedAt;
			assert.ok(elapsed <= 1000, `abort settled in ${elapsed} ms`);
			assert.equal(received.length, 0);
			assert.equal(held.upgrades(), 1, "one attempt, no retry");
			assert.equal(sseCalls, 0);
		} finally {
			transport.dispose();
			await held.close();
		}
	});

	it("disposal during a pending connect ends the stream within 1 s", { timeout: 15000 }, async () => {
		const held = await startHeldUpgrade();
		const transport = new CodexThreadTransport({
			identity: IDENTITY,
			store: await seededStore(fakeAccess()),
			dependencies: {
				clock: { now: () => 1_000_000 },
				random: () => 0.5,
				sleep: async () => undefined,
				connect: ((options: Parameters<typeof connect>[0]) => connect({ ...options, url: held.url })) as any,
			},
		});
		try {
			const pending = collectEvents(transport.stream(MODEL, USER_1));
			await held.seen();
			const disposedAt = Date.now();
			transport.dispose();
			const events = await pending;
			const elapsed = Date.now() - disposedAt;
			assert.ok(elapsed <= 1000, `dispose settled in ${elapsed} ms`);
			assert.equal(events.at(-1).reason, "aborted");
			assert.equal(held.upgrades(), 1);
		} finally {
			transport.dispose();
			await held.close();
		}
	});

	it("a late abort of a completed turn's caller signal neither closes the healthy socket nor reconnects the next turn", { timeout: 15000 }, async () => {
		const loop = await startLoopback();
		const transport = new CodexThreadTransport({
			identity: IDENTITY,
			store: await seededStore(fakeAccess()),
			dependencies: {
				clock: { now: () => 1_000_000 },
				random: () => 0.5,
				sleep: async () => undefined,
				connect: ((options: Parameters<typeof connect>[0]) => connect({ ...options, url: loop.url })) as any,
				postEvents: (() => {
					throw new Error("SSE fallback must not run");
				}) as any,
			},
		});
		try {
			const controller = new AbortController();
			const turn1 = await collectTypes(transport.stream(MODEL, USER_1, { signal: controller.signal } as any));
			assert.equal(turn1.at(-1), "done");
			controller.abort();
			await new Promise((resolve) => setTimeout(resolve, 50));
			const turn2 = await collectTypes(
				transport.stream(MODEL, { ...USER_1, messages: [...USER_1.messages, assistantMessage("text-1", "resp_1"), userMessage("next", 2)] } as Context),
			);
			assert.equal(turn2.at(-1), "done");
			assert.equal(loop.handshakes.length, 1, "the healthy connection is reused");
			assert.equal(loop.requests.length, 2);
		} finally {
			transport.dispose();
			await loop.close();
		}
	});
});
