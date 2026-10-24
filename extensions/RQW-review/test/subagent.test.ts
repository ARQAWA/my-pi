// The `review` tool offered to a subagent over pi.events (`rqw-review:subagent-review`), as RQW-agent asks for it.
// Real Pi sessions, faux providers, no RQW-agent: the test plays the caller that requests the offer and builds a child
// session the way RQW-agent does (in-memory, no extensions, no session_start).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	type AssistantMessage,
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
	AgentSession,
	createAgentSession,
	createBashToolDefinition,
	createCodemodeExtension,
	createFindToolDefinition,
	createGrepToolDefinition,
	createReadToolDefinition,
	createToolSearchExtension,
	DefaultResourceLoader,
	type ExtensionFactory,
	type EventBus,
	type ExtensionAPI,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ReviewHost } from "../index.ts";
import { CLEAN_VERDICT } from "./codex-wire.ts";

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const mainFaux = fauxProvider({ provider: "main", api: "review-sub-main", models: [{ id: "main" }] });
const childFaux = fauxProvider({ provider: "child", api: "review-sub-child", models: [{ id: "child" }] });
const reviewerFaux = fauxProvider({ provider: "openai-codex", api: "review-sub-reviewer", models: [{ id: "gpt-6.1-sol", reasoning: true }] });

let root: string;
let runtime: ModelRuntime;
before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-review-sub-"));
	await mkdir(join(root, "agent"), { recursive: true });
	runtime = await ModelRuntime.create({ authPath: join(root, "agent", "auth.json"), modelsPath: null, refreshOnCreate: false });
	for (const faux of [mainFaux, childFaux, reviewerFaux]) runtime.registerNativeProvider(faux.provider);
});
after(async () => { await rm(root, { recursive: true, force: true }); });

const textOf = (message: TranscriptContext["messages"][number]) =>
	typeof message.content === "string" ? message.content : message.content.map((c) => (c.type === "text" ? c.text : "")).join("");

async function until(check: () => boolean, what: string, ms = 5000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 5));
	}
}

/** The main session with RQW-review loaded and its pi.events captured, as RQW-agent would use it. */
async function mainBus(options: { factories?: ExtensionFactory[]; tools?: string[]; settings?: Record<string, unknown> } = {}) {
	const captured: { events?: EventBus } = {};
	const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), additionalExtensionPaths: [EXTENSION],
		extensionFactories: [(pi) => { captured.events = pi.events; }, ...(options.factories ?? [])],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: root, agentDir: join(root, "agent"), model: mainFaux.getModel(), modelRuntime: runtime,
		resourceLoader: loader, sessionManager: SessionManager.inMemory(root), settingsManager: SettingsManager.inMemory(options.settings ?? {}),
		...(options.tools ? { tools: options.tools } : {}) });
	await session.bindExtensions({ mode: "tui" });
	return { session, events: captured.events! };
}

/** A child session built like RQW-agent's: in memory, no extensions but the offered review registration. */
async function child(register: (child: ExtensionAPI, host: ReviewHost) => void, host: ReviewHost, codemode = false) {
	const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
	const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager,
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		extensionFactories: [...(codemode ? [createCodemodeExtension()] : []), (sub) => register(sub, host)] });
	await loader.reload();
	const { session } = await createAgentSession({ cwd: root, model: childFaux.getModel(), modelRuntime: runtime, resourceLoader: loader,
		tools: ["read", "review", ...(codemode ? ["codemode"] : [])], sessionManager: SessionManager.inMemory(root), settingsManager });
	return session;
}

function offer(events: EventBus) {
	let register: ((child: ExtensionAPI, host: ReviewHost) => void) | undefined;
	events.emit("rqw-review:subagent-review", { offer: (r: typeof register) => { register = r; } });
	assert.ok(register, "RQW-review answers the request synchronously");
	return register;
}

function reviewCounts(events: EventBus) {
	const sources: { snapshot(): { reviews: number } }[] = [];
	events.emit("rqw:running-counts:request", { version: 1, reply: (source: never) => sources.push(source) });
	return () => sources.reduce((n, s) => n + s.snapshot().reviews, 0);
}

