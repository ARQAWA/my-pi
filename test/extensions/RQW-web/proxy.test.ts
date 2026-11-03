import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, it } from "node:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { researchTarget } from "../../../extensions/RQW-web/core/web-engine.ts";
import { SocketError, connect } from "../../../extensions/RQW-web/vendor/websocket.ts";

const PROXY_NAMES = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"];
const saved = Object.fromEntries(PROXY_NAMES.map((name) => [name, process.env[name]]));

function setProxyEnv(values: Record<string, string>): void {
	for (const name of PROXY_NAMES) delete process.env[name];
	Object.assign(process.env, values);
}

afterEach(() => {
	for (const name of PROXY_NAMES) {
		if (saved[name] === undefined) delete process.env[name];
		else process.env[name] = saved[name];
	}
});

// Records the options the connector hands to the ws package, then opens at once.
async function wsOptionsFor(url: string): Promise<Record<string, unknown>> {
	let given: Record<string, unknown> = {};
	class FakeWebSocket extends EventEmitter {
		readyState = 1;
		extensions = "";
		constructor(_url: string, options: Record<string, unknown>) {
			super();
			given = options;
			queueMicrotask(() => {
				this.emit("upgrade", { statusCode: 101, headers: {} });
				this.emit("open");
			});
		}
		send(_data: string, callback: (error?: Error) => void) { callback(); }
		close() { this.emit("close"); }
		terminate() {}
	}
	const socket = await connect({ url, headers: {}, signal: new AbortController().signal, onResponse() {} }, FakeWebSocket);
	await socket.close();
	return given;
}

it("sends the websocket through the proxy named by the environment", async () => {
	setProxyEnv({ HTTPS_PROXY: "http://127.0.0.1:8317" });
	const options = await wsOptionsFor("wss://chatgpt.com/backend-api/codex/responses");
	assert.equal(options.proxy, "http://127.0.0.1:8317");
	assert.ok(options.agent);
});

it("opens the real connection as a CONNECT request to the proxy", async () => {
	const requested: string[] = [];
	const proxy = createServer();
	proxy.on("connect", (request, socket) => {
		requested.push(`${request.url} Proxy-Authorization: ${request.headers["proxy-authorization"]}`);
		socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
	});
	await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
	try {
		setProxyEnv({ HTTPS_PROXY: `http://user:pa%20ss@127.0.0.1:${(proxy.address() as AddressInfo).port}` });
		await assert.rejects(connect({
			url: "https://chatgpt.com/backend-api/codex/responses", headers: {}, signal: new AbortController().signal, onResponse() {},
		}), SocketError);
		assert.deepEqual(requested, [`chatgpt.com:443 Proxy-Authorization: Basic ${Buffer.from("user:pa ss").toString("base64")}`]);
	} finally {
		proxy.close();
	}
});

it("closes the CONNECT request when the caller aborts while the proxy is silent", async () => {
	const proxy = createServer();
	const controller = new AbortController();
	const closed = new Promise<void>((resolve) => proxy.on("connect", (_request, socket) => {
		socket.resume();
		socket.on("end", () => resolve());
		controller.abort();
	}));
	await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
	try {
		setProxyEnv({ HTTPS_PROXY: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}` });
		await assert.rejects(connect({
			url: "https://chatgpt.com/backend-api/codex/responses", headers: {}, signal: controller.signal, onResponse() {},
		}), { name: "AbortError" });
		await closed;
	} finally {
		proxy.close();
		proxy.closeAllConnections();
	}
});

it("falls back to HTTP_PROXY and ALL_PROXY and honors NO_PROXY", async () => {
	setProxyEnv({ HTTP_PROXY: "http://127.0.0.1:8317" });
	assert.equal((await wsOptionsFor("wss://chatgpt.com/backend-api/codex/responses")).proxy, "http://127.0.0.1:8317");
	setProxyEnv({ ALL_PROXY: "http://127.0.0.1:8317" });
	assert.equal((await wsOptionsFor("wss://chatgpt.com/backend-api/codex/responses")).proxy, "http://127.0.0.1:8317");
	setProxyEnv({ ALL_PROXY: "http://127.0.0.1:8317", NO_PROXY: "localhost,.chatgpt.com" });
	const options = await wsOptionsFor("wss://chatgpt.com/backend-api/codex/responses");
	assert.equal(options.proxy, undefined);
	assert.equal(options.agent, undefined);
	setProxyEnv({ ALL_PROXY: "http://127.0.0.1:8317", NO_PROXY: "chatgpt.com:443" });
	assert.equal((await wsOptionsFor("wss://chatgpt.com/backend-api/codex/responses")).proxy, undefined);
	setProxyEnv({ ALL_PROXY: "http://127.0.0.1:8317", NO_PROXY: "chatgpt.com:8443" });
	assert.equal((await wsOptionsFor("wss://chatgpt.com/backend-api/codex/responses")).proxy, "http://127.0.0.1:8317");
});

it("connects directly when no proxy is set", async () => {
	setProxyEnv({});
	const options = await wsOptionsFor("wss://chatgpt.com/backend-api/codex/responses");
	assert.equal(options.proxy, undefined);
	assert.equal(options.agent, undefined);
});

it("reports a proxy that refuses the tunnel as connection_failed, not request_failed", async () => {
	const proxy = createServer();
	proxy.on("connect", (_request, socket) => { socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); });
	await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
	try {
		setProxyEnv({ HTTPS_PROXY: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}` });
		const credentialStore = new InMemoryCredentialStore();
		await credentialStore.modify("openai-codex", async () => ({
			type: "oauth", access: "fake-access", refresh: "fake-refresh", expires: Number.MAX_SAFE_INTEGER, accountId: "fake-owner",
		}));
		const result = await researchTarget({
			target: { kind: "query", value: "Pi documentation" }, model: "gpt-6-luna", effort: "medium", credentialStore,
		});
		assert.equal(result.status, "error");
		assert.equal(result.error?.code, "connection_failed");
	} finally {
		proxy.close();
		proxy.closeAllConnections();
	}
});
