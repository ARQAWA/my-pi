// Loaded before the SDK, including in CLI children. Never use owner credentials or the network.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "rqw-prompt-offline-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.PI_CODING_AGENT_DIR = join(home, "agent");
process.env.PI_OFFLINE = "1";
process.env.PI_SKIP_VERSION_CHECK = "1";
globalThis.promptNetworkAttempts = [];
const blocked = name => () => {
	globalThis.promptNetworkAttempts.push(name);
	throw new Error(`PROMPT_NETWORK_BLOCKED: ${name}`);
};
globalThis.fetch = blocked("fetch");
http.request = blocked("http.request");
http.get = blocked("http.get");
https.request = blocked("https.request");
https.get = blocked("https.get");
net.connect = blocked("net.connect");
net.createConnection = blocked("net.createConnection");
net.Socket.prototype.connect = blocked("Socket.connect");
tls.connect = blocked("tls.connect");
syncBuiltinESMExports();
process.on("exit", () => {
	rmSync(home, { recursive: true, force: true });
	if (globalThis.promptNetworkAttempts.length) {
		console.error("PROMPT_NETWORK_ATTEMPTS", globalThis.promptNetworkAttempts);
		process.exitCode = 1;
	}
});
