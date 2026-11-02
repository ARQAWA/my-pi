import assert from "node:assert/strict";
import { it } from "node:test";
import naming from "../../../extensions/RQW-naming/index.ts";

it("uses only user and assistant text for the first-message trigger", async () => {
	const handlers: Record<string, (event: any, ctx: any) => void> = {};
	let finish!: (name: string) => void;
	const named = new Promise<string>((resolve) => { finish = resolve; });
	let request: any;
	const pi = {
		events: { on() {}, emit() {} },
		on: (event: string, handler: typeof handlers[string]) => { handlers[event] = handler; },
		registerCommand() {},
		registerTool() {},
		setSessionName: finish,
	};
	naming(pi as never);
	const image = { type: "image", mimeType: "image/png", data: "excluded-image" };
	const user = { role: "user", content: [{ type: "text", text: "user words" }, image], timestamp: 2 };
	const messages = [
		{ role: "custom", content: "excluded-custom", timestamp: 1 },
		{ role: "compactionSummary", summary: "excluded-summary", timestamp: 1 },
		{ role: "assistant", content: [{ type: "thinking", thinking: "excluded-thinking" }, { type: "text", text: "assistant words" }, { type: "toolCall", id: "1", name: "excluded-tool", arguments: { secret: "excluded-args" } }], timestamp: 1 },
		{ role: "toolResult", content: [{ type: "text", text: "excluded-result" }], timestamp: 1 },
	];
	const ctx = {
		model: { provider: "anthropic" },
		sessionManager: { getSessionId: () => "session", getEntries: () => [], getBranch: () => messages.map((message, index) => ({ type: "message", id: String(index), message })) },
		modelRegistry: {
			getAvailableOfType: async () => [{ id: "claude-haiku-5-5", contextWindow: 1000000 }],
			streamSimple: (_model: unknown, context: unknown) => {
				request = context;
				return { result: async () => ({ stopReason: "stop", content: [{ type: "text", text: '["Text conversation"]' }] }) };
			},
		},
	};
	handlers.session_start({}, ctx);
	handlers.message_end({ message: user }, ctx);
	assert.equal(await named, "Text conversation");
	const content = request.messages[0].content;
	assert.ok(content.every((block: any) => block.type === "text"));
	const text = content.map((block: any) => block.text).join("\n");
	assert.ok(text.includes("user words"));
	assert.ok(text.includes("assistant words"));
	assert.ok(!text.includes("excluded-"));
});
