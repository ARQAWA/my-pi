// Durable children: real Pi 1.4.0 sessions, faux providers, a temporary session directory. A main session is created
// with SessionManager.create, shut down, and the same file is reopened with SessionManager.open. The faux providers
// record every request; waiting goes through events (provider requests, session events, tool entry), not sleeps.
import assert from "node:assert/strict";
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	type Model,
	fauxAssistantMessage as answer,
	fauxProvider,
	fauxToolCall,
	getSystemMessageText,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
	createAgentSession,
	createWriteToolDefinition,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";

import { CONTEXT_FORK, type ContextForkRequest } from "../../../extensions/RQW-agent/progress.ts";

const EXTENSION = join(import.meta.dirname, "../../../extensions/RQW-agent/index.ts");
const SYSTEM = "EXACT";

/** Wakes every waiter whenever something observable happens; a waiter re-checks its own condition. */
class Hub {
	private readonly waiters = new Set<() => void>();
	notify() { for (const waiter of [...this.waiters]) waiter(); }
	until(check: () => boolean, label: string, ms = 10000): Promise<void> {
		if (check()) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => { this.waiters.delete(waiter); reject(new Error(`timeout: ${label}`)); }, ms);
			const waiter = () => {
				if (!check()) return;
				clearTimeout(timer);
				this.waiters.delete(waiter);
				resolve();
			};
			this.waiters.add(waiter);
		});
	}
	/** The promise must finish by itself; a child that is still running must not hold it. */
	within<T>(promise: Promise<T>, label: string, ms = 5000): Promise<T> {
		return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms).unref())]);
	}
}
// A message that must not arrive gets this many event-loop turns, which is how long a started request needs to show up.
async function settle() { for (let i = 0; i < 30; i++) await setImmediate(); }

type Request = { model: string; reasoning?: string; system: string[]; tools: string[]; roles: string[]; texts: string[]; messages: TranscriptContext["messages"] };
function record(context: TranscriptContext, options: SimpleStreamOptions | undefined, model: { id: string }): Request {
	const tools = new Map<string, true>();
	const system: string[] = [], roles: string[] = [], texts: string[] = [];
	for (const m of context.messages) {
		if (m.role === "system") {
			system.push(getSystemMessageText(m));
			for (const t of m.toolsAdded ?? []) tools.set(t.name, true);
			for (const t of m.toolsRemoved ?? []) tools.delete(t.name);
			continue;
		}
		roles.push(m.role);
		if (typeof m.content === "string") texts.push(m.content);
		else for (const c of m.content) if (c.type === "text") texts.push(c.text);
	}
	return { model: model.id, reasoning: options?.reasoning, system, tools: [...tools.keys()].sort(), roles, texts, messages: structuredClone(context.messages) };
}

type Reply = AssistantMessage | ((signal?: AbortSignal) => Promise<AssistantMessage>);
type Scripted = ReturnType<typeof scripted>;
let serial = 0;
/** A faux provider: `rule` decides from the request, else the next queued reply, else `OK`. */
function scripted(hub: Hub, name: string, id: string, provider = `resume-${name}-${serial}`, contextWindow?: number, exactUsage = false) {
	const n = serial++;
	const faux = fauxProvider({ provider, api: `resume-${name}-${n}`, models: [{ id, reasoning: true, ...(contextWindow ? { contextWindow } : {}) }] });
	const state = { faux, requests: [] as Request[], queue: [] as Reply[], rule: undefined as undefined | ((request: Request) => Reply | undefined) };
	const step = async (context: TranscriptContext, options: SimpleStreamOptions | undefined, _s: unknown, model: { id: string }) => {
		const request = record(context, options, model);
		state.requests.push(request);
		const reply = state.rule?.(request) ?? state.queue.shift();
		hub.notify();
		if (!reply) return answer("OK");
		return typeof reply === "function" ? reply(options?.signal) : reply;
	};
	if (exactUsage) {
		// The regular faux transport estimates usage. This transport preserves the scripted response's actual usage, including zero.
		const stream = (model: Model<string>, context: TranscriptContext, options?: SimpleStreamOptions) => {
			const events = createAssistantMessageEventStream();
			queueMicrotask(async () => {
				try {
					const response = await step(context, options, undefined, model);
					const message = { ...response, api: model.api, provider: model.provider, model: model.id,
						...(options?.signal?.aborted ? { stopReason: "aborted" as const } : {}) };
					if (message.stopReason === "error" || message.stopReason === "aborted") events.push({ type: "error", reason: message.stopReason, error: message });
					else events.push({ type: "done", reason: message.stopReason, message });
					events.end(message);
				} catch (error) {
					const message = answer("", { stopReason: "error", errorMessage: String(error) });
					events.push({ type: "error", reason: "error", error: message });
					events.end(message);
				}
			});
			return events;
		};
		Object.assign(faux.provider, { stream, streamSimple: stream });
	} else faux.setResponses(Array.from({ length: 500 }, () => step));
	return state;
}

/** A reply that waits for `release()` or for the abort, which Pi turns into an aborted assistant message. */
function hold(hub: Hub, text = "DONE", usage?: AssistantMessage["usage"]) {
	const waiting = Promise.withResolvers<AssistantMessage>();
	let entered = false, aborted = false;
	return {
		reply: (signal?: AbortSignal) => {
			entered = true;
			signal?.addEventListener("abort", () => { aborted = true; waiting.resolve(answer("")); }, { once: true });
			hub.notify();
			return waiting.promise;
		},
		release: () => waiting.resolve({ ...answer(text), ...(usage ? { usage } : {}) }), entered: () => entered, aborted: () => aborted,
	};
}

const toolUse = (name: string, args: Record<string, unknown>, id: string) => answer([fauxToolCall(name, args, { id })], { stopReason: "toolUse" });

/** A real `write` definition whose execution waits for release; an abort fails it, as a cancelled tool does. */
function heldTool(hub: Hub, cwd: string) {
	const state = { calls: 0, release: () => {} };
	const definition = {
		...createWriteToolDefinition(cwd),
		execute: async (_id: string, _args: unknown, signal?: AbortSignal) => {
			state.calls++;
			const done = Promise.withResolvers<void>();
			state.release = () => done.resolve();
			hub.notify();
			await new Promise<void>((resolve, reject) => {
				done.promise.then(resolve);
				signal?.addEventListener("abort", () => reject(new Error("held write cancelled")), { once: true });
			});
			return { content: [{ type: "text" as const, text: "TOOL_DONE" }], details: undefined };
		},
	};
	return { state, definition };
}

async function world(options: { subContextWindow?: number; exactUsage?: boolean } = {}) {
	const root = await mkdtemp(join(tmpdir(), "rqw-agent-resume-"));
	const agentDir = join(root, "home"), cwd = join(root, "work"), sessions = join(root, "sessions");
	await Promise.all([agentDir, cwd, sessions].map(dir => mkdir(dir)));
	const hub = new Hub();
	const main = scripted(hub, "main", "m"), sub = scripted(hub, "sub", "s", undefined, options.subContextWindow, options.exactUsage), deep = scripted(hub, "deep", "g");
	const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	for (const p of [main, sub, deep]) runtime.registerNativeProvider(p.faux.provider);
	const offered: { tools: unknown[]; policy?: string; fork?: (request: ContextForkRequest) => void; session?: (session: AgentSession) => void } = { tools: [] };
	const open = new Set<Run>();

	async function launch(file?: string): Promise<Run> {
		const manager = file ? SessionManager.open(file, sessions, cwd) : SessionManager.create(cwd, sessions);
		const loader = new DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: [EXTENSION],
			// Public offer channel of RQW-tools: the fixture hands the children its own tool definitions.
			extensionFactories: [pi => {
				pi.events.on(CONTEXT_FORK, request => offered.fork?.(request as ContextForkRequest));
				pi.events.on("rqw-tools:subagent-tools", request => {
					if (offered.tools.length) (request as { offer(factory: () => unknown[]): void }).offer(() => offered.tools);
				});
				// The public session-policy channel: a refusal makes the next child session creation fail.
				pi.events.on("rqw-codex:session-policy", request => {
					if (offered.policy) (request as { error?: string }).error = offered.policy;
					offered.session?.((request as { session: AgentSession }).session);
				});
			}],
			noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const { session } = await createAgentSession({ cwd, agentDir, modelRuntime: runtime, model: main.faux.getModel("m"),
			thinkingLevel: "low", resourceLoader: loader, sessionManager: manager, settingsManager: SettingsManager.inMemory({}) });
		const errors: string[] = [];
		await session.bindExtensions({ mode: "tui", onError: e => errors.push(`${e.event}: ${e.error}`) });
		session.subscribe(() => hub.notify());
		const tool = session.getToolDefinition("agent")!;
		const run: Run = {
			session, errors, file: manager.getSessionFile()!, closed: false,
			call: async params => (await tool.execute("resume", params as never, undefined, undefined, session.extensionRunner.createContext()))
				.content.map(c => c.type === "text" ? c.text : "").join(""),
			delivered: () => session.messages.flatMap(m => m.role === "custom" && m.customType === "agent" && typeof m.content === "string" ? [m.content] : []),
			command: async (name, args = "") => {
				const command = session.extensionRunner.getCommand(name);
				assert.ok(command, `command ${name} is registered`);
				await hub.within(command.handler(args, session.extensionRunner.createCommandContext()), `/${name} returns without waiting for a child`);
			},
		};
		open.add(run);
		return run;
	}
	async function close(run: Run) {
		if (run.closed) return;
		run.closed = true;
		await run.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		run.session.dispose();
		await settle();
	}
	/** A main session whose file exists: Pi writes a session file only after the first assistant message. */
	async function launchPersisted() {
		const run = await launch();
		await run.session.prompt("setup");
		assert.ok(await exists(run.file), "the parent file is flushed");
		return run;
	}
	return {
		root, cwd, hub, main, sub, deep, launch, close, launchPersisted, offered,
		model: (p: Scripted, id: string) => `${p.faux.provider.id}/${id}`,
		start: (run: Run, task = "FIRST", extra: Record<string, unknown> = {}) => run.call({ action: "start", system: SYSTEM, task, model: `${sub.faux.provider.id}/s`, thinking: "high", tools: ["read", "grep"], ...extra }),
		cleanup: async () => { for (const run of open) await close(run); await rm(root, { recursive: true, force: true }); },
	};
}
type Run = { session: AgentSession; errors: string[]; file: string; closed: boolean; call(params: Record<string, unknown>): Promise<string>; delivered(): string[]; command(name: string, args?: string): Promise<void> };
type World = Awaited<ReturnType<typeof world>>;

