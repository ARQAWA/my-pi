import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { AgentSession, createEventBus } from "@earendil-works/pi-coding-agent";
import agent from "../../../extensions/RQW-agent/index.ts";
import { registerHerdrHold } from "../../../extensions/RQW-agent/herdr-state.ts";
import { registerRealFinal } from "../../../extensions/RQW-agent/real-final.ts";

type Hook = (event: any, ctx: any) => unknown;
const tick = () => new Promise(resolve => setImmediate(resolve));

/** A copy of herdr's own integration rules: agent_start is work, agent_settled is idle when Pi is idle. */
function fakeHerdr(file: string, states: string[]) {
	const handlers = new Map<string, Hook[]>();
	const on = (name: string, hook: Hook) => handlers.set(name, [...handlers.get(name) ?? [], hook]);
	on("agent_start", () => { states.push("working"); });
	on("agent_settled", (_event, ctx) => { if (ctx.isIdle() === true) states.push("idle"); });
	return { path: `/home/user/.pi/agent/extensions/${file}`, resolvedPath: `/home/user/.pi/agent/extensions/${file}`, handlers };
}

function setEnv(t: TestContext, value: string | undefined) {
	const prior = process.env.HERDR_ENV;
	if (value === undefined) delete process.env.HERDR_ENV; else process.env.HERDR_ENV = value;
	t.after(() => { if (prior === undefined) delete process.env.HERDR_ENV; else process.env.HERDR_ENV = prior; });
}

function counts() {
	let listener = (_value: unknown) => {};
	const state = { agents: 0, backgroundProcesses: 0 };
	const source = { version: 1, snapshot: () => ({ ...state }), subscribe: (next: typeof listener) => { listener = next; return () => {}; } };
	return { state, source, changed: () => listener(source.snapshot()) };
}

function rig(t: TestContext, options: { env?: string; file?: string; runner?: boolean; mode?: string } = {}) {
	setEnv(t, "env" in options ? options.env : "1");
	const states: string[] = [];
	const herdr = fakeHerdr(options.file ?? "herdr-agent-state.ts", states);
	const original = herdr.handlers.get("agent_settled")![0];
	const background = counts();
	const waits = { open: 0 };
	const events = createEventBus();
	events.on("rqw:running-counts:request", (request: any) => request.reply(background.source));
	const hooks = new Map<string, Hook[]>();
	const pi: any = { events, on: (name: string, hook: Hook) => hooks.set(name, [...hooks.get(name) ?? [], hook]) };
	const gate = registerRealFinal(pi, running => running || waits.open > 0);
	registerHerdrHold(pi, gate);
	const manager = { getSessionId: () => "main" };
	const session: any = Object.assign(Object.create(AgentSession.prototype), { sessionManager: manager, _isAgentRunActive: false,
		...(options.runner === false ? {} : { _extensionRunner: { extensions: [herdr] } }) });
	const ctx: any = { mode: options.mode ?? "tui", sessionManager: manager, isIdle: () => session.isIdle };
	// Pi runs the loaded extensions in order: herdr's handler first, then ours.
	const emit = async (name: string, event: object = {}) => {
		for (const hook of herdr.handlers.get(name)?.slice() ?? []) await hook(event, ctx);
		for (const hook of hooks.get(name) ?? []) await hook(event, ctx);
	};
	return {
		states, herdr, original, background, waits, gate, emit,
		begin: async () => { await emit("session_start", { reason: "startup" }); },
		start: async () => { session._isAgentRunActive = true; await emit("agent_start"); },
		settle: async () => { session._isAgentRunActive = false; await emit("agent_settled", { aborted: false }); },
	};
}

test("herdr dot stays working while a background job runs and goes idle at the real final", async t => {
	const f = rig(t);
	await f.begin(); await f.start();
	f.background.state.backgroundProcesses = 1; f.background.changed();
	await f.settle(); await tick();
	assert.deepEqual(f.states, ["working"]);
	f.background.state.backgroundProcesses = 0; f.background.changed();
	await tick();
	assert.deepEqual(f.states, ["working", "idle"]);
});

test("herdr dot goes idle at the end of the turn when nothing runs, as stock", async t => {
	const f = rig(t);
	await f.begin(); await f.start(); await f.settle();
	assert.deepEqual(f.states, ["working", "idle"]);
});

