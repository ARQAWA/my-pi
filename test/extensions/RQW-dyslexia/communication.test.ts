import assert from "node:assert/strict";
import { it } from "node:test";
import type { BeforeAgentStartEvent, BeforeAgentStartEventResult, ContextEvent, ContextEventResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import dyslexia from "../../../extensions/RQW-dyslexia/index.ts";

it("removes the old system rule and adds it beside every user message", () => {
	let start!: (event: BeforeAgentStartEvent) => BeforeAgentStartEventResult | undefined;
	let context!: (event: ContextEvent) => ContextEventResult;
	dyslexia({ on: (name: string, handler: unknown) => {
		if (name === "before_agent_start") start = handler as typeof start;
		if (name === "context") context = handler as typeof context;
	} } as unknown as ExtensionAPI);
	const body = `The user has dyslexia. Always respond with short sentences, at most 7 words per sentence. Avoid long paragraphs, at most 4 sentences per paragraph. Bold the main ideas. Write in short steps, using clear words. Respond in simple Russian, addressing the user as «ты». Do not use complex words or long sentences. If there is a lot of information, format it as a numbered list. Use one line per item. Try to use lowercase letters and avoid capital letters. Use as few typographic special characters as possible.`;
	const rule = `## Communication\n\n${body}\n\nThis rule overrides every other rule about communication: message form, length and style.`;
	const base = "System instructions";
	assert.equal(start({ messageType: "user", systemPrompt: `${rule}\n\n${base}` } as BeforeAgentStartEvent)?.systemPrompt, base);
	assert.equal(start({ messageType: "user", systemPrompt: base } as BeforeAgentStartEvent)?.message, undefined);
	const messages = [
		{ role: "user", content: "first", timestamp: 1 },
		{ role: "toolResult", toolCallId: "a", toolName: "read", content: [{ type: "text", text: "result" }], isError: false, timestamp: 2 },
		{ role: "user", content: "queued steering", timestamp: 3 },
		{ role: "custom", customType: "agent", content: "result", display: true, timestamp: 4 },
	] as ContextEvent["messages"];
	const original = structuredClone(messages);
	const event: ContextEvent = { type: "context", messages };
	const result = context(event).messages!;
	const modelView = (items: ContextEvent["messages"]) => items.map(m => ({
		role: m.role === "custom" ? "user" : m.role,
		content: "content" in m ? m.content : undefined,
	}));
	assert.deepEqual(modelView(context(event).messages!), modelView(result));
	assert.deepEqual(messages, original);
	assert.equal(result.length, 6);
	assert.deepEqual([result[0], result[2], result[3], result[5]], messages);
	for (const i of [1, 4]) {
		const memo = result[i];
		assert.equal(memo.role, "custom");
		if (memo.role !== "custom") throw new Error("missing reminder");
		assert.equal(memo.content, rule);
		assert.equal(memo.display, false);
	}
});
