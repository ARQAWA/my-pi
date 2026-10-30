// The group model: which tool calls form one run between two answers, which call leads it (draws the summary),
// whether the run is still active (shows the live block) and which call is current. Pure, from the branch entries
// (`ctx.sessionManager.getBranch()`) and the streaming state of public events only; order is history and
// event order, never render order.
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { CallResult } from "./classify.ts";
import { record } from "./classify.ts";

/** One tool call of the stream as `tool_execution_start/update/end` report it, nested calls included. */
export interface LiveExecution {
	toolCallId: string;
	toolName: string;
	args?: unknown;
	/** Set for calls another tool made (codemode). */
	parentToolCallId?: string;
	/** The last `tool_execution_update` partial result. */
	partialResult?: CallResult;
	/** Set by `tool_execution_end`. */
	result?: CallResult;
	isError?: boolean;
	durationMs?: number;
	ended?: boolean;
}

/** What public events say beyond the saved entries. */
export interface LiveState {
	/** Messages of the run not yet saved, in `message_start` order; the last may still be streaming. */
	messages?: readonly unknown[];
	/** True while the last of `messages` still streams (`message_start` seen, `message_end` not yet). */
	streaming?: boolean;
	/** Tool executions in `tool_execution_start` order, nested ones included. */
	executions?: readonly LiveExecution[];
}

/** One counted call of a group: a top-level call without nested calls, or a nested call without nested calls. */
export interface Member {
	id: string;
	toolName: string;
	args: unknown;
	/** The top-level call a nested call belongs to. */
	parentId?: string;
	result?: CallResult;
	isError?: boolean;
	/** The assistant stopped before this call could receive an execution result. */
	stopReason?: "aborted" | "error";
	/** True while the call has no terminal outcome. */
	isPartial: boolean;
	/** A nested call the saved record left `unfinished`: it stopped with its parent, its outcome is unknown. It has
	 * no result; the wiring must not show it as running, succeeded or failed, nor count its changes. */
	unconfirmed?: true;
	durationMs?: number;
}

export interface Group {
	/** The ID of the group's first top-level call: stable while the group grows. */
	groupId: string;
	/** The last top-level call: it draws the summary line. */
	leaderId: string;
	/** No break after the group yet: the live block of the current call shows. */
	active: boolean;
	/** The call the live block follows: a call still streaming its arguments, else the latest started, nested ones
	 * included (see `current`). */
	currentCallId: string;
	/** Top-level call IDs in transcript order. */
	callIds: string[];
	/** The counted calls, nested calls in place of their parent. */
	members: Member[];
	/** Failed codemode parents retained for outcome display, never counted as additional tool calls. */
	parentErrors?: Member[];
}

/** Per top-level tool call ID. */
export interface CallGroup {
	groupId: string;
	isLeader: boolean;
	active: boolean;
	currentCallId: string;
	members: Member[];
	group: Group;
}

interface Building {
	group: Group;
	/** Every started call in start order, parents and nested ones. */
	started: string[];
	/** Top-level calls without a final result, in transcript order. */
	pending: string[];
	/** A call still waits for its saved result: events can change this group. */
	unsaved: boolean;
}

/** Identity of a message across the saved branch and the stream. A custom message is saved as a `custom_message`
 * entry with a new timestamp (Pi `appendCustomMessageEntry`), so it is matched by type, display and content. */
export function messageKey(m: unknown): string | undefined {
	const r = record(m);
	if (r.role === "custom") return `custom@${String(r.customType)}@${String(r.display)}@${JSON.stringify(r.content ?? null)}`;
	if (typeof r.timestamp !== "number" && typeof r.timestamp !== "string") return undefined;
	return `${String(r.role)}@${String(r.timestamp)}@${typeof r.toolCallId === "string" ? r.toolCallId : ""}`;
}

/** The messages of the branch and of the stream, as one ordered list; group breaks for non-message entries.
 * A streamed message that is already saved counts once, at its saved place (each saved copy matches one streamed). */
function timeline(entries: readonly SessionEntry[], live: LiveState, firstKeptEntryIds?: ReadonlySet<string>): unknown[] {
	const out: unknown[] = [];
	const saved = new Map<string, number>();
	const keep = (m: unknown) => {
		const k = messageKey(m);
		if (k) saved.set(k, (saved.get(k) ?? 0) + 1);
	};
	for (const e of entries) {
		// Pi may hide everything before this entry, and the history loads in pieces cut here: every compaction's cut breaks a group.
		if (firstKeptEntryIds?.has(e.id)) out.push({ role: "break" });
		if (e.type === "message") {
			out.push(e.message);
			keep(e.message);
		} else if (e.type === "custom_message") {
			const m = { role: "custom", customType: e.customType, display: e.display, content: e.content };
			if (e.display) out.push(m);
			keep(m);
		} else if (e.type === "compaction" || e.type === "branch_summary") out.push({ role: "break" });
	}
	for (const m of live.messages ?? []) {
		const k = messageKey(m);
		const n = k ? saved.get(k) ?? 0 : 0;
		if (k && n > 0) saved.set(k, n - 1);
		else out.push(m);
	}
	return out;
}

