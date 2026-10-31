import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { AgentSession, createEventBus } from "@earendil-works/pi-coding-agent";
import { formatProgramStatus, ProcessTerminal, type ProgramStatus } from "@earendil-works/pi-tui";
import agent from "../../../extensions/RQW-agent/index.ts";
import { registerRealFinal } from "../../../extensions/RQW-agent/real-final.ts";
import { registerTerminalProgressHold } from "../../../extensions/RQW-agent/terminal-progress.ts";

type Hook = (event: any, ctx: any) => unknown;
const tick = () => new Promise(resolve => setImmediate(resolve));
const ON = "\x1b]9;4;3\x07";
const OFF = "\x1b]9;4;0\x07";
const proto = ProcessTerminal.prototype as any;

/** The OSC 9;4 sequences Pi writes to stdout, in order; everything else is dropped. */
function captureProgress(t: TestContext) {
	const progress: string[] = [];
	t.mock.method(process.stdout, "write", (chunk: string) => {
		for (const match of String(chunk).matchAll(/\x1b\]9;4;\d\x07/g)) progress.push(match[0]);
		return true;
	});
	return progress;
}

function captureStatus(t: TestContext) {
	const statuses: string[] = [];
	t.mock.method(process.stdout, "write", (chunk: string) => {
		for (const match of String(chunk).matchAll(/\x1b\]7501;[^\x1b]*\x1b\\/g)) statuses.push(match[0]);
		return true;
	});
	return statuses;
}

function statusTerminal(t: TestContext) {
	const term = terminal(t);
	(term as any).programStatusSupported = true;
	return term;
}

function counts() {
	let listener = (_value: unknown) => {};
	const state = { agents: 0, backgroundProcesses: 0 };
	const source = { version: 1, snapshot: () => ({ ...state }), subscribe: (next: typeof listener) => { listener = next; return () => {}; } };
	return { state, source, changed: () => listener(source.snapshot()) };
}

/** A terminal nobody started: the real class, its timers cleared at the end. */
function terminal(t: TestContext) {
	const instance = new ProcessTerminal();
	t.after(() => { (instance as any).clearProgressInterval(); });
	return instance;
}

function rig(t: TestContext, mode = "tui") {
	const background = counts();
	const events = createEventBus();
	events.on("rqw:running-counts:request", (request: any) => request.reply(background.source));
	const hooks = new Map<string, Hook[]>();
	const pi: any = { events, on: (name: string, hook: Hook) => hooks.set(name, [...hooks.get(name) ?? [], hook]) };
	const waits = { open: 0 };
	const gate = registerRealFinal(pi, running => running || waits.open > 0);
	registerTerminalProgressHold(pi, gate);
	const emit = async (name: string, event: object = {}) => { for (const hook of hooks.get(name) ?? []) await hook(event, { mode }); };
	t.after(() => emit("session_shutdown"));
	const hold = () => { background.state.backgroundProcesses = 1; background.changed(); };
	const release = () => { background.state.backgroundProcesses = 0; background.changed(); };
	return { background, waits, gate, emit, hold, release, begin: () => emit("session_start", { reason: "startup" }) };
}

test("without background work the progress goes out at once, as stock", async t => {
	const progress = captureProgress(t);
	const f = rig(t); await f.begin();
	const term = terminal(t);
	term.setProgress(true);
	term.setProgress(false);
	assert.deepEqual(progress, [ON, OFF]);
});

test("the progress stays on while background work runs and goes out at the real final", async t => {
	const progress = captureProgress(t);
	const f = rig(t); await f.begin();
	const term = terminal(t);
	term.setProgress(true);
	f.hold();
	term.setProgress(false);
	await tick();
	assert.deepEqual(progress, [ON]);
	assert.ok((term as any).progressInterval, "Pi's own keepalive keeps running");
	f.release(); await tick();
	assert.deepEqual(progress, [ON, OFF]);
	assert.equal((term as any).progressInterval, undefined);
});

test("a new progress cancels the deferred end", async t => {
	const progress = captureProgress(t);
	const f = rig(t); await f.begin();
	const term = terminal(t);
	term.setProgress(true);
	f.hold();
	term.setProgress(false);
	term.setProgress(true);
	f.release(); await tick();
	assert.deepEqual(progress, [ON, ON]);
});

test("shutdown sends the deferred end at once and restores Pi's methods", async t => {
	const progress = captureProgress(t);
	const stock = { setProgress: proto.setProgress, start: proto.start };
	const f = rig(t); await f.begin();
	assert.notEqual(proto.setProgress, stock.setProgress);
	const term = terminal(t);
	term.setProgress(true);
	f.hold();
	term.setProgress(false);
	await f.emit("session_shutdown");
	assert.deepEqual(progress, [ON, OFF]);
	assert.equal(proto.setProgress, stock.setProgress);
	assert.equal(proto.start, stock.start);
});

