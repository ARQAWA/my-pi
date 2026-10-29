import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PLACEHOLDER = "ответ готовится";

export default function liveTail(pi: ExtensionAPI) {
	// Only the assistant text still being typed is replaced; the finished answer is rendered in full.
	pi.registerMarkdownTransformer((markdown, context) =>
		context.messageType === "assistant" && context.isStreaming ? PLACEHOLDER : markdown);
}
