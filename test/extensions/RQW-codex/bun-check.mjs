// Bun smoke for the owned Codex connectors. CI runs it once per Bun version (.github/workflows/tests.yml, job
// bun-codemode): bun test/extensions/RQW-codex/bun-check.mjs. Loopback only: a fake WebSocket and HTTP server on
// 127.0.0.1 and a fake fetch. No credential, no owner home directory, no external network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { deflateRawSync, inflateRawSync, zstdDecompressSync, constants as zlibConstants } from "node:zlib";
import { compressRequest, REQUEST_ZSTD_LEVEL } from "../../../extensions/RQW-codex/compression.ts";
import { postEvents } from "../../../extensions/RQW-codex/sse.ts";
import { connect, WS_PERMESSAGE_DEFLATE_OFFER } from "../../../extensions/RQW-codex/websocket.ts";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const BETA = "responses_websockets=2026-02-06";
const encoder = new TextEncoder();
const sockets = new Set();

function acceptFor(key) {
	return createHash("sha1").update(key + GUID).digest("base64");
}

// Server frame (never masked). rsv1 marks a permessage-deflate message.
function frame(opcode, payload, rsv1 = false) {
	const b0 = 0x80 | (rsv1 ? 0x40 : 0) | opcode;
	if (payload.length < 126) return Buffer.concat([Buffer.from([b0, payload.length]), payload]);
	const head = Buffer.alloc(4);
	head[0] = b0;
	head[1] = 126;
	head.writeUInt16BE(payload.length, 2);
	return Buffer.concat([head, payload]);
}

// Deflated text message as a native server sends it: raw deflate with the 00 00 ff ff tail removed.
function deflatedText(value) {
	const raw = deflateRawSync(Buffer.from(JSON.stringify(value)), { finishFlush: zlibConstants.Z_SYNC_FLUSH });
	return frame(1, raw.subarray(0, raw.length - 4), true);
}

// Parses masked client frames, inflating those with rsv1 the way a server does.
function frameReader(onFrame) {
	let buf = Buffer.alloc(0);
	return (chunk) => {
		buf = Buffer.concat([buf, chunk]);
		for (;;) {
			if (buf.length < 2) return;
			const rsv1 = (buf[0] & 0x40) !== 0;
			const opcode = buf[0] & 0x0f;
			let length = buf[1] & 0x7f;
			let offset = 2;
			if (length === 126) {
				if (buf.length < 4) return;
				length = buf.readUInt16BE(2);
				offset = 4;
			}
			if (buf.length < offset + 4 + length) return;
			const mask = buf.subarray(offset, offset + 4);
			offset += 4;
			const payload = Buffer.from(buf.subarray(offset, offset + length));
			for (let i = 0; i < length; i++) payload[i] ^= mask[i % 4];
			buf = buf.subarray(offset + length);
			const data = rsv1 ? inflateRawSync(Buffer.concat([payload, Buffer.from([0x00, 0x00, 0xff, 0xff])])) : payload;
			onFrame({ opcode, payload: data });
		}
	};
}

// Loopback server: onConnection(socket, headers, leftover bytes after the request head).
function server(onConnection) {
	return new Promise((resolve) => {
		const srv = createServer((sock) => {
			sockets.add(sock);
			sock.on("close", () => sockets.delete(sock));
			sock.on("error", () => undefined);
			let buf = Buffer.alloc(0);
			const onData = (chunk) => {
				buf = Buffer.concat([buf, chunk]);
				const end = buf.indexOf("\r\n\r\n");
				if (end < 0) return;
				sock.removeListener("data", onData);
				const headers = {};
				for (const line of buf.subarray(0, end).toString("latin1").split("\r\n").slice(1)) {
					const at = line.indexOf(":");
					headers[line.slice(0, at).toLowerCase()] = line.slice(at + 1).trim();
				}
				onConnection(sock, headers, buf.subarray(end + 4));
			};
			sock.on("data", onData);
		});
		srv.listen(0, "127.0.0.1", () => resolve({ port: srv.address().port, close: () => srv.close() }));
	});
}

function upgradeHead(headers, extensions) {
	return (
		"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
		`Sec-WebSocket-Accept: ${acceptFor(headers["sec-websocket-key"])}\r\n` +
		(extensions ? `Sec-WebSocket-Extensions: ${extensions}\r\n` : "") +
		"\r\n"
	);
}

async function waitFor(read, ms = 3000) {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = read();
		if (value !== undefined) return value;
		if (Date.now() > deadline) throw new Error("timed out waiting for the Bun check condition");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

function streamOf(chunks, onAbort) {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			if (onAbort) onAbort(controller);
		},
	});
}

async function checkCompression() {
	const json = Buffer.from(JSON.stringify({ model: "bun-check", input: "x".repeat(500) }));
	assert.equal(REQUEST_ZSTD_LEVEL, 3);
	const compressed = compressRequest(json);
	assert.ok(compressed.byteLength < json.byteLength);
	assert.deepEqual(Buffer.from(zstdDecompressSync(compressed)), json);
	console.log("compression: zstd level 3 round trip ok");
}

