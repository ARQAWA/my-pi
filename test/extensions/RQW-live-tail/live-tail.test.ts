import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI, MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import liveTail from "../../../extensions/RQW-live-tail/index.ts";

it("hides only the assistant text that is still streaming", () => {
	let transform!: MarkdownTransformer;
	liveTail({ registerMarkdownTransformer: (transformer: MarkdownTransformer) => { transform = transformer; } } as unknown as ExtensionAPI);
	const text = "# Answer\n\nPartial **text**";
	const context = (messageType: "user" | "assistant" | "assistant-thinking", isStreaming: boolean) => ({ messageType, isStreaming, availableWidth: 80 });
	assert.equal(transform(text, context("assistant", true)), "ответ готовится");
	assert.equal(transform(text, context("assistant", false)), text);
	assert.equal(transform(text, context("user", true)), text);
	assert.equal(transform(text, context("assistant-thinking", true)), text);
});
