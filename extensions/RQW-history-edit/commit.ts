import { existsSync } from "node:fs";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { replaceSessionFile, rewriteSession } from "./rewrite.ts";

export async function commitEdit(pi: ExtensionAPI, ctx: ExtensionCommandContext, id: string, text: string, images: ImageContent[] = []): Promise<boolean> {
	const path = ctx.sessionManager.getSessionFile();
	if (!path || !existsSync(path)) {
		ctx.ui.notify("нет файла сессии. открой сохранённую сессию", "warning");
		return false;
	}
	if (!ctx.isIdle()) {
		ctx.ui.notify("дождись завершения работы", "warning");
		return false;
	}
	const entry = ctx.sessionManager.getBranch().find(item => item.id === id);
	if (!entry || entry.type !== "message" || entry.message.role !== "user") {
		ctx.ui.notify("сообщение больше не в текущей ветке", "warning");
		return false;
	}
	try {
		const leaf = ctx.sessionManager.getBranch().at(-1);
		if (leaf?.type === "custom_message" || (leaf?.type === "message" && leaf.message.role === "user")) {
			pi.appendEntry("rqw-history-edit", { version: 1 });
		}
		const originalLeafId = ctx.sessionManager.getLeafId();
		const result = await ctx.navigateTree(id);
		if (result.cancelled) return false;
		const original = rewriteSession(pi, ctx, path);
		try {
			const switched = await ctx.switchSession(path, {
				withSession: async fresh => {
					fresh.ui.setEditorText("");
					try {
						await fresh.sendUserMessage(images.length ? [{ type: "text", text }, ...images] : text);
					} catch (error) {
						fresh.ui.setEditorText(text);
						fresh.ui.notify(`сообщение не отправлено: ${String(error)}`, "error");
					}
				},
			});
			if (!switched.cancelled) return true;
		} catch {
			// A failed replacement must not leave the session file truncated.
		}
		replaceSessionFile(path, original);
		if (originalLeafId) {
			const restored = await ctx.navigateTree(originalLeafId);
			if (restored.cancelled) throw new Error("не удалось вернуть прежнюю ветку");
		}
		ctx.ui.notify("правка истории отменена", "warning");
		return false;
	} catch (error) {
		ctx.ui.notify(`правка истории не выполнена: ${String(error)}`, "error");
		return false;
	}
}
