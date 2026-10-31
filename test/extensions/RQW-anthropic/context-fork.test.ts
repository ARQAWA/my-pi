import assert from "node:assert/strict";
import { it } from "node:test";
import { InMemoryCredentialStore, normalizeContext, type Api, type AssistantMessage, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { TOKEN_URL } from "../../../extensions/RQW-anthropic/auth.ts";
import { contextForks, type ContextForkRequest } from "../../../extensions/RQW-anthropic/context-fork.ts";
import { createOverlay } from "../../../extensions/RQW-anthropic/transport.ts";

const SESSION = "main";
const MODEL = { id: "claude-test", provider: "anthropic", api: "anthropic-messages", baseUrl: "https://api.anthropic.com" } as unknown as Model<Api>;
const ANSWER = { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" } as unknown as AssistantMessage;
const LOCAL_TOOL = { name: "read", input_schema: { type: "object" } };
const HOSTED_TOOL = { type: "web_search_20250305", name: "web_search" };

const user = (text: string) => ({ role: "user" as const, content: text, timestamp: 1 });
const history = (count: number): Context => ({ messages: Array.from({ length: count }, (_, i) => user(`message ${i}`)) });
const wire = (context: Context, tools: unknown[]) => ({
	system: [{ type: "text", text: "system" }], tools,
	messages: context.messages.map(message => ({ role: "user", content: [{ type: "text", text: message.content, cache_control: { type: "ephemeral" } }] })),
});

/** The provider boundary: the stream builds its payload from the forked context and runs the hook, nothing goes to a network. */
function setup(source: Context, tools: unknown[] = [LOCAL_TOOL]) {
	const payloads: unknown[] = [];
	const gates: Array<() => void> = [];
	const pause = () => new Promise<void>(resolve => { gates.push(resolve); });
	const stream = (_model: Model<Api>, context: Context, options?: SimpleStreamOptions) => ({
		async result() {
			payloads.push(await options?.onPayload?.(wire(context, [LOCAL_TOOL]), _model));
			return ANSWER;
		},
	});
	const forks = contextForks(() => stream, pause);
	forks.registerSource(SESSION);
	forks.capture(MODEL, source, { sessionId: SESSION, apiKey: "key" } as SimpleStreamOptions, JSON.stringify(wire(source, tools)));
	return { forks, payloads, gates };
}

function request(context: Context, extra: Partial<ContextForkRequest> = {}) {
	const abort = new AbortController();
	const offered: Array<() => Promise<AssistantMessage>> = [];
	const declined: string[] = [];
	const value: ContextForkRequest = {
		sessionId: SESSION, model: MODEL, context, signal: abort.signal,
		decline: reason => { declined.push(reason); }, offer: infer => { offered.push(infer); }, ...extra,
	};
	return { value, offered, declined, abort };
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

it("a cooperative fork is offered at once and prepares in slices, serving the caller between them", async () => {
	const source = history(40);
	const { forks, payloads, gates } = setup(source);
	const next = { messages: [...source.messages, user("report")] };
	const frozen = structuredClone(next);
	const call = request(next, { cooperative: true });
	forks.offer(call.value);
	assert.equal(call.offered.length, 1);
	assert.equal(gates.length, 0, "nothing is prepared before the consumer asks");
	const done = call.offered[0]!();
	assert.equal(gates.length, 1, "the first slice ends with control returned to the caller");
	assert.equal(payloads.length, 0);
	let released = 1;
	while (payloads.length === 0) {
		gates.splice(0).forEach(open => open());
		await settle();
		if (++released > 50) assert.fail("preparation never finished");
	}
	assert.equal(await done, ANSWER);
	assert.ok(released > 3, "a large context needs several slices");
	assert.deepEqual(next, frozen, "the source context is never changed");
	assert.equal(((payloads[0] as { messages: unknown[] }).messages).length, 41);
});

it("an abort between slices stops a cooperative fork before anything is sent", async () => {
	const source = history(40);
	const { forks, payloads, gates } = setup(source);
	const call = request({ messages: [...source.messages, user("report")] }, { cooperative: true });
	forks.offer(call.value);
	const done = call.offered[0]!();
	call.abort.abort();
	gates.splice(0).forEach(open => open());
	await assert.rejects(done, { name: "AbortError" });
	assert.equal(payloads.length, 0);
});

for (const cooperative of [false, true]) {
	it(`hosted tools are declined for good before any request (cooperative: ${cooperative})`, () => {
		const source = history(3);
		const { forks, gates } = setup(source, [HOSTED_TOOL]);
		const call = request({ messages: [...source.messages, user("report")] }, { cooperative });
		forks.offer(call.value);
		assert.deepEqual(call.declined, ["unsupported_hosted_tools"]);
		assert.equal(call.offered.length, 0);
		assert.equal(gates.length, 0);
	});
}

it("a request that does not extend its source is no offer and no decline, so the plain path stays open", () => {
	const source = history(3);
	const { forks } = setup(source);
	const changed = { messages: [source.messages[0]!, user("edited"), source.messages[2]!, user("report")] };
	const call = request(changed);
	forks.offer(call.value);
	assert.equal(call.offered.length, 0);
	assert.deepEqual(call.declined, []);
});

it("a cooperative fork that does not extend its source rejects as unavailable, before any request, and is one-shot", async () => {
	const source = history(3);
	const { forks, payloads, gates } = setup(source);
	const call = request({ messages: [source.messages[0]!, user("edited"), source.messages[2]!, user("report")] }, { cooperative: true });
	forks.offer(call.value);
	assert.equal(call.offered.length, 1);
	const failed = call.offered[0]!();
	gates.splice(0).forEach(open => open());
	await assert.rejects(failed, { name: "ContextForkUnavailable", reason: "context_mismatch" });
	await assert.rejects(call.offered[0]!(), /already consumed/);
	assert.equal(payloads.length, 0, "no second attempt is made");
});

it("a cooperative fork over an unanswered tool call rejects as unavailable, so the caller can use its own path", async () => {
	const source = history(3);
	const { forks, payloads, gates } = setup(source);
	const call = { role: "assistant" as const, content: [{ type: "toolCall" as const, id: "call-1", name: "read", arguments: {} }] } as never;
	const call2 = request({ messages: [...source.messages, call, user("report")] }, { cooperative: true });
	forks.offer(call2.value);
	const failed = call2.offered[0]!();
	gates.splice(0).forEach(open => open());
	await assert.rejects(failed, { name: "ContextForkUnavailable", reason: "unfinished_tool_calls" });
	assert.equal(payloads.length, 0);
});

// Messages that count every read of their role: the walk of a large history must be cut into small slices.
function counted(count: number, reads: { total: number }): Context {
	return { messages: Array.from({ length: count }, (_, i) => {
		const message = { content: `message ${i}`, timestamp: 1 };
		return Object.defineProperty(message, "role", { enumerable: true, get() { reads.total++; return "user"; } }) as never;
	}) };
}

it("on a large history no walk runs before the first pause, and every later step stays small", async () => {
	const reads = { total: 0 };
	const source = counted(400, reads);
	const { forks, payloads, gates } = setup(source);
	const next = { messages: [...source.messages, user("report")] };
	reads.total = 0;
	const call = request(next, { cooperative: true });
	forks.offer(call.value);
	assert.equal(reads.total, 0, "offering only looks at the length");
	const done = call.offered[0]!();
	let largest = 0;
	let last = 0;
	let rounds = 0;
	while (payloads.length === 0) {
		largest = Math.max(largest, reads.total - last);
		last = reads.total;
		gates.splice(0).forEach(open => open());
		await new Promise<void>(resolve => setImmediate(resolve));
		if (++rounds > 200) assert.fail("preparation never finished");
	}
	await done;
	assert.ok(rounds > 10, "the history is walked over many steps");
	assert.ok(largest * 10 < 400, `a step touched ${largest} of 400 messages`);
});

// Network boundary: a scripted Anthropic endpoint counting every inference request and every token refresh.
const base = builtinProviders().find(provider => provider.id === "anthropic")!;
const real = base.getModels()[0]!;
const OLD = "sk-ant-oat01-fake-old";
const sse = () => new Response([
	{ type: "message_start", message: { id: "fake", model: real.id, usage: { input_tokens: 1, output_tokens: 0 } } },
	{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }, { type: "message_stop" },
].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
const versionTooOld = () => Response.json({ type: "error", error: { type: "invalid_request_error", message: "claude_code_version_too_old: version 2.2.0 or newer is required" } }, { status: 400 });

async function rejectedFork(rejection: () => Response, cooperative: boolean) {
	const counts = { inference: 0, refresh: 0 };
	let rejecting = false;
	const transport = async (input: unknown) => {
		if (String(input) === TOKEN_URL) { counts.refresh++; return Response.json({ access_token: "sk-ant-oat01-fake-new", refresh_token: "fake-rotated", expires_in: 3600 }); }
		counts.inference++;
		// Only the first request of the fork is rejected; a second one would succeed and show up in the count.
		return rejecting && counts.inference === 2 ? rejection() : sse();
	};
	const store = new InMemoryCredentialStore();
	await store.modify("anthropic", async () => ({ type: "oauth", access: OLD, refresh: "fake-refresh", expires: 4_102_444_800_000 }));
	const overlay = createOverlay(base, () => store, "device");
	overlay.forks.registerSource("source");
	const context = normalizeContext({ messages: [user("hello")] });
	await overlay.streamSimple(real, context, { apiKey: OLD, sessionId: "source", fetch: transport } as unknown as SimpleStreamOptions).result();
	rejecting = true;
	let infer: (() => Promise<unknown>) | undefined;
	overlay.forks.offer({ sessionId: "source", model: real, cooperative, context: { messages: [...context.messages, user("report")] },
		signal: new AbortController().signal, offer: next => { infer = next; } });
	await infer!().catch(() => undefined);
	return counts;
}

for (const [name, rejection] of [["401", () => new Response("expired", { status: 401 })], ["400 version error", versionTooOld]] as const) {
	it(`a cooperative fork never sends its request again after a ${name}`, async () => {
		const counts = await rejectedFork(rejection, true);
		assert.deepEqual(counts, { inference: 2, refresh: 0 });
	});

	it(`a plain fork still repeats after a ${name}`, async () => {
		const counts = await rejectedFork(rejection, false);
		assert.equal(counts.inference, 3);
	});
}
