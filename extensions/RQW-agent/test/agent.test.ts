// The extension inside real Pi sessions, no model: a main AgentSession loads RQW-agent from its file, and two faux
// providers from pi-ai answer for the main agent and for the subagents. Each subagent request is recorded with the
// model, the reasoning level, the system messages and the declared tools Pi sent.
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
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
	AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionContext,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION = join(HERE, "..", "index.ts");
// The package's exports map hides this module, so it is imported by file URL next to the package entry.
const { makeStrictJsonSchema } = await import(
	new URL("./api/constrained-sampling.js", import.meta.resolve("@earendil-works/pi-ai")).href
);

const SYSTEM = "You are a test subagent.\nAnswer in one word.";

/** One request a provider got; `declared` holds each tool's description and parameter names. */
type Request = {
	model: string;
	reasoning?: string;
	system: string[];
	tools: string[];
	declared: Record<string, { description: string; parameters: string[] }>;
	texts: string[];
};

function record(context: TranscriptContext, options: SimpleStreamOptions | undefined, model: { id: string }): Request {
	const tools = new Map<string, { description: string; parameters: string[] }>();
	const system: string[] = [];
	const texts: string[] = [];
	for (const m of context.messages) {
		if (m.role === "system") {
			system.push(getSystemMessageText(m));
			for (const t of m.toolsAdded ?? [])
				tools.set(t.name, { description: t.description, parameters: Object.keys((t.parameters as { properties?: object }).properties ?? {}).sort() });
			for (const t of m.toolsRemoved ?? []) tools.delete(t.name);
		} else if (typeof m.content === "string") texts.push(m.content);
		else for (const c of m.content) if (c.type === "text") texts.push(c.text);
	}
	return { model: model.id, reasoning: options?.reasoning, system, tools: [...tools.keys()], declared: Object.fromEntries(tools), texts };
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
	ctx: ExtensionContext;
	call: (params: Record<string, unknown>) => Promise<string>;
	/** Texts of the `agent` messages the main session got. */
	delivered: () => string[];
};

