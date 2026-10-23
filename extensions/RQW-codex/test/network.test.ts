// Stage 3 owned network connectors. Only loopback endpoints and injected fetch are used; no external network.
// Raw HTTP/WebSocket servers on 127.0.0.1 give deterministic handshakes, frames, ping, binary and idle cases.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, connect as netConnect } from "node:net";
import type { AddressInfo } from "node:net";
import type { Server, Socket } from "node:net";
import { after, afterEach, before, describe, it } from "node:test";
import { deflateRawSync, inflateRawSync, zstdDecompressSync, constants as zlibConstants } from "node:zlib";
import { compressRequest, REQUEST_ZSTD_LEVEL } from "../compression.ts";
import { CookieJar, OriginError, assertTransportOrigin } from "../cookies.ts";
import { postEvents, SSE_IDLE_TIMEOUT_MS, SseError } from "../sse.ts";
import { connect, SocketError, WS_BETA_HEADER, WS_CONNECT_TIMEOUT_MS, WS_IDLE_TIMEOUT_MS, WS_PERMESSAGE_DEFLATE_OFFER } from "../websocket.ts";
import type { ResponseHead, TlsConnector } from "../websocket.ts";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const TOKEN = "Bearer test-token-not-real";

// ---- deterministic raw server helpers -------------------------------------------------------------------------

type Conn = {
	readonly sock: Socket;
	readonly path: string;
	readonly headers: Record<string, string>;
	readonly rest: Buffer;
};

type Frame = { fin: boolean; rsv1: boolean; opcode: number; payload: Buffer };

// Parses frames from either side. Client frames are masked; server frames are not.
class FrameReader {
	private buf = Buffer.alloc(0);
	private readonly onFrame: (frame: Frame) => void;

	constructor(onFrame: (frame: Frame) => void) {
		this.onFrame = onFrame;
	}

	push(chunk: Buffer): void {
		this.buf = Buffer.concat([this.buf, chunk]);
		for (;;) {
			if (this.buf.length < 2) return;
			const b0 = this.buf[0];
			const b1 = this.buf[1];
			let length = b1 & 0x7f;
			let offset = 2;
			if (length === 126) {
				if (this.buf.length < 4) return;
				length = this.buf.readUInt16BE(2);
				offset = 4;
			} else if (length === 127) {
				if (this.buf.length < 10) return;
				length = Number(this.buf.readBigUInt64BE(2));
				offset = 10;
			}
			const masked = (b1 & 0x80) !== 0;
			let mask: Buffer | undefined;
			if (masked) {
				if (this.buf.length < offset + 4) return;
				mask = this.buf.subarray(offset, offset + 4);
				offset += 4;
			}
			if (this.buf.length < offset + length) return;
			const payload = Buffer.from(this.buf.subarray(offset, offset + length));
			if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
			this.buf = this.buf.subarray(offset + length);
			const rsv1 = (b0 & 0x40) !== 0;
			// Client messages are permessage-deflate compressed when negotiated: inflate them here, as a server would.
			const inflated = rsv1 ? inflateRawSync(payload, { finishFlush: zlibConstants.Z_SYNC_FLUSH }) : payload;
			this.onFrame({ fin: (b0 & 0x80) !== 0, rsv1, opcode: b0 & 0x0f, payload: inflated });
		}
	}
}

function serverFrame(opcode: number, payload: Buffer, rsv1 = false): Buffer {
	const b0 = 0x80 | (rsv1 ? 0x40 : 0) | opcode;
	if (payload.length < 126) return Buffer.concat([Buffer.from([b0, payload.length]), payload]);
	const header = Buffer.alloc(4);
	header[0] = b0;
	header[1] = 126;
	header.writeUInt16BE(payload.length, 2);
	return Buffer.concat([header, payload]);
}

function acceptFor(key: string): string {
	return createHash("sha1").update(key + GUID).digest("base64");
}

const sockets = new Set<Socket>();
const servers: Server[] = [];

function serve(handler: (conn: Conn) => void): Promise<number> {
	return new Promise<number>((resolve) => {
		const server = createServer((sock) => {
			sockets.add(sock);
			sock.on("close", () => sockets.delete(sock));
			sock.on("error", () => undefined);
			let buf = Buffer.alloc(0);
			const onData = (chunk: Buffer) => {
				buf = Buffer.concat([buf, chunk]);
				const end = buf.indexOf("\r\n\r\n");
				if (end < 0) return;
				sock.removeListener("data", onData);
				const lines = buf.subarray(0, end).toString("latin1").split("\r\n");
				const headers: Record<string, string> = {};
				for (const line of lines.slice(1)) {
					const at = line.indexOf(":");
					headers[line.slice(0, at).toLowerCase()] = line.slice(at + 1).trim();
				}
				handler({ sock, path: lines[0].split(" ")[1], headers, rest: buf.subarray(end + 4) });
			};
			sock.on("data", onData);
		});
		servers.push(server);
		server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
	});
}

