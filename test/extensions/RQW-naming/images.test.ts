import assert from "node:assert/strict";
import { it } from "node:test";
import naming from "../../../extensions/RQW-naming/index.ts";

it("passes images from the first user message as attachments with their conversation positions", async () => {
	const handlers: Record<string, (event: any, ctx: any) => void> = {};
	let finish!: (name: string) => void;
	const named = new Promise<string>((resolve) => { finish = resolve; });
	let request: any;
	const pi = {
		on: (event: string, handler: typeof handlers[string]) => { handlers[event] = handler; },
		registerCommand() {},
		registerTool() {},
		setSessionName: finish,
	};
	naming(pi as never);
	const image1 = { type: "image", mimeType: "image/png", data: "first-base64" };
	const image2 = { type: "image", mimeType: "image/jpeg", data: "second-base64" };
	const previous = { role: "custom", content: [{ type: "text", text: "Earlier context" }, image1], timestamp: 1 };
	const user = { role: "user", content: [{ type: "text", text: "What is this?" }, image2], timestamp: 2 };
	const ctx = {
		model: { provider: "anthropic" },
		sessionManager: { getSessionId: () => "session", getEntries: () => [], buildSessionProjection: () => ({ messages: [previous] }) },
		modelRegistry: {
			getAvailableOfType: async () => [{ id: "claude-haiku-5-5" }],
			streamSimple: (_model: unknown, context: unknown) => {
				request = context;
				return { result: async () => ({ stopReason: "stop", content: [{ type: "text", text: '["Image question"]' }] }) };
			},
		},
	};
	handlers.session_start({}, ctx);
	handlers.message_end({ message: user }, ctx);
	assert.equal(await named, "Image question");
	const content = request.messages[0].content;
	assert.deepEqual(content.slice(1, 5), [
		{ type: "text", text: JSON.stringify({ role: "user", content: [{ type: "text", text: "Earlier context" }, { type: "image", attachment: 1, mimeType: "image/png" }], timestamp: 1 }) },
		image1,
		{ type: "text", text: JSON.stringify({ ...user, content: [user.content[0], { type: "image", attachment: 1, mimeType: "image/jpeg" }] }) },
		image2,
	]);
	assert.ok(!content.filter((block: any) => block.type === "text").some((block: any) => block.text.includes("base64")));
});