async function startMain(
	mode: "tui" | "rpc" | "print" = "tui",
	sessionManager?: SessionManager,
	extra: string[] = [],
	extension = EXTENSION,
): Promise<Main> {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	const resourceLoader = new DefaultResourceLoader({
		cwd: dir,
		agentDir,
		additionalExtensionPaths: [extension, ...extra],
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
		sessionManager: sessionManager ?? SessionManager.inMemory(dir),
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
	return { dir, session, ctx, call, delivered };
}

async function shutdown(m: Main) {
	await m.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
	m.session.dispose();
}

describe("agent tool", () => {
	it("child requests never arm a warmer, independently of the main settings", async t => {
		const sessions: AgentSession[] = [];
		const original = (AgentSession.prototype as any)._bindExtensionCore;
		t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function(this: AgentSession, ...args: unknown[]) {
			sessions.push(this);
			return original.apply(this, args);
		});
		const m = await startMain();
		const g = gate("done");
		sub.replies.push(g.reply);
		try {
			m.session.setCacheWarmingMode("idle");
			await m.call({ action: "start", system: SYSTEM, task: "hi", model: "sub/a" });
			await until(() => sub.requests.length === 1, "child request");
			const child = sessions.find(s => s !== m.session)!;
			assert.equal(child.settingsManager.getGlobalSettings().cacheWarming, "off");
			await (await child.agent.streamFunction({ ...child.model!, promptCache: { short: 300 } },
				{ messages: [{ role: "user", content: "cache probe", timestamp: 0 }] }, { sessionId: child.sessionId })).result();
			assert.deepEqual(child.cacheWarmingStatus, { state: "inactive", reason: "cache warming disabled" });
		} finally { g.release(); await shutdown(m); }
	});
	it("has a complete description and a schema that passes Pi's strict mode", async () => {
		const m = await startMain();
		const tool = m.session.getToolDefinition("agent") as ToolDefinition;
		assert.doesNotThrow(() => makeStrictJsonSchema(tool.parameters));
		assert.match(tool.description, /you supply its whole system prompt/);
		assert.match(tool.description, /estimate/i);
		assert.match(tool.description, /timeout_ms/);
		assert.match(tool.description, /default/i);
		assert.match(tool.description, /busy[- ]poll/i);
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
		assert.deepEqual(r.tools.sort(), ["code_writer", "grep", "read", "shell_runner"]);
		assert.deepEqual(r.texts, ["do X"]);
		assert.deepEqual(m.delivered(), [], "nothing delivered while running");
		g.release();
		await until(() => m.delivered().length === 1, "the delivery");
		assert.equal(m.delivered()[0], "[agent#1] first answer");
		await until(() => main.requests.length === 1, "a main turn");
		assert.ok(main.requests[0].texts.includes("[agent#1] first answer"), "the main model sees the message");
		await shutdown(m);
	});

	it("defaults: the main model and thinking level, all six tools and workers, no agent tool", async () => {
		const m = await startMain();
		await m.call({ action: "start", system: SYSTEM, task: "hi" });
		await until(() => m.delivered().length === 1, "the delivery");
		const r = main.requests[0];
		assert.deepEqual(r.system, [SYSTEM]);
		assert.equal(r.model, "m");
		assert.equal(r.reasoning, "low");
		assert.deepEqual(r.tools.sort(), ["bash", "code_writer", "edit", "find", "grep", "read", "shell_runner", "write"]);
		await shutdown(m);
	});

	it("loads and works from a folder with no other extension, importing nothing from one", async () => {
		const folder = resolve(HERE, "..");
		const outside: string[] = [];
		for (const name of await readdir(folder, { recursive: true })) {
			if (!name.endsWith(".ts")) continue;
			const file = join(folder, name);
			const source = await readFile(file, "utf8");
			for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g))
				if (!resolve(dirname(file), match[1]).startsWith(folder + sep)) outside.push(`${name} -> ${match[1]}`);
		}
		assert.deepEqual(outside, [], "all TypeScript imports, including test imports, stay inside RQW-agent");
		const alone = join(root, "alone");
		await mkdir(join(alone, "extensions", "RQW-agent"), { recursive: true });
		await cp(join(HERE, ".."), join(alone, "extensions", "RQW-agent"), { recursive: true, filter: path => path !== HERE });
		await symlink(realpathSync(join(HERE, "..", "..", "..", "node_modules")), join(alone, "node_modules"), "junction");
		const m = await startMain("tui", undefined, [], join(alone, "extensions", "RQW-agent", "index.ts"));
		sub.replies.push(fauxAssistantMessage("alone"));
		await m.call({ action: "start", system: SYSTEM, task: "hi", model: "sub/a" });
		await until(() => m.delivered().length === 1, "the delivery");
		assert.equal(m.delivered()[0], "[agent#1] alone");
		await shutdown(m);
	});

	it("without RQW-tools the subagent has Pi's stock tools, run in the main cwd", async () => {
		const m = await startMain();
		sub.replies.push(
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "A" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("written"),
		);
		await m.call({ action: "start", system: SYSTEM, task: "write", model: "sub/a" });
		await until(() => m.delivered().length === 1, "the delivery");
		assert.equal(m.delivered()[0], "[agent#1] written");
		assert.equal(await readFile(join(m.dir, "a.txt"), "utf8"), "A");
		const stock = createWriteToolDefinition(m.dir);
		assert.deepEqual(sub.requests[0].declared.write, {
			description: stock.description,
			parameters: Object.keys(stock.parameters.properties).sort(),
		});
		assert.ok(!sub.requests[0].declared.write.parameters.includes("files"));
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
		const interrupted = JSON.parse(await m.call({ action: "interrupt", id: "agent#1" }));
		assert.deepEqual(Object.keys(interrupted).sort(), ["cancellation_requested", "id", "reason", "snapshot"]);
		assert.equal(interrupted.id, "agent#1");
		assert.equal(interrupted.reason, "interruption_requested");
		assert.equal(interrupted.cancellation_requested, true);
		await until(() => g.wasAborted(), "the abort");
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
		assert.deepEqual([r.system, r.model, r.reasoning, r.tools.sort()], [[SYSTEM], "a", "high", ["code_writer", "read", "shell_runner"]]);
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

	it("a queued follow-up that fails: one message carries the first answer and the error", async () => {
		const m = await startMain();
		const g = gate("FIRST ANSWER");
		sub.replies.push(g.reply, fauxAssistantMessage([fauxText("")], { stopReason: "error", errorMessage: "bad request" }));
		await m.call({ action: "start", system: SYSTEM, task: "first", model: "sub/a" });
		await until(() => sub.requests.length === 1, "the first request");
		await m.call({ action: "send", id: "agent#1", task: "also" });
		g.release();
		await until(() => m.delivered().length === 1, "the delivery");
		await tick();
		assert.equal(sub.requests.length, 2);
		assert.deepEqual(m.delivered(), ["[agent#1] FIRST ANSWER\n\nerror: bad request"]);
		await shutdown(m);
	});

	it("a first task that fails for good and a queued follow-up that succeeds: one message carries the error and the answer", async () => {
		const m = await startMain();
		let fail = () => {};
		const first = () =>
			new Promise<AssistantMessage>((resolve) => {
				fail = () => resolve(fauxAssistantMessage([fauxText("")], { stopReason: "error", errorMessage: "bad request: first task" }));
			});
		sub.replies.push(first, fauxAssistantMessage("SECOND ANSWER"));
		await m.call({ action: "start", system: SYSTEM, task: "first", model: "sub/a" });
		await until(() => sub.requests.length === 1, "the first request");
		await m.call({ action: "send", id: "agent#1", task: "second" });
		fail();
		await until(() => m.delivered().length === 1, "the delivery");
		await tick();
		assert.equal(sub.requests.length, 2);
		assert.deepEqual(m.delivered(), ["[agent#1] error: bad request: first task\n\nSECOND ANSWER"]);
		await shutdown(m);
	});

	it("an error that Pi retries is not part of the message", async () => {
		const m = await startMain();
		sub.replies.push(
			fauxAssistantMessage([fauxText("")], { stopReason: "error", errorMessage: "529 overloaded_error: Overloaded" }),
			fauxAssistantMessage("OK AFTER RETRY"),
		);
		await m.call({ action: "start", system: SYSTEM, task: "first", model: "sub/a" });
		await until(() => m.delivered().length === 1, "the delivery", 20000);
		assert.equal(sub.requests.length, 2, "Pi retried the request");
		assert.deepEqual(m.delivered(), ["[agent#1] OK AFTER RETRY"]);
		await shutdown(m);
	});

	it("an overflow error or a truncated answer that Pi compacts and retries is not part of the message", async () => {
		// Pi retries these after compaction: `compaction_end` with `willRetry`, no `auto_retry_start`.
		const firsts = {
			overflow: fauxAssistantMessage([fauxText("")], { stopReason: "error", errorMessage: "prompt is too long: 213462 tokens > 200000 maximum" }),
			length: fauxAssistantMessage("PARTIAL TRUNC", { stopReason: "length" }),
		};
		const big = "x ".repeat(60000); // two such tasks give compaction something to summarize
		for (const [name, first] of Object.entries(firsts)) {
			const m = await startMain();
			sub.requests.length = 0;
			sub.replies.push(fauxAssistantMessage("ONE"));
			await m.call({ action: "start", system: SYSTEM, task: big, model: "sub/a" });
			await until(() => m.delivered().length === 1, "first delivery");
			sub.replies.push(fauxAssistantMessage("TWO"));
			await m.call({ action: "send", id: "agent#1", task: big });
			await until(() => m.delivered().length === 2, "second delivery");
			sub.replies.push(first, fauxAssistantMessage("SUMMARY"), fauxAssistantMessage(`FINAL ${name}`));
			await m.call({ action: "send", id: "agent#1", task: "third" });
			await until(() => m.delivered().length === 3, "third delivery", 10000);
			await tick();
			assert.equal(sub.requests.length, 5, `${name}: the failed request, the summary and the retry`);
			assert.deepEqual(m.delivered().slice(2), [`[agent#1] FINAL ${name}`], name);
			await shutdown(m);
		}
	});

	it("interrupt, stop and restart right after start in one batch stop the first request", async () => {
		const ends = ["interrupt", "stop", "restart"] as const;
		for (const end of ends) {
			const m = await startMain();
			sub.requests.length = 0;
			const g = gate("SHOULD NOT RUN");
			sub.replies.push(g.reply);
			// Not awaited in between, as the calls of one batch.
			const started = m.call({ action: "start", system: SYSTEM, task: "long", model: "sub/a" });
			const ended = m.call({ action: end, id: "agent#1" });
			assert.equal(await started, "agent#1 started");
			const result = await Promise.race([ended, tick(1000).then(() => "still waiting")]);
			g.release();
			await ended;
			if (end === "interrupt") {
				const interrupted = JSON.parse(result);
				assert.equal(interrupted.id, "agent#1", `${end} returns at once`);
				assert.equal(interrupted.reason, "interruption_requested", `${end} returns at once`);
				assert.equal(interrupted.cancellation_requested, true, `${end} returns at once`);
			} else {
				const expected = { stop: "agent#1 stopped", restart: "agent#1 restarted, idle" }[end];
				assert.equal(result, expected, `${end} returns at once`);
			}
			await tick(300);
			assert.equal(sub.requests.length, 0, `${end}: no subagent request`);
			assert.deepEqual(m.delivered(), [], `${end}: no message`);
			sub.replies.length = 0;
			await shutdown(m);
		}
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
	async function resultWhileMainBusy(mode: "tui" | "rpc", sessionManager?: SessionManager) {
		const m = await startMain(mode, sessionManager);
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

	it("two results while another extension's slow agent_before_settle runs after ours get one main turn", async () => {
		const slow = ((globalThis as { __slowSettle?: { enabled: boolean; entered: boolean; release: () => void } }).__slowSettle ??= {
			enabled: false,
			entered: false,
			release: () => {},
		});
		slow.enabled = true;
		slow.entered = false;
		const m = await startMain("tui", undefined, [join(HERE, "slow-settle.ts")]);
		const g1 = gate("R1");
		const g2 = gate("R2");
		sub.replies.push(g1.reply, g2.reply);
		main.replies.push(
			fauxAssistantMessage(
				[
					fauxToolCall("agent", { action: "start", system: SYSTEM, task: "t1", model: "sub/a" }, { id: "c1" }),
					fauxToolCall("agent", { action: "start", system: SYSTEM, task: "t2", model: "sub/a" }, { id: "c2" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("started both, will wait"),
		);
		const prompt = m.session.prompt("go");
		await until(() => slow.entered && sub.requests.length === 2, "the main run in the slow handler");
		g1.release();
		g2.release();
		await tick(100);
		slow.enabled = false;
		slow.release();
		await prompt;
		await until(() => main.requests.length === 3, "the turn for the results");
		await tick(300);
		assert.equal(main.requests.length, 3, "go, the tool turn and one turn for both results");
		assert.ok(main.requests[2].texts.includes("[agent#1] R1"));
		assert.ok(main.requests[2].texts.includes("[agent#2] R2"));
		assert.deepEqual(m.delivered().sort(), ["[agent#1] R1", "[agent#2] R2"]);
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

	/** A subagent interrupted with a history above its compaction threshold; its summary reply is held for 3 s. */
	async function largeInterrupted() {
		const m = await startMain();
		sub.replies.push(fauxAssistantMessage("one"));
		await m.call({ action: "start", system: SYSTEM, task: "small", model: "sub/a" });
		await until(() => m.delivered().length === 1, "first delivery");
		sub.replies.push(gate("never").reply);
		await m.call({ action: "send", id: "agent#1", task: "x".repeat(500_000) });
		await until(() => sub.requests.length === 2, "the large request");
		await m.call({ action: "interrupt", id: "agent#1" });
		await tick(); // interrupt acknowledges the request; this cooperative faux run settles before send.
		const summary = gate("SUMMARY");
		sub.replies.push(summary.reply, fauxAssistantMessage("LEAKED"));
		const timer = setTimeout(() => summary.release(), 3000);
		return { m, summary, done: () => clearTimeout(timer) };
	}

	for (const end of ["interrupt", "stop", "restart", "shutdown"] as const) {
		it(`send above the threshold returns before the pre-run compaction; ${end} right after it sends no request`, async () => {
			const { m, summary, done } = await largeInterrupted();
			const t0 = Date.now();
			assert.equal(await m.call({ action: "send", id: "agent#1", task: "next" }), "agent#1: sent");
			assert.ok(Date.now() - t0 < 100, `send took ${Date.now() - t0} ms`);
			if (end === "shutdown") await m.session.extensionRunner.emit({ type: "session_shutdown", reason: "new" });
			else await m.call({ action: end, id: "agent#1" });
			assert.ok(Date.now() - t0 < 200, `${end} took ${Date.now() - t0} ms`);
			await tick(500);
			assert.equal(sub.requests.length, 2, "no summary request and no request for the task");
			assert.equal(summary.wasAborted(), false);
			assert.deepEqual(m.delivered(), ["[agent#1] one"]);
			done();
			await shutdown(m);
		});
	}

	for (const end of ["stop", "restart", "shutdown"] as const) {
		it(`${end} during the pre-run compaction of a send aborts the summary and sends no further request`, async () => {
			const { m, summary, done } = await largeInterrupted();
			await m.call({ action: "send", id: "agent#1", task: "next" });
			await until(() => sub.requests.length === 3, "the summary request");
			if (end === "shutdown") await m.session.extensionRunner.emit({ type: "session_shutdown", reason: "new" });
			else await m.call({ action: end, id: "agent#1" });
			await tick(500);
			assert.equal(summary.wasAborted(), true);
			assert.equal(sub.requests.length, 3, "no request from the closed session");
			done();
			await shutdown(m);
		});
	}

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
	/**
	 * A session that already holds an answered `[agent#1]` result from an earlier extension instance, as after
	 * /reload, /resume, /fork or `pi -c`. The request logs are cleared afterwards.
	 */
	async function continuedSession(mode: "tui" | "print"): Promise<SessionManager> {
		const dir = join(root, `c${counter++}`);
		await mkdir(dir, { recursive: true });
		const sessionManager = SessionManager.inMemory(dir);
		const m = await startMain(mode, sessionManager);
		sub.replies.push(fauxAssistantMessage("old result"));
		main.replies.push(fauxAssistantMessage("got old"));
		await m.call({ action: "start", system: SYSTEM, task: "old", model: "sub/a" });
		await until(() => main.requests.length === 1 && m.session.isIdle, "the main turn for the old result");
		await tick();
		assert.deepEqual(m.delivered(), ["[agent#1] old result"]);
		await shutdown(m);
		main.requests.length = 0;
		sub.requests.length = 0;
		return sessionManager;
	}

	it("continued session with an earlier [agent#1] result: a result while busy still continues the run once", async () => {
		const sessionManager = await continuedSession("tui");
		const { m, mainGate, prompt } = await resultWhileMainBusy("tui", sessionManager);
		mainGate.release();
		await prompt;
		await tick();
		const started = m.session.messages.flatMap((x) =>
			x.role === "toolResult" ? [x.content.map((c) => (c.type === "text" ? c.text : "")).join("")] : [],
		);
		assert.equal(started.at(-1), "agent#2 started", "a new subagent gets an id the session does not hold yet");
		assert.deepEqual(m.delivered(), ["[agent#1] old result", "[agent#2] SUB RESULT"]);
		assert.equal(main.requests.length, 3, "go, the tool turn and one continuation for the result");
		assert.ok(main.requests[2].texts.includes("[agent#2] SUB RESULT"));
		await shutdown(m);
	});

	it("print mode, continued session with an earlier [agent#1] result: the run continues with the new result", async () => {
		const sessionManager = await continuedSession("print");
		const m = await startMain("print", sessionManager);
		const g = gate("NEW RESULT");
		sub.replies.push(g.reply);
		main.replies.push(
			fauxAssistantMessage([fauxToolCall("agent", { action: "start", system: SYSTEM, task: "t", model: "sub/a" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("started it"),
			fauxAssistantMessage("got new"),
		);
		const prompt = m.session.prompt("go");
		await until(() => sub.requests.length === 1, "the subagent request");
		await tick();
		g.release();
		await prompt;
		assert.deepEqual(m.delivered(), ["[agent#1] old result", "[agent#2] NEW RESULT"]);
		assert.equal(main.requests.length, 3, "go, the tool turn and one continuation with the new result");
		assert.ok(main.requests[2].texts.includes("[agent#2] NEW RESULT"));
		const last = m.session.messages.at(-1);
		assert.ok(last?.role === "assistant" && last.content.some((c) => c.type === "text" && c.text === "got new"));
		await shutdown(m);
	});
});
