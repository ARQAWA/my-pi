// RQW-codex in the synthetic world, wire mode: the real Pi, the real extension and its real WebSocket client (`ws`).
// Only the outside is faked: the handshake and the frames of chatgpt.com, so the extension's own connector, its prewarm
// and its steering run on real wire bytes. The fake server speaks plain frames, no compression.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import https from "node:https";
import { Duplex } from "node:stream";
import { after, it, type TestContext } from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { keys, networkRoutes, reportTimings, world, type WorldOptions } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

const CTRL_ENTER = "\x1b[13;5u";
const HANDSHAKE_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const stockStream = Object.getOwnPropertyDescriptor(ModelRuntime.prototype, "streamSimple")!;
const stockRequest = https.request;

/**
 * The world answers model requests from its script. Wire mode needs Pi's own request path instead, so the world's
 * replacement of `ModelRuntime.prototype.streamSimple` is ignored and the extension wraps the stock method, as in the product.
 */
const giveBack = () => { Object.defineProperty(ModelRuntime.prototype, "streamSimple", stockStream); };

async function wireWorld(t: TestContext, options: WorldOptions = {}) {
	Object.defineProperty(ModelRuntime.prototype, "streamSimple", { configurable: true, get: () => stockStream.value, set: giveBack });
	t.after(giveBack);
	const w = await world(t, options);
	t.after(giveBack);
	return w;
}

/** The old world gives back its snapshot, which holds the trap, so the new build meets the trap again; its own end needs the same cleanup. */
async function restartWire(t: TestContext, w: Awaited<ReturnType<typeof wireWorld>>) {
	const next = await w.restart();
	t.after(giveBack);
	return next;
}

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
const created = (id: string) => ({ type: "response.created", response: { id } });
const completed = (id: string) => ({ type: "response.completed", response: { id, status: "completed", usage } });
const item = (id: string, content: string, status: "in_progress" | "completed") => ({
	type: "message", id, role: "assistant", status,
	content: status === "completed" ? [{ type: "output_text", text: content, annotations: [] }] : [],
});
const added = (id: string) => ({ type: "response.output_item.added", output_index: 0, item: item(id, "", "in_progress") });
const delta = (id: string, text: string) => ({ type: "response.output_text.delta", item_id: id, output_index: 0, content_index: 0, delta: text });
const done = (id: string, text: string) => ({ type: "response.output_item.done", output_index: 0, item: item(id, text, "completed") });

/** A whole answer in events, for the response `id`. */
const whole = (id: string, text: string) => [created(id), added(`${id}-m`), delta(`${id}-m`, text), done(`${id}-m`, text), completed(id)];

/** One WebSocket the extension opened: what the client sent, and what the test sends back. */
interface Connection {
	readonly url: string;
	readonly frames: any[];
	send(...events: unknown[]): void;
}

/** A server frame: FIN, the opcode, an unmasked payload. */
function serverFrame(payload: Buffer, opcode: number): Buffer {
	const length = payload.length;
	if (length < 126) return Buffer.concat([Buffer.from([0x80 | opcode, length]), payload]);
	if (length < 65536) return Buffer.concat([Buffer.from([0x80 | opcode, 126, length >> 8, length & 255]), payload]);
	const header = Buffer.alloc(10);
	header[0] = 0x80 | opcode;
	header[1] = 127;
	header.writeBigUInt64BE(BigInt(length), 2);
	return Buffer.concat([header, payload]);
}

/**
 * chatgpt.com on `https.request`, the one seam `ws` opens its connection through. A frame the test must not answer by
 * hand gets its answer here: the prewarm (generate:false) and the session naming request.
 */
