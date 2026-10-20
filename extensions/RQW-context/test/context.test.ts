// The window cap and the compaction rule inside real Pi sessions, no model. A scripted provider answers with an exact
// `usage`, so the context tokens Pi reads after a response are known; the tests read Pi's own values (session model,
// getContextUsage, compaction events, the requests the provider gets). A local HTTP server stands in for an
// OpenAI-compatible endpoint to show the request body Pi's own provider code builds.
// Both Pi entries run: the library (`dist/index.js`, SDK path) and the bundle the `pi` command runs
// (`dist/bundle/index.js`, extensions get its classes through the loader's virtual modules).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	type AssistantMessage,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	createProvider,
	type Model,
} from "@earendil-works/pi-ai";
import * as library from "@earendil-works/pi-coding-agent";
import type { AgentSession, AgentSessionEvent, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { capModel, contextRule } from "../index.ts";

type Pi = typeof library;
const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
// The package's exports map hides the bundle, so it is imported by file URL next to the library entry.
const bundle: Pi = await import(new URL("./bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const ENTRIES: [string, Pi][] = [
	["library", library],
	["bundle", bundle],
];

const MAX_TOKENS = 128_000;
const MODELS = [
	{ id: "w128k", contextWindow: 128_000 },
	{ id: "w272k", contextWindow: 272_000 },
	{ id: "w500k", contextWindow: 500_000 },
	{ id: "w1m", contextWindow: 1_000_000 },
];

/** One scripted answer: context tokens as `usage.input`, and how the response ended. */
type Reply = number | { input: number; output?: number; stopReason?: "stop" | "length" };

/** A provider whose next chat answer reports exactly the next scripted usage; every request is recorded. */
function scriptedProvider() {
	const state = { next: [] as Reply[], requests: [] as { maxTokens?: number; contextWindow: number; tokens: number }[] };
	const reply = (model: Model<string>, _context: unknown, options?: { maxTokens?: number }): AssistantMessageEventStream => {
		const stream = createAssistantMessageEventStream();
		const entry = state.next.shift() ?? 0;
		const { input, output = 0, stopReason = "stop" } = typeof entry === "number" ? { input: entry } : entry;
		state.requests.push({ maxTokens: options?.maxTokens, contextWindow: model.contextWindow, tokens: input });
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: input === 0 ? "summary" : "ok" }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input,
				output,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: input + output,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason,
			timestamp: Date.now(),
		};
		queueMicrotask(() => {
			stream.push({ type: "start", partial: message });
			stream.push({ type: "done", reason: stopReason, message });
			stream.end(message);
		});
		return stream;
	};
	const provider = createProvider({
		id: "rqw",
		auth: { apiKey: { name: "Test", resolve: async () => ({ auth: {} }) } },
		models: MODELS.map((m) => ({
			id: m.id,
			name: m.id,
			api: "rqw-test",
			provider: "rqw",
			baseUrl: "http://localhost:0",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: m.contextWindow,
			maxTokens: MAX_TOKENS,
		})),
		api: { stream: reply, streamSimple: reply },
	} as Parameters<typeof createProvider>[0]);
	return { provider, state };
}

/** An OpenAI-compatible chat endpoint on 127.0.0.1: records each JSON body, streams "ok" with the next usage. */
function openAiEndpoint() {
	const state = { next: [] as number[], bodies: [] as Record<string, unknown>[], port: 0 };
	const server: Server = createServer((request, response) => {
		let raw = "";
		request.on("data", (chunk) => {
			raw += chunk;
		});
		request.on("end", () => {
			state.bodies.push(JSON.parse(raw));
			const tokens = state.next.shift() ?? 1;
			const base = { id: "c1", object: "chat.completion.chunk", created: 0, model: "big" };
			const send = (data: unknown) => response.write(`data: ${JSON.stringify(data)}\n\n`);
			response.writeHead(200, { "content-type": "text/event-stream" });
			send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }] });
			send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
			send({ ...base, choices: [], usage: { prompt_tokens: tokens, completion_tokens: 0, total_tokens: tokens } });
			response.end("data: [DONE]\n\n");
		});
	});
	return { server, state };
}

