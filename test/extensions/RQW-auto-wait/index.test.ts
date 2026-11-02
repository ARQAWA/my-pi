import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSession, createEventBus } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import autoWait from "../../../extensions/RQW-auto-wait/index.ts";

function setup(t: any, mode = "tui", nativeSend = false) {
	const original = Object.getOwnPropertyDescriptor(AgentSession.prototype, "prompt")!;
	const prompts: any[] = [];
	Object.defineProperty(AgentSession.prototype, "prompt", { ...original, value: function(text: string, options: any) { prompts.push({ text, options }); return Promise.resolve(); } });
	t.after(() => Object.defineProperty(AgentSession.prototype, "prompt", original));
	const events = createEventBus(), hooks = new Map<string, Function[]>(), branch: any[] = [], sent: any[] = [];
	const manager = { getSessionId: () => "main", getLeafId: () => branch.at(-1)?.id ?? null, getBranch: () => branch };
	const ctx: any = { mode, sessionManager: manager, isIdle: () => !session._isAgentRunActive, hasPendingMessages: () => false, abort() {}, signal: new AbortController().signal, ui: { notify() {} } };
	const session: any = Object.assign(Object.create(AgentSession.prototype), { sessionManager: manager, _isAgentRunActive: false });
	let listener: Function = () => {}, ready = false, reserved = false, delivered = false, targets = ["agent#1"], titles: Record<string, string> = {};
	const source = { version: 1, snapshot: () => ({ targets: ready ? [] : targets, titles, ready }),
		subscribe(fn: Function) { listener = fn; return () => { listener = () => {}; }; },
		claim() { if (!ready || reserved || delivered) return; reserved = true; return { token: "token", results: [{ id: "agent#1", run: "run", delivery: "delivery", outcome: "completed", text: "answer" }] }; },
		commit() { reserved = false; delivered = true; }, release() { reserved = false; } };
	events.on("rqw:auto-wait:request:v1", (request: any) => request.offer(source));
	let renderer: Function = () => {};
	const pi: any = { events, getSettings: () => ({ outputPad: 1 }), on: (name: string, fn: Function) => hooks.set(name, [...hooks.get(name) ?? [], fn]),
		registerEntryRenderer: (_type: string, fn: Function) => { renderer = fn; },
		appendEntry: (customType: string, data: any) => { branch.push({ id: `entry-${branch.length}`, type: "custom", customType, data }); },
		sendMessage: (message: any, options: any) => {
			sent.push({ message, options });
			if (nativeSend) void session.sendCustomMessage(message, options).catch(() => {});
			else session._isAgentRunActive = true;
		} };
	autoWait(pi);
	const emit = (name: string, event: any = {}) => { for (const fn of hooks.get(name) ?? []) fn(event, ctx); };
	emit("session_start");
	t.after(() => emit("session_shutdown"));
	return { session, manager, sent, prompts, branch, source, events, emit, renderer: () => renderer, finish() { ready = true; listener(true); },
		setTargets(value: string[], names: Record<string, string> = {}) { targets = value; titles = names; listener(true); },
		save() { const message = sent.at(-1).message; branch.push({ type: "custom_message", id: "saved", customType: message.customType, details: message.details }); },
		delivered: () => delivered, reserved: () => reserved };
}

