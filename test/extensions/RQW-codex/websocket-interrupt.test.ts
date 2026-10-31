import assert from "node:assert/strict";
import { it } from "node:test";
import { connect } from "../../../extensions/RQW-codex/websocket.ts";

/** Minimal ws double: opens right after connect installed its listeners; records every frame sent. */
class FakeWs {
	static last: FakeWs;
	readyState = 0;
	extensions = "";
	sent: any[] = [];
	private handlers = new Map<string, Array<(...args: any[]) => void>>();
	constructor() {
		FakeWs.last = this;
		queueMicrotask(() => {
			this.readyState = 1;
			this.emit("open");
		});
	}
	on(event: string, listener: (...args: any[]) => void) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener]); }
	once(event: string, listener: (...args: any[]) => void) { this.on(event, listener); }
	emit(event: string, ...args: any[]) { for (const listener of this.handlers.get(event) ?? []) listener(...args); }
	send(data: string, callback: (error?: Error) => void) { this.sent.push(JSON.parse(data)); callback(); }
	close() { this.readyState = 3; this.emit("close"); }
	terminate() { this.readyState = 3; }
	frame(value: unknown) { this.emit("message", JSON.stringify(value), false); }
}

const open = () => connect({ url: "wss://chatgpt.com/backend-api/codex/responses", headers: {}, signal: new AbortController().signal, onResponse: () => undefined }, FakeWs as never);

it("a Drain after the terminal event reached the socket sends nothing and leaves nothing pending", { timeout: 3000 }, async () => {
	const socket = await open();
	const ws = FakeWs.last;
	await socket.send({ type: "response.create" });
	ws.frame({ type: "response.created", response: { id: "r1" } });
	ws.frame({ type: "response.completed", response: { id: "r1" } });
	// The terminal event is on the socket but not read yet: the response is over.
	assert.deepEqual(await socket.interrupt("r1", { mode: "drain" }), { acknowledged: false, completed: false });
	assert.equal(ws.sent.length, 1, "no response.interrupt frame");

	// The next response on the same socket is drained normally: no stale interruption blocks it.
	await socket.send({ type: "response.create" });
	ws.frame({ type: "response.created", response: { id: "r2" } });
	const drained = socket.interrupt("r2", { mode: "drain" });
	assert.deepEqual(ws.sent.at(-1), { type: "response.interrupt", response_id: "r2", mode: "discard_partial_items" });
	ws.frame({ type: "response.completed", response: { id: "r2" } });
	assert.deepEqual(await drained, { acknowledged: false, completed: true });
	await socket.close();
});