function codexServer(install = true, autoWarm = true) {
	const connections: Connection[] = [];
	let prewarms = 0;

	function accept(request: any, options: any) {
		const socket = new Duplex({ read() {}, write(chunk, _encoding, next) { receive(chunk); next(); } }) as Duplex & Record<string, unknown>;
		socket.setTimeout = () => socket;
		socket.setNoDelay = () => socket;
		socket.setKeepAlive = () => socket;
		const connection: Connection = {
			url: `wss://${options.host}${options.path}`,
			frames: [],
			send: (...events) => { for (const event of events) socket.push(serverFrame(Buffer.from(JSON.stringify(event)), 1)); },
		};
		connections.push(connection);

		let pending = Buffer.alloc(0);
		const receive = (chunk: Buffer) => {
			pending = Buffer.concat([pending, chunk]);
			for (;;) {
				if (pending.length < 2) return;
				const opcode = pending[0] & 0x0f;
				let length = pending[1] & 0x7f;
				let offset = 2;
				if (length === 126) { if (pending.length < 4) return; length = pending.readUInt16BE(2); offset = 4; }
				else if (length === 127) { if (pending.length < 10) return; length = Number(pending.readBigUInt64BE(2)); offset = 10; }
				// Frames from a client are always masked.
				if (pending.length < offset + 4 + length) return;
				const mask = pending.subarray(offset, offset + 4);
				const payload = Buffer.from(pending.subarray(offset + 4, offset + 4 + length));
				for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
				pending = pending.subarray(offset + 4 + length);
				if (opcode === 8) {
					socket.push(serverFrame(Buffer.alloc(0), 8));
					socket.push(null);
				} else if (opcode === 1) {
					const frame = JSON.parse(payload.toString("utf8"));
					connection.frames.push(frame);
					answerAutomatically(connection, frame);
				}
			}
		};

		const key = options.headers["Sec-WebSocket-Key"];
		const response = { statusCode: 101, headers: { upgrade: "websocket", "sec-websocket-accept": createHash("sha1").update(key + HANDSHAKE_GUID).digest("base64") } };
		request.emit("upgrade", response, socket, Buffer.alloc(0));
	}

	function answerAutomatically(connection: Connection, frame: any) {
		if (JSON.stringify(frame).includes("You name chat sessions.")) connection.send(...whole("naming", '["Greeting"]'));
		else if (frame.generate === false && autoWarm) connection.send(created(`warm-${++prewarms}`), completed(`warm-${prewarms}`));
	}

	const request = (options: any) => {
		const request: any = new EventEmitter();
		request.setHeader = () => {};
		request.abort = () => {};
		request.destroy = () => {};
		// The upgrade comes after `ws` has attached its listeners.
		request.end = () => queueMicrotask(() => accept(request, options));
		return request;
	};
	if (install) https.request = request as never;

	return {
		request, connections,
		/** The frames of the conversation: everything that is neither the prewarm nor the naming request. */
		get turns() {
			return connections.flatMap((connection) => connection.frames.map((frame) => ({ connection, frame })))
				.filter(({ frame }) => frame.type === "response.create" && frame.generate !== false && !JSON.stringify(frame).includes("You name chat sessions."));
		},
		get prewarms() { return connections.flatMap((connection) => connection.frames).filter((frame) => frame.generate === false); },
	};
}

/** Switches the main chat to a Codex model; Pi then starts the extension's startup prewarm. */
async function useCodex(w: Awaited<ReturnType<typeof wireWorld>>) {
	await w.session.setModel(w.session.modelRuntime.getModel("openai-codex", "gpt-6.1-terra") as never);
}

/** The process calls other than the workspace metadata the extension reads with git; the world blocks them and the extension goes on without. */
const onlyGit = (w: Awaited<ReturnType<typeof wireWorld>>) => w.processAttempts.filter((attempt) => attempt !== "execFile git");

after(() => {
	assert.equal(https.request, stockRequest, "the fake handshake is given back");
	assert.equal(Object.getOwnPropertyDescriptor(ModelRuntime.prototype, "streamSimple")?.value, stockStream.value, "Pi's own request path is given back");
});

it("a steering message sent during an answer ends it with one response.interrupt and the next request carries it", async (t) => {
	const w = await wireWorld(t);
	const server = codexServer();
	await useCodex(w);
	await w.until(() => server.prewarms.length === 1, "the startup prewarm");

	w.type("write a patch");
	w.press(keys.enter);
	await w.until(() => server.turns.length === 1, "the first request");
	const first = server.turns[0].connection;
	first.send(created("resp_1"), added("m1"), delta("m1", "half an ans"));
	// RQW-live-tail shows `writing answer` for text that is still streaming.
	await w.until(() => w.screen().join("\n").includes("writing answer"), "the partial answer");
	assert.equal(first.frames.filter((frame) => frame.type === "response.interrupt").length, 0, "no steering, no interrupt");

	w.type("use the smaller patch");
	w.press(CTRL_ENTER);
	await w.until(() => first.frames.some((frame) => frame.type === "response.interrupt"), "the interrupt");
	assert.deepEqual(first.frames.filter((frame) => frame.type === "response.interrupt"), [{ type: "response.interrupt", response_id: "resp_1", mode: "discard_partial_items" }]);
	assert.equal(server.turns.length, 1, "no second request before the first one has ended");

	// The server ends the drained response; Pi then sends the steering message.
	first.send(completed("resp_1"));
	await w.until(() => server.turns.length === 2, "the second request");
	const next = server.turns[1].frame;
	assert.equal(next.previous_response_id, "resp_1");
	assert.match(JSON.stringify(next.input), /use the smaller patch/);
	assert.equal(first.frames.filter((frame) => frame.type === "response.interrupt").length, 1, "one interrupt for the one steering message");
	first.send(...whole("resp_2", "smaller patch written"));
	await w.settle();
	w.see("smaller patch written");
	assert.deepEqual([w.networkAttempts, onlyGit(w)], [[], []]);
});

