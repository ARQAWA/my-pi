import assert from "node:assert/strict";
import { it } from "node:test";
import { InMemoryCredentialStore, normalizeContext, type Api, type Context, type Model } from "@earendil-works/pi-ai";
import type { ContextForkRequest } from "../../../extensions/RQW-codex/context-fork.ts";
import { CodexThreadTransport, type RawItemHistory } from "../../../extensions/RQW-codex/transport.ts";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";

const ACCOUNT = "acct_test_1";
const IDENTITY = { installationId: "11111111-2222-4333-8444-555555555555", windowId: "11111111-2222-4333-8444-555555555555:0", rootSessionId: "root-session-1", threadId: "thread-1" };
const MODEL = { id: "gpt-6-luna", name: "GPT-6-Luna", api: "openai-codex-responses", provider: "openai-codex", baseUrl: "https://chatgpt.com/backend-api", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 500000, maxTokens: 100000, thinkingLevelMap: {} } as unknown as Model<Api>;
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const access = (tag = "") => `${b64({ alg: "none" })}.${b64({ exp: 4_000_000_000, tag, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;

const user = (text: string) => ({ role: "user" as const, content: text, timestamp: 1 });
const history = (count: number): Context => ({ systemPrompt: "Be brief.", tools: [], messages: Array.from({ length: count }, (_, i) => user(`message ${i}`)) });

const answer = (id: string): Record<string, unknown>[] => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", content: [], status: "in_progress" } },
	{ type: "response.output_text.delta", item_id: `msg_${id}`, output_index: 0, content_index: 0, delta: "ok" },
	{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: "ok", annotations: [] }] } },
	{ type: "response.completed", response: { id, status: "completed", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
];

/** Network boundary only: scripted sockets that record every request sent. */
function sockets(replies: Record<string, unknown>[][]) {
	const sent: any[] = [];
	const attempts = { connects: 0, failures: [] as Error[] };
	const connect = async () => {
		attempts.connects++;
		const failure = attempts.failures.shift();
		if (failure) throw failure;
		let current: unknown[] = [];
		return {
			isOpen: true, socketIdentity: `socket-${sent.length}`,
			events: () => (async function* () { for (const value of current) yield { text: JSON.stringify(value), value }; })(),
			async send(object: unknown) { sent.push(object); current = replies.shift() ?? []; },
			async interrupt() { return { acknowledged: true as const, completed: false }; },
			async close() {},
		} as any;
	};
	return { sent, attempts, connect: connect as any };
}

/** A transport that has completed one turn, so its prepared request is the fork source. */
async function started(source: Context, hook?: (body: any) => unknown, extra: { replies?: Record<string, unknown>[][]; history?: RawItemHistory; fetch?: any } = {}) {
	const store = new InMemoryCredentialStore();
	await store.modify("openai-codex", async () => ({ type: "oauth", access: access(), refresh: "refresh-1", expires: 4_000_000_000_000, accountId: ACCOUNT }) as never);
	const wire = sockets(extra.replies ?? [answer("resp_main"), answer("resp_fork")]);
	const gates: Array<() => void> = [];
	const pause = () => new Promise<void>((resolve) => { gates.push(resolve); });
	const transport = new CodexThreadTransport({ identity: IDENTITY, store, history: extra.history, dependencies: {
		clock: { now: () => 1_000_000 }, random: () => 0.5, sleep: async () => {}, connect: wire.connect, pause, fetch: extra.fetch } });
	const events = transport.stream(MODEL, source, hook ? { onPayload: hook } as any : undefined);
	for await (const event of events) void event;
	return { transport, wire, gates };
}

function request(context: Context, extra: Partial<ContextForkRequest> = {}) {
	const abort = new AbortController();
	const offered: Array<() => Promise<unknown>> = [];
	const declined: string[] = [];
	const value: ContextForkRequest = {
		sessionId: IDENTITY.threadId, model: MODEL, context, signal: abort.signal,
		decline: (reason) => { declined.push(reason); }, offer: (infer) => { offered.push(infer); }, ...extra,
	};
	return { value, offered, declined, abort };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const extend = (source: Context, text: string): Context => ({ messages: [...normalizeContext(source).messages, user(text)] });

it("a cooperative fork is offered at once and prepares in slices, sending only when done", async () => {
	const source = history(40);
	const { transport, wire, gates } = await started(source);
	const next = extend(source, "report");
	const frozen = structuredClone(next);
	const call = request(next, { cooperative: true });
	const infer = transport.contextFork(call.value);
	assert.ok(infer, "the fork is offered synchronously");
	assert.equal(gates.length, 0, "nothing is prepared before the consumer asks");
	const done = infer();
	assert.equal(gates.length, 1, "the first slice ends with control returned to the caller");
	assert.equal(wire.sent.length, 1);
	let rounds = 0;
	while (wire.sent.length < 2) {
		gates.splice(0).forEach((open) => open());
		await settle();
		if (++rounds > 60) assert.fail("preparation never finished");
	}
	assert.equal(((await done) as { stopReason: string }).stopReason, "stop");
	assert.ok(rounds > 3, "a large context needs several slices");
	assert.deepEqual(next, frozen, "the source context is never changed");
	const [main, fork] = wire.sent;
	assert.deepEqual(fork.input.slice(0, main.input.length), main.input, "the prepared native prefix is kept as sent");
	assert.equal(fork.input.at(-1).content[0].text, "report");
	assert.equal(fork.previous_response_id, undefined);
	transport.dispose();
});

it("an abort between slices stops a cooperative fork before anything is sent", async () => {
	const source = history(40);
	const { transport, wire, gates } = await started(source);
	const call = request(extend(source, "report"), { cooperative: true });
	const done = transport.contextFork(call.value)!();
	call.abort.abort();
	gates.splice(0).forEach((open) => open());
	await assert.rejects(done, { name: "AbortError" });
	assert.equal(wire.sent.length, 1);
	transport.dispose();
});

it("a plain fork keeps its old behavior: prepared at the offer, no slices", async () => {
	const source = history(40);
	const { transport, wire, gates } = await started(source);
	const call = request(extend(source, "report"));
	const infer = transport.contextFork(call.value)!;
	assert.equal(gates.length, 0);
	assert.equal(((await infer()) as { stopReason: string }).stopReason, "stop");
	assert.equal(wire.sent.length, 2);
	transport.dispose();
});

for (const cooperative of [false, true]) {
	it(`a source with hosted tools is declined for good before any request (cooperative: ${cooperative})`, async () => {
		const source = history(3);
		const { transport, wire, gates } = await started(source, (body) => ({ ...body, tools: [...(body.tools ?? []), { type: "web_search" }] }));
		const call = request(extend(source, "report"), { cooperative });
		assert.equal(transport.contextFork(call.value), undefined);
		assert.deepEqual(call.declined, ["unsupported_hosted_tools"]);
		assert.equal(gates.length, 0);
		assert.equal(wire.sent.length, 1);
		transport.dispose();
	});
}

it("a request that does not extend its source is no offer and no decline, so the plain path stays open", async () => {
	const source = history(3);
	const { transport } = await started(source);
	const messages = normalizeContext(source).messages;
	const call = request({ messages: [messages[0]!, user("edited"), messages[2]!, messages[3]!, user("report")] });
	assert.equal(transport.contextFork(call.value), undefined);
	assert.deepEqual(call.declined, []);
	transport.dispose();
});

it("a cooperative fork that does not extend its source rejects as unavailable, before any request, and is one-shot", async () => {
	const source = history(3);
	const { transport, wire, gates } = await started(source);
	const messages = normalizeContext(source).messages;
	const call = request({ messages: [messages[0]!, messages[1]!, user("edited"), messages[3]!, user("report")] }, { cooperative: true });
	const infer = transport.contextFork(call.value)!;
	const failed = infer();
	gates.splice(0).forEach((open) => open());
	await assert.rejects(failed, { name: "ContextForkUnavailable", reason: "context_mismatch" });
	await assert.rejects(infer(), /one-shot/);
	assert.equal(wire.sent.length, 1, "no second attempt is made");
	transport.dispose();
});

it("a cooperative fork over an unanswered tool call rejects as unavailable, so the caller can use its own path", async () => {
	const source = history(3);
	const { transport, wire, gates } = await started(source);
	const toolCall = { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }], stopReason: "toolUse", timestamp: 1 } as never;
	const call = request({ messages: [...normalizeContext(source).messages, toolCall, user("report")] }, { cooperative: true });
	const failed = assert.rejects(transport.contextFork(call.value)!(), { name: "ContextForkUnavailable", reason: "unfinished_tool_calls" });
	for (let round = 0; round < 3; round++) { gates.splice(0).forEach((open) => open()); await settle(); }
	await failed;
	assert.equal(wire.sent.length, 1);
	transport.dispose();
});

it("on a large history the fork reads only its new answers' raw items, in slices, and no walk is long", async () => {
	const source = history(300);
	const everything = new Map(Array.from({ length: 300 }, (_, i) => [`resp_old_${i}`, [{ type: "message", id: `old_${i}` }]])) as never as Map<string, never[]>;
	let forking = false;
	const wanted: Array<ReadonlySet<string>> = [];
	let binds = 0;
	const rawItem = { type: "message", id: "msg_new", role: "assistant", status: "completed", content: [{ type: "output_text", text: "RAW", annotations: [] }] };
	const rawHistory: RawItemHistory = {
		rawOutputs() { if (forking) throw new Error("a fork must not read every raw output"); return everything; },
		recordOutputs() {},
		bindRawOutputs() { binds++; return function* (ids) { wanted.push(ids); yield; yield; return new Map([["resp_new", [rawItem]]]) as never; }; },
	};
	const { transport, wire, gates } = await started(source, undefined, { history: rawHistory });
	forking = true;
	let touched = new Set<number>();
	const counted = normalizeContext(source).messages.map((message, index) => Object.defineProperty({ ...message }, "content", { enumerable: true, get() { touched.add(index); return (message as { content: unknown }).content; } }));
	const answerMessage = { role: "assistant", responseId: "resp_new", content: [{ type: "text", text: "RAW" }], stopReason: "stop", timestamp: 2 } as never;
	const call = request({ messages: [...counted, answerMessage, user("report")] } as Context, { cooperative: true });
	touched = new Set();
	const infer = transport.contextFork(call.value)!;
	assert.ok(infer, "offered");
	assert.equal(binds, 1, "the history to read is bound at the offer, not after the preparation");
	assert.equal(touched.size, 0, "offering reads no message content");
	const done = infer();
	let largest = 0, rounds = 0;
	while (wire.sent.length < 2) {
		largest = Math.max(largest, touched.size);
		touched = new Set();
		gates.splice(0).forEach((open) => open());
		await settle();
		if (++rounds > 400) assert.fail("preparation never finished");
	}
	await done;
	assert.deepEqual([...wanted[0]!], ["resp_new"]);
	assert.ok(rounds > 10, "a large history is walked over many steps");
	assert.ok(largest * 10 < 300, `a step touched ${largest} of 300 messages`);
	assert.ok(wire.sent[1].input.some((item: any) => item.id === "msg_new"), "the raw item of the new answer is used");
	transport.dispose();
});

it("a fork keeps the raw items of the offer moment when the source transport is disposed before the read", async () => {
	const source = history(3);
	const { transport, wire, gates } = await started(source);
	const reply = { role: "assistant", responseId: "resp_main", content: [{ type: "text", text: "ok" }], stopReason: "stop", timestamp: 2 } as never;
	const call = request({ messages: [...normalizeContext(source).messages, reply, user("report")] }, { cooperative: true });
	const infer = transport.contextFork(call.value)!;
	transport.dispose();
	const done = infer();
	while (wire.sent.length < 2) {
		gates.splice(0).forEach((open) => open());
		await settle();
	}
	await done;
	assert.ok(wire.sent[1].input.some((item: any) => item.id === "msg_resp_main"), "the raw item of the earlier answer is still replayed");
});

// Network boundary: a server answering 401, counting every connection attempt and every login refresh.
async function unauthorizedFork(cooperative: boolean) {
	let refreshes = 0;
	const fetch = async () => { refreshes++; return Response.json({ access_token: access("new"), refresh_token: "refresh-2" }); };
	const source = history(3);
	const { transport, wire } = await started(source, undefined, { fetch });
	const base = wire.attempts.connects;
	wire.attempts.failures.push(new SocketError(401, {}, "unauthorized", "upgrade-rejected"), new SocketError(401, {}, "unauthorized", "upgrade-rejected"));
	const infer = transport.contextFork(request(extend(source, "report"), { cooperative }).value)!;
	await infer().catch(() => undefined);
	transport.dispose();
	return { requests: wire.attempts.connects - base, refreshes };
}

it("a cooperative fork never sends its request again after a 401, and never refreshes the login for it", async () => {
	assert.deepEqual(await unauthorizedFork(true), { requests: 1, refreshes: 0 });
});

it("a plain fork still recovers and repeats after a 401", async () => {
	assert.deepEqual(await unauthorizedFork(false), { requests: 3, refreshes: 1 });
});
