// Session controller tests. Real Pi 1.4.0 AgentSession (temporary dir, no extensions) plus an INJECTED fake transport
// (transportFactory) for the lifecycle tests. The "real facade" tests use the real CodexThreadTransport with a fake SSE
// connector and a fake OAuth login seeded into an in-memory store (test-only; production auth is not bypassed). No network.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import * as zlib from "node:zlib";
import * as pi from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Context, type Model } from "@earendil-works/pi-ai";

import { createSessionController, STARTUP_PROJECTION_CHANNEL, type SessionController, type SessionTransport } from "../session.ts";
import { SocketError } from "../websocket.ts";

const MODEL = {
	id: "gpt-6-luna",
	name: "GPT-6-Luna",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 500000,
	maxTokens: 100000,
	thinkingLevelMap: {},
} as unknown as Model<Api>;

const OTHER = { ...MODEL, id: "other", provider: "other-provider", api: "openai-responses" } as unknown as Model<Api>;

type Call = { op: string; args?: unknown[] };

/** Injected fake transport: records every call; stream returns an empty, already-ended stream. */
function fakeTransport(log: Call[]): SessionTransport {
	return {
		stream(model, context, options) {
			log.push({ op: "stream", args: [model.id, context, options] });
			return { [Symbol.asyncIterator]: async function* () {}, push() {}, end() {}, result: async () => undefined } as never;
		},
		prewarm(model, context, options) {
			log.push({ op: "prewarm", args: [model.id, context, options] });
			return Promise.resolve();
		},
		beginTurn(info) {
			log.push({ op: "beginTurn", args: [info] });
		},
		endTurn() {
			log.push({ op: "endTurn" });
		},
		dispose() {
			log.push({ op: "dispose" });
		},
	};
}

async function withSession(run: (create: (options?: Partial<pi.CreateAgentSessionOptions>) => Promise<pi.AgentSession>) => Promise<void>) {
	const dir = mkdtempSync(join(tmpdir(), "rqw-codex-session-"));
	const sessions: pi.AgentSession[] = [];
	const create = async (options: Partial<pi.CreateAgentSessionOptions> = {}) => {
		const resourceLoader = new pi.DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true,
			noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await resourceLoader.reload();
		const { session } = await pi.createAgentSession({ cwd: dir, agentDir: dir, resourceLoader,
			sessionManager: pi.SessionManager.inMemory(dir), settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false } }),
			...options });
		sessions.push(session);
		return session;
	};
	try { await run(create); }
	finally {
		for (const session of sessions) session.dispose();
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Local stand-in for pi.events: records emits, and answers the startup projection like RQW-prompt would. */
function fakeBus(mode: "prefix" | "error" | "none" = "prefix") {
	const emitted: { channel: string; request: { options: { customPrompt?: string }; error?: string } }[] = [];
	const events = {
		emit(channel: string, data: unknown) {
			const request = data as { options: { customPrompt?: string }; error?: string };
			emitted.push({ channel, request });
			if (channel !== STARTUP_PROJECTION_CHANNEL || mode === "none") return;
			if (mode === "error") request.error = "projection refused";
			else request.options.customPrompt = "PROJECTED-RQW-PREFIX";
		},
		on() { return () => {}; },
	};
	return { emitted, pi: { events } as unknown as pi.ExtensionAPI };
}

/** Fake saved login for the test store: a JWT carrying the account id. Test-only; production auth is not bypassed. */
const ACCOUNT = "acct-codex-1";
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function writeLogin(store: InMemoryCredentialStore, account = ACCOUNT, tag = "a"): Promise<void> {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	const access = `${b64url({ alg: "none" })}.${b64url({ exp, tag, "https://api.openai.com/auth": { chatgpt_account_id: account } })}.sig`;
	await store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: `refresh-${tag}`, expires: exp * 1000, accountId: account }) as never);
}

async function seededStore(account = ACCOUNT): Promise<InMemoryCredentialStore> {
	const store = new InMemoryCredentialStore();
	await writeLogin(store, account);
	return store;
}

/** Store that fails every access: proves a non-Codex session never reads a credential. */
function forbiddenStore(reads: { count: number }) {
	const refuse = async () => {
		reads.count++;
		throw new Error("credential store must not be read");
	};
	return { read: refuse, list: refuse, delete: refuse, modify: refuse } as unknown as InMemoryCredentialStore;
}

async function drain(stream: AsyncIterable<unknown>): Promise<unknown[]> {
	const out: unknown[] = [];
	for await (const event of stream) out.push(event);
	return out;
}

const userMsg = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1_700_000_000_000 });

const completedEvent = (id: string) => ({
	type: "response.completed",
	response: { id, status: "completed", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } },
});