async function checkWebSocket() {
	const received = [];
	const pongs = [];
	const seenHeaders = [];
	const srv = await server((sock, headers, rest) => {
		seenHeaders.push(headers);
		sock.write(upgradeHead(headers, "permessage-deflate"));
		const feed = frameReader((f) => {
			if (f.opcode === 1) received.push(JSON.parse(f.payload.toString("utf8")));
			if (f.opcode === 10) pongs.push(f.payload.toString("utf8"));
			if (f.opcode === 8) sock.end(frame(8, Buffer.from([0x03, 0xe8])));
		});
		feed(rest);
		sock.on("data", feed);
		sock.write(deflatedText({ type: "response.output_text.delta", delta: "d".repeat(3000) }));
		sock.write(frame(9, Buffer.from("abcd")));
	});
	try {
		const socket = await connect({
			url: `ws://127.0.0.1:${srv.port}/backend-api/codex/responses`,
			headers: { authorization: "Bearer bun-check-fake" },
			signal: new AbortController().signal,
			onResponse: () => undefined,
			idleTimeoutMs: 5000,
		});
		const events = socket.events()[Symbol.asyncIterator]();
		const first = await events.next();
		assert.equal(first.value.value.type, "response.output_text.delta");
		assert.equal(first.value.value.delta.length, 3000);
		await socket.send({ type: "response.create", model: "bun-check" });
		await waitFor(() => (received.length === 1 ? true : undefined));
		assert.deepEqual(received[0], { type: "response.create", model: "bun-check" });
		await waitFor(() => (pongs.length === 1 ? true : undefined));
		assert.equal(pongs[0], "abcd");
		assert.equal(socket.isOpen, true);
		assert.equal(seenHeaders[0]["sec-websocket-extensions"], WS_PERMESSAGE_DEFLATE_OFFER);
		assert.equal(seenHeaders[0]["openai-beta"], BETA);
		assert.equal(seenHeaders[0].authorization, "Bearer bun-check-fake");
		await socket.close();
		console.log("websocket: offer, beta, deflate in both directions and ping/pong ok");
	} finally {
		srv.close();
	}
}

async function checkWebSocketAbort() {
	const srv = await server((sock, headers) => {
		sock.write(upgradeHead(headers, undefined));
	});
	try {
		const controller = new AbortController();
		const socket = await connect({
			url: `ws://127.0.0.1:${srv.port}/backend-api/codex/responses`,
			headers: {},
			signal: controller.signal,
			onResponse: () => undefined,
		});
		const pending = socket.events()[Symbol.asyncIterator]().next();
		controller.abort();
		await assert.rejects(pending, (error) => error.name === "AbortError");
		assert.equal(socket.isOpen, false);
		console.log("websocket abort: open socket ends with AbortError ok");
	} finally {
		srv.close();
	}
}

async function checkSse() {
	const body = encoder.encode('{"model":"bun-check","input":[]}');
	const types = [];
	const calls = [];
	const generator = postEvents({
		url: "https://chatgpt.com/backend-api/codex/responses",
		headers: { authorization: "Bearer bun-check-fake" },
		body,
		signal: new AbortController().signal,
		onResponse: () => undefined,
		fetch: async (url, init) => {
			calls.push({ url, init });
			return new Response(
				streamOf([
					'data: {"type":"response.output_text.delta","delta":"hi"}\r\n\r\n',
					'data: {"type":"response.completed","response":{"id":"r1"}}\n\n',
				]),
				{ status: 200, headers: { "content-type": "text/event-stream" } },
			);
		},
	});
	for await (const event of generator) types.push(event.value.type);
	assert.deepEqual(types, ["response.output_text.delta", "response.completed"]);
	assert.equal(calls[0].init.method, "POST");
	assert.equal(calls[0].init.redirect, "manual");
	assert.deepEqual(calls[0].init.body, body);
	console.log("sse: POST body, framing and terminal event ok");
}

async function checkSseAbort() {
	const controller = new AbortController();
	const generator = postEvents({
		url: "https://chatgpt.com/backend-api/codex/responses",
		headers: {},
		body: new Uint8Array(),
		signal: controller.signal,
		onResponse: () => undefined,
		fetch: async (_url, init) =>
			new Response(
				streamOf(['data: {"type":"response.created"}\n\n'], (c) => {
					init.signal.addEventListener("abort", () => c.error(init.signal.reason), { once: true });
				}),
				{ status: 200, headers: { "content-type": "text/event-stream" } },
			),
	});
	const first = await generator.next();
	assert.equal(first.value.value.type, "response.created");
	const pending = generator.next();
	controller.abort();
	await assert.rejects(pending, (error) => error.name === "AbortError");
	console.log("sse abort: mid-stream abort ends with AbortError ok");
}

async function main() {
	console.log(`runtime: ${typeof Bun !== "undefined" ? `bun ${Bun.version}` : process.version}`);
	await checkCompression();
	await checkWebSocket();
	await checkWebSocketAbort();
	await checkSse();
	await checkSseAbort();
	console.log("bun-check: ok");
}

main().then(
	() => {
		for (const sock of sockets) sock.destroy();
		process.exit(0);
	},
	(error) => {
		console.error(error);
		for (const sock of sockets) sock.destroy();
		process.exit(1);
	},
);