test("accepted idle send during held preflight compaction persists zero steps across shutdown and resume", async () => {
	const w = await world({ subContextWindow: 20000 });
	const children: AgentSession[] = []; const forks: ContextForkRequest[] = [];
	const summary = Promise.withResolvers<AssistantMessage>();
	w.offered.session = session => { children.push(session); session.subscribe(() => w.hub.notify()); };
	w.offered.fork = request => { forks.push(request); request.offer(() => summary.promise); w.hub.notify(); };
	const progress = (run: Run) => savedRecord(run.session.sessionManager, 1).data.progressSteps;
	try {
		const first = await w.launchPersisted();
		first.session.settingsManager.applyOverrides({ compaction: { enabled: false, reserveTokens: 2000, keepRecentTokens: 1 } });
		const seed = hold(w.hub);
		w.sub.queue.push(...Array.from({ length: 50 }, (_, i) => toolUse("read", { path: "missing" }, `seed-${i}`)), seed.reply);
		await w.start(first, `COUNTED ${"x".repeat(100000)}`, { tools: [] });
		await w.hub.until(() => seed.entered() && forks.length === 1, "50 qualifying responses and pending report");
		assert.equal(progress(first), 50);
		await first.call({ action: "interrupt", id: "agent#1" });
		await w.hub.until(() => children[0].isIdle, "interrupted child becomes idle"); await settle();
		assert.equal(progress(first), 50); assert.equal(forks[0].signal.aborted, true);
		children[0].settingsManager.applyOverrides({ compaction: { enabled: true, reserveTokens: 2000, keepRecentTokens: 1 } });
		const compact = hold(w.hub, "COMPACTION"); w.sub.queue.push(compact.reply);
		assert.equal(await w.hub.within(first.call({ action: "send", id: "agent#1", task: "ACCEPTED DURING COMPACTION" }), "idle send accepted before held compaction finishes"), "agent#1: sent");
		await w.hub.until(compact.entered, "real SDK preflight compaction provider request held");
		assert.equal(progress(first), 0, "accepted communication resets the counter before preflightResult");
		const disk = SessionManager.open(first.file, dirname(first.file), w.cwd);
		assert.equal(savedRecord(disk, 1).data.progressSteps, 0, "reset is durable while compaction remains unfinished");
		summary.resolve(answer("STALE PRE-SEND REPORT")); await settle();
		assert.equal(first.session.messages.some(m => m.role === "custom" && m.customType === "agent_progress"), false);
		assert.equal(compact.aborted(), false, "counter persistence does not interrupt SDK compaction");
		await w.close(first); assert.equal(compact.aborted(), true);
		const second = await w.launch(first.file); const resumed = hold(w.hub);
		w.sub.queue.push(toolUse("read", { path: "missing" }, "fresh-after-resume"), resumed.reply);
		await second.call({ action: "resume", id: "agent#1" });
		await w.hub.until(resumed.entered, "resumed child makes one fresh qualifying response");
		assert.equal(progress(second), 1, "resume starts from the persisted communication reset, not the old 50");
		assert.equal(forks.length, 1); assert.equal(JSON.stringify(second.session.messages).includes("STALE PRE-SEND REPORT"), false);
		assert.deepEqual(second.errors, []);
	} finally { summary.resolve(answer("cleanup")); await w.cleanup(); }
});

test("progress counter survives persisted shutdown/resume and delivered report resets the saved counter", async () => {
	const w = await world();
	const forks: ContextForkRequest[] = [];
	const summary = Promise.withResolvers<AssistantMessage>();
	w.offered.fork = request => { forks.push(request); request.offer(() => summary.promise); w.hub.notify(); };
	const savedSteps = (run: Run) => (run.session.sessionManager.getBranch().findLast(e => e.type === "custom" && e.customType === "rqw-agent-child") as any)?.data.progressSteps;
	try {
		const first = await w.launchPersisted();
		const held = hold(w.hub);
		w.sub.queue.push(...Array.from({ length: 49 }, (_, i) => toolUse("read", { path: "missing" }, `before-${i}`)), held.reply);
		await w.start(first, "COUNTED", { tools: [] });
		await w.hub.until(held.entered, "49 tool-call responses followed by pending model request");
		assert.equal(savedSteps(first), 49); assert.equal(forks.length, 0);
		await w.close(first);
		const second = await w.launch(first.file);
		const next = hold(w.hub);
		w.sub.queue.push(toolUse("read", { path: "missing" }, "after-restart"), next.reply);
		await second.call({ action: "resume", id: "agent#1" });
		await w.hub.until(() => forks.length === 1 && next.entered(), "50th response after Pi restart");
		assert.equal(savedSteps(second), 50);
		assert.equal(forks[0].sessionId, (await childHistories(first.file)).map(h => h.entries.find(e => e.type === "session")?.id)[0]);
		summary.resolve(answer("PERSISTED PROGRESS"));
		await w.hub.until(() => second.session.messages.some(m => m.role === "custom" && m.customType === "agent_progress"), "report delivery");
		assert.equal(savedSteps(second), 0);
		const histories = await childHistories(first.file);
		assert.equal(histories.length, 1);
		assert.equal(JSON.stringify(histories[0].entries).includes("PERSISTED PROGRESS"), false);
		assert.equal(JSON.stringify(histories[0].entries).includes("Summarize what you did"), false);
		await w.close(second);
		const third = await w.launch(first.file); const last = hold(w.hub);
		w.sub.queue.push(toolUse("read", { path: "missing" }, "new-block"), last.reply);
		await third.call({ action: "resume", id: "agent#1" });
		await w.hub.until(last.entered, "new block after another restart");
		assert.equal(savedSteps(third), 1); assert.equal(forks.length, 1);
		assert.deepEqual(third.errors, []);
	} finally { summary.resolve(answer("cleanup")); await w.cleanup(); }
});

test("persisted restart drops an in-flight summary, preserves 50 steps and next triggers only at 100", async () => {
	const w = await world(); const forks: ContextForkRequest[] = [];
	const summaries: ReturnType<typeof Promise.withResolvers<AssistantMessage>>[] = [];
	w.offered.fork = request => {
		const summary = Promise.withResolvers<AssistantMessage>(); summaries.push(summary); forks.push(request);
		request.offer(() => summary.promise); w.hub.notify();
	};
	try {
		const first = await w.launchPersisted(); const held = hold(w.hub);
		w.sub.queue.push(...Array.from({ length: 50 }, (_, i) => toolUse("read", { path: "missing" }, `first-${i}`)), held.reply);
		await w.start(first, "COUNTED", { tools: [] });
		await w.hub.until(() => held.entered() && forks.length === 1, "summary in flight at 50");
		await w.close(first); assert.equal(forks[0].signal.aborted, true);
		summaries[0].resolve(answer("STALE BEFORE RESTART")); await settle();
		const second = await w.launch(first.file); const next = hold(w.hub);
		w.sub.queue.push(...Array.from({ length: 50 }, (_, i) => toolUse("read", { path: "missing" }, `second-${i}`)), next.reply);
		await second.call({ action: "resume", id: "agent#1" });
		await w.hub.until(() => next.entered() && forks.length === 2, "next 50-step boundary after restart");
		const saved = second.session.sessionManager.getBranch().findLast(e => e.type === "custom" && e.customType === "rqw-agent-child") as any;
		assert.equal(saved.data.progressSteps, 100);
		assert.equal(second.session.messages.some(m => m.role === "custom" && m.customType === "agent_progress"), false);
		summaries[1].resolve(answer("CURRENT REPORT"));
		await w.hub.until(() => second.session.messages.some(m => m.role === "custom" && m.customType === "agent_progress"), "current summary delivered");
		assert.equal(JSON.stringify(second.session.messages).includes("STALE BEFORE RESTART"), false);
	} finally { for (const summary of summaries) summary.resolve(answer("cleanup")); await w.cleanup(); }
});

