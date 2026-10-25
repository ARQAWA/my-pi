// P6 lifecycle acceptance, deterministic: the statusbar is driven only through its public extension events and the
// public ExtensionAPI/UI contract, with a fake UI that really builds Pi's CustomEditor-derived editor and the footer
// and activity factories. The running-counts producer is a stand-in that speaks the counts channel contract only; no
// other extension is imported. Time is a mock clock (setInterval and Date, with performance.now following it), git is never touched (temp cwd outside any repo),
// and session branches come from the public SessionManager (in memory).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it, type TestContext } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { type ExtensionAPI, type ExtensionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import statusbar from "../../../extensions/RQW-statusbar/index.ts";
import { GOLD, SILVER, shimmerText, titleRow } from "../../../extensions/RQW-statusbar/render.ts";

const ACTIVITY_KEY = "rqw-statusbar-activity";
const TITLE_KEY = "rqw-statusbar-title";
// The running-counts contract (version 1) as the README of the producer states it; spelled here, nothing imported.
const COUNTS_REQUEST = "rqw:running-counts:request";
const COUNTS_OFFER = "rqw:running-counts:offer";
/** The animation timer: 30 nominal redraws per second. */
const SHIMMER_MS = 1000 / 30;
/** The former timer, one phase frame per tick: the travel speed the new time basis is compared with. */
const OLD_SHIMMER_MS = 120;
/** Activity and compaction move twice as fast as the previous 160 ms phase frame. */
const STATUS_FRAME_MS = 80;
const GIT_POLL_MS = 10_000;
const MODEL = { provider: "anthropic", id: "claude-fixture", name: "Claude Fixture", reasoning: true, contextWindow: 200000 };

const root = mkdtempSync(join(tmpdir(), "rqw-statusbar-lifecycle-"));
after(() => rmSync(root, { recursive: true, force: true }));

type Counts = { agents: number };
type Listener = (counts: Counts | null) => void;
interface Screen {
	render(width: number): string[];
	dispose?(): void;
}

/** A counts source: snapshot, subscribe (returns the unsubscribe), and `null` when it ends. */
interface Source {
	readonly version: 1;
	counts: Counts;
	readonly listeners: Set<Listener>;
	disposed: number;
	snapshot(): Counts;
	subscribe(listener: Listener): () => void;
	dispose(): void;
}

function source(counts: Counts): Source {
	const listeners = new Set<Listener>();
	const self: Source = {
		version: 1,
		counts,
		listeners,
		disposed: 0,
		snapshot: () => ({ ...self.counts }),
		subscribe(listener) {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		dispose() { self.disposed++; },
	};
	return self;
}

function push(src: Source, counts: Partial<Counts>): void {
	src.counts = { ...src.counts, ...counts };
	for (const listener of [...src.listeners]) listener({ ...src.counts });
}

function end(src: Source): void {
	for (const listener of [...src.listeners]) listener(null);
}

/** The stand-in producer: answers the request (unless told not to) and can offer its source at any time. */
class Producer {
	readonly bus: Bus;
	source: Source;
	requests = 0;

	constructor(bus: Bus, counts: Counts, answer = true) {
		this.bus = bus;
		this.source = source(counts);
		bus.on(COUNTS_REQUEST, (data) => {
			this.requests++;
			if (answer) (data as { reply(s: Source): void }).reply(this.source);
		});
	}

	offer(): void {
		this.bus.emit(COUNTS_OFFER, { version: 1, source: this.source });
	}
}

/** Pi's `pi.events` bus as the contract states it: emit and on (returns the unsubscribe). */
class Bus {
	readonly channels = new Map<string, Set<(data: unknown) => void>>();
	readonly emitted: string[] = [];

	on(channel: string, handler: (data: unknown) => void): () => void {
		const set = this.channels.get(channel) ?? new Set<(data: unknown) => void>();
		set.add(handler);
		this.channels.set(channel, set);
		return () => { set.delete(handler); };
	}

	emit(channel: string, data: unknown): void {
		this.emitted.push(channel);
		for (const handler of [...(this.channels.get(channel) ?? [])]) handler(data);
	}

	listeners(channel: string): number {
		return this.channels.get(channel)?.size ?? 0;
	}
}

/** The public ExtensionAPI surface the statusbar uses, with every read counted. */
class FakePi {
	readonly events: Bus;
	readonly handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
	readonly commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> | void }>();
	readonly reads = { sessionName: 0, settings: 0, thinking: 0 };
	sessionName: string | undefined;

	constructor(bus: Bus, name: string | undefined) {
		this.events = bus;
		this.sessionName = name;
	}

	on(name: string, handler: (event: unknown, ctx: unknown) => unknown): () => void {
		const list = this.handlers.get(name) ?? [];
		list.push(handler);
		this.handlers.set(name, list);
		return () => {
			const index = list.indexOf(handler);
			if (index >= 0) list.splice(index, 1);
		};
	}

	registerCommand(name: string, command: { handler(args: string, ctx: unknown): Promise<void> | void }): void {
		this.commands.set(name, command);
	}

	getSessionName(): string | undefined {
		this.reads.sessionName++;
		return this.sessionName;
	}

	getSettings(): Record<string, unknown> {
		this.reads.settings++;
		return {};
	}

	getThinkingLevel(): string {
		this.reads.thinking++;
		return "medium";
	}

	fire(name: string, event: unknown, ctx: unknown): void {
		for (const handler of [...(this.handlers.get(name) ?? [])]) handler(event, ctx);
	}
}

