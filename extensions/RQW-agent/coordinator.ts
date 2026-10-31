// One direct caller's registry and result broker. No process-global child or delivery state.
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RunningCounts } from "./counts.ts";
import { ACCEPT_ENTRY, WAIT_ENTRY, recordDelivery } from "./persistence.ts";
import { FOLLOW_UP } from "./prompt.ts";

/** Caller-owned children and results, including results not yet consumed by the caller model. */
export type RuntimeHandle = {
	pending(): boolean;
	wait(signal: AbortSignal): Promise<void>;
	ids(): string[];
	/** Compact read-only diagnostics; depth counts generations below these direct children. */
	status?(depth: number): Record<string, unknown>[];
	/** Materialize only the generations requested by an explicit exact-status query. */
	prepareStatus?(depth: number, signal: AbortSignal): Promise<void>;
	/** Native running children, including descendants. Pending results count zero. */
	runningCounts(): RunningCounts;
	resume?(signal: AbortSignal, recoveredOnly?: boolean): Promise<number>;
	settle?(aborted: boolean): void;
	abortAll(): void;
	stopBackground?(): number;
	close(): void;
};

/**
 * A notification wait as saved in the caller's session: opened when it is created, with the `call` whose tool result carries
 * its `waiting` receipt (a restore raises it only if that result is saved without error), closed (`open: false`) when its `child_wait` is sent or the wait is replaced or canceled. `deadline_at` is wall-clock ms.
 */
export type WaitRecord = { version: 1; wait_id: string; open: boolean; call?: string; replaced_by?: string; targets?: { id: string; run?: string }[]; until?: "first" | "all"; wake_on_alert?: boolean; deadline_at?: number };

/**
 * The outcome of a wait that ran inside a codemode script (`root` is the script's call), written when the wait call ends.
 * A restore counts its results as delivered only if the wait succeeded and the script's own result is saved without error.
 */
export type AcceptRecord = { version: 1; call: string; root: string; ok: boolean; results: { run: string; delivery: string }[] };

export const DEFAULT_WAIT_MS = 300000;
export type Target = { id: string; run: string; recovers?: string; active(): boolean; checkpoint?(): Map<string, number>; alertVersion?(): number; snapshot(messages?: number, checkpoint?: Map<string, number>, depth?: number): Record<string, unknown> };
export type WaitOptions = { until?: "first" | "all"; wake_on_alert?: boolean };
export type Result = { id: string; run: string; delivery: string; text?: string; outcome: string;
	state: "pending" | "held" | "reserved" | "message" | "wait"; claimed_by?: string; push(result: Result): void };
type Watch = { check(): void };
type Reservation = { owner: string; call: string; results: Result[]; signal: AbortSignal };
type WaitOutcome = { reason: string; pending: Result[]; receipts: Record<string, unknown>[]; changed?: unknown };
type NotificationWait = { id: string; call: string; key: string; ready(): boolean; confirm(kept: boolean): void; cancel(uncommittedOnly?: boolean, replacedBy?: string): void; drop(): void; flush(triggerTurn: boolean): void; follow(id: string, from: string, to: string): void };

export function waitTimeout(value?: number | null) {
	if (value == null) return DEFAULT_WAIT_MS;
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error("timeout_ms must be a positive finite safe integer");
	return value;
}
export function targetIds(ids: unknown): string[] {
	if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== "string" || !/^agent#[1-9]\d*$/.test(id)))
		throw new Error("ids must be a nonempty array of full child IDs (agent#N)");
	return [...new Set(ids)];
}
export function messageCount(value?: number | null) {
	if (value == null) return 8;
	if (!Number.isInteger(value) || value < 5 || value > 10) throw new Error("messages must be an integer from 5 to 10");
	return value;
}
export function statusDepth(value?: number | null): number {
	if (value == null) return 0;
	if (!Number.isSafeInteger(value) || value < 0) throw new Error("depth must be a nonnegative safe integer");
	return value;
}
/** Absolute monotonic deadlines, chunked below Node's timer overflow boundary; no artificial wait maximum. */
export function deadlineTimer(ms: number, wake: () => void) {
	const deadline = performance.now() + ms;
	let timer: ReturnType<typeof setTimeout>;
	let canceled = false;
	const step = () => {
		if (canceled) return;
		const remaining = deadline - performance.now();
		if (remaining <= 0) wake();
		else timer = setTimeout(step, Math.min(remaining, 2147483647));
	};
	step();
	return () => { canceled = true; clearTimeout(timer); };
}
const json = (details: Record<string, unknown>) => ({ content: [{ type: "text" as const, text: JSON.stringify(details) }], details });
const targetKey = (ids: string[]) => JSON.stringify([...new Set(ids)].sort());

