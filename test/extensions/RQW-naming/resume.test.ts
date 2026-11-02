import assert from "node:assert/strict";
import { it } from "node:test";
import naming from "../../../extensions/RQW-naming/index.ts";

async function renameAfterResume(messages: any[], window: number, provider = "anthropic", projected = messages, edits: any[] = []) {
	const handlers: Record<string, (event: any, ctx: any) => void> = {};
	let command: any;
	let finish!: (result: { name?: string; warning?: string }) => void;
	const finished = new Promise<{ name?: string; warning?: string }>((resolve) => { finish = resolve; });
	let sent: any;
	let calls = 0;
	const pi = {
		on: (event: string, handler: typeof handlers[string]) => { handlers[event] = handler; },
		registerCommand: (_name: string, value: unknown) => { command = value; },
		registerTool() {},
		setSessionName: (name: string) => finish({ name }),
	};
	naming(pi as never);
	const ctx = {
		model: { provider },
		sessionManager: {
			getSessionId: () => "resumed",
			getEntries: () => messages.map((message) => ({ type: "message", message })),
			getBranch: () => [...messages.map((message, index) => ({ type: "message", id: String(index), message })), ...edits],
			buildSessionProjection: () => ({ messages: projected }),
		},
		ui: { notify: (warning: string) => finish({ warning }) },
		modelRegistry: {
			getAvailableOfType: async () => [{ id: provider === "anthropic" ? "claude-haiku-5-5" : "gpt-5.6-luna", contextWindow: window, maxTokens: 128000 }],
			streamSimple: (_model: unknown, context: any) => {
				calls++;
				sent = context;
				const chars = context.messages[0].content.reduce((count: number, block: any) => count + (block.text?.length ?? 4800), 0);
				return { result: async () => chars / 3.5 > window
					? { stopReason: "error", content: [] }
					: { stopReason: "stop", content: [{ type: "text", text: '["Recent work"]' }] } };
			},
		},
	};
	handlers.session_start({}, ctx);
	await command.handler("", ctx);
	return { result: await finished, sent, calls };
}

it("renames a resumed long Opus session using the newest context that fits Haiku", async () => {
	const messages = [
		{ role: "user", content: "old " + "x".repeat(2500000) + " boundary detail", timestamp: 1 },
		{ role: "user", content: "recent " + "y".repeat(30000), timestamp: 2 },
	];
	const { result, sent, calls } = await renameAfterResume(messages, 1000000);
	assert.deepEqual(result, { name: "Recent work" });
	assert.equal(calls, 1);
	const text = sent.messages[0].content.map((block: any) => block.text ?? "").join("\n");
	assert.ok(text.includes("recent "));
	assert.ok(text.includes("boundary detail"));
	assert.ok(!text.includes("old "));
});

it("keeps the end of an oversized newest message", async () => {
	const messages = [{ role: "user", content: "x".repeat(4000000) + " newest detail", timestamp: 1 }];
	const { result, sent } = await renameAfterResume(messages, 1000000);
	assert.deepEqual(result, { name: "Recent work" });
	assert.ok(sent.messages[0].content.some((block: any) => block.text?.includes("newest detail")));
});

it("keeps older branch messages after compaction", async () => {
	const messages = [
		{ role: "user", content: "before compaction", timestamp: 1 },
		{ role: "assistant", content: [{ type: "text", text: "after compaction" }], timestamp: 2 },
	];
	const { result, sent } = await renameAfterResume(messages, 1000000, "anthropic", messages.slice(1));
	assert.deepEqual(result, { name: "Recent work" });
	const text = sent.messages[0].content.map((block: any) => block.text ?? "").join("\n");
	assert.ok(text.includes("before compaction"));
	assert.ok(text.includes("after compaction"));
});

it("respects context edits when reading the active branch", async () => {
	const messages = [
		{ role: "user", content: "old private text", timestamp: 1 },
		{ role: "assistant", content: [{ type: "text", text: "deleted text" }], timestamp: 2 },
	];
	const edits = [
		{ type: "context_edit", targetId: "0", replacement: { content: "replacement text" } },
		{ type: "context_edit", targetId: "1", replacement: null },
	];
	const { result, sent } = await renameAfterResume(messages, 1000000, "anthropic", messages, edits);
	assert.deepEqual(result, { name: "Recent work" });
	const text = sent.messages[0].content.map((block: any) => block.text ?? "").join("\n");
	assert.ok(text.includes("replacement text"));
	assert.ok(!text.includes("old private text"));
	assert.ok(!text.includes("deleted text"));
});

it("keeps a suffix when JSON escaping expands the boundary message", async () => {
	const messages = [
		{ role: "user", content: "boundary " + "\\\\".repeat(200000) + " newest detail", timestamp: 1 },
		{ role: "assistant", content: [{ type: "text", text: "x".repeat(100000) }], timestamp: 2 },
	];
	const { result, sent } = await renameAfterResume(messages, 1000000);
	assert.deepEqual(result, { name: "Recent work" });
	const text = sent.messages[0].content.map((block: any) => block.text ?? "").join("\n");
	assert.ok(text.includes("newest detail"));
});

it("filters tool output before applying the 50000-token budget", async () => {
	const messages = [
		{ role: "user", content: "older user text", timestamp: 1 },
		{ role: "toolResult", content: [{ type: "text", text: "excluded-tool " + "x".repeat(200000) }], timestamp: 2 },
		{ role: "assistant", content: [{ type: "text", text: "newer assistant text" }], timestamp: 3 },
	];
	const { result, sent } = await renameAfterResume(messages, 1000000);
	assert.deepEqual(result, { name: "Recent work" });
	const text = sent.messages[0].content.map((block: any) => block.text ?? "").join("\n");
	assert.ok(text.includes("older user text"));
	assert.ok(text.includes("newer assistant text"));
	assert.ok(!text.includes("excluded-tool"));
});

for (const [provider, window] of [["anthropic", 1000000], ["openai-codex", 272000]] as const) {
	it(`uses only the latest 50000 estimated tokens after resume with ${provider}`, async () => {
		const messages = [
			{ role: "user", content: "old " + "x".repeat(200000) + " boundary detail", timestamp: 1 },
			{ role: "user", content: "recent " + "y".repeat(30000), timestamp: 2 },
		];
		const { result, sent } = await renameAfterResume(messages, window, provider);
		assert.deepEqual(result, { name: "Recent work" });
		const blocks = sent.messages[0].content;
		const conversation = blocks.slice(1, -1).map((block: any) => block.text ?? "").join("");
		assert.ok(conversation.length <= 50000 * 3.5);
		assert.ok(conversation.length > 49000 * 3.5);
		assert.ok(conversation.includes("boundary detail"));
		assert.ok(conversation.includes("recent "));
		assert.ok(!conversation.includes("old "));
	});
}

it("renames a resumed short session without losing its history", async () => {
	const messages = [{ role: "user", content: "Earlier conversation", timestamp: 1 }];
	const { result, sent } = await renameAfterResume(messages, 1000000);
	assert.deepEqual(result, { name: "Recent work" });
	assert.ok(sent.messages[0].content.some((block: any) => block.text?.includes("Earlier conversation")));
});
