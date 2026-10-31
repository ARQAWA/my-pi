import assert from "node:assert/strict";
import { it } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import sendNow, { keptReply } from "../../../extensions/RQW-send-now/index.ts";

it("keptReply preserves only interrupted text as a finished reply", () => {
	const message = { role: "assistant", content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "half" }],
		stopReason: "aborted", errorMessage: "aborted", timestamp: 1 } as unknown as AssistantMessage;
	const kept = keptReply(message)!;
	assert.deepEqual(kept.content, [{ type: "text", text: "half" }]);
	assert.equal(kept.stopReason, "stop");
	assert.equal(keptReply({ ...message, content: [{ type: "thinking", thinking: "x" }] } as AssistantMessage), undefined);
});

it("re-enables bracketed paste after a tool in TUI mode only", (t) => {
	const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
	sendNow({ on: (name: string, handler: any) => { handlers.set(name, [...(handlers.get(name) ?? []), handler]); } } as unknown as ExtensionAPI);
	t.after(() => { for (const handler of handlers.get("session_shutdown")!) handler({}, {}); });
	const writes: string[] = [];
	t.mock.method(process.stdout, "write", (chunk: string) => { writes.push(String(chunk)); return true; });
	const tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
	Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
	t.after(() => {
		if (tty) Object.defineProperty(process.stdout, "isTTY", tty);
		else delete (process.stdout as { isTTY?: boolean }).isTTY;
	});
	const fire = (mode: string) => { for (const handler of handlers.get("tool_execution_end")!) handler({}, { mode }); };
	fire("tui");
	assert.deepEqual(writes, ["\x1b[?2004h"]);
	writes.length = 0;
	fire("print");
	fire("rpc");
	assert.deepEqual(writes, []);
});
