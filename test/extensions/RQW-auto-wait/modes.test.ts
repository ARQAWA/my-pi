import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { AgentSession, createAgentSession, createEventBus, DefaultResourceLoader, SessionManager, SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import autoWait from "../../../extensions/RQW-auto-wait/index.ts";

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

/** A faux provider that plays the replies in order and records every request it gets. */
function provider(replies: string[]) {
	const core = createFauxCore({ provider: "auto-wait-test", models: [{ id: "model" }] });
	const model = core.getModel("model")!;
	const requests: any[] = [];
	core.setResponses(replies.map(text => (context: any) => { requests.push(context); return fauxAssistantMessage(text, { timestamp: 1 }); }));
	const modelRuntime: any = {
		getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true,
		getAuth: async () => ({ apiKey: "fake" }), checkAuth: async () => ({}), isUsingOAuth: () => false,
		getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [],
		streamSimple: (selected: any, context: any, options: any) => core.streamSimple(selected, context, options),
		getProviderHeaders: () => undefined,
	};
	return { model, requests, modelRuntime };
}

/** One direct agent that is alive until `finish()`, offered to RQW-auto-wait the way RQW-agent offers its source. */
function agentSource() {
	let listener: (value: true | null) => void = () => {};
	let live = true, ready = false, reserved = false, delivered = false, claims = 0;
	const source = {
		version: 1,
		snapshot: () => ({ targets: live ? ["agent#1"] : [], ready }),
		subscribe(fn: typeof listener) { listener = fn; return () => { listener = () => {}; }; },
		claim() {
			claims++;
			if (!ready || reserved || delivered) return undefined;
			reserved = true;
			return { token: "token", results: [{ id: "agent#1", run: "run", delivery: "delivery", outcome: "completed", text: "child answer" }] };
		},
		commit() { reserved = false; delivered = true; },
		release() { reserved = false; },
	};
	return {
		source, finish() { live = false; ready = true; listener(true); },
		claims: () => claims, delivered: () => delivered, reserved: () => reserved,
	};
}

/** A real Pi session with the real extension; `mode` is what the entry point of print, json or rpc tells the extensions. */
async function build(t: TestContext, mode: "print" | "json" | "rpc", replies: string[], before: ((pi: ExtensionAPI) => void)[] = []) {
	const root = await mkdtemp(join(tmpdir(), "rqw-auto-wait-"));
	const faux = provider(replies);
	const child = agentSource();
	const events = createEventBus();
	const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } } as never);
	const offer = (pi: ExtensionAPI) => { pi.events.on("rqw:auto-wait:request:v1", (request: any) => request.offer(child.source)); };
	const loader = new DefaultResourceLoader({
		cwd: root, agentDir: root, settingsManager, eventBus: events,
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		systemPromptOverride: () => "system", extensionFactories: [...before, autoWait, offer],
	} as never);
	await loader.reload();
	const { session } = await createAgentSession({ cwd: root, modelRuntime: faux.modelRuntime, model: faux.model as never, resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(root) });
	await session.bindExtensions({ mode });
	const runner = (session as any)._extensionRunner;
	t.after(async () => {
		await runner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
		await rm(root, { recursive: true, force: true });
	});
	const entries = () => session.sessionManager.getBranch() as any[];
	return {
		session, events, child, requests: faux.requests, runner,
		results: () => entries().filter(entry => entry.type === "custom_message" && entry.customType === "rqw-auto-wait-results"),
		cards: () => entries().filter(entry => entry.type === "custom" && entry.customType === "rqw-auto-wait-v1"),
		sessionId: () => session.sessionManager.getSessionId(),
	};
}

/** Starts the prompt the way print mode does and reports whether the process would already exit. */
function start(world: Awaited<ReturnType<typeof build>>) {
	const state = { settled: false };
	const run = world.session.prompt("go").then(() => { state.settled = true; });
	return { state, run };
}

