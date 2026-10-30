import { constants, copyFileSync, existsSync, renameSync, rmSync } from "node:fs";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { rewriteSession } from "./rewrite.ts";

export type CommitResult = { committed: boolean; retryRestore?: (ctx: ExtensionCommandContext) => Promise<boolean> };

export async function commitEdit(pi: ExtensionAPI, ctx: ExtensionCommandContext, id: string, text: string, images: ImageContent[] = []): Promise<CommitResult> {
	const path = ctx.sessionManager.getSessionFile();
	const ui = ctx.ui;
	if (!path || !existsSync(path)) {
		ui.notify("No session file. Open a saved session first.", "warning");
		return { committed: false };
	}
	if (!ctx.isIdle()) {
		ui.notify("Wait for the current response to finish.", "warning");
		return { committed: false };
	}
	const entry = ctx.sessionManager.getBranch().find(item => item.id === id);
	if (!entry || entry.type !== "message" || entry.message.role !== "user") {
		ui.notify("The message is no longer in the current branch.", "warning");
		return { committed: false };
	}
	const backup = `${path}.rqw-edit-${process.pid}.bak`;
	let ownsBackup = false;
	let originalLeafId = ctx.sessionManager.getLeafId();
	let navigated = false;
	let failure: unknown;
	try {
		// Anchor the original branch on disk before navigation or metadata replay.
		pi.appendEntry("rqw-history-edit", { version: 1 });
		originalLeafId = ctx.sessionManager.getLeafId();
		copyFileSync(path, backup, constants.COPYFILE_EXCL);
		ownsBackup = true;
		navigated = true;
		const result = await ctx.navigateTree(id);
		if (!result.cancelled) {
			rewriteSession(pi, ctx, path);
			const switched = await ctx.switchSession(path, {
				withSession: async fresh => {
					fresh.ui.setEditorText("");
					try {
						await fresh.sendUserMessage(images.length ? [{ type: "text", text }, ...images] : text);
					} catch (error) {
						fresh.ui.setEditorText(text);
						fresh.ui.notify(`Message was not sent: ${String(error)}`, "error");
					}
				},
			});
			if (!switched.cancelled) {
				rmSync(backup);
				ownsBackup = false;
				return { committed: true };
			}
		}
	} catch (error) {
		failure = error;
	}
	const restore = async (current: ExtensionCommandContext): Promise<boolean> => {
		try {
			// A failed rename leaves the only original copy safely on disk for retry.
			if (ownsBackup) {
				renameSync(backup, path);
				ownsBackup = false;
			}
			if (navigated && originalLeafId) {
				const navigate = async (fresh: ExtensionCommandContext) => {
					const restored = await fresh.navigateTree(originalLeafId);
					if (restored.cancelled) throw new Error("Restoring the previous branch was cancelled");
				};
				if (!current.sessionManager.getEntries().some(item => item.id === originalLeafId)) {
					const reopened = await current.switchSession(path, { withSession: navigate });
					if (reopened.cancelled) throw new Error("Restoring the session was cancelled");
				} else await navigate(current);
			}
			return true;
		} catch (error) {
			// The ctx getter may already be stale, but the host UI object is still usable.
			ui.notify(`History edit failed: ${String(failure ?? "cancelled")}. Recovery failed: ${String(error)}.${ownsBackup ? ` Original history is preserved at ${backup}.` : ""} Submit again to retry restoring the previous branch, or switch sessions.`, "error");
			return false;
		}
	};
	if (!await restore(ctx)) return { committed: false, retryRestore: restore };
	if (failure !== undefined) ui.notify(`History edit failed: ${String(failure)}`, "error");
	else ui.notify("History edit cancelled.", "warning");
	return { committed: false };
}
