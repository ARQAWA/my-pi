import { constants, copyFileSync, existsSync, renameSync, rmSync } from "node:fs";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { rewriteSession } from "./rewrite.ts";

export type CommitResult = { committed: boolean; retryRestore?: (ctx: ExtensionCommandContext) => Promise<boolean> };

export const NO_SESSION_FILE = "No session file. Open a saved session first.";

export function hasSessionFile(ctx: ExtensionContext): boolean {
	const path = ctx.sessionManager.getSessionFile();
	return !!path && existsSync(path);
}

export async function commitEdit(pi: ExtensionAPI, ctx: ExtensionCommandContext, id: string, text: string, images: ImageContent[] = []): Promise<CommitResult> {
	const path = ctx.sessionManager.getSessionFile();
	const ui = ctx.ui;
	if (!path || !existsSync(path)) {
		ui.notify(NO_SESSION_FILE, "warning");
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
	let committed = false;
	let failure: unknown;
	let reopened: ExtensionCommandContext | undefined;
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
			const cutIds = new Set(ctx.sessionManager.getBranch().map(item => item.id));
			const switched = await ctx.switchSession(path, {
				withSession: async fresh => {
					reopened = fresh;
					fresh.ui.setEditorText("");
					try {
						await fresh.sendUserMessage(images.length ? [{ type: "text", text }, ...images] : text);
					} catch (error) {
						// The cut is final once the message is in the history; a later run error must not undo it.
						// Pi may append settings entries on reopening, so only a new user message counts as accepted.
						const accepted = fresh.sessionManager.getBranch().some(item => item.type === "message" && item.message.role === "user" && !cutIds.has(item.id));
						if (!accepted) failure = `the message was not sent (${String(error)})`;
						else fresh.ui.notify(`The run failed after the message was sent: ${String(error)}`, "error");
					}
				},
			});
			committed = !switched.cancelled && failure === undefined;
		}
	} catch (error) {
		failure = error;
	}
	if (committed) {
		try {
			rmSync(backup);
		} catch (error) {
			ui.notify(`History edited, but backup could not be removed: ${backup}. ${String(error)}`, "warning");
		}
		return { committed: true };
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
	// After a reopened session the old command context is stale, so recovery uses the fresh one.
	if (!await restore(reopened ?? ctx)) return { committed: false, retryRestore: restore };
	if (failure !== undefined) ui.notify(`History edit failed: ${String(failure)}`, "error");
	else ui.notify("History edit cancelled.", "warning");
	return { committed: false };
}