/** `42s` under a minute, `2m 03s` under an hour, then `1h 05m`; whole seconds are rounded first. */
export function formatWorked(ms: number): string {
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
	return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}

/** A successful answer: stopped normally, with text and without tool calls. */
function isFinal(m: unknown): boolean {
	const r = record(m);
	if (r.role !== "assistant" || r.stopReason !== "stop" || !Array.isArray(r.content)) return false;
	const blocks = r.content.map(record);
	return !blocks.some((b) => b.type === "toolCall") && blocks.some((b) => b.type === "text" && typeof b.text === "string" && b.text.trim() !== "");
}

export interface TurnSpan {
	label: string;
}

/** Successful answers and kept-entry cuts close independent, boundary-local spans. Other hard boundaries discard
 * unfinished work. Times use the first visible message or delivered card, including an assistant-only suffix. */
export class TurnIndex {
	readonly finals = new Map<string, TurnSpan>();
	/** Cut-local unfinished prefixes, keyed independently of the neighbouring interval. */
	readonly prefixes = new Map<string, TurnSpan>();
	/** Saved message key -> its boundary-local span. No component references. */
	readonly members = new Map<string, string>();
	/** Cards match by content and saved order, never their pre-delivery timestamp. Each occurrence has its entry ID. */
	readonly cards = new Map<string, { key: string; position: number }[]>();
	readonly positions = new Map<string, number>();
	private position = 0;
	private start: unknown;
	private end = NaN;
	private keys: string[] = [];

	private span(end: number): TurnSpan {
		const ms = end - Number(this.start);
		return { label: typeof this.start === "number" && Number.isFinite(ms) && ms >= 0 ? `worked for ${formatWorked(ms)}` : "worked" };
	}

	append(entries: readonly SessionEntry[], kept: ReadonlySet<string> = new Set<string>()): void {
		const clear = () => { this.start = undefined; this.keys = []; };
		for (const e of entries) {
			const position = this.position++;
			if (kept.has(e.id)) {
				if (this.keys.length) {
					const key = `cut@${e.id}`;
					this.prefixes.set(key, this.span(this.end));
					for (const member of this.keys) this.members.set(member, key);
				}
				clear();
			}
			if (e.type === "compaction" || e.type === "branch_summary") clear();
			this.end = Date.parse(e.timestamp);
			let message: unknown;
			if (e.type === "custom_message" && e.display) message = { role: "custom", customType: e.customType, display: e.display, content: e.content, timestamp: Date.parse(e.timestamp) };
			else if (e.type === "message") message = e.message;
			else continue;
			const r = record(message);
			if (r.role === "bashExecution" || r.role === "compactionSummary" || r.role === "branchSummary") { clear(); continue; }
			// Results live in the call's component, not a newly drawn row. They cannot start a suffix across a cut.
			if (r.role !== "user" && r.role !== "assistant" && !(r.role === "custom" && r.display === true)) continue;
			const sourceKey = messageKey(message);
			if (!sourceKey) continue;
			const key = e.type === "custom_message" ? `entry@${e.id}` : sourceKey;
			if (e.type === "custom_message") {
				const cards = this.cards.get(sourceKey) ?? [];
				cards.push({ key, position });
				this.cards.set(sourceKey, cards);
			} else this.positions.set(key, position);
			if (this.keys.length === 0) this.start = r.timestamp;
			if (isFinal(message)) {
				this.finals.set(key, this.span(this.end));
				for (const member of this.keys) this.members.set(member, key);
				clear();
			} else this.keys.push(key);
		}
	}
}

export function buildTurns(entries: readonly SessionEntry[]): Map<string, string> {
	const index = new TurnIndex();
	index.append(entries, new Set(entries.flatMap((e) => e.type === "compaction" ? [e.firstKeptEntryId] : [])));
	return new Map([...index.finals].map(([key, span]) => [key, span.label]));
}

/** The result fields the classifiers read, the same whether they come from a saved message or an event. */
function resultOf(value: unknown): CallResult | undefined {
	if (value === undefined || value === null) return undefined;
	const r = record(value);
	return { content: Array.isArray(r.content) ? (r.content as CallResult["content"]) : [], ...(r.details !== undefined ? { details: r.details } : {}),
		...(r.structuredContent !== undefined ? { structuredContent: r.structuredContent } : {}), ...(r.isError === true ? { isError: true } : {}) };
}

