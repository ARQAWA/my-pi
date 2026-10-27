import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import dyslexia from "../../../extensions/RQW-dyslexia/index.ts";

it("appends the exact communication rule once to the composed system prompt", () => {
	let compose!: (event: { systemPrompt: string }) => { systemPrompt: string };
	dyslexia({ on: (_name: string, handler: typeof compose) => { compose = handler; } } as unknown as ExtensionAPI);
	const base = "System instructions\n\nProject context";
	const result = compose({ systemPrompt: base }).systemPrompt;
	const rule = `## Communication

The user has dyslexia. Always respond with short sentences, at most 7 words per sentence. Avoid long paragraphs, at most 4 sentences per paragraph. Bold the main ideas. Write in short steps, using clear words. Respond in simple Russian, addressing the user as «ты». Do not use complex words or long sentences. If there is a lot of information, format it as a numbered list. Use one line per item. Try to use lowercase letters and avoid capital letters. Use as few typographic special characters as possible.`;
	assert.ok(result.startsWith(base));
	assert.ok(result.endsWith(rule));
	assert.equal(result.split(rule).length - 1, 1);
	const withContext = `${base}\n<project_context>\n${rule}\n</project_context>`;
	const existing = compose({ systemPrompt: withContext }).systemPrompt;
	assert.ok(existing.startsWith(base));
	assert.ok(existing.includes("</project_context>"));
	assert.ok(existing.endsWith(rule));
	assert.equal(existing.split(rule).length - 1, 1);
});
