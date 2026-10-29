// Extension 1: harness defaults: codemode/tool_search on, background cache warming off, GPT Fast (/fast-gpt),
// one-time install settings profile (setup.ts).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installSelectionIntent, noToolSelection } from "./selection.ts";
import { installCacheDefault } from "./cache-warming.ts";
import { installFastGpt } from "./fast-gpt.ts";
import { installSetupBridge } from "./setup.ts";

const DEFAULT_ON = ["codemode", "tool_search"];

export default function settings(pi: ExtensionAPI) {
	const releaseSelection = installSelectionIntent();
	const releaseSetup = installSetupBridge(pi);
	const releaseCache = installCacheDefault(pi);
	installFastGpt(pi);
	pi.on("session_shutdown", () => { releaseSetup(); releaseCache(); releaseSelection(); });
	// Same captured SDK intent and CLI/settings predicate as grep and find. A tool is added only when
	// it is registered, so a user who turned off `builtin:codemode` or `builtin:tool-search` gets no error. The
	// handler reads the active set at call time, so it keeps whatever RQW-tools added, whichever runs first.
	// Not on `reload`: Pi keeps the active set through a reload, including tools the user switched off during the
	// session, and adding them again would override that choice.
	pi.on("session_start", (event, ctx) => {
		if (event.reason === "reload") return;
		if (!noToolSelection(pi, ctx.sessionManager)) return;
		const registered = new Set(pi.getAllTools().map((tool) => tool.name));
		const active = pi.getActiveTools();
		const missing = DEFAULT_ON.filter((name) => registered.has(name) && !active.includes(name));
		if (missing.length > 0) pi.setActiveTools([...active, ...missing]);
	});
}
