// One direct caller's registry and result broker. No process-global child or delivery state.
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const DEFAULT_WAIT_MS = 300000;
export type Target = { id: string; run: string; active(): boolean; checkpoint?(): Map<string, number>; snapshot(messages?: number, checkpoint?: Map<string, number>): Record<string, unknown> };
export type Result = { id: string; run: string; delivery: string; text?: string; outcome: string;
	state: "pending" | "reserved" | "message" | "wait"; claimed_by?: string; push(result: Result): void };
type Watch = { check(): void };
type Reservation = { owner: string; call: string; results: Result[]; signal: AbortSignal };

export function waitTimeout(value?: number | null) {
	if (value == null) return DEFAULT_WAIT_MS;
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error("timeout_ms must be a positive finite safe integer");
	return value;
}
export function targetIds(ids: unknown): string[] {
	if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== "string" || !/^(agent|code_writer|shell_runner)#[1-9]\d*$/.test(id)))
		throw new Error("ids must be a nonempty array of full child IDs (agent#N, code_writer#N, shell_runner#N)");
	return [...new Set(ids)];
}
export function messageCount(value?: number | null) {
	if (value == null) return 8;
	if (!Number.isInteger(value) || value < 5 || value > 10) throw new Error("messages must be an integer from 5 to 10");
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

export class Coordinator {
	readonly targets = new Map<string, Target>();
	private results = new Map<string, Result>();
	// Older runs can still have an unfinalized handoff when send starts the next run.
	private uncommitted = new Set<Result>();
	private watchers = new Set<Watch>();
	private changes = new Map<string, { run: string; change: string }>();
	private reservations = new Map<string, Reservation>();
	private parents = new Map<string, string>();
	private completed = new Map<string, boolean>();
	private activeWaits = 0;
	private nativeStarts = 0;
	private settling = false;
	private callerAborted = false;
	private endSignal?: AbortSignal;
	private diagnostics: { customType: string; content: string; display: boolean }[] = [];
	private markAborted = () => { this.callerAborted = true; };
	queue: Promise<unknown> = Promise.resolve();
	private pi: ExtensionAPI;
	constructor(pi: ExtensionAPI) {
		this.pi = pi;
		// Real parentToolCallId links, independent of nestedCalls' bounded presentation log and ID spelling.
		pi.on("tool_call", event => { if (event.parentToolCallId) this.parents.set(event.toolCallId, event.parentToolCallId); });
		pi.on("tool_execution_end", event => {
			this.completed.set(event.toolCallId, !event.isError);
		});
		pi.on("turn_end", (_event, ctx) => this.finalize(ctx));
		pi.on("agent_start", () => { this.callerAborted = false; this.nativeStarts++; this.notify(); });
		pi.on("turn_start", () => { this.settling = false; });
		pi.on("agent_end", (_event, ctx) => {
			this.finalize(ctx); this.settling = true;
			this.endSignal?.removeEventListener("abort", this.markAborted);
			this.endSignal = ctx.signal;
			if (ctx.signal?.aborted) this.callerAborted = true;
			else ctx.signal?.addEventListener("abort", this.markAborted, { once: true });
		});
		pi.on("agent_before_settle", () => {
			const messages = this.diagnostics.splice(0);
			for (const message of messages) this.pi.sendMessage(message, { triggerTurn: false });
			if (messages.length && !this.callerAborted) return { continue: true };
			this.settling = true;
		});
		pi.on("agent_settled", (event, ctx) => {
			this.finalize(ctx, true); this.parents.clear(); this.completed.clear();
			this.endSignal?.removeEventListener("abort", this.markAborted); this.endSignal = undefined;
			this.callerAborted = event.aborted; this.settling = false;
			const messages = this.diagnostics.splice(0);
			messages.forEach((message, i) => this.pi.sendMessage(message, { triggerTurn: !event.aborted && i === messages.length - 1 }));
			this.notify();
		});
		pi.on("session_shutdown", () => { this.diagnostics.length = 0; this.endSignal?.removeEventListener("abort", this.markAborted); });
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
				else { result.state = "pending"; delete result.claimed_by; result.push(result); }
			}
		}
		this.notify();
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
		if (result.state === "pending") push(result);
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
	status(ids: string[], messages?: number, checkpoints?: Map<string, Map<string, number> | undefined>) {
		return ids.map(id => {
			const target = this.targets.get(id);
			return target ? { id, run: target.run, ...target.snapshot(messages, checkpoints?.get(id)) } : { id, error: "Unknown or closed child ID" };
		});
	}
	ids() { return [...this.targets.keys()]; }
	private receipt(result: Result) {
		return { id: result.id, run: result.run, delivery: result.delivery, delivered_via: result.state === "message" ? "message" : "wait", claimed_by: result.claimed_by };
	}
	wait(ids: string[], timeout: number, signal: AbortSignal, call: string) {
		signal.throwIfAborted();
		const selected = new Map(ids.map(id => [id, this.targets.get(id)?.run]));
		const initialChanges = new Map(ids.map(id => [id, this.changes.get(id)]));
		const checkpoints = new Map(ids.map(id => [id, this.targets.get(id)?.checkpoint?.()]));
		const owner = randomUUID();
		this.activeWaits++;
		this.notify(); // Explicit caller-chosen waits supersede any implicit fallback deadline.
		return new Promise<ReturnType<typeof json>>((resolve, reject) => {
			let done = false, cancelTimer = () => {};
			const finish = (reason: string, results: Record<string, unknown>[] = [], receipts: Record<string, unknown>[] = [], changed?: unknown) => {
				if (done) return;
				done = true; cleanup();
				resolve(json({ reason, timed_out: reason === "timeout", results, receipts, ...(changed ? { changed } : {}), statuses: this.status(ids, undefined, checkpoints) }));
			};
			const watcher: Watch = { check: () => {
				if (done) return;
				const changed = ids.flatMap(id => {
					const run = selected.get(id), target = this.targets.get(id), change = this.changes.get(id);
					return run && (target?.run !== run || change !== initialChanges.get(id)) ? [{ id, run, change: change?.run === run ? change.change : "replaced" }] : [];
				});
				if (changed.length) { finish("target_changed", [], [], changed); return; }
				const available = ids.flatMap(id => { const r = this.results.get(id); return r && r.run === selected.get(id) ? [r] : []; });
				const pending = available.filter(r => r.state === "pending");
				const receipts = available.filter(r => r.state !== "pending").map(r => this.receipt(r));
				if (pending.length) {
					for (const r of pending) { r.state = "reserved"; r.claimed_by = owner; }
					this.reservations.set(owner, { owner, call, results: pending, signal });
					finish("result", pending.map(r => ({ id: r.id, run: r.run, delivery: r.delivery, text: r.text, outcome: r.outcome })), receipts);
					return;
				}
				if (receipts.length) { finish("receipt", [], receipts); return; }
				if (!ids.some(id => this.targets.get(id)?.active())) finish("idle");
			} };
			const abort = () => { if (!done) { done = true; cleanup(); reject(signal.reason ?? new Error("aborted")); } };
			const cleanup = () => { this.activeWaits--; this.watchers.delete(watcher); cancelTimer(); signal.removeEventListener("abort", abort); };
			this.watchers.add(watcher); signal.addEventListener("abort", abort, { once: true });
			cancelTimer = deadlineTimer(timeout, () => finish("timeout"));
			watcher.check();
		});
	}
	/** Non-consuming implicit fallback: normal message delivery still owns the result. */
	async observe(signal: AbortSignal, timeout = DEFAULT_WAIT_MS, pending?: () => boolean) {
		const active = this.ids().filter(id => this.targets.get(id)?.active());
		if ((!active.length && !pending?.()) || this.activeWaits) return;
		// An idle caller can still owe a turn to an already-pushed worker result. Wait for that wakeup,
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
				else this.pi.sendMessage(diagnostic, { triggerTurn: !this.callerAborted });
				finish();
			});
			if (signal.aborted) abort(); else watcher.check();
		});
	}
}

export const waitResult = json;
