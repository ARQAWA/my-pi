import { descriptions } from "./extensions/RQW-tools/descriptions.ts";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import registerAgent from "../extensions/RQW-agent/index.ts";
import { installRqwTools } from "../extensions/RQW-tools/index.ts";
import { FakeRipgrep } from "./extensions/RQW-tools/rg-fake.ts";
import { adoptSource, takeFrom } from "./extensions/RQW-agent/consumer.ts";

const until = async (done: () => boolean) => {
	for (let i = 0; i < 20000 && !done(); i++) await new Promise(resolve => setImmediate(resolve));
	assert.ok(done());
};

/** What the model sees as results of the child's agents and jobs: the hidden automatic messages. */
const autoBatches = (context: any): string[][] => context.messages.flatMap((message: any) => {
	const text = typeof message.content === "string" ? message.content : (message.content ?? []).map((block: any) => block.text ?? "").join("");
	return text.startsWith("{\"results\"") ? [JSON.parse(text).results.map((item: any) => `${item.id}:${item.outcome}`)] : [];
});
const autoOutcomes = (context: any): string[] => autoBatches(context).flat();

/** One Pi world: a persisted main session, one shared event bus, a faux model and a process that never ends a search by itself. */
async function world(t: TestContext) {
	t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
	const cwd = await mkdtemp(join(tmpdir(), "rqw-reload-jobs-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const fake = new FakeRipgrep();
	const processes: any[] = [];
	const spawn = fake.spawn;
	fake.spawn = (...args: Parameters<typeof spawn>) => { const child = spawn(...args); processes.push(child); return child; };
	fake.install(t);
	fake.handler = () => ({ hang: true });
	const parent = SessionManager.create(cwd, join(cwd, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const core = createFauxCore({ provider: "reload-jobs-test", models: [{ id: "model" }] });
	const model = core.getModel();
	const requests: any[] = [];
	// A child searches once, ends its turn to wait for the job, and finishes only after the job result or the lost notice reached it.
	// `held` keeps the first request after the job's handoff unanswered: the child is then in the middle of its turn.
	const held = { on: false, count: 0, again: false, holdAgain: false, twoJobs: false };
	core.setResponses(Array.from({ length: 40 }, () => async (context: any) => {
		requests.push(context);
		const outcomes = autoOutcomes(context);
		const searches = context.messages.filter((message: any) => message.role === "toolResult").length;
		const againDone = context.messages.some((message: any) => message.role === "toolResult" && message.toolCallId === "again");
		if (outcomes.some(outcome => outcome.endsWith(":exited"))) return fauxAssistantMessage("job finished");
		if (held.again && againDone) {
			if (held.holdAgain) { held.holdAgain = false; await new Promise<never>(() => {}); }
			return fauxAssistantMessage("started the new job, waiting");
		}
		// After the lost notice the child searches again: a new job of the resumed child.
		if (held.again && outcomes.length) return fauxAssistantMessage([fauxToolCall("rqw_rg", { pattern: "again" }, { id: "again" })], { stopReason: "toolUse" });
		if (outcomes.length) return fauxAssistantMessage(`saw ${outcomes.join(",")}`);
		if (searches) {
			if (held.on && held.count++ === 0) await new Promise<never>(() => {});
			return fauxAssistantMessage("started the job, waiting");
		}
		const search = (id: string) => fauxToolCall("rqw_rg", { pattern: "hello" }, { id });
		return fauxAssistantMessage(held.twoJobs ? [search("slow"), search("slower")] : [search("slow")], { stopReason: "toolUse" });
	}));
	const modelRuntime = {
		getModel: () => model, getPhysicalModel: () => model,
		hasConfiguredAuth: () => true, getAuth: async () => ({ apiKey: "fake" }),
		checkAuth: async () => ({}), isUsingOAuth: () => false,
		getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [], streamSimple: core.streamSimple,
	};
	const ctx: any = {
		cwd, sessionManager: parent, model, modelRegistry: { runtime: modelRuntime, find: () => model, hasConfiguredAuth: () => true },
		isIdle: () => true, isProjectTrusted: () => true, getSystemPrompt: () => "parent prompt",
		signal: new AbortController().signal, mode: "tui", ui: { notify() {} },
	};
	const bus = createEventBus();
	/** The extensions of one Pi runtime. As in Pi, its bus subscriptions end and its `pi` goes stale when the runtime is replaced. */
	const load = () => {
		const hooks = new Map<string, ((event: any, ctx: any) => unknown)[]>();
		const tools = new Map<string, any>();
		const subscriptions = new Set<() => void>();
		let stale = false;
		const live = <T>(value: T): T => { if (stale) throw new Error("This extension ctx is stale after session replacement or reload."); return value; };
		const pi: any = {
			events: {
				emit: (channel: string, data: unknown) => bus.emit(live(channel), data),
				on: (channel: string, handler: (data: unknown) => void) => { const off = bus.on(live(channel), handler); subscriptions.add(off); return off; },
			},
			on(name: string, hook: any) { hooks.set(name, [...hooks.get(name) ?? [], hook]); },
			registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand() {}, registerEntryRenderer() {},
			appendEntry: (name: string, data: any) => live(parent).appendCustomEntry(name, data),
			getSettings: () => ({ retry: { enabled: false }, compaction: { enabled: false } }),
			getThinkingLevel: () => "off", getActiveTools: () => ["job"], getAllTools: () => [],
			sendMessage: (message: any) => parent.appendCustomMessageEntry(message.customType, message.content, message.display, message.details),
		};
		installRqwTools(pi, { descriptions });
		registerAgent(pi);
		const emit = async (name: string, event: any) => { for (const hook of hooks.get(name) ?? []) await hook(event, ctx); };
		return {
			pi, hooks, emit,
			call: (id: string, params: any) => tools.get("agent").execute(id, params, ctx.signal, undefined, ctx),
			/** Pi's reload: shutdown handlers, then the old runtime is invalidated. */
			async replace() { await emit("session_shutdown", { reason: "reload" }); stale = true; for (const off of subscriptions) off(); },
		};
	};
	return { cwd, fake, processes, parent, requests, ctx, load, bus, held };
}

/** Starts agent#1, which runs one search that becomes a background job, and waits until the child ends its turn. */
async function startJobChild(t: TestContext, holdTurn = false, twoJobs = false) {
	const w = await world(t);
	w.held.on = holdTurn;
	w.held.twoJobs = twoJobs;
	const first = w.load();
	const source = await adoptSource(first.pi, first.hooks, w.ctx);
	await first.call("start", { action: "start", task: "outer", tools: ["rqw_rg"] });
	await w.fake.started(twoJobs ? 2 : 1);
	t.mock.timers.tick(12_000);
	await until(() => w.requests.length === 2);
	for (let i = 0; i < 40; i++) await new Promise(resolve => setImmediate(resolve));
	return { ...w, first, source };
}

test("after a reload of the main chat a child's running job is not silently gone: its work comes back as a lost result", async t => {
	const w = await startJobChild(t);
	assert.equal(w.requests.length, 2, "the child waits for its job without a request");
	await w.first.replace();
	const second = w.load();
	const source = await adoptSource(second.pi, second.hooks, w.ctx);
	await second.emit("before_agent_start", { systemPromptOptions: { selectedTools: [], hiddenTools: [], sections: {}, skills: [] } });
	const saved: any[] = [];
	const answer = await takeFrom(source, message => { saved.push(message); });
	assert.deepEqual(autoOutcomes(w.requests.at(-1)), ["job#1:lost"]);
	assert.match(answer.details.results[0].text, /saw job#1:lost/);
	await second.emit("session_shutdown", { reason: "shutdown" });
});

test("after a reload in the middle of a child's turn its job is not silently gone either", async t => {
	const w = await startJobChild(t, true);
	await w.first.replace();
	const second = w.load();
	const source = await adoptSource(second.pi, second.hooks, w.ctx);
	await second.emit("before_agent_start", { systemPromptOptions: { selectedTools: [], hiddenTools: [], sections: {}, skills: [] } });
	const answer = await takeFrom(source, () => {});
	assert.deepEqual(autoOutcomes(w.requests.at(-1)), ["job#1:lost"]);
	assert.match(answer.details.results[0].text, /saw job#1:lost/);
	await second.emit("session_shutdown", { reason: "shutdown" });
});

test("a child resumed after a reload that starts a new job stays open until that job's result wakes it", async t => {
	const w = await startJobChild(t);
	w.held.again = true;
	await w.first.replace();
	const second = w.load();
	const source = await adoptSource(second.pi, second.hooks, w.ctx);
	await second.emit("before_agent_start", { systemPromptOptions: { selectedTools: [], hiddenTools: [], sections: {}, skills: [] } });
	const answer: Awaited<ReturnType<typeof takeFrom>>[] = [];
	void takeFrom(source, () => {}).then(result => { answer.push(result); });
	await w.fake.started(2);
	t.mock.timers.tick(12_000);
	await until(() => w.requests.some(request => JSON.stringify(request.messages).includes("started the new job") || request.messages.filter((m: any) => m.role === "toolResult").length === 2));
	for (let i = 0; i < 40; i++) await new Promise(resolve => setImmediate(resolve));
	assert.equal(answer.length, 0, "the running job keeps the child's run open");
	const job = w.processes.at(-1);
	job.stdout.end(); job.stderr.end(); job.emit("close", 1);
	await until(() => answer.length > 0);
	assert.match(answer[0].details.results[0].text, /^job finished/);
	await second.emit("session_shutdown", { reason: "shutdown" });
});

test("a child started after a reload waits for its job and the parent gets the final only after the job's result", async t => {
	const w = await world(t);
	const first = w.load();
	await first.replace();
	const second = w.load();
	const source = await adoptSource(second.pi, second.hooks, w.ctx);
	await second.call("start", { action: "start", task: "outer", tools: ["rqw_rg"] });
	await w.fake.started();
	t.mock.timers.tick(12_000);
	await until(() => w.requests.length === 2);
	const answer: Awaited<ReturnType<typeof takeFrom>>[] = [];
	void takeFrom(source, () => {}).then(result => { answer.push(result); });
	for (let i = 0; i < 40; i++) await new Promise(resolve => setImmediate(resolve));
	assert.equal(answer.length, 0, "the running job keeps the child's run open");
	const job = w.processes.at(-1);
	job.stdout.end(); job.stderr.end(); job.emit("close", 1);
	await until(() => answer.length > 0);
	assert.match(answer[0].details.results[0].text, /^job finished/);
	await second.emit("session_shutdown", { reason: "shutdown" });
});

test("a lost result already in the child's inbox is not reported again when it starts another job and is reloaded again", async t => {
	// Reloaded in the middle of its turn, the child continues straight from its history, before its loop marks anything.
	const w = await startJobChild(t, true, true);
	w.held.again = true;
	w.held.holdAgain = true;
	await w.first.replace();
	const second = w.load();
	await adoptSource(second.pi, second.hooks, w.ctx);
	await second.emit("before_agent_start", { systemPromptOptions: { selectedTools: [], hiddenTools: [], sections: {}, skills: [] } });
	await w.fake.started(3);
	t.mock.timers.tick(12_000);
	// The child is in the middle of its turn: its new job runs, the model request after it is unanswered.
	await until(() => w.requests.length === 4);
	await second.replace();
	assert.deepEqual(autoBatches(w.requests.at(-1)), [["job#1:lost", "job#2:lost"]]);
	const third = w.load();
	const source = await adoptSource(third.pi, third.hooks, w.ctx);
	await third.emit("before_agent_start", { systemPromptOptions: { selectedTools: [], hiddenTools: [], sections: {}, skills: [] } });
	await takeFrom(source, () => {});
	assert.deepEqual(autoBatches(w.requests.at(-1)), [["job#1:lost", "job#2:lost"], ["job#1:lost"]], "only the new job is lost the second time");
	await third.emit("session_shutdown", { reason: "shutdown" });
});
