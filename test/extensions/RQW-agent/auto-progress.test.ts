import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import agent from "../../../extensions/RQW-agent/index.ts";

test("progress during auto-wait is held until input without waking the model", async t => {
	const root = await mkdtemp(join(tmpdir(), "auto-wait-progress-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const hooks = new Map<string, Function[]>(), events = createEventBus(), manager = SessionManager.inMemory(root);
	const core = createFauxCore({ provider: "fake", models: [{ id: "model" }] }), model = core.getModel("model")!;
	const gate = Promise.withResolvers<any>(), entered = Promise.withResolvers<void>();
	core.setResponses([
		...Array.from({ length: 50 }, (_, i) => () => fauxAssistantMessage([fauxToolCall("agent", { action: "status", ids: ["agent#99"] }, { id: `call-${i}` })], { stopReason: "toolUse" })),
		() => { entered.resolve(); return gate.promise; },
	]);
	const runtime = { getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true,
		getAuth: async () => ({ apiKey: "fake" }), checkAuth: async () => ({}), isUsingOAuth: () => false,
		getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [], streamSimple: core.streamSimple };
	const ctx: any = { cwd: root, sessionManager: manager, model, modelRegistry: { runtime, find: () => model, hasConfiguredAuth: () => true },
		isIdle: () => true, isProjectTrusted: () => true, getSystemPrompt: () => "prompt", signal: new AbortController().signal, mode: "test", ui: { notify() {} } };
	let definition: any;
	const sent: any[] = [];
	const pi: any = { events, on: (name: string, fn: Function) => hooks.set(name, [...hooks.get(name) ?? [], fn]),
		registerTool: (tool: any) => { definition = tool; }, registerCommand() {}, registerEntryRenderer() {},
		appendEntry: (type: string, data: unknown) => manager.appendCustomEntry(type, data),
		getSettings: () => ({ retry: { enabled: false }, compaction: { enabled: false } }), getThinkingLevel: () => "off", getActiveTools: () => [],
		sendMessage: (message: any, options: any) => { sent.push({ message, options }); } };
	events.on("rqw:context-fork:v1", (request: any) => request.offer(async () => fauxAssistantMessage("progress", { timestamp: 1 })));
	agent(pi);
	const emit = async (name: string) => { for (const fn of hooks.get(name) ?? []) await fn({}, ctx); };
	await emit("session_start");
	t.after(async () => { gate.resolve(fauxAssistantMessage("done", { timestamp: 1 })); await emit("session_shutdown"); });
	events.emit("rqw:auto-wait:state:v1", { sessionId: manager.getSessionId(), active: true });
	await definition.execute("start", { action: "start", task: "test", tools: [] }, new AbortController().signal, undefined, ctx);
	await entered.promise;
	assert.equal(sent.length, 0);
	events.emit("rqw:auto-wait:state:v1", { sessionId: manager.getSessionId(), active: false });
	await emit("agent_settled");
	assert.equal(sent.length, 0);
	await emit("input");
	assert.equal(sent.length, 1);
	assert.equal(sent[0].message.customType, "agent_progress");
	assert.equal(sent[0].options.triggerTurn, false);
});