it("a subagent's review: registered in its own session, its own messages as the brief, the verdict delivered to it, counted on the main bus", async () => {
	const { session: main, events } = await mainBus();
	const register = offer(events);
	const controller = new AbortController();
	let fastAsked = 0;
	let releaseReviewer = () => {};
	const reviewerTexts: string[] = [];
	reviewerFaux.setResponses([async (context: TranscriptContext) => {
		reviewerTexts.push(context.messages.filter((m) => m.role === "user").map(textOf).join("\n"));
		await new Promise<void>((r) => { releaseReviewer = r; });
		return fauxAssistantMessage(fauxText(CLEAN_VERDICT));
	}]);
	const childReplies: ((context: TranscriptContext) => AssistantMessage)[] = [
		() => fauxAssistantMessage(fauxToolCall("review", { level: "blind", object: "a.ts", criterion: "the rename" }, { id: "r1" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxText("waiting")),
		(context) => fauxAssistantMessage(fauxText(context.messages.some((m) => m.role === "user" && textOf(m).includes("[review#1] CLEAN")) ? "REVIEWED" : "no verdict")),
	];
	childFaux.setResponses(Array.from({ length: 3 }, (_, i) => childReplies[i]));
	const sub = await child(register, { events, fast: () => { fastAsked++; return false; }, signal: controller.signal });
	try {
		assert.ok(sub.getToolDefinition("review"), "the child has its own review tool");
		const counted = reviewCounts(events);
		const run = sub.prompt("CHILD TASK: rename foo to bar");
		await until(() => reviewerTexts.length === 1, "the reviewer request");
		assert.match(reviewerTexts[0], /<user_messages>[\s\S]*CHILD TASK: rename foo to bar[\s\S]*<\/user_messages>/, "the child's own messages, from its caller");
		assert.equal(counted(), 1, "the running review counts on the main bus");
		assert.equal(fastAsked, 1, "GPT Fast from the host, once at the reviewer's start");
		releaseReviewer();
		await run;
		assert.equal(sub.getLastAssistantText(), "REVIEWED", "the child's run waited for its verdict and answered it");
		assert.equal(counted(), 0);
		assert.ok(sub.messages.some((m) => m.role === "custom" && m.customType === "review" && String(m.content).startsWith("[review#1] CLEAN")), "the verdict is in the child session");
		assert.equal(main.messages.some((m) => m.role === "custom" && m.customType === "review"), false, "nothing reaches the main session");
	} finally {
		controller.abort();
		sub.dispose();
		main.dispose();
	}
});

it("the child's lifetime ends its running reviews: no verdict afterwards, its counts source ends", async () => {
	const { session: main, events } = await mainBus();
	const register = offer(events);
	const controller = new AbortController();
	let entered = false;
	reviewerFaux.setResponses([async (_context: TranscriptContext, options) => {
		entered = true;
		await new Promise<void>((r) => options?.signal?.addEventListener("abort", () => r(), { once: true }));
		return fauxAssistantMessage(fauxText(CLEAN_VERDICT));
	}]);
	childFaux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("review", { level: "blind", object: "a.ts", criterion: "c" }, { id: "r1" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxText("waiting")),
	]);
	const sub = await child(register, { events, fast: () => false, signal: controller.signal });
	try {
		const counted = reviewCounts(events);
		const run = sub.prompt("TASK");
		await until(() => entered, "the reviewer request");
		assert.equal(counted(), 1);
		controller.abort();
		await until(() => counted() === 0, "the review ended with the child");
		await sub.abort();
		await run.catch(() => {});
		await new Promise((r) => setTimeout(r, 50));
		assert.equal(sub.messages.some((m) => m.role === "custom" && m.customType === "review"), false, "no verdict after the child ended");
		const late = reviewCounts(events);
		assert.equal(late(), 0, "no live source after the end");
	} finally {
		sub.dispose();
		main.dispose();
	}
});

it("the reviewer session takes the caller's owner settings, compaction included, with warming off", async () => {
	const { reviewerSettings } = await import("../index.ts");
	const settings = reviewerSettings({
		retry: { enabled: true, maxRetries: 5, provider: { timeoutMs: 999 } }, transport: "sse", httpIdleTimeoutMs: 1, websocketConnectTimeoutMs: 2,
		thinkingBudgets: { low: 3 }, images: { autoResize: false, blockImages: true }, shellPath: "/bin/bash", shellCommandPrefix: "set -e",
		compaction: { enabled: true, reserveTokens: 4 }, codemode: { inlineBudget: 9 }, cacheWarming: "idle", theme: "light",
	} as never);
	assert.deepEqual(settings, {
		retry: { enabled: true, maxRetries: 5, provider: { timeoutMs: 999 } }, transport: "sse", httpIdleTimeoutMs: 1, websocketConnectTimeoutMs: 2,
		thinkingBudgets: { low: 3 }, images: { autoResize: false, blockImages: true }, shellPath: "/bin/bash", shellCommandPrefix: "set -e",
		compaction: { enabled: true, reserveTokens: 4 }, codemode: { inlineBudget: 9 }, cacheWarming: "off",
	});
});

it("the reviewer is a child too: codemode and tool_search when its caller has them active, and the caller's compaction", async (t) => {
	const sessions: AgentSession[] = [];
	const original = (AgentSession.prototype as any)._bindExtensionCore;
	t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function (this: AgentSession, ...args: unknown[]) {
		sessions.push(this);
		return original.apply(this, args);
	});
	for (const active of [true, false]) {
		const { session: main } = await mainBus({
			factories: [createCodemodeExtension(), createToolSearchExtension()],
			settings: { compaction: { enabled: true, reserveTokens: 4321 } },
			...(active ? { tools: ["read", "bash", "edit", "write", "review", "codemode", "tool_search"] } : {}),
		});
		const declared: string[][] = [];
		reviewerFaux.setResponses([(context: TranscriptContext) => {
			const names = new Set<string>();
			for (const m of context.messages) if (m.role === "system") for (const tool of m.toolsAdded ?? []) names.add(tool.name);
			declared.push([...names].sort());
			return fauxAssistantMessage(fauxText(CLEAN_VERDICT));
		}]);
		try {
			sessions.length = 0;
			await main.getToolDefinition("review")!.execute("r1", { level: "blind", object: "a.ts", criterion: "c" } as never, undefined, undefined, main.extensionRunner.createContext());
			await until(() => declared.length === 1, "the reviewer request");
			assert.deepEqual(declared[0], active ? ["bash", "codemode", "find", "grep", "read", "tool_search"] : ["bash", "find", "grep", "read"], `active: ${active}`);
			const reviewer = sessions.find((s) => s !== main)!;
			assert.equal(reviewer.settingsManager.getCompactionSettings().reserveTokens, 4321, "the caller's compaction");
			assert.equal(reviewer.settingsManager.getCompactionEnabled(), true);
			assert.equal(reviewer.settingsManager.getGlobalSettings().cacheWarming, "off");
		} finally {
			await main.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			main.dispose();
		}
	}
});