let root: string;
let agentDir: string;
let counter = 0;
const scripted = scriptedProvider();
const endpoint = openAiEndpoint();

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-context-"));
	agentDir = join(root, "agent");
	await mkdir(agentDir, { recursive: true });
	const listening = Promise.withResolvers<void>();
	endpoint.server.listen(0, "127.0.0.1", listening.resolve);
	await listening.promise;
	endpoint.state.port = (endpoint.server.address() as AddressInfo).port;
});

after(async () => {
	const closed = Promise.withResolvers<void>();
	endpoint.server.close(() => closed.resolve());
	await closed.promise;
	await rm(root, { recursive: true, force: true });
});

async function freshDir(): Promise<string> {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	return dir;
}

type Open = {
	model?: string;
	provider?: string;
	settings?: Record<string, unknown>;
	withExtension?: boolean;
	factories?: ExtensionFactory[];
	sessionDir?: string;
	resume?: boolean;
	modelsJson?: string;
};

/** A real session of `pi`, with our extension loaded from its file the way Pi loads a package extension. */
async function openSession(pi: Pi, open: Open = {}): Promise<{ session: AgentSession; runtime: library.ModelRuntime }> {
	const dir = open.sessionDir ? dirname(open.sessionDir) : await freshDir();
	const runtime = await pi.ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: open.modelsJson ?? null,
		refreshOnCreate: false,
	});
	runtime.registerNativeProvider(scripted.provider);
	// A resume restores the recorded model only for a provider with configured auth; that check reads this snapshot.
	await runtime.refresh({ allowNetwork: false });
	const resourceLoader = new pi.DefaultResourceLoader({
		cwd: dir,
		agentDir,
		additionalExtensionPaths: open.withExtension === false ? [] : [EXTENSION],
		extensionFactories: open.factories,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	assert.deepEqual(resourceLoader.getExtensions().errors, [], "extension load errors");
	const sessionManager = open.sessionDir
		? open.resume
			? pi.SessionManager.continueRecent(dir, open.sessionDir)
			: pi.SessionManager.create(dir, open.sessionDir)
		: pi.SessionManager.inMemory(dir);
	const { session } = await pi.createAgentSession({
		cwd: dir,
		agentDir,
		model: open.model ? runtime.getModel(open.provider ?? "rqw", open.model) : undefined,
		thinkingLevel: "off",
		modelRuntime: runtime,
		resourceLoader,
		sessionManager,
		// keepRecentTokens 0 lets a two-message session compact; it does not touch the trigger.
		settingsManager: pi.SettingsManager.inMemory({
			retry: { enabled: false },
			...open.settings,
			compaction: { keepRecentTokens: 0, ...(open.settings?.compaction as object) },
		}),
	});
	await session.bindExtensions({});
	return { session, runtime };
}

type CompactionEvents = { starts: string[]; ends: Extract<AgentSessionEvent, { type: "compaction_end" }>[] };

/** One prompt; returns the compactions Pi started and ended during it. */
async function promptOnce(session: AgentSession, text: string): Promise<CompactionEvents> {
	const events: CompactionEvents = { starts: [], ends: [] };
	const unsubscribe = session.subscribe((event) => {
		if (event.type === "compaction_start") events.starts.push(event.reason);
		if (event.type === "compaction_end") events.ends.push(event);
	});
	try {
		await session.prompt(text);
		await session.waitForIdle();
	} finally {
		unsubscribe();
	}
	return events;
}

/** One prompt whose answer reports `reply`; returns the reasons of the compactions Pi started. */
async function answerWith(session: AgentSession, reply: Reply): Promise<string[]> {
	scripted.state.next = [reply];
	return (await promptOnce(session, `go ${JSON.stringify(reply)}`)).starts;
}

/** Pi's window and reserve for the session's current model, as its trigger reads them. */
function piValues(session: AgentSession) {
	const model = session.model!;
	const reserve = session.settingsManager.getCompactionSettings(model).reserveTokens;
	return { contextWindow: model.contextWindow, reserve, threshold: model.contextWindow - reserve };
}

/**
 * Pi compacts above `threshold` and not at it: one fresh session per side of the edge. The second session has an
 * earlier small turn, so the summary has a history part (0.8 x reserve) and a split-turn part (0.5 x reserve); the
 * output limits of both summary requests and the windows the provider saw are returned.
 */
async function assertFlipsAt(pi: Pi, model: string, threshold: number, open: Open = {}) {
	{
		const { session } = await openSession(pi, { ...open, model });
		try {
			assert.equal(piValues(session).threshold, threshold, "Pi's contextWindow - reserveTokens");
			assert.deepEqual(await answerWith(session, threshold), [], `no compaction at ${threshold}`);
		} finally {
			session.dispose();
		}
	}
	const { session } = await openSession(pi, { ...open, model });
	try {
		assert.deepEqual(await answerWith(session, 1_000), []);
		scripted.state.requests = [];
		assert.deepEqual(await answerWith(session, threshold + 1), ["threshold"], `compaction above ${threshold}`);
		const requests = scripted.state.requests;
		const summaryLimits = requests.slice(1).map((r) => r.maxTokens);
		return { summaryLimits, windows: requests.map((r) => r.contextWindow), session: piValues(session) };
	} finally {
		session.dispose();
	}
}

/** models.json with one OpenAI-compatible 1M model served by the local endpoint. */
async function endpointModelsJson(): Promise<string> {
	const file = join(await freshDir(), "models.json");
	const local = {
		baseUrl: `http://127.0.0.1:${endpoint.state.port}/v1`,
		api: "openai-completions",
		apiKey: "x",
		models: [{ id: "big", contextWindow: 1_000_000, maxTokens: MAX_TOKENS }],
	};
	await writeFile(file, JSON.stringify({ providers: { local } }));
	return file;
}

/** Two prompts to the 1M endpoint model: the first answer reports 450 000 context tokens. Returns both bodies. */
async function endpointBodies(pi: Pi, withExtension: boolean) {
	const modelsJson = await endpointModelsJson();
	const { session } = await openSession(pi, { model: "big", provider: "local", modelsJson, withExtension });
	try {
		endpoint.state.bodies = [];
		endpoint.state.next = [450_000, 1];
		assert.deepEqual((await promptOnce(session, "first")).starts, []);
		assert.equal(session.getContextUsage()?.tokens, 450_000);
		assert.deepEqual((await promptOnce(session, "second")).starts, []);
		assert.equal(endpoint.state.bodies.length, 2);
		return endpoint.state.bodies;
	} finally {
		session.dispose();
	}
}

const outputCap = (body: Record<string, unknown>) => body.max_completion_tokens ?? body.max_tokens;

/** Paths in a request body that name a context or window, or carry the number 500000 or 1000000. */
function windowTraces(value: unknown, path = "$"): string[] {
	if (typeof value === "number") return value === 500_000 || value === 1_000_000 ? [path] : [];
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, inner]) => [
		...(/context|window/i.test(key) ? [`${path}.${key}`] : []),
		...windowTraces(inner, `${path}.${key}`),
	]);
}

