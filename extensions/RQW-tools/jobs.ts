// A tool call still unsettled after the threshold returns as job#N and keeps running.
import { appendFileSync, createWriteStream, rmSync, writeFileSync, type WriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const BACKGROUND_AFTER_MS = 12_000;
const DEFAULT_LINES = 20;
const TAIL_CHARS = 64 * 1024;
const PENDING_BYTES = 1024 * 1024;
const MAX_TIMER_MS = 2_147_483_647;

export type JobState = "running" | "exited" | "failed" | "killed" | "timed_out";
export type JobsOptions = {
	backgroundAfterMs?: number;
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
	autoDelivery?: "delivered" | string;
	tail: string;
	bytes: number;
	latest: string;
	pending: (Buffer | string)[];
	pendingBytes: number;
	path?: string;
	stream?: WriteStream;
	spec: RunSpec;
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

export type Jobs = ReturnType<typeof createJobs>;

export function createJobTool(jobs: Jobs, description: string): any {
	const json = (details: Record<string, unknown>) => ({
		content: [{ type: "text" as const, text: JSON.stringify(details) }],
		details,
	});
	return {
		name: "job",
		label: "job",
		description,
		parameters: Type.Object({
			action: StringEnum(["status", "kill"]),
			ids: Type.Optional(Type.Array(Type.String(), { description: "job#N ids; status without them lists all your jobs" })),
			id: Type.Optional(Type.String({ description: "job#N; kill" })),
			lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: "Output lines shown per job; default 20" })),
		}),
		async execute(_toolCallId: string, raw: any) {
			const params = Object.fromEntries(Object.entries(raw ?? {}).filter(([, value]) => value !== null)) as any;
			const lines = lineCount(params.lines);
			const ids = (value: unknown, required: boolean): string[] | undefined => {
				if (value === undefined && !required) return undefined;
				if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== "string"))
					throw new Error("ids must be a nonempty array of job ids (job#N)");
				return [...new Set(value as string[])];
			};
			switch (params.action) {
				case "status": return json({ statuses: jobs.status(ids(params.ids, false), lines) });
				case "kill": {
					if (typeof params.id !== "string") throw new Error("id is required: job#N");
					return json(await jobs.kill(params.id));
				}
				default: throw new Error(`Unknown action: ${params.action}`);
			}
		},
		// A job keeps its owner awake only while it runs or its result has not been delivered.
		jobs: {
			abortAll: () => jobs.abortAll(), dispose: () => jobs.dispose(),
			hasJobs: () => jobs.backgroundCount() > 0 || jobs.undelivered() > 0,
			backgroundCount: () => jobs.backgroundCount(),
			subscribeActivity: (listener: () => void) => jobs.subscribeActivity(listener),
			autoSource: () => jobs.autoSource(),
		},
	};
}

export function createJobs(options: JobsOptions = {}) {
	const after = options.backgroundAfterMs ?? BACKGROUND_AFTER_MS;
	const jobs = new Map<number, Job>();
	let counter = 0;
	let disposed = false;
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
	const deliveryOf = (job: Job) => !job.autoDelivery ? "pending" : job.autoDelivery === "delivered" ? "delivered" : "claimed";
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
			// A finished job's result reaches its owner once; `pending` means it has not yet.
			...(job.ended !== undefined ? { result_delivery: deliveryOf(job) } : {}),
		};
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
			"Its final result arrives automatically in one message when it ends: end your turn to receive it. The job tool offers status and kill.",
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
		};
		let attached = true;
		const handle: JobHandle = {
			signal: controller.signal,
			onUpdate: (update) => {
				const text = textOf(update);
				if (text) job.latest = text;
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
			closeLog(job, false);
		});
		return { content: [{ type: "text", text: handoffText(job) }], details: { job: status(job) } };
	}

	async function killJob(id: string) {
		const job = find(id);
		if (job.ended === undefined && !job.killable) return { ...status(job), cannot_kill: "a running file tool call finishes on its own" };
		kill(job);
		await sleep(5000, job.done);
		return status(job);
	}

	return {
		backgroundCount,
		undelivered: () => [...jobs.values()].filter(job => job.ended !== undefined && !job.autoDelivery).length,
		autoSource() {
			let ended = false;
			const listeners = new Set<(value: true | null) => void>();
			const owned = new Map<string, Job[]>();
			const changed = () => { for (const listener of [...listeners]) { try { listener(true); } catch { /* isolated */ } } };
			activityListeners.add(changed);
			const release = (token: string) => {
				const selected = owned.get(token);
				if (!selected) return;
				owned.delete(token);
				for (const job of selected) if (job.autoDelivery === token) job.autoDelivery = undefined;
				activityChanged();
			};
			const source = {
				version: 1 as const,
				snapshot: () => ({ targets: ended ? [] : [...jobs.values()].filter(job => job.ended === undefined).map(idOf),
					ready: !ended && [...jobs.values()].some(job => job.ended !== undefined && !job.autoDelivery) }),
				subscribe: (listener: (value: true | null) => void) => {
					if (ended) { listener(null); return () => {}; }
					listeners.add(listener); return () => { listeners.delete(listener); };
				},
				claim: () => {
					if (ended) return undefined;
					const selected = [...jobs.values()].filter(job => job.ended !== undefined && !job.autoDelivery);
					if (!selected.length) return undefined;
					const token = randomUUID();
					for (const job of selected) job.autoDelivery = token;
					owned.set(token, selected);
					return { token, results: selected.map(job => ({ id: idOf(job), outcome: job.state,
						...(job.exitCode !== undefined ? { exit_code: job.exitCode } : {}),
						text: job.result ?? "", ...(job.path ? { output_path: job.path } : {}) })) };
				},
				commit: (token: string) => {
					const selected = owned.get(token);
					if (!selected) return;
					owned.delete(token);
					for (const job of selected) if (job.autoDelivery === token) job.autoDelivery = "delivered";
					activityChanged();
				},
				release,
			};
			return { source, close() {
				if (ended) return;
				ended = true; activityListeners.delete(changed);
				for (const token of [...owned.keys()]) release(token);
				for (const listener of listeners) { try { listener(null); } catch { /* isolated */ } }
				listeners.clear();
			} };
		},
		subscribeActivity(listener: () => void) {
			activityListeners.add(listener);
			return () => { activityListeners.delete(listener); };
		},
		run,
		kill: killJob,
		status: (ids: string[] | undefined, lines: number) => (ids ? ids.map(find) : [...jobs.values()]).map((job) => status(job, lines)),
		abortAll,
		stopBackground() {
			const active = [...jobs.values()].filter(job => job.ended === undefined);
			abortAll();
			return { backgroundProcesses: active.filter(job => job.killable).length, unstoppable: active.filter(job => !job.killable).length };
		},
		dispose() { disposed = true; activityChanged(); activityListeners.clear(); abortAll(); },
		seen(n: number) { if (Number.isSafeInteger(n) && n > counter) counter = n; },
		get size() { return jobs.size; },
		settled: (id: string) => find(id).done,
	};
}
