// One direct caller's registry and result broker. No process-global child or delivery state.
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RunningCounts } from "./counts.ts";
import { ACCEPT_ENTRY, recordDelivery } from "./persistence.ts";
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
 * The outcome of a wait that ran inside a codemode script (`root` is the script's call), written when the wait call ends.
 * A restore counts its results as delivered only if the wait succeeded and the script's own result is saved without error.
 */
export type AcceptRecord = { version: 1; call: string; root: string; ok: boolean; results: { run: string; delivery: string }[] };

export const DEFAULT_WAIT_MS = 300000;
export type Target = { id: string; run: string; recovers?: string; active(): boolean; title?(): string | undefined; alertVersion?(): number; snapshot(messages?: number, depth?: number): Record<string, unknown> };
export type WaitOptions = { until?: "first" | "all"; wake_on_alert?: boolean };
export type Result = { id: string; run: string; delivery: string; text?: string; outcome: string; title?: string;
	state: "pending" | "held" | "reserved" | "wait"; claimed_by?: string };
type Watch = { check(): void };
type Reservation = { call: string; results: Result[] };
type WaitOutcome = { reason: string; pending: Result[]; receipts: Record<string, unknown>[]; changed?: unknown };

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
const WAIT_LABELS: Record<string, string> = { steered: "interrupted", receipt: "no new answer, already delivered" };

/**
 * What the model reads from a wait that returned no answer: one short line, never per-agent detail.
 * Full detail stays behind the explicit `status` action.
 */
function waitLine(outcome: WaitOutcome, running: string[], closed: string[]): string {
	let line = WAIT_LABELS[outcome.reason] ?? outcome.reason;
	if (outcome.changed) line += `: ${(outcome.changed as { id: string; change: string }[]).map(c => `${c.id} ${c.change}`).join(", ")}`;
	if (outcome.reason === "receipt") line += `: ${outcome.receipts.map(r => r.id).join(", ")}`;
	line += running.length ? `; still running: ${running.join(", ")}` : "; nothing running";
	if (closed.length) line += `; unknown or closed: ${closed.join(", ")}`;
	return line;
}

export class Coordinator {
	readonly targets = new Map<string, Target>();
	private results = new Map<string, Result[]>();
	// Older runs can still have an unfinalized handoff when send starts the next run.
	private uncommitted = new Set<Result>();
	private watchers = new Set<Watch>();
	private autoReservations = new Map<string, Result[]>();
	private changes = new Map<string, { run: string; change: string }>();
	private reservations = new Map<string, Reservation>();
	private notices: { message: Parameters<ExtensionAPI["sendMessage"]>[0]; current(): boolean; delivered(): void; send: ExtensionAPI["sendMessage"] }[] = [];
	private parents = new Map<string, string>();
	private completed = new Map<string, boolean>();
	private settling = false;
	private autoWaiting = false;
	private deferredProgress = false;
	private callerAborted = false;
	private endSignal?: AbortSignal;
	private markAborted = () => { this.callerAborted = true; };
	queue: Promise<unknown> = Promise.resolve();
	private send: ExtensionAPI["sendMessage"];
	private journal?: (type: string, data: object) => void;
	constructor(pi: ExtensionAPI, send: ExtensionAPI["sendMessage"] = (message, options) => pi.sendMessage(message, options), journal?: (type: string, data: object) => void) {
		this.send = send;
		this.journal = journal;
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
		pi.on("agent_start", () => { this.callerAborted = false; this.notify(); });
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
			if (notifications && !this.callerAborted) return { continue: true };
			this.settling = true;
		});
		pi.on("agent_settled", (event, ctx) => this.settleCore(ctx, event.aborted));
		pi.on("session_shutdown", () => {
			this.callerAborted = true;
			this.notices.length = 0;
			this.endSignal?.removeEventListener("abort", this.markAborted);
		});
	}
	/** The public core continuation bypasses AgentSession's final settlement event. */
	settleCore(ctx: ExtensionContext, aborted: boolean) {
		this.callerAborted = aborted;
		// Commit queued receipts while still settling; only the final flush may wake the caller.
		this.settling = true;
		this.finalize(ctx, true);
		this.parents.clear(); this.completed.clear();
		this.endSignal?.removeEventListener("abort", this.markAborted); this.endSignal = undefined;
		this.callerAborted = aborted; this.settling = false;
		this.flushNotifications(!aborted);
		this.notify();
	}
	setAutoWaiting(active: boolean) { this.autoWaiting = active; }
	flushDeferredProgress() {
		this.autoWaiting = false;
		this.deferredProgress = false;
		if (!this.settling) this.flushNotifications(false);
	}
	/** Progress notices use a settlement-safe sender, independent of result ownership. */
	notification(message: Parameters<ExtensionAPI["sendMessage"]>[0], current: () => boolean, delivered: () => void, send = this.send): void {
		this.notices.push({ message, current, delivered, send });
		if (!this.settling) this.flushNotifications(!this.callerAborted);
	}
	private flushNotifications(triggerTurn: boolean) {
		if (this.autoWaiting && this.notices.length) this.deferredProgress = true;
		if (this.autoWaiting || this.deferredProgress) return 0;
		const notices = this.notices.splice(0).filter(notice => notice.current());
		for (const [i, notice] of notices.entries()) {
			if (!notice.current()) continue;
			notice.send(notice.message, { triggerTurn: triggerTurn && i === notices.length - 1 });
			notice.delivered();
		}
		return notices.length;
	}
	private root(call: string) {
		const seen = new Set<string>();
		while (this.parents.has(call) && !seen.has(call)) { seen.add(call); call = this.parents.get(call)!; }
		return call;
	}
	private record(type: string, data: AcceptRecord) {
		// A failed write may lose a wait after a crash, but must not break the live wait.
		try { this.journal?.(type, data); } catch { /* Best effort. */ }
	}
	private saveReceipt(ctx: ExtensionContext, run: string) {
		// Receipt failure may repeat delivery after wake, but must not block the handoff.
		try { recordDelivery(ctx.sessionManager, run); } catch { /* Best effort. */ }
	}
	/** Only a successful finalized, persisted outer toolResult commits a wait handoff. */
	private finalize(ctx: ExtensionContext, settled = false) {
		for (const [owner, reservation] of this.reservations) {
			const root = this.root(reservation.call);
			const entry = ctx.sessionManager.getBranch().findLast(e => e.type === "message" && e.message.role === "toolResult" && e.message.toolCallId === root);
			const message = entry?.type === "message" && entry.message.role === "toolResult" ? entry.message : undefined;
			if (!message && !settled) continue;
			const success = message && !message.isError && this.completed.get(reservation.call) !== false;
			// Direct results must still carry the handoff in their saved details (the model text holds no delivery id).
			// A successful outer script may intentionally filter it.
			const body = message ? JSON.stringify(message.details ?? null) : "";
			const kept = success && (root !== reservation.call || reservation.results.every(r => body.includes(r.delivery)));
			this.reservations.delete(owner);
			for (const result of reservation.results) {
				if (result.state !== "reserved" || result.claimed_by !== owner) continue;
				if (kept) { this.saveReceipt(ctx, result.run); result.state = "wait"; result.text = undefined; this.uncommitted.delete(result); }
				else { result.state = "pending"; delete result.claimed_by; }
			}
		}
		this.notify();
		if (!this.settling) this.flushNotifications(!this.callerAborted);
	}
	stopBackground() { this.callerAborted = true; }
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
	begin(target: Target) { this.add(target); }
	private register(id: string, run: string, text: string, outcome: string, delivery: string = randomUUID(), title?: string): Result | undefined {
		if (!this.targets.has(id) || this.results.get(id)?.some(result => result.run === run)) return;
		const result: Result = { id, run, delivery, text, outcome, state: "pending", ...(title ? { title } : {}) };
		const results = this.results.get(id) ?? [];
		results.push(result);
		this.results.set(id, results);
		this.uncommitted.add(result);
		return result;
	}
	publish(id: string, run: string, text: string, outcome: string, delivery?: string, title?: string) {
		if (this.register(id, run, text, outcome, delivery, title)) this.notify();
	}
	publishAll(items: { id: string; run: string; text: string; outcome: string; delivery?: string; title?: string }[]) {
		for (const item of items) this.register(item.id, item.run, item.text, item.outcome, item.delivery, item.title);
		this.notify();
	}
	notify() { for (const watcher of [...this.watchers]) watcher.check(); }
	/** The automatic consumer shares the same result states as explicit waits. */
	autoSource(ctx: ExtensionContext) {
		let ended = false;
		const listeners = new Set<(value: null | true) => void>();
		const owned = new Set<string>();
		const watcher: Watch = { check: () => {
			for (const listener of [...listeners]) {
				try { listener(true); } catch { /* A consumer cannot break the broker. */ }
			}
		} };
		this.watchers.add(watcher);
		const release = (token: string) => {
			const results = this.autoReservations.get(token);
			if (!owned.delete(token) || !results) return;
			this.autoReservations.delete(token);
			for (const result of results) if (result.state === "reserved" && result.claimed_by === token) {
				result.state = "pending"; delete result.claimed_by;
			}
			this.notify();
		};
		const source = {
			version: 1 as const,
			snapshot: () => {
				const targets = ended ? [] : [...this.targets.values()].filter(target => target.active());
				const titles: Record<string, string> = {};
				for (const target of targets) {
					const title = target.title?.();
					if (title) titles[target.id] = title;
				}
				return { targets: targets.map(target => target.id), titles,
					ready: !ended && [...this.uncommitted].some(result => result.state === "pending") };
			},
			subscribe: (listener: (value: null | true) => void) => {
				if (ended) { listener(null); return () => {}; }
				listeners.add(listener);
				return () => { listeners.delete(listener); };
			},
			claim: () => {
				if (ended) return undefined;
				const results = [...this.uncommitted].filter(result => result.state === "pending");
				if (!results.length) return undefined;
				const token = randomUUID();
				for (const result of results) { result.state = "reserved"; result.claimed_by = token; }
				this.autoReservations.set(token, results); owned.add(token);
				return { token, results: results.map(result => ({ id: result.id, run: result.run, delivery: result.delivery,
					outcome: result.outcome, text: `${result.text}\n\n${FOLLOW_UP}`, ...(result.title ? { title: result.title } : {}) })) };
			},
			commit: (token: string) => {
				const results = this.autoReservations.get(token);
				if (!owned.delete(token) || !results) return;
				this.autoReservations.delete(token);
				for (const result of results) if (result.state === "reserved" && result.claimed_by === token) {
					this.saveReceipt(ctx, result.run); result.state = "wait"; result.text = undefined; this.uncommitted.delete(result);
				}
				this.notify();
			},
			release,
		};
		return { source, close: () => {
			if (ended) return;
			ended = true; this.watchers.delete(watcher);
			for (const token of [...owned]) release(token);
			for (const listener of listeners) { try { listener(null); } catch { /* isolated */ } }
			listeners.clear();
		} };
	}
	status(ids: string[], messages?: number, depth = 0) {
		depth = statusDepth(depth);
		return ids.map(id => {
			const target = this.targets.get(id);
			return target ? { id, run: target.run, ...target.snapshot(messages, depth) } : { id, error: "Unknown or closed child ID" };
		});
	}
	ids() { return [...this.targets.keys()]; }
	committed(id: string, run: string): boolean {
		return this.results.get(id)?.some(result => result.run === run && result.state === "wait") ?? false;
	}
	undelivered(id: string): boolean {
		return [...this.uncommitted].some(result => result.id === id) || this.notices.some(notice => (notice.message.details as { id?: string } | undefined)?.id === id && notice.current());
	}
	private receipt(result: Result) {
		return { id: result.id, run: result.run, delivery: result.delivery, delivered_via: "wait", claimed_by: result.claimed_by };
	}
	private selection(ids: string[], options: WaitOptions, owner: string) {
		if (options.until != null && options.until !== "first" && options.until !== "all") throw new Error("until must be first or all");
		if (options.wake_on_alert != null && typeof options.wake_on_alert !== "boolean") throw new Error("wake_on_alert must be a boolean");
		const selected = new Map(ids.map(id => [id, this.targets.get(id)?.run]));
		const changes = new Map(ids.map(id => [id, this.changes.get(id)]));
		const alerts = new Map(ids.map(id => [id, this.targets.get(id)?.alertVersion?.() ?? 0]));
		const held = new Set<Result>();
		const hold = (pending: Result[]) => {
			for (const r of pending) { r.state = "held"; r.claimed_by = owner; held.add(r); }
		};
		const release = () => {
			const released = [...held].filter(r => r.state === "held" && r.claimed_by === owner);
			for (const r of released) { r.state = "pending"; delete r.claimed_by; }
			held.clear(); this.notify();
		};
		const check = (): WaitOutcome | undefined => {
			const changed = ids.flatMap(id => {
				const run = selected.get(id), target = this.targets.get(id), change = this.changes.get(id);
				return run && (target?.run !== run || change !== changes.get(id)) ? [{ id, run, change: change?.run === run ? change.change : "replaced" }] : [];
			});
			if (changed.length) return { reason: "target_changed", pending: [], receipts: [], changed };
			if (options.wake_on_alert === true && ids.some(id => (this.targets.get(id)?.alertVersion?.() ?? 0) > alerts.get(id)!))
				return { reason: "alert", pending: [], receipts: [] };
			const available = ids.flatMap(id => {
				const results = this.results.get(id) ?? [];
				const pending = results.find(result => result.state === "pending" || result.state === "held");
				const current = results.find(result => result.run === selected.get(id));
				return pending ? [pending] : current ? [current] : [];
			});
			const pending = available.filter(r => r.state === "pending" || (r.state === "held" && r.claimed_by === owner));
			const receipts = available.filter(r => r.state !== "pending" && r.state !== "held").map(r => this.receipt(r));
			const ownedElsewhere = available.some(r => r.state === "held" && r.claimed_by !== owner);
			if (options.until === "all") {
				hold(pending);
				if (ownedElsewhere || !ids.every(id => available.some(r => r.id === id) || !this.targets.get(id)?.active())) return;
			}
			if (pending.length) return { reason: "result", pending, receipts };
			if (receipts.length) return { reason: "receipt", pending: [], receipts };
			if (!ownedElsewhere && !ids.some(id => this.targets.get(id)?.active())) return { reason: "idle", pending: [], receipts: [] };
		};
		// The wait is a signal: the model reads only final answers, or one short line. `details` serves cards and
		// bookkeeping and is never sent to the model.
		const output = (outcome: WaitOutcome) => {
			const { reason, pending, receipts, changed } = outcome;
			const details = { reason, timed_out: reason === "timeout",
				results: pending.map(r => ({ id: r.id, run: r.run, delivery: r.delivery, text: `${r.text}\n\n${FOLLOW_UP}`, outcome: r.outcome })), receipts,
				...(changed ? { changed } : {}) };
			if (!pending.length) {
				const running = ids.filter(id => this.targets.get(id)?.active());
				const closed = ids.filter(id => !this.targets.has(id));
				return { content: [{ type: "text" as const, text: waitLine(outcome, running, closed) }], details };
			}
			const answers = pending.map(r => ({ id: r.id, ...(r.title ? { title: r.title } : {}), outcome: r.outcome, text: `${r.text}\n\n${FOLLOW_UP}` }));
			return { content: [{ type: "text" as const, text: JSON.stringify({ results: answers }) }], details };
		};
		return { held, release, check, output };
	}
	wait(ids: string[], timeout: number, signal: AbortSignal, call: string, options: WaitOptions = {}, steering?: { signal: AbortSignal; reason?: "work_pending" | "direct_wait_required" }) {
		signal.throwIfAborted();
		const owner = randomUUID(), selection = this.selection(ids, options, owner);
		return new Promise<ReturnType<typeof json>>((resolve, reject) => {
			let done = false, cancelTimer = () => {};
			const cleanup = () => { this.watchers.delete(watcher); cancelTimer(); signal.removeEventListener("abort", abort); steering?.signal.removeEventListener("abort", steer); };
			const fail = (error: unknown) => {
				if (done) return;
				done = true; cleanup();
				try { selection.release(); } finally { reject(error); }
			};
			const finish = (outcome: WaitOutcome) => {
				if (done) return;
				try {
					const result = selection.output(outcome);
					for (const r of outcome.pending) { r.state = "reserved"; r.claimed_by = owner; selection.held.delete(r); }
					if (outcome.pending.length) this.reservations.set(owner, { call, results: outcome.pending });
					done = true; cleanup();
					try { selection.release(); resolve(result); } catch (error) { reject(error); }
				} catch (error) { fail(error); }
			};
			const watcher: Watch = { check: () => {
				if (done) return;
				try { const outcome = selection.check(); if (outcome) finish(outcome); } catch (error) { fail(error); }
			} };
			const abort = () => fail(signal.reason ?? new Error("aborted"));
			const steer = () => finish({ reason: "steered", pending: [], receipts: [] });
			this.watchers.add(watcher); signal.addEventListener("abort", abort, { once: true });
			steering?.signal.addEventListener("abort", steer, { once: true });
			cancelTimer = deadlineTimer(timeout, () => finish({ reason: "timeout", pending: [], receipts: [] }));
			if (signal.aborted) abort();
			else if (steering?.reason) finish({ reason: steering.reason, pending: [], receipts: [] });
			else if (steering?.signal.aborted) steer();
			else watcher.check();
		});
	}

}

export const waitResult = json;
