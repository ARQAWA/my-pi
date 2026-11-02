import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { stripVTControlCharacters as strip } from "node:util";
import { it, type TestContext } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import statusbar from "../../../extensions/RQW-statusbar/index.ts";

const REQUEST = "rqw:activity-hint:request";
const OFFER = "rqw:activity-hint:offer";
const ITALIC_DIM = (text: string) => `\x1b[3m\x1b[90m${text}\x1b[39m\x1b[23m`;

/** The status bar on a real event bus, with a fake Pi around it and a fake hint source like RQW-send-now's. */
async function setup(t: TestContext, { answers = true } = {}) {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const clock = { now: 0 };
	t.mock.method(performance, "now", () => clock.now);
	const events = createEventBus();
	const handlers = new Map<string, (event: unknown, ctx: any) => any>();
	const commands = new Map<string, any>();
	const pi = {
		events, getSettings: () => ({}), getSessionName: () => undefined, getThinkingLevel: () => "off",
		registerCommand: (name: string, command: unknown) => commands.set(name, command),
		on: (name: string, handler: (event: unknown, ctx: any) => any) => handlers.set(name, handler),
	};
	const hint = { text: undefined as string | undefined, subscribed: 0, unsubscribed: 0, change: undefined as (() => void) | undefined, reads: 0 };
	const source = {
		snapshot: () => { hint.reads++; return hint.text; },
		subscribe(listener: () => void) { hint.subscribed++; hint.change = listener; return () => { hint.unsubscribed++; hint.change = undefined; }; },
	};
	if (answers) events.on(REQUEST, (request: any) => { if (request.sessionId === "s") request.reply(source); });
	let factory: any;
	let widget: any;
	const italics: string[] = [];
	const ctx = {
		mode: "tui", cwd: tmpdir(), isIdle: () => false, getContextUsage: () => undefined,
		sessionManager: { getSessionId: () => "s", getLeafId: () => null, getEntryCount: () => 0, getEntries: () => [] },
		ui: { theme: { fg: (role: string, text: string) => role === "dim" ? `\x1b[90m${text}\x1b[39m` : text, italic: (text: string) => { italics.push(text); return `\x1b[3m${text}\x1b[23m`; } },
			getEditorComponent: () => factory, setEditorComponent: (next: unknown) => { factory = next; }, setFooter() {}, setWorkingIndicator() {},
			setWidget: (_key: string, next: unknown) => { widget = next; } },
	};
	statusbar(pi as never);
	await handlers.get("session_start")!({}, ctx);
	t.after(() => handlers.get("session_shutdown")!({}, ctx));
	return { clock, events, handlers, commands, hint, source, ctx, italics, rows: () => widget(), editor: () => factory({ requestRender() {}, terminal: { rows: 40 } }, { borderColor: (text: string) => text, selectList: {} }, { matches: () => false }), start: () => handlers.get("agent_start")!({}, ctx) };
}

it("draws the hint right of the activity text, dim and italic, and reads a changed hint at once", async (t) => {
	const s = await setup(t);
	s.hint.text = "esc to interrupt";
	s.start();
	const rows = s.rows();
	assert.equal(strip(rows.render(80)[0]), " Planning next moves  esc to interrupt");
	assert.ok(rows.render(80)[0].endsWith(ITALIC_DIM("esc to interrupt")));
	s.hint.text = "esc esc to stop background";
	assert.equal(strip(rows.render(80)[0]), " Planning next moves  esc esc to stop background");
	s.hint.text = undefined;
	assert.equal(strip(rows.render(80)[0]), " Planning next moves");
	assert.equal(s.hint.subscribed, 1);
});

it("leaves the hint out when it does not fit whole and when nothing is shown", async (t) => {
	const s = await setup(t);
	s.hint.text = "esc to interrupt";
	s.start();
	const rows = s.rows();
	// " Planning next moves" is 20 columns; two spaces and 16 more make 38.
	assert.equal(strip(rows.render(38)[0]), " Planning next moves  esc to interrupt");
	assert.equal(strip(rows.render(37)[0]), " Planning next moves");
	assert.equal(strip(rows.render(10)[0]), " Planning…");
	await s.handlers.get("agent_settled")!({}, s.ctx);
	assert.deepEqual(rows.render(80), []);
});

