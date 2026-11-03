import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import tls from "node:tls";
import { it, mock } from "node:test";
import { postEvents } from "../../../extensions/RQW-codex/sse.ts";
import { connect, SocketError } from "../../../extensions/RQW-codex/websocket.ts";

it("SSE posts the body and yields parsed events", async () => {
	const body = new TextEncoder().encode('{"model":"m","input":[]}');
	let request: { url: string; init: RequestInit } | undefined;
	const chunks = [
		'data: {"type":"response.cre',
		'ated"}\r\n\r\n',
		'data: {"type":"response.output_text.delta","delta":"hi"}\n\n',
		'data: {"type":"response.completed","response":{"id":"r1"}}\n\n',
	];
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
			controller.close();
		},
	});
	const events = postEvents({
		url: "https://chatgpt.com/backend-api/codex/responses",
		headers: {},
		body,
		signal: new AbortController().signal,
		onResponse: () => undefined,
		fetch: (async (url: string, init: RequestInit) => {
			request = { url, init };
			return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
		}) as never,
	});
	const types: string[] = [];
	for await (const event of events) types.push(event.value.type as string);
	assert.deepEqual(types, ["response.created", "response.output_text.delta", "response.completed"]);
	assert.equal(request?.init.method, "POST");
	assert.equal(request?.init.body, body);
});

it("routes the Codex websocket through the environment proxy and honors bypasses", async () => {
	const names = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"];
	const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	let observed: Record<string, unknown> = {};
	class CaptureSocket extends EventEmitter {
		readyState = 0;
		extensions = "";
		constructor(url: string, options: Record<string, unknown>) {
			super();
			observed = options;
			const agent = options.agent as { createConnection(options: object, callback: (error: Error | null) => void): void } | undefined;
			const open = (error?: Error | null) => {
				if (error) this.emit("error", error);
				else { this.readyState = 1; this.emit("open"); }
			};
			if (agent) {
				const target = new URL(url);
				agent.createConnection({ host: target.hostname, port: Number(target.port || 443) }, open);
			} else queueMicrotask(open);
		}
		send() {}
		close() { this.readyState = 3; this.emit("close"); }
		terminate() { this.readyState = 3; }
	}
	const capture = async (url: string) => {
		const socket = await connect({ url, headers: {}, signal: new AbortController().signal, onResponse() {} }, CaptureSocket as never);
		await socket.close();
		return observed;
	};
	let proxyAddress: unknown;
	let tunnelRequest = "";
	let destroyed = false;
	let stallTls = false;
	let tlsDestroyed = false;
	let tlsStarted: (() => void) | undefined;
	const proxySocket = new EventEmitter() as EventEmitter & { connecting: boolean; write(data: string): void; destroy(): void };
	proxySocket.connecting = false;
	proxySocket.write = (data) => {
		tunnelRequest = data;
		queueMicrotask(() => proxySocket.emit("data", Buffer.from("HTTP/1.1 200 Connection Established\r\n\r\n")));
	};
	proxySocket.destroy = () => { destroyed = true; };
	const tunnel = new EventEmitter() as EventEmitter & { destroy(): void };
	tunnel.destroy = () => { tlsDestroyed = true; };
	const connectMock = mock.method(net, "connect", ((options: unknown) => {
		proxyAddress = options;
		return proxySocket;
	}) as typeof net.connect);
	const tlsMock = mock.method(tls, "connect", (() => {
		if (stallTls) queueMicrotask(() => tlsStarted?.());
		else queueMicrotask(() => tunnel.emit("secureConnect"));
		return tunnel;
	}) as unknown as typeof tls.connect);
	try {
		for (const name of names) delete process.env[name];
		process.env.HTTPS_PROXY = "http://proxy.example:8080";
		let options = await capture("wss://chatgpt.com/backend-api/codex/responses");
		assert.equal(options.proxy, "http://proxy.example:8080");
		assert.deepEqual(proxyAddress, { host: "proxy.example", port: 8080 });
		assert.match(tunnelRequest, /^CONNECT chatgpt\.com:443 HTTP\/1\.1\r\n/);
		process.env.NO_PROXY = ".chatgpt.com";
		options = await capture("wss://chatgpt.com/backend-api/codex/responses");
		assert.equal(options.proxy, undefined);
		assert.equal(options.agent, undefined);
		delete process.env.NO_PROXY;
		options = await capture("wss://localhost:1234");
		assert.equal(options.proxy, undefined);
		assert.equal(options.agent, undefined);
		delete process.env.HTTPS_PROXY;
		process.env.all_proxy = "http://proxy.example:8081";
		options = await capture("wss://chatgpt.com/backend-api/codex/responses");
		assert.equal(options.proxy, "http://proxy.example:8081");
		assert.ok(options.agent);

		stallTls = true;
		const started = new Promise<void>((resolve) => { tlsStarted = resolve; });
		const controller = new AbortController();
		const pending = connect({ url: "wss://chatgpt.com", headers: {}, signal: controller.signal, onResponse() {} }, CaptureSocket as never);
		await started;
		controller.abort();
		await assert.rejects(pending, { name: "AbortError" });
		assert.equal(destroyed, true);
		assert.equal(tlsDestroyed, true);
	} finally {
		connectMock.mock.restore();
		tlsMock.mock.restore();
		for (const name of names) {
			if (saved[name] === undefined) delete process.env[name];
			else process.env[name] = saved[name];
		}
	}
});

// Regression: d47328d classifies the ws library's own handshake timeout as connect-timeout.
it("classifies a handshake timeout from the socket as connect-timeout", async () => {
	class TimedOutSocket {
		readyState = 0;
		extensions = "";
		constructor() {
			// Delivered after connect has installed its listeners.
			queueMicrotask(() => this.listeners.get("error")?.(new Error("Opening handshake has timed out")));
		}
		listeners = new Map<string, (...args: any[]) => void>();
		on(event: string, listener: (...args: any[]) => void) { this.listeners.set(event, listener); }
		once(event: string, listener: (...args: any[]) => void) { this.listeners.set(event, listener); }
		send() {}
		close() {}
		terminate() {}
	}
	await assert.rejects(
		connect({ url: "wss://chatgpt.com/backend-api/codex/responses", headers: {}, signal: new AbortController().signal, onResponse: () => undefined }, TimedOutSocket as never),
		(error: unknown) => error instanceof SocketError && error.kind === "connect-timeout",
	);
});
