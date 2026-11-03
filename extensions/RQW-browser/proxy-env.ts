// Source: extensions/RQW-web/vendor/websocket.ts @ 7a2d08975696712b4ed181d8c3742fad7df5025b (copied verbatim).
// Environment proxy resolver and CONNECT tunnel agent for the ws package, which never reads proxy variables.
import { request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { connect as tlsConnect } from "node:tls";
import type { Duplex } from "node:stream";

function abortError(): Error {
	return new DOMException("websocket aborted by caller", "AbortError");
}

// True when NO_PROXY names the target: a host or parent domain, with an optional port ("*" names everything; a leading
// dot or "*." is ignored).
function bypassesProxy(target: URL, noProxy: string | undefined): boolean {
	const port = target.port || "443";
	for (const item of (noProxy ?? "").split(",")) {
		const [, name = "", entryPort] = /^(.*?)(?::(\d+))?$/.exec(item.trim().toLowerCase()) ?? [];
		const host = name.replace(/^\*?\./, "");
		if (host === "*") return true;
		if (entryPort && entryPort !== port) continue;
		if (host && (target.hostname === host || target.hostname.endsWith(`.${host}`))) return true;
	}
	return false;
}

// Proxy URL for a secure target (wss, or https that ws upgrades) from the variables Pi's tab gets (PCLI exports
// HTTPS_PROXY, HTTP_PROXY, ALL_PROXY, NO_PROXY).
function proxyFromEnv(target: URL, env: NodeJS.ProcessEnv): string | undefined {
	if ((target.protocol !== "wss:" && target.protocol !== "https:") || bypassesProxy(target, env.NO_PROXY || env.no_proxy)) return undefined;
	return env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy || undefined;
}

export { bypassesProxy, proxyFromEnv };

// Agent for Node's ws: opens a CONNECT tunnel through the proxy and wraps it in verified TLS.
export function tunnelAgent(proxy: string, target: URL, timeoutMs: number, signal: AbortSignal): HttpsAgent {
	const proxyUrl = new URL(proxy);
	const secureProxy = proxyUrl.protocol === "https:";
	const authority = `${target.hostname}:${target.port || 443}`;
	const headers: Record<string, string> = { Host: authority };
	if (proxyUrl.username) {
		const login = `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`;
		headers["Proxy-Authorization"] = `Basic ${Buffer.from(login).toString("base64")}`;
	}
	const create = (_options: unknown, callback: (error: Error | null, socket?: Duplex) => void): void => {
		const request = (secureProxy ? httpsRequest : httpRequest)({
			host: proxyUrl.hostname, port: proxyUrl.port || (secureProxy ? 443 : 80), method: "CONNECT", path: authority, headers,
		});
		// A proxy that is unreachable or never answers CONNECT is cut at the connect timeout or on abort, so no request is
		// left open. A plain timer, because the request's own timeout starts only once its socket is connected.
		const timer = setTimeout(() => request.destroy(new Error("proxy CONNECT timed out")), timeoutMs);
		const onAbort = () => request.destroy(abortError());
		signal.addEventListener("abort", onAbort, { once: true });
		request.on("close", () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
		});
		request.on("connect", (response, socket) => {
			clearTimeout(timer);
			if (response.statusCode !== 200) {
				socket.destroy();
				callback(new Error(`proxy CONNECT rejected with HTTP ${response.statusCode}`));
				return;
			}
			callback(null, tlsConnect({ socket, servername: target.hostname }));
		});
		request.on("error", callback);
		request.end();
	};
	const agent = new HttpsAgent({ keepAlive: false });
	(agent as unknown as { createConnection: typeof create }).createConnection = create;
	return agent;
}
