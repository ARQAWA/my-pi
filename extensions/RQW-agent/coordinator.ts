// One direct caller's registry and result broker. No process-global child or delivery state.
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RunningCounts } from "./counts.ts";

/** Caller-owned children and results, including results not yet consumed by the caller model. */
export type RuntimeHandle = {
	pending(): boolean;
	wait(signal: AbortSignal): Promise<void>;
	ids(): string[];
	/** Compact read-only diagnostics; depth counts generations below these direct children. */
	status?(depth: number): Record<string, unknown>[];
	/** Native running children, including descendants. Pending results count zero. */
	runningCounts(): RunningCounts;
	resume?(signal: AbortSignal, recoveredOnly?: boolean): Promise<number>;
	settle?(aborted: boolean): void;
	abortAll(): void;
	close(): void;
};

export const DEFAULT_WAIT_MS = 300000;
export type Target = { id: string; run: string; active(): boolean; checkpoint?(): Map<string, number>; alertVersion?(): number; snapshot(messages?: number, checkpoint?: Map<string, number>, depth?: number): Record<string, unknown> };
export type WaitOptions = { until?: "first" | "all"; wake_on_alert?: boolean };
export type Result = { id: string; run: string; delivery: string; text?: string; outcome: string;
	state: "pending" | "held" | "reserved" | "message" | "wait"; claimed_by?: string; push(result: Result): void };