/** One encrypted reasoning item and one function call: the raw items the durable wire must replay exactly. */
const toolEvents = (id: string, callId: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.done", output_index: 0, item: { type: "reasoning", id: `rs_${id}`, encrypted_content: `ENC-${id}`, summary: [] } },
	{ type: "response.output_item.done", output_index: 1, item: { type: "function_call", id: `fc_${callId}`, call_id: callId, name: "bash", arguments: "{\"cmd\":\"ls\"}", status: "completed" } },
	completedEvent(id),
];

const textEvents = (id: string, text: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
	completedEvent(id),
];

/** Fake SSE POST: one script per request, in order; records the bodies. */
function sseScript(steps: unknown[][]) {
	const calls: { body: Uint8Array }[] = [];
	const fn = (options: any) => {
		calls.push({ body: options.body });
		const events = steps.shift();
		if (!events) throw new Error("unexpected SSE request");
		return (async function* () {
			options.onResponse({ status: 200, headers: {} });
			for (const value of events) yield { text: JSON.stringify(value), value };
		})();
	};
	return { fn: fn as any, calls };
}

/** Every WebSocket attempt is refused with 426: the native sticky SSE fallback. */
const upgradeRequired = async (): Promise<never> => {
	throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
};

const timing = { clock: { now: () => 1_000_000 }, random: () => 0.5, sleep: async () => {} };

/** Real session on a file-backed SessionManager (the file exists after the first user message). */
async function withFileSession(run: (dir: string, create: (manager: pi.SessionManager) => Promise<pi.AgentSession>) => Promise<void>) {
	const dir = mkdtempSync(join(tmpdir(), "rqw-codex-wire-"));
	const sessions: pi.AgentSession[] = [];
	const create = async (manager: pi.SessionManager) => {
		const resourceLoader = new pi.DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true,
			noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await resourceLoader.reload();
		const { session } = await pi.createAgentSession({ cwd: dir, agentDir: dir, resourceLoader, model: MODEL,
			sessionManager: manager, settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false } }) });
		sessions.push(session);
		return session;
	};
	try { await run(dir, create); }
	finally {
		for (const session of sessions) session.dispose();
		rmSync(dir, { recursive: true, force: true });
	}
}

/** One logical turn through the controller: run boundaries, then the stream drained. onPayload stands in for Pi's agent hook. */
async function turn(controller: SessionController, context: Context, onPayload?: (payload: unknown) => Promise<unknown>): Promise<void> {
	controller.policy.beginRun({ kind: "run" });
	await drain(controller.stream(MODEL, context, { onPayload } as never));
	controller.policy.endRun({ aborted: false });
}

/** Text of the request input that the real transport sent (zstd body). */
function bodyInput(bytes: Uint8Array): string {
	return JSON.stringify((JSON.parse(zlib.zstdDecompressSync(Buffer.from(bytes)).toString("utf8")) as { input: unknown }).input);
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

it("[injected transport] a session without an openai-codex model: start() builds no transport and sends no prewarm", async () => {
	await withSession(async (create) => {
		const session = await create();
		const log: Call[] = [];
		const factoryCalls: unknown[] = [];
		const controller = createSessionController({ session, installationId: "inst-1", dependencies: { transportFactory: (identity) => { factoryCalls.push(identity); return fakeTransport(log); } } });
		await controller.start();
		assert.equal(factoryCalls.length, 0);
		assert.deepEqual(log, []);
		controller.release();
	});
});

it("[injected transport] another provider's model is refused by stream() and never reaches the transport", async () => {
	await withSession(async (create) => {
		const session = await create();
		const log: Call[] = [];
		const controller = createSessionController({ session, installationId: "inst-1", dependencies: { transportFactory: () => fakeTransport(log) } });
		assert.throws(() => controller.stream(OTHER, { messages: [] } as Context), /is not openai-codex/);
		assert.deepEqual(log, []);
		controller.release();
	});
});

it("[injected transport] same provider with a non-Codex api is refused by stream() and not started", async () => {
	await withSession(async (create) => {
		const session = await create();
		const log: Call[] = [];
		const controller = createSessionController({ session, installationId: "inst-1", dependencies: { transportFactory: () => fakeTransport(log) } });
		const sameProviderOtherApi = { ...MODEL, api: "openai-responses" } as unknown as Model<Api>;
		assert.throws(() => controller.stream(sameProviderOtherApi, { messages: [] } as Context), /is not openai-codex-responses/);
		assert.deepEqual(log, []);
		controller.release();
	});
});

it("[injected transport] start() on a foreign model is not latched: a later Codex model starts once", async () => {
	await withSession(async (create) => {
		const session = await create({ model: OTHER });
		const bus = fakeBus("prefix");
		const log: Call[] = [];
		const controller = createSessionController({ session, pi: bus.pi, installationId: "inst-1", store: await seededStore(), dependencies: { transportFactory: () => fakeTransport(log) } });
		await controller.start();
		assert.deepEqual(log, []);
		assert.equal(bus.emitted.length, 0);
		(session.agent.state as { model: Model<Api> }).model = MODEL;
		await controller.start();
		await controller.start();
		assert.equal(log.filter((c) => c.op === "prewarm").length, 1);
		controller.release();
	});
});

it("[injected transport] threadId is the actual session id; rootSessionId defaults to it; lineage given before start reaches the identity", async () => {
	await withSession(async (create) => {
		const session = await create({ model: MODEL });
		const seen: { threadId: string; rootSessionId: string; parentThreadId?: string; subagentKind?: string }[] = [];
		const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { transportFactory: (identity) => { seen.push(identity as never); return fakeTransport([]); } } });
		assert.equal(controller.threadId, session.sessionId);
		assert.equal(controller.rootSessionId, session.sessionId);
		controller.updateLineage({ rootSessionId: "root-A", parentThreadId: "parent-B", subagentKind: "review" });
		assert.equal(controller.rootSessionId, "root-A");
		await controller.start();
		assert.equal(seen.length, 1);
		assert.equal(seen[0].threadId, session.sessionId);
		assert.equal(seen[0].rootSessionId, "root-A");
		assert.equal(seen[0].parentThreadId, "parent-B");
		assert.equal(seen[0].subagentKind, "review");
		controller.release();
	});
});

