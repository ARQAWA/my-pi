// Fast Codex steering: a user steering message queued in Pi ends the response being read (native Drain over WebSocket, a
// released request over SSE). Every case enters through the registered provider (streamSimple) and Pi's own queue_update event.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import zlib from "node:zlib";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import { createCodexExtension } from "../../../extensions/RQW-codex/index.ts";
import { SESSION_BIND } from "../../../extensions/RQW-codex/lifecycle.ts";
import { BACKGROUND_SUMMARY } from "../../../extensions/RQW-codex/session-compaction.ts";
import { CodexThreadTransport } from "../../../extensions/RQW-codex/transport.ts";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";

const model: any = {
	id: "gpt-6-luna", name: "GPT-6-Luna", provider: "openai-codex", api: "openai-codex-responses",
	baseUrl: "https://example.invalid", reasoning: true, input: ["text"], contextWindow: 500000, maxTokens: 100000,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, thinkingLevelMap: {},
};
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
const created = (id: string) => ({ type: "response.created", response: { id } });
const completed = (id: string) => ({ type: "response.completed", response: { id, status: "completed", usage } });
const added = (index: number, item: any) => ({ type: "response.output_item.added", output_index: index, item });
const done = (index: number, item: any) => ({ type: "response.output_item.done", output_index: index, item });
const message = (id: string, text: string, status = "completed") => ({ type: "message", id, role: "assistant", status, content: status === "completed" ? [{ type: "output_text", text, annotations: [] }] : [] });
const delta = (id: string, text: string) => ({ type: "response.output_text.delta", item_id: id, output_index: 0, content_index: 0, delta: text });
const call = (id: string, status: "in_progress" | "completed") => ({ type: "function_call", id: `fc_${id}`, call_id: `call_${id}`, name: "probe", arguments: status === "completed" ? "{}" : "", status });
const user = (text: string, timestamp: number) => ({ role: "user", content: text, timestamp });
const textOf = (result: any) => result.content.filter((block: any) => block.type === "text").map((block: any) => block.text);

/** Lets the stream, auth and socket promises run; no real time passes. */
async function settle(until: () => boolean): Promise<void> {
	for (let turn = 0; turn < 200 && !until(); turn++) await new Promise<void>((resolve) => setImmediate(resolve));
	assert.ok(until(), "the awaited state was not reached");
}

/** Lets everything that is ready run; no real time passes. */
async function flush(): Promise<void> {
	for (let turn = 0; turn < 20; turn++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** One feed of provider events the test releases step by step. Reading waits; an abort of `signal` ends the wait. */
function feed() {
	const queue: unknown[] = [];
	let wake: (() => void) | undefined;
	return {
		push(...events: unknown[]) {
			queue.push(...events);
			wake?.();
			wake = undefined;
		},
		async *read(signal?: AbortSignal) {
			for (;;) {
				while (queue.length === 0) {
					await new Promise<void>((resolve, reject) => {
						wake = resolve;
						signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
					});
				}
				const value = queue.shift();
				if (value instanceof Error) throw value;
				yield { text: JSON.stringify(value), value };
			}
		},
	};
}

type Opened = { sockets: { id: number; open: boolean }[]; sentOn: number[]; handlers: Map<string, Array<(event: any, ctx: any) => any>>; sessions: Map<string, ReturnType<typeof fakeSession>>; config: () => any; sent: any[]; interrupts: { id: string; mode: unknown }[]; posts: any[]; events: ReturnType<typeof feed>; stop(): Promise<void>; failInterrupt: { on: boolean; quiet?: boolean } };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	while (cleanups.length) await cleanups.pop()!();
});

function fakeSession(id: string, runtime: any) {
	const manager = SessionManager.inMemory(process.cwd());
	const listeners = new Set<(event: any) => void>();
	const session: any = { sessionId: id, sessionManager: manager, modelRuntime: runtime, model, agent: { state: { tools: [] } }, _hiddenDeclarations: new Set(),
		subscribe: (listener: (event: any) => void) => { listeners.add(listener); return () => listeners.delete(listener); }, dispose() {}, _isRetryableError: () => false };
	return Object.assign(session, { queueUpdate(steering: string[], followUp: string[] = []) { for (const listener of [...listeners]) listener({ type: "queue_update", steering, followUp }); } });
}

