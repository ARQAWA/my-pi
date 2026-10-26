import assert from "node:assert/strict";
import { it } from "node:test";
import * as zlib from "node:zlib";
import { InMemoryCredentialStore, type Api, type Context, type Model } from "@earendil-works/pi-ai";
import { createCompactionSender } from "../../../extensions/RQW-codex/compaction-wire.ts";
import { CODEX_ENDPOINT } from "../../../extensions/RQW-codex/profile.ts";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";
import { CodexThreadTransport, wireCapabilities } from "../../../extensions/RQW-codex/transport.ts";

const IDENTITY = { installationId: "11111111-2222-4333-8444-555555555555", windowId: "11111111-2222-4333-8444-555555555555:0", rootSessionId: "root-session-1", threadId: "thread-1" } as never;
const MODEL = { id: "gpt-6-luna", api: "openai-codex-responses", provider: "openai-codex", input: ["text"], reasoning: true, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as unknown as Model<Api>;
const CONTEXT: Context = { systemPrompt: "BASE", messages: [], tools: [] };

it("compaction runs through the transport and returns its completed item", async () => {
	const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const access = `${b64({ alg: "none" })}.${b64({ exp: 4_000_000_000, "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })}.sig`;
	const store = new InMemoryCredentialStore();
	await store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "refresh", expires: 4_000_000_000_000, accountId: "acct" }) as never);
	const bodies: Uint8Array[] = [];
	const postEvents = (options: any) => {
		bodies.push(options.body);
		return (async function* () {
			options.onResponse({ status: 200, headers: {} });
			for (const value of [
				{ type: "response.created", response: { id: "resp_cmp" } },
				{ type: "response.output_item.done", item: { type: "compaction", id: "cmp_1", encrypted_content: "enc" } },
				{ type: "response.completed", response: { id: "resp_cmp", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
			]) yield { text: JSON.stringify(value), value };
		})();
	};
	const transport = new CodexThreadTransport({ identity: IDENTITY, store, dependencies: {
		clock: { now: () => 1_000_000 }, random: () => 0.5, sleep: async () => undefined,
		connect: async () => { throw new SocketError(426, {}, "upgrade required", "upgrade-rejected"); }, postEvents: postEvents as any,
	} });
	const send = createCompactionSender({ transport, model: MODEL, context: CONTEXT, options: {} as never, identity: IDENTITY, capabilities: wireCapabilities(MODEL), toolsInHistory: false });
	const stream = await send({ endpoint: CODEX_ENDPOINT, attempt: 0, body: {
		model: MODEL.id,
		input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }, { type: "compaction_trigger" }],
		tools: [], parallel_tool_calls: false, tool_choice: "auto", store: false, stream: true, include: ["reasoning.encrypted_content"],
	} });
	const events: Record<string, unknown>[] = [];
	for await (const event of stream as AsyncIterable<Record<string, unknown>>) events.push(event);
	assert.equal(events[0]?.type, "output_item_done");
	assert.equal(events.at(-1)?.type, "completed");
	const body = JSON.parse(zlib.zstdDecompressSync(Buffer.from(bodies[0])).toString("utf8"));
	assert.equal(body.input.at(-1).type, "compaction_trigger");
	transport.dispose();
});