it("[injected transport] lineage cannot change after start()", async () => {
	await withSession(async (create) => {
		const session = await create();
		const controller = createSessionController({ session, installationId: "inst-1", dependencies: { transportFactory: () => fakeTransport([]) } });
		await controller.start();
		assert.throws(() => controller.updateLineage({ rootSessionId: "late" }), /before start/);
		controller.release();
	});
});

it("[injected transport] codex start: one prewarm with the projected prompt, the session prompt is restored, runner hook is attached", async () => {
	await withSession(async (create) => {
		const session = await create({ model: MODEL });
		const before = session.systemPrompt;
		const bus = fakeBus("prefix");
		const log: Call[] = [];
		const controller = createSessionController({ session, pi: bus.pi, installationId: "inst-1", store: await seededStore(), dependencies: { transportFactory: () => fakeTransport(log) } });
		const runner = session.extensionRunner as unknown as { emitBeforeProviderRequest: (p: unknown) => Promise<unknown>; hasHandlers?: (n: string) => boolean };
		const original = runner.emitBeforeProviderRequest;
		runner.emitBeforeProviderRequest = async (payload) => ({ ...(payload as object), service_tier: "priority" });
		runner.hasHandlers = () => true;
		try {
			await controller.start();
			assert.equal(bus.emitted.length, 1);
			assert.equal(bus.emitted[0].channel, STARTUP_PROJECTION_CHANNEL);
			assert.equal(session.systemPrompt, before, "session prompt restored after projection");
			const prewarm = log.find((c) => c.op === "prewarm");
			assert.ok(prewarm, "prewarm was requested");
			const [modelId, context, options] = prewarm.args as [string, Context, { onPayload: (p: unknown, m: unknown) => Promise<unknown> }];
			assert.equal(modelId, MODEL.id);
			assert.match(context.systemPrompt, /PROJECTED-RQW-PREFIX/);
			assert.deepEqual(await options.onPayload({ model: MODEL.id }, MODEL), { model: MODEL.id, service_tier: "priority" });
			await controller.start();
			assert.equal(log.filter((c) => c.op === "prewarm").length, 1, "start is once");
		} finally {
			runner.emitBeforeProviderRequest = original;
			controller.release();
		}
	});
});

it("[injected transport] projection error: no prewarm, start() still resolves, prompt untouched", async () => {
	await withSession(async (create) => {
		const session = await create({ model: MODEL });
		const before = session.systemPrompt;
		const bus = fakeBus("error");
		const log: Call[] = [];
		const controller = createSessionController({ session, pi: bus.pi, installationId: "inst-1", store: await seededStore(), dependencies: { transportFactory: () => fakeTransport(log) } });
		await controller.start();
		assert.deepEqual(log.filter((c) => c.op === "prewarm"), []);
		assert.equal(session.systemPrompt, before);
		controller.release();
	});
});

it("[injected transport] without pi the stock session prompt is used for the prewarm context", async () => {
	await withSession(async (create) => {
		const session = await create({ model: MODEL });
		const log: Call[] = [];
		const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { transportFactory: () => fakeTransport(log) } });
		await controller.start();
		const prewarm = log.find((c) => c.op === "prewarm");
		assert.equal((prewarm?.args?.[1] as Context).systemPrompt, session.systemPrompt);
		controller.release();
	});
});

