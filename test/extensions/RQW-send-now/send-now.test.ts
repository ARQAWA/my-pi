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

it("re-enables bracketed paste after a tool in TUI mode only", (t) => {
	const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
	sendNow({ on: (name: string, handler: any) => { handlers.set(name, [...(handlers.get(name) ?? []), handler]); } } as unknown as ExtensionAPI);
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

/** Pi's input path in miniature: each sequence goes through the terminal-input listener, then to a real input editor. */
function pasteHarness(t: import("node:test").TestContext) {
	t.mock.timers.enable({ apis: ["Date"] });
	const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
	sendNow({ on: (name: string, handler: any) => { handlers.set(name, [...(handlers.get(name) ?? []), handler]); } } as unknown as ExtensionAPI);
	const editor = new CustomEditor({ requestRender() {} } as any, { borderColor: (s: string) => s, selectList: {} } as any, { matches: () => false } as any);
	const submitted: string[] = [];
	editor.onSubmit = (text) => { submitted.push(text); editor.setText(""); };
	let focus: unknown = editor;
	let input: ((data: string) => { consume?: boolean; data?: string } | undefined) | undefined;
	const ctx = {
		mode: "tui", hasPendingMessages: () => false, isIdle: () => true, sessionManager: { getEntries: () => [] },
		ui: {
			setWidget: (_key: string, factory: any) => { if (factory) factory({ getFocusedComponent: () => focus }); },
			onTerminalInput: (handler: typeof input) => { input = handler; return () => {}; },
		},
	} as unknown as ExtensionContext;
	for (const handler of handlers.get("session_start")!) handler({}, ctx);
	const feed = (data: string) => {
		const result = input!(data);
		if (!result?.consume) editor.handleInput(result?.data ?? data);
	};
	return { editor, submitted, feed, tick: (ms: number) => t.mock.timers.tick(ms), setFocus: (value: unknown) => { focus = value; } };
}

it("an unbracketed multi-line burst lands in the editor as one paste and submits nothing", (t) => {
	const { editor, submitted, feed, tick } = pasteHarness(t);
	for (const piece of "line one\r\rline two\r\nend") feed(piece); // the CRLF is one line break
	assert.equal(editor.getText(), "line one\n\nline two\nend");
	feed("\r");
	tick(1000);
	feed("\n"); // a late \n is not a CRLF tail
	assert.equal(editor.getText(), "line one\n\nline two\nend\n\n");
	assert.deepEqual(submitted, []);
});

it("a burst split across stdin chunks stays one paste, but a lone Enter after a pause submits", (t) => {
	const { editor, submitted, feed, tick } = pasteHarness(t);
	for (const piece of "first line") feed(piece);
	tick(5); // next chunk of the same paste begins with the line break
	feed("\r");
	for (const piece of "second") feed(piece);
	assert.equal(editor.getText(), "first line\nsecond");
	tick(1000);
	feed("\r");
	assert.deepEqual(submitted, ["first line\nsecond"]);
});

it("text typed while another component has focus does not turn a later Enter into a paste", (t) => {
	const { editor, submitted, feed, setFocus } = pasteHarness(t);
	setFocus({});
	for (const piece of "abc") feed(piece);
	setFocus(editor);
	editor.setText("hello");
	feed("\r");
	assert.deepEqual(submitted, ["hello"]);
});

it("a single typed Enter still submits", (t) => {
	const { editor, submitted, feed } = pasteHarness(t);
	editor.setText("hello");
	feed("\r");
	assert.deepEqual(submitted, ["hello"]);
});

it("a bracketed paste is unchanged", (t) => {
	const { editor, submitted, feed } = pasteHarness(t);
	feed("\x1b[200~a\nb\rc\x1b[201~");
	assert.equal(editor.getText(), "a\nb\nc");
	assert.deepEqual(submitted, []);
});
