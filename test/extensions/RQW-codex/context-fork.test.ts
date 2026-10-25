import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { InMemoryCredentialStore, normalizeContext, type Api, type AssistantMessage, type Context, type Model } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONTEXT_FORK_CHANNEL, prepareContextFork, type ContextForkRequest } from "../../../extensions/RQW-codex/context-fork.ts";
import { createCodexExtension } from "../../../extensions/RQW-codex/index.ts";
import { CodexThreadTransport, wireCapabilities, type RawItemHistory } from "../../../extensions/RQW-codex/transport.ts";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";
import { SSE_IDLE_TIMEOUT_MS } from "../../../extensions/RQW-codex/sse.ts";
import { CodexError } from "../../../extensions/RQW-codex/errors.ts";
import { buildRequest, type WireItem } from "../../../extensions/RQW-codex/wire.ts";

const MODEL = {
	id: "gpt-6.1-sol", name: "Sol", api: "openai-codex-responses", provider: "openai-codex", baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 500000, maxTokens: 100000, thinkingLevelMap: {},
} as Model<Api>;
const IDENTITY = { installationId: "11111111-2222-4333-8444-555555555555", threadId: "child-thread", rootSessionId: "root-key", windowId: "child-thread:0" };
const TOOL = { name: "lookup", description: "lookup", parameters: { type: "object", properties: { q: { type: "string" } } } };
const SOURCE: Context = { systemPrompt: "Exact child system.", tools: [TOOL] as never, messages: [{ role: "user", content: "work", timestamp: 1 }] };
const reportTail = () => ({ role: "user", content: "Report progress. Tools in the latest response may still be pending.", timestamp: 2 }) as const;
const usage = { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 7 }, output_tokens_details: { reasoning_tokens: 0 } };
const completed = (id: string) => ({ type: "response.completed", response: { id, status: "completed", usage } });
const textEvents = (id: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: id, annotations: [] }] } },
	completed(id),
];
const callEvents = (id: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: `fc_${id}`, call_id: `call_${id}`, name: "lookup", arguments: "{}", status: "completed" } },
	completed(id),
];
function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}
async function store() {
	const saved = new InMemoryCredentialStore();
	const exp = Math.floor(Date.now() / 1000) + 3600;
	const access = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp, "https://api.openai.com/auth": { chatgpt_account_id: "acct-fork" } })).toString('base64url')}.sig`;
	await saved.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "fake-refresh", expires: exp * 1000, accountId: "acct-fork" }) as never);
	return saved;
}
function request(context: Context, signal = new AbortController().signal): ContextForkRequest {
	return { sessionId: IDENTITY.threadId, model: MODEL, context, signal, offer() {} };
}
function ledger() {
	const outputs = new Map<string, readonly WireItem[]>();
	const bodies: Record<string, any>[] = [];
	let writes = 0;
	const history: RawItemHistory = {
		rawOutputs: () => outputs,
		recordItem(id, item) { writes++; outputs.set(id, [...(outputs.get(id) ?? []), structuredClone(item)]); },
		recordOutputs(id, items) { writes++; outputs.set(id, structuredClone([...items])); },
		preparedRequest(body) { writes++; bodies.push(structuredClone(body)); },
	};
	return { history, outputs, bodies, writes: () => writes };
}
function sockets(forkMode: "text" | "tool" | "error" | "network" = "text", childTool = false) {
	const sent: { socket: number; body: any }[] = [];
	const closed: number[] = [];
	const interrupted: number[] = [];
	const forkStarted = deferred();
	let count = 0;
	const connect = async () => {
		const number = ++count;
		let open = true;
		let body: any;
		let calls = 0;
		return {
			get isOpen() { return open; }, socketIdentity: `socket-${number}`,
			async send(value: any) { body = value; calls++; sent.push({ socket: number, body: structuredClone(value) }); },
			async *events() {
				if (number > 1) forkStarted.resolve();
				if (number > 1 && forkMode === "network") throw new SocketError(undefined, {}, "connection lost", "closed");
				if (number > 1 && forkMode === "error") {
					yield { text: "", value: { type: "error", error: { type: "invalid_request_error", code: "invalid_request_error", message: "rejected" } } };
					return;
				}
				const events = number > 1 && forkMode === "tool" || number === 1 && childTool ? callEvents(number === 1 ? `child-${calls}` : "fork-tool") : textEvents(number === 1 ? `child-${calls}` : "fork-report");
				for (const value of events) yield { text: JSON.stringify(value), value };
			},
			async interrupt() { interrupted.push(number); return { acknowledged: true as const, completed: false }; },
			async close() { open = false; closed.push(number); },
		} as any;
	};
	return { connect, sent, closed, interrupted, forkStarted };
}

for (const mode of ["text", "tool", "error", "network"] as const) test(`fork ${mode}: separate socket and ledger, immutable prefix, no callbacks or child effects`, async () => {
	const socket = sockets(mode);
	const state = ledger();
	const child = new CodexThreadTransport({ identity: IDENTITY, store: await store(), history: state.history, dependencies: { connect: socket.connect } });
	let hooks = 0;
	try {
		const answer = await child.stream(MODEL, SOURCE, { reasoning: "medium", serviceTier: "priority", onPayload: () => { hooks++; }, onResponse: () => { hooks++; }, onProviderStreamEvent: () => { hooks++; } }).result();
		const context = { messages: [...normalizeContext(SOURCE).messages, answer, reportTail()] } as Context;
		const original = structuredClone(state.bodies[0]);
		const writes = state.writes();
		const beforeLedger = structuredClone(state.outputs);
		const hooksBefore = hooks;
		const infer = child.contextFork(request(context));
		assert.ok(infer);
		assert.equal(socket.sent.length, 1, "capture sends nothing");
		context.messages.at(-1)!.content = "MUTATED AFTER CAPTURE" as never;
		if (mode === "error" || mode === "network") await assert.rejects(infer());
		else {
			const result = await infer();
			assert.equal(result.stopReason, mode === "tool" ? "toolUse" : "stop");
			assert.equal(result.usage.cacheRead, 7);
		}
		assert.equal(state.writes(), writes, "no source history callback");
		assert.deepEqual(state.outputs, beforeLedger);
		assert.equal(hooks, hooksBefore, "no source session callbacks");
		assert.equal(socket.sent.length, 2, "one fork request, no tool loop or retry");
		const fork = socket.sent[1].body;
		assert.notEqual(socket.sent[1].socket, socket.sent[0].socket);
		assert.equal(fork.previous_response_id, undefined, "new socket gets full input");
		assert.deepEqual(fork.input.slice(0, original.input.length), original.input, "native prefix IDs, tools and history identical");
		for (const key of ["model", "reasoning", "tools", "tool_choice", "parallel_tool_calls", "prompt_cache_key", "service_tier"]) assert.deepEqual(fork[key], original[key], key);
		assert.equal(fork.input.at(-2).id, "msg_child-1", "completed raw output reused verbatim");
		assert.equal(fork.input.at(-1).content[0].text, reportTail().content, "tail frozen synchronously");
		assert.deepEqual(socket.closed, [2], "only fork socket closed");
		await assert.rejects(infer(), /one-shot/);
		const next = { ...SOURCE, messages: [...SOURCE.messages, answer, { role: "user", content: "continue", timestamp: 3 }] } as Context;
		await child.stream(MODEL, next, { reasoning: "medium", serviceTier: "priority" }).result();
		assert.equal(socket.sent.at(-1)!.socket, 1, "child socket still live");
		assert.equal(socket.sent.at(-1)!.body.previous_response_id, "child-1", "fork did not change child's continuation");
		assert.equal(JSON.stringify(socket.sent.at(-1)!.body).includes("fork-report"), false);
	} finally { child.dispose(); }
});

for (const reason of ["abort", "timeout"] as const) test(`${reason} during fork closes only fork; child continues on its existing socket`, async () => {
	const started = deferred();
	const unblock = deferred();
	const state = ledger();
	const socket = sockets();
	const baseConnect = socket.connect;
	let number = 0;
	const connect = async (options: any) => {
		const result = await baseConnect();
		number++;
		if (number === 2) result.events = async function* () { started.resolve(); await unblock.promise; };
		return result;
	};
	const child = new CodexThreadTransport({ identity: IDENTITY, store: await store(), history: state.history, dependencies: { connect } });
	try {
		const answer = await child.stream(MODEL, SOURCE).result();
		const abort = new AbortController();
		const infer = child.contextFork(request({ messages: [...normalizeContext(SOURCE).messages, answer, reportTail()] } as Context, abort.signal))!;
		const before = state.writes();
		const pending = infer();
		await started.promise;
		abort.abort(reason === "timeout" ? new DOMException("Report deadline", "TimeoutError") : undefined);
		await assert.rejects(pending, /abort|deadline/i);
		unblock.resolve();
		assert.equal(state.writes(), before);
		assert.equal(socket.closed.includes(1), false);
		assert.equal(socket.closed.includes(2), true);
		assert.equal(socket.interrupted.includes(1), false);
		await child.stream(MODEL, { ...SOURCE, messages: [...SOURCE.messages, answer, { role: "user", content: "continue", timestamp: 3 }] } as Context).result();
		assert.equal(socket.sent.at(-1)!.socket, 1);
		assert.equal(socket.sent.at(-1)!.body.previous_response_id, "child-1");
	} finally { unblock.resolve(); child.dispose(); }
});

test("native SSE idle timeout expires without external abort and only retires the fork", async (t) => {
	const reading = deferred();
	const childAbort = new AbortController();
	const forkAbort = new AbortController();
	const state = ledger();
	let requests = 0;
	let canceled = 0;
	const child = new CodexThreadTransport({ identity: IDENTITY, store: await store(), history: state.history, dependencies: {
		connect: async () => { throw new SocketError(426, {}, "upgrade required", "upgrade-rejected"); },
		fetch: async () => {
			requests++;
			const body = requests === 2 ? new ReadableStream({ pull() { reading.resolve(); }, cancel() { canceled++; } }, { highWaterMark: 0 }) :
				textEvents(`child-${requests}`).map(event => `data: ${JSON.stringify(event)}\n\n`).join("");
			return new Response(body, { headers: { "content-type": "text/event-stream" } });
		},
	} });
	try {
		const answer = await child.stream(MODEL, SOURCE, { signal: childAbort.signal }).result();
		const before = state.writes();
		const originalLedger = structuredClone(state.outputs);
		const infer = child.contextFork(request({ messages: [...normalizeContext(SOURCE).messages, answer, reportTail()] } as Context, forkAbort.signal))!;
		t.mock.timers.enable({ apis: ["setTimeout"] });
		let settled = false;
		const pending = infer().finally(() => { settled = true; });
		await reading.promise;
		t.mock.timers.tick(SSE_IDLE_TIMEOUT_MS - 1);
		assert.equal(settled, false, "native idle deadline has not expired");
		t.mock.timers.tick(1);
		await assert.rejects(pending, error => error instanceof CodexError && error.kind === "stream_failed");
		assert.equal(childAbort.signal.aborted, false);
		assert.equal(forkAbort.signal.aborted, false, "the provider's own idle timer expired");
		assert.equal(requests, 2, "no timeout retry");
		assert.equal(canceled, 1, "only fork response body is canceled");
		assert.equal(state.writes(), before);
		assert.deepEqual(state.outputs, originalLedger);
		t.mock.timers.reset();
		const next = { ...SOURCE, messages: [...SOURCE.messages, answer, { role: "user", content: "continue", timestamp: 3 }] } as Context;
		assert.equal((await child.stream(MODEL, next, { signal: childAbort.signal }).result()).stopReason, "stop");
		assert.equal(requests, 3, "the next child request runs normally");
	} finally { t.mock.timers.reset(); child.dispose(); }
});

test("capture is immutable while child advances; abort before inference creates no connection", async () => {
	const socket = sockets();
	const child = new CodexThreadTransport({ identity: IDENTITY, store: await store(), dependencies: { connect: socket.connect } });
	try {
		assert.equal(child.contextFork(request(SOURCE)), undefined, "no prepared cache means no offer or request");
		const answer = await child.stream(MODEL, SOURCE).result();
		const context = { messages: [...normalizeContext(SOURCE).messages, answer, reportTail()] } as Context;
		const infer = child.contextFork(request(context))!;
		const abort = new AbortController();
		const canceled = child.contextFork(request(context, abort.signal))!;
		abort.abort();
		await assert.rejects(canceled());
		assert.equal(socket.sent.length, 1);
		await child.stream(MODEL, { ...SOURCE, messages: [...SOURCE.messages, answer, { role: "user", content: "NEW CHILD TURN", timestamp: 4 }] } as Context).result();
		await infer();
		assert.equal(JSON.stringify(socket.sent.at(-1)!.body).includes("NEW CHILD TURN"), false);
		assert.equal(socket.sent.at(-1)!.body.previous_response_id, undefined);
	} finally { child.dispose(); }
});

test("a cache miss is a normal fork result, with no retry or child mutation", async () => {
	const socket = sockets();
	const state = ledger();
	let connections = 0;
	const connect = async () => {
		const result = await socket.connect();
		if (++connections === 2) {
			const events = result.events.bind(result);
			result.events = async function* () {
				for await (const event of events()) {
					if (event.value.type === "response.completed") event.value.response.usage = { ...usage, input_tokens_details: { cached_tokens: 0 } };
					yield event;
				}
			};
		}
		return result;
	};
	const child = new CodexThreadTransport({ identity: IDENTITY, store: await store(), history: state.history, dependencies: { connect } });
	try {
		const answer = await child.stream(MODEL, SOURCE).result();
		const before = state.writes();
		const result = await child.contextFork(request({ messages: [...normalizeContext(SOURCE).messages, answer, reportTail()] } as Context))!();
		assert.equal(result.stopReason, "stop");
		assert.equal(result.usage.cacheRead, 0);
		assert.equal(socket.sent.length, 2, "cache miss causes no retry");
		assert.equal(state.writes(), before);
		assert.deepEqual(socket.closed, [2]);
	} finally { child.dispose(); }
});

test("mutable currentContext pending response does not enter the captured native request prefix", async () => {
	const socket = sockets("text", true);
	const mutable = structuredClone(normalizeContext(SOURCE));
	const consumerSnapshot = structuredClone(mutable);
	const child = new CodexThreadTransport({ identity: IDENTITY, store: await store(), dependencies: { connect: socket.connect } });
	try {
		const pending = await child.stream(MODEL, mutable).result();
		assert.equal(pending.stopReason, "toolUse");
		// Pi may append the response to its request array before the completed tool results exist.
		mutable.messages.push(pending);
		const infer = child.contextFork(request({ messages: [...consumerSnapshot.messages, reportTail()] } as Context));
		assert.ok(infer, "consumer froze the request context before its pending array changed");
		assert.equal(child.contextFork(request({ messages: [...mutable.messages, reportTail()] } as Context)), undefined, "no request after dangling native tool calls");
		await infer();
		const fork = socket.sent.at(-1)!.body;
		assert.deepEqual(fork.input.slice(0, -1), socket.sent[0].body.input);
		assert.equal(fork.input.some((item: any) => item.type === "function_call" || item.type === "function_call_output"), false, "no pending call or invented result");
		assert.equal(fork.input.at(-1).content[0].text, reportTail().content);
	} finally { child.dispose(); }
});

test("pending calls, hosted declarations, changed prefix/model and rewrites are not offered", () => {
	const capabilities = wireCapabilities(MODEL);
	const body = buildRequest({ model: MODEL, context: SOURCE, capabilities, identity: IDENTITY });
	const context = { messages: [...normalizeContext(SOURCE).messages, reportTail()] } as Context;
	const prepare = (native = body, ctx = context, model = MODEL) => prepareContextFork({ turn: { model: MODEL, context: SOURCE, body: native as any }, request: { ...request(ctx), model }, identity: IDENTITY, capabilities, rawOutputs: new Map() });
	assert.ok(prepare(), "textual observation of pending response is valid, no invented results");
	assert.equal(prepare({ ...body, input: [...body.input, { type: "function_call", call_id: "unpaired", name: "lookup", arguments: "{}" }] }), undefined);
	assert.equal(prepare({ ...body, tools: [{ type: "web_search" }] }), undefined);
	assert.equal(prepare({ ...body, input: [{ type: "additional_tools", tools: [{ type: "namespace", tools: [{ type: "web_search" }] }] }] }), undefined);
	assert.equal(prepare(body, { ...context, messages: [{ role: "system", content: "different", timestamp: 0 }, ...context.messages.slice(1)] } as Context), undefined);
	assert.equal(prepare(body, context, { ...MODEL, id: "gpt-6-luna" }), undefined);
	assert.equal(prepare(body, { ...context, messages: [context.messages[0], reportTail()] } as Context), undefined);
	assert.equal(body.input.some(item => item.call_id === "unpaired"), false);
});

test("real extension event offer is synchronous and one-shot, with no session entries, callbacks or executor", async () => {
	const root = mkdtempSync(join(tmpdir(), "rqw-context-fork-"));
	const saved = await store();
	const runtime = await ModelRuntime.create({ credentials: saved, modelsPath: null, refreshOnCreate: false });
	let bus!: ExtensionAPI;
	let source!: Context;
	let callbacks = 0;
	const posts: any[] = [];
	const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		extensionFactories: [createCodexExtension({ installationId: IDENTITY.installationId, dependencies: {
			collectWorkspaceMetadata: async () => ({}),
			connect: async () => { throw new SocketError(426, {}, "upgrade required", "upgrade-rejected"); },
			postEvents: ((options: any) => {
				posts.push(JSON.parse(zstdDecompressSync(options.body).toString()));
				return (async function* () { options.onResponse({ status: 200, headers: {} }); for (const value of posts.length === 1 ? textEvents("source") : callEvents("report")) yield { text: JSON.stringify(value), value }; })();
			}) as any,
		} }), (pi) => { bus = pi; pi.on("context_with_system", event => { source = structuredClone({ messages: event.messages }) as Context; }); pi.on("before_provider_request", () => { callbacks++; }); }],
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime, model: MODEL, thinkingLevel: "low", resourceLoader: loader,
		sessionManager: SessionManager.inMemory(root), settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }) });
	try {
		await session.bindExtensions({ mode: "tui" });
		await session.prompt("work");
		const before = structuredClone(session.sessionManager.getEntries());
		const callbackCount = callbacks;
		let infer: (() => Promise<AssistantMessage>) | undefined;
		bus.events.emit(CONTEXT_FORK_CHANNEL, { sessionId: session.sessionId, model: MODEL, context: { messages: [...source.messages, session.messages.at(-1), reportTail()] }, signal: new AbortController().signal, offer(run) { infer = run; } } as ContextForkRequest);
		assert.ok(infer, "offer returned before emit completed");
		assert.equal(posts.length, 1, "no inference inside event handler");
		const message = await infer();
		assert.equal(message.stopReason, "toolUse", "tool request is returned, never executed");
		assert.equal(posts.length, 2);
		assert.equal(callbacks, callbackCount);
		assert.deepEqual(session.sessionManager.getEntries(), before, "no Pi or durable wire history writes");
		assert.equal(session.messages.at(-1)!.role, "assistant");
		assert.equal(posts[1].prompt_cache_key, posts[0].prompt_cache_key);
		assert.deepEqual(posts[1].input.slice(0, posts[0].input.length), posts[0].input);
		let unsupported = false;
		bus.events.emit(CONTEXT_FORK_CHANNEL, { ...request(SOURCE), sessionId: "unknown", offer() { unsupported = true; } });
		assert.equal(unsupported, false);
	} finally { session.dispose(); rmSync(root, { recursive: true, force: true }); }
});
