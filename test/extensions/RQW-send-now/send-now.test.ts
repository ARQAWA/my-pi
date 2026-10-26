import assert from "node:assert/strict";
import { it } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import sendNow, { keptReply } from "../../../extensions/RQW-send-now/index.ts";

it("empty Enter force-sends queued steering with a fake clock", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
	const sent: string[] = [];
	const pi = {
		on: (name: string, handler: any) => { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
		sendUserMessage: (text: string) => sent.push(text), appendEntry() {},
	};
	sendNow(pi as unknown as ExtensionAPI);
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
	for (const handler of handlers.get("session_start")!) handler({}, ctx);
	for (const handler of handlers.get("input")!) handler({ streamingBehavior: "steer" }, ctx);
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
