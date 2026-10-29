// Background compaction: at 65% of W, Pi's own summary generator runs off the critical path on a snapshot of the
// projected context. A ready and still fresh summary makes Pi's next checkpoint compact through its normal threshold
// path, which takes the ready result instead of asking the model. Everything else stays Pi's foreground compaction.
import { AsyncLocalStorage } from "node:async_hooks";
import * as Pi from "@earendil-works/pi-coding-agent";

export const BACKGROUND_PERCENT = 0.65;
/** Status channel on the session's `pi.events`: `{ sessionId, active }`. */
export const BACKGROUND_EVENT = "rqw-context:background-compaction";
/** Per-session dispatch before a background summary request, `{ type, signal }`, so transports can route it. */
export const BACKGROUND_SUMMARY = "rqw:background-summary:v1";

type Message = { role: string; [key: string]: any };
type Entry = { id: string; type: string; [key: string]: any };
type Projected = { sourceEntry: Entry; messages: Message[] };
type FileOps = { read: Set<string>; written: Set<string>; edited: Set<string> };
type Settings = { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
type Result = { summary: string; firstKeptEntryId: string; tokensBefore: number; [key: string]: unknown };
type Events = { emit(channel: string, data: unknown): void };
type SessionManagerLike = { getBranch(): Entry[]; getSessionId(): string };
export type BackgroundSession = {
	sessionManager: SessionManagerLike;
	settingsManager: { getCompactionSettings(model: any): Settings };
	model?: unknown;
	extensionRunner?: { emit(event: unknown): Promise<unknown> };
	getContextUsage(): { tokens: number | null } | undefined;
	_runDefaultCompaction(...args: any[]): Promise<Result>;
};

export type Snapshot = {
	preparation: {
		firstKeptEntryId: string; messagesToSummarize: Message[]; turnPrefixMessages: Message[]; isSplitTurn: boolean;
		tokensBefore: number; previousSummary?: string; fileOps: FileOps; settings: Settings;
	};
	keptId: string;
	/** Previous compaction and every projected source id before the cut, including omitted ones. */
	dependencyIds: Set<string>;
	/** Serialized previous compaction plus summarized projected inputs, in order. */
	inputSignature: string;
};
type Candidate = Omit<Snapshot, "preparation"> & {
	base: string | null; leafId: string | undefined; controller: AbortController; result?: Result;
	/** Reports the end of this request on the status channel, once, however and whenever it ends. */
	close?: () => void;
};

// Shared across /reload: the process-wide wrappers of an earlier module instance read the same state.
const STATE = Symbol.for("rqw-context/background");
const shared = globalThis as { [STATE]?: {
	on: boolean; own: AsyncLocalStorage<true>; candidates: WeakMap<object, Candidate>; events: WeakMap<object, Events>;
} };
const state = (shared[STATE] ??= { on: false, own: new AsyncLocalStorage(), candidates: new WeakMap(), events: new WeakMap() });

// ---------------------------------------------------------------------------------------------------------------
// Copy of Pi 1.4.0 projected preparation. Neither the npm root nor the compiled pi.exe bundle exports these helpers:
// compaction.js:16-51 extractFileOperations and getMessagesFromProjectedEntryForCompaction, :253-279
// isCutPointMessage and isTurnStartMessage, :543-607 the projected cut, :609-665 prepareCompaction;
// utils.js:5-52 file operations. Oracle tests compare the result with Pi's prepareCompaction on every Pi update.

function isCutPointMessage(message: Message): boolean {
	switch (message.role) {
		case "user": case "assistant": case "bashExecution": case "custom": case "branchSummary": case "compactionSummary":
			return true;
	}
	return false;
}

function isTurnStartMessage(message: Message): boolean {
	switch (message.role) {
		case "user": case "bashExecution": case "custom": case "branchSummary": case "compactionSummary":
			return true;
	}
	return false;
}

const isProjectedTurnStart = (entry: Projected) =>
	entry.sourceEntry.type !== "compaction" && entry.messages.some(isTurnStartMessage);

function findProjectedTurnStartIndex(entries: Projected[], entryIndex: number, startIndex: number): number {
	for (let i = entryIndex; i >= startIndex; i--) if (isProjectedTurnStart(entries[i])) return i;
	return -1;
}

function findProjectedCutPoint(entries: Projected[], startIndex: number, endIndex: number, keepRecentTokens: number) {
	const cutPoints: number[] = [];
	for (let i = startIndex; i < endIndex; i++) {
		const entry = entries[i];
		if (entry.sourceEntry.type !== "compaction" && entry.messages.some(isCutPointMessage)) cutPoints.push(i);
	}
	if (cutPoints.length === 0) return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
	let accumulatedTokens = 0;
	let exceededBudget = false;
	let cutIndex = cutPoints[0];
	for (let i = endIndex - 1; i >= startIndex; i--) {
		const messageTokens = entries[i].messages.reduce((sum, message) => sum + Pi.estimateTokens(message as never), 0);
		if (messageTokens === 0) continue;
		accumulatedTokens += messageTokens;
		if (accumulatedTokens >= keepRecentTokens) {
			exceededBudget = true;
			cutIndex = cutPoints.find((candidate) => candidate >= i) ?? cutPoints[cutPoints.length - 1];
			break;
		}
	}
	// A closed suffix of a recovery attempt and its omission edits moves the cut past it, as in Pi.
	const suffix = entries.slice(cutIndex + 1, endIndex);
	const isIntrinsicallyVisible = (entry: Projected) =>
		entry.sourceEntry.type !== "context_edit" && Pi.sessionEntryToContextMessages(entry.sourceEntry as never).length > 0;
	const isOmitted = (entry: Projected) => isIntrinsicallyVisible(entry) && entry.messages.length === 0;
	const omittedSuffixIds = new Set(suffix.filter(isOmitted).map((entry) => entry.sourceEntry.id));
	const hasExternalReplacement = suffix.some((entry) => entry.sourceEntry.type === "context_edit" &&
		entry.sourceEntry.replacement !== null && !omittedSuffixIds.has(entry.sourceEntry.targetId));
	const isRecoveryOmissionSuffix = exceededBudget && !hasExternalReplacement &&
		suffix.some((entry) => entry.sourceEntry.type === "message" && entry.sourceEntry.message.role === "assistant" && isOmitted(entry)) &&
		suffix.every((entry) => entry.sourceEntry.type !== "compaction" && (!isIntrinsicallyVisible(entry) || isOmitted(entry)));
	if (isRecoveryOmissionSuffix) cutIndex++;
	while (cutIndex > startIndex) {
		const previous = entries[cutIndex - 1];
		if (previous.sourceEntry.type === "compaction" || previous.messages.length > 0) break;
		cutIndex--;
	}
	const startsTurn = isProjectedTurnStart(entries[cutIndex]);
	const turnStartIndex = startsTurn ? -1 : findProjectedTurnStartIndex(entries, cutIndex, startIndex);
	return { firstKeptEntryIndex: cutIndex, turnStartIndex, isSplitTurn: !startsTurn && turnStartIndex !== -1 };
}

/** System messages are prompt state and compaction entries carry their own replay, as in Pi. */
const compactionMessages = (entry: Projected) =>
	entry.sourceEntry.type === "compaction" ? [] : entry.messages.filter((message) => message.role !== "system");

function addFileOp(toolName: string, args: any, fileOps: FileOps): void {
	const path = typeof args?.path === "string" ? args.path : undefined;
	if (!path) return;
	if (toolName === "read") fileOps.read.add(path);
	else if (toolName === "write") fileOps.written.add(path);
	else if (toolName === "edit") fileOps.edited.add(path);
}

function extractFileOpsFromMessage(message: Message, fileOps: FileOps): void {
	if (message.role === "toolResult") {
		// Calls made from codemode scripts are recorded on the script's result.
		for (const call of message.nestedCalls?.calls ?? []) addFileOp(call.name, call.arguments, fileOps);
		return;
	}
	if (message.role !== "assistant" || !Array.isArray(message.content)) return;
	for (const block of message.content) {
		if (typeof block !== "object" || block === null || block.type !== "toolCall") continue;
		if (!("arguments" in block) || !("name" in block)) continue;
		addFileOp(block.name, block.arguments, fileOps);
	}
}

// ---------------------------------------------------------------------------------------------------------------

/** The newest projected compaction and the first projected index after it, as Pi's preparation derives them. */
function boundary(projected: Projected[]) {
	const previousIndex = projected.findIndex((entry) => entry.sourceEntry.type === "compaction" && entry.messages.length > 0);
	return { previous: previousIndex >= 0 ? projected[previousIndex].sourceEntry : undefined, start: previousIndex + 1 };
}

const signatureOf = (previous: Entry | undefined, inputs: Projected[]) =>
	JSON.stringify([previous ?? null, inputs.map((entry) => [entry.sourceEntry.id, compactionMessages(entry)])]);

/** Pi's projected preparation of `branch`, plus what a later freshness check compares. */
export function prepareSnapshot(branch: Entry[], settings: Settings, tokensBefore: number): Snapshot | undefined {
	if (branch.at(-1)?.type === "compaction") return undefined;
	const projected = Pi.buildSessionProjection(branch as never).entries as unknown as Projected[];
	const { previous, start } = boundary(projected);
	const cut = findProjectedCutPoint(projected, start, projected.length, settings.keepRecentTokens);
	const keptId = projected[cut.firstKeptEntryIndex]?.sourceEntry.id;
	if (!keptId) return undefined;
	const historyEnd = cut.isSplitTurn ? cut.turnStartIndex : cut.firstKeptEntryIndex;
	const messagesToSummarize = projected.slice(start, historyEnd).flatMap(compactionMessages);
	const turnPrefixMessages = cut.isSplitTurn
		? projected.slice(cut.turnStartIndex, cut.firstKeptEntryIndex).flatMap(compactionMessages) : [];
	if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) return undefined;
	// Only the summarized messages and the previous Pi-generated details; operations of the retained tail stay out.
	const fileOps: FileOps = { read: new Set(), written: new Set(), edited: new Set() };
	if (previous && !previous.fromHook && previous.details) {
		const details = previous.details;
		if (Array.isArray(details.readFiles)) for (const file of details.readFiles) fileOps.read.add(file);
		if (Array.isArray(details.modifiedFiles)) for (const file of details.modifiedFiles) fileOps.edited.add(file);
	}
	for (const message of [...messagesToSummarize, ...turnPrefixMessages]) extractFileOpsFromMessage(message, fileOps);
	const inputs = projected.slice(start, cut.firstKeptEntryIndex);
	return {
		preparation: {
			firstKeptEntryId: keptId, messagesToSummarize, turnPrefixMessages, isSplitTurn: cut.isSplitTurn,
			tokensBefore, previousSummary: previous?.summary, fileOps, settings,
		},
		keptId,
		dependencyIds: new Set([...(previous ? [previous.id] : []), ...inputs.map((entry) => entry.sourceEntry.id)]),
		inputSignature: signatureOf(previous, inputs),
	};
}

