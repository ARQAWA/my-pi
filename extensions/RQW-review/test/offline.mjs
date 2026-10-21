// Test-only preload, installed before Pi. The full suite may explicitly allow its numeric-loopback HTTP fixture.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

export const networkAttempts = [];
const loopback = process.env.PI_REVIEW_TEST_LOOPBACK === "1";
const block = transport => {
	// Never log arguments, which may contain inherited credentials.
	const message = `Isolation network blocked: ${transport}`;
	networkAttempts.push(message);
	console.error(message);
	throw new Error(message);
};
const localUrl = input => {
	try {
		const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
		return url.protocol === "http:" && url.hostname === "127.0.0.1";
	} catch { return false; }
};
const fetch = globalThis.fetch;
globalThis.fetch = function (...args) {
	if (loopback && localUrl(args[0])) return fetch.apply(this, args);
	return block("fetch");
};
for (const method of ["request", "get"]) {
	const original = http[method];
	http[method] = function (...args) {
		const input = args[0];
		const local = localUrl(input) || (input && (input.hostname ?? input.host) === "127.0.0.1" && !input.socketPath);
		if (loopback && local) return original.apply(this, args);
		return block(`http.${method}`);
	};
	https[method] = () => block(`https.${method}`);
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
	const first = Array.isArray(args[0]) ? args[0][0] : args[0];
	const host = typeof first === "object" && first ? first.host : args[1];
	if (loopback && host === "127.0.0.1" && !first?.path) return connect.apply(this, args);
	return block("net.Socket.connect");
};
tls.connect = () => block("tls.connect");
syncBuiltinESMExports();
// Pi can swallow a transport failure into an assistant message. Such attempts still fail the test process.
process.on("exit", () => {
	if (networkAttempts.length) process.exitCode = 1;
});