const plainTheme = { fg: (_color: string, text: string) => text };
const editorTheme = { borderColor: (text: string) => text, selectList: {} };
const keybindings = { matches: () => false };
const footerData = {
	getGitBranch: () => null,
	getExtensionStatuses: () => new Map<string, string>(),
	onBranchChange: () => () => {},
	getAvailableProviderCount: () => 0,
};

/** Pi's extension UI slots as interactive mode fills them: factories are called, components kept, calls recorded. */
class FakeUi {
	readonly calls: string[] = [];
	readonly widgets = new Map<string, Screen>();
	readonly placements = new Map<string, unknown>();
	readonly theme = plainTheme;
	readonly tui = { requestRender: () => { this.renders++; }, terminal: { rows: 40 } };
	renders = 0;
	footerComponent: Screen | undefined;
	editorFactory: unknown;
	editor: Screen | undefined;
	private readonly widgetFailure: boolean;

	/** `absent` leaves this UI without a setWidget method; `throws` records the call and then fails it. */
	constructor(widget: "normal" | "throws" | "absent" = "normal") {
		this.widgetFailure = widget === "throws";
		if (widget === "absent") this.setWidget = undefined as unknown as FakeUi["setWidget"];
	}

	setWidget(key: string, content: unknown, options?: unknown): void {
		this.calls.push("setWidget");
		if (this.widgetFailure) throw new Error("widget refused");
		this.widgets.get(key)?.dispose?.();
		if (content === undefined) {
			this.widgets.delete(key);
			return;
		}
		this.placements.set(key, (options as { placement?: unknown } | undefined)?.placement);
		const component = typeof content === "function"
			? (content as (tui: unknown, theme: unknown) => Screen)(this.tui, this.theme)
			: { render: () => content as string[] };
		this.widgets.set(key, component);
	}

	setFooter(factory: unknown): void {
		this.calls.push("setFooter");
		this.footerComponent?.dispose?.();
		this.footerComponent = typeof factory === "function"
			? (factory as (tui: unknown, theme: unknown, data: unknown) => Screen)(this.tui, this.theme, footerData)
			: undefined;
	}

	setEditorComponent(factory: unknown): void {
		this.calls.push("setEditorComponent");
		this.editorFactory = factory;
		this.editor = typeof factory === "function"
			? (factory as (tui: unknown, theme: unknown, keys: unknown) => Screen)(this.tui, editorTheme, keybindings)
			: undefined;
	}

	getEditorComponent(): unknown {
		this.calls.push("getEditorComponent");
		return this.editorFactory;
	}

	setWorkingVisible(_visible: boolean): void { this.calls.push("setWorkingVisible"); }
	setWorkingMessage(_message?: string): void { this.calls.push("setWorkingMessage"); }
	workingIndicator: unknown;
	setWorkingIndicator(options?: unknown): void { this.calls.push("setWorkingIndicator"); this.workingIndicator = options; }
	setStatus(_key: string, _text?: string): void { this.calls.push("setStatus"); }
	notify(_message: string, _level?: string): void { this.calls.push("notify"); }
}

interface Harness {
	pi: FakePi;
	bus: Bus;
	ui: FakeUi;
	ctx: ExtensionContext;
	manager: SessionManager;
	fire(name: string, event?: Record<string, unknown>): void;
	command(args: string): Promise<void>;
	idle(value: boolean): void;
	tick(ms: number): void;
}

const clocked = new WeakSet<TestContext>();

/** One statusbar instance on the fake contract, on a mock clock; torn down after the test. */
function harness(t: TestContext, options: { mode?: string; name?: string; manager?: unknown; widget?: "normal" | "throws" | "absent" } = {}): Harness {
	if (!clocked.has(t)) {
		t.mock.timers.enable({ apis: ["setInterval", "Date"] });
		t.mock.method(performance, "now", () => Date.now());
		clocked.add(t);
	}
	const bus = new Bus();
	const pi = new FakePi(bus, options.name);
	const ui = new FakeUi(options.widget);
	let idle = true;
	const manager = options.manager ?? SessionManager.inMemory(root);
	const ctx = {
		mode: options.mode ?? "tui",
		cwd: root,
		ui,
		sessionManager: manager,
		model: MODEL,
		isIdle: () => idle,
		getContextUsage: () => ({ tokens: 12000, contextWindow: 200000 }),
	} as unknown as ExtensionContext;
	statusbar(pi as unknown as ExtensionAPI);
	const h: Harness = {
		pi,
		bus,
		ui,
		ctx,
		manager: manager as SessionManager,
		fire: (name, event = {}) => pi.fire(name, { type: name, ...event }, ctx),
		command: async (args) => { await pi.commands.get("statusbar")!.handler(args, ctx); },
		idle: (value) => { idle = value; },
		tick: (ms) => t.mock.timers.tick(ms),
	};
	t.after(() => h.fire("session_shutdown", { reason: "quit" }));
	return h;
}

