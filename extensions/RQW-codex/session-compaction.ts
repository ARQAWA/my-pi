// RQW-codex: per-session compaction hook for the real Pi AgentSession (Pi 1.4.0 only). Only the openai-codex model on
// the openai-codex-responses API is affected. For that model, compact() and the automatic paths run the native backend
// compaction (compactBackend) instead of Pi's text summary, and never append a Pi compaction entry: the checkpoint is
// the custom wire entry written by WireHistory.installCompaction. Every other model delegates to the original method.
// Imports: Pi SDK types/runtime, this folder and Node built-ins only.
import { type AgentSession, shouldCompact, VERSION } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

import { type CompactOptions, type CompactResult, compactBackend } from "./compaction.ts";

/** The only Pi release whose private compaction methods this hook is written against. */
export const PI_HOOK_VERSION = "1.4.0";
export const CODEX_HOOK_PROVIDER = "openai-codex";
export const CODEX_HOOK_API = "openai-codex-responses";

/** Instance methods of AgentSession that this hook replaces (checked before patching). */
const PATCHED_METHODS = [
	"compact",
	"_runAutoCompaction",
	"_exceedsCompactionThreshold",
	"_checkCompaction",
	"_compactBeforeNextAssistantResponse",
	"getContextUsage",
] as const;

export type CompactionHookPrepareInput = {
	reason: "manual" | "threshold" | "overflow";
	/** Native phase of this operation. The hook always supplies it; absent only for callers that build the input themselves. */
	phase?: "pre_turn" | "mid_turn" | "standalone_turn";
	customInstructions?: string;
	signal: AbortSignal;
};

export type CompactionHookOptions = {
	/** Builds the backend compaction input (history, request, transport) for this run. */
	prepare: (input: CompactionHookPrepareInput) => Promise<CompactOptions>;
	/** Wire-history token estimate for the model, or undefined when no valid Codex checkpoint exists on this branch. */
	projectTokens: (model: Model<Api>) => number | undefined;
	/** Called after an accepted native checkpoint. */
	onInstalled?: (result: CompactResult) => void;
};

/** Private AgentSession surface used by the hook (Pi 1.4.0). */
type SessionInternals = {
	_compactionAbortController?: AbortController;
	_autoCompactionAbortController?: AbortController;
	_emit(event: Record<string, unknown>): void;
	_emitSessionCompactFailed(event: Record<string, unknown>): Promise<void>;
	_clearManualCompactionState?(): void;
	_resolveIdleWaitIfIdle?(): void;
	settingsManager: { getCompactionSettings(model: unknown): { enabled: boolean; reserveTokens: number; keepRecentTokens: number } };
	agent: { hasQueuedMessages(): boolean };
	model?: Model<Api>;
	abort(): Promise<void>;
	[key: string]: unknown;
};

type Patchable = Record<string, unknown>;

function piVersion(): string {
	return VERSION;
}

function isCodexModel(model: { provider?: string; api?: string } | undefined): boolean {
	return model?.provider === CODEX_HOOK_PROVIDER && model?.api === CODEX_HOOK_API;
}

/**
 * Installs the compaction hook on one AgentSession and returns its release function. Throws before any patch when the
 * Pi version or a patched method is not the expected one. Release restores every instance slot to its prior state and
 * aborts active backend work started by this hook.
 */