it("with RQW-tools offering: a child's reviewer gets the offered codemode built from its own, its label, and the child's end disposes its jobs", async (t) => {
	const sessions: AgentSession[] = [];
	const original = (AgentSession.prototype as any)._bindExtensionCore;
	t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function (this: AgentSession, ...args: unknown[]) {
		sessions.push(this);
		return original.apply(this, args);
	});
	const seen: { label?: string; codemode?: ToolDefinition }[] = [];
	const returned: ToolDefinition[] = [];
	const jobEvents: string[] = [];
	const offerTools: ExtensionFactory = (pi) => {
		pi.events.on("rqw-tools:subagent-tools", (request) => (request as { offer(f: unknown): void }).offer(
			(dir: string, _settings: unknown, _nested: unknown, options: { label?: string; codemode?: ToolDefinition } = {}) => {
				seen.push(options);
				const plain = [createReadToolDefinition, createBashToolDefinition, createGrepToolDefinition, createFindToolDefinition].map((make) => make(dir));
				const codemode = options.codemode ? [{ ...options.codemode, description: "OFFERED codemode" } as ToolDefinition] : [];
				returned.push(...codemode);
				return [...plain, ...codemode, {
					name: "job", label: "job", description: "OFFERED job", parameters: { type: "object", properties: {} },
					execute: async () => ({ content: [{ type: "text", text: "{}" }], details: {} }),
					jobs: { abortAll: () => jobEvents.push("abortAll"), dispose: () => jobEvents.push("dispose") },
				}];
			}));
	};
	const { session: main, events } = await mainBus({ factories: [offerTools] });
	const register = offer(events);
	const controller = new AbortController();
	const declared: string[][] = [];
	reviewerFaux.setResponses([async (context: TranscriptContext, options) => {
		const names = new Set<string>();
		for (const m of context.messages) if (m.role === "system") for (const tool of m.toolsAdded ?? []) names.add(tool.name);
		declared.push([...names].sort());
		await new Promise<void>((r) => options?.signal?.addEventListener("abort", () => r(), { once: true }));
		return fauxAssistantMessage(fauxText(CLEAN_VERDICT));
	}]);
	childFaux.setResponses([
		() => fauxAssistantMessage(fauxToolCall("review", { level: "blind", object: "a.ts", criterion: "c" }, { id: "r1" }), { stopReason: "toolUse" }),
		() => fauxAssistantMessage(fauxText("waiting")),
	]);
	// The child has codemode active, as RQW-agent gives it when its caller has it.
	const sub = await child(register, { events, fast: () => false, signal: controller.signal, label: "agent#1/review" }, true);
	try {
		const run = sub.prompt("TASK");
		await until(() => declared.length === 1, "the reviewer request");
		assert.deepEqual(declared[0], ["bash", "codemode", "find", "grep", "job", "read"]);
		assert.equal(seen.length, 1);
		assert.equal(seen[0].label, "agent#1/review", "the path label of a child's reviewer");
		assert.equal(seen[0].codemode?.name, "codemode", "the reviewer's own Pi codemode goes to the factory");
		const reviewer = sessions.find((s) => s !== main && s !== sub)!;
		assert.equal(reviewer.getToolDefinition("codemode"), returned[0], "the reviewer runs the returned codemode");
		assert.deepEqual(jobEvents, []);
		controller.abort();
		await until(() => jobEvents.includes("dispose"), "the child's end disposes the reviewer's jobs");
		assert.deepEqual(jobEvents, ["abortAll", "dispose"]);
		await sub.abort();
		await run.catch(() => {});
	} finally {
		sub.dispose();
		await main.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		main.dispose();
	}
});