/** The provider with a controllable transport: WebSocket by default, SSE when the upgrade is refused with 426. */
async function open(transport: "websocket" | "sse", sessionIds = ["root"]): Promise<Opened> {
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	const pi: any = { events: createEventBus(), registerTool() {}, getSettings: () => ({}), getActiveTools: () => [],
		on(name: string, handler: (event: any, ctx: any) => any) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); return () => handlers.set(name, (handlers.get(name) ?? []).filter((item) => item !== handler)); } };
	const store = new InMemoryCredentialStore();
	const access = `e30.${Buffer.from(JSON.stringify({ exp: 4000000000, "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.sig`;
	await store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "test", expires: 4000000000000, accountId: "test" }) as never);
	let config: any;
	const noop = () => undefined;
	const runtime: any = { getAuth: noop, prepareRequest: noop, stream: noop, streamSimple: noop, composeProvider: noop, models: { getAuth: noop }, credentials: store,
		getRegisteredProviderConfig: () => config, registerProvider: (_name: string, value: any) => { config = value; }, unregisterProvider: () => { config = undefined; } };
	const events = feed();
	const sent: any[] = [];
	const interrupts: { id: string; mode: unknown }[] = [];
	const posts: any[] = [];
	const failInterrupt: { on: boolean; quiet?: boolean } = { on: false };
	const sockets: { id: number; open: boolean }[] = [];
	const sentOn: number[] = [];
	const connect = transport === "sse"
		? async () => { throw new SocketError(426, {}, "upgrade required", "upgrade-rejected"); }
		: async () => {
			const record = { id: sockets.length + 1, open: true };
			sockets.push(record);
			return {
				get isOpen() { return record.open; }, socketIdentity: `socket-${record.id}`, events: () => events.read(),
				async send(frame: unknown) { sent.push(frame); sentOn.push(record.id); },
				async interrupt(id: string, mode: unknown) {
					if (failInterrupt.on) {
						// A broken Drain retires the socket: the reader sees the failure, as Connection.fail delivers it.
						failInterrupt.on = false;
						if (!failInterrupt.quiet) events.push(new SocketError(undefined, {}, "drain failed", "transport"));
						throw new Error("drain failed");
					}
					interrupts.push({ id, mode });
					return { acknowledged: false, completed: true };
				},
				async close() { record.open = false; },
			} as any;
		};
	const postEvents = (options: any) => {
		posts.push(options);
		options.onResponse({ status: 200, headers: {} });
		return events.read(options.signal);
	};
	createCodexExtension({ installationId: "11111111-2222-4333-8444-555555555555",
		dependencies: { connect: connect as any, postEvents: postEvents as any, clock: { now: () => 1000000 }, random: () => 0.5, sleep: async () => {}, collectWorkspaceMetadata: async () => ({}) } })(pi);
	const sessions = new Map(sessionIds.map((id) => [id, fakeSession(id, runtime)]));
	for (const session of sessions.values()) for (const handler of handlers.get(SESSION_BIND) ?? []) handler({ type: SESSION_BIND, session }, {});
	const stop = async () => {
		for (const handler of handlers.get("session_shutdown") ?? []) await handler({ reason: "shutdown" }, { sessionManager: sessions.get(sessionIds[0])!.sessionManager });
	};
	cleanups.push(stop);
	return { sockets, sentOn, handlers, sessions, config: () => config, sent, interrupts, posts, events, stop, failInterrupt };
}

const turn = (world: Opened, messages: unknown[], sessionId = "root") =>
	world.config().streamSimple(model, { messages, tools: [] }, { sessionId });

test("a steering message ends the Lite WebSocket response with exactly one Drain and the next request carries it", { timeout: 3000 }, async () => {
	const world = await open("websocket");
	const history = world.sessions.get("root")!.sessionManager;
	history.appendMessage(user("hello", 1));
	const pending = turn(world, [user("hello", 1)]).result();
	await settle(() => world.sent.length === 1);
	world.events.push(created("resp_1"), added(0, message("m1", "", "in_progress")), delta("m1", "first"), done(0, message("m1", "first")), added(1, message("m2", "", "in_progress")), delta("m2", "par"));
	await flush();
	assert.deepEqual(world.interrupts, [], "no steering message, no interrupt");

	world.sessions.get("root")!.queueUpdate(["use the smaller patch"]);
	await settle(() => world.interrupts.length === 1);
	world.sessions.get("root")!.queueUpdate(["use the smaller patch", "and add a test"]);
	await flush();
	assert.deepEqual(world.interrupts, [{ id: "resp_1", mode: { mode: "drain" } }], "one interrupt per response");
	assert.equal(world.sent.length, 1, "no second response.create before the terminal event");

	// The server answers a Drain with the terminal event; only completed items stay.
	world.events.push(completed("resp_1"));
	const result = await pending;
	assert.equal(result.stopReason, "stop", result.errorMessage);
	assert.deepEqual(textOf(result), ["first"]);

	history.appendMessage(result);
	history.appendMessage(user("use the smaller patch", 2));
	const next = turn(world, [user("hello", 1), result, user("use the smaller patch", 2)]).result();
	await settle(() => world.sent.length === 2);
	assert.equal(world.sent.length, 2, "one response.create at a time");
	assert.equal(world.sent[1].previous_response_id, "resp_1");
	assert.match(JSON.stringify(world.sent[1].input), /use the smaller patch/);
	world.events.push(created("resp_2"), completed("resp_2"));
	assert.equal((await next).stopReason, "stop");
	assert.equal(world.interrupts.length, 1, "the next response is not interrupted without a new steering message");
});

