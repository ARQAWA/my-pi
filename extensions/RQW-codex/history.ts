// RQW-codex stage 5: durable raw wire history kept beside Pi's physical session entries.
// Pi entries are only ever appended to, never removed or rewritten. Everything here is a versioned custom
// entry: completed raw backend items, a built-request seed for transcripts without native history, executed
// tool-call ids, effort updates and one opaque compaction checkpoint. Replay uses the actual branch ancestry
// (getBranch) and verifies content digests; a socket response id is stored as provenance only and is never a
// reusable continuation; socket continuation or sticky tokens are never persisted.
//
// Durability contract: the persisted match key is the owner/thread scope (threadId + ownerId, digested). The
// runtime lease (runtimeId, ephemeral per process) is recorded as provenance and is NOT part of the match, so a
// restarted process replays the same saved thread and account. A checkpoint is reused on a branch only when its
// covered Pi entries (content digests, in order, before the checkpoint) are the same on that branch.
// Imports: Node built-ins and this folder only.
import { createHash } from "node:crypto";

export const HISTORY_CUSTOM_TYPE = "rqw-codex/wire-history";
export const HISTORY_VERSION = 1;

/** Structural wire item (a Responses API item as JSON). Kept local so this folder has no typed dependency. */
export type WireItem = { type: string; [key: string]: unknown };

export type WireEnvelope = {
	item: WireItem;
	/** Client-authored harness metadata (retention flags use it). */
	clientAuthored?: boolean;
	/** Branch entry id that carries this item (provenance). */
	entryId?: string;
};

/**
 * Exact owner of a history. Only threadId and ownerId are persisted as the match key; runtimeId is the ephemeral
 * runtime lease, recorded as provenance. A runtime restart never invalidates the saved thread and account.
 */
export type WireScope = { runtimeId: string; threadId: string; ownerId: string };

export type WireWindow = { number: number; id: string | null };

/** Pi session entry as read from the branch. Identity fields are ignored by digests, so fork copies still match. */
export type WireSessionEntry = {
	id: string;
	type?: string;
	customType?: string;
	data?: unknown;
	parentId?: string | null;
	timestamp?: unknown;
	/**
	 * Optional digest of the entry's CURRENT projected messages (Pi's context after edits). Set by the session adapter;
	 * sourceEntryDigest hashes it like any other content key. Absent for plain sessions, which keep the raw checks.
	 */
	projectedDigest?: string;
	[key: string]: unknown;
};

/** SessionManager-like surface; Pi's SessionManager satisfies it structurally. */
export interface WireSession {
	appendCustomEntry(customType: string, data?: unknown): string;
	getBranch(fromId?: string): WireSessionEntry[];
	getLeafId?(): string | null;
	/**
	 * Optional state of the physical assistant message that produced a raw response: absent (no such message yet), same
	 * (its current projected content equals the original), edited or deleted. Load treats edited and deleted as source-edited.
	 */
	responseSourceState?(responseId: string): "absent" | "same" | "edited" | "deleted";
	/**
	 * Optional ordered Pi pairing: callPairKey(responseId, callId) for every raw call whose Pi toolResult follows the
	 * assistant message of that same response (nearest preceding call). Absent: no call is paired (every retirement applies).
	 */
	pairedCalls?(): ReadonlySet<string>;
}

export type LoadedWire = {
	/** "native": replay the projection; "source": use Pi's own physical history only. */
	mode: "native" | "source";
	reason: string | null;
	items: WireEnvelope[];
	executedCallIds: string[];
	/** Last effort update after the checkpoint, or null (pin reset). */
	effort: string | null;
	window: WireWindow;
	checkpointEntryId: string | null;
	checkpointResponseId: string | null;
};

type Digested = { v: number; digest: string; [key: string]: unknown };

/** Fields that carry socket continuation or sticky routing state. They are never persisted. */
const CONTINUATION_KEYS = new Set([
	"previous_response_id",
	"turn_state",
	"turnState",
	"x-codex-turn-state",
	"sticky_token",
	"stickyToken",
	"continuation",
	"socket_continuation",
	"websocket_continuation",
]);