// Completes the 101 upgrade and feeds every later client frame to onFrame.
function upgrade(conn: Conn, handle: (frame: Frame) => void, extension = true): void {
	conn.sock.write(
		`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
			`Sec-WebSocket-Accept: ${acceptFor(conn.headers["sec-websocket-key"])}\r\n` +
			(extension ? "Sec-WebSocket-Extensions: permessage-deflate\r\n" : "") +
			"\r\n",
	);
	// A client close frame is answered with a close frame, as a real server does.
	const onFrame = (frame: Frame) => {
		if (frame.opcode === 8) {
			conn.sock.write(serverFrame(8, Buffer.from([0x03, 0xe8])));
			return;
		}
		handle(frame);
	};
	const reader = new FrameReader(onFrame);
	reader.push(conn.rest);
	conn.sock.on("data", (chunk: Buffer) => reader.push(chunk));
}

function textFrame(value: unknown): Buffer {
	return serverFrame(1, Buffer.from(JSON.stringify(value)));
}

async function until<T>(read: () => T | undefined, ms = 2000): Promise<T> {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = read();
		if (value !== undefined) return value;
		if (Date.now() > deadline) throw new Error("timed out waiting for test condition");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

function wsUrl(port: number, path = "/backend-api/codex/responses"): string {
	return `ws://127.0.0.1:${port}${path}`;
}

function noopResponse(): (response: ResponseHead) => void {
	return () => undefined;
}

// ---- external-network guard ------------------------------------------------------------------------------------

const savedFetch = globalThis.fetch;
before(() => {
	globalThis.fetch = (() => {
		throw new Error("external networking disabled in tests: global fetch was called");
	}) as typeof fetch;
});

afterEach(() => {
	for (const sock of sockets) sock.destroy();
	sockets.clear();
});

after(async () => {
	globalThis.fetch = savedFetch;
	for (const server of servers) server.close();
});

// ---- compression ------------------------------------------------------------------------------------------------

describe("compression", () => {
	it("uses zstd level 3 and round-trips the exact JSON bytes", () => {
		assert.equal(REQUEST_ZSTD_LEVEL, 3);
		const json = Buffer.from(JSON.stringify({ model: "gpt-6.1-sol", input: "x".repeat(2000) }));
		const compressed = compressRequest(json);
		assert.ok(compressed.byteLength < json.byteLength);
		assert.deepEqual(Buffer.from(zstdDecompressSync(compressed)), json);
	});

	it("matches the pinned Node zstd level-3 golden bytes for a fixed input", () => {
		// Golden captured with node:zlib on this runtime (Node v26.7.0); a different zstd library version may differ.
		const compressed = compressRequest(Buffer.from("abc"));
		assert.equal(Buffer.from(compressed).toString("hex"), "28b52ffd2003190000616263");
	});
});

// ---- cookies and origin ------------------------------------------------------------------------------------------

describe("cookies and origin", () => {
	it("stores only allowlisted cookies, scoped by host, path and expiry", () => {
		let now = 1_000_000;
		const jar = new CookieJar(() => now);
		const url = new URL("https://chatgpt.com/backend-api/codex/responses");
		jar.ingest(url, [
			"__cf_bm=abc; Path=/; Secure; HttpOnly; Max-Age=60",
			"session=secret-session; Path=/",
			"_cfuvid=scoped; Path=/backend-api/codex",
			"cf_chl_rc_m=1; Domain=.chatgpt.com; Path=/",
			"__cflb=evil; Domain=example.com",
		]);
		const header = jar.header(new URL("wss://chatgpt.com/backend-api/codex/responses"));
		assert.ok(header);
		assert.ok(header.includes("__cf_bm=abc"));
		assert.ok(header.includes("_cfuvid=scoped"));
		assert.ok(header.includes("cf_chl_rc_m=1"));
		assert.ok(!header.includes("session"));
		assert.ok(!header.includes("evil"));
		assert.equal(jar.header(new URL("https://chatgpt.com/other/path")), "__cf_bm=abc; cf_chl_rc_m=1", "Path=/ cookies match every path; path-scoped ones do not");

		now += 61_000;
		assert.ok(!jar.header(url)?.includes("__cf_bm"), "Max-Age expires the cookie");
	});

	it("never stores or sends cookies for non-ChatGPT or loopback origins", () => {
		const jar = new CookieJar();
		jar.ingest(new URL("https://api.openai.com/v1"), ["__cf_bm=nope; Path=/"]);
		jar.ingest(new URL("ws://127.0.0.1:1/x"), ["__cf_bm=loopback; Path=/"]);
		assert.equal(jar.header(new URL("https://api.openai.com/v1")), undefined);
		assert.equal(jar.header(new URL("https://chatgpt.com/x")), undefined);
	});

	it("refuses non-ChatGPT origins before any socket or fetch", () => {
		assert.throws(() => assertTransportOrigin(new URL("https://example.com/x")), OriginError);
		assert.throws(() => assertTransportOrigin(new URL("wss://example.org/x")), OriginError);
		assert.doesNotThrow(() => assertTransportOrigin(new URL("wss://chatgpt.com/backend-api/codex/responses")));
	});

	it("connect refuses external origins without opening a socket", async () => {
		await assert.rejects(
			connect({ url: "wss://example.com/x", headers: {}, signal: new AbortController().signal, onResponse: noopResponse() }),
			OriginError,
		);
	});
});

// ---- websocket --------------------------------------------------------------------------------------------------

describe("websocket connector", () => {
	it("exposes the native timing defaults", () => {
		assert.equal(WS_CONNECT_TIMEOUT_MS, 15_000);
		assert.equal(WS_IDLE_TIMEOUT_MS, 300_000);
		assert.equal(SSE_IDLE_TIMEOUT_MS, 300_000);
		assert.equal(WS_BETA_HEADER, "responses_websockets=2026-02-06");
	});

	it("negotiates permessage-deflate, sends beta and headers, exchanges JSON text frames", async () => {
		const received: unknown[] = [];
		const handshakes: Conn[] = [];
		const port = await serve((conn) => {
			handshakes.push(conn);
			upgrade(conn, (frame) => {
				if (frame.opcode === 1) received.push(JSON.parse(frame.payload.toString("utf8")));
			});
			conn.sock.write(textFrame({ type: "response.created", response: { id: "resp_1" } }));
		});
		const heads: ResponseHead[] = [];
		const socket = await connect({
			url: wsUrl(port),
			headers: { authorization: TOKEN, "x-codex-test": "1" },
			signal: new AbortController().signal,
			onResponse: (head) => heads.push(head),
		});
		try {
			const events = socket.events()[Symbol.asyncIterator]();
			const first = await events.next();
			assert.equal(first.done, false);
			assert.equal(first.value.value.type, "response.created");
			assert.equal(first.value.text, JSON.stringify({ type: "response.created", response: { id: "resp_1" } }));
			assert.equal(heads[0].status, 101);
			assert.equal(socket.isOpen, true);
			assert.ok(socket.socketIdentity.length > 0);
			await socket.send({ type: "response.create", model: "m" });
			await until(() => (received.length === 1 ? true : undefined));
			assert.deepEqual(received[0], { type: "response.create", model: "m" });
			const request = handshakes[0].headers;
			// Native advertised offer (websocket.ts provenance): exact string, no context-takeover flags.
			assert.equal(request["sec-websocket-extensions"], WS_PERMESSAGE_DEFLATE_OFFER);
			assert.equal(WS_PERMESSAGE_DEFLATE_OFFER, "permessage-deflate; client_max_window_bits");
			assert.equal(request["openai-beta"], WS_BETA_HEADER);
			assert.equal(request.authorization, TOKEN);
			assert.equal(request["x-codex-test"], "1");
			assert.equal(request.cookie, undefined, "no cookie for loopback");
		} finally {
			await socket.close();
		}
		assert.equal(socket.isOpen, false);
	});

	it("keeps a caller-supplied OpenAI-Beta header", async () => {
		const seen: Conn[] = [];
		const port = await serve((conn) => {
			seen.push(conn);
			upgrade(conn, () => undefined);
		});
		const socket = await connect({
			url: wsUrl(port),
			headers: { "OpenAI-Beta": "responses_websockets=other" },
			signal: new AbortController().signal,
			onResponse: noopResponse(),
		});
		await socket.close();
		assert.equal(seen[0].headers["openai-beta"], "responses_websockets=other");
	});

	it("decodes a permessage-deflate compressed text frame", async () => {
		const port = await serve((conn) => {
			upgrade(conn, () => undefined);
			const json = Buffer.from(JSON.stringify({ type: "response.output_text.delta", delta: "d".repeat(4000) }));
			const raw = deflateRawSync(json, { finishFlush: zlibConstants.Z_SYNC_FLUSH });
			assert.deepEqual(raw.subarray(raw.length - 4), Buffer.from([0x00, 0x00, 0xff, 0xff]));
			conn.sock.write(serverFrame(1, raw.subarray(0, raw.length - 4), true));
		});
		const socket = await connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: noopResponse() });
		try {
			const next = await socket.events()[Symbol.asyncIterator]().next();
			assert.equal(next.value.value.type, "response.output_text.delta");
			assert.equal((next.value.value.delta as string).length, 4000);
		} finally {
			await socket.close();
		}
	});

	it("answers a server ping with a pong carrying the same payload", async () => {
		const pongs: Frame[] = [];
		const port = await serve((conn) => {
			upgrade(conn, (frame) => {
				if (frame.opcode === 10) pongs.push(frame);
			});
			conn.sock.write(serverFrame(9, Buffer.from("abcd")));
		});
		const socket = await connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: noopResponse() });
		try {
			const pong = await until(() => pongs[0]);
			assert.deepEqual(pong.payload, Buffer.from("abcd"));
			assert.equal(socket.isOpen, true);
		} finally {
			await socket.close();
		}
	});

	it("fails on a binary response frame with a typed error", async () => {
		const port = await serve((conn) => {
			upgrade(conn, () => undefined);
			conn.sock.write(serverFrame(2, Buffer.from([1, 2, 3])));
		});
		const socket = await connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: noopResponse() });
		const iterator = socket.events()[Symbol.asyncIterator]();
		await assert.rejects(iterator.next(), (error: unknown) => error instanceof SocketError && error.kind === "binary-frame");
		assert.equal(socket.isOpen, false);
	});

	it("preserves status and headers of a rejected upgrade without its body", async () => {
		const heads: ResponseHead[] = [];
		const port = await serve((conn) => {
			conn.sock.end(
				"HTTP/1.1 426 Upgrade Required\r\nx-test: keep\r\nset-cookie: __cf_bm=ignored; Path=/\r\n" +
					"Content-Length: 6\r\nConnection: close\r\n\r\nsecret",
			);
		});
		await assert.rejects(
			connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: (head) => heads.push(head) }),
			(error: unknown) => {
				assert.ok(error instanceof SocketError);
				assert.equal(error.kind, "upgrade-rejected");
				assert.equal(error.status, 426);
				assert.equal(error.headers["x-test"], "keep");
				assert.ok(!error.message.includes("secret"));
				return true;
			},
		);
		assert.equal(heads[0].status, 426);
	});

	it("rejects a redirect without following it", async () => {
		const port = await serve((conn) => {
			conn.sock.end("HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:9/other\r\nConnection: close\r\n\r\n");
		});
		await assert.rejects(
			connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: noopResponse() }),
			(error: unknown) => error instanceof SocketError && error.kind === "redirect-rejected" && error.status === 307 && error.headers.location === "http://127.0.0.1:9/other",
		);
	});

	it("times out a connect that never completes the handshake", async () => {
		const port = await serve(() => undefined);
		await assert.rejects(
			connect({
				url: wsUrl(port),
				headers: {},
				signal: new AbortController().signal,
				onResponse: noopResponse(),
				connectTimeoutMs: 50,
			}),
			(error: unknown) => error instanceof SocketError && error.kind === "connect-timeout",
		);
	});

	it("fails with idle-timeout when no response event follows a send", async () => {
		const port = await serve((conn) => upgrade(conn, () => undefined));
		const socket = await connect({
			url: wsUrl(port),
			headers: {},
			signal: new AbortController().signal,
			onResponse: noopResponse(),
			idleTimeoutMs: 80,
		});
		await socket.send({ type: "response.create" });
		const iterator = socket.events()[Symbol.asyncIterator]();
		await assert.rejects(iterator.next(), (error: unknown) => error instanceof SocketError && error.kind === "idle-timeout");
		assert.equal(socket.isOpen, false);
	});

	it("does not time out an idle socket that has no response in progress", async () => {
		const port = await serve((conn) => upgrade(conn, () => undefined));
		const socket = await connect({
			url: wsUrl(port),
			headers: {},
			signal: new AbortController().signal,
			onResponse: noopResponse(),
			idleTimeoutMs: 40,
		});
		await new Promise((resolve) => setTimeout(resolve, 120));
		assert.equal(socket.isOpen, true);
		await socket.close();
	});

	it("ends events with AbortError when the caller aborts an open socket", async () => {
		const port = await serve((conn) => upgrade(conn, () => undefined));
		const controller = new AbortController();
		const socket = await connect({ url: wsUrl(port), headers: {}, signal: controller.signal, onResponse: noopResponse() });
		const pending = socket.events()[Symbol.asyncIterator]().next();
		controller.abort();
		await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === "AbortError");
		assert.equal(socket.isOpen, false);
	});

	it("a consumer stopped at a yield releases events(); the open socket serves the next consumer", async () => {
		const port = await serve((conn) => {
			upgrade(conn, () => {
				conn.sock.write(textFrame({ type: "a" }));
				conn.sock.write(textFrame({ type: "b" }));
				conn.sock.write(textFrame({ type: "c" }));
			});
		});
		const socket = await connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: noopResponse() });
		try {
			await socket.send({ type: "go" });
			const first = socket.events()[Symbol.asyncIterator]();
			assert.equal((await first.next()).value.value.type, "a");
			await first.return(undefined);
			assert.equal(socket.isOpen, true);
			const second = socket.events()[Symbol.asyncIterator]();
			assert.equal((await second.next()).value.value.type, "b");
			assert.equal((await second.next()).value.value.type, "c");
			assert.equal(socket.isOpen, true);
		} finally {
			await socket.close();
		}
	});

	it("refuses a second active consumer and accepts events() again once the first one finishes", async () => {
		const port = await serve((conn) => {
			upgrade(conn, (frame) => {
				const value = JSON.parse(frame.payload.toString("utf8")) as { type: string };
				if (value.type !== "go") return;
				conn.sock.write(textFrame({ type: "x" }));
				conn.sock.write(textFrame({ type: "y" }));
			});
		});
		const socket = await connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: noopResponse() });
		try {
			await socket.send({ type: "go" });
			const first = socket.events()[Symbol.asyncIterator]();
			const pending = first.next();
			assert.throws(() => socket.events(), (error: unknown) => error instanceof SocketError && error.kind === "closed");
			assert.equal((await pending).value.value.type, "x");
			await first.return(undefined);
			const second = socket.events()[Symbol.asyncIterator]();
			assert.equal((await second.next()).value.value.type, "y");
			assert.equal(socket.isOpen, true);
		} finally {
			await socket.close();
		}
	});

	it("drains an interrupted response after the acknowledgement", async () => {
		const port = await serve((conn) => {
			upgrade(conn, (frame) => {
				const value = JSON.parse(frame.payload.toString("utf8")) as { type: string; response_id: string };
				if (value.type !== "response.interrupt") return;
				conn.sock.write(textFrame({ type: "response.interrupt.accepted", response_id: value.response_id }));
				conn.sock.write(textFrame({ type: "response.completed", response: { id: value.response_id } }));
			});
		});
		const socket = await connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: noopResponse() });
		try {
			const result = await socket.interrupt("resp_9", { mode: "cancel", deadlineMs: 500 });
			assert.deepEqual(result, { acknowledged: true, completed: true });
			const events = socket.events()[Symbol.asyncIterator]();
			assert.equal((await events.next()).value.value.type, "response.interrupt.accepted");
			assert.equal((await events.next()).value.value.type, "response.completed");
		} finally {
			await socket.close();
		}
	});

	it("retires the socket when the interruption is rejected", async () => {
		const port = await serve((conn) => {
			upgrade(conn, (frame) => {
				const value = JSON.parse(frame.payload.toString("utf8")) as { response_id: string };
				conn.sock.write(textFrame({ type: "response.interrupt.failed", response_id: value.response_id }));
			});
		});
		const socket = await connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: noopResponse() });
		await assert.rejects(
			socket.interrupt("resp_2", { mode: "cancel", deadlineMs: 500 }),
			(error: unknown) => error instanceof SocketError && error.kind === "interrupt-failed",
		);
		assert.equal(socket.isOpen, false);
	});

	it("retires the socket when the interruption drain misses its deadline", async () => {
		const port = await serve((conn) => upgrade(conn, () => undefined));
		const socket = await connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: noopResponse() });
		await assert.rejects(
			socket.interrupt("resp_3", { mode: "cancel", deadlineMs: 50 }),
			(error: unknown) => error instanceof SocketError && error.kind === "interrupt-timeout",
		);
		assert.equal(socket.isOpen, false);
	});

	it("opens through an explicit http CONNECT proxy without reading environment variables", async () => {
		const envBefore = JSON.stringify(process.env);
		const wsPort = await serve((conn) => upgrade(conn, () => undefined));
		const proxySeen: string[] = [];
		const proxy = createServer((client) => {
			sockets.add(client);
			client.on("error", () => undefined);
			let buf = Buffer.alloc(0);
			const onData = (chunk: Buffer) => {
				buf = Buffer.concat([buf, chunk]);
				const end = buf.indexOf("\r\n\r\n");
				if (end < 0) return;
				client.removeListener("data", onData);
				const head = buf.subarray(0, end).toString("latin1");
				proxySeen.push(head);
				const target = netConnect({ host: "127.0.0.1", port: wsPort });
				target.on("error", () => client.destroy());
				target.on("connect", () => {
					client.write("HTTP/1.1 200 Connection established\r\n\r\n");
					client.pipe(target);
					target.pipe(client);
				});
			};
			client.on("data", onData);
		});
		servers.push(proxy);
		const proxyPort = await new Promise<number>((resolve) => proxy.listen(0, "127.0.0.1", () => resolve((proxy.address() as AddressInfo).port)));
		const socket = await connect({
			url: wsUrl(wsPort),
			headers: {},
			signal: new AbortController().signal,
			onResponse: noopResponse(),
			proxy: { url: `http://127.0.0.1:${proxyPort}`, headers: { "Proxy-Authorization": "Basic dGVzdA==" } },
		});
		try {
			assert.equal(socket.isOpen, true);
			assert.match(proxySeen[0], new RegExp(`^CONNECT 127\\.0\\.0\\.1:${wsPort} HTTP/1\\.1`));
			assert.match(proxySeen[0], /Proxy-Authorization: Basic dGVzdA==/);
		} finally {
			await socket.close();
		}
		assert.equal(JSON.stringify(process.env), envBefore, "no environment mutation");
	});
});