test("after stop() and start() the deferred progress is turned on again", async t => {
	const progress = captureProgress(t);
	const f = rig(t); await f.begin();
	const term = terminal(t);
	term.setProgress(true);
	f.hold();
	term.setProgress(false);
	// A screen mode switch: Pi stops the terminal, which clears the progress, then starts it again.
	term.stop();
	assert.deepEqual(progress, [ON, OFF]);
	term.start(() => {}, () => {});
	t.after(() => term.stop());
	assert.deepEqual(progress, [ON, OFF, ON]);
	f.release(); await tick();
	assert.deepEqual(progress, [ON, OFF, ON, OFF]);
});

test("a process exit with the end still deferred clears the progress through Pi's own exit restore", async t => {
	captureProgress(t);
	const exitWrites: string[] = [];
	// Pi writes the exit sequence with fs.writeSync, which its ES module import only sees after a sync.
	const writeSync = t.mock.method(fs, "writeSync", (_fd: number, data: string) => { exitWrites.push(String(data)); return 0; });
	syncBuiltinESMExports();
	// The mock goes first, then the sync, so no later test or exit writes into this mock.
	t.after(() => { writeSync.mock.restore(); syncBuiltinESMExports(); });
	const f = rig(t); await f.begin();
	const term = terminal(t);
	term.setProgress(true);
	f.hold();
	term.setProgress(false);
	(term as any).restoreOnExit("", "");
	assert.ok(exitWrites.join("").includes(OFF));
});

test("start() adds no progress when nothing is deferred", async t => {
	const progress = captureProgress(t);
	const f = rig(t); await f.begin();
	const term = terminal(t);
	term.setProgress(true);
	term.setProgress(false);
	term.stop();
	term.start(() => {}, () => {});
	t.after(() => term.stop());
	assert.deepEqual(progress, [ON, OFF]);
});

test("start() adds no progress after a new progress cancelled the deferred end", async t => {
	const progress = captureProgress(t);
	const f = rig(t); await f.begin();
	const term = terminal(t);
	f.hold();
	term.setProgress(false);
	term.setProgress(true);
	term.stop();
	term.start(() => {}, () => {});
	t.after(() => term.stop());
	assert.deepEqual(progress, [ON, OFF]);
});

test("a session that is not a TUI leaves the terminal as stock", async t => {
	const stock = { setProgress: proto.setProgress, start: proto.start };
	const f = rig(t, "rpc"); await f.begin();
	assert.equal(proto.setProgress, stock.setProgress);
	assert.equal(proto.start, stock.start);
});

test("an unknown terminal shape leaves Pi as stock", async t => {
	const own = Object.getOwnPropertyDescriptor(proto, "setProgress")!;
	Object.defineProperty(proto, "setProgress", { ...own, value: undefined });
	t.after(() => Object.defineProperty(proto, "setProgress", own));
	const start = proto.start;
	const f = rig(t);
	await f.begin();
	assert.equal(proto.start, start);
});

test("a wrapper left on top of ours stays in place after shutdown, and ours is inert", async t => {
	const stock = proto.setProgress;
	t.after(() => { proto.setProgress = stock; });
	const progress = captureProgress(t);
	const f = rig(t); await f.begin();
	const ours = proto.setProgress;
	const top = function (this: unknown, on: boolean) { return ours.call(this, on); };
	proto.setProgress = top;
	f.waits.open = 1;
	await f.emit("session_shutdown");
	assert.equal(proto.setProgress, top);
	const term = terminal(t);
	term.setProgress(true);
	term.setProgress(false);
	assert.deepEqual(progress, [ON, OFF]);
});

test("idle, done and error wait for the real final, preserving their details", async t => {
	const statuses = captureStatus(t);
	const f = rig(t); await f.begin();
	const term = statusTerminal(t);
	const working: ProgramStatus = { state: "working", app: "pi", message: "Session" };
	term.setProgramStatus(working);
	f.hold();
	for (const state of ["idle", "done", "error"] as const) {
		const resting: ProgramStatus = { state, app: "pi", message: `Result ${state}` };
		term.setProgramStatus(resting);
		assert.deepEqual(statuses, [formatProgramStatus(working)]);
		f.release(); await tick();
		assert.equal(statuses.at(-1), formatProgramStatus(resting));
		statuses.length = 0;
		term.setProgramStatus(working);
		f.hold();
	}
});