it("[injected transport] run boundaries: repeated begin while active and end while inactive are no-ops; steering is not a new turn", async () => {
	await withSession(async (create) => {
		const session = await create({ model: MODEL });
		const log: Call[] = [];
		const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { transportFactory: () => fakeTransport(log) } });
		await controller.start();
		log.length = 0;
		controller.policy.endRun({ aborted: false });
		assert.deepEqual(log.map((c) => c.op), []);
		controller.policy.beginRun({ kind: "run" });
		controller.policy.beginRun({ kind: "steer" });
		controller.policy.beginRun({ kind: "run" });
		assert.deepEqual(log.map((c) => c.op), ["beginTurn"]);
		controller.policy.endRun({ aborted: false });
		controller.policy.endRun({ aborted: false });
		assert.deepEqual(log.map((c) => c.op), ["beginTurn", "endTurn"]);
		controller.policy.beginRun({ kind: "run" });
		const begins = log.filter((c) => c.op === "beginTurn");
		assert.equal(begins.length, 2);
		assert.match((begins[1].args?.[0] as { turnId: string }).turnId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
		assert.notEqual((begins[0].args?.[0] as { turnId: string }).turnId, (begins[1].args?.[0] as { turnId: string }).turnId);
		controller.release();
	});
});

it("[injected transport] stream() preserves the caller's hooks and option values and adds only the owner binding; no runner hook is added (Pi's onPayload already chains it)", async () => {
	await withSession(async (create) => {
		const session = await create({ model: MODEL });
		const log: Call[] = [];
		const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { transportFactory: () => fakeTransport(log) } });
		const runner = session.extensionRunner as unknown as { emitBeforeProviderRequest: (p: unknown) => Promise<unknown>; hasHandlers?: (n: string) => boolean };
		const original = runner.emitBeforeProviderRequest;
		let runnerCalls = 0;
		runner.emitBeforeProviderRequest = async (payload) => { runnerCalls++; return payload; };
		runner.hasHandlers = () => true;
		const carrierSymbol = Symbol("carrier");
		const onPayload = async (p: unknown) => p;
		const onResponse = () => undefined;
		const onProviderStreamEvent = () => undefined;
		const fetchHook = async () => new Response("");
		const headers = { "x-caller": "1" };
		const env = { CALLER_ENV: "1" };
		const signal = new AbortController().signal;
		const unknownObject = { futureHook: { nested: true } };
		const symbolCarrier = { carried: true };
		const callerOptions: Record<PropertyKey, unknown> = { onPayload, onResponse, onProviderStreamEvent, fetch: fetchHook, headers, env, signal, unknownObject, [carrierSymbol]: symbolCarrier };
		const callerKeys = Reflect.ownKeys(callerOptions);
		const callerValues = callerKeys.map((key) => Reflect.get(callerOptions, key));
		try {
			await drain(controller.stream(MODEL, { messages: [] } as Context, callerOptions as never));
			const stream = log.find((c) => c.op === "stream");
			const received = stream?.args?.[2] as Record<PropertyKey, unknown>;
			assert.notEqual(received, callerOptions);
			assert.deepStrictEqual(received, { ...callerOptions, preparedOwner: ACCOUNT });
			assert.equal(received.preparedOwner, ACCOUNT);
			assert.equal(Object.hasOwn(received, "nativeInput"), false);
			assert.strictEqual(received.onPayload, onPayload);
			assert.strictEqual(received.onResponse, onResponse);
			assert.strictEqual(received.onProviderStreamEvent, onProviderStreamEvent);
			assert.strictEqual(received.fetch, fetchHook);
			assert.strictEqual(received.headers, headers);
			assert.strictEqual(received.env, env);
			assert.strictEqual(received.signal, signal);
			assert.strictEqual(received.unknownObject, unknownObject);
			assert.strictEqual(received[carrierSymbol], symbolCarrier);
			// The caller object is unchanged: same keys, same values, and no owner binding added to it.
			assert.deepStrictEqual(Reflect.ownKeys(callerOptions), callerKeys);
			assert.deepStrictEqual(callerKeys.map((key) => Reflect.get(callerOptions, key)), callerValues);
			assert.equal(Object.hasOwn(callerOptions, "preparedOwner"), false);
			// The received onPayload is the caller's exact original function; calling it runs no extra Pi runner chain.
			assert.deepStrictEqual(await (received.onPayload as (p: unknown, m: unknown) => Promise<unknown>)({ base: 1 }, MODEL), { base: 1 });
			assert.equal(runnerCalls, 0);
		} finally {
			runner.emitBeforeProviderRequest = original;
			controller.release();
		}
	});
});

