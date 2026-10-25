// Notification waits: real Pi 1.4.0 sessions, faux providers, temporary session roots. A model-called `agent` wait in
// the TUI returns a receipt at once and ends the turn; the child's completion wakes the parent later. Waiting uses
// events (provider requests, session events), never sleeps; `settle` is used only to prove that nothing else arrives.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import {
	type AssistantMessage,
	fauxAssistantMessage as answer,
	fauxProvider,
	fauxToolCall,
	getSystemMessageText,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { createJobs, createJobTool } from "../extensions/RQW-tools/jobs.ts";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";

const EXTENSION = join(import.meta.dirname, "..", "extensions", "RQW-agent", "index.ts");
const REVIEW = join(import.meta.dirname, "..", "extensions", "RQW-review", "index.ts");
const SYSTEM = "EXACT";
type Mode = "tui" | "rpc" | "print" | "json";

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
}
// Proof that something does not happen: a started request needs far fewer event-loop turns than this to show up.
async function settle() { for (let i = 0; i < 30; i++) await setImmediate(); }

type Request = { model: string; system: string[]; roles: string[]; texts: string[]; messages: TranscriptContext["messages"] };
function record(context: TranscriptContext, model: { id: string }): Request {
	const system: string[] = [], roles: string[] = [], texts: string[] = [];
	for (const m of context.messages) {
		if (m.role === "system") { system.push(getSystemMessageText(m)); continue; }
		roles.push(m.role);
		if (typeof m.content === "string") texts.push(m.content);
		else for (const c of m.content) if (c.type === "text") texts.push(c.text);
	}
	return { model: model.id, system, roles, texts, messages: structuredClone(context.messages) };
}

type Reply = AssistantMessage | ((signal?: AbortSignal) => Promise<AssistantMessage>);
let serial = 0;
/** A faux provider: `rule` decides from the request, else the next queued reply, else `OK`. */
function scripted(hub: Hub, name: string, id: string, provider = `notify-${name}-${serial}`) {
	const n = serial++;
	const faux = fauxProvider({ provider, api: `notify-${name}-${n}`, models: [{ id, reasoning: true }] });
	const state = { faux, requests: [] as Request[], queue: [] as Reply[], rule: undefined as undefined | ((request: Request) => Reply | undefined) };
	const step = async (context: TranscriptContext, options: SimpleStreamOptions | undefined, _s: unknown, model: { id: string }) => {
		const request = record(context, model);
		state.requests.push(request);
		const reply = state.rule?.(request) ?? state.queue.shift();
		hub.notify();
		if (!reply) return answer("OK");
		return typeof reply === "function" ? reply(options?.signal) : reply;
	};
	faux.setResponses(Array.from({ length: 500 }, () => step));
	return state;
}

/** A reply that waits for `release()` or for the abort, which Pi turns into an aborted assistant message. */
function hold(hub: Hub, text: string) {
	const waiting = Promise.withResolvers<AssistantMessage>();
	let entered = false, aborted = false;
	return {
		reply: (signal?: AbortSignal) => {
			entered = true;
			signal?.addEventListener("abort", () => { aborted = true; waiting.resolve(answer("")); }, { once: true });
			hub.notify();
			return waiting.promise;
		},
		release: () => waiting.resolve(answer(text)), entered: () => entered, aborted: () => aborted,
	};
}
const toolUse = (name: string, args: Record<string, unknown>, id: string) => answer([fauxToolCall(name, args, { id })], { stopReason: "toolUse" });

type Run = { session: AgentSession; errors: string[]; file: string; closed: boolean; delivered(): string[]; customs(type?: string): string[];
	execute(params: Record<string, unknown>, toolCallId?: string): Promise<{ text: string; details: any; terminate?: boolean }> };