// ---- SSE ----------------------------------------------------------------------------------------------------------

type Recorded = { url: string; init: RequestInit };

function fakeFetch(respond: (init: RequestInit) => Response | Promise<Response>, calls: Recorded[]) {
	return async (url: string, init: RequestInit): Promise<Response> => {
		calls.push({ url, init });
		return respond(init);
	};
}

function sseBody(chunks: string[], keepOpen = false): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			if (!keepOpen) controller.close();
		},
	});
}

const SSE_URL = "https://chatgpt.com/backend-api/codex/responses";
const sseHeaders = { "content-type": "text/event-stream" };

async function collect(generator: AsyncGenerator<{ value: Record<string, unknown> }>): Promise<string[]> {
	const types: string[] = [];
	for await (const event of generator) types.push(event.value.type as string);
	return types;
}

describe("sse connector", () => {
	it("posts the exact body, forwards the caller fetch and yields events, skipping malformed data", async () => {
		const calls: Recorded[] = [];
		const heads: ResponseHead[] = [];
		const body = new TextEncoder().encode('{"model":"m","input":[]}');
		const generator = postEvents({
			url: SSE_URL,
			headers: { authorization: TOKEN },
			body,
			signal: new AbortController().signal,
			onResponse: (head) => heads.push(head),
			fetch: fakeFetch(
				() =>
					new Response(
						sseBody([
							'data: {"type":"response.cre',
							'ated"}\r\n\r\n',
							'data: {"type":"response.output_text.delta","delta":"hi"}\n\n',
							"data: not json\n\n",
							'data: {"type":"response.completed","response":{"id":"r1"}}\n\n',
						]),
						{ status: 200, headers: sseHeaders },
					),
				calls,
			),
		});
		const types = await collect(generator);
		assert.deepEqual(types, ["response.created", "response.output_text.delta", "response.completed"]);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].url, SSE_URL);
		assert.equal(calls[0].init.method, "POST");
		assert.equal(calls[0].init.redirect, "manual");
		assert.deepEqual(calls[0].init.body, body);
		const sent = new Headers(calls[0].init.headers as HeadersInit);
		assert.equal(sent.get("accept"), "text/event-stream");
		assert.equal(sent.get("content-type"), "application/json");
		assert.equal(sent.get("authorization"), TOKEN);
		assert.equal(heads[0].status, 200);
	});

	it("reports EOF before a terminal event as a typed error", async () => {
		const generator = postEvents({
			url: SSE_URL,
			headers: {},
			body: new Uint8Array(),
			signal: new AbortController().signal,
			onResponse: () => undefined,
			fetch: fakeFetch(
				() => new Response(sseBody(['data: {"type":"response.output_text.delta","delta":"x"}\n\n']), { status: 200, headers: sseHeaders }),
				[],
			),
		});
		await assert.rejects(collect(generator), (error: unknown) => error instanceof SseError && error.kind === "eof");
	});

	it("reports server errors with status and headers but never the response body", async () => {
		const heads: ResponseHead[] = [];
		const generator = postEvents({
			url: SSE_URL,
			headers: {},
			body: new Uint8Array(),
			signal: new AbortController().signal,
			onResponse: (head) => heads.push(head),
			fetch: fakeFetch(
				() =>
					new Response('{"error":"Bearer SECRET-TOKEN-VALUE"}', {
						status: 500,
						headers: { "x-request-id": "req-1" },
					}),
				[],
			),
		});
		await assert.rejects(collect(generator), (error: unknown) => {
			assert.ok(error instanceof SseError);
			assert.equal(error.kind, "status");
			assert.equal(error.status, 500);
			assert.equal(error.headers["x-request-id"], "req-1");
			assert.ok(!error.message.includes("SECRET"));
			return true;
		});
		assert.equal(heads[0].status, 500);
	});

	it("rejects a redirect without following it", async () => {
		const calls: Recorded[] = [];
		const generator = postEvents({
			url: SSE_URL,
			headers: {},
			body: new Uint8Array(),
			signal: new AbortController().signal,
			onResponse: () => undefined,
			fetch: fakeFetch(() => new Response(null, { status: 302, headers: { location: "https://example.com/" } }), calls),
		});
		await assert.rejects(collect(generator), (error: unknown) => error instanceof SseError && error.kind === "redirect" && error.status === 302);
		assert.equal(calls[0].init.redirect, "manual");
	});

	it("rejects a success response that is not text/event-stream", async () => {
		const generator = postEvents({
			url: SSE_URL,
			headers: {},
			body: new Uint8Array(),
			signal: new AbortController().signal,
			onResponse: () => undefined,
			fetch: fakeFetch(() => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }), []),
		});
		await assert.rejects(collect(generator), (error: unknown) => error instanceof SseError && error.kind === "content-type");
	});

	it("times out when no complete event arrives, even while bytes trickle in", async () => {
		const encoder = new TextEncoder();
		let timer: ReturnType<typeof setInterval> | undefined;
		const trickle = new ReadableStream<Uint8Array>({
			start(controller) {
				timer = setInterval(() => controller.enqueue(encoder.encode('data: {"type":"x"')), 15);
			},
			cancel() {
				if (timer !== undefined) clearInterval(timer);
			},
		});
		const generator = postEvents({
			url: SSE_URL,
			headers: {},
			body: new Uint8Array(),
			signal: new AbortController().signal,
			onResponse: () => undefined,
			idleTimeoutMs: 100,
			fetch: fakeFetch(() => new Response(trickle, { status: 200, headers: sseHeaders }), []),
		});
		await assert.rejects(collect(generator), (error: unknown) => error instanceof SseError && error.kind === "idle");
	});

	it("ends with AbortError when the caller aborts mid-stream", async () => {
		const controller = new AbortController();
		const generator = postEvents({
			url: SSE_URL,
			headers: {},
			body: new Uint8Array(),
			signal: controller.signal,
			onResponse: () => undefined,
			fetch: fakeFetch((init) => {
				const stream = new ReadableStream<Uint8Array>({
					start(streamController) {
						init.signal?.addEventListener("abort", () => streamController.error(init.signal?.reason), { once: true });
					},
				});
				return new Response(stream, { status: 200, headers: sseHeaders });
			}, []),
		});
		setTimeout(() => controller.abort(new DOMException("caller aborted", "AbortError")), 20);
		await assert.rejects(collect(generator), (error: unknown) => error instanceof Error && error.name === "AbortError");
	});

	it("refuses non-ChatGPT URLs before calling fetch", async () => {
		const calls: Recorded[] = [];
		const generator = postEvents({
			url: "https://example.com/v1/responses",
			headers: {},
			body: new Uint8Array(),
			signal: new AbortController().signal,
			onResponse: () => undefined,
			fetch: fakeFetch(() => new Response(""), calls),
		});
		await assert.rejects(collect(generator), OriginError);
		assert.equal(calls.length, 0);
	});
});