// Bodies from stock Pi, captured before the extension wraps Pi's classes; compared with the extension's below.
const stockBodies = new Map<string, Record<string, unknown>[]>();

describe("stock Pi without the extension (runs first, before the classes are wrapped)", () => {
	for (const [entry, pi] of ENTRIES) {
		it(`${entry}: reserve 16384, compaction above 272000 - 16384`, async () => {
			const { session } = await openSession(pi, { model: "w272k", withExtension: false });
			try {
				assert.deepEqual(piValues(session), { contextWindow: 272_000, reserve: 16_384, threshold: 255_616 });
				assert.deepEqual(await answerWith(session, 244_801), []);
			} finally {
				session.dispose();
			}
		});

		it(`${entry}: a 1M model keeps its window; 500 001 input tokens is neither overflow nor threshold`, async () => {
			const { session } = await openSession(pi, { model: "w1m", withExtension: false });
			try {
				assert.equal(session.model?.contextWindow, 1_000_000);
				assert.deepEqual(await answerWith(session, 500_001), []);
				assert.equal(session.getContextUsage()?.contextWindow, 1_000_000);
			} finally {
				session.dispose();
			}
		});

		it(`${entry}: the endpoint request of a 1M model at 450 000 context asks for the model's maxTokens`, async () => {
			const bodies = await endpointBodies(pi, false);
			assert.deepEqual(bodies.map(outputCap), [MAX_TOKENS, MAX_TOKENS]);
			stockBodies.set(entry, bodies);
		});
	}
});