it("[injected transport] stream() overrides a caller-supplied preparedOwner with the owned account and never mutates the caller", async () => {
	await withSession(async (create) => {
		const session = await create({ model: MODEL });
		const log: Call[] = [];
		const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { transportFactory: () => fakeTransport(log) } });
		const onPayload = async (p: unknown) => p;
		const callerOptions = { onPayload, preparedOwner: "foreign-spoofed-owner" };
		const callerKeys = Reflect.ownKeys(callerOptions);
		const callerValues = callerKeys.map((key) => Reflect.get(callerOptions, key));
		try {
			await drain(controller.stream(MODEL, { messages: [] } as Context, callerOptions as never));
			const received = log.find((c) => c.op === "stream")?.args?.[2] as Record<PropertyKey, unknown>;
			assert.notEqual(received, callerOptions);
			assert.equal(received.preparedOwner, ACCOUNT);
			assert.strictEqual(received.onPayload, onPayload);
			assert.deepStrictEqual(Reflect.ownKeys(callerOptions), callerKeys);
			assert.deepStrictEqual(callerKeys.map((key) => Reflect.get(callerOptions, key)), callerValues);
			assert.equal(callerOptions.preparedOwner, "foreign-spoofed-owner");
		} finally {
			controller.release();
		}
	});
});

it("[injected transport] one before_provider_request chain per logical inference and one per prewarm; caller replacement retained", async () => {
	await withSession(async (create) => {
		const session = await create({ model: MODEL });
		const captured: { op: string; onPayload?: (p: unknown, m: unknown) => Promise<unknown> }[] = [];
		const transport: SessionTransport = {
			...fakeTransport([]),
			stream(_model, _context, options) {
				captured.push({ op: "stream", onPayload: options?.onPayload as never });
				return { [Symbol.asyncIterator]: async function* () {}, push() {}, end() {}, result: async () => undefined } as never;
			},
			prewarm(_model, _context, options) {
				captured.push({ op: "prewarm", onPayload: options?.onPayload as never });
				return Promise.resolve();
			},
		};
		const controller = createSessionController({ session, pi: fakeBus("none").pi, installationId: "inst-1", store: await seededStore(), dependencies: { transportFactory: () => transport } });
		const runner = session.extensionRunner as unknown as { emitBeforeProviderRequest: (p: unknown) => Promise<unknown>; hasHandlers?: (n: string) => boolean };
		const original = runner.emitBeforeProviderRequest;
		let hookCount = 0;
		// Stands in for Pi's sdk transform: one chain run per payload.
		runner.emitBeforeProviderRequest = async (payload) => { hookCount++; return { ...(payload as object), chained: hookCount }; };
		runner.hasHandlers = () => true;
		try {
			// A real agent inference: its onPayload is Pi's chain, which replaces the payload once. The fake transport invokes it once.
			const agentOnPayload = async (p: unknown) => ({ ...(await runner.emitBeforeProviderRequest(p) as object), agent: true });
			await drain(controller.stream(MODEL, { messages: [] } as Context, { onPayload: agentOnPayload } as never));
			await captured[0].onPayload?.({ base: 1 }, MODEL);
			assert.equal(hookCount, 1, "one hook per logical inference");
			await controller.start();
			await captured[1].onPayload?.({ base: 2 }, MODEL);
			assert.equal(hookCount, 2, "prewarm runs the chain once");
			// The caller's replacement (agent: true) is retained at the end of the chain.
			assert.deepEqual(await captured[0].onPayload?.({ base: 3 }, MODEL), { base: 3, chained: 3, agent: true });
		} finally {
			runner.emitBeforeProviderRequest = original;
			controller.release();
		}
	});
});

it("[injected transport] release is idempotent: transport disposed once, later calls refused, run boundaries ignored", async () => {
	await withSession(async (create) => {
		const session = await create({ model: MODEL });
		const log: Call[] = [];
		const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { transportFactory: () => fakeTransport(log) } });
		await controller.start();
		controller.policy.beginRun({ kind: "run" });
		controller.release();
		controller.release();
		controller.policy.release();
		assert.equal(log.filter((c) => c.op === "dispose").length, 1);
		assert.throws(() => controller.stream(MODEL, { messages: [] } as Context), /released/);
		await controller.start();
		assert.equal(log.filter((c) => c.op === "prewarm").length, 1, "only the prewarm before release");
	});
});

it("[real facade] default factory builds the real CodexThreadTransport and release disposes it without network", async () => {
	await withSession(async (create) => {
		const session = await create();
		const controller = createSessionController({ session, installationId: "inst-1", store: new InMemoryCredentialStore() });
		controller.policy.beginRun({ kind: "run" });
		controller.policy.endRun({ aborted: false });
		controller.release();
		assert.equal(controller.threadId, session.sessionId);
	});
});

