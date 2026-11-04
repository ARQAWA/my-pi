// One direct caller's registry and result broker. No process-global child or delivery state.
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutoSource } from "./background.ts";
import type { RunningCounts } from "./counts.ts";
import { recordDelivery } from "./persistence.ts";
import { FOLLOW_UP } from "./prompt.ts";

/** Caller-owned children and results, including results not yet consumed by the caller model. */
export type RuntimeHandle = {
	pending(): boolean;
	/** The caller's automatic result source for its own children; undefined until it has started or restored one. */
	autoSource?(): AutoSource | undefined;
	/** The child finished, whether or not its result was delivered; false for a running, lost or unknown one. */
	finished?(id: string): boolean;
	/** Resolves when every active run has ended. Only tests call it; no product path waits. */
	wait(signal: AbortSignal): Promise<void>;
	ids(): string[];
	/** Compact read-only diagnostics; depth counts generations below these direct children. */
	status?(depth: number): Record<string, unknown>[];
	/** Materialize only the generations requested by an explicit exact-status query. */
	prepareStatus?(depth: number, signal: AbortSignal): Promise<void>;
	/** Native running children, including descendants. Pending results count zero. */
	runningCounts(): RunningCounts;
	busy?(): boolean;
	resume?(signal: AbortSignal, recoveredOnly?: boolean): Promise<number>;
	settle?(aborted: boolean): void;
	abortAll(): void;
	stopBackground?(): number;
	close(): void;
};

/**
 * The outcome of an explicit wait that ran inside a codemode script (`root` is the script's call). Only older sessions hold
 * these records; a restore still counts their results as delivered if the wait succeeded and the script's own result is saved.
 */
export type AcceptRecord = { version: 1; call: string; root: string; ok: boolean; results: { run: string; delivery: string }[] };

export type Target = { id: string; run: string; recovers?: string; active(): boolean; title?(): string | undefined; snapshot(messages?: number, depth?: number): Record<string, unknown> };
export type Result = { id: string; run: string; delivery: string; text?: string; outcome: string; title?: string;
	state: "pending" | "reserved" | "delivered"; claimed_by?: string };
type Watch = { check(): void };

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
/** Absolute monotonic deadlines, chunked below Node's timer overflow boundary. */
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
	private results = new Map<string, Result[]>();
	// Older runs can still have an unfinalized handoff when send starts the next run.
	private uncommitted = new Set<Result>();
	private watchers = new Set<Watch>();
	private autoReservations = new Map<string, Result[]>();
	private notices: { message: Parameters<ExtensionAPI["sendMessage"]>[0]; current(): boolean; delivered(): void; send: ExtensionAPI["sendMessage"] }[] = [];
	private settling = false;
	private autoWaiting = false;
	private deferredProgress = false;
	private callerAborted = false;
	private endSignal?: AbortSignal;
	private markAborted = () => { this.callerAborted = true; };
	queue: Promise<unknown> = Promise.resolve();
	private send: ExtensionAPI["sendMessage"];
	constructor(pi: ExtensionAPI, send: ExtensionAPI["sendMessage"] = (message, options) => pi.sendMessage(message, options)) {
		this.send = send;
		pi.on("turn_end", () => this.finalize());
		pi.on("agent_start", () => { this.callerAborted = false; this.notify(); });
		pi.on("turn_start", () => { this.settling = false; });
		pi.on("agent_end", (_event, ctx) => {
			this.settling = true;
			if (ctx.signal?.aborted) this.markAborted();
			this.finalize();
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
		pi.on("agent_settled", event => this.settleCore(event.aborted));
		pi.on("session_shutdown", () => {
			this.callerAborted = true;
			this.notices.length = 0;
			this.endSignal?.removeEventListener("abort", this.markAborted);
		});
	}
	/** The public core continuation bypasses AgentSession's final settlement event. */
	settleCore(aborted: boolean) {
		this.callerAborted = aborted;
		// Only the final flush may wake the caller.
		this.settling = true;
		this.finalize();
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
	private saveReceipt(ctx: ExtensionContext, run: string) {
		// Receipt failure may repeat delivery after wake, but must not block the handoff.
		try { recordDelivery(ctx.sessionManager, run); } catch { /* Best effort. */ }
	}
	private finalize() {
		this.notify();
		if (!this.settling) this.flushNotifications(!this.callerAborted);
	}
	stopBackground() { this.callerAborted = true; }
	add(target: Target) { this.targets.set(target.id, target); this.notify(); }
	change(id: string) {
		for (const result of this.uncommitted) if (result.id === id) {
			result.state = "delivered"; result.text = undefined; this.uncommitted.delete(result);
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
	/** The caller's automatic result consumer: claims pending results, commits them once they are saved. */
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
					this.saveReceipt(ctx, result.run); result.state = "delivered"; result.text = undefined; this.uncommitted.delete(result);
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
		return this.results.get(id)?.some(result => result.run === run && result.state === "delivered") ?? false;
	}
	undelivered(id: string): boolean {
		return [...this.uncommitted].some(result => result.id === id) || this.notices.some(notice => (notice.message.details as { id?: string } | undefined)?.id === id && notice.current());
	}
}

export const jsonResult = json;
