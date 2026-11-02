import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, mock } from "node:test";
import { normalizeContext, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import anthropic from "../../../extensions/RQW-anthropic/index.ts";

// The main chat's cache warm, through the registered provider and the extension's own handlers.
// Fake world: the network (a scripted fetch), the clock (node mock timers) and the session (a strict probe).
const MIN = 60_000;
const MAIN = "main-session";
const ACCESS = "sk-ant-oat01-fake-access";
const models = builtinProviders().find(provider => provider.id === "anthropic")!.getModels();
type CatalogModel = (typeof models)[number];
const adaptiveOf = (model: CatalogModel) => (model as { compat?: { forceAdaptiveThinking?: boolean } }).compat?.forceAdaptiveThinking === true;
const ADAPTIVE = models.find(model => model.reasoning && adaptiveOf(model))!;
// A model that thinks with a manual budget derived from max_tokens.
const MANUAL = models.find(model => model.reasoning && !adaptiveOf(model))!;
const context = normalizeContext({
	systemPrompt: "Keep this instruction",
	messages: [{ role: "user", content: "fake prompt", timestamp: 1 }],
	tools: [{ name: "read", description: "Read a file", parameters: { type: "object", properties: {} } }],
} as never);

const events = (items: unknown[]) => new Response(items.map(item => `event: ${(item as { type: string }).type}\ndata: ${JSON.stringify(item)}\n\n`).join(""), {
	headers: { "content-type": "text/event-stream" },
});
const start = (cacheRead = 0) => ({ type: "message_start", message: { id: "fake", model: "fake", usage: { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: cacheRead } } });
const finish = (reason = "end_turn") => [{ type: "message_delta", delta: { stop_reason: reason }, usage: { output_tokens: 1 } }, { type: "message_stop" }];
const answer = (cacheRead = 0) => events([start(cacheRead),
	{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
	{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "x" } },
	{ type: "content_block_stop", index: 0 }, ...finish()]);
const toolAnswer = () => events([start(5),
	{ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "read", input: {} } },
	{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } },
	{ type: "content_block_stop", index: 0 }, ...finish("tool_use")]);

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
async function flush() { for (let i = 0; i < 30; i++) await settle(); }

type Provider = {
	streamSimple(model: CatalogModel, context: never, options?: SimpleStreamOptions): { result(): Promise<{ stopReason: string }> };
	forks: { registerSource(id: string): void };
};
type Sent = { body: Record<string, any>; headers: Headers; signal: AbortSignal | undefined; at: number };
type Reply = (sent: Sent) => Response | Promise<Response>;

