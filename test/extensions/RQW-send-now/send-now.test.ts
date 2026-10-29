import assert from "node:assert/strict";
import { it } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AgentSession, CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import sendNow, { keptReply } from "../../../extensions/RQW-send-now/index.ts";

it("empty Enter force-sends queued steering with a fake clock", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
	const sent: string[] = [];
	const pi = {
		on: (name: string, handler: any) => { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
		sendUserMessage: (text: string) => sent.push(text), appendEntry() {},
	};
	t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function() {});
	sendNow(pi as unknown as ExtensionAPI);
	t.after(() => { for (const handler of handlers.get("session_shutdown")!) handler({}, ctx); });
	let editor = "";
	let idle = false;
	let queued = true;
	let input: ((data: string) => unknown) | undefined;
	const focused = Object.create(CustomEditor.prototype);
	const ctx = {
		mode: "tui", model: {}, sessionManager: { getEntries: () => [] },
		hasPendingMessages: () => queued, isIdle: () => idle,
		abort: () => { idle = true; queued = false; editor = "steer me"; },
		ui: {
			getEditorText: () => editor, setEditorText: (value: string) => { editor = value; }, notify() {},
			setWidget: (_key: string, factory: any) => { if (factory) factory({ getFocusedComponent: () => focused }); },
			onTerminalInput: (handler: typeof input) => { input = handler; return () => {}; },
		},
	} as unknown as ExtensionContext;
	const session = Object.create(AgentSession.prototype);
	session.sessionManager = ctx.sessionManager;
	session.getSteeringMessages = () => ["steer me"];
	session._bindExtensionCore();
	for (const handler of handlers.get("session_start")!) handler({}, ctx);
	assert.deepEqual(input!("\r"), { consume: true });
	t.mock.timers.tick(0);
	assert.deepEqual(sent, ["steer me"]);
	assert.equal(editor, "");
});

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