const strip = (line: string) => stripVTControlCharacters(line.replace(/\x1b_[^\x07]*\x07/g, ""));
const top = (h: Harness, width = 80) => strip(h.ui.editor!.render(width)[0]);
const bottom = (h: Harness, width = 80) => {
	const rows = h.ui.editor!.render(width);
	return strip(rows[rows.length - 1]);
};
const activityRows = (h: Harness, width = 80) => h.ui.widgets.get(ACTIVITY_KEY)!.render(width).map(strip);
const activity = (h: Harness, width = 80) => activityRows(h, width)[0] ?? "";
const footerRow = (h: Harness, index: number, width = 80) => strip(h.ui.footerComponent!.render(width)[index] ?? "");
const place = (h: Harness, width = 80) => footerRow(h, 1, width);
/** The stock top border with the session ID at its right end: the idle rule, nothing else. */
const idleTop = (h: Harness, width = 80) => {
	const id = h.manager.getSessionId();
	return `${"─".repeat(width - id.length - 4)} ${id} ──`;
};
const user = (text: string) => ({ role: "user", content: text, timestamp: 1 }) as never;
const before = (reason: "manual" | "threshold" | "overflow" = "manual", willRetry = false) =>
	({ type: "session_before_compact", reason, willRetry, preparation: {}, branchEntries: [], signal: new AbortController().signal });

/** A small session: u1 root, u2 and u3 on the original branch, u4 a fork after u2. Leaf stays on u4; no tree event. */
function branchTree(h: Harness) {
	const m = h.manager;
	const u1 = m.appendMessage(user("first"));
	const u2 = m.appendMessage(user("second"));
	const u3 = m.appendMessage(user("third"));
	m.branch(u2);
	const u4 = m.appendMessage(user("fork"));
	return { u1, u2, u3, u4 };
}

it("producer offers and requests load in either order and count agents once per source", (t) => {
	const a = harness(t);
	const first = new Producer(a.bus, { agents: 2 });
	a.fire("session_start", { reason: "startup" });
	assert.equal(first.requests, 1, "the bar asks a producer that is already listening");
	assert.match(activity(a), /^ Waiting for 2 agents$/);

	const b = harness(t);
	b.fire("session_start", { reason: "startup" });
	const late = new Producer(b.bus, { agents: 2 }, false);
	late.offer();
	late.offer();
	assert.match(activity(b), /^ Waiting for 2 agents$/);
	assert.equal(b.bus.listeners(COUNTS_OFFER), 1, "the bar keeps one offer listener");
	assert.equal(late.source.listeners.size, 1, "the same source is adopted once");
});

it("main planning, tool action phrases and the latest running tool drive the activity widget", (t) => {
	const h = harness(t);
	new Producer(h.bus, { agents: 0 });
	h.fire("session_start", { reason: "startup" });
	h.fire("agent_start");
	assert.match(activity(h), /^ Planning next moves$/);
	const busy = h.ui.renders;
	h.tick(SHIMMER_MS);
	assert.ok(h.ui.renders > busy, "the shimmer runs while the main agent works");
	h.fire("tool_execution_start", { toolCallId: "t1", toolName: "bash", args: { command: "npm test" } });
	assert.match(activity(h), /^ Running npm test$/);
	h.fire("tool_execution_start", { toolCallId: "t2", toolName: "edit", args: { path: "/work/src/app.ts", edits: [] } });
	assert.match(activity(h), /^ Editing app\.ts$/, "the latest running tool");
	h.fire("tool_execution_end", { toolCallId: "t2", toolName: "edit", isError: false, result: {} });
	assert.match(activity(h), /^ Running npm test$/, "the earlier tool is shown again");
	h.fire("tool_execution_end", { toolCallId: "t1", toolName: "bash", isError: false, result: {} });
	assert.match(activity(h), /^ Planning next moves$/, "tool end restores planning");
	assert.doesNotMatch(activity(h), /Running|Editing/);
	assert.equal(top(h), idleTop(h), "tool text never enters the border");
});

it("the animation redraws at 30 fps with fractional intervals, and its phase follows elapsed time, not ticks", (t) => {
	const h = harness(t);
	new Producer(h.bus, { agents: 0 });
	h.fire("session_start", { reason: "startup" });
	h.fire("agent_start");
	const raw = () => h.ui.widgets.get(ACTIVITY_KEY)!.render(80)[0];
	assert.ok(raw().includes(shimmerText("Planning next moves", 1, 0, SILVER)), "agent_start is phase frame 0");
	const start = h.ui.renders;
	h.tick(SHIMMER_MS - 0.5);
	assert.equal(h.ui.renders, start, "no redraw before the fractional interval expires");
	h.tick(1);
	assert.equal(h.ui.renders, start + 1, "one redraw just after 1000 / 30 ms");
	assert.ok(!raw().includes(shimmerText("Planning next moves", 1, 1, SILVER)), "not one frame per tick during the visible flight");
	// Stop just beyond a second to avoid floating-point ambiguity at the thirtieth tick.
	h.tick(1001 - (SHIMMER_MS + 0.5));
	const perSecond = h.ui.renders - start;
	assert.equal(perSecond, 30, "30 redraws after 1001 ms");
	assert.ok(perSecond >= 2 * Math.floor(1000 / OLD_SHIMMER_MS), "at least twice the old 8 redraws per second");
	// 1001 ms is 30 ticks but 12.5125 phase frames; cadence and travel speed are independent.
	const frame = 1001 / STATUS_FRAME_MS;
	assert.ok(raw().includes(shimmerText("Planning next moves", 1, frame, SILVER)), "phase = elapsed / 80 ms");
	assert.equal(frame / (1001 / 160), 2, "travel is twice the previous 160 ms speed");
	// A render between timer ticks still uses fractional elapsed time.
	h.tick(0.5);
	const between = 1001.5 / STATUS_FRAME_MS;
	assert.ok(raw().includes(shimmerText("Planning next moves", 1, between, SILVER)), "fractional phase between ticks");
	// Compaction activity has no rule and follows the same clock, with fractional frames.
	h.fire("session_before_compact", before());
	h.tick(13);
	const gold = 1014.5 / STATUS_FRAME_MS;
	assert.equal(raw(), ` ${shimmerText("Compacting context", 1, gold, GOLD)}`);
	h.fire("session_compact", { reason: "manual", willRetry: false, fromExtension: false, compactionEntry: {} });
	h.fire("agent_settled", { aborted: false });
	const idle = h.ui.renders;
	h.tick(1000);
	assert.equal(h.ui.renders, idle, "idle: no timer");
});

