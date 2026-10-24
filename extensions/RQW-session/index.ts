import { copyToClipboard, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { prepareRemoval, removeFiles, type RemovalPlan } from "./artifacts.ts";

/** Injectable clipboard boundary for deterministic tests; production uses Pi's /copy implementation unchanged. */
export function registerSessionCommands(pi: ExtensionAPI, copy = copyToClipboard, agentDir = getAgentDir()) {
	pi.registerCommand("copy-session", {
		description: "Copy the current session ID to the clipboard",
		async handler(_args, ctx) {
			const id = ctx.sessionManager.getSessionId();
			try {
				await copy(id);
				ctx.ui.notify(`Session ID copied: ${id}`, "info");
			} catch (error) {
				ctx.ui.notify(`Could not copy session ID: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
	pi.registerCommand("remove", {
		description: "Permanently remove this session and its unshared artifacts, then start fresh",
		async handler(_args, ctx) {
			if (!ctx.hasUI) {
				ctx.ui.notify("Session removal requires a confirmation-capable UI; nothing was deleted", "error");
				return;
			}
			const id = ctx.sessionManager.getSessionId();
			const file = ctx.sessionManager.getSessionFile();
			if (await ctx.ui.select("Delete this session permanently?", ["1. No", "2. Yes"]) !== "2. Yes") return;
			let plan: RemovalPlan;
			try { plan = await prepareRemoval(file, agentDir); }
			catch (error) {
				ctx.ui.notify(`Session removal refused: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
			// Never reuse ctx/pi after replacement: old extension contexts become stale, even on partial failure.
			await ctx.newSession({ withSession: async fresh => {
				try {
					const { artifacts, children } = await removeFiles(plan);
					const extra = children ? `, ${children} child sessions deleted` : "";
					fresh.ui.notify(`Session removed: ${id} (${artifacts} artifact files deleted${extra})`, "info");
				} catch (error) {
					fresh.ui.notify(`Session removal incomplete: ${error instanceof Error ? error.message : String(error)}. Old session file: ${file ?? "(in memory)"}`, "error");
				}
			} });
		},
	});
}

export default function sessionCommands(pi: ExtensionAPI) { registerSessionCommands(pi); }