type Watch = { check(): void };
type Reservation = { owner: string; call: string; results: Result[]; signal: AbortSignal };
type WaitOutcome = { reason: string; pending: Result[]; receipts: Record<string, unknown>[]; changed?: unknown };
type NotificationWait = { call: string; key: string; ready(): boolean; confirm(kept: boolean): void; cancel(uncommittedOnly?: boolean): void; flush(triggerTurn: boolean): void };

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
	private watchers = new Set<Watch>();
	private changes = new Map<string, { run: string; change: string }>();
	private reservations = new Map<string, Reservation>();
	private notificationWaits = new Map<string, NotificationWait>();
	private notices: { message: Parameters<ExtensionAPI["sendMessage"]>[0]; current(): boolean; delivered(): void; send: ExtensionAPI["sendMessage"] }[] = [];
	private parents = new Map<string, string>();
	private completed = new Map<string, boolean>();
	private activeWaits = 0;
	private nativeStarts = 0;
	private settling = false;
	private callerAborted = false;
	private endSignal?: AbortSignal;
	private diagnostics: { customType: string; content: string; display: boolean }[] = [];
	private markAborted = () => { this.callerAborted = true; this.cancelNotificationWaits(true); };
	queue: Promise<unknown> = Promise.resolve();
	private send: ExtensionAPI["sendMessage"];
	constructor(pi: ExtensionAPI, send: ExtensionAPI["sendMessage"] = (message, options) => pi.sendMessage(message, options)) {
		this.send = send;
		// Real parentToolCallId links, independent of nestedCalls' bounded presentation log and ID spelling.
		pi.on("tool_call", event => { if (event.parentToolCallId) this.parents.set(event.toolCallId, event.parentToolCallId); });
		pi.on("tool_execution_end", event => {
			this.completed.set(event.toolCallId, !event.isError);
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
		pi.on("agent_before_settle", () => {
			const notifications = this.flushNotifications(false);
			const messages = this.diagnostics.splice(0);
			for (const message of messages) this.send(message, { triggerTurn: false });
			if ((notifications || messages.length) && !this.callerAborted) return { continue: true };
			this.settling = true;
		});
		pi.on("agent_settled", (event, ctx) => this.settleCore(ctx, event.aborted));
		pi.on("session_shutdown", () => {
			this.callerAborted = true; this.cancelNotificationWaits();
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
	private cancelNotificationWaits(uncommittedOnly = false) {
		for (const wait of [...this.notificationWaits.values()]) wait.cancel(uncommittedOnly);
	}
	private replaceNotifications(key: string, replacement?: NotificationWait) {
		for (const wait of [...this.notificationWaits.values()])
			if (wait !== replacement && wait.key === key) wait.cancel();
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
	/** Only a successful finalized, persisted outer toolResult commits a wait handoff. */
	private finalize(ctx: ExtensionContext, settled = false) {
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
				if (kept) { result.state = "wait"; result.text = undefined; this.uncommitted.delete(result); }
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
	publish(id: string, run: string, text: string, outcome: string, push: Result["push"]) {
		if (this.targets.get(id)?.run !== run) return;
		const result: Result = { id, run, delivery: randomUUID(), text, outcome, state: "pending", push };
		this.results.set(id, result);
		this.uncommitted.add(result);
		this.notify(); // A registered waiter reserves synchronously before the message path can claim it.
		this.push(result);
	}
	private push(result: Result) {
		if (result.state !== "pending" || this.offered.has(result)) return;
		this.offered.add(result);
		result.push(result);
	}
	/** Call immediately before pi.sendMessage; a deferred pending result is still claimable by wait. */
	message(result: Result) {
		if (result.state !== "pending" || !this.uncommitted.has(result)) return false;
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
	private receipt(result: Result) {
		return { id: result.id, run: result.run, delivery: result.delivery, delivered_via: result.state === "message" ? "message" : "wait", claimed_by: result.claimed_by };
	}
	private selection(ids: string[], options: WaitOptions, owner: string, confirmedOnly = false) {
		if (options.until != null && options.until !== "first" && options.until !== "all") throw new Error("until must be first or all");
		if (options.wake_on_alert != null && typeof options.wake_on_alert !== "boolean") throw new Error("wake_on_alert must be a boolean");
		const selected = new Map(ids.map(id => [id, this.targets.get(id)?.run]));
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
			results: pending.map(r => ({ id: r.id, run: r.run, delivery: r.delivery, text: r.text, outcome: r.outcome })), receipts,
			...(changed ? { changed } : {}), statuses: this.status(ids, undefined, checkpoints) });
		return { held, hold, release, check, output };
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
				this.replaceNotifications(targetKey(ids));
				watcher.check();
			}
		});
	}
	/** The receipt must persist before its subscription may deliver through the caller's safe sender. */
	notificationWait(ids: string[], timeout: number, signal: AbortSignal, call: string, options: WaitOptions = {}): ReturnType<typeof json> & { terminate?: true } {
		signal.throwIfAborted();
		const owner = randomUUID(), selection = this.selection(ids, options, owner, true);
		let initial: WaitOutcome | undefined;
		try {
			initial = selection.check();
			if (initial && initial.reason !== "result") {
				const result = selection.output(initial);
				this.replaceNotifications(targetKey(ids));
				return result;
			}
		} catch (error) { selection.release(); throw error; }
		let armed = false, closed = false, outcome: WaitOutcome | undefined, cancelTimer = () => {};
		const cleanup = () => {
			closed = true; this.notificationWaits.delete(owner); this.watchers.delete(watcher); this.activeWaits--;
			cancelTimer(); signal.removeEventListener("abort", abort);
		};
		const cancel = (uncommittedOnly = false) => {
			if (!closed && (!uncommittedOnly || !armed)) { cleanup(); selection.release(); }
		};
		const abort = () => cancel(true);
		const finish = (value: WaitOutcome) => {
			if (closed || outcome) return;
			selection.hold(value.pending);
			outcome = value; this.watchers.delete(watcher); cancelTimer();
			if (armed && !this.settling) this.flushNotifications(!this.callerAborted);
		};
		const watcher: Watch = { check: () => {
			if (closed || outcome) return;
			try { const value = selection.check(); if (value) finish(value); }
			catch { cancel(); }
		} };
		const wait: NotificationWait = {
			call, key: targetKey(ids),
			ready: () => armed && !!outcome && !closed,
			confirm: kept => {
				if (closed || armed) return;
				if (!kept) { cancel(); return; }
				armed = true;
				// A persisted observation belongs to the caller session, not its originating turn.
				signal.removeEventListener("abort", abort);
			},
			cancel,
			flush: triggerTurn => {
				if (!wait.ready()) return;
				let result: ReturnType<typeof json>;
				try {
					// Explicit management may invalidate a held completion before its receipt commits.
					if (outcome!.pending.some(r => r.state !== "held" || r.claimed_by !== owner))
						outcome = selection.check() ?? { reason: "target_changed", pending: [], receipts: [] };
					result = selection.output(outcome!);
				} catch { cancel(); return; }
				const message = { customType: "child_wait", content: JSON.stringify({ ...result.details, wait_id: owner }), display: true,
					details: { ...result.details, wait_id: owner } };
				// Claim before sending: triggerTurn may synchronously re-enter the broker.
				const claimed = outcome!.pending.filter(r => r.state === "held" && r.claimed_by === owner);
				for (const r of claimed) { r.state = "message"; this.uncommitted.delete(r); selection.held.delete(r); }
				cleanup();
				try { this.send(message, { triggerTurn }); }
				catch {
					for (const r of claimed) { r.state = "held"; this.uncommitted.add(r); selection.held.add(r); }
					selection.release(); return;
				}
				for (const r of claimed) this.releaseMessage(r);
				selection.release();
			},
		};
		let receipt: ReturnType<typeof json>;
		try { receipt = json({ reason: "waiting", wait_id: owner, timed_out: false, results: [], receipts: [], statuses: this.status(ids) }); }
		catch (error) { selection.release(); throw error; }
		this.activeWaits++; this.notificationWaits.set(owner, wait); this.watchers.add(watcher);
		signal.addEventListener("abort", abort, { once: true });
		cancelTimer = deadlineTimer(timeout, () => finish({ reason: "timeout", pending: [], receipts: [] }));
		if (signal.aborted) cancel();
		else {
			this.replaceNotifications(wait.key, wait);
			if (initial) finish(initial); else watcher.check();
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
