import assert from "node:assert/strict";
import { it } from "node:test";
import { InMemoryCredentialStore, type Api, type Context, type Model } from "@earendil-works/pi-ai";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";
import { CodexThreadTransport } from "../../../extensions/RQW-codex/transport.ts";

const ACCOUNT = "acct_test_1";
const IDENTITY = { installationId: "11111111-2222-4333-8444-555555555555", windowId: "11111111-2222-4333-8444-555555555555:0", rootSessionId: "root-session-1", threadId: "thread-1" };
const MODEL = { id: "gpt-6-luna", name: "GPT-6-Luna", api: "openai-codex-responses", provider: "openai-codex", baseUrl: "https://chatgpt.com/backend-api", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 500000, maxTokens: 100000, thinkingLevelMap: {} } as unknown as Model<Api>;
const USER: Context = { systemPrompt: "Be brief.", messages: [{ role: "user", content: "hello", timestamp: 1 }], tools: [] };
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const access = (tag = "") => `${b64({ alg: "none" })}.${b64({ exp: 4_000_000_000, tag, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;

async function seededStore(token = access()) {
	const store = new InMemoryCredentialStore();
	await store.modify("openai-codex", async () => ({ type: "oauth", access: token, refresh: "refresh-1", expires: 4_000_000_000_000, accountId: ACCOUNT }) as never);
	return store;
}

const completed = (id: string, usage = rawUsage(10, 2)) => ({ type: "response.completed", response: { id, status: "completed", usage } });
const rawUsage = (input: number, output: number, cached = 0, reasoning = 0) => ({ input_tokens: input, output_tokens: output, total_tokens: input + output, input_tokens_details: { cached_tokens: cached }, output_tokens_details: { reasoning_tokens: reasoning } });
const textEvents = (id: string, text: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", content: [], status: "in_progress" } },
	{ type: "response.output_text.delta", item_id: `msg_${id}`, output_index: 0, content_index: 0, delta: text },
	{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
	completed(id),
];

async function collect(stream: AsyncIterable<Record<string, unknown>>): Promise<Record<string, unknown>[]> {
	const out: Record<string, unknown>[] = [];
	for await (const event of stream) out.push(event);
	return out;
}

function sseScript(scripts: Array<{ events?: unknown[]; error?: Error; status?: number }>) {
	const calls: { body: Uint8Array; headers: Record<string, string> }[] = [];
	const fn = (options: any) => {
		calls.push(options);
		const step = scripts.shift();
		if (!step) throw new Error("unexpected SSE request");
		return (async function* () {
			options.onResponse({ status: step.status ?? 200, headers: {} });
			if (step.error) throw step.error;
			for (const value of step.events ?? []) yield { text: JSON.stringify(value), value };
		})();
	};
	return { fn: fn as any, calls };
}

function fakeSockets(scripts: unknown[][][], connectErrors: Error[] = []) {
	const connects: number[] = [];
	const sent: any[] = [];
	const heads: Record<string, string>[] = [];
	const connect = async (options: any) => {
		connects.push(connects.length);
		heads.push(options.headers);
		const error = connectErrors.shift();
		if (error) throw error;
		let open = true;
		let current: unknown[] = [];
		return {
			get isOpen() { return open; },
			socketIdentity: `socket-${connects.length}`,
			events: () => (async function* () {
				for (const value of current) {
					if (value instanceof Error) throw value;
					yield { text: JSON.stringify(value), value };
				}
			})(),
			async send(object: unknown) { sent.push(object); current = (scripts.shift() ?? [])[0] ?? []; },
			async interrupt() { return { acknowledged: true as const, completed: false }; },
			async close() { open = false; },
		} as any;
	};
	return { connect: connect as any, connects, sent, heads };
}

const upgradeRequired = async (): Promise<never> => { throw new SocketError(426, {}, "upgrade required", "upgrade-rejected"); };
const timing = () => {
	const sleeps: number[] = [];
	return { sleeps, dependencies: { clock: { now: () => 1_000_000 }, random: () => 0.5, sleep: async (ms: number) => { sleeps.push(ms); } } };
};

it("SSE returns the completed assistant message", async () => {
	const sse = sseScript([{ events: textEvents("resp_sse", "Hi") }]);
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing().dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER));
	assert.equal(events.at(-1)?.type, "done");
	assert.deepEqual((events.at(-1) as any).message.content.map(({ type, text }: any) => ({ type, text })), [{ type: "text", text: "Hi" }]);
});

it("WebSocket returns text and ignores native unclassified wrappers", async () => {
	const script = textEvents("resp_ws", "ok");
	script.splice(-1, 0, { type: "error", status: 200, error: { code: "server_error" } }, { type: "error", error: { code: "server_error" } });
	const sockets = fakeSockets([[script]]);
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing().dependencies, connect: sockets.connect } });
	const events = await collect(transport.stream(MODEL, USER));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(events.some((event) => event.type === "error"), false);
	assert.equal(sockets.sent.length, 1);
});

it("regression: established WebSocket failures use finite retries then SSE fallback", async () => {
	const failure = () => new SocketError(undefined, {}, "established socket failed", "transport");
	const scripts = Array.from({ length: 6 }, () => [[failure()]]);
	const sockets = fakeSockets(scripts);
	const sse = sseScript([{ events: textEvents("resp_fallback", "recovered") }]);
	const clock = timing();
	const controller = new AbortController();
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...clock.dependencies,
		connect: async (options: any) => {
			if (sockets.connects.length === 6) controller.abort();
			return sockets.connect(options);
		}, postEvents: sse.fn } });
	const events = await collect(transport.stream(MODEL, USER, { signal: controller.signal } as any));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal((events.at(-1) as any).message.content[0].text, "recovered");
	assert.deepEqual(clock.sleeps, [200, 400, 800, 1600, 3200]);
	transport.dispose();
});

it("regression: WebSocket status_code 401 reloads then refreshes", async () => {
	const initial = access();
	const refreshed = access("new");
	const sockets = fakeSockets([
		[[{ type: "error", status_code: 401, error: { code: "server_error" } }]],
		[[{ type: "error", status: 401, error: { code: "server_error" } }]],
		[textEvents("resp_auth", "recovered")],
	]);
	let refreshes = 0;
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(initial), dependencies: { ...timing().dependencies, connect: sockets.connect,
		fetch: async () => { refreshes++; return Response.json({ access_token: refreshed, refresh_token: "refresh-2" }); },
		postEvents: () => { throw new Error("SSE fallback forbidden"); } } });
	const events = await collect(transport.stream(MODEL, USER));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(refreshes, 1);
	assert.deepEqual(sockets.heads.map((head) => head.Authorization ?? head.authorization), [`Bearer ${initial}`, `Bearer ${initial}`, `Bearer ${refreshed}`]);
});

it("regression: completed text survives a terminal error", async () => {
	const script = textEvents("resp_terminal", "COMPLETED");
	script[script.length - 1] = { type: "response.failed", response: { id: "resp_terminal", error: { code: "insufficient_quota", message: "secret" } } };
	const sse = sseScript([{ events: script }]);
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing().dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const terminal = (await collect(transport.stream(MODEL, USER))).at(-1) as any;
	assert.equal(terminal.type, "error");
	assert.deepEqual(terminal.error.content.map(({ type, text }: any) => ({ type, text })), [{ type: "text", text: "COMPLETED" }]);
	assert.equal(terminal.error.diagnostics[0].type, "rqw_codex_retry_owned");
});

it("regression: terminal failure after retry counts every attempt once", async () => {
	const sse = sseScript([
		{ events: [{ type: "response.created", response: { id: "r1" } }, { type: "response.incomplete", response: { id: "r1", incomplete_details: { reason: "content_filter" }, usage: rawUsage(11, 3, 4, 1) } }] },
		{ events: [{ type: "response.created", response: { id: "r2" } }, { type: "response.incomplete", response: { id: "r2", incomplete_details: { reason: "max_tokens_custom" }, usage: rawUsage(20, 5, 6, 2) } }] },
	]);
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing().dependencies, connect: upgradeRequired, postEvents: sse.fn } });
	const terminal = (await collect(transport.stream(MODEL, USER))).at(-1) as any;
	assert.equal(terminal.type, "error");
	assert.deepEqual(terminal.error.usage, { input: 21, output: 8, cacheRead: 10, cacheWrite: 0, reasoning: 3, totalTokens: 39, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
});

it("regression: caller abort returns one aborted terminal without real timers", async () => {
	const controller = new AbortController();
	const postEvents = (options: any) => {
		options.onResponse({ status: 200, headers: {} });
		return (async function* () {
			yield { text: "", value: { type: "response.created", response: { id: "resp_abort" } } };
			await new Promise<void>((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
		})();
	};
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing().dependencies, connect: upgradeRequired, postEvents: postEvents as any } });
	const pending = collect(transport.stream(MODEL, USER, { signal: controller.signal } as any));
	queueMicrotask(() => controller.abort());
	const events = await pending;
	const terminals = events.filter((event) => event.type === "done" || event.type === "error");
	assert.equal(terminals.length, 1);
	assert.equal((terminals[0] as any).reason, "aborted");
});

it("prewarm sends generate:false once and the first turn reuses the socket", async () => {
	const sockets = fakeSockets([[[{ type: "response.created", response: { id: "resp_pre" } }, completed("resp_pre")]], [textEvents("resp_real", "real")]]);
	const transport = new CodexThreadTransport({ identity: IDENTITY, store: await seededStore(), dependencies: { ...timing().dependencies, connect: sockets.connect } });
	await Promise.all([transport.prewarm(MODEL, USER), transport.prewarm(MODEL, USER)]);
	assert.equal(sockets.sent.length, 1);
	assert.equal(sockets.sent[0].generate, false);
	const events = await collect(transport.stream(MODEL, { ...USER, messages: [...USER.messages, { role: "user", content: "next", timestamp: 2 }] } as Context));
	assert.equal(events.at(-1)?.type, "done");
	assert.equal(sockets.connects.length, 1);
});
