import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import agent from "../../../extensions/RQW-agent/index.ts";
import { Coordinator } from "../../../extensions/RQW-agent/coordinator.ts";

test("auto source exposes titles only for live targets", () => {
	const coordinator = new Coordinator({ on() {} } as any);
	let active = true;
	coordinator.add({ id: "agent#1", run: "one", active: () => active, title: () => "card design", snapshot: () => ({}) });
	coordinator.add({ id: "agent#2", run: "two", active: () => true, snapshot: () => ({}) });
	const { source, close } = coordinator.autoSource({} as any);
	assert.deepEqual(source.snapshot().titles, { "agent#1": "card design" });
	active = false;
	assert.deepEqual(source.snapshot().titles, {});
	close();
});

test("main source delivers a result once and releases reservations", async t => {
	const root = await mkdtemp(join(tmpdir(), "auto-wait-agent-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const hooks = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	const events = createEventBus();
	const manager = SessionManager.inMemory(root);
	const core = createFauxCore({ provider: "fake", models: [{ id: "model" }] });
	const model = core.getModel("model")!;
	const response = Promise.withResolvers<void>();
	core.setResponses([async () => { await response.promise; return fauxAssistantMessage("answer", { timestamp: 1 }); }]);
	const modelRuntime = {
		getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true,
		getAuth: async () => ({ apiKey: "fake" }), checkAuth: async () => ({}), isUsingOAuth: () => false,
		getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [], streamSimple: core.streamSimple,
	};
	const ctx: any = { cwd: root, sessionManager: manager, model, modelRegistry: { runtime: modelRuntime, find: () => model, hasConfiguredAuth: () => true },
		isIdle: () => true, isProjectTrusted: () => true, getSystemPrompt: () => "prompt", signal: new AbortController().signal, mode: "test", ui: { notify() {} } };
	let definition: any;
	const pi: any = { events, on: (name: string, hook: any) => hooks.set(name, [...hooks.get(name) ?? [], hook]),
		registerTool: (tool: any) => { definition = tool; }, registerCommand() {}, registerEntryRenderer() {},
		appendEntry: (name: string, data: any) => manager.appendCustomEntry(name, data),
		getSettings: () => ({ retry: { enabled: false }, compaction: { enabled: false } }), getThinkingLevel: () => "off", getActiveTools: () => [],
		sendMessage: (message: any) => manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details) };
	agent(pi);
	const emit = async (name: string) => { for (const hook of hooks.get(name) ?? []) await hook({}, ctx); };
	await emit("session_start");
	t.after(() => emit("session_shutdown"));
	let source: any;
	events.emit("rqw:auto-wait:request:v1", { sessionId: manager.getSessionId(), offer: (value: any) => { source = value; } });
	assert.equal(source.version, 1);
	const ready = Promise.withResolvers<void>();
	const unsubscribe = source.subscribe(() => { if (source.snapshot().ready) ready.resolve(); });
	await definition.execute("start", { action: "start", task: "test", title: "card design" }, new AbortController().signal, undefined, ctx);
	assert.deepEqual(source.snapshot().titles, { "agent#1": "card design" });
	response.resolve();
	await ready.promise;
	unsubscribe();
	const claim = source.claim();
	assert.match(claim.results[0].text, /answer/);
	source.release(claim.token);
	const next = source.claim();
	assert.equal(next.results[0].delivery, claim.results[0].delivery);
	source.commit(next.token);
	assert.equal(source.claim(), undefined);
});
