// RQW-codex stage 5: durable session-to-wire state adapter for one real Pi AgentSession (Pi 1.4.0 SessionManager).
// Native raw items, checkpoints, seeds, effort pins and the window id are versioned custom entries beside Pi's physical
// entries; Pi entries are only appended to, never rewritten or omitted here. Physical source messages (user, system,
// toolResult, and assistant messages without recorded raw items) reach the wire once: the source cursor is the set of
// source entry ids the durable wire already holds on the current branch. A fork adopts its parent's entries only when
// the real parent file proves the ancestry. Imports: Pi SDK types, this folder and Node built-ins only.
import { existsSync, readFileSync } from "node:fs";
import {
	buildSessionProjection,
	convertToLlm,
	sessionEntryToContextMessages,
	type AgentSession,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { Api, Context, Message, Model, Tool } from "@earendil-works/pi-ai";

import { estimateItemTokens, uuidv7 } from "./compaction.ts";
import {
	callPairKey,
	canonicalJson,
	HISTORY_CUSTOM_TYPE,
	HISTORY_VERSION,
	isCallItem,
	normalizeCallId,
	scopeDigest,
	sha256Hex,
	sourceEntryDigest,
	WireHistory,
	type WireSession,
	type WireSessionEntry,
	type WireWindow,
} from "./history.ts";
import type { CodexIdentity } from "./metadata.ts";
import type { RawItemHistory } from "./transport.ts";
import { CODEX_MODEL_SLUGS, codexModelCapabilities } from "./profile.ts";
import { buildRequest, prefixContext, toolWireFlags, transcriptItems, type WireItem, type WireModelInfo, type WireOptions } from "./wire.ts";

export type SessionWireOptions = {
	session: AgentSession;
	ownerId: string;
	modelHash: string;
	runtimeLeaseId?: string;
};

/** Settings of one native turn, recorded from the actual prepared turn request (never persisted: body, headers, auth). */
export type NativeTurnSettings = {
	model: string;
	compHash: string;
	contextWindow: number;
	inputModalities: ("text" | "image")[];
	supportsStrictMode: boolean;
	supportsOpenAIGrammarTools: boolean;
	reasoningEffort?: string;
	reasoningSummary?: "auto" | "concise" | "detailed" | "none";
	serviceTier?: string;
	turnId?: string;
};

/** Whitelists of the recorded turn settings: any other value is not persisted. */
const KNOWN_EFFORTS: ReadonlySet<unknown> = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const KNOWN_SUMMARIES: ReadonlySet<unknown> = new Set(["auto", "concise", "detailed", "none"]);
const KNOWN_SERVICE_TIERS: ReadonlySet<unknown> = new Set(["priority", "flex"]);

export type NativeInputArgs = {
	context: Context;
	model: Model<Api>;
	capabilities: WireModelInfo;
	options?: WireOptions;
};

/** Structural SessionManager surface (Pi's SessionManager satisfies it). */
type SessionManagerLike = WireSession & {
	getHeader(): { parentSession?: string } | null;
	getEntries(): SessionEntry[];
	getLeafId(): string | null;
	buildSessionProjection(): { entries: Array<{ sourceEntry: SessionEntry; messages: unknown[] }>; messages: unknown[] };
};

type OwnEntry = { id: string; index: number; scope: string; data: Record<string, unknown> };

type Coverage = { baseIndex: number; covered: Set<string>; responses: Set<string> };

const SOURCE_ROLES: ReadonlySet<string> = new Set(["user", "system", "toolResult", "assistant"]);

/** Pi's projected messages per raw entry id on the branch ending at leafId (edits and omissions applied). */
function projectedMessages(entries: SessionEntry[], leafId: string | null): Map<string, unknown[]> {
	const out = new Map<string, unknown[]>();
	for (const entry of buildSessionProjection(entries, leafId).entries) out.set(entry.sourceEntry.id, entry.messages);
	return out;
}

/**
 * The durable wire's view of Pi's branch: every raw entry carries projectedDigest, the digest of its CURRENT projected
 * messages (after context edits; a removed entry digests to []). A genuine edit or removal changes it, a same-content
 * edit does not. Entries that Pi's projection no longer shows (before a newer compaction) digest their raw messages.
 * Used by WireHistory and by the state's own scans, so both see the same digests.
 */
function projectedView(manager: SessionManagerLike): WireSession {
	return {
		appendCustomEntry: (customType, data) => manager.appendCustomEntry(customType, data),
		getLeafId: () => manager.getLeafId(),
		responseSourceState: (responseId) => responseSourceState(manager, responseId),
		pairedCalls: () => pairedCallKeys(manager),
		getBranch(fromId) {
			const projected = projectedMessages(manager.getEntries(), fromId ?? manager.getLeafId());
			return manager.getBranch(fromId).map((entry) => {
				if (isHistoryEntry(entry)) return entry;
				const messages = projected.get(entry.id) ?? sessionEntryToContextMessages(entry as unknown as SessionEntry);
				return { ...entry, projectedDigest: sha256Hex(canonicalJson(messages)) };
			});
		},
	};
}

/**
 * Pairs of raw calls and Pi results, in branch order: a toolResult pairs with a call of the nearest preceding assistant
 * message only when that message carries the response id and the call id (normalized). Same call ids may reuse across responses.
 */
function pairedCallKeys(manager: SessionManagerLike): Set<string> {
	const projected = projectedMessages(manager.getEntries(), manager.getLeafId());
	const out = new Set<string>();
	let responseId: string | undefined;
	let calls = new Set<string>();
	for (const entry of manager.getBranch()) {
		for (const message of projected.get(entry.id) ?? []) {
			const m = message as { role?: unknown; responseId?: unknown; content?: unknown; toolCallId?: unknown };
			if (m.role === "assistant") {
				responseId = typeof m.responseId === "string" ? m.responseId : undefined;
				calls = new Set(
					(Array.isArray(m.content) ? m.content : [])
						.filter((block: { type?: unknown; id?: unknown }) => block?.type === "toolCall" && typeof block.id === "string")
						.map((block: { id: string }) => normalizeCallId(block.id)),
				);
			} else if (m.role === "toolResult" && typeof m.toolCallId === "string" && responseId !== undefined) {
				const callId = normalizeCallId(m.toolCallId);
				if (calls.has(callId)) out.add(callPairKey(responseId, callId));
			}
		}
	}
	return out;
}

/** The physical assistant message of a raw response on the current branch (raw Pi entry), or undefined. */
function rawAssistantEntry(manager: SessionManagerLike, responseId: string): (SessionEntry & { message: { content?: unknown } }) | undefined {
	return manager.getBranch().find((entry) => {
		const message = (entry as { message?: { role?: unknown; responseId?: unknown } }).message;
		return entry.type === "message" && message?.role === "assistant" && message.responseId === responseId;
	}) as (SessionEntry & { message: { content?: unknown } }) | undefined;
}

/**
 * Current state of the assistant message behind a raw response: absent (no such message), deleted (Pi's projection shows
 * nothing for it), edited (its projected content differs from the original) or same.
 */
function responseSourceState(manager: SessionManagerLike, responseId: string): "absent" | "same" | "edited" | "deleted" {
	const raw = rawAssistantEntry(manager, responseId);
	if (!raw) return "absent";
	const projected = projectedMessages(manager.getEntries(), manager.getLeafId()).get(raw.id) ?? sessionEntryToContextMessages(raw);
	if (projected.length === 0) return "deleted";
	const current = projected.find((message) => (message as { role?: unknown; responseId?: unknown }).role === "assistant" && (message as { responseId?: unknown }).responseId === responseId) as { content?: unknown } | undefined;
	return canonicalJson(current?.content) === canonicalJson(raw.message.content) ? "same" : "edited";
}

/** Replays one entry's system tool changes into the running catalog: removals first, then additions, as Pi does. */
function foldSystemTools(catalog: Map<string, Tool>, messages: Array<{ role?: unknown }>): void {
	for (const message of messages as Array<Partial<Extract<Message, { role: "system" }>>>) {
		if (message.role !== "system") continue;
		for (const ref of message.toolsRemoved ?? []) catalog.delete(ref.name);
		for (const tool of message.toolsAdded ?? []) catalog.set(tool.name, tool);
	}
}

function verifyData(data: unknown): Record<string, unknown> | null {
	if (!data || typeof data !== "object") return null;
	const record = data as Record<string, unknown>;
	if (record.v !== HISTORY_VERSION || typeof record.digest !== "string") return null;
	const { digest, ...rest } = record;
	return sha256Hex(canonicalJson(rest)) === digest ? record : null;
}

function isHistoryEntry(entry: WireSessionEntry): boolean {
	return entry.type === "custom" && entry.customType === HISTORY_CUSTOM_TYPE;
}

function hasBase(loaded: { checkpointEntryId: string | null; items: unknown[] }): boolean {
	return loaded.checkpointEntryId !== null || loaded.items.length > 0;
}

function isCovered(entry: WireSessionEntry, index: number, coverage: Coverage): boolean {
	if (index < coverage.baseIndex || coverage.covered.has(entry.id)) return true;
	const message = (entry as { message?: { role?: unknown; responseId?: unknown } }).message;
	return message?.role === "assistant" && typeof message.responseId === "string" && coverage.responses.has(message.responseId);
}

/**
 * Fork adoption proof. Returns the parent's scope digest only when every foreign history entry on this branch is an
 * entry of the real parent file (same id and data) and carries the parent header id with this owner. Otherwise null,
 * and the foreign entries are not replayed.
 */
export function proveForkAdoption(manager: SessionManagerLike, threadId: string, ownerId: string): string | null {
	const parentPath = manager.getHeader()?.parentSession;
	if (!parentPath || !existsSync(parentPath)) return null;
	let parentId: string | undefined;
	const parentEntries = new Map<string, Record<string, unknown>>();
	for (const line of readFileSync(parentPath, "utf8").split("\n")) {
		if (line.trim() === "") continue;
		let record: Record<string, unknown>;
		try {
			record = JSON.parse(line) as Record<string, unknown>;
		} catch {
			return null;
		}
		if (record.type === "session") parentId ??= String(record.id);
		else if (typeof record.id === "string") parentEntries.set(record.id, record);
	}
	if (!parentId) return null;
	const parentScope = scopeDigest({ runtimeId: "", threadId: parentId, ownerId });
	const ownScope = scopeDigest({ runtimeId: "", threadId, ownerId });
	let foreign = 0;
	for (const entry of manager.getBranch()) {
		if (!isHistoryEntry(entry)) continue;
		const scope = (entry.data as { scope?: unknown } | undefined)?.scope;
		if (scope === ownScope) continue;
		const original = parentEntries.get(entry.id);
		if (scope !== parentScope || !original || canonicalJson(original.data) !== canonicalJson(entry.data)) return null;
		foreign++;
	}
	return foreign > 0 ? parentScope : null;
}

export class SessionWireState {
	readonly rawHistory: RawItemHistory;
	readonly #session: AgentSession;
	readonly #ownerId: string;
	readonly #modelHash: string;
	readonly #runtimeId: string;
	#scopeHash = "";
	#adopted: string[] = [];
	#history!: WireHistory;
	#view!: WireSession;
	#last: NativeInputArgs | undefined;
	/** Whether the last request's transcript equals Pi's effective projection; only then may it use or seed the base. */
	#trusted = false;

	constructor(options: SessionWireOptions) {
		this.#session = options.session;
		this.#ownerId = options.ownerId;
		this.#modelHash = options.modelHash;
		this.#runtimeId = options.runtimeLeaseId ?? "";
		this.#build();
		this.#ensureWindow();
		this.rawHistory = {
			rawOutputs: () => this.#rawOutputs(),
			recordOutputs: (responseId, items) => this.#recordOutputs(responseId, items),
			recordItem: (responseId, item) => this.#recordItem(responseId, item),
			preparedRequest: (body) => this.#preparedRequest(body),
			acceptRawResponse: (responseId, context) => this.#acceptRawResponse(responseId, context),
		};
	}

	/** Durable history of the current thread and owner (rebuilt by refresh()). */
	get history(): WireHistory {
		return this.#history;
	}

	/** Window of this thread: the accepted checkpoint's window when this thread made it, else the persisted initial one. */
	get window(): WireWindow {
		const loaded = this.#history.load();
		if (loaded.checkpointEntryId !== null && this.#scan().own.some((e) => e.id === loaded.checkpointEntryId && e.scope === this.#scopeHash)) {
			return loaded.window;
		}
		return this.#ownWindow() ?? { number: 0, id: null };
	}

	/** Pi entry ids the durable wire already holds (or a base covers) on the current branch, in branch order. */
	get sourceEntryIds(): string[] {
		const { branch, own } = this.#scan();
		const coverage = this.#coverage(own);
		const projected = projectedMessages(this.#manager().getEntries(), this.#manager().getLeafId());
		return branch
			.filter((entry, index) => !isHistoryEntry(entry) && (projected.get(entry.id)?.length ?? 0) > 0 && isCovered(entry, index, coverage))
			.map((entry) => entry.id);
	}

	/** Re-reads the session: adoption proof and history are recomputed from the current branch. */
	refresh(): void {
		this.#build();
		this.#ensureWindow();
	}

	/**
	 * Native input for the next request: fresh prefix, then the durable projection, after appending the new physical
	 * source messages. Returns undefined when there is no valid native base yet (the transport builds the request and
	 * preparedRequest seeds it) or when the branch history is not native (Pi's own history is used).
	 */
	nativeInput(args: NativeInputArgs): WireItem[] | undefined {
		this.#last = args;
		// A transcript the caller changed (context event, filter, shortened or edited request) is not Pi's effective projection:
		// this request gets no native base, and nothing from it is persisted.
		this.#trusted = this.#matchesProjection(args.context);
		if (!this.#trusted) return undefined;
		let loaded = this.#history.load();
		if (loaded.mode !== "native" || !hasBase(loaded)) return undefined;
		for (const { entry, items } of this.#pending(args)) {
			for (const item of items) {
				this.#history.appendEntry({ kind: "item", item: structuredClone(item), clientAuthored: false, sourceEntryId: entry.id, sourceDigest: sourceEntryDigest(entry) });
			}
		}
		this.#recordEffort(args);
		loaded = this.#history.load();
		return [...this.#prefix(args), ...loaded.items.map((envelope) => structuredClone(envelope.item))];
	}

	/**
	 * Read-only native input for an idle warm (automatic or explicit). The warm's transcript must be Pi's effective projection followed
	 * by exactly `known`: the request-time system messages the caller computed from the session (the pending SDK section and tool patch,
	 * never persisted). Any other difference is a rewrite, and the preview is undefined, as nativeInput treats it. Unlike nativeInput it
	 * persists nothing, changes no trust state and records no effort pin; the known messages become items only in the returned input.
	 */
	previewNativeInput(args: NativeInputArgs, known: readonly unknown[]): WireItem[] | undefined {
		if (canonicalJson([...this.#effectiveMessages(), ...known]) !== canonicalJson(args.context.messages ?? [])) return undefined;
		const loaded = this.#history.load();
		if (loaded.mode !== "native" || !hasBase(loaded)) return undefined;
		const { entries, transient } = this.#pendingWith(args, known);
		return [...this.#prefix(args), ...loaded.items.map((envelope) => structuredClone(envelope.item)), ...entries.flatMap(({ items }) => items), ...transient];
	}

	/** Settings of the latest verified turn of this owner and thread on the actual branch; undefined when absent. */
	get previousTurnSettings(): NativeTurnSettings | undefined {
		const latest = this.#scan().own.filter((entry) => entry.data.kind === "turn-settings").at(-1);
		return latest ? (structuredClone(latest.data.settings) as NativeTurnSettings) : undefined;
	}

	/** Estimated tokens of the native projection (estimated, not usage). Undefined without a valid checkpoint. */
	projectTokens(): number | undefined {
		const args = this.#last;
		if (!args) return undefined;
		const loaded = this.#history.load();
		if (loaded.mode !== "native" || loaded.checkpointEntryId === null) return undefined;
		let tokens = 0;
		for (const item of this.#prefix(args)) tokens += estimateItemTokens(item);
		for (const envelope of loaded.items) tokens += estimateItemTokens(envelope.item);
		for (const { items } of this.#pending(args)) for (const item of items) tokens += estimateItemTokens(item);
		return tokens;
	}

	#build(): void {
		const manager = this.#manager();
		const threadId = this.#session.sessionId;
		const scope = { runtimeId: this.#runtimeId, threadId, ownerId: this.#ownerId };
		const adopted = proveForkAdoption(manager, threadId, this.#ownerId);
		this.#scopeHash = scopeDigest(scope);
		this.#adopted = adopted ? [adopted] : [];
		this.#view = projectedView(manager);
		this.#history = new WireHistory({ session: this.#view, scope, modelHash: this.#modelHash, adoptedScopes: this.#adopted });
	}

	/** Pi's effective model context (converted to LLM messages) equals the caller's transcript. */
	#matchesProjection(context: Context): boolean {
		return canonicalJson(this.#effectiveMessages()) === canonicalJson(context.messages ?? []);
	}

	#effectiveMessages(): unknown[] {
		return convertToLlm(this.#manager().buildSessionProjection().messages as never) as unknown as unknown[];
	}

	#ensureWindow(): void {
		if (this.#ownWindow() === undefined) this.#history.appendEntry({ kind: "window", window: { number: 0, id: uuidv7() } });
	}

	#manager(): SessionManagerLike {
		return this.#session.sessionManager as unknown as SessionManagerLike;
	}

	#scan(): { branch: WireSessionEntry[]; own: OwnEntry[] } {
		const branch = this.#view.getBranch();
		const own: OwnEntry[] = [];
		branch.forEach((entry, index) => {
			if (!isHistoryEntry(entry)) return;
			const data = verifyData(entry.data);
			if (!data) return;
			const scope = String(data.scope);
			if (scope !== this.#scopeHash && !this.#adopted.includes(scope)) return;
			own.push({ id: entry.id, index, scope, data });
		});
		return { branch, own };
	}

	#coverage(own: OwnEntry[]): Coverage {
		let baseIndex = -1;
		for (const entry of own) {
			if ((entry.data.kind === "checkpoint" || entry.data.kind === "seed") && entry.index > baseIndex) baseIndex = entry.index;
		}
		const covered = new Set<string>();
		const responses = new Set<string>();
		for (const entry of own) {
			if (entry.index <= baseIndex) continue;
			if (typeof entry.data.sourceEntryId === "string") covered.add(entry.data.sourceEntryId);
			if (entry.data.kind === "item" && typeof entry.data.responseId === "string") responses.add(entry.data.responseId);
		}
		return { baseIndex, covered, responses };
	}

	/**
	 * Physical source entries not yet on the wire, converted to native items from Pi's projection (custom messages,
	 * context edits, omissions and multi-message entries included). Writes nothing.
	 */
	#pending(args: NativeInputArgs): Array<{ entry: WireSessionEntry; items: WireItem[] }> {
		return this.#pendingWith(args, []).entries;
	}

	/** Same as #pending, plus the items of `known` request-time messages after the branch (writes nothing). */
	#pendingWith(args: NativeInputArgs, known: readonly unknown[]): { entries: Array<{ entry: WireSessionEntry; items: WireItem[] }>; transient: WireItem[] } {
		const { branch, own } = this.#scan();
		const coverage = this.#coverage(own);
		const projected = projectedMessages(this.#manager().getEntries(), this.#manager().getLeafId());
		const overrideEnabled = args.options?.reasoningEffortOverride === true && args.capabilities.supports_reasoning_effort_updates === true;
		const incrementalToolsEnabled = args.capabilities.use_responses_lite === true && args.options?.incrementalTools === true;
		// Tool catalog before each entry, replayed from the branch's system messages (only incremental tool items need it).
		const catalog = new Map<string, Tool>();
		const out: Array<{ entry: WireSessionEntry; items: WireItem[] }> = [];
		const itemsOf = (llm: Array<{ role?: unknown }>, tools: Tool[]): WireItem[] =>
			transcriptItems({
				context: { messages: llm, tools } as unknown as Context,
				initialSystemAsUpdate: true,
				model: args.model,
				capabilities: args.capabilities,
				overrideEnabled,
				contentItemKindsEnabled: args.options?.contentItemKindsEnabled,
				incrementalToolsEnabled,
				// The raw ledger decides a pending tool result's output kind (custom or function), whatever the current grammar cap is.
				// Pi's thinkingSignature is not owner-proven here: only owner-proven raw items replay.
				history: { rawOutputs: this.#rawOutputs(), allowThinkingSignatures: false },
			});
		branch.forEach((entry, index) => {
			if (isHistoryEntry(entry)) return;
			const covered = isCovered(entry, index, coverage);
			if (covered && !incrementalToolsEnabled) return;
			const messages = projected.get(entry.id);
			if (!messages || messages.length === 0) return;
			const converted = convertToLlm(messages as never) as unknown as Array<{ role?: unknown }>;
			const tools = [...catalog.values()];
			if (incrementalToolsEnabled) foldSystemTools(catalog, converted);
			if (covered) return;
			const llm = converted.filter((message) => typeof message.role === "string" && SOURCE_ROLES.has(message.role));
			if (llm.length === 0) return;
			out.push({ entry, items: itemsOf(llm, tools) });
		});
		const transient = known.length === 0 ? [] : itemsOf(known as Array<{ role?: unknown }>, [...catalog.values()]);
		return { entries: out, transient };
	}

	/** Effort pin of this window (first effort after the last base) and per-window effort updates. Feature off by default. */
	#recordEffort(args: NativeInputArgs): void {
		const { options, capabilities } = args;
		if (options?.reasoningEffortOverride !== true || capabilities.supports_reasoning_effort_updates !== true) return;
		const effort = options.reasoningEffort;
		if (typeof effort !== "string") return;
		const pin = this.#pin();
		if (pin === undefined) {
			this.#history.appendEntry({ kind: "pin", effort });
			return;
		}
		if ((this.#history.load().effort ?? pin) !== effort) this.#history.recordEffort(effort);
	}

	#pin(): string | undefined {
		const { own } = this.#scan();
		const { baseIndex } = this.#coverage(own);
		let pin: string | undefined;
		for (const entry of own) {
			if (entry.data.kind === "pin" && entry.index > baseIndex && typeof entry.data.effort === "string") pin = entry.data.effort;
		}
		return pin;
	}

	/**
	 * Latest window of this thread on the current branch: its own accepted checkpoint or its initial window, whichever is later.
	 * Foreign (adopted parent) entries never count. A rollback before a checkpoint leaves the initial window.
	 */
	#ownWindow(): WireWindow | undefined {
		let window: WireWindow | undefined;
		for (const entry of this.#scan().own) {
			if (entry.scope !== this.#scopeHash) continue;
			if (entry.data.kind === "window" || entry.data.kind === "checkpoint") window = entry.data.window as WireWindow;
		}
		return window;
	}

	/** Raw response filter for a request built from context: an edited or removed physical message is never replayed raw. */
	#acceptRawResponse(responseId: string, context: Context): boolean {
		const state = this.#view.responseSourceState?.(responseId) ?? "absent";
		if (state === "edited" || state === "deleted") return false;
		const requested = (context.messages as Array<{ role?: unknown; responseId?: unknown; content?: unknown }>).find(
			(message) => message.role === "assistant" && message.responseId === responseId,
		);
		if (requested === undefined) return true;
		// The request carries this assistant message: its content must be the physical original, or the raw output is unproven.
		if (state === "absent") return false;
		return canonicalJson(requested.content) === canonicalJson(rawAssistantEntry(this.#manager(), responseId)?.message.content);
	}

	/** Fresh prefix for this request: the same builder the transport uses, with an empty transcript. */
	#prefix(args: NativeInputArgs): WireItem[] {
		const window = this.window;
		const identity = { installationId: "", windowId: `${this.#session.sessionId}:${window.number}`, rootSessionId: this.#session.sessionId, threadId: this.#session.sessionId } as unknown as CodexIdentity;
		return buildRequest({
			model: args.model,
			context: prefixContext(args.context, args.capabilities.use_responses_lite === true && args.options?.incrementalTools === true),
			options: args.options ?? {},
			capabilities: args.capabilities,
			identity,
		}).input;
	}

	#rawOutputs(): ReadonlyMap<string, readonly WireItem[]> {
		// A retired (unpaired) call is dropped from its response; a response whose items are all retired stays as [].
		const retired = this.#history.retiredCalls();
		const out = new Map<string, WireItem[]>();
		for (const entry of this.#scan().own) {
			if (entry.data.kind !== "item" || typeof entry.data.responseId !== "string") continue;
			const list = out.get(entry.data.responseId) ?? [];
			out.set(entry.data.responseId, list);
			const item = entry.data.item;
			if (isCallItem(item) && retired.has(callPairKey(entry.data.responseId, item.call_id))) continue;
			list.push(structuredClone(item) as WireItem);
		}
		return out;
	}

	/**
	 * Logical settlement: called once the turn's tools no longer execute. Retires only raw calls of the current native
	 * projection that have no paired Pi result (no tool result is created). Idempotent.
	 */
	settleTurn(): void {
		this.#history.retireUnpairedCalls();
	}

	#recordItem(responseId: string, item: WireItem): void {
		this.#history.appendEntry({ kind: "item", responseId, item: structuredClone(item), clientAuthored: false });
	}

	/** Provenance only: items already persisted one by one through recordItem are not written twice. */
	#recordOutputs(responseId: string, items: readonly WireItem[]): void {
		if (this.#rawOutputs().has(responseId)) return;
		for (const item of items) {
			this.#history.appendEntry({ kind: "item", responseId, item: structuredClone(item), clientAuthored: false });
		}
	}

	/**
	 * Records the settings of a normal turn request (client_metadata turn blob request_kind 'turn'). Manual baselines have no
	 * such blob and prewarm, compaction and generate:false requests are skipped. Deduped against the latest entry on the branch.
	 */
	#recordTurnSettings(body: Record<string, unknown>): void {
		const args = this.#last;
		if (!args || body.generate === false) return;
		const blob = (body.client_metadata as Record<string, unknown> | undefined)?.["x-codex-turn-metadata"];
		if (typeof blob !== "string") return;
		let meta: { request_kind?: unknown; turn_id?: unknown };
		try {
			meta = JSON.parse(blob) as { request_kind?: unknown; turn_id?: unknown };
		} catch {
			return;
		}
		if (meta?.request_kind !== "turn") return;
		const model = args.model as unknown as { id: string; input?: unknown; contextWindow?: unknown };
		if (!CODEX_MODEL_SLUGS.includes(model.id)) return;
		const reasoning = (body.reasoning ?? {}) as { effort?: unknown; summary?: unknown };
		const flags = toolWireFlags(args.model);
		const settings: NativeTurnSettings = {
			model: model.id,
			compHash: codexModelCapabilities(model.id).compactionHash,
			contextWindow: model.contextWindow as number,
			inputModalities: (Array.isArray(model.input) ? model.input : []).filter((m): m is "text" | "image" => m === "text" || m === "image"),
			supportsStrictMode: flags.supportsStrictMode,
			supportsOpenAIGrammarTools: flags.supportsOpenAIGrammarTools,
		};
		if (KNOWN_EFFORTS.has(reasoning.effort)) settings.reasoningEffort = reasoning.effort as string;
		if (KNOWN_SUMMARIES.has(reasoning.summary)) settings.reasoningSummary = reasoning.summary as NativeTurnSettings["reasoningSummary"];
		if (KNOWN_SERVICE_TIERS.has(body.service_tier)) settings.serviceTier = body.service_tier as string;
		if (typeof meta.turn_id === "string") settings.turnId = meta.turn_id;
		const latest = this.#scan().own.filter((entry) => entry.data.kind === "turn-settings").at(-1);
		if (latest && canonicalJson(latest.data.settings) === canonicalJson(settings)) return;
		this.#history.appendEntry({ kind: "turn-settings", settings });
	}

	/** Seeds the built request input once, without the prefix (nativeInput prepends the fresh prefix). */
	#preparedRequest(body: Record<string, unknown>): void {
		const args = this.#last;
		if (!args || !this.#trusted) return;
		this.#recordTurnSettings(body);
		if (body.generate === false) return;
		const loaded = this.#history.load();
		if (loaded.mode === "native" && hasBase(loaded)) return;
		if (!Array.isArray(body.input)) return;
		const input = body.input as WireItem[];
		const prefix = this.#prefix(args);
		// A prefix that differs from the fresh one is never stripped silently: no seed, the transport path stays in charge.
		if (input.length < prefix.length || !prefix.every((item, i) => canonicalJson(item) === canonicalJson(input[i]))) return;
		this.#history.seedBuiltRequest(structuredClone(input.slice(prefix.length)), undefined, { rebase: loaded.mode === "source" });
	}
}