async function scenario(run: (world: World) => Promise<void>, session: { model?: CatalogModel } = {}) {
	const agentDir = mkdtempSync(join(tmpdir(), "rqw-anthropic-warm-"));
	const savedDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
	let provider: Provider | undefined;
	try {
		anthropic({ events: { on: () => () => {}, emit: () => {} },
			on: (name: string, handler: (event: unknown, ctx: unknown) => void) => handlers.set(name, handler),
			registerProvider: (_name: string, config: typeof provider) => { provider = config; } } as unknown as ExtensionAPI);
	} finally {
		if (savedDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = savedDir;
	}
	mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const world = openWorld(provider!, handlers, session.model ?? ADAPTIVE);
	try { await run(world); }
	finally {
		world.close();
		mock.timers.reset();
		mock.restoreAll();
		rmSync(agentDir, { recursive: true, force: true });
	}
}

function openWorld(provider: Provider,
	handlers: Map<string, (event: unknown, ctx: unknown) => void>, model: CatalogModel) {
	const listeners = new Set<(event: unknown) => void>();
	const probe = { sessionId: MAIN, model, isStreaming: false, isCompacting: false, isRetrying: false, isBashRunning: false, pendingMessageCount: 0,
		subscribe(listener: (event: unknown) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
	const allowed = new Set(Object.keys(probe));
	// Anything the warm reads or calls beyond the idle probes fails the test.
	const session = new Proxy(probe, { get(target, name, receiver) {
		if (typeof name === "symbol" || allowed.has(name)) return Reflect.get(target, name, receiver);
		throw new Error(`the warm touched session.${name}`);
	} });
	const sessionManager = SessionManager.inMemory(process.cwd());
	handlers.get("rqw-anthropic:session-bind")!({ session }, { sessionManager });
	provider.forks.registerSource(MAIN);
	const sent: Sent[] = [];
	let reply: Reply = () => answer();
	const fetch: typeof globalThis.fetch = async (_input, init) => {
		const entry = { body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers), signal: init?.signal ?? undefined, at: Date.now() };
		sent.push(entry);
		return reply(entry);
	};
	const world = {
		probe, session, provider, sent, sessionManager, handlers,
		/** Warm replays are the requests that cap the answer at one token. */
		get warms() { return sent.filter(entry => entry.body.max_tokens === 1); },
		get reals() { return sent.filter(entry => entry.body.max_tokens !== 1); },
		replies(next: Reply) { reply = next; },
		emit(event: unknown) { for (const listener of [...listeners]) listener(event); },
		call(name: string, event: unknown = {}) { handlers.get(name)!(event, { sessionManager }); },
		/** One real request through the registered provider. */
		request(options: Partial<SimpleStreamOptions> = {}, ask = model) {
			return provider.streamSimple(ask, context as never, { apiKey: ACCESS, sessionId: MAIN, fetch, ...options } as SimpleStreamOptions).result();
		},
		/** Pi binds the session again, as it does after a reload or a new identity. */
		rebind() { handlers.get("rqw-anthropic:session-bind")!({ session }, { sessionManager }); },
		/** Minute by minute, so a timer runs at its own time and is never mistaken for a late one. */
		async elapse(ms: number) {
			mock.timers.tick(0);
			for (let left = ms; left > 0; left -= MIN) {
				mock.timers.tick(Math.min(left, MIN));
				await settle();
			}
			await flush();
		},
		close() { handlers.get("session_shutdown")!({}, { sessionManager }); },
	};
	return world;
}
type World = ReturnType<typeof openWorld>;

it("sends nothing before the first real request, then one replay 50 minutes after it", async () => {
	await scenario(async world => {
		await world.elapse(120 * MIN);
		assert.equal(world.sent.length, 0);
		const startedAt = Date.now();
		assert.equal((await world.request()).stopReason, "stop");
		await world.elapse(49 * MIN);
		assert.equal(world.warms.length, 0, "nothing goes out before the 50 minutes");
		await world.elapse(MIN);
		assert.equal(world.warms.length, 1);
		assert.equal(world.warms[0]!.at, startedAt + 50 * MIN);
	});
});

it("replays the exact request, with max_tokens 1 as the only change", async () => {
	await scenario(async world => {
		await world.request({ reasoning: "high" });
		await world.elapse(50 * MIN);
		const [real] = world.reals;
		const [warm] = world.warms;
		assert.ok(real && warm, "one real request and one replay");
		assert.notEqual(real.body.max_tokens, 1);
		const wire: Record<string, any> = warm.body;
		assert.equal(warm.headers.get("anthropic-beta"), real.headers.get("anthropic-beta"));
		assert.equal(warm.headers.get("x-claude-code-session-id"), real.headers.get("x-claude-code-session-id"));
		// The cache markers, the thinking mode, the effort and the tools all came along.
		assert.ok(JSON.stringify(wire).includes('"cache_control"'));
		assert.equal(wire.thinking?.type, "adaptive");
		assert.ok(wire.output_config?.effort);
		assert.ok(wire.tools?.length > 0);
		assert.deepEqual(wire, { ...real.body, max_tokens: 1 });
	});
});

it("keeps the reply and any dot out of the request, and never writes to the session", async () => {
	await scenario(async world => {
		await world.request();
		await world.elapse(50 * MIN);
		assert.equal(world.warms.length, 1);
		// The strict session fails the test on any call or read beyond the idle probes, so nothing can be written to it.
		assert.deepEqual(world.warms[0]!.body.messages, world.reals[0]!.body.messages, "no added message, no dot");
	});
});

it("never executes a tool the replayed answer asks for, and sends no follow-up", async () => {
	await scenario(async world => {
		world.replies(sent => sent.body.max_tokens === 1 ? toolAnswer() : answer());
		await world.request();
		await world.elapse(50 * MIN);
		assert.equal(world.warms.length, 1);
		await world.elapse(MIN);
		assert.equal(world.sent.length, 2, "the tool call is dropped: no result is sent back");
	});
});

it("the 50 minutes count from the start of the real request, not from its end", async () => {
	await scenario(async world => {
		let open = () => {};
		world.replies(() => new Promise<Response>(resolve => { open = () => resolve(answer()); }));
		const startedAt = Date.now();
		const pending = world.request();
		await flush();
		mock.timers.tick(9 * MIN);
		world.replies(() => answer());
		open();
		await pending;
		await world.elapse(40 * MIN);
		assert.equal(world.warms.length, 0);
		await world.elapse(MIN);
		assert.equal(world.warms.length, 1);
		assert.equal(world.warms[0]!.at, startedAt + 50 * MIN);
	});
});

it("a failed real request is no snapshot and ends the earlier cycle", async () => {
	await scenario(async world => {
		await world.request();
		await world.elapse(50 * MIN);
		assert.equal(world.warms.length, 1, "control: an answered request is warmed");
		await world.request();
		world.replies(() => new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "fake" } }), { status: 500 }));
		assert.equal((await world.request()).stopReason, "error");
		await world.elapse(200 * MIN);
		assert.equal(world.warms.length, 1, "nothing is warmed after the failure");
	});
});