const exists = (path: string) => access(path).then(() => true, () => false);
async function filesUnder(dir: string): Promise<string[]> {
	const names = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
	return names.filter(e => e.isFile()).map(e => join(e.parentPath, e.name));
}
/** Every Pi history file of children of this parent, with its parsed entries. */
async function childHistories(parentFile: string) {
	const out: { file: string; entries: any[] }[] = [];
	for (const file of await filesUnder(`${parentFile}.children`)) {
		if (!file.endsWith(".jsonl")) continue;
		out.push({ file, entries: (await readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line)) });
	}
	return out;
}
const userMessages = (entries: any[]) => entries.filter(e => e.type === "message" && e.message?.role === "user");
/** Exactly one user message FIRST, system EXACT, the chosen model, thinking and tools. */
function assertFirstContext(request: Request, task = "FIRST") {
	assert.deepEqual(request.roles, ["user"], "only the original user message");
	assert.deepEqual(request.texts, [task]);
	assert.deepEqual(request.system, [SYSTEM]);
	assert.equal(request.model, "s");
	assert.equal(request.reasoning, "high");
	assert.deepEqual(request.tools, ["agent", "grep", "read"]);
}
/** A parent with child agent#1 whose first request is pending, shut down while it waits; returns the parent file. */
async function interruptedChild(w: World, task = "FIRST", extra: Record<string, unknown> = {}) {
	const parent = await w.launchPersisted();
	const first = hold(w.hub);
	w.sub.queue.push(first.reply);
	assert.equal(await w.start(parent, task, extra), "agent#1 started");
	await w.hub.until(first.entered, "child request pending");
	await w.close(parent);
	assert.ok(first.aborted(), "shutdown aborted the pending request");
	return parent.file;
}

