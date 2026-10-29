import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import type { AgentSession, ExtensionAPI, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { createCodexExtension } from "../../../extensions/RQW-codex/index.ts";
import { SESSION_BIND } from "../../../extensions/RQW-codex/lifecycle.ts";
import { BACKGROUND_SUMMARY } from "../../../extensions/RQW-codex/session-compaction.ts";

import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { SESSION_POLICY_CHANNEL, type SessionPolicyRequest } from "../../../extensions/RQW-codex/registration.ts";

const SUMMARY_ID = "019a0000-0000-7000-8000-000000000001";
const ACCOUNT = "acct_test_1";
const EXPIRES = 2_000_000_000;
const ACCESS = `e30.${Buffer.from(JSON.stringify({ exp: EXPIRES, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })).toString("base64url")}.sig`;
const model = {
	id: "gpt-6-luna", name: "GPT-6-Luna", provider: "openai-codex", api: "openai-codex-responses",
	baseUrl: "https://chatgpt.com/backend-api", reasoning: true, input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 500000, maxTokens: 100000, thinkingLevelMap: {},
} as unknown as Model<Api>;
const releases: Array<() => void> = [];
afterEach(() => { for (const release of releases.splice(0)) release(); });

const summaryEvents = [
	{ type: "response.created", response: { id: "resp_sum" } },
	{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_sum", role: "assistant", content: [], status: "in_progress" } },
	{ type: "response.output_text.delta", item_id: "msg_sum", output_index: 0, content_index: 0, delta: "SUMMARY" },
	{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_sum", role: "assistant", status: "completed", content: [{ type: "output_text", text: "SUMMARY", annotations: [] }] } },
	{ type: "response.completed", response: { id: "resp_sum", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
];

/** Fake WebSocket network only: every connection answers each sent frame with one finished summary response. */
function fakeNetwork() {
	const sent: Array<{ connection: number; frame: unknown }> = [];
	let connections = 0;
	const connect = async (options: any) => {
		const connection = ++connections;
		options.onResponse?.({ status: 101, headers: {} });
		const state = { queue: [] as unknown[], open: true };
		return {
			get isOpen() { return state.open; },
			socketIdentity: `socket-${connection}`,
			events: () => (async function* () {
				while (state.queue.length) {
					const value = state.queue.shift();
					yield { text: JSON.stringify(value), value };
				}
			})(),
			async send(frame: unknown) { sent.push({ connection, frame }); state.queue.push(...summaryEvents); },
			async interrupt() { return { acknowledged: true as const, completed: false }; },
			async close() { state.open = false; },
		} as any;
	};
	return { sent, connect };
}

/** Fake Pi: handler registry per API object and an event bus; the session dispatch is simulated by `dispatch`. */
function setup(sessionModel: Model<Api> = model) {
	const makeApi = () => {
		const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
		const bus = new Map<string, Array<(event: unknown) => unknown>>();
		const api = {
			on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
				handlers.set(name, [...(handlers.get(name) ?? []), handler]);
				return () => handlers.set(name, (handlers.get(name) ?? []).filter((item) => item !== handler));
			},
			events: { on: (name: string, handler: (event: unknown) => unknown) => { bus.set(name, [...(bus.get(name) ?? []), handler]); return () => undefined; } },
		} as unknown as ExtensionAPI;
		return { api, handlers, bus };
	};
	const rootApi = makeApi();
	const store = new InMemoryCredentialStore();
	let config: { streamSimple(model: Model<Api>, context: unknown, options: unknown): any } | undefined;
	const noop = () => undefined;
	const runtime = {
		getAuth: noop, prepareRequest: noop, stream: noop, streamSimple: noop, composeProvider: noop,
		models: { getAuth: noop },
		credentials: store,
		getRegisteredProviderConfig: () => config,
		registerProvider: (_id: string, value: typeof config) => { config = value; },
		unregisterProvider: () => { config = undefined; },
	} as unknown as ModelRuntime;
	const makeSession = (sessionId: string) => {
		const entries: any[] = [];
		const sessionManager = {
			getHeader: () => null, getEntries: () => entries, getBranch: () => entries,
			getLeafId: () => entries.at(-1)?.id ?? null, getCwd: () => process.cwd(),
			buildSessionProjection: () => ({ entries: [], messages: [] }),
			appendCustomEntry(customType: string, data: unknown) {
				const entry = { type: "custom", customType, data, id: `entry-${entries.length + 1}`, parentId: entries.at(-1)?.id ?? null, timestamp: 1 };
				entries.push(entry);
				return entry;
			},
		};
		return { sessionId, modelRuntime: runtime, model: sessionModel, sessionManager,
			agent: { state: { tools: [] } }, _hiddenDeclarations: new Set(),
			subscribe: () => () => undefined, dispose: noop, _isRetryableError: () => false,
		} as unknown as AgentSession;
	};
	const session = makeSession("root");
	const network = fakeNetwork();
	createCodexExtension({
		installationId: "11111111-2222-4333-8444-555555555555",
		dependencies: { connect: network.connect as any, clock: { now: () => 1_000_000 }, random: () => 0.5, sleep: async () => {} },
	})(rootApi.api);
	releases.push(() => { for (const handler of rootApi.handlers.get("session_shutdown") ?? []) handler({}, {}); });
	for (const handler of rootApi.handlers.get(SESSION_BIND) ?? []) handler({ type: SESSION_BIND, session }, {});
	const dispatchOn = (api: ReturnType<typeof makeApi>, owner: AgentSession, signal: AbortSignal) => {
		for (const handler of api.handlers.get(BACKGROUND_SUMMARY) ?? []) handler({ type: BACKGROUND_SUMMARY, signal }, { model: owner.model, sessionManager: owner.sessionManager });
	};
	const dispatch = (signal: AbortSignal) => dispatchOn(rootApi, session, signal);
	/** Binds a child the way RQW-agent does: policy request on the bus, then hooks on the child's own API. */
	const bindChild = () => {
		const childApi = makeApi();
		const child = makeSession("child");
		const request = { session: child, parentThreadId: "root", kind: "collab_spawn" } as SessionPolicyRequest;
		for (const handler of rootApi.bus.get(SESSION_POLICY_CHANNEL) ?? []) handler(request);
		assert.equal(request.error, undefined);
		request.installCompactionHooks!(childApi.api);
		releases.push(() => request.release?.());
		return { dispatch: (signal: AbortSignal) => dispatchOn(childApi, child, signal), sessionId: child.sessionId };
	};
	const summary = (signal: AbortSignal) => config!.streamSimple(model, { messages: [{ role: "user", content: "summarize", timestamp: 1 }] }, { sessionId: SUMMARY_ID, cacheRetention: "none", signal });
	/** Awaits the routed summary to its final result; proves a real request went over the fake network. */
	const finish = async (signal: AbortSignal) => (await summary(signal).result()) as { content: Array<{ text?: string }> };
	const finishSession = async (sessionId: string) => (await config!.streamSimple(model, { messages: [{ role: "user", content: "hello", timestamp: 1 }] }, { sessionId }).result()) as { content: Array<{ text?: string }> };
	return { dispatch, bindChild, summary, finish, finishSession, network, store: async () => { await store.modify("openai-codex", async () => ({ type: "oauth", access: ACCESS, refresh: "refresh", expires: EXPIRES * 1000, accountId: ACCOUNT } as never)); } };
}

it("routes a registered background summary through the real request-local transport without a compaction", async () => {
	const { dispatch, finish, finishSession, network, store } = setup();
	await store();
	assert.equal((await finishSession("root")).content[0]?.text, "SUMMARY");
	const controller = new AbortController();
	dispatch(controller.signal);
	const result = await finish(controller.signal);
	assert.equal(result.content[0]?.text, "SUMMARY");
	assert.equal(network.sent.length, 2);
	assert.notEqual(network.sent[0].connection, network.sent[1].connection);
});

it("routes a background summary of a bound child session through the child's own hooks", async () => {
	const { bindChild, finish, finishSession, network, store } = setup();
	await store();
	const child = bindChild();
	assert.equal((await finishSession(child.sessionId)).content[0]?.text, "SUMMARY");
	const controller = new AbortController();
	child.dispatch(controller.signal);
	const result = await finish(controller.signal);
	assert.equal(result.content[0]?.text, "SUMMARY");
	assert.equal(network.sent.length, 2);
	assert.notEqual(network.sent[0].connection, network.sent[1].connection);
});

it("refuses a summary whose signal was never dispatched as a background summary", async () => {
	const { summary, network, store } = setup();
	await store();
	assert.throws(() => summary(new AbortController().signal), /no bound controller/);
	assert.equal(network.sent.length, 0);
});

it("releases the background route when its signal aborts", async () => {
	const { dispatch, summary, finish, network, store } = setup();
	await store();
	const controller = new AbortController();
	dispatch(controller.signal);
	assert.equal((await finish(controller.signal)).content[0]?.text, "SUMMARY");
	assert.equal(network.sent.length, 1);
	controller.abort();
	assert.throws(() => summary(controller.signal), /no bound controller/);
	assert.equal(network.sent.length, 1);
});

it("ignores the background dispatch of a session that is not on a Codex model", () => {
	const { dispatch, summary } = setup({ provider: "anthropic", api: "anthropic-messages" } as Model<Api>);
	const controller = new AbortController();
	dispatch(controller.signal);
	assert.throws(() => summary(controller.signal), /no bound controller/);
});