it("children count after the main reply: agent_settled shows Waiting until zero, then the idle rule is continuous", (t) => {
	const h = harness(t);
	const p = new Producer(h.bus, { agents: 2 });
	h.fire("session_start", { reason: "startup" });
	h.fire("agent_start");
	assert.match(activity(h), /^ Planning next moves · 2 agents$/);
	h.fire("agent_end", { messages: [] });
	h.fire("agent_settled", { aborted: false });
	assert.match(activity(h), /^ Waiting for 2 agents$/);
	assert.doesNotMatch(activity(h), /Planning/, "the main agent is idle once settled");
	end(p.source);
	assert.equal(top(h), idleTop(h), "zero children: continuous rule");
	assert.deepEqual(activityRows(h), [], "zero children: no activity rows or gaps");
	assert.equal(p.source.listeners.size, 0, "a source that ended is released");
	const quiet = h.ui.renders;
	h.tick(1000);
	assert.equal(h.ui.renders, quiet, "fully idle: no shimmer tick");
});

it("activity contains no duplicate Working text or native spinner in any state", (t) => {
	const h = harness(t);
	const p = new Producer(h.bus, { agents: 1 });
	h.fire("session_start", { reason: "startup" });
	const seen: string[] = [];
	h.fire("agent_start");
	seen.push(activity(h));
	h.fire("tool_execution_start", { toolCallId: "t1", toolName: "bash", args: { command: "npm test" } });
	seen.push(activity(h));
	h.fire("session_before_compact", before());
	seen.push(activity(h));
	h.fire("session_compact", { reason: "manual", willRetry: false, fromExtension: false, compactionEntry: {} });
	h.fire("tool_execution_end", { toolCallId: "t1", toolName: "bash", isError: false, result: {} });
	h.fire("agent_settled", { aborted: false });
	seen.push(activity(h));
	push(p.source, { agents: 0 });
	seen.push(activity(h));
	for (const line of seen) {
		assert.doesNotMatch(line, /Working/);
		assert.doesNotMatch(line, /[\u2800-\u28ff]/, "no braille spinner frame");
	}
});

it("compaction completion clears the gold status, and the shimmer stops once fully idle", (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	h.fire("session_before_compact", before());
	assert.match(activity(h), /^ Compacting context$/);
	const busy = h.ui.renders;
	h.tick(SHIMMER_MS);
	assert.ok(h.ui.renders > busy, "the gold shimmer runs while compacting");
	h.fire("session_compact", { reason: "manual", willRetry: false, fromExtension: false, compactionEntry: {} });
	assert.equal(top(h), idleTop(h));
	assert.deepEqual(activityRows(h), [], "successful compaction removes the activity rows");
	const idle = h.ui.renders;
	h.tick(1000);
	assert.equal(h.ui.renders, idle, "the shimmer stopped with the status");
});

it("compaction cancel and abort clear the status through session_compact_failed", (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	h.fire("session_before_compact", before("manual"));
	assert.match(activity(h), /^ Compacting context$/);
	h.fire("session_compact_failed", { reason: "manual", aborted: true, willRetry: false, fromExtension: true });
	assert.equal(top(h), idleTop(h), "cancelled");
	assert.deepEqual(activityRows(h), [], "cancelled compaction removes the activity rows");
	h.fire("session_before_compact", before("overflow", true));
	assert.match(activity(h), /^ Compacting context$/);
	h.fire("session_compact_failed", { reason: "overflow", aborted: true, willRetry: true, fromExtension: false });
	assert.equal(top(h), idleTop(h), "aborted");
	assert.deepEqual(activityRows(h), [], "aborted compaction removes the activity rows");
	assert.match(bottom(h), /─/, "the meter is ordinary again, not the busy full meter");
});

it("compaction error clears the status and its text never reaches the border", (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	h.fire("session_before_compact", before("threshold"));
	h.fire("session_compact_failed", {
		reason: "threshold", aborted: false, errorMessage: "provider down", willRetry: false, fromExtension: false,
	});
	assert.equal(top(h), idleTop(h));
	assert.deepEqual(activityRows(h), [], "failed compaction removes the activity rows");
	assert.doesNotMatch(activity(h), /provider down/);
	assert.doesNotMatch(top(h), /provider down/);
	assert.doesNotMatch(bottom(h), /provider down/);
});