/** The groups of {@link buildTail}. */
export interface Tail {
	groups: Map<string, CallGroup>;
	/** The ID of the first call of the earliest group that events can still change: the open group, or a group with a
	 * call whose result is not saved yet. Every group before it is final. */
	unsettledFrom: string | undefined;
	/** The top-level call IDs of the groups no event can change any more: closed, every call saved. */
	settled: string[];
}

/**
 * Groups of the tool calls Pi draws, keyed by top-level tool call ID. `contextEntries` is
 * `ctx.sessionManager.getBranch()` (public on Pi 1.4.0 `ReadonlySessionManager`): every entry of the active branch,
 * compactions at their chronological place, each one a group break. Calls the transcript does not draw are harmless.
 */
export function buildGroups(contextEntries: readonly SessionEntry[], live: LiveState = {}): Map<string, CallGroup> {
	return buildTail(contextEntries, live).groups;
}

/** Like {@link buildGroups}, for the entries from a group boundary on, with the calls events can still change.
 * The calls in `skip` belong to settled groups, which are not built again. */
export function buildTail(contextEntries: readonly SessionEntry[], live: LiveState = {}, skip: ReadonlySet<string> = new Set(), firstKeptEntryIds?: ReadonlySet<string>): Tail {
	const executions = new Map<string, LiveExecution>();
	for (const x of live.executions ?? []) if (!executions.has(x.toolCallId)) executions.set(x.toolCallId, x);
	const results = new Map<string, Record<string, unknown>>();
	const messages = timeline(contextEntries, live, firstKeptEntryIds);
	for (const m of messages) {
		const r = record(m);
		if (r.role === "toolResult" && typeof r.toolCallId === "string" && !results.has(r.toolCallId)) results.set(r.toolCallId, r);
	}
	// Top-level ancestor of each live nested call, through nested parents.
	const topOf = (id: string): string => {
		const seen = new Set<string>();
		let at = id;
		while (!seen.has(at)) {
			seen.add(at);
			const parent = executions.get(at)?.parentToolCallId;
			if (!parent) return at;
			at = parent;
		}
		return at;
	};
	const groups: Building[] = [];
	let open: Building | undefined;
	const seenCalls = new Set<string>();
	const addCall = (call: Record<string, unknown>, assistantStopReason: unknown) => {
		const id = call.id as string;
		if (seenCalls.has(id)) return;
		seenCalls.add(id);
		if (skip.has(id)) {
			open = undefined;
			return;
		}
		if (!open) {
			open = { group: { groupId: id, leaderId: id, active: true, currentCallId: id, callIds: [], members: [] }, started: [], pending: [], unsaved: false };
			groups.push(open);
		}
		const g = open.group;
		g.callIds.push(id);
		g.leaderId = id;
		const saved = results.get(id);
		const run = executions.get(id);
		const final = saved ?? (run?.ended ? { ...run.result, isError: run.isError } : undefined);
		const stopReason = !final && (assistantStopReason === "aborted" || assistantStopReason === "error") ? assistantStopReason : undefined;
		const nested = nestedOf(id, saved, executions, topOf);
		open.started.push(id, ...nested.map((n) => n.id));
		if (!final && !stopReason) open.pending.push(id);
		if (!saved && assistantStopReason !== "aborted" && assistantStopReason !== "error") open.unsaved = true;
		const result = resultOf(final ?? run?.partialResult);
		const member: Member = { id, toolName: String(call.name ?? ""), args: call.arguments ?? {}, ...(result ? { result } : {}),
			...(final ? { isError: final.isError === true } : {}), ...(stopReason ? { stopReason } : {}), isPartial: !final && !stopReason,
			...(typeof saved?.durationMs === "number" ? { durationMs: saved.durationMs } : typeof run?.durationMs === "number" ? { durationMs: run.durationMs } : {}) };
		if (nested.length === 0) g.members.push(member);
		else {
			g.members.push(...nested);
			if (member.toolName === "codemode" && member.isError) (g.parentErrors ??= []).push(member);
		}
	};
	for (const m of messages) {
		const r = record(m);
		const role = r.role;
		if (role === "assistant") {
			for (const c of Array.isArray(r.content) ? r.content : []) {
				const block = record(c);
				if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") open = undefined;
				else if (block.type === "toolCall" && typeof block.id === "string" && block.id !== "") addCall(block, r.stopReason);
			}
		} else if (role === "user" || role === "bashExecution" || role === "branchSummary" || role === "compactionSummary" || role === "break") open = undefined;
		else if (role === "custom" && r.display === true) open = undefined;
	}
	// The open group (no break after it yet) is the only active one.
	for (const b of groups) {
		b.group.active = b === open;
		b.group.currentCallId = current(b, live, topOf, results);
	}
	const out = new Map<string, CallGroup>();
	for (const { group } of groups)
		for (const id of group.callIds)
			out.set(id, { groupId: group.groupId, isLeader: id === group.leaderId, active: group.active, currentCallId: group.currentCallId, members: group.members, group });
	const settled = groups.filter((b) => b !== open && !b.unsaved).flatMap((b) => b.group.callIds);
	return { groups: out, unsettledFrom: groups.find((b) => b === open || b.unsaved)?.group.groupId, settled };
}