export function installSessionCompaction(session: AgentSession, options: CompactionHookOptions): () => void {
	if (piVersion() !== PI_HOOK_VERSION) {
		throw new Error(`RQW-codex compaction hook: Pi ${PI_HOOK_VERSION} required, found ${piVersion()}`);
	}
	const target = session as unknown as Patchable;
	const internals = session as unknown as SessionInternals;
	for (const name of PATCHED_METHODS) {
		if (typeof target[name] !== "function") throw new Error(`RQW-codex compaction hook: session has no method ${name}`);
	}
	if (typeof internals._emit !== "function" || typeof internals._emitSessionCompactFailed !== "function") {
		throw new Error("RQW-codex compaction hook: session has no event emitter");
	}

	// Snapshot of the prior own slots (or absence) and of the original functions, taken before any patch.
	const prior = new Map<string, PropertyDescriptor | undefined>();
	const originals = new Map<string, (...args: unknown[]) => unknown>();
	for (const name of PATCHED_METHODS) {
		prior.set(name, Object.getOwnPropertyDescriptor(target, name));
		originals.set(name, target[name] as (...args: unknown[]) => unknown);
	}

	const active = new Set<AbortController>();
	let released = false;
	// Reentrant depth of Pi's post-sampling check (_checkCompaction with the default skipAbortedCheck, called after a turn).
	// Pi's preflight calls _checkCompaction(message, false) before the run, so it is not counted here.
	let postCheckDepth = 0;
	// Reentrant depth of Pi's check before a follow-up sampling of the same run (agent-loop prepareNextTurn, called only
	// after a completed turn): native compacts there mid_turn, inside the active user turn.
	let nextResponseDepth = 0;

	const isCodexSession = (): boolean => isCodexModel(internals.model);

	const emitEvent = (event: Record<string, unknown>) => internals._emit(event);

	const finish = () => {
		internals._resolveIdleWaitIfIdle?.();
	};

	/** Runs one backend compaction: prepare, native checkpoint, abort-aware. Throws on failure or abort. */
	async function runBackend(
		reason: CompactionHookPrepareInput["reason"],
		phase: NonNullable<CompactionHookPrepareInput["phase"]>,
		customInstructions: string | undefined,
		controller: AbortController,
	): Promise<CompactResult> {
		active.add(controller);
		try {
			const compactOptions = await options.prepare({ reason, phase, customInstructions, signal: controller.signal });
			controller.signal.throwIfAborted();
			const result = await compactBackend({ ...compactOptions, signal: controller.signal });
			return result;
		} finally {
			active.delete(controller);
		}
	}

	const hookCompact = async function (customInstructions?: string) {
		if (released || !isCodexSession()) return originals.get("compact")!.call(session, customInstructions);
		await internals.abort();
		const controller = new AbortController();
		internals._compactionAbortController = controller;
		emitEvent({ type: "compaction_start", reason: "manual" });
		const model = internals.model!;
		try {
			const tokensBefore = options.projectTokens(model) ?? 0;
			const result = await runBackend("manual", "standalone_turn", customInstructions, controller);
			const tokensAfter = options.projectTokens(model) ?? 0;
			const compactionResult = {
				// Display placeholder only: no Pi compaction entry is appended, so this text never enters model context.
				summary: `Native compaction checkpoint ${result.entryId}`,
				firstKeptEntryId: result.entryId,
				tokensBefore,
				estimatedTokensAfter: tokensAfter,
				usage: result.usage,
				details: { checkpointEntryId: result.entryId, responseId: result.responseId, window: result.window, native: true },
			};
			internals._compactionAbortController = undefined;
			internals._clearManualCompactionState?.();
			emitEvent({ type: "compaction_end", reason: "manual", result: compactionResult, aborted: false, willRetry: false });
			options.onInstalled?.(result);
			return compactionResult;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const aborted = controller.signal.aborted;
			const errorMessage = aborted ? undefined : `Compaction failed: ${message}`;
			internals._compactionAbortController = undefined;
			internals._clearManualCompactionState?.();
			emitEvent({ type: "compaction_end", reason: "manual", result: undefined, aborted, willRetry: false, errorMessage });
			await internals._emitSessionCompactFailed({ reason: "manual", errorMessage, aborted, willRetry: false, fromExtension: false });
			throw error;
		} finally {
			if (internals._compactionAbortController === controller) internals._compactionAbortController = undefined;
			finish();
		}
	};

	const hookRunAutoCompaction = async function (reason: "threshold" | "overflow", willRetry: boolean): Promise<boolean> {
		if (released || !isCodexSession()) return originals.get("_runAutoCompaction")!.call(session, reason, willRetry) as Promise<boolean>;
		const model = internals.model!;
		if (!internals.settingsManager.getCompactionSettings(model).enabled) return false;
		const controller = new AbortController();
		internals._autoCompactionAbortController = controller;
		let started = false;
		let aborted = false;
		try {
			started = true;
			emitEvent({ type: "compaction_start", reason });
			const tokensBefore = options.projectTokens(model) ?? 0;
			// Overflow, post-sampling and follow-up-sampling checks are mid-turn; a threshold check outside them is the preflight before the turn.
			const phase = reason === "overflow" || postCheckDepth > 0 || nextResponseDepth > 0 ? "mid_turn" : "pre_turn";
			const result = await runBackend(reason, phase, undefined, controller);
			const tokensAfter = options.projectTokens(model) ?? 0;
			const compactionResult = {
				summary: `Native compaction checkpoint ${result.entryId}`,
				firstKeptEntryId: result.entryId,
				tokensBefore,
				estimatedTokensAfter: tokensAfter,
				usage: result.usage,
				details: { checkpointEntryId: result.entryId, responseId: result.responseId, window: result.window, native: true },
			};
			emitEvent({ type: "compaction_end", reason, result: compactionResult, aborted: false, willRetry });
			options.onInstalled?.(result);
			if (willRetry) return true;
			return internals.agent.hasQueuedMessages();
		} catch (error) {
			const message = error instanceof Error ? error.message : "compaction failed";
			aborted = controller.signal.aborted;
			if (started) {
				const errorMessage = aborted
					? undefined
					: reason === "overflow"
						? `Context overflow recovery failed: ${message}`
						: `Auto-compaction failed: ${message}`;
				emitEvent({ type: "compaction_end", reason, result: undefined, aborted, willRetry: false, errorMessage });
				await internals._emitSessionCompactFailed({ reason, errorMessage, aborted, willRetry: false, fromExtension: false });
			}
			return false;
		} finally {
			if (internals._autoCompactionAbortController === controller) internals._autoCompactionAbortController = undefined;
			finish();
		}
	};

	const hookExceedsThreshold = function (modelArg: Model<Api>, projection: unknown): boolean {
		const original = originals.get("_exceedsCompactionThreshold")!;
		if (released || !isCodexSession()) return original.call(session, modelArg, projection) as boolean;
		const tokens = options.projectTokens(internals.model!);
		if (tokens === undefined) return original.call(session, modelArg, projection) as boolean;
		if (modelArg.contextWindow <= 0) return false;
		return shouldCompact(tokens, modelArg.contextWindow, internals.settingsManager.getCompactionSettings(modelArg));
	};

	// Pi calls this with the default skipAbortedCheck (true) after a turn and with false before it (preflight): only the former is post-sampling.
	const hookCheckCompaction = async function (
		assistantMessage: { stopReason?: string },
		skipAbortedCheck: boolean = true,
	): Promise<boolean> {
		const original = originals.get("_checkCompaction")!;
		const model = internals.model;
		const post = skipAbortedCheck === true;
		if (post) postCheckDepth++;
		try {
			if (released || !isCodexModel(model)) return await (original.call(session, assistantMessage, skipAbortedCheck) as Promise<boolean>);
			const tokens = options.projectTokens(model!);
			// No valid checkpoint, or an explicit overflow / length stop: Pi's native recovery decides.
			if (tokens === undefined || assistantMessage.stopReason === "error" || assistantMessage.stopReason === "length") {
				return await (original.call(session, assistantMessage, skipAbortedCheck) as Promise<boolean>);
			}
			if (!internals.settingsManager.getCompactionSettings(model).enabled) return false;
			if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return false;
			if (shouldCompact(tokens, model!.contextWindow, internals.settingsManager.getCompactionSettings(model))) {
				return await hookRunAutoCompaction("threshold", false);
			}
			return false;
		} finally {
			if (post) postCheckDepth--;
		}
	};

	const hookCompactBeforeNextAssistantResponse = async function (context: unknown): Promise<unknown> {
		nextResponseDepth++;
		try {
			return await (originals.get("_compactBeforeNextAssistantResponse")!.call(session, context) as Promise<unknown>);
		} finally {
			nextResponseDepth--;
		}
	};

	const hookGetContextUsage = function () {
		const original = originals.get("getContextUsage")!;
		const usage = original.call(session) as { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
		const model = internals.model;
		if (released || !isCodexModel(model) || !model || model.contextWindow <= 0) return usage;
		const tokens = options.projectTokens(model);
		if (tokens === undefined) return usage;
		// Returns a new object; Pi's usage, cost and session entries are never mutated.
		return {
			tokens,
			contextWindow: model.contextWindow,
			percent: (tokens / model.contextWindow) * 100,
		};
	};

	const replacements: Record<(typeof PATCHED_METHODS)[number], (...args: unknown[]) => unknown> = {
		compact: hookCompact as never,
		_runAutoCompaction: hookRunAutoCompaction as never,
		_exceedsCompactionThreshold: hookExceedsThreshold as never,
		_checkCompaction: hookCheckCompaction as never,
		_compactBeforeNextAssistantResponse: hookCompactBeforeNextAssistantResponse as never,
		getContextUsage: hookGetContextUsage as never,
	};
	for (const name of PATCHED_METHODS) {
		Object.defineProperty(target, name, { value: replacements[name], writable: true, configurable: true, enumerable: false });
	}

	return () => {
		if (released) return;
		released = true;
		for (const controller of active) controller.abort();
		active.clear();
		for (const name of PATCHED_METHODS) {
			const before = prior.get(name);
			if (before) Object.defineProperty(target, name, before);
			else delete target[name];
		}
	};
}