/** Stable JSON: sorted keys, undefined dropped. Used for digests only. */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record)
		.filter((k) => record[k] !== undefined)
		.sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
}

export function sha256Hex(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/** Persisted owner/thread match key. The runtime lease is deliberately not part of it. */
export function scopeDigest(scope: WireScope): string {
	return sha256Hex(canonicalJson([scope.threadId, scope.ownerId]));
}

/**
 * Digest of one Pi entry's content, without its identity (id, parentId, timestamp). A checkpoint records these in
 * order for the entries it covers; a fork copy with new ids but the same content verifies, an edit or removal does not.
 */
export function sourceEntryDigest(entry: WireSessionEntry): string {
	const content: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(entry)) {
		if (key !== "id" && key !== "parentId" && key !== "timestamp") content[key] = value;
	}
	return sha256Hex(canonicalJson(content));
}

/** Call id as Pi and the wire both write it: `callId|itemId` in Pi, plain `call_id` on the wire. */
export function normalizeCallId(id: string): string {
	const bar = id.indexOf("|");
	return bar < 0 ? id : id.slice(0, bar);
}

/** Pair key of one raw call: its response id and normalized call id. Never a global call-id match. */
export function callPairKey(responseId: string, callId: string): string {
	return `${responseId}\u0000${normalizeCallId(callId)}`;
}

export function isCallItem(item: unknown): item is WireItem & { call_id: string } {
	const record = item as { type?: unknown; call_id?: unknown } | null;
	return (record?.type === "function_call" || record?.type === "custom_tool_call") && typeof record.call_id === "string";
}

function isHistoryEntry(entry: WireSessionEntry): boolean {
	return entry.type === "custom" && entry.customType === HISTORY_CUSTOM_TYPE;
}

/** A persisted Pi summary supersedes every earlier native wire record on this branch, even before its event fires. */
export function lastPiCompactionIndex(branch: readonly { type?: string }[]): number {
	for (let index = branch.length - 1; index >= 0; index--) {
		if (branch[index]!.type === "compaction") return index;
	}
	return -1;
}

function assertNoContinuation(record: Record<string, unknown>, where: string): void {
	for (const key of Object.keys(record)) {
		if (CONTINUATION_KEYS.has(key)) throw new TypeError(`${where}: ${key} is a socket continuation token and is never persisted`);
	}
}

function withDigest<T extends Record<string, unknown>>(data: T): T & { digest: string } {
	return { ...data, digest: sha256Hex(canonicalJson(data)) };
}

function verify(data: unknown): Digested | null {
	if (!data || typeof data !== "object") return null;
	const record = data as Record<string, unknown>;
	if (record.v !== HISTORY_VERSION || typeof record.digest !== "string") return null;
	const { digest, ...rest } = record;
	return sha256Hex(canonicalJson(rest)) === digest ? (record as Digested) : null;
}

