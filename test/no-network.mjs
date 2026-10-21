// Test-only preload. Install before importing Pi so providers cannot capture a live transport.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

export const networkAttempts = [];
const block = (transport) => function () {
	// Do not print arguments: they can contain inherited credentials.
	const message = `Isolation network blocked: ${transport}`;
	networkAttempts.push(message);
	console.error(message);
	throw new Error(message);
};
globalThis.fetch = block("fetch");
http.request = block("http.request");
http.get = block("http.get");
https.request = block("https.request");
https.get = block("https.get");
net.Socket.prototype.connect = block("net.Socket.connect");
tls.connect = block("tls.connect");
syncBuiltinESMExports();
// Pi may turn a transport error into an assistant message. Even then the child must fail.
process.on("exit", () => {
	if (networkAttempts.length) process.exitCode = 1;
});
