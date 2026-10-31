import assert from "node:assert/strict";
import { it, type TestContext } from "node:test";
import { AgentSession, CustomEditor, createEventBus, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import sendNow from "../../../extensions/RQW-send-now/index.ts";

const ESC = "\x1b";

/** A TUI session with a fake clock; `state` is what the test flips between presses. */
function setup(t: TestContext) {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10_000 });
	const events = createEventBus();
	const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
	const sent: string[] = [];
	const stops: unknown[] = [];
	const notices: string[] = [];
	const state = { idle: true, compacting: false, background: 0, queued: false, editor: "", autocomplete: false, aborts: 0, focused: true };
	events.on("rqw:stop-background:v1", (value: any) => { stops.push(value); value.reply({ agents: state.background }); });
	events.on("rqw:running-counts:request", (request: any) => request.reply({ version: 1, snapshot: () => ({ agents: state.background }), subscribe: () => () => {} }));
	const pi = {
		events, registerShortcut() {}, appendEntry() {}, sendUserMessage: (text: string) => sent.push(text),
		on: (name: string, handler: any) => { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
	};
	t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function() {});
	sendNow(pi as unknown as ExtensionAPI);
	let input: ((data: string) => unknown) | undefined;
	const editor = Object.create(CustomEditor.prototype);
	editor.isShowingAutocomplete = () => state.autocomplete;
	const other = {};
	const ctx = {
		mode: "tui", model: {}, sessionManager: { getEntries: () => [], getSessionId: () => "session" },
		hasPendingMessages: () => state.queued, isIdle: () => state.idle,
		abort: () => { state.aborts++; state.idle = true; if (state.queued) state.editor = "steer me"; state.queued = false; },
		ui: {
			getEditorText: () => state.editor, setEditorText: (value: string) => { state.editor = value; }, notify: (text: string) => notices.push(text),
			setWidget: (_key: string, factory: any) => { if (factory) factory({ getFocusedComponent: () => state.focused ? editor : other }); },
			onTerminalInput: (handler: typeof input) => { input = handler; return () => {}; },
		},
	} as unknown as ExtensionContext;
	const session = Object.create(AgentSession.prototype);
	session.sessionManager = ctx.sessionManager;
	session.getSteeringMessages = () => (state.queued ? ["steer me"] : []);
	session.clearQueue = () => { state.queued = false; return { steering: [], followUp: ["held follow-up"] }; };
	Object.defineProperty(session, "isCompacting", { get: () => state.compacting });
	session._bindExtensionCore();
	for (const handler of handlers.get("session_start")!) handler({}, ctx);
	t.after(() => { for (const handler of handlers.get("session_shutdown")!) handler({}, ctx); });
	return { press: (data = ESC) => input!(data), state, stops, sent, notices, tick: (ms: number) => t.mock.timers.tick(ms) };
}

it("a single Escape while the turn works is left to Pi and stops no background", (t) => {
	const h = setup(t);
	h.state.idle = false;
	assert.equal(h.press(), undefined);
	assert.equal(h.stops.length, 0);
	h.tick(600);
	assert.equal(h.press(), undefined);
	assert.equal(h.stops.length, 0);
});

it("a double Escape within 500 ms while the turn works stops the background", (t) => {
	const h = setup(t);
	h.state.idle = false;
	h.state.background = 2;
	assert.equal(h.press(), undefined);
	h.tick(499);
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.stops.length, 1);
	assert.match(h.notices.at(-1)!, /Stopped: 2 agents/);
});

it("with only background running the first Escape is taken and the second stops it", (t) => {
	const h = setup(t);
	h.state.background = 1;
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.stops.length, 0);
	h.tick(100);
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.stops.length, 1);
	// A third press right after must not reach the history gesture.
	h.state.background = 0;
	h.tick(100);
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.stops.length, 1);
	h.tick(500);
	assert.equal(h.press(), undefined);
});

it("a double Escape moves held follow-ups back into the editor", (t) => {
	const h = setup(t);
	h.state.background = 1;
	h.state.queued = true;
	h.state.editor = "typed";
	assert.deepEqual(h.press(), { consume: true });
	h.tick(50);
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.stops.length, 1);
	assert.equal(h.state.editor, "held follow-up\n\ntyped");
});

it("presses more than 500 ms apart are two single presses", (t) => {
	const h = setup(t);
	h.state.background = 1;
	assert.deepEqual(h.press(), { consume: true });
	h.tick(500);
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.stops.length, 0);
});

it("an idle chat without background leaves both Escapes to the history gesture", (t) => {
	const h = setup(t);
	assert.equal(h.press(), undefined);
	h.tick(100);
	assert.equal(h.press(), undefined);
	assert.equal(h.stops.length, 0);
});

it("busy is captured on the first press: a turn that ends between the presses still absorbs the second", (t) => {
	const h = setup(t);
	h.state.idle = false;
	assert.equal(h.press(), undefined);
	h.state.idle = true;
	h.tick(100);
	assert.deepEqual(h.press(), { consume: true });
	assert.equal(h.stops.length, 1);
});

it("background that ends between the presses still absorbs the second", (t) => {
	const h = setup(t);
	h.state.background = 1;
	assert.deepEqual(h.press(), { consume: true });
	h.state.background = 0;
	h.tick(100);
	assert.deepEqual(h.press(), { consume: true });
});

it("compaction counts as work: Pi gets the first press to cancel it", (t) => {
	const h = setup(t);
	h.state.compacting = true;
	assert.equal(h.press(), undefined);
	h.tick(100);
	assert.deepEqual(h.press(), { consume: true });
});

it("an open autocomplete list and other focused components keep their Escape", (t) => {
	const h = setup(t);
	h.state.background = 1;
	h.state.autocomplete = true;
	assert.equal(h.press(), undefined);
	h.state.autocomplete = false;
	h.state.focused = false;
	assert.equal(h.press(), undefined);
	assert.equal(h.press(), undefined);
	assert.equal(h.stops.length, 0);
});

it("a double Escape cancels a force-send that has not started and keeps its text", (t) => {
	const h = setup(t);
	h.state.idle = false;
	h.state.queued = true;
	assert.deepEqual(h.press("\r"), { consume: true });
	h.state.idle = true;
	assert.deepEqual(h.press(), { consume: true });
	assert.deepEqual(h.press(), { consume: true });
	h.tick(1000);
	assert.equal(h.state.editor, "steer me");
	assert.deepEqual(h.sent, []);
});

it("a steering input that lands after the cancel is restored with the text, not left in Pi's queue", (t) => {
	const h = setup(t);
	h.state.idle = false;
	h.state.queued = true;
	assert.deepEqual(h.press("\r"), { consume: true });
	assert.deepEqual(h.press(), { consume: true });
	assert.deepEqual(h.press(), { consume: true });
	h.state.queued = true; // the late input reaches Pi's queue after the cancel
	h.tick(1000);
	assert.equal(h.state.editor, "steer me\n\nsteer me");
	assert.equal(h.state.queued, false);
	assert.deepEqual(h.sent, []);
});