it("a compaction failure without a before event leaves no status and no shimmer", (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	h.fire("session_compact_failed", { reason: "manual", aborted: false, errorMessage: "x", willRetry: false, fromExtension: false });
	assert.equal(top(h), idleTop(h));
	assert.deepEqual(activityRows(h), [], "failure without a before-event leaves no activity");
	// The failure itself may ask for one plain redraw; the baseline is taken after it, so only a started timer would count.
	const quiet = h.ui.renders;
	h.tick(1000);
	assert.equal(h.ui.renders, quiet, "no shimmer was started");
});

it("the context meter during compaction is a full busy meter with no measured progress", (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	const label = (line: string) => line.replace(/[━─]/g, "");
	const idleLine = bottom(h);
	h.fire("session_before_compact", before());
	const first = bottom(h);
	h.tick(SHIMMER_MS * 5);
	const later = bottom(h);
	assert.equal(first, later, "the visible text does not move while compacting");
	assert.doesNotMatch(first, /─/, "the whole meter is busy fill");
	assert.equal(label(first), label(idleLine), "same label, no fake percentage");
	assert.equal(visibleWidth(first), 80);
});

it("install, off, on and shutdown count subscriptions and release every listener, timer and widget", async (t) => {
	const h = harness(t);
	const p = new Producer(h.bus, { agents: 1 });
	h.fire("session_start", { reason: "startup" });
	assert.equal(h.bus.listeners(COUNTS_OFFER), 1);
	assert.equal(p.source.listeners.size, 1);
	assert.ok(h.ui.widgets.has(ACTIVITY_KEY));
	assert.equal(h.ui.placements.get(ACTIVITY_KEY), "aboveEditor");
	const footer = h.ui.footerComponent!;

	await h.command("off");
	assert.equal(h.bus.listeners(COUNTS_OFFER), 0, "the offer listener is gone");
	assert.equal(p.source.listeners.size, 0, "the source listener is gone");
	assert.equal(h.ui.widgets.has(ACTIVITY_KEY), false, "the activity widget is removed");
	assert.equal(h.ui.footerComponent, undefined, "the footer is restored to stock");
	assert.equal(h.ui.editor, undefined, "our editor is restored to stock");
	assert.deepEqual(footer.render(80), [], "the disposed footer draws nothing");
	const quiet = h.ui.renders;
	h.tick(GIT_POLL_MS * 2);
	assert.equal(h.ui.renders, quiet, "the git poll timer is cleared");

	await h.command("on");
	assert.equal(h.bus.listeners(COUNTS_OFFER), 1, "on subscribes once");
	assert.equal(p.source.listeners.size, 1);
	assert.ok(h.ui.widgets.has(ACTIVITY_KEY));

	h.fire("session_shutdown", { reason: "quit" });
	assert.equal(h.bus.listeners(COUNTS_OFFER), 0, "shutdown releases the offer listener");
	assert.equal(p.source.listeners.size, 0, "shutdown releases the source listener");
	assert.equal(h.ui.widgets.has(ACTIVITY_KEY), false, "shutdown clears the activity widget");
	const after = h.ui.renders;
	h.tick(GIT_POLL_MS * 2);
	assert.equal(h.ui.renders, after, "no timer survives shutdown");
	assert.equal(p.source.disposed, 0, "the bar never disposes the producer's source");
});

it("reinstall makes a fresh producer handshake and ignores the old source callbacks", (t) => {
	const h = harness(t);
	const p = new Producer(h.bus, { agents: 1 });
	h.fire("session_start", { reason: "startup" });
	assert.match(activity(h), /^ Waiting for 1 agent$/);
	const old = p.source;
	const stale = [...old.listeners];
	p.source = source({ agents: 3 });
	const requests = p.requests;
	h.fire("session_start", { reason: "reload" });
	assert.equal(p.requests, requests + 1, "reinstall asks the producer again");
	assert.equal(h.bus.listeners(COUNTS_OFFER), 1);
	assert.equal(old.listeners.size, 0, "the old source is released at reinstall");
	assert.match(activity(h), /^ Waiting for 3 agents$/, "the fresh source answers");
	for (const listener of stale) listener({ agents: 9 });
	assert.match(activity(h), /^ Waiting for 3 agents$/, "late callbacks of the old source change nothing");
	assert.equal(old.disposed, 0);
});

it("a cancelable session_before_switch never tears the bar down", (t) => {
	const h = harness(t);
	new Producer(h.bus, { agents: 0 });
	h.fire("session_start", { reason: "startup" });
	h.fire("agent_start");
	const footer = h.ui.footerComponent!;
	const calls = h.ui.calls.length;
	h.fire("session_before_switch", { reason: "new" });
	assert.equal(h.ui.calls.slice(calls).filter((c) => c !== "getEditorComponent").length, 0, "no UI change");
	assert.equal(h.bus.listeners(COUNTS_OFFER), 1);
	assert.equal(footer.render(80).length, 2, "the footer is still alive");
	const busy = h.ui.renders;
	h.tick(SHIMMER_MS);
	assert.ok(h.ui.renders > busy, "the shimmer still runs");
});

it("install samples ctx.isIdle(), and a new session_start resets stale activity", (t) => {
	const h = harness(t);
	h.idle(false);
	h.fire("session_start", { reason: "startup" });
	assert.match(activity(h), /^ Planning next moves$/, "a busy main agent at install shows planning");
	h.fire("tool_execution_start", { toolCallId: "t1", toolName: "bash", args: { command: "npm test" } });
	h.idle(true);
	h.fire("session_start", { reason: "new" });
	assert.equal(top(h), idleTop(h), "the new session starts from idle, tools cleared");
	assert.deepEqual(activityRows(h), [], "new session clears stale tool activity");
});