test("a steering message queued before response.created drains once the response has an id", { timeout: 3000 }, async () => {
	const world = await open("websocket");
	const pending = turn(world, [user("hello", 1)]).result();
	await settle(() => world.sent.length === 1);
	world.sessions.get("root")!.queueUpdate(["early"]);
	await flush();
	assert.deepEqual(world.interrupts, []);
	world.events.push(created("resp_early"));
	await settle(() => world.interrupts.length === 1);
	assert.deepEqual(world.interrupts, [{ id: "resp_early", mode: { mode: "drain" } }]);
	world.events.push(completed("resp_early"));
	assert.equal((await pending).stopReason, "stop");
});

test("only a longer steering queue interrupts: follow-ups, shrinking and idle sessions do not", { timeout: 3000 }, async () => {
	const world = await open("websocket", ["root", "other"]);
	const root = world.sessions.get("root")!;
	root.queueUpdate(["queued before the run"]);
	const pending = turn(world, [user("hello", 1)]).result();
	await settle(() => world.sent.length === 1);
	world.events.push(created("resp_1"));
	await flush();
	root.queueUpdate(["queued before the run"], ["a follow-up"]);
	root.queueUpdate([], ["a follow-up"]);
	world.sessions.get("other")!.queueUpdate(["a steer of another chat"]);
	await flush();
	assert.deepEqual(world.interrupts, []);
	world.events.push(completed("resp_1"));
	await pending;
	// A steering message after the response is over waits for Pi's own tool boundary; it never carries into the next stream.
	root.queueUpdate(["too late"]);
	const next = turn(world, [user("again", 3)]).result();
	await settle(() => world.sent.length === 2);
	world.events.push(created("resp_2"));
	await flush();
	assert.deepEqual(world.interrupts, []);
	world.events.push(completed("resp_2"));
	await next;
});

test("a Drain that breaks the socket is retried by the ordinary policy and the retried response is drained too", { timeout: 3000 }, async () => {
	const world = await open("websocket");
	world.failInterrupt.on = true;
	const pending = turn(world, [user("hello", 1)]).result();
	await settle(() => world.sent.length === 1);
	world.events.push(created("resp_1"));
	await flush();
	world.sessions.get("root")!.queueUpdate(["steer"]);
	// The broken socket is replaced; the steering is still waiting in Pi, so the new response is drained as well.
	await settle(() => world.sent.length === 2);
	assert.deepEqual(world.sentOn, [1, 2], "the retry uses a new socket");
	assert.equal(world.sockets[0].open, false, "the failed socket is closed");
	world.events.push(created("resp_2"));
	await settle(() => world.interrupts.length === 1);
	assert.deepEqual(world.interrupts, [{ id: "resp_2", mode: { mode: "drain" } }]);
	world.events.push(added(0, message("m1", "", "in_progress")), delta("m1", "whole"), done(0, message("m1", "whole")), completed("resp_2"));
	const result = await pending;
	assert.equal(result.stopReason, "stop", result.errorMessage);
	assert.deepEqual(textOf(result), ["whole"]);
});

test("a failed Drain call alone leaves the response to finish on its own", { timeout: 3000 }, async () => {
	const world = await open("websocket");
	world.failInterrupt.on = true;
	world.failInterrupt.quiet = true;
	const pending = turn(world, [user("hello", 1)]).result();
	await settle(() => world.sent.length === 1);
	world.events.push(created("resp_1"));
	await flush();
	world.sessions.get("root")!.queueUpdate(["steer"]);
	await flush();
	world.events.push(added(0, message("m1", "", "in_progress")), delta("m1", "whole"), done(0, message("m1", "whole")), completed("resp_1"));
	const result = await pending;
	assert.equal(result.stopReason, "stop", result.errorMessage);
	assert.deepEqual(textOf(result), ["whole"]);
	assert.equal(world.sent.length, 1);
});

