import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PLACEHOLDER = "writing answer";

export default function liveTail(pi: ExtensionAPI) {
	let ui: import("@earendil-works/pi-coding-agent").ExtensionContext["ui"] | undefined;
	pi.on("session_start", (_event, context) => { ui = context.ui; });
	pi.registerMarkdownTransformer((markdown, context) =>
		context.messageType === "assistant" && context.isStreaming ? (ui?.theme.fg("dim", PLACEHOLDER) ?? PLACEHOLDER) : markdown);
}