/** The ready summary still describes exactly the current inputs before its cut. */
function fresh(manager: SessionManagerLike, candidate: Candidate): boolean {
	if (!candidate.result) return false;
	const branch = manager.getBranch();
	if ((Pi.getLatestCompactionEntry(branch as never)?.id ?? null) !== candidate.base) return false;
	const leafIndex = branch.findIndex((entry) => entry.id === candidate.leafId);
	if (leafIndex < 0) return false;
	// Pi ignores some edits, such as content on the base compaction; any edit of a dependency is stale anyway.
	if (branch.slice(leafIndex + 1).some((entry) => entry.type === "context_edit" && candidate.dependencyIds.has(entry.targetId))) {
		return false;
	}
	const projected = Pi.buildSessionProjection(branch as never).entries as unknown as Projected[];
	const keptIndex = projected.findIndex((entry) => entry.sourceEntry.id === candidate.keptId);
	const { previous, start } = boundary(projected);
	return keptIndex >= start && signatureOf(previous, projected.slice(start, keptIndex)) === candidate.inputSignature;
}

function cancel(candidate: Candidate | undefined): void {
	if (!candidate) return;
	candidate.result = undefined;
	candidate.controller.abort();
	candidate.close?.();
}

/**
 * Pi enters a compaction path. Anything but taking a ready, fresh summary at the threshold ends the background request
 * now, also when a `session_before_compact` handler cancels or supplies its own compaction and Pi never asks the generator.
 */
