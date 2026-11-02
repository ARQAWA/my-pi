import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, createEventBus, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import agentExtension, { registerSessionRuntime } from "../../../extensions/RQW-agent/index.ts";
import { LENGTH_CONTINUE_LIMIT, LENGTH_CONTINUE_TYPE } from "../../../extensions/RQW-agent/length-continue.ts";

type Reply = ReturnType<typeof fauxAssistantMessage>;
const cut = (text = "part"): Reply => fauxAssistantMessage(text, { stopReason: "length", timestamp: 1 });
const done = (text = "done"): Reply => fauxAssistantMessage(text, { timestamp: 1 });
const lookup = (): Reply => fauxAssistantMessage([fauxToolCall("nope", {}, { id: "call-1" })], { stopReason: "toolUse", timestamp: 1 });

/** A faux provider that plays `replies` in order and records every request it gets. */
function provider(replies: Reply[]) {
	const core = createFauxCore({ provider: "length-test", models: [{ id: "model" }] });
	const model = core.getModel("model")!;
	const requests: any[] = [];
	core.setResponses(replies.map(reply => (context: any) => { requests.push(context); return reply; }));
	const modelRuntime: any = {
		getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true,
		getAuth: async () => ({ apiKey: "fake" }), checkAuth: async () => ({}), isUsingOAuth: () => false,
		getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [],
		streamSimple: (selected: any, context: any, options: any) => core.streamSimple(selected, context, options),
		getProviderHeaders: () => undefined,
	};
	return { model, requests, modelRuntime };
}

const noteOf = (request: any) => JSON.stringify(request.messages.at(-1));

async function temp(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "rqw-length-continue-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

/** A child started through the agent tool of the real RQW-agent runtime. */
async function childRun(t: TestContext, replies: Reply[]) {
	const root = await temp(t);
	const faux = provider(replies);
	const hooks = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	const parent = SessionManager.inMemory(root);
	let definition: any;
	const ctx: any = {
		cwd: root, sessionManager: parent, model: faux.model, modelRegistry: { runtime: faux.modelRuntime, find: () => faux.model, hasConfiguredAuth: () => true },
		isIdle: () => true, isProjectTrusted: () => true, getSystemPrompt: () => "original prompt",
		signal: new AbortController().signal, mode: "tui", ui: { notify: () => {} },
	};
	const pi: any = {
		events: createEventBus(), on: (name: string, hook: any) => hooks.set(name, [...hooks.get(name) ?? [], hook]),
		registerTool: (tool: any) => { definition = tool; },
		appendEntry: (name: string, data: any) => parent.appendCustomEntry(name, data),
		getSettings: () => ({ retry: { enabled: false }, compaction: { enabled: false } }),
		getThinkingLevel: () => "off", getActiveTools: () => [],
		sendMessage: (message: any) => parent.appendCustomMessageEntry(message.customType, message.content, message.display, message.details),
	};
	const runtime = registerSessionRuntime(pi, pi.events, false, undefined, undefined, undefined, undefined, undefined, "", undefined);
	t.after(() => runtime.close());
	const execute = (params: any) => definition.execute("call", params, new AbortController().signal, undefined, ctx);
	return {
		requests: faux.requests,
		async run(task: string) {
			await execute({ action: "start", task });
			return (await execute({ action: "wait", ids: ["agent#1"] })).details.results[0];
		},
		send: async (id: string, task: string) => { await execute({ action: "send", id, task }); return (await execute({ action: "wait", ids: [id] })).details.results[0]; },
	};
}

test("a child cut by the output limit continues once and finishes", async t => {
	const child = await childRun(t, [cut(), done()]);
	const result = await child.run("write");
	assert.equal(child.requests.length, 2);
	assert.match(noteOf(child.requests[1]), /cut off by the output limit/);
	assert.equal(result.outcome, "completed");
	assert.match(result.text, /part/);
	assert.match(result.text, /done/);
	assert.doesNotMatch(result.text, /truncated/);
});

test("a child stops with the error after three cuts in a row", async t => {
	const child = await childRun(t, [cut("a"), cut("b"), cut("c"), done("never")]);
	const result = await child.run("write");
	assert.equal(child.requests.length, LENGTH_CONTINUE_LIMIT);
	assert.equal(result.outcome, "error");
	assert.match(result.text, /Response was truncated/);
	assert.doesNotMatch(result.text, /never/);
});

test("a normal turn resets the count of cuts", async t => {
	const child = await childRun(t, [cut(), cut(), lookup(), cut(), cut(), done()]);
	const result = await child.run("write");
	assert.equal(child.requests.length, 6);
	assert.equal(result.outcome, "completed");
});

test("a new run starts the count again", async t => {
	const child = await childRun(t, [cut(), cut(), done("first"), cut(), cut(), done("second")]);
	assert.equal((await child.run("one")).outcome, "completed");
	const second = await child.send("agent#1", "two");
	assert.equal(second.outcome, "completed");
	assert.equal(child.requests.length, 6);
});

/** The main chat: the real RQW-agent extension in a real Pi session. */
async function mainSession(t: TestContext, replies: Reply[]) {
	const root = await temp(t);
	const faux = provider(replies);
	const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } } as never);
	const loader = new DefaultResourceLoader({
		cwd: root, agentDir: root, settingsManager, eventBus: createEventBus(),
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		systemPromptOverride: () => "system", extensionFactories: [agentExtension],
	} as never);
	await loader.reload();
	const { session } = await createAgentSession({ cwd: root, modelRuntime: faux.modelRuntime, model: faux.model as never, resourceLoader: loader, settingsManager, sessionManager: SessionManager.inMemory(root) });
	await session.bindExtensions({});
	t.after(async () => {
		await (session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "shutdown" });
		session.dispose();
	});
	return { session, requests: faux.requests };
}

test("the main chat continues after a cut with a hidden note and finishes", async t => {
	const main = await mainSession(t, [cut(), done()]);
	await main.session.prompt("write");
	assert.equal(main.requests.length, 2);
	const entries = main.session.sessionManager.getBranch() as any[];
	const notes = entries.filter(entry => entry.type === "custom_message" && entry.customType === LENGTH_CONTINUE_TYPE);
	assert.equal(notes.length, 1);
	assert.equal(notes[0].display, false);
	assert.equal(main.session.messages.at(-1)?.role, "assistant");
	assert.equal((main.session.messages.at(-1) as any).stopReason, "stop");
});

test("the main chat stops after three cuts in a row and a new prompt starts the count again", async t => {
	const main = await mainSession(t, [cut(), cut(), cut(), cut(), done("later")]);
	await main.session.prompt("write");
	assert.equal(main.requests.length, 3);
	assert.equal((main.session.messages.at(-1) as any).stopReason, "length");
	await main.session.prompt("again");
	assert.equal(main.requests.length, 5);
	assert.equal((main.session.messages.at(-1) as any).stopReason, "stop");
});