test("herdr dot is released when a wait is cancelled without any count change", async t => {
	const f = rig(t);
	await f.begin(); await f.start();
	f.waits.open = 1;
	await f.settle(); await tick();
	assert.deepEqual(f.states, ["working"]);
	f.waits.open = 0; f.gate.poke();
	await tick();
	assert.deepEqual(f.states, ["working", "idle"]);
});

test("nothing is wrapped without HERDR_ENV", async t => {
	const f = rig(t, { env: undefined });
	await f.begin(); await f.start();
	f.background.state.backgroundProcesses = 1; f.background.changed();
	assert.equal(f.herdr.handlers.get("agent_settled")![0], f.original);
	await f.settle();
	assert.deepEqual(f.states, ["working", "idle"]);
});

test("only the herdr integration file is wrapped", async t => {
	const f = rig(t, { file: "another-extension.ts" });
	await f.begin(); await f.start();
	f.background.state.backgroundProcesses = 1; f.background.changed();
	assert.equal(f.herdr.handlers.get("agent_settled")![0], f.original);
});

test("an unknown Pi runner shape leaves herdr as stock", async t => {
	const f = rig(t, { runner: false });
	await f.begin(); await f.start();
	f.background.state.backgroundProcesses = 1; f.background.changed();
	await f.settle();
	assert.deepEqual(f.states, ["working", "idle"]);
});

test("a headless session is left as stock", async t => {
	const f = rig(t, { mode: "rpc" });
	await f.begin(); await f.start();
	f.background.state.backgroundProcesses = 1; f.background.changed();
	assert.equal(f.herdr.handlers.get("agent_settled")![0], f.original);
});

test("shutdown reports the deferred idle at once and restores the herdr handler", async t => {
	const f = rig(t);
	await f.begin(); await f.start();
	f.background.state.backgroundProcesses = 1; f.background.changed();
	await f.settle(); await tick();
	assert.notEqual(f.herdr.handlers.get("agent_settled")![0], f.original);
	await f.emit("session_shutdown");
	assert.deepEqual(f.states, ["working", "idle"]);
	assert.equal(f.herdr.handlers.get("agent_settled")![0], f.original);
});

function gateRig() {
	const background = counts();
	const waits = { open: 0 };
	const events = createEventBus();
	events.on("rqw:running-counts:request", (request: any) => request.reply(background.source));
	const hooks = new Map<string, Hook[]>();
	const pi: any = { events, on: (name: string, hook: Hook) => hooks.set(name, [...hooks.get(name) ?? [], hook]) };
	const gate = registerRealFinal(pi, running => running || waits.open > 0);
	const emit = (name: string, event: object = {}) => { for (const hook of hooks.get(name) ?? []) hook(event, {}); };
	emit("session_start");
	return { gate, background, waits, emit, runs: [] as string[] };
}

test("a deferred action runs once, when the last background work ends", async () => {
	const f = gateRig();
	f.background.state.agents = 1; f.background.changed();
	f.gate.defer("dot", () => f.runs.push("idle"));
	await tick();
	assert.deepEqual(f.runs, []);
	f.background.state.agents = 0; f.background.changed();
	await tick();
	f.background.changed(); await tick();
	assert.deepEqual(f.runs, ["idle"]);
});

test("a deferred action runs at once when nothing is held", () => {
	const f = gateRig();
	f.gate.defer("dot", () => f.runs.push("idle"));
	assert.deepEqual(f.runs, ["idle"]);
});

test("a new agent turn cancels the deferred action", async () => {
	const f = gateRig();
	f.background.state.backgroundProcesses = 1; f.background.changed();
	f.gate.defer("dot", () => f.runs.push("idle"));
	f.emit("agent_start");
	f.background.state.backgroundProcesses = 0; f.background.changed();
	await tick();
	assert.deepEqual(f.runs, []);
});

test("the same key replaces the deferred action, drop removes it", async () => {
	const f = gateRig();
	f.waits.open = 1;
	f.gate.defer("dot", () => f.runs.push("first"));
	f.gate.defer("dot", () => f.runs.push("second"));
	f.gate.defer("other", () => f.runs.push("dropped"));
	f.gate.drop("other");
	f.waits.open = 0; f.gate.poke();
	await tick();
	assert.deepEqual(f.runs, ["second"]);
});

test("a poke without a count change runs the action once the hold ends", async () => {
	const f = gateRig();
	f.waits.open = 1;
	f.gate.defer("dot", () => f.runs.push("idle"));
	f.gate.poke(); await tick();
	assert.deepEqual(f.runs, []);
	f.waits.open = 0; f.gate.poke();
	await tick();
	assert.deepEqual(f.runs, ["idle"]);
});

