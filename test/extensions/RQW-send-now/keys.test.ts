import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSession, CustomEditor, createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import sendNow from "../../../extensions/RQW-send-now/index.ts";

test("Enter queues and Alt+Enter steers while the agent works", t => {
	t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function() {});
	const hooks = new Map<string, ((event: any, ctx: any) => void)[]>();
	let key: (data: string) => unknown = () => undefined;
	const actions: string[] = [];
	const editor = Object.assign(Object.create(CustomEditor.prototype), {
		actionHandlers: new Map([["app.message.followUp", () => actions.push("follow-up")]]),
		handleInput: (data: string) => actions.push(data === "\r" ? "steer" : data),
		isShowingAutocomplete: () => false,
	});
	const pi: any = { on: (name: string, fn: any) => hooks.set(name, [...hooks.get(name) ?? [], fn]), sendUserMessage() {}, appendEntry() {} };
	sendNow(pi as ExtensionAPI);
	const manager = { getEntries: () => [] };
	const session: any = Object.create(AgentSession.prototype);
	session.sessionManager = manager; session.getSteeringMessages = () => []; session._bindExtensionCore();
	const ctx: any = { mode: "tui", sessionManager: manager, isIdle: () => false, hasPendingMessages: () => false,
		ui: { getEditorText: () => "hello", setWidget: (_name: string, factory: any) => { factory?.({ getFocusedComponent: () => editor }); }, onTerminalInput: (fn: typeof key) => { key = fn; return () => {}; } } };
	for (const hook of hooks.get("session_start") ?? []) hook({}, ctx);
	assert.deepEqual(key("\r"), { consume: true });
	assert.deepEqual(key("\x1b\r"), { consume: true });
	assert.deepEqual(actions, ["follow-up", "steer"]);
	for (const hook of hooks.get("session_shutdown") ?? []) hook({}, ctx);
});

test("Enter queues without starting a turn while background work is running", async t => {
	t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function() {});
	const hooks = new Map<string, ((event: any, ctx: any) => void)[]>();
	let key: (data: string) => unknown = () => undefined;
	const queued: string[] = [];
	const submitted: string[] = [];
	let text = "later";
	const events = createEventBus();
	events.on("rqw:running-counts:request", (request: any) => request.reply({ version: 1, snapshot: () => ({ agents: 1 }), subscribe: () => () => {} }));
	let canHold = false;
	events.on("rqw:followup-hold:request", (request: any) => { if (canHold && request.sessionId === "main") request.reply(); });
	const editor = Object.assign(Object.create(CustomEditor.prototype), { actionHandlers: new Map([["app.message.followUp", () => {}]]), handleInput: (data: string) => submitted.push(data), isShowingAutocomplete: () => false, getExpandedText: () => text, addToHistory() {}, setText: (value: string) => { text = value; } });
	const pi: any = { events, on: (name: string, fn: any) => hooks.set(name, [...hooks.get(name) ?? [], fn]), sendUserMessage() {}, appendEntry() {} };
	sendNow(pi as ExtensionAPI);
	const manager = { getEntries: () => [], getSessionId: () => "main" };
	const session: any = Object.create(AgentSession.prototype);
	session.sessionManager = manager; session.getSteeringMessages = () => []; session.followUp = async (value: string) => { queued.push(value); }; session._bindExtensionCore();
	const ctx: any = { mode: "tui", sessionManager: manager, isIdle: () => true, hasPendingMessages: () => false,
		ui: { getEditorText: () => text, setWidget: (_name: string, factory: any) => { factory?.({ getFocusedComponent: () => editor }); }, onTerminalInput: (fn: typeof key) => { key = fn; return () => {}; }, notify() {} } };
	for (const hook of hooks.get("session_start") ?? []) hook({}, ctx);
	assert.equal(key("\r"), undefined, "without the holding extension Pi keeps its normal submit");
	canHold = true;
	assert.deepEqual(key("\r"), { consume: true });
	await Promise.resolve();
	assert.deepEqual(queued, ["later"]);
	assert.equal(text, "");
	text = "steer now";
	assert.deepEqual(key("\x1b\r"), { consume: true });
	assert.deepEqual(submitted, ["\r"]);
	text = "during compaction";
	Object.defineProperty(session, "isCompacting", { value: true, configurable: true });
	ctx.isIdle = () => false;
	assert.deepEqual(key("\r"), { consume: true });
	await Promise.resolve();
	assert.deepEqual(queued, ["later", "during compaction"]);
	for (const hook of hooks.get("session_shutdown") ?? []) hook({}, ctx);
});
