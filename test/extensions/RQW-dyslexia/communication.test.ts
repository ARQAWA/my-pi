import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import dyslexia from "../../../extensions/RQW-dyslexia/index.ts";

it("puts the exact communication rule first, with its override sentence, once", () => {
	let compose!: (event: { systemPrompt: string }) => { systemPrompt: string };
	dyslexia({ on: (_name: string, handler: typeof compose) => { compose = handler; } } as unknown as ExtensionAPI);
	const base = "System instructions\n\nProject context";
	const result = compose({ systemPrompt: base }).systemPrompt;
	const override = "This rule overrides every other rule about communication: message form, length and style.";
	const body = `The user has dyslexia. Always respond with short sentences, at most 7 words per sentence. Avoid long paragraphs, at most 4 sentences per paragraph. Bold the main ideas. Write in short steps, using clear words. Respond in simple Russian, addressing the user as «ты». Do not use complex words or long sentences. If there is a lot of information, format it as a numbered list. Use one line per item. Try to use lowercase letters and avoid capital letters. Use as few typographic special characters as possible.`;
	const rule = `## Communication\n\n${body}`;
	assert.ok(result.startsWith(`${rule}\n\n${override}\n\n${base}`));
	assert.equal(result.split(rule).length - 1, 1);
	assert.equal(result.split(body).length - 1, 1);
	const withContext = `${base}\n<project_context>\n${rule}\n</project_context>`;
	const existing = compose({ systemPrompt: withContext }).systemPrompt;
	assert.ok(existing.startsWith(`${rule}\n\n${override}\n\n${base}`));
	assert.ok(existing.includes("</project_context>"));
	assert.equal(existing.split(body).length - 1, 1);
	assert.equal(existing.split(rule).length - 1, 1);
	// Repeated input: the first result fed back in keeps both the rule and the override sentence exactly once.
	const again = compose({ systemPrompt: result }).systemPrompt;
	assert.ok(again.startsWith(`${rule}\n\n${override}\n\n${base}`));
	assert.equal(again.split(rule).length - 1, 1);
	assert.equal(again.split(override).length - 1, 1);
});