it("the native title lives in the top border, follows name changes and disappears when cleared", (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	assert.equal(top(h), idleTop(h));
	assert.deepEqual(activityRows(h), [], "idle widget adds no rows");
	assert.equal(h.ui.widgets.has(TITLE_KEY), false, "there is no title widget");
	h.pi.sessionName = "Fix login bug";
	h.fire("session_info_changed", { name: "Fix login bug" });
	assert.match(top(h), /^── Fix login bug /);
	assert.ok(h.ui.editor!.render(80)[0].includes(titleRow("Fix login bug", 13)), "static title keeps its gold ANSI");
	h.pi.sessionName = undefined;
	h.fire("session_info_changed", { name: undefined });
	assert.equal(top(h), idleTop(h));
});

it("install samples a long native title without the naming extension's 32-character limit", (t) => {
	const name = "Refactor the statusbar lifecycle and its long native title";
	const h = harness(t, { name });
	h.fire("session_start", { reason: "startup" });
	assert.match(top(h, 120), new RegExp(`^── ${name} ─+ ${h.manager.getSessionId()} ──$`));
	assert.ok(name.length > 32);
	assert.equal(visibleWidth(top(h, 120)), 120);
});

it("the title is static during ordinary activity; compaction shimmers the entire top border gold", (t) => {
	const name = "Fix login bug";
	const h = harness(t, { name });
	new Producer(h.bus, { agents: 1 });
	h.fire("session_start", { reason: "startup" });
	const raw = () => h.ui.editor!.render(100)[0];
	const initial = raw();
	h.fire("agent_start");
	h.tick(SHIMMER_MS);
	assert.equal(raw(), initial);
	h.fire("tool_execution_start", { toolCallId: "t1", toolName: "bash", args: { command: "npm test" } });
	assert.equal(raw(), initial);
	h.fire("session_before_compact", before());
	h.tick(SHIMMER_MS * 3);
	const compacting = raw();
	assert.equal(strip(compacting), strip(initial), "activity never replaces the title");
	assert.equal(compacting, shimmerText(strip(initial), 0, SHIMMER_MS * 4 / STATUS_FRAME_MS, GOLD), "rules, title and ID share the gold shimmer");
	h.fire("session_compact", { reason: "manual", willRetry: false, fromExtension: false, compactionEntry: {} });
	assert.equal(raw(), initial);
});

it("active widget has exactly one leading space, no rules, one trailing empty row and no idle rows", (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	assert.deepEqual(activityRows(h), []);
	h.fire("agent_start");
	assert.deepEqual(activityRows(h), [" Planning next moves", ""]);
	assert.equal(top(h), idleTop(h), "activity does not enter the editor border");
	h.fire("agent_settled", { aborted: false });
	assert.deepEqual(activityRows(h), []);
});

it("the session ID appears once, on the top border only", (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	const id = h.manager.getSessionId();
	const screen = [
		...h.ui.editor!.render(80),
		...h.ui.footerComponent!.render(80),
		...h.ui.widgets.get(ACTIVITY_KEY)!.render(80),
	].map(strip).join("\n");
	assert.equal(screen.split(id).length - 1, 1);
	assert.match(top(h), new RegExp(` ${id} ──$`));
});