it("a new real request cancels a replay in flight and is not held back by it", async () => {
	await scenario(async world => {
		world.replies(sent => sent.body.max_tokens === 1
			? new Promise<Response>((_resolve, reject) => sent.signal?.addEventListener("abort", () => reject(sent.signal!.reason)))
			: answer());
		await world.request();
		await world.elapse(50 * MIN);
		assert.equal(world.warms.length, 1);
		assert.equal(world.warms[0]!.signal?.aborted, false, "the replay is still waiting for its answer");
		assert.equal((await world.request()).stopReason, "stop");
		assert.equal(world.warms[0]!.signal?.aborted, true);
		world.replies(() => answer());
		await world.elapse(50 * MIN);
		assert.equal(world.warms.length, 2, "the new real request started its own cycle");
	});
});

// Both an exclusion and its control: the same flow with the default main session warms once.
async function warmedOnce(run: (world: World) => Promise<void>, session?: { model?: CatalogModel }) {
	let warms = -1;
	await scenario(async world => {
		await run(world);
		await world.elapse(50 * MIN);
		warms = world.warms.length;
	}, session);
	return warms;
}

it("warms only the main session's one-hour OAuth requests", async () => {
	assert.equal(await warmedOnce(async world => { await world.request(); }), 1, "control");
	assert.equal(await warmedOnce(async world => {
		world.provider.forks.registerSource("child-session");
		await world.request({ sessionId: "child-session" });
	}), 0, "a child session");
	assert.equal(await warmedOnce(async world => { await world.request({ cacheRetention: "short" }); }), 0, "short retention");
	assert.equal(await warmedOnce(async world => { await world.request({ cacheRetention: "none" }); }), 0, "no caching");
	assert.equal(await warmedOnce(async world => { await world.request({ apiKey: "fake-api-key" }); }), 0, "an API key");
});

it("does not replay a request with a hosted tool, which could run on the server", async () => {
	const hosted = (payload: unknown) => ({ ...(payload as { tools: unknown[] }), tools: [...(payload as { tools: unknown[] }).tools, { type: "web_search_20250305", name: "web_search" }] });
	assert.equal(await warmedOnce(async world => { await world.request({ onPayload: hosted }); }), 0);
	assert.equal(await warmedOnce(async world => { await world.request(); }), 1, "control: local tools only");
});

it("does not replay manual extended thinking, whose budget follows max_tokens", async () => {
	assert.equal(await warmedOnce(async world => { await world.request({}, MANUAL); }, { model: MANUAL }), 1, "control: the same model without thinking");
	assert.equal(await warmedOnce(async world => { await world.request({ reasoning: "high" }, MANUAL); }, { model: MANUAL }), 0);
});