// ---- native hardening: interrupt modes, control fields, proxy profile -----------------------------------------------

// A plain TCP CONNECT proxy on loopback. It records each CONNECT head and tunnels to the port returned by target().
function tunnelProxy(seen: string[], target: () => number): Promise<number> {
	const proxy = createServer((client) => {
		sockets.add(client);
		client.on("error", () => undefined);
		let buf = Buffer.alloc(0);
		const onData = (chunk: Buffer) => {
			buf = Buffer.concat([buf, chunk]);
			const end = buf.indexOf("\r\n\r\n");
			if (end < 0) return;
			client.removeListener("data", onData);
			seen.push(buf.subarray(0, end).toString("latin1"));
			const upstream = netConnect({ host: "127.0.0.1", port: target() });
			upstream.on("error", () => client.destroy());
			upstream.on("connect", () => {
				client.write("HTTP/1.1 200 Connection established\r\n\r\n");
				client.pipe(upstream);
				upstream.pipe(client);
			});
		};
		client.on("data", onData);
	});
	servers.push(proxy);
	return new Promise<number>((resolve) => proxy.listen(0, "127.0.0.1", () => resolve((proxy.address() as AddressInfo).port)));
}

// Stands in for node:tls in tests only: a plain loopback socket, or the tunnel socket that is already connected.
function plainTls(proxyPort: () => number): TlsConnector {
	return async (options) => {
		if (options.socket) return options.socket;
		return netConnect({ host: "127.0.0.1", port: proxyPort() });
	};
}