it("[injected transport] startup override: the prewarm sends the forced prompt exactly, no projection, selected low effort and one runner hook", async () => {
	await withSession(async (create) => {
		const session = await create({ model: MODEL, thinkingLevel: "low" });
		const bus = fakeBus("prefix");
		const log: Call[] = [];
		const FORCED = "FORCED-CHILD-PROMPT";
		const controller = createSessionController({ session, pi: bus.pi, installationId: "inst-1", startupSystemPrompt: FORCED, store: await seededStore(), dependencies: { transportFactory: () => fakeTransport(log) } });
		const runner = session.extensionRunner as unknown as { emitBeforeProviderRequest: (p: unknown) => Promise<unknown>; hasHandlers?: (n: string) => boolean };
		const original = runner.emitBeforeProviderRequest;
		let hookCount = 0;
		runner.emitBeforeProviderRequest = async (payload) => { hookCount++; return { ...(payload as object), service_tier: "priority" }; };
		runner.hasHandlers = () => true;
		try {
			await controller.start();
			assert.equal(bus.emitted.length, 0, "the forced prompt replaces the projection request");
			const prewarm = log.find((c) => c.op === "prewarm");
			assert.ok(prewarm, "prewarm was requested");
			const [, context, options] = prewarm.args as [string, Context, { reasoning?: string; onPayload: (p: unknown, m: unknown) => Promise<unknown> }];
			assert.equal(context.systemPrompt, FORCED, "the exact forced text, no <cwd> or other sections");
			assert.equal(options.reasoning, "low", "the session's actual thinking level");
			assert.deepEqual(await options.onPayload({ model: MODEL.id }, MODEL), { model: MODEL.id, service_tier: "priority" });
			assert.equal(hookCount, 1, "the runner hook runs once for the prewarm");
		} finally {
			runner.emitBeforeProviderRequest = original;
			controller.release();
		}
	});
});

it("[injected transport] updateLineage before start sets the startup override; a later update is refused", async () => {
	await withSession(async (create) => {
		const session = await create({ model: MODEL });
		const bus = fakeBus("prefix");
		const log: Call[] = [];
		const controller = createSessionController({ session, pi: bus.pi, installationId: "inst-1", store: await seededStore(), dependencies: { transportFactory: () => fakeTransport(log) } });
		controller.updateLineage({ startupSystemPrompt: "LATE-FORCED" });
		await controller.start();
		const prewarm = log.find((c) => c.op === "prewarm");
		assert.equal((prewarm?.args?.[1] as Context).systemPrompt, "LATE-FORCED");
		assert.equal(bus.emitted.length, 0);
		assert.throws(() => controller.updateLineage({ startupSystemPrompt: "again" }), /before start/);
		controller.release();
	});
});

it("[injected transport] thinking off sends no explicit reasoning level to the prewarm", async () => {
	await withSession(async (create) => {
		const session = await create({ model: MODEL, thinkingLevel: "off" });
		const log: Call[] = [];
		const controller = createSessionController({ session, pi: fakeBus("none").pi, installationId: "inst-1", store: await seededStore(), dependencies: { transportFactory: () => fakeTransport(log) } });
		await controller.start();
		const prewarm = log.find((c) => c.op === "prewarm");
		assert.equal((prewarm?.args?.[2] as { reasoning?: string }).reasoning, undefined);
		controller.release();
	});
});

it("[real facade] a non-Codex session never reads a credential: start, runs and stream refusals stay credential-free", async () => {
	await withSession(async (create) => {
		const session = await create();
		const reads = { count: 0 };
		const controller = createSessionController({ session, installationId: "inst-1", store: forbiddenStore(reads) });
		await controller.start();
		controller.policy.beginRun({ kind: "run" });
		controller.policy.endRun({ aborted: false });
		assert.throws(() => controller.stream(OTHER, { messages: [] } as Context), /is not openai-codex/);
		assert.equal(reads.count, 0);
		assert.equal(controller.wireState, undefined);
		controller.release();
	});
});

/** Pi's effective projection of the session, converted to LLM messages (the full context of a later request). */
const effectiveMessages = (manager: pi.SessionManager): Context["messages"] => pi.convertToLlm(manager.buildSessionProjection().messages as never) as unknown as Context["messages"];

