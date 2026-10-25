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
	createCodemodeExtension,
	createToolSearchExtension,
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionFactory,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { SUBAGENT_REMINDER } from "../../../extensions/RQW-agent/prompt.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION = join(HERE, "../../../extensions/RQW-agent/index.ts");
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
// A grandchild's provider in the recursion test: it answers DEEP unless scripted.
const deep = scripted("deep", [{ id: "g", reasoning: true }], "DEEP");

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-agent-"));
	agentDir = join(root, "agent");
	await mkdir(agentDir, { recursive: true });
	modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(main.faux.provider);
	modelRuntime.registerNativeProvider(sub.faux.provider);
	modelRuntime.registerNativeProvider(deep.faux.provider);
});
after(async () => {
	await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
	for (const p of [main, sub, deep]) {
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
	options: { settings?: Record<string, unknown>; factories?: ExtensionFactory[]; tools?: string[] } = {},
): Promise<Main> {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	const resourceLoader = new DefaultResourceLoader({
		cwd: dir,
		agentDir,
		additionalExtensionPaths: [extension, ...extra],
		extensionFactories: options.factories,
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
		settingsManager: SettingsManager.inMemory(options.settings ?? {}),
		...(options.tools ? { tools: options.tools } : {}),
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
		assert.equal(Object.hasOwn(tool.parameters.properties, "blocking"), false);
		assert.doesNotMatch(tool.description, /blocking\s*:\s*true/);
		assert.match(tool.description, /By default its system prompt is yours plus a short subagent reminder and your optional role; system replaces the whole prompt/);
		assert.match(tool.description, /Do not use it for a narrow question/);
		assert.match(tool.description, /sees neither the user nor your history/);
		assert.doesNotMatch(tool.description, /coordinator/i, "no coordinator rules in the product description");
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
		assert.deepEqual(r.tools.sort(), ["agent", "grep", "read"]);
		assert.deepEqual(r.texts, ["do X"]);
		assert.deepEqual(m.delivered(), [], "nothing delivered while running");
		g.release();
		await until(() => m.delivered().length === 1, "the delivery");
		assert.equal(m.delivered()[0], "[agent#1] first answer");
		await until(() => main.requests.length === 1, "a main turn");
		assert.ok(main.requests[0].texts.includes("[agent#1] first answer"), "the main model sees the message");
		await shutdown(m);
	});

	it("defaults: the main agent's system prompt plus the subagent reminder, the main model and thinking level, all six base tools and agent", async () => {
		const m = await startMain();
		const mainPrompt = m.session.systemPrompt;
		assert.ok(mainPrompt.length > 0);
		await m.call({ action: "start", task: "hi" });
		await until(() => m.delivered().length === 1, "the delivery");
		const r = main.requests[0];
		assert.deepEqual(r.system, [`${mainPrompt.trimEnd()}\n\n${SUBAGENT_REMINDER}`]);
		assert.match(SUBAGENT_REMINDER, /subagent/);
		assert.match(SUBAGENT_REMINDER, /main agent or a coordinator do not apply to you/);
		assert.equal(r.model, "m");
		assert.equal(r.reasoning, "low");
		assert.deepEqual(r.tools.sort(), ["agent", "bash", "edit", "find", "grep", "read", "write"]);
		await shutdown(m);
	});

	it("role: added after the reminder; restart keeps it, system replaces it, a new role replaces system", async () => {
		const m = await startMain();
		const mainPrompt = m.session.systemPrompt.trimEnd();
		sub.replies.push(fauxAssistantMessage("one"), fauxAssistantMessage("two"), fauxAssistantMessage("three"), fauxAssistantMessage("four"));
		await m.call({ action: "start", role: "  You are a careful tester.  ", task: "go", model: "sub/a" });
		await until(() => m.delivered().length === 1, "the first delivery");
		const withRole = `${mainPrompt}\n\n${SUBAGENT_REMINDER}\n\n<role>\nYou are a careful tester.\n</role>`;
		assert.deepEqual(sub.requests[0].system, [withRole]);
		await m.call({ action: "restart", id: "agent#1", task: "again" });
		await until(() => m.delivered().length === 2, "the second delivery");
		assert.deepEqual(sub.requests[1].system, [withRole], "restart keeps the role");
		await m.call({ action: "restart", id: "agent#1", system: SYSTEM, task: "custom" });
		await until(() => m.delivered().length === 3, "the third delivery");
		assert.deepEqual(sub.requests[2].system, [SYSTEM], "system is the whole prompt");
		await m.call({ action: "restart", id: "agent#1", role: "R2", task: "role again" });
		await until(() => m.delivered().length === 4, "the fourth delivery");
		assert.deepEqual(sub.requests[3].system, [`${mainPrompt}\n\n${SUBAGENT_REMINDER}\n\n<role>\nR2\n</role>`]);
		await assert.rejects(m.call({ action: "start", system: SYSTEM, role: "R", task: "x" }), /not both/);
		await shutdown(m);
	});

	it("loads and works from a folder with no other extension, importing nothing from one", async () => {
		const folder = resolve(HERE, "../../../extensions/RQW-agent");
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
		await cp(folder, join(alone, "extensions", "RQW-agent"), { recursive: true });
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

	it("send while running steers: it reaches the child before its next request; one message carries both answers", async () => {
		const m = await startMain();
		const g = gate("one");
		sub.replies.push(g.reply, fauxAssistantMessage("two"));
		await m.call({ action: "start", system: SYSTEM, task: "first", model: "sub/a" });
		await until(() => sub.requests.length === 1, "the first request");
		assert.equal(await m.call({ action: "send", id: "1", task: "also" }), "agent#1: queued after the current tool call");
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
		assert.deepEqual([r.system, r.model, r.reasoning, r.tools.sort()], [[SYSTEM], "a", "high", ["agent", "read"]]);
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
		await assert.rejects(m.call({ action: "start", system: SYSTEM, role: "R", task: "x" }), /system .* or role .*, not both/);
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
		sub.replies.push(g.reply);
		const before = sub.requests.length;
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
		assert.deepEqual(results, ["agent#1 started", "agent#1: queued after the current tool call"]);
		g.release();
		await until(() => m.delivered().length === 1, "the delivery");
		assert.equal(m.delivered()[0], "[agent#1] one");
		// The steering message reached the child before its first request, so that one request carries both tasks.
		assert.equal(sub.requests.length, before + 1);
		assert.deepEqual(sub.requests[before].texts, ["first", "second"]);
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

describe("subagent parity", () => {
	/** Every child AgentSession that binds its extensions, in creation order; the main session is filtered out by the caller. */
	function captureSessions(t: { mock: { method: (...args: any[]) => unknown } }) {
		const sessions: AgentSession[] = [];
		const original = (AgentSession.prototype as any)._bindExtensionCore;
		t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function(this: AgentSession, ...args: unknown[]) {
			sessions.push(this);
			return original.apply(this, args);
		});
		return sessions;
	}
	const customOf = (m: Main) => m.session.messages.flatMap(x => x.role === "custom" && x.customType === "agent" ? [x] : []);

	it("title: shown in status and in the delivered details, the delivered content unchanged; restart keeps it", async () => {
		const m = await startMain();
		const g = gate("titled");
		sub.replies.push(g.reply, fauxAssistantMessage("again"));
		await m.call({ action: "start", title: " Find the bug ", task: "go", model: "sub/a" });
		await until(() => sub.requests.length === 1, "the request");
		const status = JSON.parse(await m.call({ action: "status", ids: ["agent#1"] }));
		assert.equal(status.statuses[0].title, "Find the bug");
		g.release();
		await until(() => m.delivered().length === 1, "the delivery");
		assert.equal(m.delivered()[0], "[agent#1] titled", "the content format is unchanged");
		assert.equal((customOf(m)[0].details as { title?: string }).title, "Find the bug");
		await m.call({ action: "restart", id: "agent#1", task: "more" });
		await until(() => m.delivered().length === 2, "the second delivery");
		assert.equal((customOf(m)[1].details as { title?: string }).title, "Find the bug", "restart keeps the title");
		await m.call({ action: "start", task: "untitled", model: "sub/a" });
		await until(() => m.delivered().length === 3, "the third delivery");
		assert.equal("title" in (customOf(m)[2].details as object), false, "no title, no field");
		await shutdown(m);
	});

	it("children run with the owner's settings that the main session uses; cache warming stays off", async t => {
		const sessions = captureSessions(t);
		const settings = {
			retry: { enabled: true, maxRetries: 7, baseDelayMs: 1234, provider: { timeoutMs: 55555, maxRetries: 2 } },
			transport: "sse", httpIdleTimeoutMs: 77777, websocketConnectTimeoutMs: 4444,
			compaction: { enabled: true, reserveTokens: 12345, keepRecentTokens: 6789 },
			thinkingBudgets: { low: 1111 }, steeringMode: "one-at-a-time", followUpMode: "one-at-a-time",
			images: { autoResize: false, blockImages: true }, shellCommandPrefix: "set -e", codemode: { inlineBudget: 42 },
			cacheWarming: "idle", theme: "light",
		};
		const m = await startMain("tui", undefined, [], EXTENSION, { settings });
		sub.replies.push(fauxAssistantMessage("ok"));
		await m.call({ action: "start", system: SYSTEM, task: "hi", model: "sub/a" });
		await until(() => m.delivered().length === 1, "the delivery");
		const child = sessions.find(s => s !== m.session)!.settingsManager;
		assert.deepEqual(child.getRetrySettings(), { ...child.getRetrySettings(), enabled: true, maxRetries: 7, baseDelayMs: 1234 });
		assert.deepEqual(child.getProviderRetrySettings(), { ...child.getProviderRetrySettings(), timeoutMs: 55555, maxRetries: 2 });
		assert.equal(child.getTransport(), "sse");
		assert.equal(child.getHttpIdleTimeoutMs(), 77777);
		assert.equal(child.getWebSocketConnectTimeoutMs(), 4444);
		assert.deepEqual([child.getCompactionSettings().reserveTokens, child.getCompactionSettings().keepRecentTokens], [12345, 6789]);
		assert.equal(child.getThinkingBudgets()?.low, 1111);
		assert.deepEqual([child.getSteeringMode(), child.getFollowUpMode()], ["one-at-a-time", "one-at-a-time"]);
		assert.deepEqual([child.getImageAutoResize(), child.getBlockImages(), child.getShellCommandPrefix()], [false, true, "set -e"]);
		assert.equal(child.getGlobalSettings().codemode?.inlineBudget, 42);
		assert.equal(child.getGlobalSettings().cacheWarming, "off", "never the main mode");
		assert.equal(child.getGlobalSettings().theme, undefined, "UI settings are not copied");
		await shutdown(m);
	});

	it("codemode and tool_search: a child gets them when the main session has them active, Pi's own definitions", async () => {
		const m = await startMain("tui", undefined, [], EXTENSION, {
			factories: [createCodemodeExtension(), createToolSearchExtension()],
			tools: ["read", "bash", "edit", "write", "grep", "find", "agent", "codemode", "tool_search"],
		});
		assert.ok(m.session.getActiveToolNames().includes("codemode"));
		sub.replies.push(fauxAssistantMessage("one"));
		await m.call({ action: "start", system: SYSTEM, task: "hi", model: "sub/a", tools: ["read"] });
		await until(() => m.delivered().length === 1, "the delivery");
		assert.deepEqual(sub.requests[0].tools.sort(), ["agent", "codemode", "read", "tool_search"]);
		await shutdown(m);
	});

	it("without codemode active in the main session a child gets neither tool", async () => {
		const m = await startMain("tui", undefined, [], EXTENSION, { factories: [createCodemodeExtension(), createToolSearchExtension()] });
		assert.ok(!m.session.getActiveToolNames().includes("codemode"));
		sub.replies.push(fauxAssistantMessage("one"));
		await m.call({ action: "start", system: SYSTEM, task: "hi", model: "sub/a", tools: ["read"] });
		await until(() => m.delivered().length === 1, "the delivery");
		assert.deepEqual(sub.requests[0].tools.sort(), ["agent", "read"]);
		await shutdown(m);
	});

	/** A main-session extension answering the RQW-tools offer like RQW-tools: all six tools, `job`, and the child's codemode. */
	function toolsOffer(seen: { label?: string; codemode?: ToolDefinition }[], returned: ToolDefinition[], jobEvents: string[]): ExtensionFactory {
		return (pi: ExtensionAPI) => {
			pi.events.on("rqw-tools:subagent-tools", (request) => (request as { offer(f: unknown): void }).offer(
				(dir: string, _settings: unknown, _nested: unknown, options: { label?: string; codemode?: ToolDefinition } = {}) => {
					seen.push(options);
					const plain = ["read", "bash", "edit", "write", "grep", "find"].map((name) => ({
						...createWriteToolDefinition(dir), name, label: name, description: `OFFERED ${name}`,
					}));
					const job = { name: "job", label: "job", description: "OFFERED job", parameters: Type.Object({}),
						execute: async () => ({ content: [{ type: "text" as const, text: "{}" }], details: {} }),
						jobs: { abortAll: () => jobEvents.push(`abortAll ${options.label}`), dispose: () => jobEvents.push(`dispose ${options.label}`) } };
					const codemode = options.codemode ? [{ ...options.codemode, description: "OFFERED codemode" }] : [];
					returned.push(...codemode);
					return [...plain, ...codemode, job];
				}));
		};
	}

	it("with RQW-tools offering: children get their own offered codemode, edit/write and job tools", async t => {
		const sessions = captureSessions(t);
		const seen: { label?: string; codemode?: ToolDefinition }[] = [];
		const returned: ToolDefinition[] = [];
		const jobEvents: string[] = [];
		const m = await startMain("tui", undefined, [], EXTENSION, {
			factories: [createCodemodeExtension(), createToolSearchExtension(), toolsOffer(seen, returned, jobEvents)],
			tools: ["read", "bash", "edit", "write", "grep", "find", "agent", "codemode", "tool_search"],
		});
		const mainCodemode = m.session.getToolDefinition("codemode");
		sub.replies.push(fauxAssistantMessage("one"));
		await m.call({ action: "start", system: SYSTEM, task: "hi", model: "sub/a", tools: ["read"] });
		await until(() => m.delivered().length === 1, "the delivery");
		assert.deepEqual(sub.requests[0].tools.sort(), ["agent", "codemode", "job", "read", "tool_search"]);
		assert.equal(seen[0].label, "agent#1");
		assert.equal(seen[0].codemode?.name, "codemode", "the child's own Pi codemode definition goes to the factory");
		assert.notEqual(seen[0].codemode, mainCodemode, "built for the child, not the main session's");
		const child = sessions.find(s => s !== m.session)!;
		assert.equal(child.getToolDefinition("codemode"), returned[0], "the child runs the codemode the factory returned");

		sub.replies.push(fauxAssistantMessage("FOUND"));
		await m.call({ action: "start", task: "find", model: "sub/a" });
		await until(() => m.delivered().length === 2, "the second child delivery");
		assert.deepEqual(sub.requests[1].tools.sort(), ["agent", "bash", "codemode", "edit", "find", "grep", "job", "read", "tool_search", "write"], "all generic tools, plus job because it is offered");
		assert.equal(seen[1].label, "agent#2");
		const secondChild = sessions.filter(s => s !== m.session)[1];
		assert.ok(secondChild.getToolDefinition("agent"));
		for (const name of ["edit", "write"]) assert.equal(secondChild.getToolDefinition(name)?.description, `OFFERED ${name}`);
		assert.equal(secondChild.getToolDefinition("codemode"), returned[1]);
		await m.call({ action: "stop", id: "agent#2" });
		assert.deepEqual(jobEvents, ["dispose agent#2"], "the child's jobs end with it");
		await shutdown(m);
	});

	it("without an RQW-tools offer a child has no job tool", async () => {
		const m = await startMain();
		sub.replies.push(fauxAssistantMessage("FOUND"));
		await m.call({ action: "start", task: "find", model: "sub/a" });
		await until(() => m.delivered().length === 1, "the delivery");
		assert.deepEqual(sub.requests[0].tools.sort(), ["agent", "bash", "edit", "find", "grep", "read", "write"]);
		await shutdown(m);
	});

	it("labels for RQW-tools notes are paths from the main session: agent#1/agent#1", async () => {
		const seen: { label?: string; codemode?: ToolDefinition }[] = [];
		const m = await startMain("tui", undefined, [], EXTENSION, { factories: [toolsOffer(seen, [], [])] });
		sub.replies.push(
			fauxAssistantMessage([fauxToolCall("agent", { action: "start", task: "go deeper", model: "deep/g" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("WAITING"),
			fauxAssistantMessage("TOP"),
		);
		await m.call({ action: "start", task: "delegate", model: "sub/a" });
		await until(() => m.delivered().length === 1, "the final delivery", 5000);
		assert.deepEqual(seen.map(o => o.label), ["agent#1", "agent#1/agent#1"]);
		assert.ok(sub.requests.at(-1)!.texts.includes("[agent#1] DEEP"), "the ids the model sees stay agent#N");
		await shutdown(m);
	});

	it("recursion: a subagent starts its own subagent, which gets the main prompt once and agent again; the answer flows up", async () => {
		const m = await startMain();
		const mainPrompt = m.session.systemPrompt.trimEnd();
		sub.replies.push(
			fauxAssistantMessage([fauxToolCall("agent", { action: "start", task: "go deeper", model: "deep/g", title: "Deeper look" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("WAITING"),
			fauxAssistantMessage("TOP"),
		);
		await m.call({ action: "start", role: "Middle", task: "delegate", model: "sub/a" });
		await until(() => m.delivered().length === 1, "the final delivery", 5000);
		assert.deepEqual(m.delivered(), ["[agent#1] TOP"], "main gets only the subagent's final answer");
		assert.equal(deep.requests.length, 1);
		assert.deepEqual(deep.requests[0].system, [`${mainPrompt}\n\n${SUBAGENT_REMINDER}`], "the main prompt, not the caller's, and no repeated reminder");
		assert.deepEqual(deep.requests[0].tools.sort(), ["agent", "bash", "edit", "find", "grep", "read", "write"]);
		assert.ok(sub.requests.at(-1)!.texts.includes("[agent#1] DEEP"), "the grandchild's result reached its direct caller");
		await tick();
		assert.equal(m.delivered().length, 1);
		await shutdown(m);
	});

});