export class Coordinator {
	readonly targets = new Map<string, Target>();
	private results = new Map<string, Result>();
	// Older runs can still have an unfinalized handoff when send starts the next run.
	private uncommitted = new Set<Result>();
	private offered = new WeakSet<Result>();
	private messageReceipts = new Set<Result>();
	private watchers = new Set<Watch>();
	private changes = new Map<string, { run: string; change: string }>();
	private reservations = new Map<string, Reservation>();
	private notificationWaits = new Map<string, NotificationWait>();
	private sentWaits = new Set<string>();
	private notices: { message: Parameters<ExtensionAPI["sendMessage"]>[0]; current(): boolean; delivered(): void; send: ExtensionAPI["sendMessage"] }[] = [];
	private parents = new Map<string, string>();
	private completed = new Map<string, boolean>();
	private activeWaits = 0;
	private nativeStarts = 0;
	private settling = false;
	private callerAborted = false;
	private caller?: ExtensionContext;
	private unansweredNotifications = new Set<string>();
	private endSignal?: AbortSignal;
	private diagnostics: { customType: string; content: string; display: boolean }[] = [];
	private markAborted = () => { this.callerAborted = true; this.cancelNotificationWaits(true); };
	queue: Promise<unknown> = Promise.resolve();
	private send: ExtensionAPI["sendMessage"];
	private journal?: (type: string, data: object) => void;
	constructor(pi: ExtensionAPI, send: ExtensionAPI["sendMessage"] = (message, options) => pi.sendMessage(message, options), journal?: (type: string, data: object) => void) {
		this.send = send;
		this.journal = journal;
		pi.on("session_start", (_event, ctx) => { this.caller = ctx; });
		pi.on("before_agent_start", (_event, ctx) => { this.caller = ctx; });
		pi.on("session_tree", (_event, ctx) => { this.caller = ctx; this.unansweredNotifications.clear(); });
		// Real parentToolCallId links, independent of nestedCalls' bounded presentation log and ID spelling.
		pi.on("tool_call", event => { if (event.parentToolCallId) this.parents.set(event.toolCallId, event.parentToolCallId); });
		pi.on("tool_execution_end", event => {
			this.completed.set(event.toolCallId, !event.isError);
			const root = this.root(event.toolCallId);
			const reservation = [...this.reservations.values()].find(item => item.call === event.toolCallId);
			if (reservation && root !== event.toolCallId)
				this.record(ACCEPT_ENTRY, { version: 1, call: event.toolCallId, root, ok: !event.isError, results: reservation.results.map(r => ({ run: r.run, delivery: r.delivery })) });
		});
		pi.on("turn_end", (_event, ctx) => this.finalize(ctx));
		pi.on("agent_start", () => { this.callerAborted = false; this.nativeStarts++; this.notify(); });
		pi.on("turn_start", () => { this.settling = false; });
		pi.on("agent_end", (_event, ctx) => {
			this.settling = true;
			if (ctx.signal?.aborted) this.markAborted();
			this.finalize(ctx);
			this.endSignal?.removeEventListener("abort", this.markAborted);
			this.endSignal = ctx.signal;
			if (ctx.signal?.aborted) this.callerAborted = true;
			else ctx.signal?.addEventListener("abort", this.markAborted, { once: true });
		});
		pi.on("agent_before_settle", (_event, ctx) => {
			const notifications = this.flushNotifications(false);
			const messages = this.diagnostics.splice(0);
			for (const message of messages) this.send(message, { triggerTurn: false });
			if ((notifications || messages.length || this.needsNotificationTurn(ctx)) && !this.callerAborted) return { continue: true };
			this.settling = true;
		});
		pi.on("agent_settled", (event, ctx) => this.settleCore(ctx, event.aborted));
		pi.on("session_shutdown", () => {
			this.callerAborted = true; this.sentWaits.clear();
			// Shutdown ends the live waits but writes no closing entry: the accepted ones are restored with the reopened session.
			for (const wait of [...this.notificationWaits.values()]) wait.drop();
			this.notices.length = 0;
			this.diagnostics.length = 0; this.endSignal?.removeEventListener("abort", this.markAborted);
		});
	}
	/** The public core continuation bypasses AgentSession's final settlement event. */
	settleCore(ctx: ExtensionContext, aborted: boolean) {
		this.callerAborted = aborted;
		if (aborted) this.cancelNotificationWaits(true);
		// Commit queued receipts while still settling; only the final flush may wake the caller.
		this.settling = true;
		this.finalize(ctx, true);
		this.parents.clear(); this.completed.clear();
		this.endSignal?.removeEventListener("abort", this.markAborted); this.endSignal = undefined;
		this.callerAborted = aborted; this.settling = false;
		const messages = this.diagnostics.splice(0);
		const notifications = this.notices.some(notice => notice.current()) || [...this.notificationWaits.values()].some(wait => wait.ready());
		messages.forEach((message, i) => this.send(message, { triggerTurn: !aborted && !notifications && i === messages.length - 1 }));
		this.flushNotifications(!aborted);
		this.notify();
	}
	/** Busy notifications persist after the current turn; continue once unless a later answer already saw them. */
	private needsNotificationTurn(ctx: ExtensionContext) {
		if (!this.unansweredNotifications.size) return false;
		const branch = ctx.sessionManager.getBranch();
		const lastAnswer = branch.findLastIndex(e => e.type === "message" && e.message.role === "assistant");
		for (const id of this.unansweredNotifications) {
			const at = branch.findIndex(e => e.type === "custom_message" && e.customType === "child_wait"
				&& (e.details as { wait_id?: string } | undefined)?.wait_id === id);
			if (at >= 0 && at < lastAnswer) this.unansweredNotifications.delete(id);
		}
		return this.unansweredNotifications.size > 0;
	}
	private cancelNotificationWaits(uncommittedOnly = false) {
		// A wait whose closing entry cannot be saved stays accepted.
		for (const wait of [...this.notificationWaits.values()]) try { wait.cancel(uncommittedOnly); } catch { /* Stays accepted. */ }
	}
	private replaceNotifications(key: string, replacement?: NotificationWait) {
		for (const wait of [...this.notificationWaits.values()])
			if (wait !== replacement && wait.key === key) wait.cancel(false, replacement?.id);
	}
	/** Side-channel notices use the same settlement-safe sender as wait notifications, never result ownership. */
	notification(message: Parameters<ExtensionAPI["sendMessage"]>[0], current: () => boolean, delivered: () => void, send = this.send): void {
		this.notices.push({ message, current, delivered, send });
		if (!this.settling) this.flushNotifications(!this.callerAborted);
	}
	private flushNotifications(triggerTurn: boolean) {
		const notices = this.notices.splice(0).filter(notice => notice.current());
		const ready = [...this.notificationWaits.values()].filter(wait => wait.ready());
		for (const [i, notice] of notices.entries()) {
			if (!notice.current()) continue;
			notice.send(notice.message, { triggerTurn: triggerTurn && !ready.length && i === notices.length - 1 });
			notice.delivered();
		}
		ready.forEach((wait, i) => wait.flush(triggerTurn && i === ready.length - 1));
		return notices.length + ready.length;
	}
	private root(call: string) {
		const seen = new Set<string>();
		while (this.parents.has(call) && !seen.has(call)) { seen.add(call); call = this.parents.get(call)!; }
		return call;
	}
	private record(type: string, data: WaitRecord | AcceptRecord) {
		// A failed write may lose a wait after a crash, but must not break the live wait.
		try { this.journal?.(type, data); } catch { /* Best effort. */ }
	}
	private saveReceipt(ctx: ExtensionContext, run: string) {
		// Receipt failure may repeat delivery after wake, but must not block the handoff.
		try { recordDelivery(ctx.sessionManager, run); } catch { /* Best effort. */ }
	}
	/** Only a successful finalized, persisted outer toolResult commits a wait handoff. */
	private finalize(ctx: ExtensionContext, settled = false) {
		// A wait is closed in the session only once its child_wait message is persisted; until then a crash re-raises it.
		for (const id of this.sentWaits) {
			const persisted = ctx.sessionManager.getBranch().some(entry => entry.type === "custom_message" && entry.customType === "child_wait"
				&& (entry.details as { wait_id?: string } | undefined)?.wait_id === id);
			if (!persisted) continue;
			this.record(WAIT_ENTRY, { version: 1, wait_id: id, open: false });
			this.sentWaits.delete(id);
		}
		for (const result of this.messageReceipts) {
			const persisted = ctx.sessionManager.getBranch().some(entry => {
				const details = (entry.type === "custom_message" ? entry.details
					: entry.type === "custom" && entry.customType === "rqw-agent-inbox"
						? (entry.data as { message?: { details?: unknown } })?.message?.details : undefined) as
					{ run?: string; results?: { run?: string }[] } | undefined;
				return details?.run === result.run || details?.results?.some(item => item.run === result.run);
			});
			if (!persisted) continue;
			this.saveReceipt(ctx, result.run);
			this.messageReceipts.delete(result);
		}
		for (const [owner, reservation] of this.reservations) {
			const root = this.root(reservation.call);
			const entry = ctx.sessionManager.getBranch().findLast(e => e.type === "message" && e.message.role === "toolResult" && e.message.toolCallId === root);
			const message = entry?.type === "message" && entry.message.role === "toolResult" ? entry.message : undefined;
			if (!message && !settled) continue;
			const success = message && !message.isError && this.completed.get(reservation.call) !== false;
			// Direct results must still carry the handoff. A successful outer script may intentionally filter it.
			const body = message ? JSON.stringify(message.content) : "";
			const kept = success && (root !== reservation.call || reservation.results.every(r => body.includes(r.delivery)));
			this.reservations.delete(owner);
			for (const result of reservation.results) {
				if (result.state !== "reserved" || result.claimed_by !== owner) continue;
				if (kept) { this.saveReceipt(ctx, result.run); result.state = "wait"; result.text = undefined; this.uncommitted.delete(result); }
				else { result.state = "pending"; delete result.claimed_by; this.push(result); }
			}
		}
		for (const [id, wait] of [...this.notificationWaits]) {
			const root = this.root(wait.call);
			const entry = ctx.sessionManager.getBranch().findLast(e => e.type === "message" && e.message.role === "toolResult" && e.message.toolCallId === root);
			const message = entry?.type === "message" && entry.message.role === "toolResult" ? entry.message : undefined;
			if (!message && !settled) continue;
			wait.confirm(!!message && !message.isError && this.completed.get(wait.call) !== false
				&& (root !== wait.call || JSON.stringify(message.content).includes(id)));
		}
		this.notify();
		if (!this.settling) this.flushNotifications(!this.callerAborted);
	}
	/** Brings a saved open wait back with its id, targets, options and remaining time; a past deadline times out at once. */
	restoreWait(record: WaitRecord) {
		const targets = record.targets ?? [];
		if (!targets.length || typeof record.deadline_at !== "number") return;
		this.notificationWait(targets.map(target => target.id), Math.max(0, record.deadline_at - Date.now()), new AbortController().signal,
			`restored:${record.wait_id}`, { until: record.until, wake_on_alert: record.wake_on_alert },
			{ id: record.wait_id, runs: new Map(targets.map(target => [target.id, this.continued(target.id, target.run)])), deadlineAt: record.deadline_at, call: record.call });
	}
	/** The run a saved wait follows: a target that recorded it as the run it continues after a crash moves on to its own. */
	private continued(id: string, run?: string): string | undefined {
		const target = this.targets.get(id);
		return run && target?.recovers === run ? target.run : run;
	}
	stopBackground() { this.callerAborted = true; this.cancelNotificationWaits(); this.unansweredNotifications.clear(); }
	holdsFollowUps(background: boolean) { return !this.callerAborted && (background || this.notificationWaits.size > 0 || this.unansweredNotifications.size > 0); }
	hasWait(id: string) { return this.notificationWaits.has(id); }
	/** A restored wait on `id` moves from the interrupted run `from` to the run `to` that continues it. */
	follow(id: string, from: string, to: string) { for (const wait of this.notificationWaits.values()) wait.follow(id, from, to); }
	add(target: Target) { this.targets.set(target.id, target); this.notify(); }
	change(id: string, change: string) {
		const target = this.targets.get(id);
		if (target) this.changes.set(id, { run: target.run, change });
		for (const result of this.uncommitted) if (result.id === id) {
			result.state = "wait"; result.text = undefined; this.uncommitted.delete(result);
		}
		this.targets.delete(id);
		this.results.delete(id);
		this.notify();
	}
	begin(target: Target) { this.results.delete(target.id); this.add(target); }
	private register(id: string, run: string, text: string, outcome: string, push: Result["push"], delivery: string = randomUUID()): Result | undefined {
		if (this.targets.get(id)?.run !== run || this.results.get(id)?.run === run) return;
		const result: Result = { id, run, delivery, text, outcome, state: "pending", push };
		this.results.set(id, result);
		this.uncommitted.add(result);
		return result;
	}
	publish(id: string, run: string, text: string, outcome: string, push: Result["push"], delivery?: string) {
		const result = this.register(id, run, text, outcome, push, delivery);
		if (!result) return;
		this.notify(); // A registered waiter reserves synchronously before the message path can claim it.
		this.push(result);
	}
	/**
	 * Saved answers of a restore: all are registered first, then `restore` raises the saved waits, so each wait sees every
	 * answer before any is pushed as a message.
	 */
	publishAll(items: { id: string; run: string; text: string; outcome: string; push: Result["push"]; delivery?: string }[], restore?: () => void) {
		const added = items.flatMap(item => this.register(item.id, item.run, item.text, item.outcome, item.push, item.delivery) ?? []);
		restore?.();
		this.notify();
		for (const result of added) this.push(result);
	}
	private push(result: Result) {
		if (result.state !== "pending" || this.offered.has(result)) return;
		this.offered.add(result);
		result.push(result);
	}
	/** Call immediately before pi.sendMessage; a deferred pending result is still claimable by wait. */
	message(result: Result) {
		if (result.state !== "pending" || !this.uncommitted.has(result)) return false;
		this.messageReceipts.add(result);
		result.state = "message";
		this.uncommitted.delete(result);
		return true;
	}
	releaseMessage(result: Result) { if (result.state === "message") result.text = undefined; }
	notify() { for (const watcher of [...this.watchers]) watcher.check(); }
	status(ids: string[], messages?: number, checkpoints?: Map<string, Map<string, number> | undefined>, depth = 0) {
		depth = statusDepth(depth);
		return ids.map(id => {
			const target = this.targets.get(id);
			return target ? { id, run: target.run, ...target.snapshot(messages, checkpoints?.get(id), depth) } : { id, error: "Unknown or closed child ID" };
		});
	}
	ids() { return [...this.targets.keys()]; }
	committed(id: string, run: string): boolean {
		const result = this.results.get(id);
		return result?.run === run && result.state === "wait";
	}
	undelivered(id: string): boolean {
		return [...this.uncommitted].some(result => result.id === id) || this.notices.some(notice => (notice.message.details as { id?: string } | undefined)?.id === id && notice.current());
	}
	private receipt(result: Result) {
		return { id: result.id, run: result.run, delivery: result.delivery, delivered_via: result.state === "message" ? "message" : "wait", claimed_by: result.claimed_by };
	}
	private selection(ids: string[], options: WaitOptions, owner: string, confirmedOnly = false, runs?: Map<string, string | undefined>) {
		if (options.until != null && options.until !== "first" && options.until !== "all") throw new Error("until must be first or all");
		if (options.wake_on_alert != null && typeof options.wake_on_alert !== "boolean") throw new Error("wake_on_alert must be a boolean");
		const selected = new Map(runs ?? ids.map(id => [id, this.targets.get(id)?.run]));
		const changes = new Map(ids.map(id => [id, this.changes.get(id)]));
		const alerts = new Map(ids.map(id => [id, this.targets.get(id)?.alertVersion?.() ?? 0]));
		const checkpoints = new Map(ids.map(id => [id, this.targets.get(id)?.checkpoint?.()]));
		const held = new Set<Result>();
		const hold = (pending: Result[]) => {
			for (const r of pending) { this.offered.delete(r); r.state = "held"; r.claimed_by = owner; held.add(r); }
		};
		const release = () => {
			const released = [...held].filter(r => r.state === "held" && r.claimed_by === owner);
			for (const r of released) { r.state = "pending"; delete r.claimed_by; }
			held.clear(); this.notify();
			for (const r of released) this.push(r);
		};
		const check = (): WaitOutcome | undefined => {
			const changed = ids.flatMap(id => {
				const run = selected.get(id), target = this.targets.get(id), change = this.changes.get(id);
				return run && (target?.run !== run || change !== changes.get(id)) ? [{ id, run, change: change?.run === run ? change.change : "replaced" }] : [];
			});
			if (changed.length) return { reason: "target_changed", pending: [], receipts: [], changed };
			if (options.wake_on_alert !== false && ids.some(id => (this.targets.get(id)?.alertVersion?.() ?? 0) > alerts.get(id)!))
				return { reason: "alert", pending: [], receipts: [] };
			const available = ids.flatMap(id => { const r = this.results.get(id); return r && r.run === selected.get(id) ? [r] : []; });
			const pending = available.filter(r => r.state === "pending" || (r.state === "held" && r.claimed_by === owner));
			const receipts = available.filter(r => r.state !== "pending" && r.state !== "held" && (!confirmedOnly || r.state !== "reserved")).map(r => this.receipt(r));
			const ownedElsewhere = available.some(r => (r.state === "held" && r.claimed_by !== owner) || (confirmedOnly && r.state === "reserved"));
			if (options.until === "all") {
				hold(pending);
				if (ownedElsewhere || !ids.every(id => available.some(r => r.id === id) || !this.targets.get(id)?.active())) return;
			}
			if (pending.length) return { reason: "result", pending, receipts };
			if (receipts.length) return { reason: "receipt", pending: [], receipts };
			if (!ownedElsewhere && !ids.some(id => this.targets.get(id)?.active())) return { reason: "idle", pending: [], receipts: [] };
		};
		const output = ({ reason, pending, receipts, changed }: WaitOutcome) => json({ reason, timed_out: reason === "timeout",
			results: pending.map(r => ({ id: r.id, run: r.run, delivery: r.delivery, text: `${r.text}\n\n${FOLLOW_UP}`, outcome: r.outcome })), receipts,
			...(changed ? { changed } : {}), statuses: this.status(ids, undefined, checkpoints) });
		// For shutdown: held answers go back to pending without being pushed; they stay saved and a restored wait claims them again.
		const drop = () => {
			for (const r of held) if (r.state === "held" && r.claimed_by === owner) { r.state = "pending"; delete r.claimed_by; }
			held.clear();
		};
		return { held, hold, release, check, output, selected, drop };
	}
	wait(ids: string[], timeout: number, signal: AbortSignal, call: string, options: WaitOptions = {}) {
		signal.throwIfAborted();
		const owner = randomUUID(), selection = this.selection(ids, options, owner);
		this.activeWaits++;
		this.notify(); // Explicit caller-chosen waits supersede any implicit fallback deadline.
		return new Promise<ReturnType<typeof json>>((resolve, reject) => {
			let done = false, cancelTimer = () => {};
			const cleanup = () => { this.activeWaits--; this.watchers.delete(watcher); cancelTimer(); signal.removeEventListener("abort", abort); };
			const fail = (error: unknown) => {
				if (done) return;
				done = true; cleanup();
				try { selection.release(); } finally { reject(error); }
			};
			const finish = (outcome: WaitOutcome) => {
				if (done) return;
				try {
					const result = selection.output(outcome);
					for (const r of outcome.pending) { this.offered.delete(r); r.state = "reserved"; r.claimed_by = owner; selection.held.delete(r); }
					if (outcome.pending.length) this.reservations.set(owner, { owner, call, results: outcome.pending, signal });
					done = true; cleanup();
					try { selection.release(); resolve(result); } catch (error) { reject(error); }
				} catch (error) { fail(error); }
			};
			const watcher: Watch = { check: () => {
				if (done) return;
				try { const outcome = selection.check(); if (outcome) finish(outcome); } catch (error) { fail(error); }
			} };
			const abort = () => fail(signal.reason ?? new Error("aborted"));
			this.watchers.add(watcher); signal.addEventListener("abort", abort, { once: true });
			cancelTimer = deadlineTimer(timeout, () => finish({ reason: "timeout", pending: [], receipts: [] }));
			if (signal.aborted) abort();
			else {
				// Release old holds only after the replacement can claim them before normal push.
				try { this.replaceNotifications(targetKey(ids)); } catch (error) { fail(error); return; }
				watcher.check();
			}
		});
	}
	/** The receipt must persist before its subscription may deliver through the caller's safe sender. */
	notificationWait(ids: string[], timeout: number, signal: AbortSignal, call: string, options: WaitOptions = {}, restored?: { id: string; runs: Map<string, string | undefined>; deadlineAt: number; call?: string }): ReturnType<typeof json> & { terminate?: true } {
		signal.throwIfAborted();
		const owner = restored?.id ?? randomUUID(), selection = this.selection(ids, options, owner, true, restored?.runs);
		const deadlineAt = restored?.deadlineAt ?? Date.now() + timeout;
		let initial: WaitOutcome | undefined;
		try {
			// A restored wait is judged only after the saved answers are published (see publishAll).
			if (!restored) initial = selection.check();
			if (initial && initial.reason !== "result") {
				const result = selection.output(initial);
				this.replaceNotifications(targetKey(ids));
				return result;
			}
		} catch (error) { selection.release(); throw error; }
		const savedCall = restored ? restored.call : call;
		const openRecord = (): WaitRecord => ({ version: 1, wait_id: owner, open: true, ...(savedCall ? { call: savedCall } : {}), deadline_at: deadlineAt, until: options.until === "all" ? "all" : "first",
			wake_on_alert: options.wake_on_alert !== false,
			targets: ids.map(id => ({ id, ...(selection.selected.get(id) ? { run: selection.selected.get(id) } : {}) })) });
		let armed = !!restored, closed = false, outcome: WaitOutcome | undefined, cancelTimer = () => {};
		// A delivered wait stays open in the session until its child_wait is persisted (see finalize).
		const cleanup = () => {
			closed = true; this.notificationWaits.delete(owner); this.watchers.delete(watcher); this.activeWaits--;
			cancelTimer(); signal.removeEventListener("abort", abort);
		};
		// A canceled or replaced wait counts as closed only once its closing entry is saved; a failed write throws and the wait stays accepted.
		const cancel = (uncommittedOnly = false, replacedBy?: string) => {
			if (closed || (uncommittedOnly && armed)) return;
			this.journal?.(WAIT_ENTRY, { version: 1, wait_id: owner, open: false, ...(replacedBy ? { replaced_by: replacedBy } : {}) });
			cleanup(); selection.release();
		};
		const drop = () => { if (!closed) { cleanup(); selection.drop(); } };
		// Internal cancellations have no caller to tell: a failed write keeps the wait, to be tried again.
		const softCancel = (uncommittedOnly = false) => { try { cancel(uncommittedOnly); } catch { /* Stays accepted. */ } };
		// A wait whose own call fails is dropped at once, its closing entry written as well as possible.
		const discard = () => {
			if (closed) return;
			this.record(WAIT_ENTRY, { version: 1, wait_id: owner, open: false });
			cleanup(); selection.release();
		};
		const abort = () => softCancel(true);
		const finish = (value: WaitOutcome) => {
			if (closed || outcome) return;
			selection.hold(value.pending);
			outcome = value; this.watchers.delete(watcher); cancelTimer();
			if (armed && !this.settling) this.flushNotifications(!this.callerAborted);
		};
		const watcher: Watch = { check: () => {
			if (closed || outcome) return;
			try { const value = selection.check(); if (value) finish(value); }
			catch { softCancel(); }
		} };
		const wait: NotificationWait = {
			id: owner, call, key: targetKey(ids),
			ready: () => armed && !!outcome && !closed,
			confirm: kept => {
				if (closed || armed) return;
				if (!kept) { softCancel(); return; }
				armed = true;
				// A persisted observation belongs to the caller session, not its originating turn.
				signal.removeEventListener("abort", abort);
			},
			cancel, drop,
			follow: (id, from, to) => {
				if (!restored || closed || selection.selected.get(id) !== from) return;
				selection.selected.set(id, to);
				// Saved again, so a second crash restores the wait on the continuing run.
				this.record(WAIT_ENTRY, openRecord());
			},
			flush: triggerTurn => {
				if (!wait.ready()) return;
				let result: ReturnType<typeof json>;
				try {
					// Explicit management may invalidate a held completion before its receipt commits.
					if (outcome!.pending.some(r => r.state !== "held" || r.claimed_by !== owner))
						outcome = selection.check() ?? { reason: "target_changed", pending: [], receipts: [] };
					result = selection.output(outcome!);
				} catch { softCancel(); return; }
				const message = { customType: "child_wait", content: JSON.stringify({ ...result.details, wait_id: owner }), display: true,
					details: { ...result.details, wait_id: owner } };
				// Claim before sending: triggerTurn may synchronously re-enter the broker.
				const claimed = outcome!.pending.filter(r => r.state === "held" && r.claimed_by === owner);
				for (const r of claimed) { r.state = "message"; this.uncommitted.delete(r); selection.held.delete(r); }
				cleanup();
				// Pi retains triggerTurn:false custom messages through clearQueue/Esc and persists them at turn end.
				const busy = this.caller?.isIdle() === false;
				if (busy && triggerTurn) this.unansweredNotifications.add(owner);
				try { this.send(message, { triggerTurn: triggerTurn && !busy }); }
				catch {
					this.unansweredNotifications.delete(owner);
					for (const r of claimed) { r.state = "held"; this.uncommitted.add(r); selection.held.add(r); }
					selection.release(); return;
				}
				this.sentWaits.add(owner);
				for (const r of claimed) { this.messageReceipts.add(r); this.releaseMessage(r); }
				selection.release();
			},
		};
		let receipt: ReturnType<typeof json>;
		try { receipt = json({ reason: "waiting", wait_id: owner, timed_out: false, results: [], receipts: [], statuses: this.status(ids) }); }
		catch (error) { selection.release(); throw error; }
		// Saved at creation: a crash after its tool result is saved, but before the turn ends, still finds the wait.
		// A wait whose opening record cannot be saved is not accepted: the write is not best effort.
		if (!restored) {
			try { this.journal?.(WAIT_ENTRY, openRecord()); } catch (error) { selection.release(); throw error; }
		}
		this.activeWaits++; this.notificationWaits.set(owner, wait); this.watchers.add(watcher);
		signal.addEventListener("abort", abort, { once: true });
		cancelTimer = deadlineTimer(timeout, () => finish({ reason: "timeout", pending: [], receipts: [] }));
		if (signal.aborted) discard();
		else {
			// The new wait is already saved; an old one is closed only after that, and a failed closing write fails this call.
			try { this.replaceNotifications(wait.key, wait); } catch (error) { discard(); throw error; }
			if (initial) finish(initial); else if (!restored) watcher.check();
		}
		this.notify();
		return { ...receipt, terminate: true as const };
	}
	/** Non-consuming implicit fallback: normal message delivery still owns the result. */
	async observe(signal: AbortSignal, timeout = DEFAULT_WAIT_MS, pending?: () => boolean) {
		const active = this.ids().filter(id => this.targets.get(id)?.active());
		if ((!active.length && !pending?.()) || this.activeWaits) return;
		// An idle caller can still owe a turn to an already-pushed child result. Wait for that wakeup,
		// rather than repeatedly awaiting an already-resolved Promise and starving the event loop.
		const starts = this.nativeStarts;
		const selected = new Map((active.length ? active : this.ids()).map(id => [id, this.results.get(id)?.delivery]));
		await new Promise<void>((resolve, reject) => {
			let cancelTimer = () => {};
			const finish = () => { cleanup(); resolve(); };
			const watcher = { check: () => {
				if (this.activeWaits || this.nativeStarts !== starts || (![...selected].some(([id]) => this.targets.get(id)?.active()) && !pending?.()) || [...selected].some(([id, delivery]) => this.results.get(id)?.delivery !== delivery)) finish();
			} };
			const abort = () => { cleanup(); reject(signal.reason ?? new Error("aborted")); };
			const cleanup = () => { this.watchers.delete(watcher); cancelTimer(); signal.removeEventListener("abort", abort); };
			this.watchers.add(watcher); signal.addEventListener("abort", abort, { once: true });
			cancelTimer = deadlineTimer(timeout, () => {
				const diagnostic = { customType: "child_wait", content: JSON.stringify({ reason: "timeout", timed_out: true, results: [], statuses: this.status([...selected.keys()]) }), display: true };
				if (this.settling) this.diagnostics.push(diagnostic);
				else this.send(diagnostic, { triggerTurn: !this.callerAborted });
				finish();
			});
			if (signal.aborted) abort(); else watcher.check();
		});
	}
}

export const waitResult = json;