/** One tool turn in the real carrier order: the controller's stream yields the done/toolUse message, the session records it, a FAKE tool result for its call id is recorded (nothing is executed), then the run ends. */
async function toolTurn(controller: SessionController, manager: pi.SessionManager, context: Context, onPayload: (payload: unknown) => Promise<unknown>): Promise<void> {
	controller.policy.beginRun({ kind: "run" });
	const events = await drain(controller.stream(MODEL, context, { onPayload } as never)) as { type: string; reason?: string; message?: { content: { type: string; id?: string; name?: string }[] } }[];
	const done = events.find((event) => event.type === "done");
	assert.equal(done?.reason, "toolUse");
	const message = done?.message as { content: { type: string; id?: string; name?: string }[] };
	manager.appendMessage(message as never);
	const calls = message.content.filter((block) => block.type === "toolCall");
	assert.equal(calls.length, 1);
	manager.appendMessage({ role: "toolResult", toolCallId: calls[0].id, toolName: calls[0].name, content: [{ type: "text", text: "fake-tool-output" }], isError: false, timestamp: 1_700_000_000_500 } as never);
	controller.policy.endRun({ aborted: false });
}

it("[real facade] first turn seeds the built request; next turn replays raw encrypted items and sends the new user message once; prefix once with a changed prompt and tools; one hook per request", async () => {
	await withFileSession(async (dir, create) => {
		const manager = pi.SessionManager.create(dir, dir);
		manager.appendMessage(userMsg("hello") as never);
		const session = await create(manager);
		const runner = session.extensionRunner as unknown as { emitBeforeProviderRequest: (p: unknown) => Promise<unknown>; hasHandlers?: (n: string) => boolean };
		let hooks = 0;
		runner.emitBeforeProviderRequest = async (payload) => { hooks++; return payload; };
		runner.hasHandlers = () => true;
		const hook = (payload: unknown) => runner.emitBeforeProviderRequest(payload);
		const sse = sseScript([toolEvents("resp_1", "call_1"), textEvents("resp_2", "ok"), textEvents("resp_3", "ok")]);
		const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });

		const ctx1 = { systemPrompt: "SYSTEM A", messages: [userMsg("hello")], tools: [] } as unknown as Context;
		await toolTurn(controller, manager, ctx1, hook);
		const first = bodyInput(sse.calls[0].body);
		assert.equal(count(first, "\"text\":\"hello\""), 1, "first request carries the transcript once");
		assert.equal(hooks, 1, "one hook for the first request");
		const raw = controller.wireState?.rawHistory.rawOutputs().get("resp_1") ?? [];
		assert.deepEqual(raw.map((item) => item.type), ["reasoning", "function_call"]);

		manager.appendMessage(userMsg("second") as never);
		await turn(controller, { ...ctx1, messages: await effectiveMessages(manager) } as unknown as Context, hook);
		const second = bodyInput(sse.calls[1].body);
		assert.equal(count(second, "ENC-resp_1"), 1, "raw encrypted reasoning replayed once");
		assert.equal(count(second, "\"type\":\"reasoning\""), 1, "one reasoning item");
		assert.equal(count(second, "\"type\":\"function_call\""), 1, "exactly one function call");
		assert.equal(count(second, "\"type\":\"function_call_output\""), 1, "exactly one matching output");
		assert.equal(count(second, "\"call_id\":\"call_1\""), 2, "call id on the call and its output only");
		assert.equal(count(second, JSON.stringify("{\"cmd\":\"ls\"}")), 1, "raw arguments replayed lexically unchanged");
		assert.equal(count(second, "\"text\":\"second\""), 1, "new user message sent once");
		assert.equal(count(second, "\"text\":\"hello\""), 1, "earlier transcript not duplicated");
		assert.equal(count(second, "SYSTEM A"), 1, "fresh prefix once");
		assert.equal(hooks, 2);

		const tools = [{ name: "lookup", description: "Look up", parameters: { type: "object", properties: { q: { type: "number" } } } }];
		await turn(controller, { systemPrompt: "SYSTEM B", messages: await effectiveMessages(manager), tools } as unknown as Context, hook);
		const third = bodyInput(sse.calls[2].body);
		assert.equal(count(third, "SYSTEM B"), 1, "changed prompt is the one prefix");
		assert.equal(count(third, "SYSTEM A"), 0, "stale prefix is not replayed");
		assert.equal(count(third, "ENC-resp_1"), 1);
		assert.equal(count(third, "\"text\":\"second\""), 1, "second user message not duplicated");
		assert.equal(hooks, 3);
		controller.release();
	});
});