/** The current call of a group: a new call whose arguments still stream (in the streaming message, not started);
 * otherwise the latest `tool_execution_start` among calls without a saved result, nested ones included, while one of
 * them runs (a completed call counts only through its saved transcript place and nested record); when all
 * started calls have ended (or none started), the first call still waiting for its turn; without events and waiting
 * calls, the last in transcript order with nested calls after their parent. A queued call is never current while an
 * earlier one runs. */
function current(b: Building, live: LiveState, topOf: (id: string) => string, saved: ReadonlyMap<string, unknown>): string {
	const calls = new Set(b.group.callIds);
	const executions = live.executions ?? [];
	// A call whose top-level call has its saved result is history: its events (kept or not, nested calls beyond Pi's
	// record included) no longer decide, so the stream and a reload give the same current call.
	const reported = executions.filter((x) => calls.has(topOf(x.toolCallId)) && !saved.has(topOf(x.toolCallId)));
	const streaming = live.streaming ? record(live.messages?.at(-1)) : undefined;
	if (streaming?.role === "assistant" && Array.isArray(streaming.content)) {
		const ids = streaming.content.map(record).filter((c) => c.type === "toolCall").map((c) => c.id);
		const fresh = [...ids].reverse().find((callId) => typeof callId === "string" && calls.has(callId) && !executions.some((x) => x.toolCallId === callId));
		if (typeof fresh === "string") return fresh;
	}
	// A call without result or event waits for its turn; it runs next once everything started has ended.
	const waiting = b.pending.filter((callId) => !executions.some((x) => x.toolCallId === callId));
	if (reported.length > 0 && (waiting.length === 0 || reported.some((x) => !x.ended))) return reported.at(-1)!.toolCallId;
	// A finished history ends with its last call.
	return waiting[0] ?? b.started.at(-1) ?? b.group.leaderId;
}

/** Pi owns nested membership and status; it does not store nested result content. */
function nestedResult(isError: boolean): CallResult {
	return { content: [], ...(isError ? { isError: true } : {}) };
}

/** Saved history wins over retained events. Missing arguments and unfinished calls stay unconfirmed. */
function nestedOf(id: string, saved: Record<string, unknown> | undefined, executions: Map<string, LiveExecution>, topOf: (id: string) => string): Member[] {
	const byId = new Map<string, Member>();
	const parents = new Set<string>();
	if (saved) {
		for (const c of Array.isArray(record(saved.nestedCalls).calls) ? (record(saved.nestedCalls).calls as unknown[]) : []) {
			const n = record(c);
			if (typeof n.id !== "string" || byId.has(n.id)) continue;
			const done = n.status === "ok" || n.status === "error";
			byId.set(n.id, { id: n.id, toolName: String(n.name ?? ""), args: n.arguments ?? {}, parentId: id,
				...(done ? { result: nestedResult(n.status === "error"), isError: n.status === "error" } : { unconfirmed: true }),
				isPartial: false, ...(typeof n.durationMs === "number" ? { durationMs: n.durationMs } : {}) });
		}
		// Saved records name nested parents only through their IDs: `<parent>/<n>`.
		for (const n of byId.keys()) for (const m of byId.keys()) if (m !== n && m.startsWith(`${n}/`)) parents.add(n);
	} else {
		for (const x of executions.values()) {
			if (!x.parentToolCallId || topOf(x.toolCallId) !== id) continue;
			parents.add(x.parentToolCallId);
			const result = x.ended ? nestedResult(x.isError === true) : resultOf(x.partialResult);
			byId.set(x.toolCallId, { id: x.toolCallId, toolName: x.toolName, args: x.args ?? {}, parentId: id, ...(result ? { result } : {}),
				...(x.ended ? { isError: x.isError === true } : {}), isPartial: !x.ended, ...(typeof x.durationMs === "number" ? { durationMs: x.durationMs } : {}) });
		}
	}
	return [...byId.values()].filter((m) => !parents.has(m.id));
}
