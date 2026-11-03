import { Agent as HttpAgent, request as httpRequest } from "node:http";
import type { Agent } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";
import type { ConnectionTransport } from "puppeteer-core";
import WebSocket from "ws";
import { proxyFromEnv, tunnelAgent } from "./proxy-env.ts";

const CONNECT_TIMEOUT_MS = 15_000;
const MAX_PAYLOAD_BYTES = 256 * 1024 * 1024;

function isSecure(target: URL): boolean {
	return target.protocol === "https:" || target.protocol === "wss:";
}

function isLoopback(target: URL): boolean {
	return target.hostname === "localhost" || target.hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(target.hostname);
}

// Environment proxy for a CDP target; none for loopback and for hosts NO_PROXY names. The resolver knows secure
// targets only, so a plain target is looked up as the https target of the same host and port.
function proxyFor(target: URL): string | undefined {
	if (isLoopback(target)) return undefined;
	const lookup = isSecure(target) ? target : new URL(`https://${target.hostname}:${target.port || "80"}`);
	return proxyFromEnv(lookup, process.env);
}

// CONNECT tunnel to a plain target; the resolver's agent wraps its tunnel in TLS.
function plainTunnelAgent(proxy: string, target: URL, signal: AbortSignal): Agent {
	const proxyUrl = new URL(proxy);
	const secureProxy = proxyUrl.protocol === "https:";
	const authority = `${target.hostname}:${target.port || 80}`;
	const headers: Record<string, string> = { Host: authority };
	if (proxyUrl.username) {
		const login = `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`;
		headers["Proxy-Authorization"] = `Basic ${Buffer.from(login).toString("base64")}`;
	}
	const create = (_options: unknown, callback: (error: Error | null, socket?: Duplex) => void): void => {
		const request = (secureProxy ? httpsRequest : httpRequest)({
			host: proxyUrl.hostname, port: proxyUrl.port || (secureProxy ? 443 : 80), method: "CONNECT", path: authority, headers, signal, timeout: CONNECT_TIMEOUT_MS,
		});
		request.on("timeout", () => request.destroy(new Error("proxy CONNECT timed out")));
		request.on("connect", (response, socket) => {
			if (response.statusCode !== 200) {
				socket.destroy();
				callback(new Error(`proxy CONNECT rejected with HTTP ${response.statusCode}`));
				return;
			}
			callback(null, socket);
		});
		request.on("error", callback);
		request.end();
	};
	const agent = new HttpAgent({ keepAlive: false });
	(agent as unknown as { createConnection: typeof create }).createConnection = create;
	return agent;
}

function agentFor(proxy: string, target: URL, signal: AbortSignal): Agent {
	return isSecure(target) ? tunnelAgent(proxy, target, CONNECT_TIMEOUT_MS, signal) : plainTunnelAgent(proxy, target, signal);
}

// The same lookup puppeteer makes for `browserURL`, but through the proxy when one applies.
async function webSocketUrl(browserUrl: URL, proxy: string, signal: AbortSignal): Promise<string> {
	const url = new URL(browserUrl);
	url.pathname = `${url.pathname.replace(/\/?$/, "")}/json/version`;
	url.hash = "";
	try {
		const body = await new Promise<string>((resolve, reject) => {
			const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, { signal, agent: agentFor(proxy, url, signal) }, response => {
				if (response.statusCode !== 200) {
					response.resume();
					reject(new Error(`HTTP ${response.statusCode}`));
					return;
				}
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
				response.on("error", reject);
			});
			request.on("error", reject);
			request.end();
		});
		const endpoint = (JSON.parse(body) as { webSocketDebuggerUrl?: unknown }).webSocketDebuggerUrl;
		if (typeof endpoint !== "string") throw new Error("no webSocketDebuggerUrl");
		return endpoint;
	} catch (error) {
		throw new Error(`Failed to fetch browser webSocket URL from ${url.href}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
}

/**
 * A Puppeteer transport for a remote `app.cdp_url` that goes through the environment proxy, or undefined when none
 * applies (loopback, NO_PROXY, no proxy set) and Puppeteer's own connection is right. Puppeteer's WebSocket takes no
 * agent, so the lookup and the socket are opened here.
 */
export async function proxiedCdpTransport(endpoint: string, signal: AbortSignal): Promise<ConnectionTransport | undefined> {
	const given = new URL(endpoint);
	const givenProxy = proxyFor(given);
	if (!givenProxy) return undefined;
	const url = given.protocol === "http:" || given.protocol === "https:" ? new URL(await webSocketUrl(given, givenProxy, signal)) : given;
	const proxy = proxyFor(url);
	const socket = new WebSocket(url.href, [], {
		// ws would reuse the tunnel of the first address for a redirect target, so a proxied socket does not follow redirects.
		followRedirects: !proxy,
		perMessageDeflate: false,
		allowSynchronousEvents: false,
		maxPayload: MAX_PAYLOAD_BYTES,
		...(proxy ? { proxy, agent: agentFor(proxy, url, signal) } : {}),
	});
	// Like Puppeteer's own transport, errors are not acted on here: before the open they reject below, and ws emits one
	// after an abort's terminate, which must not go unhandled. After the open the close event follows.
	socket.on("error", () => {});
	await new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			signal.removeEventListener("abort", aborted);
			socket.off("open", opened);
			socket.off("error", failed);
		};
		const opened = () => { cleanup(); resolve(); };
		const failed = (error: Error) => { cleanup(); reject(error); };
		const aborted = () => { cleanup(); socket.terminate(); reject(signal.reason); };
		socket.once("open", opened);
		socket.once("error", failed);
		signal.addEventListener("abort", aborted, { once: true });
		if (signal.aborted) aborted();
	});
	const transport: ConnectionTransport = { send: message => socket.send(message), close: () => socket.close() };
	socket.on("message", data => transport.onmessage?.(data.toString()));
	socket.on("close", () => transport.onclose?.());
	return transport;
}