async function world() {
	const root = await mkdtemp(join(tmpdir(), "rqw-agent-notify-"));
	const agentDir = join(root, "home"), cwd = join(root, "work"), sessions = join(root, "sessions");
	await Promise.all([agentDir, cwd, sessions].map(dir => mkdir(dir)));
	const hub = new Hub();
	const main = scripted(hub, "main", "m"), sub = scripted(hub, "sub", "s"), deep = scripted(hub, "deep", "g");
	const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	for (const p of [main, sub, deep]) runtime.registerNativeProvider(p.faux.provider);
	const open = new Set<Run>();
	const offered: { factory?: (...args: any[]) => unknown[] } = {};
	const modelOf = (p: typeof sub, id: string) => `${p.faux.provider.id}/${id}`;

	async function launch(file?: string, mode: Mode = "tui"): Promise<Run> {
		const manager = file ? SessionManager.open(file, sessions, cwd) : SessionManager.create(cwd, sessions);
		const loader = new DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: [EXTENSION, REVIEW],
			// The public tools offer: the test hands children its own factory, built on RQW-tools' real Jobs.
			extensionFactories: [pi => { pi.events.on("rqw-tools:subagent-tools", request => {
				if (offered.factory) (request as { offer(factory: unknown): void }).offer(offered.factory);
			}); }],
			noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const { session } = await createAgentSession({ cwd, agentDir, modelRuntime: runtime, model: main.faux.getModel("m"),
			thinkingLevel: "low", resourceLoader: loader, sessionManager: manager, settingsManager: SettingsManager.inMemory({}) });
		const errors: string[] = [];
		await session.bindExtensions({ mode, onError: e => errors.push(`${e.event}: ${e.error}`) });
		session.subscribe(() => hub.notify());
		const tool = session.getToolDefinition("agent")!;
		const customs = (type?: string) => session.messages.flatMap(m => m.role === "custom" && (!type || m.customType === type) && typeof m.content === "string" ? [m.content] : []);
		const run: Run = {
			session, errors, file: manager.getSessionFile()!, closed: false, customs,
			delivered: () => customs("agent"),
			execute: async (params, toolCallId = "notify-direct") => {
				const result = await tool.execute(toolCallId, params as never, undefined, undefined, session.extensionRunner.createContext());
				return { text: result.content.map(c => c.type === "text" ? c.text : "").join(""), details: (result as { details?: unknown }).details, terminate: (result as { terminate?: boolean }).terminate };
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
	async function launchPersisted(mode: Mode = "tui") {
		const run = await launch(undefined, mode);
		await run.session.prompt("setup");
		return run;
	}
	const startParams = (task: string, extra: Record<string, unknown> = {}) => ({ action: "start", system: SYSTEM, task, model: modelOf(sub, "s"), thinking: "high", tools: [], ...extra });
	return {
		hub, main, sub, deep, offered, launch, close, launchPersisted, modelOf, startParams,
		cleanup: async () => { for (const run of open) await close(run); await rm(root, { recursive: true, force: true }); },
	};
}
type World = Awaited<ReturnType<typeof world>>;

const waitMessages = (run: Run) => run.customs("child_wait").map(text => JSON.parse(text));
const lastResult = (run: Run) => run.session.messages.findLast(m => m.role === "toolResult")! as { toolName: string; details?: any; content: { type: string; text?: string }[] };

test("a model-called wait ends the turn with a receipt; owner input proceeds; the child's completion wakes the parent once", async () => {
	const w = await world();
	try {
		const parent = await w.launchPersisted();
		const child = hold(w.hub, "CHILD TEXT");
		w.sub.queue.push(child.reply);
		const base = w.main.requests.length;
		w.main.queue.push(
			toolUse("agent", w.startParams("FIRST"), "s1"),
			toolUse("agent", { action: "wait", ids: ["agent#1"] }, "w1"));
		await parent.session.prompt("go");
		assert.equal(w.main.requests.length, base + 2, "start turn and wait turn only: no request just to say that it is waiting");
		const receipt = lastResult(parent);
		assert.equal(receipt.toolName, "agent");
		assert.equal(receipt.details?.reason, "waiting");
		assert.equal(typeof receipt.details?.wait_id, "string");
		assert.equal(parent.session.messages.at(-1)!.role, "toolResult", "the turn ended on the wait receipt");
		assert.equal(parent.session.isStreaming, false);
		await settle();
		assert.equal(w.main.requests.length, base + 2);
		assert.ok(child.entered() && !child.aborted(), "the child keeps running");

		// Owner input before the result: the parent answers, nothing is cancelled.
		w.main.queue.push(answer("STEER ACK"));
		await parent.session.prompt("steer");
		assert.equal(w.main.requests.length, base + 3);
		assert.ok(w.main.requests.at(-1)!.texts.includes("steer"));
		assert.equal(child.aborted(), false, "the owner's message did not abort the child");
		assert.equal(w.sub.requests.length, 1);
		assert.deepEqual(waitMessages(parent), [], "no notification before the result");

		child.release();
		await w.hub.until(() => waitMessages(parent).length === 1, "the wait notification");
		await w.hub.until(() => w.main.requests.length === base + 4, "the wake turn");
		await settle();
		assert.equal(w.main.requests.length, base + 4, "exactly one wake");
		assert.equal(waitMessages(parent).length, 1, "one notification");
		const notification = waitMessages(parent)[0];
		assert.equal(notification.wait_id, receipt.details.wait_id);
		assert.match(JSON.stringify(notification), /CHILD TEXT/);
		const wake = w.main.requests.at(-1)!;
		assert.ok(wake.texts.some(t => t.includes("CHILD TEXT") && t.includes(receipt.details.wait_id)), "the parent model sees the child's text and the wait id");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("a persisted child_wait completion is not republished after reopening the parent", async () => {
	const w = await world();
	try {
		const parent = await w.launchPersisted();
		const child = hold(w.hub, "ALREADY DELIVERED");
		w.sub.queue.push(child.reply);
		w.main.queue.push(toolUse("agent", w.startParams("FIRST"), "s1"),
			toolUse("agent", { action: "wait", ids: ["agent#1"] }, "w1"));
		await parent.session.prompt("go");
		child.release();
		await w.hub.until(() => waitMessages(parent).length === 1, "the completion notification");
		await w.hub.until(() => parent.session.isIdle, "the parent consumed the notification");
		const delivered = parent.session.sessionManager.getBranch().findLast(e => e.type === "custom_message" && e.customType === "child_wait");
		assert.ok(delivered?.type === "custom_message");
		assert.equal(typeof (delivered.details as { results: { run: string }[] }).results[0].run, "string");
		assert.deepEqual(parent.delivered(), [], "the notification, not a separate agent message, owns the result");
		await w.close(parent);

		const restored = await w.launch(parent.file);
		const mainBefore = w.main.requests.length, childBefore = w.sub.requests.length;
		await restored.execute({ action: "status", ids: ["agent#1"] });
		await settle();
		assert.deepEqual(restored.delivered(), [], "hydration does not republish the saved result");
		assert.equal(w.main.requests.length, mainBefore, "status did not wake the parent model");
		await restored.session.prompt("continue");
		await settle();
		assert.equal(w.main.requests.length, mainBefore + 1, "only the owner's message starts a request");
		assert.equal(w.sub.requests.length, childBefore, "the completed child is not resumed");
		assert.equal(waitMessages(restored).length, 1, "the original completion notification remains unique");
		assert.deepEqual(restored.delivered(), []);
		assert.deepEqual(restored.errors, []);
	} finally { await w.cleanup(); }
});

/** Starts agent#n held, runs the wait directly, and proves it stays pending until the child ends. */
async function assertBlocks(w: World, run: Run, n: number, toolCallId: string) {
	const child = hold(w.hub, `BLOCKED ${n}`);
	w.sub.queue.push(child.reply);
	assert.equal((await run.execute(w.startParams(`TASK ${n}`), `start-${n}`)).text, `agent#${n} started`);
	await w.hub.until(child.entered, `child ${n} request pending`);
	const mainBefore = w.main.requests.length;
	let settled = false;
	const pending = run.execute({ action: "wait", ids: [`agent#${n}`] }, toolCallId).finally(() => { settled = true; });
	await settle();
	assert.equal(settled, false, `the wait ${toolCallId} is still pending while the child runs`);
	child.release();
	const result = await pending;
	const body = JSON.parse(result.text);
	assert.equal(body.reason, "result");
	assert.equal(body.results[0].id, `agent#${n}`);
	assert.match(body.results[0].text, new RegExp(`BLOCKED ${n}`));
	assert.notEqual(result.terminate, true, "a blocking wait does not end the turn");
	assert.notEqual(result.details?.reason, "waiting");
	await settle();
	assert.equal(w.main.requests.length, mainBefore, "the consumed result woke nobody");
	assert.deepEqual(waitMessages(run), [], "no notification for a blocking wait");
}

test("agent exposes no blocking option; a nested codemode tool call id keeps the held wait", async () => {
	const w = await world();
	try {
		const parent = await w.launchPersisted();
		const parameters = parent.session.getToolDefinition("agent")!.parameters;
		assert.equal(Object.hasOwn(parameters.properties, "blocking"), false);
		await assertBlocks(w, parent, 1, "codemode-outer/3");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

for (const mode of ["print", "json"] as const) {
	test(`${mode} mode keeps the blocking wait by default`, async () => {
		const w = await world();
		try {
			const parent = await w.launchPersisted(mode);
			await assertBlocks(w, parent, 1, "plain-call");
			assert.deepEqual(parent.errors, []);
		} finally { await w.cleanup(); }
	});
}

test("a resumed child's nested wait ends its turn; the parent sees no intermediate result and one final answer", async () => {
	const w = await world();
	try {
		// A child whose first request was interrupted by shutdown.
		const first = await w.launchPersisted();
		const interrupted = hold(w.hub, "NEVER");
		w.sub.queue.push(interrupted.reply);
		await first.execute(w.startParams("FIRST", { tools: ["read", "grep"] }));
		await w.hub.until(interrupted.entered, "child request pending");
		await w.close(first);
		assert.ok(interrupted.aborted());

		// The resumed child starts a grandchild and waits for it by notification.
		const grand = hold(w.hub, "GRAND-DONE");
		w.deep.queue.push(grand.reply);
		const nested = toolUse("agent", { action: "start", system: "GRAND", task: "G1", model: w.modelOf(w.deep, "g"), tools: [] }, "n1");
		const waitNested = toolUse("agent", { action: "wait", ids: ["agent#1"] }, "n2");
		const userTexts = (request: Request) => request.messages.filter(m => m.role === "user").map(m => JSON.stringify(m.content));
		w.sub.rule = request => {
			if (userTexts(request).some(t => t.includes("GRAND-DONE"))) return answer("FINAL");
			const results = request.roles.filter(r => r === "toolResult").length;
			return results === 0 ? nested : results === 1 ? waitNested : answer("UNEXPECTED CONTINUATION");
		};
		const parent = await w.launch(first.file);
		const mainBefore = w.main.requests.length;
		assert.match((await parent.execute({ action: "resume", id: "agent#1" })).text, /agent#1/);
		await w.hub.until(() => w.sub.requests.length === 3 && w.deep.requests.length === 1, "the child started the grandchild and called wait");
		await settle();
		assert.equal(w.sub.requests.length, 3, "the child's turn ended on its wait receipt: no further request");
		const everyCustom = () => parent.session.messages.flatMap(m => m.role === "custom" ? [JSON.stringify(m.content)] : []);
		assert.ok(!everyCustom().some(t => t.includes("(no text)")), "no intermediate empty result");
		assert.deepEqual(parent.delivered(), [], "the logical assignment stays open");
		assert.equal(w.main.requests.length, mainBefore, "main is not asked while the grandchild works");

		grand.release();
		await w.hub.until(() => w.sub.requests.length === 4, "the child woken by the grandchild");
		const woken = w.sub.requests[3];
		assert.ok(userTexts(woken).some(t => t.includes("GRAND-DONE") && t.includes("wait_id")), `the child sees the grandchild's text and the wait id: ${JSON.stringify(w.sub.requests.map(r => r.messages.filter(m => m.role !== "system").map(m => `${m.role}:${JSON.stringify(m.content).slice(0, 160)}`)))}`);
		await w.hub.until(() => parent.delivered().some(t => t.includes("FINAL")), "the final answer");
		await settle();
		assert.equal(parent.delivered().filter(t => t.includes("FINAL")).length, 1, "one final delivery");
		assert.ok(!everyCustom().some(t => t.includes("(no text)")));
		assert.equal(w.sub.requests.length, 4);
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("automatic disk recovery parks a saved child wait and preserves a manually paused grandchild", async () => {
	const w = await world();
	try {
		const first = await w.launchPersisted();
		const active = hold(w.hub, "OLD ACTIVE"), paused = hold(w.hub, "OLD PAUSED");
		w.deep.queue.push(active.reply, paused.reply);
		w.sub.rule = request => {
			const results = request.roles.filter(role => role === "toolResult").length;
			if (results === 0) return toolUse("agent", { action: "start", system: "GRAND", task: "ACTIVE", model: w.modelOf(w.deep, "g"), tools: [] }, "g1");
			if (results === 1) return toolUse("agent", { action: "start", system: "GRAND", task: "PAUSED", model: w.modelOf(w.deep, "g"), tools: [] }, "g2");
			if (results === 2) return async () => {
				await w.hub.until(paused.entered, "the second grandchild request started before its manual pause");
				return toolUse("agent", { action: "interrupt", id: "agent#2" }, "pause-g2");
			};
			return toolUse("agent", { action: "wait", ids: ["agent#1"] }, "wait-g1");
		};
		await first.execute(w.startParams("FIRST"));
		await w.hub.until(() => w.sub.requests.length === 4 && active.entered() && paused.aborted(), "the child waits with one active and one paused grandchild");
		await settle();
		const saved = await childEntries(first.file);
		assert.ok(saved.some(e => e.type === "message" && e.message.role === "toolResult" && e.message.details?.reason === "waiting"));
		assert.ok(saved.some(e => e.type === "custom" && e.customType === "rqw-agent-child" && e.data.id === 2 && e.data.state === "paused"));
		await w.close(first);

		const recovered = hold(w.hub, "ACTIVE-DONE");
		w.deep.queue.push(recovered.reply);
		w.sub.rule = request => {
			if (userTexts(request).some(text => text.includes("ACTIVE-DONE"))) return answer("FINAL");
			if (userTexts(request).some(text => text.includes("NUDGE"))) return toolUse("agent", { action: "wait", ids: ["agent#1"] }, "owner-wait");
			return answer("UNEXPECTED WAIT-ONLY RETRY");
		};
		const parent = await w.launch(first.file);
		const childBefore = w.sub.requests.length, grandBefore = w.deep.requests.length, mainBefore = w.main.requests.length;
		await parent.session.prompt("continue");
		await w.hub.until(recovered.entered, "the active grandchild was resumed");
		await settle();
		assert.equal(w.sub.requests.length, childBefore, "the child makes no model request merely to wait again");
		assert.equal(w.deep.requests.length, grandBefore + 1, "only the active grandchild resumes; the manually paused one stays paused");
		assert.equal(w.main.requests.length, mainBefore + 1, "only the owner's continue asks the parent model");
		assert.deepEqual(parent.delivered(), [], "the pending assignment is not published as empty or completed");
		await parent.execute({ action: "send", id: "agent#1", task: "NUDGE" });
		await w.hub.until(() => w.sub.requests.length === childBefore + 1, "owner input wakes the parked child before the grandchild finishes");
		await settle();
		assert.ok(userTexts(w.sub.requests.at(-1)!).some(text => text.includes("NUDGE")));
		assert.equal(recovered.aborted(), false);
		assert.deepEqual(parent.delivered(), []);

		recovered.release();
		await w.hub.until(() => parent.delivered().some(text => text.includes("FINAL")), "the grandchild's completion wakes the child");
		await settle();
		assert.equal(w.sub.requests.length, childBefore + 2, "one owner-input request and one notification wake, no wait-only turn");
		assert.ok(userTexts(w.sub.requests.at(-1)!).some(text => text.includes("ACTIVE-DONE")));
		assert.equal(parent.delivered().length, 1);
		assert.equal(w.deep.requests.length, grandBefore + 1, "automatic recursive recovery never resumed the paused descendant");
		assert.ok(noEmptyResult(parent));
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

/** Child history files of a parent, parsed. */
async function childEntries(parentFile: string) {
	const names = await readdir(`${parentFile}.children`, { recursive: true, withFileTypes: true }).catch(() => []);
	const files = names.filter(e => e.isFile() && e.name.endsWith(".jsonl")).map(e => join(e.parentPath, e.name));
	return (await Promise.all(files.map(async file => (await readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line))))).flat() as any[];
}
const userTexts = (request: Request) => request.messages.filter(m => m.role === "user").map(m => JSON.stringify(m.content));
const noEmptyResult = (run: Run) => !run.session.messages.some(m => m.role === "custom" && JSON.stringify(m.content).includes("(no text)"));

test("a FRESH nested child's notification wait ends its turn; a parent send reaches a new child request before the grandchild ends", async () => {
	const w = await world();
	try {
		const parent = await w.launchPersisted();
		const grand = hold(w.hub, "GRAND-DONE");
		w.deep.queue.push(grand.reply);
		const nested = toolUse("agent", { action: "start", system: "GRAND", task: "G1", model: w.modelOf(w.deep, "g"), tools: [] }, "n1");
		const wait = (id: string) => toolUse("agent", { action: "wait", ids: ["agent#1"] }, id);
		w.sub.rule = request => {
			const texts = userTexts(request), results = request.roles.filter(r => r === "toolResult").length;
			if (texts.some(t => t.includes("GRAND-DONE"))) return answer("FINAL");
			if (results === 0) return nested;
			if (texts.some(t => t.includes("NUDGE"))) return wait("n3");
			return results === 1 ? wait("n2") : answer("UNEXPECTED CONTINUATION");
		};
		const mainBefore = w.main.requests.length;
		await parent.execute(w.startParams("FIRST"), "start-1");
		await w.hub.until(() => w.sub.requests.length === 2 && w.deep.requests.length === 1, "the child started the grandchild and called wait");
		await settle();
		assert.equal(w.sub.requests.length, 2, "the child's turn ended on its wait receipt: no extra request");
		assert.deepEqual(parent.delivered(), [], "the logical assignment stays open");
		assert.ok(noEmptyResult(parent));

		await parent.execute({ action: "send", id: "agent#1", task: "NUDGE" }, "send-1");
		await w.hub.until(() => w.sub.requests.length === 3, "the child's new request for the nudge");
		assert.ok(userTexts(w.sub.requests[2]).some(t => t.includes("NUDGE")), "the nudge reached the new request");
		assert.equal(grand.aborted(), false, "the grandchild is not aborted");
		await settle();
		assert.equal(w.sub.requests.length, 3, "the nudge turn also ended on a wait receipt");
		assert.deepEqual(parent.delivered(), []);

		grand.release();
		await w.hub.until(() => parent.delivered().some(t => t.includes("FINAL")), "the final answer");
		await settle();
		assert.equal(parent.delivered().length, 1, "one parent result");
		assert.ok(userTexts(w.sub.requests[3]).some(t => t.includes("GRAND-DONE")));
		assert.ok(noEmptyResult(parent));
		assert.equal(w.deep.requests.length, 1, "the grandchild ran once");
		assert.equal(w.main.requests.length, mainBefore + 1, "main woken once, by the final result");
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});

test("a child's job wait by notification keeps the assignment open; the job's end wakes the child once", async () => {
	const w = await world();
	try {
		const jobGate = Promise.withResolvers<void>();
		// Real Jobs of RQW-tools with the child's notify and retain; the work is a deferred callback, not a process.
		w.offered.factory = (cwd: string, _settings: unknown, _nested: unknown, options: { label?: string; notify?: any; retain?: any } = {}) => {
			const jobs = createJobs({ backgroundAfterMs: 1, notify: options.notify, retain: options.retain, label: options.label });
			const deferred = {
				name: "bash", label: "bash", description: "A deferred job", parameters: Type.Object({ command: Type.String() }),
				execute: (_id: string, params: { command: string }, signal?: AbortSignal) =>
					jobs.run({ tool: "bash", command: params.command, signal, process: false }, async () => {
						await jobGate.promise;
						return { content: [{ type: "text" as const, text: "JOB_BODY" }], details: {} };
					}),
			};
			return [deferred, createJobTool(jobs, "Wait for, check or kill your background jobs.")] as unknown[];
		};
		const parent = await w.launchPersisted();
		w.sub.rule = request => {
			if (userTexts(request).some(t => t.includes("[job]"))) return answer("FINAL");
			const results = request.roles.filter(r => r === "toolResult").length;
			if (results === 0) return toolUse("bash", { command: "deferred work" }, "j1");
			return results === 1 ? toolUse("job", { action: "wait", ids: ["job#1"] }, "j2") : answer("UNEXPECTED CONTINUATION");
		};
		const mainBefore = w.main.requests.length;
		await parent.execute(w.startParams("FIRST", { tools: ["bash"] }), "start-1");
		await w.hub.until(() => w.sub.requests.length === 3 || (w.sub.requests.length === 2 && w.sub.requests[1].roles.includes("toolResult")), "the child handed the job off");
		await settle();
		assert.equal(w.sub.requests.length, 2, "bash handoff, then the job wait receipt ended the turn: no further request");
		assert.deepEqual(parent.delivered(), [], "the pending lease holds the logical assignment");
		assert.ok(noEmptyResult(parent), "no (no text) result");
		assert.equal(w.main.requests.length, mainBefore);

		jobGate.resolve();
		await w.hub.until(() => w.sub.requests.length === 3, "the child woken by the job notification");
		assert.ok(userTexts(w.sub.requests[2]).some(t => t.includes("[job]") && t.includes("job#1")));
		await w.hub.until(() => parent.delivered().some(t => t.includes("FINAL")), "the final answer");
		await settle();
		assert.equal(parent.delivered().length, 1, "one parent result");
		assert.equal(w.sub.requests.length, 3, "the job woke the child once");
		assert.ok(noEmptyResult(parent));
		assert.deepEqual(parent.errors, []);
	} finally { await w.cleanup(); }
});