function sameList(a: readonly string[], b: unknown): boolean {
	return Array.isArray(b) && a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Content digests of the Pi entries on a branch (history entries excluded), in order. */
function branchDigests(branch: readonly WireSessionEntry[]): string[] {
	return branch.filter((entry) => !isHistoryEntry(entry)).map(sourceEntryDigest);
}

/** Retired call keys with no paired Pi output (a real result for the pair makes the call live again). */
function liveRetired(own: ReadonlyArray<{ data: Record<string, unknown> }>, paired: ReadonlySet<string>): Set<string> {
	const out = new Set<string>();
	for (const entry of own) {
		if (entry.data.kind !== "unpaired_call_retired") continue;
		const key = callPairKey(String(entry.data.responseId), String(entry.data.callId));
		if (!paired.has(key)) out.add(key);
	}
	return out;
}

/** One logical sampling request's completed-item ledger. Items are durable as soon as they are added. */
export class WireAttempt {
	readonly attemptId: string;
	readonly #history: WireHistory;
	#completedResponse: string | null = null;

	constructor(history: WireHistory, attemptId: string) {
		this.#history = history;
		this.attemptId = attemptId;
	}

	/**
	 * Record one completed output item (the output_item.done event). Call only for completed items: an in-progress
	 * item that never reached done is never passed here, so it is dropped on retry.
	 */
	addItem(item: WireItem, options: { clientAuthored?: boolean } = {}): string {
		if (typeof item?.type !== "string") throw new TypeError("WireAttempt.addItem: item needs a string type");
		return this.#history.appendEntry({
			kind: "item",
			attemptId: this.attemptId,
			item,
			clientAuthored: options.clientAuthored === true,
		});
	}

	/** Record that a tool call's result was produced locally; a retry must not execute the call again. */
	markExecuted(callId: string): string {
		if (!callId) throw new TypeError("WireAttempt.markExecuted: callId required");
		return this.#history.appendEntry({ kind: "executed", attemptId: this.attemptId, callId });
	}

	/** Provenance only, after response.completed. Never a socket continuation. */
	complete(responseId: string): string {
		if (this.#completedResponse !== null) throw new Error("WireAttempt.complete: already completed");
		this.#completedResponse = responseId;
		return this.#history.appendEntry({ kind: "completed", attemptId: this.attemptId, responseId });
	}
}

export class WireHistory {
	readonly #session: WireSession;
	readonly #scope: WireScope;
	readonly #scopeHash: string;
	readonly modelHash: string;
	readonly #newId: () => string;
	readonly #adopted: ReadonlySet<string>;

	/**
	 * @param modelHash digest of the pinned capabilities the history is expected to replay under.
	 * @param newId attempt id source (injectable; default random UUID v4).
	 * @param adoptedScopes scope digests whose entries are replayed as own (fork ancestry proven by the caller).
	 */
	constructor(options: { session: WireSession; scope: WireScope; modelHash: string; newId?: () => string; adoptedScopes?: readonly string[] }) {
		this.#session = options.session;
		this.#scope = { ...options.scope };
		this.#scopeHash = scopeDigest(options.scope);
		this.#adopted = new Set(options.adoptedScopes ?? []);
		this.modelHash = options.modelHash;
		this.#newId = options.newId ?? (() => crypto.randomUUID());
	}