it("a child's end removes its counts listener from the main bus and ends its source; an already ended child registers none", async () => {
	const { session: main, events } = await mainBus();
	const register = offer(events);
	let live = 0;
	// The main bus as RQW-agent hands it over, counting the listeners the registration keeps on it.
	const counting: EventBus = {
		emit: (channel, data) => events.emit(channel, data),
		on: (channel, handler) => {
			live++;
			const off = events.on(channel, handler);
			let done = false;
			return () => { if (!done) { done = true; live--; off(); } };
		},
	};
	try {
		const ended = new AbortController();
		ended.abort();
		const first = await child(register, { events: counting, fast: () => false, signal: ended.signal });
		assert.equal(live, 0, "an already ended child leaves no listener");
		assert.equal(reviewCounts(events)(), 0);
		first.dispose();
		const lifetime = new AbortController();
		const second = await child(register, { events: counting, fast: () => false, signal: lifetime.signal });
		assert.equal(live, 1, "a live child keeps its one counts listener");
		const sources: unknown[] = [];
		events.emit("rqw:running-counts:request", { version: 1, reply: (source: unknown) => sources.push(source) });
		assert.equal(sources.length, 2, "the main session's source and the child's");
		lifetime.abort();
		assert.equal(live, 0, "the child's end removes its listener");
		const after: unknown[] = [];
		events.emit("rqw:running-counts:request", { version: 1, reply: (source: unknown) => after.push(source) });
		assert.equal(after.length, 1, "only the main session's source is left");
		second.dispose();
	} finally {
		main.dispose();
	}
});
