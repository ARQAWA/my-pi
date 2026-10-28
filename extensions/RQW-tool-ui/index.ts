// RQW-tool-ui: compact display of the tool calls between two assistant answers (README.md).
// One resolver draws every tool call (render.ts); public session and stream events keep the groups current.
// Only Pi's interactive TUI draws tool rows; in print, JSON and RPC modes nothing is kept.
import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { ToolUi } from "./render.ts";

/** The context Pi passes to tool renderers, derived from the root-exported `ToolRenderers` type. */
export type ToolRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];

export default function toolUi(pi: ExtensionAPI): void {
	const ui = new ToolUi();
	pi.registerToolRenderer((toolName, next) => ui.resolve(toolName, next));
	pi.on("session_start", (_event, ctx) => {
		ui.shutdown();
		if (ctx.mode === "tui") ui.start(ctx.sessionManager);
	});
	pi.on("session_shutdown", () => ui.shutdown());
	pi.on("session_compact", () => ui.entriesChanged());
	pi.on("session_tree", () => ui.entriesChanged(true));
	pi.on("message_start", (event) => { if (ui.installed) ui.messageStart(event.message); });
	pi.on("message_update", (event) => { if (ui.installed) ui.messageUpdate(event.message, event.assistantMessageEvent); });
	pi.on("message_end", (event) => { if (ui.installed) ui.messageEnd(event.message); });
	pi.on("tool_execution_start", (event) => { if (ui.installed) ui.toolStart(event); });
	pi.on("tool_execution_update", (event) => { if (ui.installed) ui.toolUpdate(event); });
	pi.on("tool_execution_end", (event) => { if (ui.installed) ui.toolEnd(event); });
	pi.on("agent_end", () => { if (ui.installed) ui.agentEnd(); });
}