test("settlement recomputes the hold", async () => {
	const f = gateRig();
	f.waits.open = 1;
	f.gate.defer("dot", () => f.runs.push("idle"));
	f.waits.open = 0; f.emit("agent_settled");
	await tick();
	assert.deepEqual(f.runs, ["idle"]);
});

test("a hold change that ends in a new turn in the same step does not run the action", async () => {
	const f = gateRig();
	f.waits.open = 1;
	f.gate.defer("dot", () => f.runs.push("idle"));
	f.waits.open = 0; f.gate.poke();
	f.waits.open = 1;
	await tick();
	assert.deepEqual(f.runs, []);
});

test("shutdown runs the deferred actions", () => {
	const f = gateRig();
	f.waits.open = 1;
	f.gate.defer("dot", () => f.runs.push("idle"));
	f.emit("session_shutdown");
	assert.deepEqual(f.runs, ["idle"]);
});

test("a failing deferred action does not break the gate", async () => {
	const f = gateRig();
	f.waits.open = 1;
	f.gate.defer("a", () => { throw new Error("socket"); });
	f.gate.defer("b", () => Promise.reject(new Error("socket")));
	f.gate.defer("c", () => f.runs.push("c"));
	f.waits.open = 0; f.gate.poke();
	await tick();
	assert.deepEqual(f.runs, ["c"]);
});

function wired(t: TestContext) {
	setEnv(t, "1");
	const root = mkdtempSync(join(tmpdir(), "rqw-herdr-"));
	const codex = process.env.CODEX_HOME, agentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.CODEX_HOME = join(root, "codex"); process.env.PI_CODING_AGENT_DIR = join(root, "pi");
	t.after(() => { if (codex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = codex; if (agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = agentDir; rmSync(root, { recursive: true, force: true }); });
	const states: string[] = [];
	const herdr = fakeHerdr("herdr-agent-state.ts", states);
	const background = counts();
	const events = createEventBus();
	events.on("rqw:running-counts:request", (request: any) => request.reply(background.source));
	const hooks = new Map<string, Hook[]>();
	const manager = { getSessionId: () => "main", getEntries: () => [], getBranch: () => [], getSessionFile: () => undefined, getLeafEntry: () => undefined };
	const session: any = Object.assign(Object.create(AgentSession.prototype), { sessionManager: manager, agent: new Agent(), _isAgentRunActive: false, _extensionRunner: { extensions: [herdr] } });
	const ctx: any = { cwd: root, mode: "tui", sessionManager: manager, isIdle: () => session.isIdle, signal: undefined, ui: { notify() {}, setStatus() {} } };
	const pi: any = { events, on: (name: string, hook: Hook) => hooks.set(name, [...hooks.get(name) ?? [], hook]), registerCommand() {}, registerTool() {}, registerEntryRenderer() {}, getThinkingLevel: () => "off", getActiveTools: () => [] };
	agent(pi);
	const emit = async (name: string, event: object = {}) => {
		for (const hook of herdr.handlers.get(name)?.slice() ?? []) await hook(event, ctx);
		for (const hook of hooks.get(name) ?? []) await hook(event, ctx);
	};
	const turnWithBackground = async () => {
		await emit("session_start", { reason: "startup" });
		session._isAgentRunActive = true; await emit("agent_start");
		background.state.backgroundProcesses = 1; background.changed();
		session._isAgentRunActive = false; await emit("agent_settled", { aborted: false });
		await tick();
	};
	return { states, background, events, emit, turnWithBackground };
}

test("the agent extension wires the herdr hold to the real final", async t => {
	const f = wired(t);
	await f.turnWithBackground();
	assert.deepEqual(f.states, ["working"]);
	f.background.state.backgroundProcesses = 0; f.background.changed();
	await tick();
	assert.deepEqual(f.states, ["working", "idle"]);
	await f.emit("session_shutdown");
});

test("stopping the background through the coordinator releases the herdr dot", async t => {
	const f = wired(t);
	await f.turnWithBackground();
	assert.deepEqual(f.states, ["working"]);
	f.events.emit("rqw:stop-background:v1", { sessionId: "main", reply: () => {} });
	await tick();
	assert.deepEqual(f.states, ["working", "idle"]);
	await f.emit("session_shutdown");
});