test("working and blocked pass through and cancel a deferred status", async t => {
	const statuses = captureStatus(t);
	const f = rig(t); await f.begin();
	const term = statusTerminal(t);
	const working: ProgramStatus = { state: "working", app: "pi" };
	const blocked: ProgramStatus = { state: "blocked", app: "pi", kind: "question", message: "Dialog" };
	f.hold();
	term.setProgramStatus(working);
	term.setProgramStatus({ state: "done", app: "pi" });
	term.setProgramStatus(blocked);
	term.setProgramStatus({ state: "idle", app: "pi", message: "Ready" });
	term.setProgramStatus(working);
	f.release(); await tick();
	assert.deepEqual(statuses, [formatProgramStatus(working), formatProgramStatus(blocked), formatProgramStatus({ state: "working", app: "pi", message: "Ready" }), formatProgramStatus(working)]);
});

test("working and blocked each cancel a deferred status", async t => {
	const statuses = captureStatus(t);
	const f = rig(t); await f.begin();
	const term = statusTerminal(t);
	for (const state of ["working", "blocked"] as const) {
		f.hold();
		term.setProgramStatus({ state: "working", app: "pi" });
		term.setProgramStatus({ state: "done", app: "pi" });
		const next: ProgramStatus = { state, app: "pi" };
		term.setProgramStatus(next);
		statuses.length = 0;
		f.release(); await tick();
		assert.deepEqual(statuses, []);
	}
});

test("closing a dialog during background work returns to working until the real final", async t => {
	const statuses = captureStatus(t);
	const f = rig(t); await f.begin();
	const term = statusTerminal(t);
	const blocked: ProgramStatus = { state: "blocked", app: "pi", kind: "question", message: "Dialog" };
	const done: ProgramStatus = { state: "done", app: "pi", message: "Session" };
	f.hold();
	term.setProgramStatus(blocked);
	term.setProgramStatus(done);
	assert.deepEqual(statuses, [formatProgramStatus(blocked), formatProgramStatus({ ...done, state: "working" })]);
	f.release(); await tick();
	assert.equal(statuses.at(-1), formatProgramStatus(done));
});

test("shutdown sends the deferred status and restores the status method", async t => {
	const statuses = captureStatus(t);
	const stock = proto.setProgramStatus;
	const f = rig(t); await f.begin();
	const term = statusTerminal(t);
	const working: ProgramStatus = { state: "working", app: "pi" };
	const done: ProgramStatus = { state: "done", app: "pi" };
	assert.notEqual(proto.setProgramStatus, stock);
	term.setProgramStatus(working);
	f.hold(); term.setProgramStatus(done);
	assert.deepEqual(statuses, [formatProgramStatus(working)]);
	await f.emit("session_shutdown");
	assert.equal(statuses.at(-1), formatProgramStatus(done));
	assert.equal(proto.setProgramStatus, stock);
});

test("process exit synchronously sends the deferred status", async t => {
	captureStatus(t);
	const writes: string[] = [];
	const writeSync = t.mock.method(fs, "writeSync", (_fd: number, data: string) => { writes.push(String(data)); return 0; });
	syncBuiltinESMExports();
	t.after(() => { writeSync.mock.restore(); syncBuiltinESMExports(); });
	const before = new Set(process.listeners("exit"));
	const f = rig(t); await f.begin();
	const term = statusTerminal(t);
	const done: ProgramStatus = { state: "done", app: "pi", message: "Session" };
	term.setProgramStatus({ state: "working", app: "pi" });
	f.hold(); term.setProgramStatus(done);
	for (const listener of process.listeners("exit")) if (!before.has(listener)) listener(0);
	assert.ok(writes.includes(formatProgramStatus(done)));
});

test("a terminal without a prior working status receives working while held", async t => {
	const statuses = captureStatus(t);
	const f = rig(t); await f.begin();
	const term = statusTerminal(t);
	const idle: ProgramStatus = { state: "idle", app: "pi", message: "Ready" };
	f.hold(); term.setProgramStatus(idle);
	assert.deepEqual(statuses, [formatProgramStatus({ ...idle, state: "working" })]);
	f.release(); await tick();
	assert.equal(statuses.at(-1), formatProgramStatus(idle));
});

