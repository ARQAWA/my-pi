// RQW-thinking: the main transcript shows no model reasoning text. Display only: the stored messages, the session
// history and the model context keep every thinking block. Public Pi seams only: a Markdown transformer that empties
// `assistant-thinking` Markdown (the shown-thinking branch), and an empty hidden-thinking label (the hidden branch).
// Pi's own spacer and mouse-region rows around a thinking block stay; there is no zero-row promise.
import type { ExtensionAPI, MarkdownTransformer } from "@earendil-works/pi-coding-agent";

/** Empties reasoning Markdown; every other message type passes through unchanged. */
export const hideThinking: MarkdownTransformer = (markdown, context) =>
	context.messageType === "assistant-thinking" ? "" : markdown;

export default function thinking(pi: ExtensionAPI) {
	pi.registerMarkdownTransformer(hideThinking);
	// Pi restores the default label whenever it resets extension UI (reload, session switch), and session_start
	// follows each of those, so the label is set again there. A no-op outside the interactive mode.
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setHiddenThinkingLabel("");
	});
}
