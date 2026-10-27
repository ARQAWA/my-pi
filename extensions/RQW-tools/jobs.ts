// A tool call still unsettled after the threshold returns as job#N and keeps running.
import { appendFileSync, createWriteStream, rmSync, writeFileSync, type WriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const BACKGROUND_AFTER_MS = 12_000;
export const DEFAULT_WAIT_MS = 300_000;
const DEFAULT_LINES = 20;
const TAIL_CHARS = 64 * 1024;
const PENDING_BYTES = 1024 * 1024;
const MAX_TIMER_MS = 2_147_483_647;
const SETTLE_MS = 250;

export type JobState = "running" | "exited" | "failed" | "killed" | "timed_out";
export type JobNotification = { id: string; text: string; details: Record<string, unknown> };
export type JobsOptions = {
	backgroundAfterMs?: number;
	notify?: (notification: JobNotification) => void;
	retain?: () => () => void;
	enabled?: () => boolean;
};
export type RunSpec = {
	tool: string;
	command: string;
	signal?: AbortSignal;
	onUpdate?: (update: any) => void;
	process: boolean;
	timeoutSeconds?: unknown;
};
export type JobHandle = {
	signal: AbortSignal;
	onUpdate: (update: any) => void;
	data(chunk: Buffer | string): void;
};

type Job = {
	number: number;
	tool: string;
	command: string;
	state: JobState;
	started: number;
	ended?: number;
	exitCode?: number;
	killable: boolean;
	controller: AbortController;
	done: Promise<void>;
	finish: () => void;
	result?: string;
	tail: string;
	bytes: number;
	latest: string;
	pending: (Buffer | string)[];
	pendingBytes: number;
	path?: string;
	stream?: WriteStream;
	spec: RunSpec;
	endSeen?: boolean;
	delivered?: boolean;
	reporting?: boolean;
	listeners: Set<() => void>;
};

const textOf = (result: any): string =>
	(result?.content ?? []).filter((block: any) => block?.type === "text").map((block: any) => block.text).join("\n");

function lastLines(text: string, lines: number): string {
	return text.replace(/\n$/, "").split("\n").slice(-lines).join("\n");
}

export function commandOf(tool: string, params: any): string {
	let text: string;
	if (tool === "bash") text = String(params?.command ?? "");
	else if (tool === "codemode") text = String(params?.code ?? "").split("\n").find((line) => line.trim() && !line.startsWith("// @options")) ?? "";
	else {
		const paths = [params?.path, ...(params?.edits ?? []).map((edit: any) => edit?.path), ...(params?.files ?? []).map((file: any) => file?.path)]
			.filter((path) => typeof path === "string");
		text = [...new Set(paths)].join(", ") || (params?.pattern ? String(params.pattern) : "");
	}
	text = text.trim();
	return text.length > 200 ? text.slice(0, 200) + "…" : text;
}

export function lineCount(value?: number | null): number {
	if (value == null) return DEFAULT_LINES;
	if (!Number.isInteger(value) || value < 1 || value > 200) throw new Error("lines must be an integer from 1 to 200");
	return value;
}

export function waitTimeout(value?: number | null): number {
	if (value == null) return DEFAULT_WAIT_MS;
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error("timeout_ms must be a positive finite safe integer");
	return value;
}

function sleep(ms: number, stop: Promise<unknown>): Promise<void> {
	const deadline = performance.now() + ms;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	void stop.then(() => { stopped = true; if (timer) clearTimeout(timer); });
	return new Promise<void>((resolve) => {
		const step = () => {
			const left = deadline - performance.now();
			if (stopped || left <= 0) return resolve();
			timer = setTimeout(step, Math.min(left, MAX_TIMER_MS));
		};
		step();
		void stop.then(() => resolve());
	});
}

function runAfter(ms: number, run: () => void): () => void {
	const deadline = performance.now() + ms;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const step = () => {
		const left = deadline - performance.now();
		if (left <= 0) return run();
		timer = setTimeout(step, Math.min(left, MAX_TIMER_MS));
	};
	step();
	return () => clearTimeout(timer);
}

type Waiter = { selected: Job[]; cancel(): void };
export type Jobs = ReturnType<typeof createJobs>;

export function createJobTool(jobs: Jobs, description: string): any {
	const json = (details: Record<string, unknown>, terminate = false) => ({
		content: [{ type: "text" as const, text: JSON.stringify(details) }],
		details,
		...(terminate ? { terminate: true } : {}),
	});
	return {
		name: "job",
		label: "job",
		description,
		parameters: Type.Object({
			action: StringEnum(["wait", "status", "kill"]),
			ids: Type.Optional(Type.Array(Type.String(), { description: "job#N ids; wait needs them, status without them lists all your jobs" })),
			id: Type.Optional(Type.String({ description: "job#N; kill" })),
			timeout_ms: Type.Optional(Type.Integer({ minimum: 1, description: "Chosen wait duration, slightly longer than the estimated remaining work; default 300000 only when omitted" })),
			lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: "Output lines shown per job; default 20" })),
			until: Type.Optional(Type.String({ description: "wait: also return when a job's output matches this JavaScript regular expression (readiness); a leading (?i) ignores case" })),
		}),
		async execute(id: string, raw: any, signal: AbortSignal | undefined) {
			const params = Object.fromEntries(Object.entries(raw ?? {}).filter(([, value]) => value !== null)) as any;
			const lines = lineCount(params.lines);
			const ids = (value: unknown, required: boolean): string[] | undefined => {
				if (value === undefined && !required) return undefined;
				if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== "string"))
					throw new Error("ids must be a nonempty array of job ids (job#N)");
				return [...new Set(value as string[])];
			};
			switch (params.action) {
				case "wait": {
					let until: RegExp | undefined;
					if (typeof params.until === "string" && params.until) {
						const insensitive = /^\(\?i\)/.test(params.until);
						try { until = new RegExp(insensitive ? params.until.slice(4) : params.until, insensitive ? "mi" : "m"); }
						catch (error) { throw new Error(`until is not a valid regular expression: ${(error as Error).message}`); }
					}
					const waitIds = ids(params.ids, true)!;
					const timeout = waitTimeout(params.timeout_ms);
					if (id.includes("/") || !jobs.canNotify()) return json(await jobs.wait(waitIds, timeout, lines, signal, until));
					const watched = jobs.watch(waitIds, timeout, lines, until);
					return json(watched.result, watched.waiting);
				}
				case "status": return json({ statuses: jobs.status(ids(params.ids, false), lines) });
				case "kill": {
					if (typeof params.id !== "string") throw new Error("id is required: job#N");
					return json(await jobs.kill(params.id));
				}
				default: throw new Error(`Unknown action: ${params.action}`);
			}
		},
		jobs: { abortAll: () => jobs.abortAll(), dispose: () => jobs.dispose() },
	};
}

