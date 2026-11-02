// Huge-tail compaction bypasses Pi's module-bound prepareCompaction, not its summary generator or session format.
import * as Pi from "@earendil-works/pi-coding-agent";
import { prepareSnapshot } from "./background.ts";

const SAFE_PROJECTION = Symbol.for("rqw:safe-projection:v1");
type Session = Record<string, any>;

/** Leave ordinary sessions and unsupported Pi shapes on their native path. */
export function compactSafeTail(session: Session, stock: () => any, reason: string, willRetry: boolean, instructions?: string): any {
	const offer = (globalThis as Record<symbol, unknown>)[SAFE_PROJECTION];
	const methods = ["abort", "getContextUsage", "refreshContext", "_emit", "_emitSessionCompactFailed", "_resolveIdleWaitIfIdle", "_runDefaultCompaction"];
	if (typeof offer !== "function" || methods.some((name) => typeof session[name] !== "function") ||
		["appendCompaction", "getEntry", "getBranch", "buildSessionProjection"].some((name) => typeof session.sessionManager?.[name] !== "function") ||
		typeof session.agent?.hasQueuedMessages !== "function") return stock();
	try {
		Pi.buildSessionProjection(session.sessionManager.getBranch());
	} catch (error) {
		if (error instanceof RangeError) return run(session, reason, willRetry, instructions);
	}
	return stock();
}

async function run(session: Session, reason: string, willRetry: boolean, instructions?: string): Promise<any> {
	const manual = reason === "manual";
	if (manual) await session.abort();
	const field = manual ? "_compactionAbortController" : "_autoCompactionAbortController";
	const controller = new AbortController();
	session[field] = controller;
	let fromExtension = false;
	let cancelled = false;
	session._emit({ type: "compaction_start", reason });
	try {
		if (!session.model) throw new Error("No model selected");
		const branch = session.sessionManager.getBranch();
		const settings = session.settingsManager.getCompactionSettings(session.model);
		const projection = session.sessionManager.buildSessionProjection();
		const tokens = session.getContextUsage()?.tokens ?? projection.messages.reduce((sum: number, message: any) => sum + Pi.estimateTokens(message), 0);
		const preparation = prepareSnapshot(branch, settings, tokens)?.preparation;
		if (!preparation) throw new Error("Nothing to compact (session too small)");
		controller.signal.throwIfAborted();
		const hook = await session.extensionRunner?.emit({
			type: "session_before_compact", preparation, branchEntries: branch, customInstructions: instructions,
			reason, willRetry, signal: controller.signal,
		});
		cancelled = hook?.cancel === true;
		if (cancelled) throw new Error("Compaction cancelled");
		controller.signal.throwIfAborted();
		fromExtension = !!hook?.compaction;
		const result = hook?.compaction ?? await session._runDefaultCompaction(preparation, session.model, instructions, controller.signal, reason);
		controller.signal.throwIfAborted();
		const { summary, firstKeptEntryId, tokensBefore, details, usage } = result;
		const id = session.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension, usage);
		session.refreshContext();
		const estimatedTokensAfter = session.sessionManager.buildSessionProjection().messages.reduce((sum: number, message: any) => sum + Pi.estimateTokens(message), 0);
		await session.extensionRunner?.emit({
			type: "session_compact", compactionEntry: session.sessionManager.getEntry(id), fromExtension, reason, willRetry,
		});
		const saved = { ...result, estimatedTokensAfter };
		// End listeners may submit queued prompts; expose manual idle before notifying them.
		if (manual) { session[field] = undefined; session._resolveIdleWaitIfIdle(); }
		session._emit({ type: "compaction_end", reason, result: saved, aborted: false, willRetry });
		return manual ? saved : willRetry || session.agent.hasQueuedMessages();
	} catch (error) {
		const aborted = controller.signal.aborted || cancelled;
		const message = error instanceof Error ? error.message : String(error);
		const prefix = manual ? "Compaction failed" : reason === "overflow" ? "Context overflow recovery failed" : "Auto-compaction failed";
		const errorMessage = aborted ? undefined : `${prefix}: ${message}`;
		if (manual) { session[field] = undefined; session._resolveIdleWaitIfIdle(); }
		session._emit({ type: "compaction_end", reason, result: undefined, aborted, willRetry: false, errorMessage });
		await session._emitSessionCompactFailed({ reason, errorMessage, aborted, willRetry: false, fromExtension });
		if (manual) throw error;
		return false;
	} finally {
		if (session[field] === controller) session[field] = undefined;
		session._resolveIdleWaitIfIdle();
	}
}