test("resume action: an interrupted first request is retried with the original single message and settings; completion wakes main", async () => {
	const w = await world();
	try {
		const file = await interruptedChild(w);
		const parent = await w.launch(file);
		await settle();
		assert.equal(w.sub.requests.length, 1, "reopening a parent alone starts nothing");
		const second = hold(w.hub, "RESUMED");
		w.sub.queue.push(second.reply);
		const mainBefore = w.main.requests.length;
		assert.match(await parent.call({ action: "resume", id: "agent#1" }), /agent#1/);
		await w.hub.until(() => w.sub.requests.length === 2, "the resumed request");
		assertFirstContext(w.sub.requests[1]);
		assert.deepEqual(w.sub.requests[1].messages.map(m => m.role).filter(r => r !== "system"), ["user"]);
		await assert.rejects(parent.call({ action: "resume", id: "agent#1" }), /active|running|already|cancel/i);
		await assert.rejects(parent.call({ action: "resume", id: "agent#9" }), /Unknown agent id: agent#9/);
		await settle();
		assert.equal(w.sub.requests.length, 2, "the rejected resume made no request");
		assert.equal(w.main.requests.length, mainBefore, "main is not asked while the child works");
		second.release();
		await w.hub.until(() => parent.delivered().length === 1, "the delivery");
		assert.equal(parent.delivered()[0], "[agent#1] RESUMED");
		await w.hub.until(() => w.main.requests.length === mainBefore + 1, "the main turn woken by the child");
		assert.ok(w.main.requests.at(-1)!.texts.includes("[agent#1] RESUMED"));
		const histories = await childHistories(file);
		assert.equal(histories.length, 1, "one child history file");
		assert.equal(userMessages(histories[0].entries).length, 1, "the retry added no user message");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("explicit resume retries each provider failure only on request and adds no user message", async () => {
	const w = await world();
	try {
		const parent = await w.launchPersisted();
		parent.session.settingsManager.setRetryEnabled(false);
		const success = hold(w.hub, "RECOVERED");
		w.sub.queue.push(
			answer("", { stopReason: "error", errorMessage: "NETWORK DOWN" }),
			answer("", { stopReason: "error", errorMessage: "PROVIDER STILL DOWN" }),
			success.reply,
		);
		await w.start(parent);
		for (const [index, error] of ["NETWORK DOWN", "PROVIDER STILL DOWN"].entries()) {
			await w.hub.until(() => parent.delivered().length === index + 1 && parent.session.isIdle, "failure delivered and main settled");
			assert.equal(parent.delivered()[index], `[agent#1] error: ${error}`);
			const saved = savedRecord(parent.session.sessionManager, 1).data;
			assert.equal(saved.state, "completed");
			assert.equal(saved.result.outcome, "error");
			assert.equal(saved.result.meta.stop, "error");
			await parent.command("resume-agents");
			await parent.session.prompt("unrelated parent request");
			await settle();
			assert.equal(w.sub.requests.length, index + 1, "neither failure delivery, bulk resume nor parent input retries a failed child");
			await assert.rejects(parent.call({ action: "resume", id: "agent#1", task: "NEW" }), /resume does not accept task/);
			assert.equal(await parent.call({ action: "resume", id: "agent#1" }), "agent#1 resumed");
		}
		await w.hub.until(success.entered, "the explicitly requested successful attempt");
		await assert.rejects(parent.call({ action: "resume", id: "agent#1" }), /active or cancellation pending/);
		assert.equal(w.sub.requests.length, 3);
		for (const request of w.sub.requests) assertFirstContext(request);
		success.release();
		await w.hub.until(() => parent.delivered().includes("[agent#1] RECOVERED") && parent.session.isIdle, "success delivered");
		await assert.rejects(parent.call({ action: "resume", id: "agent#1" }), /not interrupted/);
		assert.equal(w.sub.requests.length, 3, "successful completion is not resumable");
		const [history] = await childHistories(parent.file);
		assert.equal(userMessages(history.entries).length, 1, "all attempts use the original user message");
		assert.equal(history.entries.filter(e => e.type === "message" && e.message?.stopReason === "error").length, 2, "failed attempts remain in append-only history");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("explicit resume after durable provider failure preserves earlier turns and tool results without replay", async () => {
	const w = await world();
	try {
		const first = await w.launchPersisted();
		first.session.settingsManager.setRetryEnabled(false);
		const write = createWriteToolDefinition(w.cwd);
		let writes = 0;
		w.offered.tools = [{ ...write, execute: async (...args: Parameters<typeof write.execute>) => {
			writes++;
			return write.execute(...args);
		} }];
		w.sub.queue.push(answer("EARLIER ANSWER"));
		await w.start(first, "EARLIER TASK", { tools: ["write"] });
		await w.hub.until(() => first.delivered().length === 1 && first.session.isIdle, "earlier turn completed");
		w.sub.queue.push(
			toolUse("write", { path: "kept.txt", content: "KEPT RESULT" }, "kept-call"),
			answer("FAILED PARTIAL", { stopReason: "error", errorMessage: "CONNECTION LOST" }),
		);
		await first.call({ action: "send", id: "agent#1", task: "LATEST TASK" });
		await w.hub.until(() => first.delivered().length === 2 && first.session.isIdle, "provider failure after the tool result");
		assert.equal(writes, 1);
		const failedRequest = w.sub.requests.at(-1)!;
		assert.deepEqual(failedRequest.roles, ["user", "assistant", "user", "assistant", "toolResult"]);
		const before = savedRecord(first.session.sessionManager, 1).data;
		const rawBefore = await readFile(before.sessionFile, "utf8");
		await w.close(first);

		const parent = await w.launch(first.file);
		await parent.command("resume-agents");
		await parent.session.prompt("unrelated after reload");
		await settle();
		assert.equal(w.sub.requests.length, 3, "reloading, bulk resume and unrelated input leave the failed child idle");
		assert.equal(await readFile(before.sessionFile, "utf8"), rawBefore, "no child transcript changes before explicit resume");
		const success = hold(w.hub, "DURABLE RECOVERY");
		w.sub.queue.push(success.reply);
		assert.equal(await parent.call({ action: "resume", id: "agent#1" }), "agent#1 resumed");
		await w.hub.until(success.entered, "resumed request from durable history");
		const request = w.sub.requests[3];
		// Reload recreates the system timestamp and JSON persistence omits undefined fields.
		const durableContext = (r: Request) => JSON.parse(JSON.stringify({ ...r,
			messages: r.messages.map(m => m.role === "system" ? { ...m, timestamp: undefined } : m),
		}));
		assert.deepEqual(durableContext(request), durableContext(failedRequest), "same complete context, settings and tool results; no failed partial or synthetic user message");
		assert.equal(writes, 1, "the saved tool result prevents replay");
		assert.equal(await readFile(join(w.cwd, "kept.txt"), "utf8"), "KEPT RESULT");
		success.release();
		await w.hub.until(() => parent.delivered().includes("[agent#1] DURABLE RECOVERY") && parent.session.isIdle, "durable recovery delivered");
		const after = savedRecord(parent.session.sessionManager, 1).data;
		assert.equal(after.sessionFile, before.sessionFile);
		assert.equal(after.runNumber, before.runNumber + 1);
		assert.equal(after.result.outcome, "completed");
		const rawAfter = await readFile(after.sessionFile, "utf8");
		assert.ok(rawAfter.startsWith(rawBefore), "recovery only appends to the durable transcript");
		const [history] = await childHistories(parent.file);
		assert.equal(userMessages(history.entries).length, 2, "only the two explicitly sent tasks exist");
		assert.equal(history.entries.filter(e => e.type === "message" && e.message?.role === "toolResult").length, 1);
		await assert.rejects(parent.call({ action: "resume", id: "agent#1" }), /not interrupted/);
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("explicit resume rejects cancellation pending while a tool ignores the abort", async () => {
	const w = await world();
	const release = Promise.withResolvers<void>();
	try {
		const parent = await w.launchPersisted();
		let entered = false;
		w.offered.tools = [{ ...createWriteToolDefinition(w.cwd), execute: async () => {
			entered = true;
			w.hub.notify();
			await release.promise;
			return { content: [{ type: "text", text: "TOOL_DONE" }], details: undefined };
		} }];
		w.sub.queue.push(toolUse("write", { path: "unused.txt", content: "unused" }, "pending-call"));
		await w.start(parent, "FIRST", { tools: ["write"] });
		await w.hub.until(() => entered, "the abort-ignoring tool entered");
		assert.equal(JSON.parse(await parent.call({ action: "interrupt", id: "agent#1" })).cancellation_requested, true);
		await assert.rejects(parent.call({ action: "resume", id: "agent#1" }), /active or cancellation pending/);
		assert.equal(w.sub.requests.length, 1, "cancellation pending cannot start another request");
	} finally { release.resolve(); await w.cleanup(); }
});

test("completed children are not resumed when the parent continues or by /resume-agents", async () => {
	const w = await world();
	try {
		const first = await w.launchPersisted();
		w.sub.queue.push(answer("ALL DONE"));
		await w.start(first);
		await w.hub.until(() => first.delivered().length === 1, "the delivery");
		await w.hub.until(() => w.main.requests.length === 2, "the wake turn");
		await w.close(first);
		const parent = await w.launch(first.file);
		const mainBefore = w.main.requests.length;
		await parent.session.prompt("continue");
		await parent.command("resume-agents");
		await settle();
		assert.equal(w.sub.requests.length, 1, "no new child request");
		assert.equal(w.main.requests.length, mainBefore + 1, "only the owner's turn asked main");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("a stopped child is unknown after reopening and is never started again", async () => {
	const w = await world();
	try {
		const first = await w.launchPersisted();
		const pending = hold(w.hub);
		w.sub.queue.push(pending.reply);
		await w.start(first);
		await w.hub.until(pending.entered, "child request");
		assert.equal(await first.call({ action: "stop", id: "agent#1" }), "agent#1 stopped");
		await w.hub.until(pending.aborted, "the abort");
		await w.close(first);
		const parent = await w.launch(first.file);
		for (const action of ["send", "resume", "interrupt", "restart"]) {
			await assert.rejects(parent.call({ action, id: "agent#1", task: "x" }), /Unknown agent id: agent#1/, action);
		}
		await parent.session.prompt("continue");
		await parent.command("resume-agents");
		await settle();
		assert.equal(w.sub.requests.length, 1, "no child request after the stop");
	} finally { await w.cleanup(); }
});

test("restart replaces the mapping: resume after reopening uses only the fresh history", async () => {
	const w = await world();
	try {
		const first = await w.launchPersisted();
		const oldRun = hold(w.hub), freshRun = hold(w.hub);
		w.sub.queue.push(oldRun.reply, freshRun.reply);
		await w.start(first, "OLD TASK");
		await w.hub.until(oldRun.entered, "the old request");
		assert.equal(await first.call({ action: "restart", id: "agent#1", task: "NEW TASK" }), "agent#1 restarted");
		await w.hub.until(freshRun.entered, "the fresh request");
		await w.close(first);
		const parent = await w.launch(first.file);
		const resumed = hold(w.hub, "FRESH DONE");
		w.sub.queue.push(resumed.reply);
		await parent.call({ action: "resume", id: "agent#1" });
		await w.hub.until(() => w.sub.requests.length === 3, "the resumed request");
		assertFirstContext(w.sub.requests[2], "NEW TASK");
		assert.ok(!JSON.stringify(w.sub.requests[2].messages).includes("OLD TASK"));
		resumed.release();
		await w.hub.until(() => parent.delivered().length === 1, "the delivery");
		assert.equal(parent.delivered()[0], "[agent#1] FRESH DONE");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("/resume-agents resumes children through the public command and asks main only after the child finishes", async () => {
	const w = await world();
	try {
		const file = await interruptedChild(w);
		const parent = await w.launch(file);
		const second = hold(w.hub, "COMMAND DONE");
		w.sub.queue.push(second.reply);
		const mainBefore = w.main.requests.length;
		await parent.command("resume-agents");
		await w.hub.until(() => w.sub.requests.length === 2, "the resumed request");
		assertFirstContext(w.sub.requests[1]);
		await settle();
		assert.equal(w.main.requests.length, mainBefore, "no main request while the child runs");
		assert.deepEqual(parent.delivered(), []);
		await parent.command("resume-agents");
		await settle();
		assert.equal(w.sub.requests.length, 2, "a second command does not start the active child again");
		second.release();
		await w.hub.until(() => w.main.requests.length === mainBefore + 1, "the main turn woken by the child");
		assert.equal(parent.delivered()[0], "[agent#1] COMMAND DONE");
		assert.ok(w.main.requests.at(-1)!.texts.includes("[agent#1] COMMAND DONE"));
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("continuing the parent session starts an unfinished child mechanically", async () => {
	const w = await world();
	try {
		const file = await interruptedChild(w);
		const parent = await w.launch(file);
		await settle();
		assert.equal(w.sub.requests.length, 1, "opening alone starts nothing");
		const second = hold(w.hub, "CONTINUED");
		w.sub.queue.push(second.reply);
		const mainBefore = w.main.requests.length;
		await parent.session.prompt("continue");
		await w.hub.until(() => w.sub.requests.length === 2, "the child request after continue");
		assertFirstContext(w.sub.requests[1]);
		assert.equal(w.main.requests.length, mainBefore + 1, "main answered only the owner's prompt");
		second.release();
		await w.hub.until(() => parent.delivered().length === 1, "the delivery");
		assert.equal(parent.delivered()[0], "[agent#1] CONTINUED");
		await w.hub.until(() => w.main.requests.length === mainBefore + 2, "the main turn woken by the child");
		assert.equal(w.sub.requests.length, 2);
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("an orphan tool call gets an interrupted error result and is never replayed", async () => {
	const w = await world();
	try {
		const tool = heldTool(w.hub, w.cwd);
		w.offered.tools = [tool.definition];
		const first = await w.launchPersisted();
		w.sub.queue.push(toolUse("write", { path: "a.txt", content: "A" }, "w1"));
		await w.start(first, "FIRST", { tools: ["write"] });
		await w.hub.until(() => tool.state.calls === 1, "the tool is running");
		// What a crash leaves behind: the files exactly as they are while the tool runs.
		const frozen = new Map<string, string>();
		for (const file of [first.file, ...await filesUnder(`${first.file}.children`)]) frozen.set(file, await readFile(file, "utf8"));
		await w.close(first);
		for (const file of await filesUnder(`${first.file}.children`)) if (!frozen.has(file)) await rm(file);
		for (const [file, text] of frozen) await writeFile(file, text);
		const intent = (await childHistories(first.file)).flatMap(h => h.entries).filter(e => e.type === "custom" && /tool-intent/.test(e.customType));
		assert.equal(intent.length, 1, "the execution intent was persisted before the tool ran");
		assert.equal(intent[0].data.toolCallId, "w1");

		const parent = await w.launch(first.file);
		const requestsBefore = w.sub.requests.length;
		w.sub.queue.push(answer("RECOVERED"));
		await parent.call({ action: "resume", id: "agent#1" });
		await w.hub.until(() => parent.delivered().length === 1, "the delivery");
		assert.equal(parent.delivered()[0], "[agent#1] RECOVERED");
		assert.equal(w.sub.requests.length, requestsBefore + 1, "one request, no replayed model attempt");
		const request = w.sub.requests.at(-1)!;
		assert.deepEqual(request.roles, ["user", "assistant", "toolResult"]);
		assert.equal(request.texts[0], "FIRST");
		const result = request.messages.find(m => m.role === "toolResult")!;
		assert.equal(result.toolCallId, "w1");
		assert.equal(result.isError, true);
		assert.match(JSON.stringify(result.content), /[Ii]nterrupted/);
		assert.match(JSON.stringify(result.content), /side effects/);
		assert.equal(tool.state.calls, 1, "the write tool was not called again");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("plain send to a resumed child that is in a tool call queues after the tool; nothing is aborted", async () => {
	const w = await world();
	try {
		const tool = heldTool(w.hub, w.cwd);
		w.offered.tools = [tool.definition];
		const file = await interruptedChild(w, "FIRST", { tools: ["write"] });
		const parent = await w.launch(file);
		w.sub.queue.push(toolUse("write", { path: "b.txt", content: "B" }, "w2"), answer("STEER SEEN"));
		await parent.call({ action: "resume", id: "agent#1" });
		await w.hub.until(() => tool.state.calls === 1, "the tool runs in the resumed run");
		assert.equal(await parent.call({ action: "send", id: "agent#1", task: "STEER NOW" }), "agent#1: queued after the current tool call");
		await settle();
		assert.equal(w.sub.requests.length, 2, "no request before the tool call ends");
		tool.state.release();
		await w.hub.until(() => parent.delivered().length === 1, "the delivery");
		assert.equal(parent.delivered()[0], "[agent#1] STEER SEEN");
		const next = w.sub.requests[2];
		assert.deepEqual(next.roles, ["user", "assistant", "toolResult", "user"], "the steering message follows the tool result");
		assert.deepEqual([next.texts[0], next.texts.at(-1)], ["FIRST", "STEER NOW"]);
		assert.equal(next.messages.find(m => m.role === "toolResult")!.isError, false);
		assert.equal(tool.state.calls, 1);
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("a nested child is restored with its history and takes a follow-up from the restored child", async () => {
	const w = await world();
	try {
		const grandchild = `${w.deep.faux.provider.id}/g`;
		const startNested = toolUse("agent", { action: "start", system: "GRAND", task: "NESTED-G1", model: grandchild, tools: [] }, "n1");
		const sendNested = toolUse("agent", { action: "send", id: "agent#1", task: "NESTED-FOLLOWUP-7" }, "n2");
		const body = (request: Request) => JSON.stringify(request.messages.filter(m => m.role !== "system"));
		const childHeld = hold(w.hub), grandHeld = hold(w.hub);
		w.sub.rule = request => !request.roles.includes("toolResult") ? startNested : childHeld.reply;
		w.deep.rule = () => grandHeld.reply;

		const first = await w.launchPersisted();
		await w.start(first, "FIRST", { tools: [] });
		await w.hub.until(() => childHeld.entered() && grandHeld.entered(), "child and grandchild requests pending");
		await w.close(first);
		const grandRequestsBefore = w.deep.requests.length;

		// Resumed child: send to its nested agent#1, then finish once the follow-up is in its own history.
		w.sub.rule = request => body(request).includes("NESTED-FOLLOWUP-7") ? answer("C-DONE") : sendNested;
		w.deep.rule = undefined;
		const parent = await w.launch(first.file);
		await parent.call({ action: "resume", id: "agent#1" });
		await w.hub.until(() => w.deep.requests.some(r => r.texts.includes("NESTED-FOLLOWUP-7")), "the nested follow-up request");
		const followed = w.deep.requests.find(r => r.texts.includes("NESTED-FOLLOWUP-7"))!;
		assert.ok(w.deep.requests.length > grandRequestsBefore);
		assert.deepEqual(followed.system, ["GRAND"]);
		assert.equal(followed.model, "g");
		assert.equal(followed.texts[0], "NESTED-G1");
		assert.equal(followed.texts.filter(t => t === "NESTED-G1").length, 1, "the nested task exists once");
		assert.equal(followed.texts.filter(t => t === "NESTED-FOLLOWUP-7").length, 1);
		await w.hub.until(() => parent.delivered().some(t => t.includes("C-DONE")), "the restored child's answer reaches main");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("repeated interrupt and resume of the same id in one process: every resume rebuilds from the saved history", async () => {
	const w = await world();
	try {
		const parent = await w.launchPersisted();
		const holds = [hold(w.hub), hold(w.hub), hold(w.hub, "THIRD DONE")];
		w.sub.queue.push(...holds.map(h => h.reply));
		await w.start(parent);
		for (let round = 0; round < 2; round++) {
			await w.hub.until(holds[round].entered, `request ${round + 1} pending`);
			const interrupted = JSON.parse(await parent.call({ action: "interrupt", id: "agent#1" }));
			assert.equal(interrupted.cancellation_requested, true);
			await w.hub.until(holds[round].aborted, `request ${round + 1} aborted`);
			await settle();
			assert.match(await parent.call({ action: "resume", id: "agent#1" }), /agent#1/);
		}
		await w.hub.until(holds[2].entered, "the third request");
		assert.equal(w.sub.requests.length, 3);
		for (const request of w.sub.requests) assertFirstContext(request);
		holds[2].release();
		await w.hub.until(() => parent.delivered().length === 1, "the delivery");
		assert.equal(parent.delivered()[0], "[agent#1] THIRD DONE");
		const [history] = await childHistories(parent.file);
		assert.equal(userMessages(history.entries).length, 1, "no resume added a user message");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("durable sibling agents keep their ids and history and resume without a new user message", async () => {
	const w = await world();
	try {
		const ids = ["agent#1", "agent#2"];
		const first = await w.launchPersisted();
		const holds = ids.map(() => hold(w.hub));
		w.sub.queue.push(...holds.map(h => h.reply));
		for (const [i, id] of ids.entries()) {
			assert.equal(await w.start(first, `WORK ${id}`), `${id} started`);
			await w.hub.until(holds[i].entered, `${id} request pending`);
		}
		const original = new Map(w.sub.requests.map(r => [r.texts[0], r]));
		assert.equal(original.size, 2);
		await w.close(first);

		const parent = await w.launch(first.file);
		await settle();
		assert.equal(w.sub.requests.length, 2, "reopening starts no child");
		const again = ids.map(id => hold(w.hub, `${id} DONE`));
		w.sub.queue.push(...again.map(h => h.reply));
		// Resume both before either finishes, so a completion wake cannot resume its sibling first.
		for (const [i, id] of ids.entries()) {
			assert.match(await parent.call({ action: "resume", id }), new RegExp(id));
			await w.hub.until(again[i].entered, `${id} resumed request`);
			const request = w.sub.requests.at(-1)!, before = original.get(`WORK ${id}`)!;
			assertFirstContext(request, `WORK ${id}`);
			assert.deepEqual([request.system, request.model, request.reasoning, request.tools], [before.system, before.model, before.reasoning, before.tools]);
			await assert.rejects(parent.call({ action: "resume", id }), /active|running|already|cancel/i);
		}
		for (const [i, id] of ids.entries()) {
			again[i].release();
			await w.hub.until(() => parent.delivered().includes(`[${id}] ${id} DONE`), `${id} delivery`);
			assert.equal(parent.delivered().filter(text => text === `[${id}] ${id} DONE`).length, 1);
		}
		await settle();
		assert.equal(w.sub.requests.length, 4, "each child made exactly one resumed request");
		const histories = await childHistories(first.file);
		assert.equal(histories.length, 2, "each sibling keeps its own history");
		const tasks = histories.flatMap(h => userMessages(h.entries).map(e => {
			const content = e.message.content;
			return typeof content === "string" ? content : content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
		}));
		assert.deepEqual(tasks.sort(), ["WORK agent#1", "WORK agent#2"]);
		for (const h of histories) assert.equal(userMessages(h.entries).length, 1);
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("a provider error on a resumed run is delivered as an explicit failure with no silent retry", async () => {
	const w = await world();
	try {
		const file = await interruptedChild(w);
		const parent = await w.launch(file);
		w.sub.queue.push(answer("", { stopReason: "error", errorMessage: "PROVIDER BOOM" }), answer("SILENT RETRY"));
		const mainBefore = w.main.requests.length;
		await parent.call({ action: "resume", id: "agent#1" });
		await w.hub.until(() => parent.delivered().length === 1, "the failure delivery");
		assert.match(parent.delivered()[0], /^\[agent#1\] error: PROVIDER BOOM/);
		await settle();
		assert.equal(w.sub.requests.length, 2, "one resumed request, no retry");
		assertFirstContext(w.sub.requests[1]);
		assert.ok(!parent.delivered().some(t => t.includes("SILENT RETRY")));
		await w.hub.until(() => w.main.requests.length === mainBefore + 1, "the main turn woken by the failure");
		assert.ok(w.main.requests.at(-1)!.texts.some(t => t.includes("PROVIDER BOOM")));
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

for (const history of ["unflushed", "empty"] as const) test(`a task-less restart reopens its ${history} never-run idle child without inference and accepts an explicit send`, async () => {
	const w = await world();
	try {
		const first = await w.launchPersisted();
		w.sub.queue.push(answer("OLD DONE"));
		await w.start(first, "OLD TASK");
		await w.hub.until(() => first.delivered().some(text => text.includes("OLD DONE")), "the previous generation completed");
		assert.equal(await first.call({ action: "restart", id: "agent#1" }), "agent#1 restarted, idle");
		const idle = first.session.sessionManager.getBranch().findLast((entry: any) => entry.type === "custom" && entry.customType === "rqw-agent-child" && entry.data.id === 1) as any;
		assert.equal(idle.data.state, "idle");
		assert.equal(idle.data.runNumber, 0);
		assert.equal(idle.data.task, undefined);
		assert.equal(await exists(idle.data.sessionFile), false, "Pi has not flushed the never-run session");
		if (history === "empty") await writeFile(idle.data.sessionFile, "");
		await w.close(first);

		const before = w.sub.requests.length;
		const parent = await w.launch(first.file);
		const status = JSON.parse(await parent.call({ action: "status", ids: ["agent#1"] })).statuses[0];
		assert.equal(status.id, "agent#1");
		assert.equal(status.state, "idle");
		assert.equal(status.error, undefined);
		await parent.session.prompt("continue");
		await parent.command("resume-agents");
		await settle();
		assert.equal(w.sub.requests.length, before, "reopening and continuing do not infer for an idle child");

		w.sub.queue.push(answer("AFTER SEND"));
		assert.equal(await parent.call({ action: "send", id: "agent#1", task: "NEW TASK" }), "agent#1: sent");
		await w.hub.until(() => parent.delivered().some(text => text.includes("AFTER SEND")), "the explicit send completed");
		assert.equal(w.sub.requests.length, before + 1);
		assertFirstContext(w.sub.requests[before], "NEW TASK");
		const saved = parent.session.sessionManager.getBranch().findLast((entry: any) => entry.type === "custom" && entry.customType === "rqw-agent-child" && entry.data.id === 1) as any;
		const messages = userMessages((await childHistories(first.file)).find(child => child.file === saved.data.sessionFile)!.entries);
		assert.equal(messages.length, 1, "only the explicit send materialized a user message");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("a missing established child history never rebuilds its latest task or repeats its side effect", async () => {
	const w = await world();
	try {
		const realWrite = createWriteToolDefinition(w.cwd);
		let writes = 0;
		w.offered.tools = [{ ...realWrite, execute: async (...args: Parameters<typeof realWrite.execute>) => {
			writes++;
			return realWrite.execute(...args);
		} }];
		const first = await w.launchPersisted();
		const effect = join(w.cwd, "effect.txt");
		w.sub.queue.push(toolUse("write", { path: "effect.txt", content: "ORIGINAL" }, "effect"), answer("FIRST DONE"));
		await w.start(first, "FIRST", { tools: ["write"] });
		await w.hub.until(() => first.delivered().some(text => text.includes("FIRST DONE")), "the established child completed its side effect");
		assert.equal(writes, 1);
		assert.equal(await readFile(effect, "utf8"), "ORIGINAL");
		const latest = hold(w.hub), healthy = hold(w.hub);
		w.sub.queue.push(latest.reply, healthy.reply);
		await first.call({ action: "send", id: "agent#1", task: "LATEST TASK" });
		await w.hub.until(latest.entered, "the later task is in flight");
		await w.start(first, "GOOD");
		await w.hub.until(healthy.entered, "the healthy sibling is in flight");
		const history = first.session.sessionManager.getBranch().findLast((e: any) => e.type === "custom" && e.customType === "rqw-agent-child" && e.data.id === 1) as any;
		assert.equal(history.data.task, "LATEST TASK", "the task marker is not the child's full history");
		await w.close(first);
		await rm(history.data.sessionFile);
		const before = w.sub.requests.length;
		w.sub.rule = request => request.texts.includes("LATEST TASK")
			? request.roles.includes("toolResult") ? answer("REPLAY DONE") : toolUse("write", { path: "effect.txt", content: "REPLAY" }, "replay")
			: undefined;
		w.sub.queue.push(answer("GOOD DONE"));
		const parent = await w.launch(first.file);
		await parent.session.prompt("continue");
		await w.hub.until(() => parent.delivered().some(text => text.includes("GOOD DONE")), "the healthy sibling resumes");
		await settle();
		assert.equal(w.sub.requests.length, before + 1, "only the healthy child requested inference");
		assert.deepEqual(w.sub.requests[before].texts, ["GOOD"]);
		assert.equal(writes, 1, "the established side effect is never replayed");
		assert.equal(await readFile(effect, "utf8"), "ORIGINAL");
		const status = JSON.parse(await parent.call({ action: "status", ids: ["agent#1"] })).statuses[0];
		assert.equal(status.state, "unavailable");
		assert.match(status.error, /ENOENT|missing|unavailable/i);
		await assert.rejects(parent.call({ action: "resume", id: "agent#1" }), /ENOENT|missing|unavailable/i);
		assert.equal(w.sub.requests.length, before + 1, "explicit resume also refuses to invent a history");
		assert.deepEqual((await filesUnder(dirname(history.data.sessionFile))).filter(file => file.endsWith(".jsonl")), [], "no replacement history or user message was created");
		assert.equal(await w.start(parent, "NEW TASK"), "agent#3 started");
		await w.hub.until(() => w.sub.requests.length === before + 2, "new children still start");
		assert.equal(writes, 1);
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

for (const loss of ["missing", "empty"] as const) test(`${loss === "empty" ? "an" : "a"} ${loss} child JSONL without a never-established marker fails closed despite a saved task`, async () => {
	const w = await world();
	try {
		const file = await interruptedChild(w);
		const histories = await childHistories(file);
		for (const history of histories) {
			if (loss === "missing") await rm(history.file);
			else await writeFile(history.file, "");
		}
		assert.equal((await filesUnder(`${file}.children`)).filter(f => f.endsWith(".jsonl")).length, loss === "missing" ? 0 : 1, "only the child history is removed or emptied");
		const before = w.sub.requests.length;
		const parent = await w.launch(file);
		await assert.rejects(parent.call({ action: "resume", id: "agent#1" }), /ENOENT|missing|unavailable/i);
		await parent.command("resume-agents");
		await parent.session.prompt("continue");
		await settle();
		assert.equal(w.sub.requests.length, before, "a saved task alone never authorizes new inference");
		const remaining = await childHistories(file);
		assert.equal(remaining.length, loss === "missing" ? 0 : 1, "no replacement history is created");
		assert.equal(remaining.flatMap(history => userMessages(history.entries)).length, 0, "no user message is created");
		assert.deepEqual(parent.delivered(), []);
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

const savedRecord = (manager: SessionManager, id: number) => manager.getEntries()
	.filter((e: any) => e.type === "custom" && e.customType === "rqw-agent-child" && e.data.id === id).at(-1) as any;

test("an unknown persisted kind is ignored without spawning or deleting its saved data", async () => {
	const w = await world();
	try {
		const first = await w.launchPersisted();
		w.sub.queue.push(answer("DONE"));
		await w.start(first);
		await w.hub.until(() => first.delivered().length === 1, "the known child's delivery");
		await w.hub.until(() => w.main.requests.length === 2, "the completion wake");
		await w.close(first);

		const manager = SessionManager.open(first.file, dirname(first.file), w.cwd);
		const { result: _result, ...saved } = savedRecord(manager, 1).data;
		const unknown = { ...saved, kind: "unknown-kind", id: 77, state: "running", task: "UNKNOWN TASK" };
		const history = await readFile(unknown.sessionFile, "utf8");
		manager.appendCustomEntry("rqw-agent-child", unknown);
		const persisted = savedRecord(manager, 77);
		const before = w.sub.requests.length;

		const parent = await w.launch(first.file);
		await parent.command("resume-agents");
		await parent.session.prompt("continue");
		await settle();
		await assert.rejects(parent.call({ action: "resume", id: "agent#77" }), /Unknown agent id: agent#77/);
		assert.equal(w.sub.requests.length, before, "the unknown kind never starts inference");
		assert.deepEqual(savedRecord(parent.session.sessionManager, 77), persisted, "the ignored entry remains unchanged in the session");
		const entries = (await readFile(first.file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
		assert.deepEqual(entries.find(entry => entry.id === persisted.id), persisted, "the original entry remains on disk");
		assert.equal(await readFile(unknown.sessionFile, "utf8"), history, "the referenced child history remains unchanged on disk");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("saved history above the compaction threshold is summarized before the resumed request, with no synthetic message", async () => {
	const w = await world({ subContextWindow: 20000 });
	try {
		const file = await interruptedChild(w);
		// Saved configuration: a reserve and a kept size that make a 20000 token window compactable and cut at the pending user message, so Pi makes one summary request.
		const parentManager = SessionManager.open(file, dirname(file), w.cwd);
		const saved = savedRecord(parentManager, 1).data;
		parentManager.appendCustomEntry("rqw-agent-child", { ...saved, config: { ...saved.config,
			settings: { ...saved.config.settings, compaction: { enabled: true, reserveTokens: 2000, keepRecentTokens: 1 } } } });
		// Saved child history: finished turns, then the last pending user message. The aborted attempt is hidden first.
		const [{ file: childFile }] = await childHistories(file);
		const child = SessionManager.open(childFile, dirname(childFile), w.cwd);
		for (const entry of child.buildSessionProjection().entries)
			if (entry.messages.some(m => m.role === "assistant" && m.stopReason === "aborted")) child.appendContextEdit(entry.sourceEntry.id, null);
		const model = w.sub.faux.getModel("s");
		const usage = (tokens: number) => ({ input: tokens, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: tokens + 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
		for (let i = 1; i <= 6; i++) {
			child.appendMessage({ role: "user", content: `HISTORY Q${i} ${"x".repeat(8000)}`, timestamp: Date.now() });
			child.appendMessage({ ...answer(`HISTORY A${i} ${"y".repeat(8000)}`), api: model.api, provider: model.provider, model: model.id,
				usage: usage(i === 6 ? 19000 : i * 3000), timestamp: Date.now() });
		}
		child.appendMessage({ role: "user", content: "PENDING", timestamp: Date.now() });

		const parent = await w.launch(file);
		w.sub.queue.push(answer("SUMMARY"), answer("RESUMED"));
		await parent.call({ action: "resume", id: "agent#1" });
		await w.hub.until(() => parent.delivered().length === 1, "the delivery");
		assert.equal(parent.delivered()[0], "[agent#1] RESUMED");
		await settle();
		assert.equal(w.sub.requests.length, 3, "the held first request, one summary request, one resumed request");
		const actual = w.sub.requests[2];
		assert.deepEqual(actual.system, [SYSTEM]);
		assert.equal(actual.model, "s");
		assert.equal(actual.reasoning, "high");
		assert.deepEqual(actual.tools, ["agent", "grep", "read"]);
		assert.equal(actual.roles[0], "user");
		assert.ok(actual.texts[0].includes("SUMMARY"), "the summary opens the context");
		assert.equal(actual.texts.at(-1), "PENDING");
		assert.equal(actual.texts.filter(t => t === "PENDING").length, 1);
		assert.ok(actual.texts.join("").length < 30000, "the old turns are gone from the context");
		assert.ok(actual.texts.every(t => t.includes("SUMMARY") || t.startsWith("HISTORY ") || t === "PENDING"), "no synthetic resume message");
		const [history] = await childHistories(file);
		const compactions = history.entries.filter(e => e.type === "compaction");
		assert.equal(compactions.length, 1);
		assert.match(compactions[0].summary, /SUMMARY/);
		assert.equal(userMessages(history.entries).length, 1 + 6 + 1, "FIRST, six turns and PENDING; nothing added");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("child mappings are branch-local inside one parent file; id numbers are not reused", async () => {
	const w = await world();
	try {
		const first = await w.launchPersisted();
		const before = first.session.sessionManager.getLeafId()!;
		const pending = hold(w.hub);
		w.sub.queue.push(pending.reply);
		await w.start(first);
		await w.hub.until(pending.entered, "child request");
		await w.close(first);

		const parent = await w.launch(first.file);
		assert.match(await parent.call({ action: "status", ids: ["agent#1"] }), /agent#1/, "the child is known on its own branch");
		const manager = parent.session.sessionManager, oldLeaf = manager.getLeafId();
		manager.branch(before);
		await parent.session.extensionRunner.emit({ type: "session_tree", newLeafId: before, oldLeafId: oldLeaf });
		await assert.rejects(parent.call({ action: "resume", id: "agent#1" }), /Unknown agent id: agent#1/);
		await parent.command("resume-agents");
		await settle();
		assert.equal(w.sub.requests.length, 1, "the other branch's child is not started");
		assert.equal(await w.start(parent, "SECOND"), "agent#2 started", "the id high-water mark is session-wide");
		await w.hub.until(() => w.sub.requests.length === 2, "the new child's request");
		assert.deepEqual(w.sub.requests[1].texts, ["SECOND"]);
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("a saved result whose delivery message is missing is delivered by /resume-agents without a child request", async () => {
	const w = await world();
	try {
		const first = await w.launchPersisted();
		w.sub.queue.push(answer("OUTBOX"));
		await w.start(first);
		await w.hub.until(() => first.delivered().length === 1, "the delivery");
		await w.hub.until(() => w.main.requests.length === 2, "the wake turn");
		await w.close(first);
		// The crash window: the child's result metadata is saved, the caller message is not.
		const lines: any[] = (await readFile(first.file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
		const cut = lines.filter(e => e.type === "custom_message" && e.customType === "agent");
		assert.equal(cut.length, 1);
		const parents = new Map(cut.map(e => [e.id, e.parentId]));
		const kept = lines.filter(e => !parents.has(e.id)).map(e => parents.has(e.parentId) ? { ...e, parentId: parents.get(e.parentId) } : e);
		assert.match(JSON.stringify(kept.filter(e => e.type === "custom" && e.customType === "rqw-agent-child").at(-1).data.result), /OUTBOX/);
		await writeFile(first.file, `${kept.map(e => JSON.stringify(e)).join("\n")}\n`);

		const parent = await w.launch(first.file);
		const mainBefore = w.main.requests.length;
		assert.deepEqual(parent.delivered(), []);
		await parent.command("resume-agents");
		await w.hub.until(() => parent.delivered().length === 1, "the saved result is delivered");
		assert.equal(parent.delivered()[0], "[agent#1] OUTBOX");
		await w.hub.until(() => w.main.requests.length === mainBefore + 1, "the main turn woken by the result");
		await parent.command("resume-agents");
		await settle();
		assert.equal(parent.delivered().length, 1, "delivered once");
		assert.equal(w.sub.requests.length, 1, "no child model request");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("a child interrupted by hand in this process is not resumed by a later parent turn; explicit resume works", async () => {
	const w = await world();
	try {
		const parent = await w.launchPersisted();
		const first = hold(w.hub), second = hold(w.hub, "MANUAL RESUME");
		w.sub.queue.push(first.reply, second.reply);
		await w.start(parent);
		await w.hub.until(first.entered, "child request pending");
		assert.equal(JSON.parse(await parent.call({ action: "interrupt", id: "agent#1" })).cancellation_requested, true);
		await w.hub.until(first.aborted, "the abort");
		await settle();
		assert.equal(await parent.call({ action: "interrupt", id: "agent#1" }), "agent#1 is idle");
		const mainBefore = w.main.requests.length;
		await parent.session.prompt("unrelated");
		await settle();
		assert.equal(w.main.requests.length, mainBefore + 1, "main answered the owner's prompt");
		assert.equal(w.sub.requests.length, 1, "the parent turn did not resume the manually interrupted child");
		assert.match(await parent.call({ action: "resume", id: "agent#1" }), /agent#1/);
		await w.hub.until(second.entered, "the explicit resume request");
		assert.equal(w.sub.requests.length, 2);
		assertFirstContext(w.sub.requests[1]);
		second.release();
		await w.hub.until(() => parent.delivered().length === 1, "the delivery");
		assert.equal(parent.delivered()[0], "[agent#1] MANUAL RESUME");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

const statusOf = async (run: Run, id: string) => JSON.parse(await run.call({ action: "status", ids: [id] })).statuses[0];

async function armChildWait(w: World, parent: Run): Promise<string> {
	w.main.queue.push(toolUse("agent", { action: "wait", ids: ["agent#1"], timeout_ms: 10000, wake_on_alert: false }, "usage-wait"));
	await parent.session.prompt("WAIT");
	const saved = parent.session.messages.findLast(m => m.role === "toolResult" && m.toolCallId === "usage-wait");
	assert.ok(saved, "the wait receipt is persisted before the child completes");
	const receipt = JSON.parse(saved.content.map(c => c.type === "text" ? c.text : "").join(""));
	assert.equal(receipt.reason, "waiting");
	return receipt.wait_id;
}

function childWaitDelivery(parent: Run, waitId: string): any {
	return parent.session.messages.findLast(m => m.role === "custom" && m.customType === "child_wait" && (m.details as any)?.wait_id === waitId)?.details;
}

test("successful core resume delivers final metadata with the actual provider usage marked complete", async () => {
	const w = await world({ exactUsage: true });
	try {
		const file = await interruptedChild(w);
		const parent = await w.launch(file);
		const usage = {
			input: 17, output: 5, cacheRead: 3, cacheWrite: 2, totalTokens: 27,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
		const resumed = hold(w.hub, "USAGE RESUMED", usage);
		w.sub.queue.push(resumed.reply);
		await parent.call({ action: "resume", id: "agent#1" });
		await w.hub.until(resumed.entered, "the resumed core request");
		assert.equal((await statusOf(parent, "agent#1")).usage_complete, false, "live usage stays explicitly incomplete");
		const waitId = await armChildWait(w, parent);
		resumed.release();
		await w.hub.until(() => !!childWaitDelivery(parent, waitId), "the final wait delivery");
		const delivered = childWaitDelivery(parent, waitId);
		assert.equal(delivered.results[0].outcome, "completed");
		assert.equal(delivered.results[0].text, "USAGE RESUMED");
		const status = delivered.statuses[0];
		assert.equal(status.state, "idle");
		assert.equal(status.outcome, "completed");
		assert.deepEqual(status.tokens.session, { input: 17, output: 5, cacheRead: 3, cacheWrite: 2, total: 27 });
		assert.deepEqual(status.tokens.run, status.tokens.session);
		assert.equal(status.tokens.in_flight_usage, null);
		assert.equal(status.usage_complete, true);
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("core resume keeps final usage incomplete when the provider reported no usage", async () => {
	const w = await world({ exactUsage: true });
	try {
		const file = await interruptedChild(w);
		const parent = await w.launch(file);
		const resumed = hold(w.hub, "NO USAGE");
		w.sub.queue.push(resumed.reply);
		await parent.call({ action: "resume", id: "agent#1" });
		await w.hub.until(resumed.entered, "the resumed request without usage");
		const waitId = await armChildWait(w, parent);
		resumed.release();
		await w.hub.until(() => !!childWaitDelivery(parent, waitId), "the final wait delivery without usage");
		const status = childWaitDelivery(parent, waitId).statuses[0];
		assert.equal(status.state, "idle");
		assert.equal(status.outcome, "completed");
		assert.deepEqual(status.tokens.session, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
		assert.deepEqual(status.tokens.run, status.tokens.session);
		assert.equal(status.usage_complete, false);
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("a parent file copied to a new path cannot open the original child files; it reports a diagnostic and still works", async () => {
	const w = await world();
	try {
		const file = await interruptedChild(w);
		const [{ file: originalChild }] = await childHistories(file);
		const before = await readFile(originalChild, "utf8");
		const copy = join(dirname(file), "copied-session.jsonl");
		await copyFile(file, copy);

		const parent = await w.launch(copy);
		const status = JSON.stringify(await statusOf(parent, "agent#1"));
		assert.match(status, /agent#1/);
		assert.match(status, /error|recover|unavailable|outside|cannot/i, "a diagnostic, not a started child");
		await parent.command("resume-agents");
		await parent.session.prompt("continue");
		await settle();
		assert.equal(w.sub.requests.length, 1, "the original child was not opened or started");
		assert.equal(await readFile(originalChild, "utf8"), before, "the original child history is untouched");
		assert.equal(await w.start(parent, "NEW"), "agent#2 started", "the id high-water mark carries over");
		await w.hub.until(() => parent.delivered().length === 1, "the new child's delivery");
		assert.deepEqual(w.sub.requests[1].texts, ["NEW"]);
	} finally { await w.cleanup(); }
});

test("one bad saved child does not block the healthy one: bad is diagnosed, never retried, and can be stopped", async () => {
	const w = await world();
	try {
		const first = await w.launchPersisted();
		const holds = [hold(w.hub), hold(w.hub)];
		w.sub.queue.push(...holds.map(h => h.reply));
		await w.start(first, "GOOD");
		await w.hub.until(holds[0].entered, "first child pending");
		await w.start(first, "BAD");
		await w.hub.until(holds[1].entered, "second child pending");
		await w.close(first);
		// Corrupt only agent#2: its saved model no longer exists.
		const manager = SessionManager.open(first.file, dirname(first.file), w.cwd);
		const saved = savedRecord(manager, 2).data;
		manager.appendCustomEntry("rqw-agent-child", { ...saved, config: { ...saved.config, model: { provider: saved.config.model.provider, id: "missing-model" } } });

		const parent = await w.launch(first.file);
		w.sub.queue.push(answer("GOOD DONE"));
		await parent.command("resume-agents");
		await w.hub.until(() => parent.delivered().some(t => t.includes("GOOD DONE")), "the healthy child's delivery");
		assert.equal(w.sub.requests.length, 3, "only the healthy child made a request");
		assert.deepEqual(w.sub.requests[2].texts, ["GOOD"]);
		assert.match(JSON.stringify(await statusOf(parent, "agent#2")), /missing-model|error|recover|unavailable|cannot/i);

		w.sub.queue.push(answer("THIRD DONE"));
		assert.equal(await w.start(parent, "THIRD"), "agent#3 started");
		await w.hub.until(() => w.sub.requests.length === 4, "the new child's request");
		// Delivery starts a parent turn; wait for that wake to settle before sending owner prompts.
		await w.hub.until(() => parent.delivered().includes("[agent#3] THIRD DONE")
			&& w.main.requests.length === 3 && parent.session.isIdle, "both completion wakes have settled");
		assert.equal(w.sub.requests.length, 4, "the new child completed without retrying the bad sibling");
		await parent.session.prompt("again");
		await parent.session.prompt("once more");
		await parent.command("resume-agents");
		await settle();
		assert.ok(!w.sub.requests.some(r => r.texts.includes("BAD") && r !== w.sub.requests[1]), "the bad child was not retried");
		await assert.rejects(parent.call({ action: "resume", id: "agent#2" }), /missing-model|unavailable|recover|Cannot|invalid/i);
		assert.equal(await parent.call({ action: "stop", id: "agent#2" }), "agent#2 stopped");
		await w.close(parent);
		const reopened = await w.launch(first.file);
		await assert.rejects(reopened.call({ action: "resume", id: "agent#2" }), /Unknown agent id: agent#2/);
	} finally { await w.cleanup(); }
});

test("a refused replacement session leaves the old id usable; after the refusal ends resume succeeds from the same history", async () => {
	const w = await world();
	try {
		const parent = await w.launchPersisted();
		const pending = hold(w.hub), second = hold(w.hub, "AFTER REFUSAL");
		w.sub.queue.push(pending.reply, second.reply);
		await w.start(parent);
		await w.hub.until(pending.entered, "child request pending");
		await parent.call({ action: "interrupt", id: "agent#1" });
		await w.hub.until(pending.aborted, "the abort");
		await settle();

		w.offered.policy = "TEST REFUSAL";
		await assert.rejects(parent.call({ action: "resume", id: "agent#1" }), /Session policy refused: TEST REFUSAL/);
		assert.equal(w.sub.requests.length, 1, "no request from the refused session");
		assert.match(JSON.stringify(await statusOf(parent, "agent#1")), /agent#1/, "the old id is still known and answers status");

		w.offered.policy = undefined;
		assert.match(await parent.call({ action: "resume", id: "agent#1" }), /agent#1/);
		await w.hub.until(second.entered, "the resumed request");
		assertFirstContext(w.sub.requests[1]);
		second.release();
		await w.hub.until(() => parent.delivered().length === 1, "the delivery");
		assert.equal(parent.delivered()[0], "[agent#1] AFTER REFUSAL");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("a manual interrupt stays paused across closing, reopening and an unrelated parent prompt; explicit resume works", async () => {
	const w = await world();
	try {
		const first = await w.launchPersisted();
		const pending = hold(w.hub);
		w.sub.queue.push(pending.reply);
		await w.start(first);
		await w.hub.until(pending.entered, "child request pending");
		await first.call({ action: "interrupt", id: "agent#1" });
		await w.hub.until(pending.aborted, "the abort");
		await settle();
		await w.close(first);

		const parent = await w.launch(first.file);
		assert.match(JSON.stringify(await statusOf(parent, "agent#1")), /paused/);
		await parent.session.prompt("unrelated");
		await settle();
		assert.equal(w.sub.requests.length, 1, "the paused child was not resumed by the parent turn");
		const second = hold(w.hub, "EXPLICIT");
		w.sub.queue.push(second.reply);
		assert.match(await parent.call({ action: "resume", id: "agent#1" }), /agent#1/);
		await w.hub.until(second.entered, "the explicit resume request");
		assertFirstContext(w.sub.requests[1]);
		second.release();
		await w.hub.until(() => parent.delivered().length === 1, "the delivery");
		assert.equal(parent.delivered()[0], "[agent#1] EXPLICIT");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});
