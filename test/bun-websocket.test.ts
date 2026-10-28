import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { connect as connectCodex } from "../extensions/RQW-codex/websocket.ts";
import { connect as connectWeb } from "../extensions/RQW-web/vendor/websocket.ts";

test("both websocket transports connect without unsupported Bun handshake events", async () => {
	class FakeWebSocket extends EventEmitter {
		readyState = 1;
		extensions = "";
		constructor() {
			super();
			queueMicrotask(() => {
				this.emit("upgrade", { statusCode: 101, headers: {} });
				this.emit("open");
			});
		}
		on(event: string, listener: (...args: any[]) => void) {
			if (process.versions.bun && ["upgrade", "unexpected-response"].includes(event)) {
				throw new Error("unsupported Bun event: " + event);
			}
			return super.on(event, listener);
		}
		send(_data: string, callback: (error?: Error) => void) { callback(); }
		close() { this.emit("close"); }
		terminate() {}
	}
	const original = Object.getOwnPropertyDescriptor(process.versions, "bun");
	try {
		for (const bun of [undefined, "test"]) {
			Object.defineProperty(process.versions, "bun", { value: bun, configurable: true });
			for (const connect of [connectCodex, connectWeb]) {
				let status: number | undefined;
				const socket = await connect({
					url: "wss://chatgpt.com/backend-api/codex/responses",
					headers: {}, signal: new AbortController().signal,
					onResponse(response) { status = response.status; },
				}, FakeWebSocket);
				assert.equal(socket.isOpen, true);
				assert.equal(status, bun ? undefined : 101);
				await socket.close();
			}
		}
	} finally {
		if (original) Object.defineProperty(process.versions, "bun", original);
		else delete process.versions.bun;
	}
});