describe("interrupt modes", () => {
	it("drain sends the frame, does not validate acknowledgements and ends at response.completed", async () => {
		const port = await serve((conn) => {
			upgrade(conn, (frame) => {
				const value = JSON.parse(frame.payload.toString("utf8")) as { type: string };
				if (value.type !== "response.interrupt") return;
				// Native Drain does not check the acknowledgement's response_id.
				conn.sock.write(textFrame({ type: "response.interrupt.accepted", response_id: "resp_other" }));
				conn.sock.write(textFrame({ type: "response.completed", response: { id: "resp_d" } }));
			});
		});
		const socket = await connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: noopResponse() });
		try {
			const result = await socket.interrupt("resp_d", { mode: "drain" });
			assert.deepEqual(result, { acknowledged: false, completed: true });
			assert.equal(socket.isOpen, true);
		} finally {
			await socket.close();
		}
	});

	it("cancel retires the socket on an acknowledgement for another response", async () => {
		const port = await serve((conn) => {
			upgrade(conn, () => conn.sock.write(textFrame({ type: "response.interrupt.accepted", response_id: "resp_other" })));
		});
		const socket = await connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: noopResponse() });
		await assert.rejects(
			socket.interrupt("resp_c", { mode: "cancel", deadlineMs: 500 }),
			(error: unknown) => error instanceof SocketError && error.kind === "interrupt-failed" && error.message.includes("unexpected"),
		);
		assert.equal(socket.isOpen, false);
	});

	it("cancel without a positive deadline or any mode sends nothing and keeps the socket", async () => {
		const seen: string[] = [];
		const port = await serve((conn) => upgrade(conn, (frame) => seen.push(frame.payload.toString("utf8"))));
		const socket = await connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: noopResponse() });
		try {
			await assert.rejects(socket.interrupt("resp_n", { mode: "cancel", deadlineMs: 0 }), (error: unknown) => error instanceof SocketError && error.kind === "interrupt-failed");
			await assert.rejects(socket.interrupt("resp_n", undefined as never), (error: unknown) => error instanceof SocketError && error.kind === "interrupt-failed");
			assert.equal(socket.isOpen, true);
			await new Promise((resolve) => setTimeout(resolve, 30));
			assert.deepEqual(seen, [], "no interrupt frame was sent");
		} finally {
			await socket.close();
		}
	});
});