test("a steering message during a compaction summary changes nothing", { timeout: 3000 }, async () => {
	const world = await open("websocket");
	const first = turn(world, [user("hello", 1)]).result();
	await settle(() => world.sent.length === 1);
	world.events.push(created("resp_1"), completed("resp_1"));
	await first;
	const summarySignal = new AbortController();
	const owner = world.sessions.get("root")!;
	for (const handler of world.handlers.get(BACKGROUND_SUMMARY) ?? []) handler({ type: BACKGROUND_SUMMARY, signal: summarySignal.signal }, { model, sessionManager: owner.sessionManager });
	const summary = world.config().streamSimple(model, { messages: [user("summarize", 2)] }, { sessionId: "019a0000-0000-7000-8000-000000000001", cacheRetention: "none", signal: summarySignal.signal }).result();
	await settle(() => world.sent.length === 2);
	world.events.push(created("resp_sum"));
	await flush();
	owner.queueUpdate(["steer during the summary"]);
	await flush();
	assert.deepEqual(world.interrupts, []);
	world.events.push(added(0, message("ms", "", "in_progress")), delta("ms", "SUMMARY"), done(0, message("ms", "SUMMARY")), completed("resp_sum"));
	assert.deepEqual(textOf(await summary), ["SUMMARY"]);
});

test("SSE: a steering message releases only the request and ends it with the completed items", { timeout: 3000 }, async () => {
	const world = await open("sse");
	const pending = turn(world, [user("hello", 1)]).result();
	await settle(() => world.posts.length === 1);
	world.events.push(created("resp_sse"), added(0, message("m1", "", "in_progress")), delta("m1", "kept"), done(0, message("m1", "kept")), added(1, call("a", "in_progress")));
	await flush();
	world.sessions.get("root")!.queueUpdate(["steer"]);
	const result = await pending;
	assert.equal(result.stopReason, "stop", result.errorMessage);
	assert.deepEqual(result.content.map((block: any) => block.type), ["text"], "the unfinished call is dropped");
	assert.deepEqual(textOf(result), ["kept"]);
	assert.equal(world.posts[0].signal.aborted, true, "the request was released");
	assert.equal(world.posts.length, 1, "no second request for the same response");
});

test("SSE: a completed tool call survives the release and ends as toolUse once", { timeout: 3000 }, async () => {
	const world = await open("sse");
	const pending = turn(world, [user("hello", 1)]).result();
	await settle(() => world.posts.length === 1);
	world.events.push(created("resp_sse"), added(0, call("a", "in_progress")), done(0, call("a", "completed")), added(1, message("m1", "", "in_progress")), delta("m1", "half"));
	await flush();
	world.sessions.get("root")!.queueUpdate(["steer"]);
	const result = await pending;
	assert.equal(result.stopReason, "toolUse", result.errorMessage);
	assert.deepEqual(result.content.map((block: any) => `${block.type}:${block.name ?? ""}`), ["toolCall:probe"]);
});

test("SSE: a steering message before response.created waits for the response id", { timeout: 3000 }, async () => {
	const world = await open("sse");
	const pending = turn(world, [user("hello", 1)]).result();
	await settle(() => world.posts.length === 1);
	world.sessions.get("root")!.queueUpdate(["early"]);
	await flush();
	assert.equal(world.posts[0].signal.aborted, false);
	world.events.push(created("resp_sse"));
	const result = await pending;
	assert.equal(result.stopReason, "stop", result.errorMessage);
	assert.equal(world.posts[0].signal.aborted, true);
});

test("SSE: the raw items completed before the release replay in the next request", { timeout: 3000 }, async () => {
	const store = new InMemoryCredentialStore();
	const access = `e30.${Buffer.from(JSON.stringify({ exp: 4000000000, "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.sig`;
	await store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "test", expires: 4000000000000, accountId: "test" }) as never);
	const events = feed();
	const bodies: any[] = [];
	const transport = new CodexThreadTransport({ identity: { installationId: "11111111-2222-4333-8444-555555555555", windowId: "w:0", rootSessionId: "t", threadId: "t" }, store, dependencies: {
		connect: async () => { throw new SocketError(426, {}, "upgrade required", "upgrade-rejected"); },
		postEvents: ((options: any) => { bodies.push(JSON.parse(zlib.zstdDecompressSync(Buffer.from(options.body)).toString("utf8"))); options.onResponse({ status: 200, headers: {} }); return events.read(options.signal); }) as any,
		clock: { now: () => 1000000 }, random: () => 0.5, sleep: async () => {} } });
	try {
		const pending = transport.stream(model, { messages: [user("hello", 1)], tools: [] } as any).result();
		await settle(() => bodies.length === 1);
		const item = { ...message("m1", "kept"), content: [{ type: "output_text", text: "kept", annotations: [{ type: "raw_only_marker" }] }] };
		events.push(created("resp_sse"), added(0, message("m1", "", "in_progress")), done(0, item));
		await flush();
		transport.nudge();
		const result = await pending;
		const next = transport.stream(model, { messages: [user("hello", 1), result, user("steer", 2)], tools: [] } as any).result();
		await settle(() => bodies.length === 2);
		assert.match(JSON.stringify(bodies[1].input), /raw_only_marker/);
		events.push(created("resp_2"), completed("resp_2"));
		await next;
	} finally {
		transport.dispose();
	}
});
