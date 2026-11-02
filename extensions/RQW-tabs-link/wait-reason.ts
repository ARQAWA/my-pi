import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Waits may share a batch, but work and nested codemode calls must not be held by a wait. */
export function waitReason(ctx: ExtensionContext, call: string): "direct_wait_required" | "work_pending" | undefined {
	const manager = ctx.sessionManager;
	let entry = manager.getLeafEntry();
	while (entry) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			const calls = entry.message.content.filter(block => block.type === "toolCall");
			if (calls.some(block => block.id === call)) {
				const work = calls.some(block => block.name !== "wait_answer" && !((block.name === "agent" || block.name === "job") && block.arguments.action === "wait"));
				return work ? "work_pending" : undefined;
			}
			if (calls.some(block => block.name === "codemode" && call.startsWith(`${block.id}/`))) return "direct_wait_required";
		}
		entry = entry.parentId ? manager.getEntry(entry.parentId) : undefined;
	}
}