describe("error control fields", () => {
	it("keeps only allowlisted control fields of a rejected upgrade body, never the message", async () => {
		const body = JSON.stringify({ error: { code: "usage_limit_reached", resets_in_seconds: 60, message: "Bearer SECRET-TOKEN-VALUE", extra: "x" } });
		const port = await serve((conn) => {
			conn.sock.end(
				`HTTP/1.1 429 Too Many Requests\r\nRetry-After: 7\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
			);
		});
		await assert.rejects(
			connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: noopResponse() }),
			(error: unknown) => {
				assert.ok(error instanceof SocketError);
				assert.equal(error.kind, "upgrade-rejected");
				assert.equal(error.status, 429);
				assert.equal(error.headers["retry-after"], "7");
				assert.deepEqual(error.control, { code: "usage_limit_reached", resetsInSeconds: 60 });
				assert.ok(!JSON.stringify(error.control).includes("SECRET"));
				assert.ok(!error.message.includes("SECRET"));
				return true;
			},
		);
	});

	it("keeps the allowlisted plan and window of a usage-limit body, never the message", async () => {
		const body = JSON.stringify({ error: { type: "usage_limit_reached", plan_type: "plus", limit_window_minutes: 300, resets_at: 1700003600, message: "SECRET-MSG" } });
		const port = await serve((conn) => {
			conn.sock.end(`HTTP/1.1 429 Too Many Requests\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
		});
		await assert.rejects(
			connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: noopResponse() }),
			(error: unknown) => {
				assert.ok(error instanceof SocketError);
				assert.deepEqual(error.control, { type: "usage_limit_reached", planType: "plus", limitWindowMinutes: 300, resetsAt: 1700003600 });
				assert.ok(!JSON.stringify(error.control).includes("SECRET"));
				return true;
			},
		);
	});

	it("gives no control fields for a non-JSON rejected body", async () => {
		const port = await serve((conn) => {
			conn.sock.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 9\r\nConnection: close\r\n\r\nnot json!");
		});
		await assert.rejects(
			connect({ url: wsUrl(port), headers: {}, signal: new AbortController().signal, onResponse: noopResponse() }),
			(error: unknown) => error instanceof SocketError && error.status === 401 && error.control === undefined,
		);
	});

	it("keeps allowlisted control fields of an SSE 429 without the message", async () => {
		const body = JSON.stringify({ error: { code: "rate_limit_exceeded", resets_at: 1700000000, message: "Bearer SECRET-TOKEN-VALUE" } });
		const generator = postEvents({
			url: SSE_URL,
			headers: {},
			body: new Uint8Array(),
			signal: new AbortController().signal,
			onResponse: () => undefined,
			fetch: fakeFetch(() => new Response(body, { status: 429, headers: { "content-type": "application/json" } }), []),
		});
		await assert.rejects(collect(generator), (error: unknown) => {
			assert.ok(error instanceof SseError);
			assert.equal(error.status, 429);
			assert.deepEqual(error.control, { code: "rate_limit_exceeded", resetsAt: 1700000000 });
			assert.ok(!JSON.stringify(error.control).includes("SECRET"));
			return true;
		});
	});
});