export function supersede(session: BackgroundSession, reason: unknown): void {
	const candidate = state.candidates.get(session.sessionManager);
	if (candidate && !(reason === "threshold" && ready(session))) cancel(candidate);
}

/** Checkpoint force: a ready summary that is still fresh. Costs nothing without a ready result. */
export function ready(session: BackgroundSession): boolean {
	const candidate = state.candidates.get(session.sessionManager);
	return candidate?.result !== undefined && fresh(session.sessionManager, candidate);
}

/**
 * Called at Pi's checkpoints after they declined compaction, inside the checkpoint's physical scope.
 * At most one attempt per compaction generation; never awaited.
 */
export function maybeStart(session: BackgroundSession, physical: unknown): void {
	if (!state.on) return;
	const manager = session.sessionManager;
	const branch = manager.getBranch();
	const base = Pi.getLatestCompactionEntry(branch as never)?.id ?? null;
	const previous = state.candidates.get(manager);
	if (previous?.base === base) return;
	const window = (physical as { contextWindow?: unknown } | undefined)?.contextWindow;
	if (typeof window !== "number" || !(window > 0)) return;
	const settings = session.settingsManager.getCompactionSettings(session.model);
	if (!settings.enabled) return;
	const tokens = session.getContextUsage()?.tokens;
	if (typeof tokens !== "number" || tokens < BACKGROUND_PERCENT * window || Pi.shouldCompact(tokens, window, settings as never)) return;
	cancel(previous);
	const snapshot = prepareSnapshot(branch, settings, tokens);
	const controller = new AbortController();
	const { preparation, ...rest } = snapshot ?? { keptId: "", dependencyIds: new Set<string>(), inputSignature: "" };
	const candidate: Candidate = { ...rest, base, leafId: branch.at(-1)?.id, controller };
	// Recorded even without input, so this generation costs nothing more at later checkpoints.
	state.candidates.set(manager, candidate);
	if (!preparation) return;
	const sessionId = manager.getSessionId();
	const events = state.events.get(manager);
	let open = true;
	candidate.close = () => {
		if (!open) return;
		open = false;
		events?.emit(BACKGROUND_EVENT, { sessionId, active: false });
	};
	events?.emit(BACKGROUND_EVENT, { sessionId, active: true });
	state.own.run(true, async () => {
		await session.extensionRunner?.emit({ type: BACKGROUND_SUMMARY, signal: controller.signal });
		controller.signal.throwIfAborted();
		return session._runDefaultCompaction(preparation, session.model, undefined, controller.signal, "threshold");
	}).then((result) => {
		if (!controller.signal.aborted) candidate.result = result;
	}, () => {}).finally(() => {
		// Releases any route registered for this signal.
		controller.abort();
		candidate.close?.();
	});
}

