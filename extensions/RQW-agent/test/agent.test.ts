// The extension inside real Pi sessions, no model: a main AgentSession loads RQW-agent from its file, and two faux
// providers from pi-ai answer for the main agent and for the subagents. Each subagent request is recorded with the
// model, the reasoning level, the system messages and the declared tools Pi sent.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	type AssistantMessage,
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
	getSystemMessageText,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionContext,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION = join(HERE, "..", "index.ts");
// The package's exports map hides this module, so it is imported by file URL next to the package entry.
const { makeStrictJsonSchema } = await import(
	new URL("./api/constrained-sampling.js", import.meta.resolve("@earendil-works/pi-ai")).href
);

const SYSTEM = "You are a test subagent.\nAnswer in one word.";

/** One request a provider got. */
type Request = { model: string; reasoning?: string; system: string[]; tools: string[]; texts: string[] };

function record(context: TranscriptContext, options: SimpleStreamOptions | undefined, model: { id: string }): Request {
	const tools = new Map<string, true>();
	const system: string[] = [];
	const texts: string[] = [];
	for (const m of context.messages) {
		if (m.role === "system") {
			system.push(getSystemMessageText(m));
			for (const t of m.toolsAdded ?? []) tools.set(t.name, true);
			for (const t of m.toolsRemoved ?? []) tools.delete(t.name);
		} else if (typeof m.content === "string") texts.push(m.content);
		else for (const c of m.content) if (c.type === "text") texts.push(c.text);
	}
	return { model: model.id, reasoning: options?.reasoning, system, tools: [...tools.keys()], texts };
}

type Reply = AssistantMessage | ((signal?: AbortSignal) => Promise<AssistantMessage>);

/** A faux provider whose replies are taken in order; every request is recorded. */
function scripted(provider: string, models: { id: string; reasoning?: boolean }[], fallback: string) {
	const faux = fauxProvider({ api: `faux-${provider}`, provider, models });
	const state = { requests: [] as Request[], replies: [] as Reply[], faux };
	const step = async (context: TranscriptContext, options: SimpleStreamOptions | undefined, _s: unknown, model: { id: string }) => {
		state.requests.push(record(context, options, model));
		const reply = state.replies.shift();
		if (!reply) return fauxAssistantMessage(fallback);
		return typeof reply === "function" ? reply(options?.signal) : reply;
	};
	// Every request goes through `step`, which takes the next scripted reply.
	faux.setResponses(Array.from({ length: 500 }, () => step));
	return state;
}

/** A reply that waits until `release()` or an abort. */
function gate(text: string) {
	let release = () => {};
	let aborted = false;
	const reply = (signal?: AbortSignal) => {
		const { promise, resolve } = Promise.withResolvers<AssistantMessage>();
		release = () => resolve(fauxAssistantMessage(text));
		signal?.addEventListener("abort", () => {
			aborted = true;
			resolve(fauxAssistantMessage(text));
		});
		return promise;
	};
	return { reply, release: () => release(), wasAborted: () => aborted };
}

// Subagent runs and deliveries happen inside Pi with no promise exposed to the test, so the test polls for their
// visible result; `tick` gives a message that must not come a chance to arrive before the check.
async function until(check: () => boolean, what: string, ms = 3000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 5));
	}
}
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

let root: string;
let agentDir: string;
let counter = 0;
let modelRuntime: ModelRuntime;
const main = scripted("main", [{ id: "m", reasoning: true }], "main ok");
const sub = scripted("sub", [{ id: "a", reasoning: true }, { id: "b", reasoning: true }], "sub ok");

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-agent-"));
	agentDir = join(root, "agent");
	await mkdir(agentDir, { recursive: true });
	modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(main.faux.provider);
	modelRuntime.registerNativeProvider(sub.faux.provider);
});
after(async () => {
	await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
	for (const p of [main, sub]) {
		p.requests.length = 0;
		p.replies.length = 0;
	}
});

type Main = {
	dir: string;
	session: AgentSession;
	call: (params: Record<string, unknown>) => Promise<string>;
	/** Texts of the `agent` messages the main session got. */
	delivered: () => string[];
};