for (const mode of ["print", "json"] as const) {
	test(`${mode}: the turn stays open while a direct agent lives and ends after its result is answered`, async t => {
		const world = await build(t, mode, ["started", "final"]);
		const { state, run } = start(world);
		await flush();
		assert.equal(world.requests.length, 1);
		assert.equal(state.settled, false, "print and json would exit here and lose the result");
		world.child.finish();
		await run;
		assert.equal(world.requests.length, 2);
		assert.match(JSON.stringify(world.requests[1].messages), /child answer/);
		assert.equal(world.results().length, 1);
		assert.equal(world.results()[0].display, false);
		assert.equal(world.child.delivered(), true);
		assert.equal(world.cards().length, 0, "no wait card outside the terminal screen");
	});

	test(`${mode}: an abort releases the hold, keeps the agent alive and nothing is delivered later`, async t => {
		const original = Object.getOwnPropertyDescriptor(AgentSession.prototype, "abort")!;
		const world = await build(t, mode, ["started", "never"]);
		assert.notEqual(Object.getOwnPropertyDescriptor(AgentSession.prototype, "abort")?.value, original.value, "the abort wrapper is on while the extension lives");
		const { state, run } = start(world);
		await flush();
		assert.equal(state.settled, false);
		await world.session.abort();
		await run;
		assert.equal(world.requests.length, 1);
		world.child.finish();
		await flush();
		assert.equal(world.requests.length, 1, "a settled print or json turn is not woken afterwards");
		assert.equal(world.child.reserved(), false);
		assert.equal(world.child.delivered(), false);
		await world.runner.emit({ type: "session_shutdown", reason: "quit" });
		assert.equal(Object.getOwnPropertyDescriptor(AgentSession.prototype, "abort")?.value, original.value, "the abort wrapper is removed at shutdown");
	});

	const releases: [string, (world: Awaited<ReturnType<typeof build>>) => unknown][] = [
		["session_shutdown", world => world.runner.emit({ type: "session_shutdown", reason: "quit" })],
		["rqw:stop-background:v1", world => world.events.emit("rqw:stop-background:v1", { sessionId: world.sessionId(), reply() {} })],
		["a new session", world => world.runner.emit({ type: "session_start", reason: "new" })],
		["a tree change", world => world.runner.emit({ type: "session_tree", newLeafId: null, oldLeafId: null })],
	];
	for (const [name, release] of releases) {
		test(`${mode}: ${name} releases the hold`, async t => {
			const world = await build(t, mode, ["started", "never"]);
			const { state, run } = start(world);
			await flush();
			assert.equal(state.settled, false);
			await release(world);
			await run;
			assert.equal(world.requests.length, 1);
			assert.equal(world.results().length, 0);
		});
	}

	test(`${mode}: a result another handler already continues for does not start a hold`, async t => {
		let first = true;
		const other = (pi: ExtensionAPI) => pi.on("agent_before_settle", event => {
			if (!first) return undefined;
			first = false;
			return { entries: [...event.entries, { type: "custom_message" as const, customType: "other-note", content: "note", display: false }], continue: true };
		});
		const world = await build(t, mode, ["one", "two"], [other]);
		const { state, run } = start(world);
		await flush();
		assert.equal(world.requests.length, 2, "the first boundary went on without waiting for the agent");
		assert.equal(state.settled, false, "the second boundary holds for the live agent");
		await world.session.abort();
		await run;
		assert.equal(world.results().length, 0);
	});

	test(`${mode}: an incompatible abort shape leaves the turn unheld and the prototype alone`, async t => {
		const original = Object.getOwnPropertyDescriptor(AgentSession.prototype, "abort")!;
		Object.defineProperty(AgentSession.prototype, "abort", { ...original, writable: false });
		t.after(() => Object.defineProperty(AgentSession.prototype, "abort", original));
		const world = await build(t, mode, ["started"]);
		const { state, run } = start(world);
		await run;
		assert.equal(state.settled, true);
		assert.equal(world.requests.length, 1);
		assert.equal(Object.getOwnPropertyDescriptor(AgentSession.prototype, "abort")?.value, original.value);
	});
}

test("rpc: a result is delivered when Pi is idle, without a wait card", async t => {
	const names = ["prompt", "sendCustomMessage", "abort"] as const;
	const originals = names.map(name => Object.getOwnPropertyDescriptor(AgentSession.prototype, name)!.value);
	const world = await build(t, "rpc", ["started", "final"]);
	await world.session.prompt("go");
	assert.equal(world.requests.length, 1, "rpc keeps the client able to write while the agent runs");
	world.child.finish();
	await flush();
	await world.session.waitForIdle();
	assert.equal(world.requests.length, 2);
	assert.match(JSON.stringify(world.requests[1].messages), /child answer/);
	assert.equal(world.results().length, 1);
	assert.equal(world.child.delivered(), true);
	assert.equal(world.cards().length, 0);
	await world.runner.emit({ type: "session_shutdown", reason: "quit" });
	assert.deepEqual(names.map(name => Object.getOwnPropertyDescriptor(AgentSession.prototype, name)!.value), originals, "the prototypes are restored at shutdown");
});
