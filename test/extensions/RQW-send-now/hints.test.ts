import assert from "node:assert/strict";
import { it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { AgentSession, CustomEditor, InteractiveMode, createEventBus, initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import sendNow from "../../../extensions/RQW-send-now/index.ts";
import { fakeSession } from "./harness.ts";

const plain = (row: string) => stripVTControlCharacters(row.replace(/\x1b_[^\x07]*\x07/g, ""));

it("offers the Esc hint for each queue and background state and never draws it in the editor", async t => {
	t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function() {});
	const events = createEventBus();
	const handlers = new Map<string, Function[]>();
	const pi = { events, registerShortcut() {}, on(name: string, fn: Function) { handlers.set(name, [...(handlers.get(name) ?? []), fn]); } } as unknown as ExtensionAPI;
	sendNow(pi);
	const state = { idle: true, background: 0, provider: "openai-codex" };
	let countChanged = () => {};
	events.on("rqw:running-counts:request", (request: any) => request.reply({ version: 1, snapshot: () => ({ agents: state.background }), subscribe(fn: () => void) { countChanged = fn; return () => {}; } }));
	const editor = new CustomEditor({ requestRender() {}, terminal: { rows: 40, columns: 80 } } as never,
		{ borderColor: (text: string) => text, selectList: {} } as never, { matches: () => false } as never);
	editor.onSubmit = () => {};
	editor.onCtrlD = () => {};
	editor.onAction("app.clear", () => {});
	editor.focused = true;
	const tui = { getFocusedComponent: () => editor, requestRender() {} };
	const manager = { getSessionId: () => "main", getEntries: () => [] };
	const session = fakeSession(manager, () => {});
	const emit = (event: object) => { for (const fn of [...session._eventListeners]) fn(event); };
	session._emitQueueUpdate = () => emit({ type: "queue_update" });
	session._bindExtensionCore();
	const listeners: Function[] = [];
	const ctx = { mode: "tui", sessionManager: manager, get model() { return { provider: state.provider }; }, isIdle: () => state.idle,
		hasPendingMessages: () => !!(session._steeringMessages.length || session._followUpMessages.length),
		ui: { theme: { fg: (_role: string, text: string) => `\x1b[90m${text}\x1b[39m`, italic: (text: string) => `\x1b[3m${text}\x1b[23m` },
			getEditorText: () => editor.getText(), setEditorText: (text: string) => editor.setText(text), notify() {},
			setWidget(_key: string, factory: any) { if (factory) factory(tui); },
			onTerminalInput(fn: Function) { listeners.push(fn); return () => { const index = listeners.indexOf(fn); if (index >= 0) listeners.splice(index, 1); }; } } };
	const fire = (name: string) => { for (const fn of handlers.get(name) ?? []) fn({}, ctx); };
	let offered: any;
	events.on("rqw:activity-hint:offer", (offer: any) => { offered = offer; });
	fire("session_start");
	t.after(() => fire("session_shutdown"));
	assert.equal(offered.sessionId, "main");
	let source: any;
	events.emit("rqw:activity-hint:request", { sessionId: "other", reply: () => assert.fail("another session") });
	events.emit("rqw:activity-hint:request", { sessionId: "main", reply: (value: unknown) => { source = value; } });
	assert.equal(source, offered.source);
	// The editor stays empty in every state; the hint is what the activity line draws.
	const row = () => {
		assert.equal(plain(editor.render(80)[1]).trim(), "");
		return source.snapshot();
	};
	assert.equal(row(), undefined);
	state.idle = false; emit({ type: "agent_start" });
	assert.equal(row(), "esc to interrupt");
	let finish!: (value: undefined) => void;
	session._runInputHandlers = () => new Promise(resolve => { finish = resolve; });
	const pending = session._queueUserInput("late", undefined, "steer", "interactive");
	assert.equal(row(), "ctrl+enter to send now");
	finish(undefined); await pending;
	assert.equal(row(), "esc to interrupt");
	session._runInputHandlers = async (text: string, images: unknown) => ({ text, images });
	session._followUpMessages.push("next"); emit({ type: "queue_update" });
	assert.equal(row(), "ctrl+enter to steer");
	await session._queueSteer("change");
	assert.equal(row(), "ctrl+enter to steer");
	emit({ type: "compaction_start" });
	assert.equal(row(), "esc to interrupt");
	emit({ type: "compaction_end" });
	emit({ type: "auto_retry_start" });
	assert.equal(row(), "esc to interrupt");
	emit({ type: "auto_retry_end" });
	state.provider = "anthropic"; emit({ type: "queue_update" });
	assert.equal(row(), "ctrl+enter to steer");
	session._steeringMessages = []; state.idle = true; state.background = 1; countChanged();
	assert.equal(row(), "esc esc to stop background");
	state.background = 0; countChanged();
	assert.equal(row(), "ctrl+enter to steer");
	let stopLateSource = () => {};
	const lateSource = { version: 1, snapshot: () => ({ backgroundProcesses: 1 }), subscribe(fn: (value: unknown) => void) { stopLateSource = () => fn(null); return () => {}; } };
	events.emit("rqw:running-counts:offer", { version: 1, source: lateSource });
	assert.equal(row(), "esc esc to stop background");
	stopLateSource();
	assert.equal(row(), "ctrl+enter to steer");
	editor.handleInput("\t"); editor.handleInput("\r");
	assert.equal(editor.getText(), "");
});

it("removes the old outside hints only while a consumer draws the Esc hints, keeping queue rows, loader and retry countdown", t => {
	initTheme();
	t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function() {});
	const events = createEventBus();
	const handlers = new Map<string, Function[]>();
	const pi = { events, registerShortcut() {}, on(name: string, fn: Function) { handlers.set(name, [...(handlers.get(name) ?? []), fn]); } } as unknown as ExtensionAPI;
	sendNow(pi);
	const manager = { getSessionId: () => "main", getEntries: () => [] };
	const session = fakeSession(manager, () => {});
	session._bindExtensionCore();
	session._followUpMessages.push("read the result");
	const statuses = new Map<string, string | undefined>();
	const editor = new CustomEditor({ requestRender() {}, terminal: { rows: 40, columns: 80 } } as never,
		{ borderColor: (text: string) => text, selectList: {} } as never, { matches: () => false } as never);
	editor.onSubmit = () => {}; editor.onCtrlD = () => {}; editor.onAction("app.clear", () => {});
	let focused: unknown = {};
	let input: (data: string) => unknown = () => undefined;
	const tui = { getFocusedComponent: () => focused, requestRender() {} };
	const host: any = Object.create(InteractiveMode.prototype);
	Object.assign(host, { runtimeHost: { session }, editor, compactionQueuedMessages: [], pendingMessagesContainer: new Container(), statusContainer: new Container(),
		extensionWidgetsAbove: new Map(), extensionWidgetsBelow: new Map(), ui: tui,
		footerDataProvider: { setExtensionStatus: (key: string, value: string | undefined) => statuses.set(key, value) },
		getAppKeyDisplay: () => "alt+up", renderWidgets() {}, setEditorWorkingStatusIndicator: () => false });
	host.setExtensionWidget("rqw-statusbar-activity", () => ({ render: () => [" Retrying 1/3 in 5s · esc to cancel"], invalidate() {} }));
	const ctx = { mode: "tui", sessionManager: manager, model: { provider: "openai-codex" }, isIdle: () => false, hasPendingMessages: () => true,
		ui: { theme: { fg: (_role: string, text: string) => text, italic: (text: string) => text },
			setWidget: (key: string, factory: unknown, options: unknown) => host.setExtensionWidget(key, factory, options),
			onTerminalInput(fn: (data: string) => unknown) { input = fn; return () => {}; }, getEditorText: () => "", setEditorText() {}, notify() {} } };
	const fire = (name: string) => { for (const fn of handlers.get(name) ?? []) fn({}, ctx); };
	fire("session_start");
	host.updatePendingMessagesDisplay();
	host.setExtensionStatus("rqw-followup-hold", "follow-up waits for the final answer");
	// Without a consumer Pi's own hints stay.
	assert.match(plain(host.pendingMessagesContainer.children.map((child: any) => child.text ?? "").join(" ")), /edit all queued messages/);
	assert.equal(statuses.get("rqw-followup-hold"), "follow-up waits for the final answer");
	let source: any;
	events.emit("rqw:activity-hint:request", { sessionId: "main", reply: (value: unknown) => { source = value; } });
	const stopConsumer = source.subscribe(() => {});
	assert.doesNotMatch(plain(host.pendingMessagesContainer.children.map((child: any) => child.text ?? "").join(" ")), /edit all queued messages/);
	assert.equal(statuses.get("rqw-followup-hold"), undefined);
	input("x"); focused = editor;
	const rows = host.pendingMessagesContainer.children.map((child: any) => child.text ?? "").join(" ");
	assert.match(plain(rows), /Follow-up: read the result/);
	assert.doesNotMatch(plain(rows), /edit all queued messages/);
	host.setExtensionStatus("rqw-followup-hold", "follow-up waits for the final answer");
	assert.equal(statuses.get("rqw-followup-hold"), undefined);
	const indicator = { kind: "retry", render: () => [" Retrying (1/3) in 5s... (esc to cancel)"], renderInBorder: () => "Retrying (1/3) in 5s... (esc to cancel)", dispose() {} };
	host.showStatusIndicator(indicator);
	assert.match(plain(indicator.render()[0]), /Retrying \(1\/3\) in 5s/);
	assert.doesNotMatch(plain(indicator.render()[0]), /to cancel/);
	// The activity line's retry text keeps its own key: it is the hint there.
	assert.match(plain(host.extensionWidgetsAbove.get("rqw-statusbar-activity").render(80)[0]), /Retrying 1\/3 in 5s · esc to cancel/);
	focused = {}; input("x");
	focused = editor;
	assert.doesNotMatch(plain(indicator.render()[0]), /to cancel/);
	assert.doesNotMatch(plain(host.pendingMessagesContainer.children.map((child: any) => child.text ?? "").join(" ")), /edit all queued messages/);
	assert.equal(statuses.get("rqw-followup-hold"), undefined);
	stopConsumer();
	assert.equal(statuses.get("rqw-followup-hold"), "follow-up waits for the final answer");
	assert.match(host.pendingMessagesContainer.children.map((child: any) => child.text ?? "").join(" "), /edit all queued messages/);
	source.subscribe(() => {});
	assert.equal(statuses.get("rqw-followup-hold"), undefined);
	fire("session_shutdown");
	assert.equal(statuses.get("rqw-followup-hold"), "follow-up waits for the final answer");
	assert.match(plain(indicator.render()[0]), /to cancel/);
	assert.match(host.pendingMessagesContainer.children.map((child: any) => child.text ?? "").join(" "), /edit all queued messages/);
});