	get scope(): WireScope {
		return { ...this.#scope };
	}

	/** Runtime lease of this process (provenance only; never a match key). */
	get leaseId(): string {
		return this.#scope.runtimeId;
	}

	/** Start a logical sampling request ledger. Keep the same object across retries of that request. */
	beginAttempt(attemptId: string = this.#newId()): WireAttempt {
		return new WireAttempt(this, attemptId);
	}

	/** Record a reasoning-effort update at the current projection position (pins the effort). */
	recordEffort(effort: string, leafId?: string | null): string {
		const at = this.load(leafId).items.length;
		return this.appendEntry({ kind: "effort", effort, at });
	}

	/**
	 * Native base for a transcript that has no native history yet. The items must be the exact input of the request
	 * the transport actually built (never reconstructed from Pi messages). Allowed only while the branch is native
	 * and holds neither a checkpoint nor items; otherwise the existing base is authoritative and this throws.
	 */
	seedBuiltRequest(items: WireItem[], leafId?: string | null, options: { rebase?: boolean } = {}): string {
		if (options.rebase !== true) {
			const current = this.load(leafId);
			if (current.mode !== "native") throw new Error(`seedBuiltRequest: branch history is not native (${current.reason ?? "unknown"})`);
			if (current.checkpointEntryId !== null || current.items.length > 0) {
				throw new Error("seedBuiltRequest: a native base already exists on this branch");
			}
		}
		if (!Array.isArray(items) || items.some((item) => typeof item?.type !== "string")) {
			throw new TypeError("seedBuiltRequest: every built item needs a string type");
		}
		// A rebase seed resets replay on this branch (after an invalid base); its digests cover the entries before it.
		return this.appendEntry({
			kind: "seed",
			provenance: "built-request",
			rebase: options.rebase === true,
			items: items.map((item) => ({ item })),
			sourceDigests: branchDigests(this.#session.getBranch(leafId ?? undefined)),
		});
	}

	/**
	 * Install an accepted native compaction. One appended entry, so it is atomic. Callers append only after the
	 * backend accepted the result; a failed compaction must not call this. The covered Pi entries (current branch,
	 * before the new checkpoint) are recorded by content digest. primaryModelHash is set when a previous-model
	 * fallback produced the checkpoint, so loads under the primary hash accept it.
	 */
	installCompaction(input: {
		responseId: string;
		compaction: WireItem;
		retained: WireEnvelope[];
		window: WireWindow;
		sourceEntryIds: string[];
		sourceDigest: string;
		modelHash?: string;
		primaryModelHash?: string;
	}): string {
		if (input.compaction?.type !== "compaction" || typeof input.compaction.encrypted_content !== "string") {
			throw new TypeError("installCompaction: a compaction item with encrypted_content is required");
		}
		const sourceDigests = this.#session
			.getBranch()
			.filter((entry) => !isHistoryEntry(entry))
			.map(sourceEntryDigest);
		return this.appendEntry({
			kind: "checkpoint",
			responseId: input.responseId,
			compaction: input.compaction,
			retained: input.retained.map((e) => ({ item: e.item, clientAuthored: e.clientAuthored === true })),
			window: input.window,
			sourceEntryIds: [...input.sourceEntryIds],
			sourceDigests,
			sourceDigest: input.sourceDigest,
			modelHash: input.modelHash ?? this.modelHash,
			primaryModelHash: input.primaryModelHash ?? null,
		});
	}

	/** Items after the latest checkpoint of this scope, from the branch ending at leafId (default: current leaf). */
	projection(leafId?: string | null): WireEnvelope[] {
		return this.load(leafId).items;
	}

	/** Function/tool calls in the projection whose result was not recorded as executed. */
	unexecutedCalls(leafId?: string | null): WireItem[] {
		const loaded = this.load(leafId);
		const executed = new Set(loaded.executedCallIds);
		return loaded.items
			.map((e) => e.item)
			.filter((item) => (item.type === "function_call" || item.type === "custom_tool_call") && !executed.has(String(item.call_id)));
	}

	/**
	 * Replay state for one branch. Uses only entries on the ancestry of leafId (fork, tree navigation and edits
	 * therefore select the right history automatically). Invalid digests, a foreign-scope checkpoint after ours, a
	 * checkpoint for another model hash, or a checkpoint whose covered Pi entries differ on this branch switch the
	 * result to "source", which means Pi's own history is used.
	 */
	load(leafId?: string | null, expectedModelHash?: string): LoadedWire {
		const branch = this.#session.getBranch(leafId ?? undefined);
		// The latest own rebase seed on this branch is a reset: entries before it are neither replayed nor checked.
		let resetIndex = lastPiCompactionIndex(branch);
		branch.forEach((entry, index) => {
			if (index < resetIndex || !isHistoryEntry(entry)) return;
			const data = verify(entry.data);
			if (data && data.kind === "seed" && data.rebase === true && data.scope === this.#scopeHash) resetIndex = index;
		});
		let invalid = 0;
		let lastOwnCheckpoint = -1;
		let lastOwnCheckpointBranchIndex = -1;
		let lastForeignCheckpointBranchIndex = -1;
		const own: Array<{ entryId: string; branchIndex: number; data: Record<string, unknown> }> = [];
		branch.forEach((entry, index) => {
			if (index < resetIndex) return;
			if (entry.type !== "custom" || entry.customType !== HISTORY_CUSTOM_TYPE) return;
			const data = verify(entry.data);
			if (!data) {
				invalid++;
				return;
			}
			if (data.scope !== this.#scopeHash && !this.#adopted.has(String(data.scope))) {
				if (data.kind === "checkpoint") lastForeignCheckpointBranchIndex = index;
				return;
			}
			if (data.kind === "checkpoint") {
				lastOwnCheckpoint = own.length;
				lastOwnCheckpointBranchIndex = index;
			}
			own.push({ entryId: entry.id, branchIndex: index, data: data as Record<string, unknown> });
		});

		const base: LoadedWire = {
			mode: "native",
			reason: null,
			items: [],
			executedCallIds: [],
			effort: null,
			window: { number: 0, id: null },
			checkpointEntryId: null,
			checkpointResponseId: null,
		};
		if (invalid > 0) return { ...base, mode: "source", reason: "invalid-entry" };
		for (const entry of own) {
			const digests = entry.data.sourceDigests;
			if (entry.data.kind === "seed" && Array.isArray(digests) && !sameList(branchDigests(branch.slice(0, entry.branchIndex)), digests)) {
				return { ...base, mode: "source", reason: "seed-sources" };
			}
		}
		if (lastForeignCheckpointBranchIndex > lastOwnCheckpointBranchIndex) {
			return { ...base, mode: "source", reason: "foreign-checkpoint" };
		}
		// An item recorded for a Pi entry replays only while that entry is unchanged (a context edit or removal changes it).
		const byId = new Map(branch.map((entry) => [entry.id, entry]));
		for (const entry of own) {
			const { sourceEntryId, sourceDigest } = entry.data as { sourceEntryId?: unknown; sourceDigest?: unknown };
			if (entry.data.kind !== "item" || typeof sourceEntryId !== "string" || typeof sourceDigest !== "string") continue;
			const source = byId.get(sourceEntryId);
			if (!source || sourceEntryDigest(source) !== sourceDigest) return { ...base, mode: "source", reason: "source-edited" };
		}
		const checkpoint = lastOwnCheckpoint >= 0 ? own[lastOwnCheckpoint] : null;
		if (checkpoint) {
			const { modelHash, primaryModelHash } = checkpoint.data as { modelHash?: unknown; primaryModelHash?: unknown };
			// Ordinary replay has no model-hash guard: a native checkpoint is replayed under any model (native never re-checks it).
			// The explicit expectedModelHash argument stays for compatibility utilities only.
			if (expectedModelHash !== undefined && modelHash !== expectedModelHash && primaryModelHash !== expectedModelHash) {
				return { ...base, mode: "source", reason: "model-hash" };
			}
			const covered = branch
				.slice(0, checkpoint.branchIndex)
				.filter((entry) => !isHistoryEntry(entry))
				.map(sourceEntryDigest);
			if (!sameList(covered, (checkpoint.data as { sourceDigests?: unknown }).sourceDigests)) {
				return { ...base, mode: "source", reason: "checkpoint-sources" };
			}
		}

		// A raw response replays only while its physical assistant message is unchanged (a genuine edit or removal invalidates it).
		for (const entry of own) {
			const responseId = entry.data.responseId;
			if (entry.data.kind !== "item" || typeof responseId !== "string") continue;
			const state = this.#session.responseSourceState?.(responseId);
			if (state === "edited" || state === "deleted") return { ...base, mode: "source", reason: "source-edited" };
		}

		const items: WireEnvelope[] = [];
		const executedCallIds: string[] = [];
		let effort: string | null = null;
		const hidden = liveRetired(own, this.#session.pairedCalls?.() ?? new Set<string>());
		const start = lastOwnCheckpoint >= 0 ? lastOwnCheckpoint : 0;
		if (checkpoint) {
			const data = checkpoint.data as { retained: Array<{ item: WireItem; clientAuthored: boolean }>; compaction: WireItem; window: WireWindow; responseId: string };
			for (const e of data.retained) items.push({ item: e.item, clientAuthored: e.clientAuthored, entryId: checkpoint.entryId });
			items.push({ item: data.compaction, entryId: checkpoint.entryId });
			base.window = data.window;
			base.checkpointEntryId = checkpoint.entryId;
			base.checkpointResponseId = data.responseId;
		}
		for (let i = start + (checkpoint ? 1 : 0); i < own.length; i++) {
			const { entryId, data } = own[i];
			if (data.kind === "item") {
				if (isCallItem(data.item) && typeof data.responseId === "string" && hidden.has(callPairKey(data.responseId, data.item.call_id))) continue;
				items.push({
					item: data.item as WireItem,
					clientAuthored: data.clientAuthored === true,
					entryId,
				});
			} else if (data.kind === "seed") {
				for (const e of data.items as Array<{ item: WireItem }>) items.push({ item: e.item, clientAuthored: false, entryId });
			} else if (data.kind === "effort") {
				effort = String(data.effort);
				items.push({ item: { type: "configuration_update", reasoning: { effort } }, entryId });
			} else if (data.kind === "executed") {
				executedCallIds.push(String(data.callId));
			}
		}
		return { ...base, items, executedCallIds, effort };
	}

	/**
	 * Pair keys of retired calls that still have no paired Pi output: load hides their items and the raw-output
	 * view drops them. A later real result for the pair makes the call live again.
	 */
	retiredCalls(leafId?: string | null): ReadonlySet<string> {
		return liveRetired(this.#ownEntries(leafId), this.#session.pairedCalls?.() ?? new Set<string>());
	}

	/**
	 * Logical settlement (called once the turn's tools no longer execute). Every raw function/custom call in the CURRENT
	 * native projection (after the latest checkpoint or seed) with no paired Pi result gets one signed
	 * `unpaired_call_retired` entry. Idempotent: an already retired pair is not appended again. Returns the number appended.
	 */
	retireUnpairedCalls(leafId?: string | null): number {
		const own = this.#ownEntries(leafId);
		const paired = this.#session.pairedCalls?.() ?? new Set<string>();
		const known = new Set<string>();
		let baseIndex = -1;
		for (const entry of own) {
			if (entry.data.kind === "unpaired_call_retired") known.add(callPairKey(String(entry.data.responseId), String(entry.data.callId)));
			if ((entry.data.kind === "checkpoint" || entry.data.kind === "seed") && entry.branchIndex > baseIndex) baseIndex = entry.branchIndex;
		}
		const pending: Array<{ responseId: string; callId: string }> = [];
		for (const entry of own) {
			if (entry.branchIndex <= baseIndex || entry.data.kind !== "item") continue;
			const { responseId, item } = entry.data as { responseId?: unknown; item?: unknown };
			if (typeof responseId !== "string" || !isCallItem(item)) continue;
			const key = callPairKey(responseId, item.call_id);
			if (paired.has(key) || known.has(key)) continue;
			known.add(key);
			pending.push({ responseId, callId: normalizeCallId(item.call_id) });
		}
		for (const { responseId, callId } of pending) {
			this.appendEntry({ kind: "unpaired_call_retired", responseId, callId });
		}
		return pending.length;
	}

	/** This scope's verified history entries on the branch ending at leafId, in branch order. */
	#ownEntries(leafId?: string | null): Array<{ entryId: string; branchIndex: number; data: Record<string, unknown> }> {
		const branch = this.#session.getBranch(leafId ?? undefined);
		const boundary = lastPiCompactionIndex(branch);
		const out: Array<{ entryId: string; branchIndex: number; data: Record<string, unknown> }> = [];
		branch.forEach((entry, index) => {
			if (index <= boundary || !isHistoryEntry(entry)) return;
			const data = verify(entry.data);
			if (!data || (data.scope !== this.#scopeHash && !this.#adopted.has(String(data.scope)))) return;
			out.push({ entryId: entry.id, branchIndex: index, data: data as Record<string, unknown> });
		});
		return out;
	}

	/** Append one versioned entry with its digest and the runtime lease as provenance. Returns the Pi entry id. */
	appendEntry(fields: Record<string, unknown>): string {
		assertNoContinuation(fields, "history entry");
		const item = fields.item as Record<string, unknown> | undefined;
		if (item && typeof item === "object") assertNoContinuation(item, "history item");
		if (Array.isArray(fields.items)) {
			for (const entry of fields.items as Array<{ item: Record<string, unknown> }>) assertNoContinuation(entry.item, "history item");
		}
		return this.#session.appendCustomEntry(
			HISTORY_CUSTOM_TYPE,
			withDigest({ v: HISTORY_VERSION, scope: this.#scopeHash, lease: this.#scope.runtimeId, ...fields }),
		);
	}
}