it("shows the background count and stop hint while the main run is idle", async (t) => {
	const s = await setup(t);
	await s.handlers.get("agent_settled")!({}, s.ctx);
	let listener: ((value: unknown) => void) | undefined;
	let counts = { agents: 2, backgroundProcesses: 1 };
	s.events.emit("rqw:running-counts:offer", { version: 1, source: {
		version: 1, snapshot: () => counts,
		subscribe: (next: (value: unknown) => void) => { listener = next; return () => { listener = undefined; }; },
	} });
	s.hint.text = "esc esc to stop background";
	const rows = s.rows();
	assert.equal(strip(rows.render(100)[0]), " Background: 2 agents, 1 background process  esc esc to stop background");
	counts = { agents: 0, backgroundProcesses: 0 };
	listener?.(counts);
	assert.deepEqual(rows.render(100), []);
});

it("paints the hint once per text and reuses the rows of an unchanged frame", async (t) => {
	const s = await setup(t);
	s.hint.text = "esc to interrupt";
	s.start();
	const rows = s.rows();
	const first = rows.render(80);
	for (let i = 0; i < 10; i++) assert.deepEqual(rows.render(80), first);
	// A later animation frame builds the row again, but the painted hint is reused.
	s.clock.now += 100;
	assert.notDeepEqual(rows.render(80), first);
	assert.deepEqual(s.italics, ["\x1b[90mesc to interrupt\x1b[39m"]);
	s.hint.text = "esc to send now";
	rows.render(80);
	assert.equal(s.italics.length, 2);
});

it("Pi's own retry and summary text keeps its own key and gets no hint", async (t) => {
	const s = await setup(t);
	s.hint.text = "esc to interrupt";
	s.start();
	const rows = s.rows();
	const editor = s.editor();
	editor.setWorkingStatusIndicator({ kind: "retry", message: "Retrying (2/3) in 4s... (esc to cancel)", setMessage() {}, renderInBorder() { return "\u280b Retrying (2/3) in 4s... (esc to cancel)"; }, renderSpinnerInBorder: () => "\u280b", dispose() {} });
	assert.equal(strip(rows.render(80)[0]), " Retrying 2/3 in 4s \u00b7 esc to cancel");
	editor.setWorkingStatusIndicator({ kind: "branchSummary", renderInBorder: () => "Summarizing branch... (esc to cancel)", dispose() {} });
	assert.equal(strip(rows.render(80)[0]), " Summarizing branch \u00b7 esc to cancel");
});

it("shows no hint without a source, takes a late offer of its own session only, and lets go on /statusbar off", async (t) => {
	const s = await setup(t, { answers: false });
	s.start();
	const rows = s.rows();
	assert.equal(strip(rows.render(80)[0]), " Planning next moves");
	s.hint.text = "esc to interrupt";
	s.events.emit(OFFER, { sessionId: "other", source: s.source });
	assert.equal(s.hint.subscribed, 0);
	assert.equal(strip(rows.render(80)[0]), " Planning next moves");
	s.events.emit(OFFER, { sessionId: "s", source: s.source });
	assert.equal(s.hint.subscribed, 1);
	assert.equal(strip(rows.render(80)[0]), " Planning next moves  esc to interrupt");
	await s.commands.get("statusbar").handler("off", s.ctx);
	assert.equal(s.hint.unsubscribed, 1);
	await s.commands.get("statusbar").handler("on", s.ctx);
	assert.equal(s.hint.subscribed, 1);
	s.events.emit(OFFER, { sessionId: "s", source: s.source });
	assert.equal(s.hint.subscribed, 2);
});

it("lets go of the source on shutdown", async (t) => {
	const s = await setup(t);
	assert.equal(s.hint.subscribed, 1);
	await s.handlers.get("session_shutdown")!({}, s.ctx);
	assert.equal(s.hint.unsubscribed, 1);
});
