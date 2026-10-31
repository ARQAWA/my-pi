import assert from "node:assert/strict";
import test from "node:test";
import { stream as anthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { stream as codex } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { createTools } from "../../../extensions/RQW-tools/index.ts";

const expected = ["rqw_glob", "rqw_readfile", "rqw_rg"];
const tools = createTools(process.cwd(), () => ({})).filter((tool) => expected.includes(tool.name))
	.map(({ name, description, parameters }) => ({ name, description, parameters }));
const context: any = { messages: [
	{ role: "system", content: "system", timestamp: 1, toolsAdded: tools },
	{ role: "user", content: "hello", timestamp: 2 },
] };
const common = { name: "test", input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 1000,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const anthropicModel: any = { ...common, id: "claude-test", provider: "anthropic", api: "anthropic-messages", baseUrl: "https://example.invalid" };
const codexModel: any = { ...common, id: "codex-test", provider: "openai-codex", api: "openai-codex-responses", baseUrl: "https://example.invalid" };
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encoded({ alg: "none" })}.${encoded({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })}.signature`;
const sse = (events: any[]) => new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
	{ status: 200, headers: { "content-type": "text/event-stream" } });

test("Anthropic API and OAuth and Codex requests carry the same file tool names", async () => {
	for (const apiKey of ["test-api-key", "sk-ant-oat01-test"]) {
		let body: any;
		const result = await anthropic(anthropicModel, context, { apiKey, maxRetries: 0,
			onPayload: (payload: any) => { body = payload; },
			fetch: async () => sse([
				{ type: "message_start", message: { id: "test", model: "claude-test", usage: { input_tokens: 1, output_tokens: 0 } } },
				{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
				{ type: "message_stop" },
			]),
		} as any).result();
		assert.equal(result.stopReason, "stop");
		assert.deepEqual(body.tools.map((tool: any) => tool.name).sort(), expected);
	}
	let body: any;
	const result = await codex(codexModel, context, { apiKey: token, transport: "sse", maxRetries: 0,
		onPayload: (payload: any) => { body = payload; },
		fetch: async () => sse([{ type: "response.created", response: { id: "test" } },
			{ type: "response.completed", response: { id: "test", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]),
	} as any).result();
	assert.equal(result.stopReason, "stop");
	assert.deepEqual(body.tools.map((tool: any) => tool.name).sort(), expected);
});
