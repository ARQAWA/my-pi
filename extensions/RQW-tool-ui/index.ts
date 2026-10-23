// RQW-tool-ui: compact display of the tool calls between two assistant answers (README.md).
// This stage is the scaffold only: one resolver that hands every tool, known or not, to the next renderer,
// so the transcript looks exactly like stock Pi. No components, statuses, timers or subscriptions.
import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";

/** The context Pi passes to tool renderers, derived from the root-exported `ToolRenderers` type. */
export type ToolRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];

export default function toolUi(pi: ExtensionAPI): void {
	pi.registerToolRenderer((_toolName, next) => next());
}