it("branch mark: absent on the original branch, the sibling number off it, gone again on return", (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	assert.doesNotMatch(place(h), /⑂/);
	const { u3, u4 } = branchTree(h);
	h.fire("session_tree", { newLeafId: u4, oldLeafId: u3 });
	assert.match(place(h), /\S {2}⑂ fork #2$/, "two spaces after the folder, the sibling number");
	h.manager.branch(u3);
	h.fire("session_tree", { newLeafId: u3, oldLeafId: u4 });
	assert.doesNotMatch(place(h), /⑂/);
});

it("replacement first-user roots show the mark, reconstruct on reload/resume, and hide on return", (t) => {
	const h = harness(t);
	const original = h.manager.appendMessage(user("original first message"));
	h.fire("session_start", { reason: "startup" });
	assert.doesNotMatch(place(h), /⑂/);
	h.manager.resetLeaf();
	const replacement = h.manager.appendMessage(user("replacement first message"));
	h.fire("session_tree", { newLeafId: replacement, oldLeafId: original });
	assert.match(place(h), /⑂ fork #2$/);
	for (const reason of ["reload", "resume"]) {
		h.fire("session_start", { reason });
		assert.match(place(h), /⑂ fork #2$/, reason);
	}
	h.manager.branch(original);
	h.fire("session_tree", { newLeafId: original, oldLeafId: replacement });
	assert.doesNotMatch(place(h), /⑂/);
	h.fire("session_start", { reason: "resume" });
	assert.doesNotMatch(place(h), /⑂/);
});

it("a new branch appended without a tree event shows its mark from the current leaf", (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	branchTree(h);
	assert.match(place(h), /⑂ fork #2$/);
});

it("a fork made after navigating to an ancestor is numbered by creation order without another tree event", (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	const { u1 } = branchTree(h);
	h.manager.branch(u1);
	h.manager.appendMessage(user("ancestor fork"));
	assert.match(place(h), /⑂ fork #2$/);
	h.manager.branch(u1);
	h.manager.appendMessage(user("second ancestor fork"));
	assert.match(place(h), /⑂ fork #3$/);
});

it("session_start with reason resume and reload rebuilds the branch mark from the current leaf", (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	const { u3 } = branchTree(h);
	h.fire("session_start", { reason: "resume" });
	assert.match(place(h), /⑂ fork #2$/);
	h.manager.branch(u3);
	h.fire("session_start", { reason: "reload" });
	assert.doesNotMatch(place(h), /⑂/);
});

it("the branch mark is dropped whole on narrow widths, never cut", (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	branchTree(h);
	assert.match(place(h, 80), /⑂ fork #2$/);
	for (let width = 1; width <= 80; width++) {
		const row = place(h, width);
		if (row.includes("⑂")) assert.match(row, /⑂ fork #2$/, `width ${width}`);
	}
	assert.doesNotMatch(place(h, 12), /⑂/);
});

it("an editor installed by another extension is kept on install and on /statusbar off", async (t) => {
	const h = harness(t);
	const foreign = () => ({ render: () => ["foreign editor"] });
	h.ui.setEditorComponent(foreign);
	h.ui.calls.splice(0);
	h.fire("session_start", { reason: "startup" });
	assert.equal(h.ui.getEditorComponent(), foreign);
	assert.equal(h.ui.calls.includes("setEditorComponent"), false, "the foreign editor is not replaced");
	assert.equal(h.ui.footerComponent!.render(80).length, 3, "the context row stays in the footer");
	await h.command("off");
	assert.equal(h.ui.getEditorComponent(), foreign);
	assert.equal(h.ui.calls.includes("setEditorComponent"), false, "off does not remove a foreign editor");
});

it("a foreign editor replacing ours is never taken over and survives /statusbar off and on", async (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	const foreign = () => ({ render: () => ["foreign editor"] });
	h.ui.setEditorComponent(foreign);
	await h.command("off");
	assert.equal(h.ui.getEditorComponent(), foreign);
	h.ui.calls.splice(0);
	await h.command("on");
	assert.equal(h.ui.getEditorComponent(), foreign, "on does not take the editor over");
	assert.equal(h.ui.calls.includes("setEditorComponent"), false);
});

it("our editor hides the native working row and restores the indicator on off and shutdown", async (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	assert.equal((h.ui.editor as unknown as { embedWorkingStatus: boolean }).embedWorkingStatus, true);
	assert.deepEqual(h.ui.workingIndicator, { frames: [] });
	await h.command("off");
	assert.equal(h.ui.workingIndicator, undefined);
	await h.command("on");
	assert.deepEqual(h.ui.workingIndicator, { frames: [] });
	h.fire("session_shutdown", { reason: "quit" });
	assert.equal(h.ui.workingIndicator, undefined);

	const f = harness(t);
	f.ui.setEditorComponent(() => ({ render: () => ["foreign"] }));
	f.fire("session_start", { reason: "startup" });
	assert.equal(f.ui.calls.includes("setWorkingIndicator"), false);
});

it("editor replacement restores native indicator settings and our editor hides it again", (t) => {
	const h = harness(t);
	h.fire("session_start", { reason: "startup" });
	const ours = h.ui.editorFactory;
	h.fire("agent_start");
	h.ui.setEditorComponent(() => ({ render: () => ["foreign"] }));
	h.tick(SHIMMER_MS * 10);
	assert.equal(h.ui.workingIndicator, undefined);
	h.ui.setEditorComponent(ours);
	h.tick(SHIMMER_MS);
	assert.deepEqual(h.ui.workingIndicator, { frames: [] });
	h.fire("agent_settled", { aborted: false });
	h.ui.setEditorComponent(() => ({ render: () => ["foreign"] }));
	h.tick(1000);
	h.fire("agent_start");
	assert.equal(h.ui.workingIndicator, undefined);
});

it("the bar never calls setWorkingVisible or any global status setter", async (t) => {
	const h = harness(t);
	const p = new Producer(h.bus, { agents: 1 });
	h.fire("session_start", { reason: "startup" });
	h.fire("agent_start");
	h.fire("tool_execution_start", { toolCallId: "t1", toolName: "bash", args: { command: "npm test" } });
	h.fire("session_before_compact", before());
	h.fire("session_compact", { reason: "manual", willRetry: false, fromExtension: false, compactionEntry: {} });
	h.fire("agent_settled", { aborted: false });
	push(p.source, { agents: 0 });
	await h.command("off");
	await h.command("on");
	h.fire("session_shutdown", { reason: "quit" });
	const allowed = ["setWidget", "setFooter", "setEditorComponent", "getEditorComponent", "setWorkingIndicator"];
	assert.deepEqual([...new Set(h.ui.calls)].filter((call) => !allowed.includes(call)), []);
});

it("non-TUI modes read no UI, session name, tree or settings and open no subscriptions", async (t) => {
	const reads = { tree: 0, leaf: 0, entries: 0 };
	const manager = {
		getSessionId: () => "id",
		getLeafId: () => { reads.leaf++; return null; },
		getTree: () => { reads.tree++; return []; },
		getEntries: () => { reads.entries++; return []; },
		getEntryCount: () => { reads.entries++; return 0; },
	};
	const h = harness(t, { mode: "print", manager });
	h.fire("session_start", { reason: "startup" });
	h.fire("session_tree", { newLeafId: null, oldLeafId: null });
	h.fire("agent_start");
	h.fire("agent_end", { messages: [] });
	h.fire("agent_settled", { aborted: false });
	h.fire("session_info_changed", { name: "x" });
	h.fire("session_before_compact", before());
	h.fire("session_compact", { reason: "manual", willRetry: false, fromExtension: false, compactionEntry: {} });
	await h.command("on");
	assert.deepEqual(h.ui.calls, []);
	assert.deepEqual(h.pi.reads, { sessionName: 0, settings: 0, thinking: 0 });
	assert.deepEqual(reads, { tree: 0, leaf: 0, entries: 0 });
	assert.deepEqual(h.bus.emitted, []);
	assert.equal(h.ui.renders, 0);
});

it("normal widget path: the activity widget is registered before the footer, and the footer is installed and drawn", async (t) => {
	const h = harness(t, { widget: "normal" });
	new Producer(h.bus, { agents: 0 });
	h.fire("session_start", { reason: "startup" });
	const order = h.ui.calls.filter((call) => call === "setWidget" || call === "setFooter" || call === "setEditorComponent");
	assert.deepEqual(order, ["setWidget", "setEditorComponent", "setFooter"], "activity widget first, then editor and footer");
	assert.ok(h.ui.widgets.has(ACTIVITY_KEY), "the activity widget is registered");
	assert.ok(h.ui.footerComponent, "the footer is installed");
	assert.ok(h.ui.footerComponent.render(80).length > 0, "the footer draws rows");
	assert.equal(top(h), idleTop(h), "the editor top border is ours");
});

it("throwing setWidget: the footer and the editor still install, off restores stock and shutdown disposes cleanly", async (t) => {
	const h = harness(t, { widget: "throws" });
	const p = new Producer(h.bus, { agents: 1 });
	h.fire("session_start", { reason: "startup" });
	assert.ok(h.ui.calls.includes("setWidget"), "the activity call was attempted");
	assert.ok(h.ui.calls.indexOf("setWidget") < h.ui.calls.indexOf("setFooter"), "the attempt came before the footer");
	assert.ok(h.ui.footerComponent, "the footer is installed despite the widget error");
	assert.ok(h.ui.footerComponent.render(80).length > 0, "the footer draws rows");
	assert.ok(h.ui.editor, "our editor is installed despite the widget error");
	assert.equal(top(h), idleTop(h), "widget failure never moves activity into the border");
	assert.equal(h.ui.widgets.has(ACTIVITY_KEY), false, "no activity widget was stored");
	assert.equal(p.source.listeners.size, 1, "counts are still subscribed");

	await h.command("off");
	assert.equal(h.ui.footerComponent, undefined, "off restores the stock footer although the widget throws");
	assert.equal(h.ui.editor, undefined, "off restores the stock editor");
	assert.equal(h.bus.listeners(COUNTS_OFFER), 0, "off releases the offer listener");
	assert.equal(p.source.listeners.size, 0, "off releases the source listener");
	const quiet = h.ui.renders;
	h.tick(GIT_POLL_MS * 2);
	assert.equal(h.ui.renders, quiet, "off leaves no git poll timer");

	await h.command("on");
	assert.ok(h.ui.footerComponent, "on installs the footer again");
	assert.ok(h.ui.editor, "on installs the editor again");
	const shut = h.ui.footerComponent!;
	h.fire("session_shutdown", { reason: "quit" });
	assert.deepEqual(shut.render(80), [], "shutdown disposes the footer");
	assert.equal(h.bus.listeners(COUNTS_OFFER), 0, "shutdown releases the offer listener");
	assert.equal(p.source.listeners.size, 0, "shutdown releases the source listener");
	const after = h.ui.renders;
	h.tick(SHIMMER_MS * 10);
	assert.equal(h.ui.renders, after, "no shimmer or poll timer survives shutdown");
});

it("absent setWidget: the footer and the editor still install, off restores stock and shutdown disposes cleanly", async (t) => {
	const h = harness(t, { widget: "absent" });
	const p = new Producer(h.bus, { agents: 1 });
	h.fire("session_start", { reason: "startup" });
	assert.equal(h.ui.calls.includes("setWidget"), false, "the absent method records no call");
	assert.ok(h.ui.footerComponent, "the footer is installed without setWidget");
	assert.ok(h.ui.footerComponent.render(80).length > 0, "the footer draws rows");
	assert.ok(h.ui.editor, "our editor is installed without setWidget");
	assert.equal(top(h), idleTop(h), "a missing widget never moves activity into the border");
	assert.equal(p.source.listeners.size, 1, "counts are still subscribed");

	await h.command("off");
	assert.equal(h.ui.footerComponent, undefined, "off restores the stock footer without setWidget");
	assert.equal(h.ui.editor, undefined, "off restores the stock editor");
	assert.equal(p.source.listeners.size, 0, "off releases the source listener");

	await h.command("on");
	assert.ok(h.ui.footerComponent, "on installs the footer again");
	const shut = h.ui.footerComponent!;
	h.fire("session_shutdown", { reason: "quit" });
	assert.deepEqual(shut.render(80), [], "shutdown disposes the footer");
	assert.equal(h.bus.listeners(COUNTS_OFFER), 0, "shutdown releases the offer listener");
	assert.equal(p.source.listeners.size, 0, "shutdown releases the source listener");
});