export function createJobs(options: JobsOptions = {}) {
	const after = options.backgroundAfterMs ?? BACKGROUND_AFTER_MS;
	const jobs = new Map<number, Job>();
	let counter = 0;
	let disposed = false;
	let notifyTo = options.notify;
	const waiters = new Set<Waiter>();
	const activityListeners = new Set<() => void>();
	const backgroundCount = () => disposed ? 0 : [...jobs.values()].filter((job) => job.ended === undefined).length;
	function activityChanged() {
		for (const listener of [...activityListeners]) {
			try { listener(); } catch { /* A display consumer cannot break a job. */ }
		}
	}

	function openLog(job: Job) {
		if (job.stream) return;
		job.path = join(tmpdir(), `rqw-job-${randomUUID()}.log`);
		try {
			writeFileSync(job.path, "");
			for (const chunk of job.pending) appendFileSync(job.path, chunk);
		} catch {}
		job.stream = createWriteStream(job.path, { flags: "a" });
		job.stream.on("error", () => {});
		job.pending = [];
		job.pendingBytes = 0;
	}

	function closeLog(job: Job, remove: boolean) {
		const { stream, path } = job;
		job.stream = undefined;
		if (!stream) return;
		stream.end(() => {
			if (remove && path) try { rmSync(path, { force: true }); } catch {}
		});
	}

	const idOf = (job: Job) => `job#${job.number}`;
	function status(job: Job, lines = DEFAULT_LINES) {
		const now = job.ended ?? performance.now();
		return {
			id: idOf(job),
			tool: job.tool,
			command: job.command,
			state: job.state,
			...(job.exitCode !== undefined ? { exit_code: job.exitCode } : {}),
			elapsed_seconds: Math.round((now - job.started) / 100) / 10,
			tail: lastLines(job.tail || job.latest, lines),
			output_path: job.path,
			output_bytes: job.bytes,
		};
	}
	function shown(job: Job, lines?: number) {
		if (job.ended !== undefined) { job.endSeen = true; job.delivered = true; }
		return status(job, lines);
	}
	function kill(job: Job) {
		if (job.ended === undefined) job.controller.abort();
	}
	function abortAll() {
		for (const job of jobs.values()) if (job.killable) kill(job);
	}
	function find(id: string): Job {
		const match = /^job#([1-9]\d*)$/.exec(id);
		const job = match ? jobs.get(Number(match[1])) : undefined;
		if (!job) {
			const known = [...jobs.keys()].map((number) => `job#${number}`).join(", ") || "none";
			throw new Error(`Unknown job id: ${id}. Known: ${known}`);
		}
		return job;
	}
	function handoffText(job: Job) {
		const current = status(job);
		return [
			`${idOf(job)} (${job.tool}) is still running after ${after / 1000} s and continues in the background.`,
			`command: ${job.command}`,
			`elapsed: ${current.elapsed_seconds} s`,
			`output so far (last ${DEFAULT_LINES} lines):`,
			current.tail || "(no output yet)",
			`full output: ${job.path}`,
			"Check it with the job tool: wait (returns when it ends), status, kill.",
		].join("\n");
	}

	async function run<R>(spec: RunSpec, work: (handle: JobHandle) => Promise<R>): Promise<R | { content: { type: "text"; text: string }[]; details: any }> {
		const { tool, command, signal, onUpdate } = spec;
		const ownDeadline = typeof spec.timeoutSeconds === "number" && spec.timeoutSeconds > 0 ? spec.timeoutSeconds * 1000 : undefined;
		if ((options.enabled && !options.enabled()) || (ownDeadline !== undefined && ownDeadline <= after + 1000)) {
			return work({ signal: signal ?? new AbortController().signal, onUpdate: (update) => onUpdate?.(update), data() {} });
		}
		const controller = new AbortController();
		const onAbort = () => controller.abort();
		if (signal?.aborted) controller.abort();
		else signal?.addEventListener("abort", onAbort, { once: true });
		if (disposed) controller.abort();
		let finish!: () => void;
		const done = new Promise<void>((resolve) => { finish = resolve; });
		const job: Job = {
			number: 0,
			tool,
			command,
			state: "running",
			started: performance.now(),
			killable: spec.process,
			controller,
			done,
			finish: () => {
				if (job.ended === undefined) {
					job.ended = performance.now();
					if (job.number) activityChanged();
				}
				finish();
			},
			tail: "",
			bytes: 0,
			latest: "",
			pending: [],
			pendingBytes: 0,
			spec,
			listeners: new Set(),
		};
		const notify = () => { for (const listener of job.listeners) listener(); };
		let attached = true;
		const handle: JobHandle = {
			signal: controller.signal,
			onUpdate: (update) => {
				const text = textOf(update);
				if (text) { job.latest = text; notify(); }
				if (attached) onUpdate?.(update);
			},
			data(chunk) {
				const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
				job.bytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
				job.tail = (job.tail + text).slice(-TAIL_CHARS);
				if (job.stream) job.stream.write(chunk);
				else {
					job.pending.push(chunk);
					job.pendingBytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
					if (job.pendingBytes > PENDING_BYTES) openLog(job);
				}
				notify();
			},
		};
		const work$ = work(handle).then((value) => ({ value }), (error) => ({ error }));
		let timer: ReturnType<typeof setTimeout> | undefined;
		const threshold = new Promise<"handoff">((resolve) => { timer = setTimeout(() => resolve("handoff"), after); });
		const first = await Promise.race([work$, threshold]);
		clearTimeout(timer);
		if (first !== "handoff") {
			signal?.removeEventListener("abort", onAbort);
			closeLog(job, true);
			if ("error" in first) throw first.error;
			return first.value;
		}

		attached = false;
		signal?.removeEventListener("abort", onAbort);
		job.number = ++counter;
		jobs.set(job.number, job);
		activityChanged();
		openLog(job);
		if (!job.bytes && job.latest) try { appendFileSync(job.path!, job.latest + "\n"); } catch {}
		void work$.then((outcome) => {
			signal?.removeEventListener("abort", onAbort);
			if (job.ended !== undefined) return closeLog(job, false);
			let state: JobState;
			let result: string;
			let exitCode: number | undefined;
			if ("error" in outcome) {
				const text = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
				result = text;
				state = controller.signal.aborted ? "killed" : /Command timed out after/.test(text) ? "timed_out" : "failed";
			} else {
				const value: any = outcome.value;
				result = textOf(value);
				const exit = value?.structuredContent?.exit_code;
				if (typeof exit === "number") exitCode = exit;
				state = value?.isError && typeof exit !== "number" ? "failed" : "exited";
			}
			job.result = result;
			job.state = state;
			if (exitCode !== undefined) job.exitCode = exitCode;
			if (!job.bytes) job.stream?.write(result + "\n");
			job.finish();
			notify();
			closeLog(job, false);
		});
		return { content: [{ type: "text", text: handoffText(job) }], details: { job: status(job) } };
	}

	function report(selected: Job[], lines: number, until: RegExp | undefined, finished: Job[]) {
		const hits = until ? selected.filter((job) => job.ended === undefined && until.test(job.tail || job.latest)) : [];
		if (!finished.length && hits.length) return {
			reason: "match",
			timed_out: false,
			matched: hits.map((job) => ({ id: idOf(job), line: (job.tail || job.latest).split("\n").reverse().find((line) => until!.test(line)) ?? "" })),
			statuses: selected.map((job) => shown(job, lines)),
		};
		if (!finished.length) return { reason: "timeout", timed_out: true, statuses: selected.map((job) => shown(job, lines)) };
		return {
			reason: "exit",
			timed_out: false,
			results: finished.map((job) => ({ ...shown(job, lines), result: job.result ?? "" })),
			statuses: selected.filter((job) => !finished.includes(job)).map((job) => shown(job, lines)),
		};
	}
	const endedOf = (selected: Job[]) => selected.filter((job) => job.ended !== undefined);
	const matchingOf = (selected: Job[], until?: RegExp) => until ? selected.filter((job) => job.ended === undefined && until.test(job.tail || job.latest)) : [];

	async function wait(ids: string[], timeoutMs: number, lines: number, signal?: AbortSignal, until?: RegExp) {
		const selected = ids.map(find);
		for (const other of [...waiters]) if (other.selected.some((job) => selected.includes(job))) other.cancel();
		const ended = () => endedOf(selected);
		const matching = () => matchingOf(selected, until);
		if (!ended().length && !matching().length) {
			const aborted = new Promise<void>((resolve) => {
				if (signal?.aborted) resolve();
				signal?.addEventListener("abort", () => resolve(), { once: true });
			});
			const matched = Promise.withResolvers<void>();
			const check = () => { if (matching().length) matched.resolve(); };
			if (until) for (const job of selected) job.listeners.add(check);
			try {
				const any = Promise.race([...selected.map((job) => job.done), aborted, matched.promise]);
				await sleep(timeoutMs, any);
				signal?.throwIfAborted();
				if (ended().length && ended().length < selected.length)
					await sleep(SETTLE_MS, Promise.race([Promise.all(selected.map((job) => job.done)), aborted]));
				signal?.throwIfAborted();
			} finally {
				for (const job of selected) job.listeners.delete(check);
			}
		}
		return report(selected, lines, until, ended());
	}

	function watch(ids: string[], timeoutMs: number, lines: number, until?: RegExp): { result: Record<string, unknown>; waiting: boolean } {
		const selected = ids.map(find);
		for (const other of [...waiters]) if (other.selected.some((job) => selected.includes(job))) other.cancel();
		if (endedOf(selected).length || matchingOf(selected, until).length) return { result: report(selected, lines, until, endedOf(selected)), waiting: false };
		const release = options.retain?.() ?? (() => {});
		let done = false;
		let settle: ReturnType<typeof setTimeout> | undefined;
		const stopDeadline = runAfter(timeoutMs, () => fire(true));
		const fresh = () => selected.filter((job) => job.ended !== undefined && !job.delivered && !job.reporting);
		const allEnded = () => selected.every((job) => job.ended !== undefined);
		const waiter: Waiter = { selected, cancel };
		function cancel(releaseHold = true) {
			if (done) return;
			done = true;
			stopDeadline();
			clearTimeout(settle);
			for (const job of selected) job.listeners.delete(check);
			waiters.delete(waiter);
			if (releaseHold) release();
		}
		function fire(deadline: boolean) {
			settle = undefined;
			if (done) return;
			const finished = fresh();
			if (!finished.length && !matchingOf(selected, until).length && !deadline) {
				if (allEnded()) cancel();
				return;
			}
			cancel(false);
			try { notifyTo?.({ id: randomUUID(), text: JSON.stringify(report(selected, lines, until, finished)), details: report(selected, lines, until, finished) }); }
			finally { release(); }
		}
		function check() {
			if (done) return;
			if (fresh().length) {
				if (allEnded()) { clearTimeout(settle); fire(false); }
				else settle ??= setTimeout(() => fire(false), SETTLE_MS);
			} else if (matchingOf(selected, until).length) fire(false);
		}
		for (const job of selected) { job.listeners.add(check); void job.done.then(check); }
		waiters.add(waiter);
		return { result: { reason: "waiting", timed_out: false, deadline_ms: timeoutMs, statuses: selected.map((job) => shown(job, lines)) }, waiting: true };
	}

	async function killJob(id: string) {
		const job = find(id);
		if (job.ended === undefined && !job.killable) return { ...status(job), cannot_kill: "a running file tool call finishes on its own" };
		job.reporting = true;
		kill(job);
		try { await sleep(5000, job.done); } finally { job.reporting = false; }
		return shown(job);
	}

	return {
		backgroundCount,
		subscribeActivity(listener: () => void) {
			activityListeners.add(listener);
			return () => { activityListeners.delete(listener); };
		},
		run,
		wait,
		watch,
		canNotify: () => notifyTo !== undefined,
		setNotify(notify: JobsOptions["notify"]) { notifyTo = notify; },
		kill: killJob,
		status: (ids: string[] | undefined, lines: number) => (ids ? ids.map(find) : [...jobs.values()]).map((job) => shown(job, lines)),
		abortAll,
		dispose() { disposed = true; activityChanged(); activityListeners.clear(); for (const waiter of [...waiters]) waiter.cancel(); abortAll(); },
		seen(n: number) { if (Number.isSafeInteger(n) && n > counter) counter = n; },
		get size() { return jobs.size; },
		settled: (id: string) => find(id).done,
	};
}