it("[real facade] save and reopen keep the durable window and raw items", async () => {
	await withFileSession(async (dir, create) => {
		const manager = pi.SessionManager.create(dir, dir);
		manager.appendMessage(userMsg("hello") as never);
		const file = manager.getSessionFile() as string;
		const store = await seededStore();
		const sse = sseScript([toolEvents("resp_1", "call_1"), textEvents("resp_2", "ok")]);
		const deps = { ...timing, connect: upgradeRequired, postEvents: sse.fn };
		const ctx = { systemPrompt: "SYSTEM A", messages: [userMsg("hello")], tools: [] } as unknown as Context;

		const first = createSessionController({ session: await create(manager), installationId: "inst-1", store, dependencies: deps });
		await turn(first, ctx);
		const window = first.wireState?.window;
		const raw = first.wireState?.rawHistory.rawOutputs().get("resp_1");
		assert.ok(window?.id && window.number === 0, "initial window persisted (number 0, bare UUIDv7 id)");
		first.release();

		const reopened = pi.SessionManager.open(file, dir);
		const second = createSessionController({ session: await create(reopened), installationId: "inst-1", store, dependencies: deps });
		await turn(second, ctx);
		assert.deepEqual(second.wireState?.window, window, "window reused on resume");
		assert.deepEqual(second.wireState?.rawHistory.rawOutputs().get("resp_1"), raw, "raw items reloaded from the session file");
		assert.equal(count(bodyInput(sse.calls[1].body), "ENC-resp_1"), 1, "replayed after reopen");
		second.release();
	});
});

it("[real facade] same-owner rotation keeps the opaque state; a different owner gets a new state, window and no old opaque", async () => {
	await withFileSession(async (dir, create) => {
		const manager = pi.SessionManager.create(dir, dir);
		manager.appendMessage(userMsg("hello") as never);
		const store = await seededStore();
		const sse = sseScript([toolEvents("resp_1", "call_1"), textEvents("resp_2", "ok"), textEvents("resp_3", "ok")]);
		const controller = createSessionController({ session: await create(manager), installationId: "inst-1", store, dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
		const ctx = { systemPrompt: "SYSTEM A", messages: [userMsg("hello")], tools: [] } as unknown as Context;

		await turn(controller, ctx);
		const before = controller.wireState;
		const beforeWindow = before?.window;

		await writeLogin(store, ACCOUNT, "rotated");
		await turn(controller, ctx);
		assert.equal(controller.wireState, before, "same owner: state object kept");
		assert.deepEqual(controller.wireState?.window, beforeWindow, "same owner: window kept");
		assert.equal(count(bodyInput(sse.calls[1].body), "ENC-resp_1"), 1, "same owner: opaque replayed after rotation");

		await writeLogin(store, "acct-codex-2", "other");
		await turn(controller, ctx);
		assert.notEqual(controller.wireState, before, "other owner: new state");
		assert.notEqual(controller.wireState?.window.id, beforeWindow?.id, "other owner: new window");
		assert.equal(count(bodyInput(sse.calls[2].body), "ENC-resp_1"), 0, "other owner: no old opaque");
		assert.equal(controller.wireState?.rawHistory.rawOutputs().has("resp_1"), false, "other owner: no old raw items");
		controller.release();
	});
});

it("[injected transport] startup is always cold, also on resume: no messages, the actual tools, the projected prompt; no native input is armed", async () => {
	await withSession(async (create) => {
		const manager = pi.SessionManager.inMemory();
		manager.appendMessage(userMsg("resumed") as never);
		const session = await create({ model: MODEL, sessionManager: manager });
		const bus = fakeBus("prefix");
		const log: Call[] = [];
		const controller = createSessionController({ session, pi: bus.pi, installationId: "inst-1", store: await seededStore(), dependencies: { transportFactory: () => fakeTransport(log) } });
		await controller.start();
		const prewarm = log.find((c) => c.op === "prewarm");
		assert.ok(prewarm, "prewarm was requested");
		const [, context] = prewarm.args as [string, Context];
		assert.deepEqual(context.messages, []);
		assert.deepEqual(context.tools, [...session.agent.state.tools]);
		assert.match(context.systemPrompt, /PROJECTED-RQW-PREFIX/);
		controller.release();
	});
});

it("[injected transport] a failed projection does not use the startup budget: a later start prewarms once", async () => {
	await withSession(async (create) => {
		const session = await create({ model: MODEL });
		let refuse = true;
		const events = {
			emit(channel: string, data: unknown) {
				if (channel !== STARTUP_PROJECTION_CHANNEL) return;
				const request = data as { options: { customPrompt?: string }; error?: string };
				if (refuse) request.error = "projection refused";
				else request.options.customPrompt = "PROJECTED-RQW-PREFIX";
			},
			on() { return () => {}; },
		};
		const log: Call[] = [];
		const controller = createSessionController({ session, pi: { events } as unknown as pi.ExtensionAPI, installationId: "inst-1", store: await seededStore(), dependencies: { transportFactory: () => fakeTransport(log) } });
		await controller.start();
		assert.equal(log.filter((c) => c.op === "prewarm").length, 0);
		refuse = false;
		await controller.start();
		await controller.start();
		assert.equal(log.filter((c) => c.op === "prewarm").length, 1);
		controller.release();
	});
});