type Generator = BackgroundSession["_runDefaultCompaction"];
const WRAPPED_GENERATOR = Symbol.for("rqw-context/_runDefaultCompaction");
const WRAPPED_DISPOSE = Symbol.for("rqw-context/dispose");

/**
 * Installs the summary generator seam when Pi has it. Without it background compaction stays off and W/R works as
 * before. No arity check: RQW-anthropic wraps the same method with rest arguments.
 */
export function installBackground(proto: Record<string | symbol, any>, owned: () => boolean): void {
	const descriptor = Object.getOwnPropertyDescriptor(proto, "_runDefaultCompaction");
	const disposal = Object.getOwnPropertyDescriptor(proto, "dispose");
	const exports = [Pi.buildSessionProjection, Pi.getLatestCompactionEntry, Pi.estimateTokens, Pi.sessionEntryToContextMessages, Pi.shouldCompact];
	if (proto[WRAPPED_GENERATOR]) { state.on = true; return; }
	if (typeof descriptor?.value !== "function" || !descriptor.configurable || !descriptor.writable ||
		typeof disposal?.value !== "function" || !disposal.configurable || !disposal.writable ||
		typeof proto.getContextUsage !== "function" || exports.some((value) => typeof value !== "function")) {
		state.on = false;
		return;
	}
	const original = descriptor.value as Generator;
	proto._runDefaultCompaction = function (this: BackgroundSession, ...args: any[]) {
		if (!owned() || state.own.getStore()) return original.apply(this, args);
		const [preparation, , , , reason] = args as [{ tokensBefore: number }, unknown, unknown, unknown, string];
		const candidate = state.candidates.get(this.sessionManager);
		// Checked again here: session_before_compact handlers ran after the checkpoint.
		if (reason === "threshold" && candidate?.result && fresh(this.sessionManager, candidate)) {
			const result = candidate.result;
			candidate.result = undefined;
			return Promise.resolve({ ...result, firstKeptEntryId: candidate.keptId, tokensBefore: preparation.tokensBefore });
		}
		// Manual, overflow, not ready or stale: Pi compacts normally, without waiting.
		cancel(candidate);
		return original.apply(this, args);
	};
	proto[WRAPPED_GENERATOR] = original;
	// A disposed session, such as a stopped subagent, emits no shutdown event but must stop spending.
	const dispose = disposal.value as (this: BackgroundSession, ...args: any[]) => unknown;
	proto.dispose = function (this: BackgroundSession, ...args: any[]) {
		cancel(state.candidates.get(this.sessionManager));
		return dispose.apply(this, args);
	};
	proto[WRAPPED_DISPOSE] = dispose;
	state.on = true;
}

/** Session lifecycle of one extension instance: the status channel and the shutdown abort. */
export function bindBackground(on: (event: string, handler: (event: unknown, ctx: any) => void) => void, events: Events): void {
	on("session_start", (_event, ctx) => { state.events.set(ctx.sessionManager, events); });
	on("session_shutdown", (_event, ctx) => cancel(state.candidates.get(ctx.sessionManager)));
}