test("a screen restart repeats working until the deferred status is released", async t => {
	const statuses = captureStatus(t);
	const f = rig(t); await f.begin();
	const term = statusTerminal(t);
	const working: ProgramStatus = { state: "working", app: "pi" };
	const done: ProgramStatus = { state: "done", app: "pi" };
	term.setProgramStatus(working);
	f.hold(); term.setProgramStatus(done);
	term.stop();
	const oldOverride = process.env.PI_PROGRAM_STATUS;
	process.env.PI_PROGRAM_STATUS = "1";
	t.after(() => { if (oldOverride === undefined) delete process.env.PI_PROGRAM_STATUS; else process.env.PI_PROGRAM_STATUS = oldOverride; });
	term.start(() => {}, () => {});
	t.after(() => term.stop());
	assert.deepEqual(statuses, [formatProgramStatus(working), formatProgramStatus({ state: "clear" }), formatProgramStatus(working)]);
	f.release(); await tick();
	assert.equal(statuses.at(-1), formatProgramStatus(done));
});

test("a new turn cancels the deferred status even at process exit", async t => {
	captureStatus(t);
	const writes: string[] = [];
	const writeSync = t.mock.method(fs, "writeSync", (_fd: number, data: string) => { writes.push(String(data)); return 0; });
	syncBuiltinESMExports();
	t.after(() => { writeSync.mock.restore(); syncBuiltinESMExports(); });
	const before = new Set(process.listeners("exit"));
	const f = rig(t); await f.begin();
	const term = statusTerminal(t);
	term.setProgramStatus({ state: "working" });
	f.hold(); term.setProgramStatus({ state: "done" });
	await f.emit("agent_start");
	for (const listener of process.listeners("exit")) if (!before.has(listener)) listener(0);
	f.release(); await tick();
	assert.deepEqual(writes, []);
});

test("an unsupported terminal receives no status on process exit", async t => {
	captureStatus(t);
	const writes: string[] = [];
	const writeSync = t.mock.method(fs, "writeSync", (_fd: number, data: string) => { writes.push(String(data)); return 0; });
	syncBuiltinESMExports();
	t.after(() => { writeSync.mock.restore(); syncBuiltinESMExports(); });
	const before = new Set(process.listeners("exit"));
	const f = rig(t); await f.begin();
	const term = terminal(t);
	f.hold(); term.setProgramStatus({ state: "done" });
	for (const listener of process.listeners("exit")) if (!before.has(listener)) listener(0);
	assert.deepEqual(writes, []);
});

test("without a hold program status and clear go through as stock", async t => {
	const statuses = captureStatus(t);
	const f = rig(t); await f.begin();
	const term = statusTerminal(t);
	const done: ProgramStatus = { state: "done", app: "pi" };
	const clear: ProgramStatus = { state: "clear" };
	term.setProgramStatus(done); term.setProgramStatus(clear);
	assert.deepEqual(statuses, [formatProgramStatus(done), formatProgramStatus(clear)]);
});

function wired(t: TestContext) {
	const root = mkdtempSync(join(tmpdir(), "rqw-osc94-"));
	const codex = process.env.CODEX_HOME, agentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.CODEX_HOME = join(root, "codex"); process.env.PI_CODING_AGENT_DIR = join(root, "pi");
	t.after(() => { if (codex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = codex; if (agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = agentDir; rmSync(root, { recursive: true, force: true }); });
	const background = counts();
	const events = createEventBus();
	events.on("rqw:running-counts:request", (request: any) => request.reply(background.source));
	const hooks = new Map<string, Hook[]>();
	const manager = { getSessionId: () => "main", getEntries: () => [], getBranch: () => [], getSessionFile: () => undefined, getLeafEntry: () => undefined };
	const session: any = Object.assign(Object.create(AgentSession.prototype), { sessionManager: manager, agent: new Agent(), _isAgentRunActive: false });
	const ctx: any = { cwd: root, mode: "tui", sessionManager: manager, isIdle: () => session.isIdle, signal: undefined, ui: { notify() {}, setStatus() {} } };
	const pi: any = { events, on: (name: string, hook: Hook) => hooks.set(name, [...hooks.get(name) ?? [], hook]), registerCommand() {}, registerTool() {}, registerEntryRenderer() {}, getThinkingLevel: () => "off", getActiveTools: () => [] };
	agent(pi);
	const emit = async (name: string, event: object = {}) => { for (const hook of hooks.get(name) ?? []) await hook(event, ctx); };
	t.after(() => emit("session_shutdown"));
	return { background, events, emit };
}

test("the agent extension wires the terminal progress to the real final and to the coordinator's stop", async t => {
	const progress = captureProgress(t);
	const f = wired(t);
	await f.emit("session_start", { reason: "startup" });
	const term = terminal(t);
	term.setProgress(true);
	f.background.state.backgroundProcesses = 1; f.background.changed();
	term.setProgress(false);
	await tick();
	assert.deepEqual(progress, [ON]);
	f.events.emit("rqw:stop-background:v1", { sessionId: "main", reply: () => {} });
	await tick();
	assert.deepEqual(progress, [ON, OFF]);
});