test("a wait card uses the mockup states, padding and cached width", async t => {
	const f = setup(t);
	f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	assert.equal(f.sent.length, 0);
	const colors: string[] = [];
	const painted: [string, string][] = [];
	let revision = 1;
	const theme = { fg: (role: string, text: string) => { colors.push(role); painted.push([role, text]); return text; }, bg: (role: string, text: string) => { colors.push(`${role}:${revision}`); return text; } };
	const card = f.renderer()(f.branch[0], {}, theme);
	const running = card.render(80);
	assert.equal(running.length, 5);
	assert.equal(running[0], " ".repeat(79));
	assert.match(running[1], /wait 1 agent · waiting/);
	assert.match(running[2], /agent#1/);
	assert.match(running[3], /Waiting for a result/);
	assert.ok(colors.includes("toolPendingBg:1"));
	assert.ok(painted.some(([role, text]) => role === "toolTitle" && text === "wait"));
	assert.ok(painted.some(([role, text]) => role === "dim" && text === "waiting"));
	assert.ok(painted.some(([role, text]) => role === "muted" && text === "agent#1"));
	assert.equal(card.render(80), running);
	const narrow = card.render(9);
	assert.ok(narrow.every((line: string) => visibleWidth(line) <= 9));
	assert.match(narrow[2], /agen/);
	const beforeTheme = card.render(80);
	revision = 2;
	card.invalidate();
	assert.notEqual(card.render(80), beforeTheme);
	assert.ok(colors.includes("toolPendingBg:2"));
	colors.length = 0;
	f.emit("input");
	assert.match(card.render(80).join("\n"), /interrupted by input/);
	assert.ok(colors.includes("warning") && colors.includes("toolPendingBg:2"));
	assert.ok(painted.some(([role, text]) => role === "warning" && text === "interrupted by input"));
	assert.equal(f.branch.length, 2);
});

test("input leaves background jobs working", async t => {
	const f = setup(t);
	f.setTargets(["job#4"]);
	f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	const theme = { fg: (_role: string, text: string) => text, bg: (_role: string, text: string) => text };
	const card = f.renderer()(f.branch[0], {}, theme);
	f.emit("input");
	assert.match(card.render(80).join("\n"), /Work continues\./);
});

test("unchanged active counts do not append card updates", async t => {
	const f = setup(t);
	let counts = { agents: 2, backgroundProcesses: 1, idleAgents: 0 };
	let listener: (value: typeof counts | null) => void = () => {};
	const source = { version: 1, snapshot: () => counts, subscribe(fn: typeof listener) { listener = fn; return () => {}; } };
	f.events.emit("rqw:running-counts:offer", { version: 1, source });
	f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	const entries = f.branch.length;
	listener(counts); await Promise.resolve();
	counts = { ...counts, idleAgents: 1 };
	listener(counts); await Promise.resolve();
	assert.equal(f.branch.length, entries);
	counts = { ...counts, agents: 1 };
	listener(counts); await Promise.resolve();
	assert.equal(f.branch.length, entries + 1);
});

test("multiple ids share a row when they fit", async t => {
	const f = setup(t);
	f.setTargets(["agent#1", "agent#2"]);
	f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	const theme = { fg: (_role: string, text: string) => text, bg: (_role: string, text: string) => text };
	const card = f.renderer()(f.branch[0], {}, theme);
	assert.match(card.render(80)[2], /agent#1 agent#2/);
	assert.equal(card.render(80).length, 5);
});

test("agent titles survive restore and jobs keep only their ids", async t => {
	const f = setup(t);
	f.setTargets(["agent#1", "job#4"], { "agent#1": "system-wide auto-wait design", "job#4": "not shown" });
	f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	const theme = { fg: (_role: string, text: string) => text, bg: (_role: string, text: string) => text };
	const card = f.renderer()(f.branch[0], {}, theme);
	assert.match(card.render(80).join("\n"), /agent#1 system-wide auto-wait design/);
	assert.doesNotMatch(card.render(80).join("\n"), /not shown/);
	assert.ok(card.render(20).every((line: string) => visibleWidth(line) <= 20));
	f.emit("session_tree");
	assert.match(card.render(80).join("\n"), /agent#1 system-wide auto-wait design/);
});

test("a result closes the card with the success background", async t => {
	const f = setup(t);
	f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	const colors: string[] = [];
	const painted: [string, string][] = [];
	const card = f.renderer()(f.branch[0], {}, { fg: (role: string, text: string) => { painted.push([role, text]); return text; }, bg: (role: string, text: string) => { colors.push(role); return text; } });
	f.finish(); await Promise.resolve();
	assert.match(card.render(80)[1], /wait completed/);
	assert.match(card.render(80).join("\n"), /Result received\. The chat continues\./);
	assert.ok(painted.some(([role, text]) => role === "success" && text === "completed"));
	assert.ok(colors.includes("toolSuccessBg"));
});

test("changed targets update the card and replay marks it interrupted", async t => {
	const f = setup(t);
	f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	const theme = { fg: (_role: string, text: string) => text, bg: (_role: string, text: string) => text };
	const card = f.renderer()(f.branch[0], {}, theme);
	f.setTargets(["job#4"]); await Promise.resolve();
	assert.equal(f.branch.length, 2);
	assert.equal(f.branch[1].data.phase, "update");
	assert.match(card.render(80).join("\n"), /job#4/);
	f.emit("session_tree");
	assert.match(card.render(80).join("\n"), /wait interrupted/);
	assert.match(card.render(80).join("\n"), /job#4/);
	assert.equal(f.sent.length, 0);
});

test("settled ready sources send one hidden turn and commit only after saving", async t => {
	const f = setup(t);
	f.finish(); f.emit("agent_settled", { aborted: false });
	await Promise.resolve();
	assert.equal(f.sent.length, 1);
	assert.equal(f.sent[0].options.triggerTurn, true);
	assert.equal(f.sent[0].message.display, false);
	assert.equal(JSON.parse(f.sent[0].message.content).results[0].text, "answer");
	assert.equal(f.reserved(), true);
	f.save(); f.emit("before_provider_request");
	assert.equal(f.delivered(), true);
});

test("a ready result wakes the idle chat when the session leaf changes before the check", async t => {
	const f = setup(t);
	f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	f.branch.push({ id: "child-result", type: "custom" });
	f.finish();
	f.branch.push({ id: "child-finally", type: "custom" });
	f.setTargets(["agent#1"]);
	await Promise.resolve(); await Promise.resolve();
	assert.equal(f.sent.length, 1);
	assert.equal(JSON.parse(f.sent[0].message.content).results[0].text, "answer");
});

test("input before claim wins and input during wake becomes follow-up", async t => {
	const f = setup(t);
	f.emit("agent_settled", { aborted: false }); f.finish(); f.emit("input");
	await Promise.resolve();
	assert.equal(f.sent.length, 0);
	f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	assert.equal(f.sent.length, 1);
	await f.session.prompt("user", { images: ["image"] });
	assert.deepEqual(f.prompts[0], { text: "user", options: { images: ["image"], streamingBehavior: "followUp" } });
	await f.session.prompt("steer", { streamingBehavior: "steer" });
	assert.equal(f.prompts[1].options.streamingBehavior, "steer");
});

test("a completion during a tool call waits for settlement", async t => {
	const f = setup(t);
	f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	f.session._isAgentRunActive = true;
	f.finish(); await Promise.resolve();
	assert.equal(f.sent.length, 0);
	f.session._isAgentRunActive = false;
	f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	assert.equal(f.sent.length, 1);
});

test("rpc delivers like the terminal, without drawing a card", async t => {
	const f = setup(t, "rpc");
	f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	assert.equal(f.branch.length, 0);
	f.finish(); await Promise.resolve();
	assert.equal(f.sent.length, 1);
	assert.equal(f.sent[0].options.triggerTurn, true);
	assert.equal(JSON.parse(f.sent[0].message.content).results[0].text, "answer");
	assert.equal(f.branch.length, 0);
});

test("two ready sources produce one request", async t => {
	const f = setup(t);
	let secondReady = true;
	const second = { version: 1, snapshot: () => ({ targets: [], ready: secondReady }), subscribe: () => () => {},
		claim: () => { if (!secondReady) return; secondReady = false; return { token: "job", results: [{ id: "job#4", outcome: "exited", text: "done" }] }; },
		commit() {}, release() { secondReady = true; } };
	f.events.emit("rqw:auto-wait:offer:v1", { sessionId: "main", source: second });
	f.finish(); f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	assert.equal(f.sent.length, 1);
	assert.deepEqual(JSON.parse(f.sent[0].message.content).results.map((item: any) => item.id), ["agent#1", "job#4"]);
});

test("failed auto-answer start immediately releases the result for an explicit wait", async t => {
	const f = setup(t, "tui", true);
	const start = Promise.withResolvers<void>();
	f.session._startRun = () => start.promise;
	f.finish(); f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	assert.equal(f.reserved(), true);
	start.reject(new Error("preflight failed"));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(f.reserved(), false);
	assert.equal(f.delivered(), false);
	assert.equal(f.source.claim()?.results[0].text, "answer");
});

test("a failed start does not release a saved result", async t => {
	const f = setup(t, "tui", true);
	const start = Promise.withResolvers<void>();
	f.session._startRun = () => start.promise;
	f.finish(); f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	f.save(); start.reject(new Error("after save"));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(f.delivered(), true);
	assert.equal(f.source.claim(), undefined);
});

test("a failed start does not release a result while Pi is busy", async t => {
	const f = setup(t, "tui", true);
	const start = Promise.withResolvers<void>();
	f.session._startRun = () => start.promise;
	f.finish(); f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	f.session._isAgentRunActive = true; start.reject(new Error("busy"));
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(f.reserved(), true);
	f.session._isAgentRunActive = false; f.emit("agent_settled", { aborted: true });
	assert.equal(f.reserved(), false);
});

test("incompatible prompt descriptor leaves native input and waits untouched", t => {
	const descriptor = Object.getOwnPropertyDescriptor(AgentSession.prototype, "prompt")!;
	Object.defineProperty(AgentSession.prototype, "prompt", { ...descriptor, writable: false });
	t.after(() => Object.defineProperty(AgentSession.prototype, "prompt", descriptor));
	const events = createEventBus(), hooks = new Map<string, Function[]>(), warnings: string[] = [], sent: unknown[] = [];
	const pi: any = { events, on: (name: string, fn: Function) => hooks.set(name, [...hooks.get(name) ?? [], fn]),
		registerEntryRenderer() {}, sendMessage: (message: unknown) => sent.push(message) };
	autoWait(pi);
	const ctx = { mode: "tui", sessionManager: { getSessionId: () => "main", getBranch: () => [] }, ui: { notify: (message: string) => warnings.push(message) } };
	for (const fn of hooks.get("session_start") ?? []) fn({}, ctx);
	assert.equal(warnings.length, 1);
	assert.equal(Object.getOwnPropertyDescriptor(AgentSession.prototype, "prompt")?.value, descriptor.value);
	for (const fn of hooks.get("agent_settled") ?? []) fn({ aborted: false }, ctx);
	assert.deepEqual(sent, []);
	for (const fn of hooks.get("session_shutdown") ?? []) fn({}, ctx);
});

test("stopping background work cancels a scheduled wake", async t => {
	const f = setup(t);
	f.emit("agent_settled", { aborted: false }); await Promise.resolve();
	f.finish(); f.events.emit("rqw:stop-background:v1", { sessionId: "main", reply() {} });
	await Promise.resolve();
	assert.equal(f.sent.length, 0);
	assert.equal(f.branch.at(-1).data.reason, "stop");
	const card = f.renderer()(f.branch[0], {}, { fg: (_role: string, text: string) => text, bg: (_role: string, text: string) => text });
	assert.match(card.render(80).join("\n"), /wait interrupted/);
	assert.doesNotMatch(card.render(80).join("\n"), /continues/);
});

test("branch change cancels the scheduled wake", async t => {
	const f = setup(t);
	f.finish(); f.emit("agent_settled", { aborted: false }); f.emit("session_tree");
	await Promise.resolve();
	assert.equal(f.sent.length, 0);
});