it("the startup prewarm goes once, and the first turn reuses its socket", async (t) => {
	const w = await wireWorld(t);
	const server = codexServer(true, false);
	await useCodex(w);
	await w.until(() => server.prewarms.length === 1, "the startup prewarm");
	assert.equal(server.connections.length, 1);
	assert.match(server.connections[0].url, /^wss:\/\/chatgpt\.com\/backend-api\/codex\/responses/);
	assert.equal(server.prewarms[0].type, "response.create");

	w.type("hi");
	w.press(keys.enter);
	await w.until(() => w.session.isStreaming, "the first turn starts");
	assert.equal(server.turns.length, 0, "the turn waits for the prewarm");
	server.connections[0].send(created("warm-1"), completed("warm-1"));
	await w.until(() => server.turns.length === 1, "the first request");
	assert.equal(server.turns[0].connection, server.connections[0], "the prewarmed socket carries the first request");
	server.turns[0].connection.send(...whole("resp_1", "hello"));
	await w.settle();
	w.see("hello");
	assert.equal(server.prewarms.length, 1);
	assert.deepEqual([w.networkAttempts, onlyGit(w)], [[], []]);
});

it("routes the initial Codex prewarm before the world starts, also after restart", async (t) => {
	const server = codexServer(false);
	const routes = networkRoutes();
	routes.ws((options) => options.host === "chatgpt.com" && options.path.startsWith("/backend-api/codex/responses"), server.request);
	const credentials: NonNullable<WorldOptions["credentials"]> = {};
	const w = await wireWorld(t, { routes, credentials });
	await useCodex(w);
	await w.until(() => server.prewarms.length === 1, "model change prewarm");
	assert.equal(server.connections.length, 1);
	assert.equal(server.prewarms[0].generate, false);
	assert.deepEqual(w.networkAttempts, []);
	w.type("hi");
	w.press(keys.enter);
	await w.until(() => server.turns.length === 1, "first turn");
	server.turns[0].connection.send(...whole("first", "hello"));
	await w.settle();

	credentials.anthropic = { type: "api_key", key: "" };
	const restarted = await restartWire(t, w);
	assert.equal(restarted.session.model?.provider, "openai-codex");
	await restarted.until(() => server.prewarms.length === 2, "startup prewarm");
	assert.equal(server.connections.filter((connection) => connection.frames.some((frame) => frame.generate === false)).length, 2);
	assert.deepEqual(restarted.networkAttempts, []);
});

// The world blocks the network from the start of a build when no route is configured:
// the blocked attempt is the proof that the session's start opened exactly one WebSocket for its prewarm.
it("a session that starts on Codex opens one WebSocket for the prewarm, and a failed warm leaves the turn to connect itself", async (t) => {
	const credentials: NonNullable<WorldOptions["credentials"]> = {};
	const w = await wireWorld(t, { credentials });
	const first = codexServer();
	await useCodex(w);
	await w.until(() => first.prewarms.length === 1, "the prewarm after the model choice");
	w.type("hi");
	w.press(keys.enter);
	await w.until(() => first.turns.length === 1, "the first request");
	first.turns[0].connection.send(...whole("resp_1", "hello"));
	await w.settle();

	credentials.anthropic = { type: "api_key", key: "" };
	const restarted = await restartWire(t, w);
	assert.equal(restarted.session.model?.id, "gpt-6.1-terra");
	assert.deepEqual(restarted.networkAttempts, ["https.request"], "one connect at start, blocked because no route exists yet");
	const server = codexServer();
	restarted.type("again");
	restarted.press(keys.enter);
	await restarted.until(() => server.turns.length === 1, "the request after the restart");
	assert.deepEqual(server.prewarms, [], "the failed start is not warmed a second time");
	server.turns[0].connection.send(...whole("resp_2", "hello again"));
	await restarted.settle();
	restarted.see("hello again");
	assert.deepEqual(restarted.networkAttempts, ["https.request"]);
});