async function startMain(mode: "tui" | "rpc" | "print" = "tui"): Promise<Main> {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	const resourceLoader = new DefaultResourceLoader({
		cwd: dir,
		agentDir,
		additionalExtensionPaths: [EXTENSION],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	assert.deepEqual(resourceLoader.getExtensions().errors, []);
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir,
		model: main.faux.getModel("m"),
		thinkingLevel: "low",
		modelRuntime,
		resourceLoader,
		sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
	});
	await session.bindExtensions({ mode });
	const tool = session.getToolDefinition("agent") as ToolDefinition | undefined;
	assert.ok(tool, "the agent tool is registered");
	const ctx: ExtensionContext = session.extensionRunner.createContext();
	const call = async (params: Record<string, unknown>) => {
		const result = await tool.execute("t", params as never, undefined, undefined, ctx);
		return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
	};
	const delivered = () =>
		session.messages.flatMap((m) =>
			m.role === "custom" && m.customType === "agent" && typeof m.content === "string" ? [m.content] : [],
		);
	return { dir, session, call, delivered };
}

async function shutdown(m: Main) {
	await m.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	m.session.dispose();
}

describe("agent tool", () => {
	it("has a short description and a schema that passes Pi's strict mode", async () => {
		const m = await startMain();
		const tool = m.session.getToolDefinition("agent") as ToolDefinition;
		assert.ok(tool.description.length <= 700, `description is ${tool.description.length} characters`);
		assert.doesNotThrow(() => makeStrictJsonSchema(tool.parameters));
		await shutdown(m);
	});

	it("start: exact system prompt, chosen model, thinking and tools; the answer triggers a main turn", async () => {
		const m = await startMain();
		const g = gate("first answer");
		sub.replies.push(g.reply);
		const out = await m.call({ action: "start", system: SYSTEM, task: "do X", model: "sub/a", thinking: "high", tools: ["read", "grep"] });
		assert.equal(out, "agent#1 started");
		await until(() => sub.requests.length === 1, "the subagent request");
		const r = sub.requests[0];
		assert.deepEqual(r.system, [SYSTEM], "one system message, exactly the given text");
		assert.equal(r.model, "a");
		assert.equal(r.reasoning, "high");
		assert.deepEqual(r.tools.sort(), ["grep", "read"]);
		assert.deepEqual(r.texts, ["do X"]);
		assert.deepEqual(m.delivered(), [], "nothing delivered while running");
		g.release();
		await until(() => m.delivered().length === 1, "the delivery");
		assert.equal(m.delivered()[0], "[agent#1] first answer");
		await until(() => main.requests.length === 1, "a main turn");
		assert.ok(main.requests[0].texts.includes("[agent#1] first answer"), "the main model sees the message");
		await shutdown(m);
	});

	it("defaults: the main model and thinking level, all six RQW-tools, no agent tool", async () => {
		const m = await startMain();
		await m.call({ action: "start", system: SYSTEM, task: "hi" });
		await until(() => m.delivered().length === 1, "the delivery");
		const r = main.requests[0];
		assert.deepEqual(r.system, [SYSTEM]);
		assert.equal(r.model, "m");
		assert.equal(r.reasoning, "low");
		assert.deepEqual(r.tools.sort(), ["bash", "edit", "find", "grep", "read", "write"]);
		await shutdown(m);
	});

	it("the subagent's tools run in the main cwd and are the RQW-tools definitions", async () => {
		const m = await startMain();
		sub.replies.push(
			fauxAssistantMessage([fauxToolCall("write", { files: [{ path: "a.txt", content: "A" }, { path: "b.txt", content: "B" }] })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("written"),
		);
		await m.call({ action: "start", system: SYSTEM, task: "write", model: "sub/a" });
		await until(() => m.delivered().length === 1, "the delivery");
		assert.equal(m.delivered()[0], "[agent#1] written");
		assert.equal(await readFile(join(m.dir, "a.txt"), "utf8"), "A");
		assert.equal(await readFile(join(m.dir, "b.txt"), "utf8"), "B");
		await shutdown(m);
	});

	it("send while idle starts a new run with the history", async () => {
		const m = await startMain();
		sub.replies.push(fauxAssistantMessage("one"), fauxAssistantMessage("two"));
		await m.call({ action: "start", system: SYSTEM, task: "first", model: "sub/a" });
		await until(() => m.delivered().length === 1, "the first delivery");
		assert.equal(await m.call({ action: "send", id: "agent#1", task: "second" }), "agent#1: sent");
		await until(() => m.delivered().length === 2, "the second delivery");
		assert.equal(m.delivered()[1], "[agent#1] two");
		assert.deepEqual(sub.requests[1].texts, ["first", "one", "second"]);
		await shutdown(m);
	});

	it("send while running queues a follow-up; one message carries both answers", async () => {
		const m = await startMain();
		const g = gate("one");
		sub.replies.push(g.reply, fauxAssistantMessage("two"));
		await m.call({ action: "start", system: SYSTEM, task: "first", model: "sub/a" });
		await until(() => sub.requests.length === 1, "the first request");
		assert.equal(await m.call({ action: "send", id: "1", task: "also" }), "agent#1: queued after the current run");
		g.release();
		await until(() => m.delivered().length === 1, "the delivery");
		assert.equal(m.delivered()[0], "[agent#1] one\n\ntwo");
		assert.deepEqual(sub.requests[1].texts, ["first", "one", "also"]);
		await tick();
		assert.equal(m.delivered().length, 1);
		await shutdown(m);
	});

	it("interrupt aborts the run and its queued follow-ups without a message and keeps the history", async () => {
		const m = await startMain();
		const g = gate("late");
		sub.replies.push(g.reply, fauxAssistantMessage("after"));
		await m.call({ action: "start", system: SYSTEM, task: "long", model: "sub/a" });
		await until(() => sub.requests.length === 1, "the request");
		await m.call({ action: "send", id: "agent#1", task: "dropped" });
		assert.equal(await m.call({ action: "interrupt", id: "agent#1" }), "agent#1 interrupted");
		assert.ok(g.wasAborted());
		await tick();
		assert.deepEqual(m.delivered(), []);
		assert.equal(await m.call({ action: "interrupt", id: "agent#1" }), "agent#1 is idle");
		await m.call({ action: "send", id: "agent#1", task: "next" });
		await until(() => m.delivered().length === 1, "the delivery");
		assert.equal(m.delivered()[0], "[agent#1] after");
		assert.equal(sub.requests[1].texts[0], "long", "history kept");
		assert.equal(sub.requests[1].texts.at(-1), "next");
		assert.ok(!sub.requests[1].texts.includes("dropped"), "the queued follow-up was dropped");
		assert.equal(sub.requests.length, 2);
		await shutdown(m);
	});

	it("stop ends the subagent; its id is unknown afterwards", async () => {
		const m = await startMain();
		const g = gate("never");
		sub.replies.push(g.reply);
		await m.call({ action: "start", system: SYSTEM, task: "long", model: "sub/a" });
		await until(() => sub.requests.length === 1, "the request");
		assert.equal(await m.call({ action: "stop", id: "agent#1" }), "agent#1 stopped");
		await until(() => g.wasAborted(), "the abort");
		await tick();
		assert.deepEqual(m.delivered(), []);
		await assert.rejects(m.call({ action: "send", id: "agent#1", task: "x" }), /Unknown agent id: agent#1/);
		await shutdown(m);
	});

	it("stop, restart and session_shutdown with a queued follow-up: the old session sends no more requests", async () => {
		const ends: Record<string, (m: Main) => Promise<unknown>> = {
			stop: (m) => m.call({ action: "stop", id: "agent#1" }),
			restart: (m) => m.call({ action: "restart", id: "agent#1" }),
			session_shutdown: (m) => m.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }),
		};
		for (const [name, end] of Object.entries(ends)) {
			const m = await startMain();
			sub.requests.length = 0;
			const g = gate("late");
			sub.replies.push(g.reply, fauxAssistantMessage("AFTER END"));
			await m.call({ action: "start", system: SYSTEM, task: "long", model: "sub/a" });
			await until(() => sub.requests.length === 1, "the request");
			await m.call({ action: "send", id: "agent#1", task: "queued follow-up" });
			await end(m);
			await until(() => g.wasAborted(), "the abort");
			await tick(300);
			assert.equal(sub.requests.length, 1, `${name}: one subagent request`);
			assert.deepEqual(m.delivered(), [], `${name}: no message`);
			sub.replies.length = 0;
			await shutdown(m);
		}
	});

	it("restart: a fresh session with the same settings, or the new ones given", async () => {
		const m = await startMain();
		const g = gate("old");
		sub.replies.push(g.reply, fauxAssistantMessage("fresh"), fauxAssistantMessage("other model"));
		await m.call({ action: "start", system: SYSTEM, task: "old task", model: "sub/a", thinking: "high", tools: ["read"] });
		await until(() => sub.requests.length === 1, "the request");
		assert.equal(await m.call({ action: "restart", id: "agent#1", task: "new task" }), "agent#1 restarted");
		await until(() => m.delivered().length === 1, "the delivery");
		assert.ok(g.wasAborted());
		assert.equal(m.delivered()[0], "[agent#1] fresh");
		const r = sub.requests[1];
		assert.deepEqual(r.texts, ["new task"], "no old history");
		assert.deepEqual([r.system, r.model, r.reasoning, r.tools], [[SYSTEM], "a", "high", ["read"]]);
		assert.equal(await m.call({ action: "restart", id: "agent#1", model: "sub/b", system: "S2" }), "agent#1 restarted, idle");
		await m.call({ action: "send", id: "agent#1", task: "go" });
		await until(() => m.delivered().length === 2, "the second delivery");
		assert.deepEqual([sub.requests[2].system, sub.requests[2].model, sub.requests[2].texts], [["S2"], "b", ["go"]]);
		await shutdown(m);
	});

	it("errors: bad calls fail at once, a failed run is delivered with its reason", async () => {
		const m = await startMain();
		await assert.rejects(m.call({ action: "send", id: "agent#9", task: "x" }), /Unknown agent id: agent#9/);
		await assert.rejects(m.call({ action: "start", system: SYSTEM, task: "x", model: "sub/zzz" }), /Unknown model: sub\/zzz/);
		await assert.rejects(m.call({ action: "start", task: "x" }), /system is required/);
		await assert.rejects(m.call({ action: "start", system: SYSTEM }), /task is required/);
		sub.replies.push(fauxAssistantMessage([fauxText("")], { stopReason: "error", errorMessage: "bad request: field x" }));
		// Strict-mode providers send null for optional fields.
		await m.call({ action: "start", system: SYSTEM, task: "x", model: "sub/a", id: null, thinking: null, tools: null });
		await until(() => m.delivered().length === 1, "the delivery");
		assert.equal(m.delivered()[0], "[agent#1] error: bad request: field x");
		await shutdown(m);
	});

	it("session_shutdown aborts and disposes every subagent without messages", async () => {
		const m = await startMain();
		const g1 = gate("x");
		const g2 = gate("y");
		sub.replies.push(g1.reply, g2.reply);
		await m.call({ action: "start", system: SYSTEM, task: "1", model: "sub/a" });
		await m.call({ action: "start", system: SYSTEM, task: "2", model: "sub/b" });
		await until(() => sub.requests.length === 2, "both requests");
		await m.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		await until(() => g1.wasAborted() && g2.wasAborted(), "both aborts");
		await tick();
		assert.deepEqual(m.delivered(), []);
		m.session.dispose();
	});

	/** The main agent starts a subagent, then streams a reply held by `mainGate` while the subagent answers. */
	async function resultWhileMainBusy(mode: "tui" | "rpc") {
		const m = await startMain(mode);
		const mainGate = gate("main busy");
		const subGate = gate("SUB RESULT");
		sub.replies.push(subGate.reply);
		main.replies.push(
			fauxAssistantMessage([fauxToolCall("agent", { action: "start", system: SYSTEM, task: "t", model: "sub/a" })], {
				stopReason: "toolUse",
			}),
			mainGate.reply,
		);
		const prompt = m.session.prompt("go");
		await until(() => main.requests.length === 2 && sub.requests.length === 1, "main busy, subagent running");
		subGate.release();
		await tick(100);
		return { m, mainGate, prompt };
	}

	/** After an abort: the result is in the session once, no run started for it, and the next prompt carries it once. */
	async function checkKeptAfterAbort(m: Main) {
		await tick(200);
		assert.deepEqual(m.delivered(), ["[agent#1] SUB RESULT"], "the result is in the session");
		assert.equal(main.requests.length, 2, "no run starts after the abort");
		assert.equal(m.session.agent.hasQueuedMessages(), false, "nothing left in the queue");
		await m.session.prompt("next");
		await tick();
		assert.equal(main.requests.length, 3, "one request for the next prompt");
		assert.equal(main.requests[2].texts.filter((t) => t === "[agent#1] SUB RESULT").length, 1, "the model sees it once");
		assert.deepEqual(m.delivered(), ["[agent#1] SUB RESULT"]);
	}

	it("a result that arrives while the main agent streams continues its run once", async () => {
		const { m, mainGate, prompt } = await resultWhileMainBusy("tui");
		assert.deepEqual(m.delivered(), [], "held until the turn ends");
		mainGate.release();
		await prompt;
		await tick();
		assert.deepEqual(m.delivered(), ["[agent#1] SUB RESULT"]);
		assert.equal(main.requests.length, 3);
		assert.ok(main.requests[2].texts.includes("[agent#1] SUB RESULT"));
		await shutdown(m);
	});

	it("TUI Esc while a result waits: the result is kept, no run starts, the next prompt carries it", async () => {
		const { m, prompt } = await resultWhileMainBusy("tui");
		// What Esc does: restoreQueuedMessagesToEditor({ abort: true }) clears the queue, then aborts.
		m.session.clearQueue();
		await m.session.abort();
		await prompt;
		await checkKeptAfterAbort(m);
		await shutdown(m);
	});

	it("RPC abort while a result waits: the result is kept, no run starts, the next prompt carries it", async () => {
		const { m, prompt } = await resultWhileMainBusy("rpc");
		await m.session.abort(); // RPC "abort"
		await prompt;
		await checkKeptAfterAbort(m);
		await shutdown(m);
	});

	it("calls in one batch run in order: start, then send to the new id", async () => {
		const m = await startMain();
		const g = gate("one");
		sub.replies.push(g.reply, fauxAssistantMessage("two"));
		main.replies.push(
			fauxAssistantMessage(
				[
					fauxToolCall("agent", { action: "start", system: SYSTEM, task: "first", model: "sub/a" }, { id: "c1" }),
					fauxToolCall("agent", { action: "send", id: "agent#1", task: "second" }, { id: "c2" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("batch done"),
		);
		await m.session.prompt("go");
		const results = m.session.messages.flatMap((x) =>
			x.role === "toolResult" ? [x.content.map((c) => (c.type === "text" ? c.text : "")).join("")] : [],
		);
		assert.deepEqual(results, ["agent#1 started", "agent#1: queued after the current run"]);
		g.release();
		await until(() => m.delivered().length === 1, "the delivery");
		assert.equal(m.delivered()[0], "[agent#1] one\n\ntwo");
		await shutdown(m);
	});

	it("print mode: the main run waits for running subagents and continues with their answers", async () => {
		const m = await startMain("print");
		const g = gate("sub result");
		sub.replies.push(g.reply);
		main.replies.push(
			fauxAssistantMessage([fauxToolCall("agent", { action: "start", system: SYSTEM, task: "t", model: "sub/a" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("started it"),
			fauxAssistantMessage("got it"),
		);
		let settled = false;
		const prompt = m.session.prompt("go").then(() => {
			settled = true;
		});
		await until(() => sub.requests.length === 1, "the subagent request");
		await tick();
		assert.equal(settled, false, "the main run waits");
		g.release();
		await prompt;
		assert.deepEqual(m.delivered(), ["[agent#1] sub result"]);
		assert.ok(main.requests[2].texts.includes("[agent#1] sub result"));
		const last = m.session.messages.at(-1);
		assert.ok(last?.role === "assistant" && last.content.some((c) => c.type === "text" && c.text === "got it"));
		await shutdown(m);
	});
});
