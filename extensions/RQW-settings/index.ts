// Extension 1: settings of the harness. For now it turns on Pi's built-in `codemode` and `tool_search` tools.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { noToolSelection } from "../RQW-tools/selection.ts";

const DEFAULT_ON = ["codemode", "tool_search"];

export default function settings(pi: ExtensionAPI) {
	// Same rule as grep and find in RQW-tools: only when the user made no tool selection. A tool is added only when
	// it is registered, so a user who turned off `builtin:codemode` or `builtin:tool-search` gets no error. The
	// handler reads the active set at call time, so it keeps whatever RQW-tools added, whichever runs first.
	// Not on `reload`: Pi keeps the active set through a reload, including tools the user switched off during the
	// session, and adding them again would override that choice.
	pi.on("session_start", (event) => {
		if (event.reason === "reload") return;
		if (!noToolSelection(pi)) return;
		const registered = new Set(pi.getAllTools().map((tool) => tool.name));
		const active = pi.getActiveTools();
		const missing = DEFAULT_ON.filter((name) => registered.has(name) && !active.includes(name));
		if (missing.length > 0) pi.setActiveTools([...active, ...missing]);
	});
}