it("never sends while the session is busy, streaming, compacting, retrying, running a shell command or has queued input", async () => {
	for (const busy of ["isStreaming", "isCompacting", "isRetrying", "isBashRunning", "pendingMessageCount"] as const) {
		assert.equal(await warmedOnce(async world => {
			await world.request();
			(world.probe as Record<string, unknown>)[busy] = busy === "pendingMessageCount" ? 1 : true;
		}), 0, busy);
	}
	assert.equal(await warmedOnce(async world => { await world.request(); }), 1, "control: idle");
});

const triggers: Array<[string, (world: World) => void]> = [
	["the next agent run starts", world => world.emit({ type: "agent_start" })],
	["a compaction starts", world => world.emit({ type: "compaction_start", reason: "manual" })],
	["input is queued", world => world.emit({ type: "queue_update", steering: [], followUp: ["later"] })],
	["the owner writes", world => world.call("input", { type: "input", text: "hello" })],
	["the model changes", world => world.call("model_select", { type: "model_select" })],
	["the branch navigation starts", world => world.call("session_before_tree", { type: "session_before_tree" })],
	["the branch changes", world => world.call("session_tree", { type: "session_tree" })],
	["a compaction ends", world => world.call("session_compact", { type: "session_compact" })],
	["the session gets a new identity", world => { world.probe.sessionId = "renamed-session"; world.rebind(); }],
	["the extension shuts down (reload or close)", world => world.close()],
];
for (const [name, trigger] of triggers) {
	it(`clears the pending warm when ${name}`, async () => {
		await scenario(async world => {
			await world.request();
			await world.elapse(50 * MIN);
			assert.equal(world.warms.length, 1, "control: an untouched cycle warms");
			await world.request();
			trigger(world);
			await world.elapse(200 * MIN);
			assert.equal(world.warms.length, 1);
		});
	});
}

it("an empty queue update does not end the cycle", async () => {
	await scenario(async world => {
		await world.request();
		world.emit({ type: "queue_update", steering: [], followUp: [] });
		await world.elapse(50 * MIN);
		assert.equal(world.warms.length, 1);
	});
});

it("skips a timer that runs long after its time and leaves the restart to the next real request", async () => {
	await scenario(async world => {
		await world.request();
		// The machine slept: the clock jumps 56 minutes before the timer gets to run.
		mock.timers.setTime(Date.now() + 56 * MIN);
		await world.elapse(0);
		assert.equal(world.warms.length, 0, "a late warm would be a cold write");
		await world.request();
		await world.elapse(50 * MIN);
		assert.equal(world.warms.length, 1, "the next real request restarts the cycle");
	});
});

it("still warms when the timer is only a little late", async () => {
	await scenario(async world => {
		await world.request();
		mock.timers.setTime(Date.now() + 54 * MIN);
		await world.elapse(0);
		assert.equal(world.warms.length, 1);
	});
});

it("an error ends the cycle: one attempt, no retry, no token refresh", async () => {
	for (const status of [400, 401, 429, 500, 529]) {
		await scenario(async world => {
			world.replies(sent => sent.body.max_tokens === 1
				? new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "fake" } }), { status, headers: { "x-should-retry": "true" } })
				: answer());
			await world.request();
			await world.elapse(50 * MIN);
			await world.elapse(300 * MIN);
			assert.equal(world.warms.length, 1, `HTTP ${status}`);
			assert.equal(world.sent.length, 2, `HTTP ${status}: no other request, not even a token refresh`);
		});
	}
	await scenario(async world => {
		world.replies(sent => { if (sent.body.max_tokens === 1) throw new Error("fake network down"); return answer(); });
		await world.request();
		await world.elapse(350 * MIN);
		assert.equal(world.warms.length, 1, "a network failure");
	});
});

it("continues only after a read: the next replay is 50 minutes after the last one started", async () => {
	await scenario(async world => {
		world.replies(sent => sent.body.max_tokens === 1 ? answer(1000) : answer());
		await world.request();
		await world.elapse(50 * MIN);
		await world.elapse(50 * MIN);
		assert.deepEqual(world.warms.map(entry => entry.at), [50 * MIN, 100 * MIN]);
	});
	await scenario(async world => {
		world.replies(() => answer(0));
		await world.request();
		await world.elapse(200 * MIN);
		assert.equal(world.warms.length, 1, "a miss ends the cycle");
	});
});
