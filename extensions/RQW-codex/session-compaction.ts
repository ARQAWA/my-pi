// Pi runs its own summarizer and owns persistence, progress, errors and retry.
import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";

export const CODEX_HOOK_PROVIDER = "openai-codex";
export const CODEX_HOOK_API = "openai-codex-responses";

export type CompactionHookOptions = {
	prepare(event: SessionBeforeCompactEvent, ctx: ExtensionContext): void;
	accepts?(ctx: ExtensionContext): boolean;
	onCompacted?(ctx: ExtensionContext): void;
	onFinished?(ctx: ExtensionContext): void;
};

/** Bind only public lifecycle handlers. The before hook never supplies or cancels a result. */
export function installSessionCompaction(pi: ExtensionAPI, options: CompactionHookOptions): () => void {
	const accepts = (ctx: ExtensionContext) => options.accepts?.(ctx) ?? true;
	const offBefore = pi.on("session_before_compact", (event, ctx) => {
		if (ctx.model?.provider === CODEX_HOOK_PROVIDER && ctx.model.api === CODEX_HOOK_API && accepts(ctx)) {
			options.prepare(event, ctx);
		}
	});
	const offAfter = pi.on("session_compact", (_event, ctx) => {
		if (!accepts(ctx)) return;
		options.onFinished?.(ctx);
		options.onCompacted?.(ctx);
	});
	const offFailed = pi.on("session_compact_failed", (_event, ctx) => {
		if (accepts(ctx)) options.onFinished?.(ctx);
	});
	return () => { offBefore(); offAfter(); offFailed(); };
}