describe("proxy profile", () => {
	it("opens through an https CONNECT proxy with injected TLS and sends the proxy headers", async () => {
		const wsPort = await serve((conn) => upgrade(conn, () => undefined));
		const seen: string[] = [];
		let proxyPort = 0;
		proxyPort = await tunnelProxy(seen, () => wsPort);
		const socket = await connect({
			url: "wss://chatgpt.com/backend-api/codex/responses",
			headers: {},
			signal: new AbortController().signal,
			onResponse: noopResponse(),
			proxy: { url: `https://127.0.0.1:${proxyPort}`, headers: { "Proxy-Authorization": "Basic dGVzdA==" }, tls: plainTls(() => proxyPort) },
		});
		try {
			assert.equal(socket.isOpen, true);
			assert.match(seen[0], /^CONNECT chatgpt\.com:443 HTTP\/1\.1/);
			assert.match(seen[0], /Proxy-Authorization: Basic dGVzdA==/);
		} finally {
			await socket.close();
		}
	});

	it("ingests cookies from a rejected upgrade that came through a proxy", async () => {
		const wsPort = await serve((conn) => {
			conn.sock.end("HTTP/1.1 426 Upgrade Required\r\nset-cookie: __cf_bm=rejected-value; Path=/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
		});
		const seen: string[] = [];
		let proxyPort = 0;
		proxyPort = await tunnelProxy(seen, () => wsPort);
		const jar = new CookieJar();
		await assert.rejects(
			connect({
				url: "wss://chatgpt.com/backend-api/codex/responses",
				headers: {},
				signal: new AbortController().signal,
				onResponse: noopResponse(),
				cookies: jar,
				proxy: { url: `https://127.0.0.1:${proxyPort}`, tls: plainTls(() => proxyPort) },
			}),
			(error: unknown) => error instanceof SocketError && error.kind === "upgrade-rejected" && error.status === 426,
		);
		assert.equal(jar.header(new URL("https://chatgpt.com/backend-api/codex/responses")), "__cf_bm=rejected-value");
	});

	it("refuses an https proxy whose certificate is not trusted, with no verification override", async () => {
		const port = await new Promise<number>((resolve) => {
			const server = createServer((sock) => {
				sockets.add(sock);
				sock.on("error", () => undefined);
				sock.end("HTTP/1.1 200 Connection established\r\n\r\n");
			});
			servers.push(server);
			server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
		});
		await assert.rejects(
			connect({
				url: "wss://chatgpt.com/backend-api/codex/responses",
				headers: {},
				signal: new AbortController().signal,
				onResponse: noopResponse(),
				proxy: { url: `https://127.0.0.1:${port}` },
			}),
			(error: unknown) => error instanceof SocketError && error.kind === "transport" && error.message.includes("proxy TLS failed"),
		);
	});

	it("refuses unsupported or unsafe proxy options before any socket is opened", async () => {
		const cases: Array<Record<string, unknown>> = [
			{ url: "socks5://127.0.0.1:1" },
			{ url: "http://user:secret@127.0.0.1:1" },
			{ url: "http://127.0.0.1:1/path" },
			{ url: "http://127.0.0.1:1", insecure: true },
			{ url: "http://127.0.0.1:1", ca: "not-a-proxy-ca" },
			{ url: "http://127.0.0.1:1", headers: { "X-Test": "a\r\nInjected: 1" } },
		];
		for (const proxy of cases) {
			await assert.rejects(
				connect({
					url: wsUrl(1),
					headers: {},
					signal: new AbortController().signal,
					onResponse: noopResponse(),
					proxy: proxy as never,
				}),
				(error: unknown) => error instanceof SocketError && error.kind === "proxy-rejected",
				JSON.stringify(Object.keys(proxy)),
			);
		}
	});
});
