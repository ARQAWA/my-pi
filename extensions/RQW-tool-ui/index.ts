// RQW-tool-ui: compact tool rows and worked-for folds (README.md).
import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Folds } from "./fold.ts";
import { registerHost } from "./host.ts";
import { ToolUi } from "./render.ts";

export type ToolRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];

export default function toolUi(pi: ExtensionAPI): void {
	const ui = new ToolUi();
	const folds = new Folds();
	const resolver: Parameters<ExtensionAPI["registerToolRenderer"]>[0] = (toolName, next) => ui.installed ? ui.resolve(toolName, next) : next();
	const host = registerHost(resolver, ui, folds);
	pi.registerToolRenderer(resolver);
	pi.on("session_start", () => host.prepare());
	pi.on("session_shutdown", () => host.stop());
	pi.on("session_compact", () => { host.prepare(); if (ui.installed) { ui.entriesChanged(); folds.changed(true); } });
	pi.on("session_tree", () => { host.prepare(); if (ui.installed) { ui.entriesChanged(true); folds.changed(true); } });
	pi.on("agent_settled", () => { host.prepare(); if (ui.installed) folds.changed(); });
	pi.on("message_start", (event) => { host.prepare(); if (ui.installed) ui.messageStart(event.message); });
	pi.on("message_update", (event) => { host.prepare(); if (ui.installed) ui.messageUpdate(event.message, event.assistantMessageEvent); });
	pi.on("message_end", (event) => { host.prepare(); if (ui.installed) ui.messageEnd(event.message); });
	pi.on("tool_execution_start", (event) => { host.prepare(); if (ui.installed) ui.toolStart(event); });
	pi.on("tool_execution_update", (event) => { host.prepare(); if (ui.installed) ui.toolUpdate(event); });
	pi.on("tool_execution_end", (event) => { host.prepare(); if (ui.installed) ui.toolEnd(event); });
	pi.on("agent_end", () => { host.prepare(); if (ui.installed) ui.agentEnd(); });
}
