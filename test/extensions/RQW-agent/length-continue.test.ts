import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { AssistantMessageComponent, createAgentSession, createEventBus, DefaultResourceLoader, initTheme, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import agentExtension, { registerSessionRuntime } from "../../../extensions/RQW-agent/index.ts";
import { installCutLine } from "../../../extensions/RQW-agent/cut-line.ts";
import { takeFrom } from "./consumer.ts";
import { LENGTH_CONTINUE_LIMIT, LENGTH_CONTINUE_TYPE } from "../../../extensions/RQW-agent/length-continue.ts";

type Reply = ReturnType<typeof fauxAssistantMessage>;
const cut = (text = "part"): Reply => fauxAssistantMessage(text, { stopReason: "length", timestamp: 1 });
const done = (text = "done"): Reply => fauxAssistantMessage(text, { timestamp: 1 });
const SIGNED = { type: "thinking" as const, thinking: "hmm", thinkingSignature: "sig" };
const cutInThought = (): Reply => fauxAssistantMessage([{ type: "text", text: "part" }, SIGNED], { stopReason: "length", timestamp: 1 });
const cutWithCall = (): Reply => fauxAssistantMessage([{ type: "text", text: "part" }, SIGNED, fauxToolCall("nope", {}, { id: "call-cut" })], { stopReason: "length", timestamp: 1 });
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
	const runtime = registerSessionRuntime(pi, pi.events, false, undefined, undefined, undefined, undefined, "", undefined);
	t.after(() => runtime.close());
	const execute = (params: any) => definition.execute("call", params, new AbortController().signal, undefined, ctx);
	const take = () => takeFrom(runtime.autoSource!()!, message => { parent.appendCustomMessageEntry("rqw-auto-wait-results", message.content, false, message.details); });
	return {
		requests: faux.requests,
		async run(task: string) {
			await execute({ action: "start", task });
			return (await take()).details.results[0];
		},
		async alerts() { return (await execute({ action: "status", ids: ["agent#1"] })).details.statuses[0].alerts as { kind: string }[]; },
		send: async (id: string, task: string) => { await execute({ action: "send", id, task }); return (await take()).details.results[0]; },
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
	assert.deepEqual((await child.alerts()).filter(alert => alert.kind === "error"), [], "a continued cut leaves no error record");
});

test("a child stops with the error after three cuts in a row", async t => {
	const child = await childRun(t, [cut("a"), cut("b"), cut("c"), done("never")]);
	const result = await child.run("write");
	assert.equal(child.requests.length, LENGTH_CONTINUE_LIMIT);
	assert.equal(result.outcome, "error");
	assert.match(result.text, /Response was truncated/);
	assert.doesNotMatch(result.text, /never/);
	assert.equal((await child.alerts()).filter(alert => alert.kind === "error").length, 1, "only the last cut is an error record");
});

test("a child whose third cut holds a tool call stops there instead of asking again", async t => {
	const child = await childRun(t, [cut(), cut(), cutWithCall(), done("never")]);
	const result = await child.run("write");
	assert.equal(child.requests.length, LENGTH_CONTINUE_LIMIT);
	assert.equal(result.outcome, "error");
	assert.match(result.text, /Response was truncated/);
	assert.doesNotMatch(result.text, /never/);
});

test("a cut that ends in a reasoning block is replayed without it", async t => {
	const child = await childRun(t, [cutInThought(), done()]);
	assert.equal((await child.run("write")).outcome, "completed");
	const replayed = child.requests[1].messages.find((message: any) => message.role === "assistant");
	assert.deepEqual(replayed.content.map((part: any) => part.type), ["text"]);
});

