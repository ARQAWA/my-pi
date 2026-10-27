import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryCredentialStore, type Api, type Context, type Model } from "@earendil-works/pi-ai";
import { CodexThreadTransport } from "../../../extensions/RQW-codex/transport.ts";

const ACCOUNT = "acct_test_1";
const OTHER_ACCOUNT = "acct_test_2";
const EXPIRES = 2_000_000_000;
const accessFor = (accountId: string) => {
	const token = Buffer.from(JSON.stringify({ exp: EXPIRES, "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url");
	return `e30.${token}.sig`;
};
const ACCESS = accessFor(ACCOUNT);
const IDENTITY = { installationId: "11111111-2222-4333-8444-555555555555", windowId: "window-1", rootSessionId: "root-1", threadId: "thread-1" };
const MODEL = {
	id: "gpt-6-luna", name: "GPT-6-Luna", api: "openai-codex-responses", provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api", reasoning: true, input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 500000, maxTokens: 100000, thinkingLevelMap: {},
} as unknown as Model<Api>;
const CONTEXT: Context = { systemPrompt: "Be brief.", messages: [{ role: "user", content: "hello", timestamp: 1 }], tools: [] };

function textEvents(id: string, text: string) {
	return [
		{ type: "response.created", response: { id } },
		{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", content: [], status: "in_progress" } },
		{ type: "response.output_text.delta", item_id: `msg_${id}`, output_index: 0, content_index: 0, delta: text },
		{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
		{ type: "response.completed", response: { id, status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
	];
}

/** Each fake socket retains unread events after close, exposing accidental reuse. */
function queueSockets(batches: unknown[][]) {
	const sockets: { queue: unknown[]; open: boolean }[] = [];
	const sent: unknown[] = [];
	return {
		sockets,
		sent,
		async connect(options: any) {
			options.onResponse?.({ status: 101, headers: {} });
			const record = { queue: [] as unknown[], open: true };
			sockets.push(record);
			return {
				get isOpen() { return record.open; },
				socketIdentity: `socket-${sockets.length}`,
				events: () => (async function* () {
					while (record.queue.length) {
						const value = record.queue.shift();
						yield { text: JSON.stringify(value), value };
					}
				})(),
				async send(frame: unknown) { sent.push(frame); record.queue.push(...batches.shift()!); },
				async interrupt() { return { acknowledged: true as const, completed: false }; },
				async close() { record.open = false; },
			} as any;
		},
	};
}

async function collect(stream: AsyncIterable<any>) {
	const events = [];
	for await (const event of stream) events.push(event);
	return events;
}

test("regression: refused WebSocket output never leaks into the next response", async () => {
	const ws = queueSockets([textEvents("stale", "STALE"), textEvents("fresh", "FRESH")]);
	const store = new InMemoryCredentialStore();
	await store.modify("openai-codex", async () => ({ type: "oauth", access: ACCESS, refresh: "refresh", expires: EXPIRES * 1000, accountId: ACCOUNT } as never));
	const transport = new CodexThreadTransport({ identity: IDENTITY, store, dependencies: {
		connect: ws.connect as any,
		clock: { now: () => 1_000_000 }, random: () => 0.5, sleep: async () => {},
	} });
	const first = await collect(transport.stream(MODEL, CONTEXT, {
		onProviderStreamEvent: (event: { type: string; delta?: string }) => {
			if (event.type === "response.output_text.delta" && event.delta === "STALE") throw new Error("hook refused");
		},
	} as any));
	assert.equal(first.at(-1)?.type, "error");
	assert.match(JSON.stringify(first.at(-1)), /onProviderStreamEvent hook failed/);

	const second = await collect(transport.stream(MODEL, { ...CONTEXT, messages: [...CONTEXT.messages, { role: "user", content: "again", timestamp: 2 }] } as Context));
	assert.equal(second.at(-1)?.type, "done");
	assert.match(JSON.stringify(second), /FRESH/);
	assert.doesNotMatch(JSON.stringify(second), /STALE/);
});

test("regression: an account switch during connect sends no frame", async () => {
	const ws = queueSockets([textEvents("old-account", "OLD")]);
	const store = new InMemoryCredentialStore();
	await store.modify("openai-codex", async () => ({ type: "oauth", access: ACCESS, refresh: "refresh", expires: EXPIRES * 1000, accountId: ACCOUNT } as never));
	const transport = new CodexThreadTransport({ identity: IDENTITY, store, dependencies: {
		connect: (async (options: any) => {
			const socket = await ws.connect(options);
			await store.modify("openai-codex", async () => ({ type: "oauth", access: accessFor(OTHER_ACCOUNT), refresh: "refresh", expires: EXPIRES * 1000, accountId: OTHER_ACCOUNT } as never));
			return socket;
		}) as any,
		clock: { now: () => 1_000_000 }, random: () => 0.5, sleep: async () => {},
	} });
	const events = await collect(transport.stream(MODEL, CONTEXT));
	assert.equal(events.at(-1)?.type, "error");
	assert.match(JSON.stringify(events.at(-1)), /changed while the request was prepared/);
	assert.equal(ws.sent.length, 0);
	assert.equal(ws.sockets[0].open, false);
});