for (const [entry, pi] of ENTRIES) {
	describe(`${entry}: the window Pi uses is min(contextWindow, 500 000)`, () => {
		it("1 000 000: the session model, context usage and the provider see 500 000; the registry keeps 1 000 000", async () => {
			const { session, runtime } = await openSession(pi, { model: "w1m" });
			try {
				const declared = runtime.getModel("rqw", "w1m")!;
				assert.equal(declared.contextWindow, 1_000_000);
				assert.deepEqual(session.model, { ...declared, contextWindow: 500_000 });
				scripted.state.requests = [];
				assert.deepEqual(await answerWith(session, 450_000), []);
				assert.equal(scripted.state.requests[0].contextWindow, 500_000);
				// The footer shows percent and window from getContextUsage: 90% of 500k at the threshold.
				assert.deepEqual(session.getContextUsage(), { tokens: 450_000, contextWindow: 500_000, percent: 90 });
			} finally {
				session.dispose();
			}
		});

		it("272 000 and 500 000: the session holds the registry's own model object, unchanged", async () => {
			for (const id of ["w272k", "w500k"]) {
				const { session, runtime } = await openSession(pi, { model: id });
				try {
					assert.equal(session.model, runtime.getModel("rqw", id));
				} finally {
					session.dispose();
				}
			}
			const { session } = await openSession(pi, { model: "w272k" });
			try {
				assert.deepEqual(await answerWith(session, 244_800), []);
				assert.deepEqual(session.getContextUsage(), { tokens: 244_800, contextWindow: 272_000, percent: 90 });
			} finally {
				session.dispose();
			}
		});

		it("every way a model reaches the session: setModel, cycleModel, a direct state assignment", async () => {
			const { session, runtime } = await openSession(pi, { model: "w272k" });
			try {
				await session.setModel(runtime.getModel("rqw", "w1m")!);
				assert.equal(session.model?.contextWindow, 500_000);
				await session.setModel(runtime.getModel("rqw", "w500k")!);
				assert.equal(session.model, runtime.getModel("rqw", "w500k"));
				for (let i = 0; i < MODELS.length && session.model?.id !== "w1m"; i++) await session.cycleModel();
				assert.equal(session.model?.id, "w1m");
				assert.equal(session.model?.contextWindow, 500_000);
				// Pi reassigns agent.state.model from the registry after provider changes (_refreshCurrentModelFromRegistry).
				const cycled = session.model;
				session.agent.state.model = runtime.getModel("rqw", "w1m")!;
				assert.equal(session.model?.contextWindow, 500_000);
				// The same declared model gives the same copy, so the reassignment changes nothing.
				assert.equal(session.model, cycled);
			} finally {
				session.dispose();
			}
		});

		it("the endpoint request: only the output cap changes, to 500 000 - context - 4096; no window in the body", async (t) => {
			const stock = stockBodies.get(entry);
			assert.ok(stock, "stock bodies are captured by the stock describe above");
			const bodies = await endpointBodies(pi, true);
			// Request 1: tiny context, the cap is the model's maxTokens. Request 2: 450 000 context tokens from the
			// last usage plus the new user message, so 500 000 - 450 000 - 4096 = 45 904 minus a few tokens.
			assert.equal(outputCap(bodies[0]), MAX_TOKENS);
			const cap = outputCap(bodies[1]) as number;
			assert.ok(cap >= 45_890 && cap <= 45_903, `output cap ${cap}`);
			t.diagnostic(`output cap at 450 000 context: stock ${outputCap(stock[1])}, extension ${cap}`);
			t.diagnostic(`body fields: ${Object.keys(bodies[1]).join(", ")}`);
			for (const [index, body] of bodies.entries()) {
				assert.deepEqual(windowTraces(body), [], "no window in the request body");
				const { max_completion_tokens: _a, max_tokens: _b, messages: _m, ...rest } = body;
				const { max_completion_tokens: _c, max_tokens: _d, messages: _n, ...stockRest } = stock[index];
				assert.deepEqual(rest, stockRest, "every other field as stock Pi sends it");
			}
		});
	});

	describe(`${entry}: the trigger is exactly W - R`, () => {
		it("272 000: R 27 200, compaction above 244 800", async () => {
			const { summaryLimits, session } = await assertFlipsAt(pi, "w272k", 244_800);
			assert.deepEqual(session, { contextWindow: 272_000, reserve: 27_200, threshold: 244_800 });
			// Summary requests ask for floor(0.8 x 27200) and floor(0.5 x 27200) output tokens.
			assert.deepEqual(summaryLimits, [21_760, 13_600]);
		});

		it("500 000: R 50 000, compaction above 450 000", async () => {
			const { summaryLimits, session } = await assertFlipsAt(pi, "w500k", 450_000);
			assert.deepEqual(session, { contextWindow: 500_000, reserve: 50_000, threshold: 450_000 });
			assert.deepEqual(summaryLimits, [40_000, 25_000]);
		});

		it("1 000 000: W 500 000, R 50 000, compaction above 450 000, summary limits as for 500 000", async () => {
			const { summaryLimits, windows, session } = await assertFlipsAt(pi, "w1m", 450_000);
			assert.deepEqual(session, { contextWindow: 500_000, reserve: 50_000, threshold: 450_000 });
			// The chat request and both summary requests reach the provider with the 500 000 window.
			assert.deepEqual(windows, [500_000, 500_000, 500_000]);
			assert.deepEqual(summaryLimits, [40_000, 25_000]);
		});

		it("128 000: R 12 800, compaction above 115 200 (stock Pi: above 111 616)", async () => {
			const { session } = await assertFlipsAt(pi, "w128k", 115_200);
			assert.deepEqual(session, { contextWindow: 128_000, reserve: 12_800, threshold: 115_200 });
		});

		it("a model switch applies the new model's window and threshold at once", async () => {
			const { session, runtime } = await openSession(pi, { model: "w272k" });
			try {
				assert.equal(piValues(session).threshold, 244_800);
				assert.deepEqual(await answerWith(session, 244_800), []);
				await session.setModel(runtime.getModel("rqw", "w1m")!);
				assert.deepEqual(piValues(session), { contextWindow: 500_000, reserve: 50_000, threshold: 450_000 });
				assert.deepEqual(await answerWith(session, 450_000), []);
				assert.deepEqual(await answerWith(session, 450_001), ["threshold"]);
				await session.setModel(runtime.getModel("rqw", "w500k")!);
				assert.deepEqual(piValues(session), { contextWindow: 500_000, reserve: 50_000, threshold: 450_000 });
				await session.setModel(runtime.getModel("rqw", "w272k")!);
				assert.deepEqual(piValues(session), { contextWindow: 272_000, reserve: 27_200, threshold: 244_800 });
			} finally {
				session.dispose();
			}
		});

		it("a resumed session gets the window and the rule for the model it restores", async () => {
			const sessionDir = join(await freshDir(), "sessions");
			const first = await openSession(pi, { model: "w1m", sessionDir });
			try {
				assert.deepEqual(await answerWith(first.session, 1_000), []);
			} finally {
				first.session.dispose();
			}
			const { session } = await openSession(pi, { sessionDir, resume: true });
			try {
				assert.equal(session.model?.id, "w1m");
				assert.deepEqual(piValues(session), { contextWindow: 500_000, reserve: 50_000, threshold: 450_000 });
				assert.equal(session.getContextUsage()?.contextWindow, 500_000);
				assert.deepEqual(await answerWith(session, 450_000), []);
				assert.deepEqual(await answerWith(session, 450_001), ["threshold"]);
			} finally {
				session.dispose();
			}
		});
	});

	describe(`${entry}: input above 500 000 on a 1M model is overflow, and Pi recovers`, () => {
		it("a completed answer reporting 500 001 input tokens: overflow compaction, the answer stays, no retry, no error", async () => {
			const { session } = await openSession(pi, { model: "w1m" });
			try {
				assert.deepEqual(await answerWith(session, 1_000), []);
				scripted.state.next = [500_001];
				scripted.state.requests = [];
				const { starts, ends } = await promptOnce(session, "big turn");
				assert.deepEqual(starts, ["overflow"]);
				assert.equal(ends.length, 1);
				assert.equal(ends[0].reason, "overflow");
				assert.equal(ends[0].willRetry, false);
				assert.equal(ends[0].errorMessage, undefined);
				assert.ok(ends[0].result, "compaction produced a summary");
				// One chat request and the summary requests; no repeated chat request.
				assert.deepEqual(scripted.state.requests.map((r) => r.tokens), [500_001, 0, 0]);
				const last = session.messages.at(-1) as AssistantMessage;
				assert.equal(last.role, "assistant");
				assert.equal(last.stopReason, "stop");
				assert.equal(last.usage.input, 500_001);
				// The session goes on.
				assert.deepEqual(await answerWith(session, 2_000), []);
			} finally {
				session.dispose();
			}
		});

		it("a length stop with no output at 495 000 input tokens (99% of 500 000): overflow compaction, then one retry", async () => {
			const { session } = await openSession(pi, { model: "w1m" });
			try {
				assert.deepEqual(await answerWith(session, 1_000), []);
				// The overflowing answer; the summary requests take the next two entries, the retry the last.
				scripted.state.next = [{ input: 495_000, output: 0, stopReason: "length" }, 0, 0, 3_000];
				scripted.state.requests = [];
				const { starts, ends } = await promptOnce(session, "big turn");
				assert.deepEqual(starts, ["overflow"]);
				assert.equal(ends[0].willRetry, true);
				assert.equal(ends[0].errorMessage, undefined);
				assert.deepEqual(scripted.state.requests.map((r) => r.tokens), [495_000, 0, 0, 3_000]);
				const last = session.messages.at(-1) as AssistantMessage;
				assert.equal(last.stopReason, "stop");
				assert.equal(last.usage.input, 3_000);
			} finally {
				session.dispose();
			}
		});
	});

	describe(`${entry}: the user's settings`, () => {
		it("compaction.enabled false: no compaction above W - R, nor on overflow", async () => {
			const { session } = await openSession(pi, { model: "w272k", settings: { compaction: { enabled: false } } });
			try {
				assert.deepEqual(await answerWith(session, 244_801), []);
				assert.deepEqual(await answerWith(session, 271_000), []);
			} finally {
				session.dispose();
			}
			const big = await openSession(pi, { model: "w1m", settings: { compaction: { enabled: false } } });
			try {
				assert.deepEqual(await answerWith(big.session, 500_001), []);
			} finally {
				big.session.dispose();
			}
		});

		it("compaction.reserveTokens set by the user wins for every model; the window is still capped", async () => {
			const settings = { compaction: { reserveTokens: 30_000 } };
			const { session } = await assertFlipsAt(pi, "w272k", 242_000, { settings });
			assert.equal(session.reserve, 30_000);
			assert.deepEqual((await assertFlipsAt(pi, "w1m", 470_000, { settings })).session, {
				contextWindow: 500_000,
				reserve: 30_000,
				threshold: 470_000,
			});
		});

		it("a per-model compaction.modelOverrides reserveTokens wins for that model only", async () => {
			const settings = {
				compaction: { modelOverrides: { "rqw/w272k": { reserveTokens: 20_000 }, "rqw/w1m": { reserveTokens: 10_000 } } },
			};
			assert.equal((await assertFlipsAt(pi, "w272k", 252_000, { settings })).session.reserve, 20_000);
			assert.equal((await assertFlipsAt(pi, "w1m", 490_000, { settings })).session.reserve, 10_000);
			assert.equal((await assertFlipsAt(pi, "w500k", 450_000, { settings })).session.reserve, 50_000);
		});

		it("a per-model keepRecentTokens override keeps the rule's reserve", async () => {
			const settings = { compaction: { modelOverrides: { "rqw/w500k": { keepRecentTokens: 0 } } } };
			assert.equal((await assertFlipsAt(pi, "w500k", 450_000, { settings })).session.reserve, 50_000);
		});
	});

	describe(`${entry}: models from every source`, () => {
		it("models.json: its window is the declared one; up to 500 000 it stays, above it is capped", async () => {
			const dir = await freshDir();
			const modelsJson = join(dir, "models.json");
			await writeFile(
				modelsJson,
				JSON.stringify({
					providers: {
						local: {
							baseUrl: "http://localhost:1/v1",
							api: "openai-completions",
							apiKey: "x",
							models: [{ id: "plain" }, { id: "big", contextWindow: 2_000_000 }],
						},
						rqw: { modelOverrides: { w272k: { contextWindow: 1_000_000 }, w1m: { contextWindow: 400_000 } } },
					},
				}),
			);
			const { session, runtime } = await openSession(pi, { model: "w500k", modelsJson });
			try {
				const cases: [string, string, { contextWindow: number; reserve: number; threshold: number }][] = [
					["local", "plain", { contextWindow: 128_000, reserve: 12_800, threshold: 115_200 }],
					["local", "big", { contextWindow: 500_000, reserve: 50_000, threshold: 450_000 }],
					["rqw", "w272k", { contextWindow: 500_000, reserve: 50_000, threshold: 450_000 }],
					// A models.json window below 500 000 on a 1M model is what Pi uses.
					["rqw", "w1m", { contextWindow: 400_000, reserve: 40_000, threshold: 360_000 }],
				];
				for (const [provider, id, values] of cases) {
					await session.setModel(runtime.getModel(provider, id)!);
					assert.deepEqual(piValues(session), values, `${provider}/${id}`);
				}
			} finally {
				session.dispose();
			}
		});

		it("a model an extension registers with pi.registerProvider", async () => {
			const factory: ExtensionFactory = (api) => {
				api.registerProvider("ext", {
					baseUrl: "http://localhost:1/v1",
					api: "openai-completions",
					apiKey: "x",
					models: [
						{
							id: "huge",
							name: "huge",
							reasoning: false,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 1_048_576,
							maxTokens: 65_536,
						},
					],
				});
			};
			const { session, runtime } = await openSession(pi, { model: "w272k", factories: [factory] });
			try {
				await session.setModel(runtime.getModel("ext", "huge")!);
				assert.deepEqual(piValues(session), { contextWindow: 500_000, reserve: 50_000, threshold: 450_000 });
				assert.equal(session.model?.maxTokens, 65_536);
			} finally {
				session.dispose();
			}
		});

		it("a model without a known window keeps Pi's values", async () => {
			const { session } = await openSession(pi, { model: "w272k" });
			try {
				const manager = session.settingsManager;
				const unknown = { provider: "x", id: "y", contextWindow: 0 } as Model<string>;
				assert.equal(manager.getCompactionSettings(unknown).reserveTokens, 16_384);
				assert.equal(manager.getCompactionSettings({ provider: "x", id: "y" }).reserveTokens, 16_384);
				assert.equal(manager.getCompactionSettings().reserveTokens, 16_384);
			} finally {
				session.dispose();
			}
		});
	});
}

describe("the rule and the cap as functions", () => {
	it("R = Math.round(W / 10): a .5 rounds up", () => {
		assert.deepEqual(contextRule(272_005), { window: 272_005, reserve: 27_201, threshold: 244_804 });
		assert.deepEqual(contextRule(272_004), { window: 272_004, reserve: 27_200, threshold: 244_804 });
		assert.deepEqual(contextRule(500_001), { window: 500_000, reserve: 50_000, threshold: 450_000 });
	});

	it("capModel: the same object up to 500 000 and for virtual models, one stable copy above", () => {
		const small = { id: "a", contextWindow: 500_000 };
		const virtual = { id: "v", api: "pi-virtual", contextWindow: 1_000_000 };
		const large = { id: "b", contextWindow: 500_001, maxTokens: 1 };
		assert.equal(capModel(small), small);
		assert.equal(capModel(virtual), virtual);
		assert.deepEqual(capModel(large), { id: "b", contextWindow: 500_000, maxTokens: 1 });
		assert.equal(capModel(large), capModel(large));
		assert.equal(capModel(capModel(large)), capModel(large));
		assert.equal(large.contextWindow, 500_001);
	});
});