test("a cut whose reasoning is followed only by a blank text block is replayed without it", async t => {
	const child = await childRun(t, [fauxAssistantMessage([{ type: "text", text: "part" }, SIGNED, { type: "text", text: " " }], { stopReason: "length", timestamp: 1 }), done()]);
	assert.equal((await child.run("write")).outcome, "completed");
	const replayed = child.requests[1].messages.find((message: any) => message.role === "assistant");
	assert.deepEqual(replayed.content.map((part: any) => part.type), ["text"]);
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
	return { session, requests: faux.requests, root };
}

/** Every assistant message drawn with Pi's own component at the moment the screen gets it, like the chat does. */
function screen(session: any) {
	initTheme();
	const drawn: string[] = [];
	session.subscribe((event: any) => {
		if (event.type === "message_end" && event.message.role === "assistant") drawn.push(new AssistantMessageComponent(event.message).render(80).join("\n"));
	});
	return drawn;
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

test("the main chat whose third cut holds a tool call stops there", async t => {
	const main = await mainSession(t, [cut(), cut(), cutWithCall(), done("never")]);
	await main.session.prompt("write");
	assert.equal(main.requests.length, LENGTH_CONTINUE_LIMIT);
	const last = main.session.messages.at(-1) as any;
	assert.equal(last.stopReason, "length");
	assert.deepEqual(last.content.map((part: any) => part.type), ["text"], "the dropped call leaves no orphaned reasoning");
});

test("a reopened chat draws a continued cut without the line and the last cut with it", async t => {
	const main = await mainSession(t, [cut("one"), cut("two"), cut("three")]);
	await main.session.prompt("write");
	initTheme();
	// What a reopened session reads back from its file.
	const saved = (main.session.sessionManager.getBranch() as any[]).filter(entry => entry.type === "message" && entry.message.role === "assistant")
		.map(entry => new AssistantMessageComponent(JSON.parse(JSON.stringify(entry.message))).render(80).join("\n"));
	assert.equal(saved.length, 3);
	assert.doesNotMatch(saved[0] + saved[1], /truncated/);
	assert.match(saved[2], /Response was truncated before completion/);
});

test("the main screen hides the truncated line of a continued cut and keeps it on the last cut", async t => {
	const proto = AssistantMessageComponent.prototype as any;
	const stock = proto.updateContent;
	const main = await mainSession(t, [cut("one"), cut("two"), cut("three")]);
	const drawn = screen(main.session);
	await main.session.prompt("write");
	assert.equal(drawn.length, 3);
	for (const text of drawn.slice(0, 2)) assert.doesNotMatch(text, /truncated/);
	assert.match(drawn[0], /one/);
	assert.match(drawn[2], /three/);
	assert.match(drawn[2], /Response was truncated before completion/);
	assert.notEqual(proto.updateContent, stock, "the patch is on while the extension lives");
	await (main.session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "shutdown" });
	assert.equal(proto.updateContent, stock, "the patch is removed at shutdown");
});

test("the cut-line patch keeps the session's message for redraws and leaves other shapes alone", () => {
	initTheme();
	const proto = AssistantMessageComponent.prototype as any;
	const stock = proto.updateContent;
	const marked = new WeakSet<object>();
	const undo = installCutLine(message => marked.has(message));
	const message: any = { role: "assistant", content: [{ type: "text", text: "half" }], stopReason: "length", timestamp: 1 };
	marked.add(message);
	const component: any = new AssistantMessageComponent(message);
	assert.equal(component.lastMessage, message);
	assert.doesNotMatch(component.render(80).join("\n"), /truncated/);
	component.invalidate();
	assert.doesNotMatch(component.render(80).join("\n"), /truncated/);
	assert.match(new AssistantMessageComponent({ ...message }).render(80).join("\n"), /truncated/, "an unmarked cut keeps the line");
	undo();
	assert.equal(proto.updateContent, stock);
	const other = { updateContent() {} };
	const original = other.updateContent;
	installCutLine(() => true, other, "2.0.0")();
	assert.equal(other.updateContent, original);
	const missing = {};
	installCutLine(() => true, missing)();
	assert.deepEqual(missing, {});
});
