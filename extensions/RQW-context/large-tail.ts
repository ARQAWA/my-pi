// Huge-tail compaction bypasses Pi's module-bound prepareCompaction, not its summary generator or session format.
import * as Pi from "@earendil-works/pi-coding-agent";
import { prepareSnapshot } from "./background.ts";
import { installHook, isHooked } from "./hooks.ts";
import { projectSession } from "./projection.ts";

type Session = Record<string, any>;

/** Guard the actual manager class, including the one used by Pi's bundled runtime. */
export function installManagerProjection(manager: Session, owned: () => boolean): void {
	const proto = Object.getPrototypeOf(manager);
	if (!proto || typeof manager.getEntries !== "function" || typeof manager.getLeafId !== "function") return;
	const names = ["buildSessionProjection", "buildContextEntries"] as const;
	const descriptors = names.map(name => Object.getOwnPropertyDescriptor(proto, name));
	if (names.some((name, i) => !isHooked(proto, name) &&
		(typeof descriptors[i]?.value !== "function" || !descriptors[i]?.configurable || !descriptors[i]?.writable))) return;
	if (names.some(name => !isHooked(proto, name))) {
		const timestamp = "2026-01-01T00:00:00.000Z";
		const entries = [
			{ id: "a", parentId: null, type: "message", timestamp, message: { role: "user", content: "one", timestamp: 1 } },
			{ id: "c", parentId: "a", type: "compaction", timestamp, summary: "sum", firstKeptEntryId: "a", tokensBefore: 1 },
			{ id: "b", parentId: "c", type: "message", timestamp, message: { role: "user", content: "two", timestamp: 1 } },
			{ id: "e", parentId: "b", type: "context_edit", timestamp, targetId: "b", replacement: { content: "edited" } },
		];
		const sample = { getEntries: () => entries, getLeafId: () => "e", leafId: "e", byId: new Map(entries.map(entry => [entry.id, entry])) };
		try {
			const expected = projectSession(entries, "e");
			for (const [i, name] of names.entries()) {
				if (isHooked(proto, name)) continue;
				const result = name === "buildContextEntries" ? expected.entries.map(entry => entry.sourceEntry) : expected;
				if (JSON.stringify(descriptors[i]!.value.call(sample)) !== JSON.stringify(result)) return;
			}
		} catch { return; }
	}
	for (const name of names) {
		installHook(proto, name, "value", (original: Function) => function (this: Session) {
			try { return original.call(this); }
			catch (error) {
				if (!owned() || !(error instanceof RangeError)) throw error;
				const projection = projectSession(this.getEntries(), this.getLeafId());
				return name === "buildContextEntries" ? projection.entries.map(entry => entry.sourceEntry) : projection;
			}
		});
	}
}

/** Leave ordinary sessions and unsupported Pi shapes on their native path. */
export function compactSafeTail(session: Session, stock: () => any, reason: string, willRetry: boolean, instructions?: string): any {
	const methods = ["abort", "getContextUsage", "refreshContext", "_emit", "_emitSessionCompactFailed", "_resolveIdleWaitIfIdle", "_runDefaultCompaction"];
	const manager = session.sessionManager;
	if (!manager || !isHooked(Object.getPrototypeOf(manager), "buildSessionProjection") || methods.some((name) => typeof session[name] !== "function") ||
		["appendCompaction", "getEntry", "getBranch", "buildSessionProjection"].some((name) => typeof session.sessionManager?.[name] !== "function") ||
		typeof session.agent?.hasQueuedMessages !== "function") return stock();
	try {
		Pi.buildSessionProjection(session.sessionManager.getBranch());
	} catch (error) {
		if (error instanceof RangeError) {
			try { projectSession(session.sessionManager.getBranch()); }
			catch { return stock(); }
			return run(session, reason, willRetry, instructions);
		}
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
