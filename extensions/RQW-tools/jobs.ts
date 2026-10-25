// Background jobs (DECISIONS.md, Tools: background jobs). A tool call still unsettled after the threshold returns at
// once as `job#N` and its work keeps running; the `job` tool waits for, checks or kills it. One registry per caller
// session: the main session's, or a fresh one for each subagent's set of tools.
import { appendFileSync, createWriteStream, rmSync, writeFileSync, type WriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { Detachable } from "./barrier.ts";
import type { Footprint } from "./footprint.ts";
import type { NestedDisplayRecord } from "./nested-display.ts";
import { resolvePath } from "./keys.ts";
import { changedAgainst, codemodeInUse, codemodeLimit, forgetOwner, gone, idOf as fileId, lastWrite, overwritten, ownWritesBetween, type RunningJob, same, servePorts, type Snapshot, snapshot, watchOwnWrites } from "./ledger.ts";

/** The owner's threshold: «после 12 секунд уходит в фон». Tests inject a smaller one. */
export const BACKGROUND_AFTER_MS = 12_000;
export const DEFAULT_WAIT_MS = 300_000;
const DEFAULT_LINES = 20;
const TAIL_CHARS = 64 * 1024;
/** Output kept in memory before a call goes to the background; more opens the log file early. */
const PENDING_BYTES = 1024 * 1024;
const MAX_TIMER_MS = 2_147_483_647;
/**
 * After the first selected job ends, wait collects the others that end right after it, such as a call queued behind
 * it (live probe: a wait on a build and the read queued behind it returned only the build, which cost a response).
 */
const SETTLE_MS = 250;

export type JobState = "queued" | "running" | "exited" | "failed" | "killed" | "timed_out";

/**
 * A finished notification wait, delivered once to the caller's `notify` callback: `id` is unique per notification,
 * `text` is the model-facing JSON a blocking wait would have returned, `details` the same result as an object.
 */
export type JobNotification = { id: string; text: string; details: Record<string, unknown> };

export type JobsOptions = {
	backgroundAfterMs?: number;
	/**
	 * Where a notification wait sends its result. Called at most once per wait, synchronously, never after `dispose`;
	 * it must not throw. Without it (or when `setNotify(undefined)`) `job wait` blocks as it always did.
	 */
	notify?: (notification: JobNotification) => void;
	/** Keep a child's logical assignment open until the notification is handed off or its subscription is cancelled. */
	retain?: () => () => void;
	/** Whether the caller can see the job tool now; without it calls run in the foreground as stock Pi runs them. */
	enabled?: () => boolean;
	/** The caller session in notes of other sessions: "main", "agent#2". */
	label?: string;
};

/** One tool call as `run` sees it. */
export type RunSpec = {
	tool: string;
	command: string;
	signal?: AbortSignal;
	onUpdate?: (u: any) => void;
	/** bash or codemode: a process with unknown effects; killable, detached at the handoff, scanned at its end. */
	process: boolean;
	timeoutSeconds?: unknown;
	cwd?: string;
	footprint?: Footprint;
};

/** What a call sees of its job while it runs. */
export type JobHandle = {
	/** Aborted by Esc (the caller's abort), `job kill`, the caller's shutdown. */
	signal: AbortSignal;
	/** The tool call's `onUpdate` until the handoff; nothing afterwards. */
	onUpdate: (update: any) => void;
	/** Raw output (bash tee). */
	data(chunk: Buffer | string): void;
	/**
	 * Await when the barrier (and any claim) lets the work start, right before it starts. A bash or codemode call first
	 * takes the snapshot of the working tree its effects report compares against (cost: `scanned`).
	 */
	begin(): Promise<void>;
	/** Pass to the barrier: a bash or codemode job detaches at the handoff, keeping only what it holds (D4, H1). */
	barrier: Detachable;
	/** What it waits for outside the barrier (process-wide resources, a codemode slot), while it waits. */
	waitingOn(blockers: () => string[]): void;
	/** "job#3 (holds package folder .)" or "a call of agent#2", for other calls' `waiting_for`. */
	describe(): string;
	/** Whether the call went to the background. */
	backgrounded(): boolean;
	/** A note line for the handoff text, when the call goes to the background before its result. */
	note(line: string): void;
	/**
	 * Call when the work ended, before the barrier releases the calls queued behind it: a background bash or codemode
	 * job takes its effects scan here, so a same-response follower's writes are not counted as the job's.
	 */
	settle(): Promise<void>;
};

type Job = {
	number: number;
	tool: string;
	command: string;
	state: JobState;
	started: number;
	/** Wall clock of the start, compared with file mtimes. */
	startedAt: number;
	ended?: number;
	/** Wall clock of the end. */
	endedAt?: number;
	exitCode?: number;
	killable: boolean;
	controller: AbortController;
	done: Promise<void>;
	finish: () => void;
	/** Final model-facing text of the call, once it ended. */
	result?: string;
	/** Display-only facts of the actual completed codemode result, not its earlier handoff. */
	nestedDisplay?: { version: 1; calls: NestedDisplayRecord[] };
	tail: string;
	bytes: number;
	latest: string;
	pending: (Buffer | string)[];
	pendingBytes: number;
	path?: string;
	stream?: WriteStream;
	spec: RunSpec;
	handle?: JobHandle;
	notes: string[];
	waitingOn?: () => string[];
	/** The working tree before the command started (O1 boundary state), or why it is missing. */
	startSnapshot?: Snapshot;
	startSnapshotError?: string;
	effects?: Effects;
	/** The model saw its end (wait, status, or the piggyback note N1). */
	endSeen?: boolean;
	/** The model got its full result (wait, status, kill, notification); the piggyback note alone does not count. */
	delivered?: boolean;
	/** A `job kill` is waiting for this job's end and will show it itself: no notification announces it meanwhile. */
	reporting?: boolean;
	listeners: Set<() => void>;
	releasePorts?: () => void;
	/** Stops keeping the owner's writes for this job's report (ledger history); idempotent. */
	unwatch?: () => void;
};

/** O1: what changed while a bash or codemode job ran. */
type Effects = {
	created: string[];
	changed: string[];
	yours: string[];
	overwritten: string[];
	deleted: string[];
	alongside: string[];
	scanned: string;
	/** Why the report is incomplete or missing (a failed or cancelled scan); never dropped silently. */
	errors?: string[];
};
// Every list is complete: Pi passes a custom tool's result text to the model whole, so nothing is cut here.
const effectsEmpty = (e?: Effects) => !e || !(e.created.length || e.changed.length || e.yours.length || e.overwritten.length || e.deleted.length || e.errors?.length);
const fileChanges = (e: Effects) => e.created.length + e.changed.length + e.yours.length + e.overwritten.length + e.deleted.length;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const textOf = (result: any): string =>
	(result?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");

function lastLines(text: string, lines: number): string {
	const all = text.replace(/\n$/, "").split("\n");
	return all.slice(-lines).join("\n");
}

/** Absolute paths of the files a read, edit or write call names. */
export function filePaths(params: any, cwd: string): string[] {
	const named = [params?.path, ...(Array.isArray(params?.edits) ? params.edits : []).map((e: any) => e?.path),
		...(Array.isArray(params?.files) ? params.files : []).map((f: any) => f?.path)];
	const paths = named.filter((p): p is string => typeof p === "string" && p.length > 0).map((p) => {
		try { return resolvePath(p, cwd); } catch { return resolve(cwd, p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p); }
	});
	return [...new Set(paths)];
}

/** Short one-line label of what a call does. */
export function commandOf(tool: string, params: any): string {
	let text: string;
	if (tool === "bash") text = String(params?.command ?? "");
	else if (tool === "codemode") text = String(params?.code ?? "").split("\n").find((l) => l.trim() && !l.startsWith("// @options")) ?? "";
	else {
		const paths = [params?.path, ...(params?.edits ?? []).map((e: any) => e?.path), ...(params?.files ?? []).map((f: any) => f?.path)]
			.filter((p) => typeof p === "string");
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

/** Sleep up to `ms` (any safe integer) or until `stop` resolves. */
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

/** One timer for any safe `ms` (setTimeout caps near 24.8 days); returns its cancel. */
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

/** A registered notification wait (see `watch`). */
type Waiter = { selected: Job[]; cancel(): void };

export type Jobs = ReturnType<typeof createJobs>;

/** The model-facing JSON of a wait result; compact display facts live only in the result details. */
function modelJson(details: Record<string, unknown>): string {
	const shown = Array.isArray(details.results) ? { ...details, results: details.results.map((r: any) => {
		const { details: _display, ...rest } = r;
		return rest;
	}) } : details;
	return JSON.stringify(shown);
}

/** The `job` tool of one registry. Outside the barrier and never a job itself. */
export function createJobTool(jobs: Jobs, description: string): any {
	// N1: a job that ended unseen with a non-empty effects report adds one line to the next result, this one included.
	// `terminate` ends the caller's native turn (a pending notification wait needs no model request).
	const json = (details: Record<string, unknown>, terminate = false) => {
		const note = jobs.piggyback();
		return { content: [{ type: "text" as const, text: modelJson(details) }, ...(note ? [{ type: "text" as const, text: note }] : [])], details, ...(terminate ? { terminate: true } : {}) };
	};
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
		// A blocking wait ends on abort; background jobs are independent of the caller's abort (they die on `kill`, shutdown).
		async execute(id: string, raw: any, signal: AbortSignal | undefined) {
			const params = Object.fromEntries(Object.entries(raw ?? {}).filter(([, v]) => v !== null)) as any;
			const lines = lineCount(params.lines);
			const ids = (value: unknown, required: boolean): string[] | undefined => {
				if (value === undefined && !required) return undefined;
				if (!Array.isArray(value) || !value.length || value.some((v) => typeof v !== "string"))
					throw new Error("ids must be a nonempty array of job ids (job#N)");
				return [...new Set(value as string[])];
			};
			switch (params.action) {
				case "wait": {
					let until: RegExp | undefined;
					if (typeof params.until === "string" && params.until) {
						// A leading `(?i)` (PCRE, Python) means case-insensitive; JavaScript has no inline flags (live probe).
						const insensitive = /^\(\?i\)/.test(params.until);
						try { until = new RegExp(insensitive ? params.until.slice(4) : params.until, insensitive ? "mi" : "m"); } catch (error) { throw new Error(`until is not a valid regular expression: ${(error as Error).message}`); }
					}
					const waitIds = ids(params.ids, true)!;
					const timeout = waitTimeout(params.timeout_ms);
					// A script's own call (id with "/") and a caller with no notify still hold the call.
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
		// RQW-agent closes a subagent's jobs with these (the loose rqw-tools:subagent-tools handshake).
		jobs: { abortAll: () => jobs.abortAll(), dispose: () => jobs.dispose() },
	};
}

export function createJobs(options: JobsOptions = {}) {
	const after = options.backgroundAfterMs ?? BACKGROUND_AFTER_MS;
	const session = options.label ?? "main";
	// The identity of this registry in the ledger: a restarted session with the same label is a different owner.
	const owner = `${session}~${randomUUID()}`;
	const jobs = new Map<number, Job>();
	let counter = 0;
	let disposed = false;
	// The session's lifetime: dispose cancels effects scans.
	const life = new AbortController();
	let notifyTo = options.notify;
	/** Pending notification waits; each cancels itself when it fires, and `dispose` cancels all. */
	const waiters = new Set<Waiter>();
	const activityListeners = new Set<() => void>();
	// Only handed-off, unfinished work counts. Wait registrations refer to these same jobs, not extra work.
	const backgroundCount = () => disposed ? 0 : [...jobs.values()].filter((job) => job.ended === undefined).length;
	function activityChanged() {
		for (const listener of [...activityListeners]) {
			try { listener(); } catch { /* A display consumer cannot break a job. */ }
		}
	}

	function openLog(job: Job) {
		if (job.stream) return;
		job.path = join(tmpdir(), `rqw-job-${randomUUID()}.log`);
		// The output so far is on disk when the call returns, so the agent can read the file at once.
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
	const holdsOf = (job: Job) => job.spec.footprint?.holds ?? [];

	function waitingFor(job: Job): string[] {
		if (job.state !== "queued" || job.ended !== undefined) return [];
		// A same-response wait names the call; a wait for a hold names what it holds.
		const inBarrier = (job.handle?.barrier.blockers?.() ?? []).map((b) => (b.held ? b.call.label?.() : b.call.label?.()?.split(" ")[0]) ?? "an earlier call");
		return [...new Set([...inBarrier, ...(job.waitingOn?.() ?? [])])];
	}

	function status(job: Job, lines = DEFAULT_LINES) {
		const now = job.ended ?? performance.now();
		const waiting = waitingFor(job);
		return {
			id: idOf(job),
			tool: job.tool,
			command: job.command,
			state: job.state,
			...(job.exitCode !== undefined ? { exit_code: job.exitCode } : {}),
			elapsed_seconds: Math.round((now - job.started) / 100) / 10,
			...(waiting.length ? { waiting_for: waiting } : {}),
			...(holdsOf(job).length && job.ended === undefined ? { holds: holdsOf(job) } : {}),
			tail: lastLines(job.tail || job.latest, lines),
			output_path: job.path,
			output_bytes: job.bytes,
			...(job.ended !== undefined && !effectsEmpty(job.effects) ? { effects: job.effects } : {}),
		};
	}

	/** Status of jobs the model is shown now: an ended one counts as seen (N1). */
	function shown(job: Job, lines?: number) {
		if (job.ended !== undefined) { job.endSeen = true; job.delivered = true; }
		return status(job, lines);
	}

	function kill(job: Job) {
		if (job.ended !== undefined) return;
		job.controller.abort();
		// A queued call never starts; it ends now instead of after the calls it waits for, and leaves the barrier at once
		// (its path no longer holds later calls of the same file).
		if (job.state === "queued") {
			job.handle?.barrier.withdraw?.();
			job.state = "killed";
			job.result = "Killed before it started.";
			job.stream?.write(job.result + "\n");
			job.releasePorts?.();
			job.finish();
			closeLog(job, false);
		}
	}

	function abortAll() {
		for (const job of jobs.values()) if (job.killable || job.state === "queued") kill(job);
	}

	function find(id: string): Job {
		const match = /^job#([1-9]\d*)$/.exec(id);
		const job = match ? jobs.get(Number(match[1])) : undefined;
		if (!job) {
			const known = [...jobs.keys()].map((n) => `job#${n}`).join(", ") || "none";
			throw new Error(`Unknown job id: ${id}. Known: ${known}`);
		}
		return job;
	}

	function handoffText(job: Job) {
		const s = status(job);
		const head = job.state === "queued"
			? `${idOf(job)} (${job.tool}) is still queued behind earlier calls after ${after / 1000} s; it runs when they end, in the background.`
			: `${idOf(job)} (${job.tool}) is still running after ${after / 1000} s and continues in the background.`;
		const lines = [head, `command: ${job.command}`, `elapsed: ${s.elapsed_seconds} s`];
		if (s.waiting_for) lines.push(`waiting for: ${s.waiting_for.join(", ")}`);
		if (job.spec.process) {
			const holds = holdsOf(job);
			lines.push(holds.length
				? `holds: ${holds.join(", ")} (later calls that change them wait for it); other effects unknown, listed in its result when it ends.`
				: "effects: unknown; the files it changes are listed in its result when it ends.");
			if (job.tool === "codemode" && job.state === "running") lines.push(`It holds one of the ${codemodeLimit()} codemode workers of this process (${codemodeInUse()} in use).`);
		}
		lines.push(`output so far (last ${DEFAULT_LINES} lines):`, s.tail || "(no output yet)", `full output: ${job.path}`,
			"Check it with the job tool: wait (returns when it ends), status, kill.", ...job.notes);
		return lines.join("\n");
	}

	const display = (job: Job, file: string) => {
		const r = relative(job.spec.cwd ?? process.cwd(), file);
		return r && !r.startsWith("..") ? r : file;
	};

	/**
	 * O1: the end snapshot against the start snapshot (taken before the command started), matched against the write
	 * ledger. No time cutoff decides what changed: a listed file changed when its mtime or size differs.
	 */
	async function effectsOf(job: Job, to: number): Promise<Effects | undefined> {
		const cwd = job.spec.cwd;
		if (!cwd) return undefined;
		const from = job.startedAt;
		const errors: string[] = [];
		// No deadline of its own; cancelled only when the caller's session ends (dispose). A killed job is still scanned:
		// what it changed before it died is part of its report.
		const signal = life.signal;
		const start = job.startSnapshot;
		if (!start) errors.push(`no snapshot before the start (${job.startSnapshotError ?? "not taken"}); changes are told by mtime against the start, and created and deleted files apart only by that`);
		let end: Snapshot;
		try {
			end = await snapshot(cwd, signal);
		} catch (error) {
			return { created: [], changed: [], yours: [], overwritten: [], deleted: [], alongside: [], scanned: "no scan",
				errors: [...errors, signal.aborted ? "effects scan cancelled: the session ended" : `effects scan failed: ${message(error)}`] };
		}
		if (start?.stopped) errors.push(`the snapshot before the start stopped at ${start.files.size} files`);
		if (start) for (const e of start.errors) errors.push(`before the start: ${e}`);
		const shown = (file: string) => {
			const r = relative(end.base, file);
			return r && !r.startsWith("..") ? r : display(job, file);
		};
		const mine = ownWritesBetween(owner, from, to);
		const mineIds = new Set(mine.map((m) => m.id));
		const changed: string[] = [];
		const created: string[] = [];
		for (const [file, now] of end.files) {
			const before = start?.files.get(file);
			const isNew = start ? !before : false;
			if (start ? !isNew && same(before, now) : now.mtimeMs < from) continue;
			const w = lastWrite(file);
			const byWrite = w && same(w, now) ? w : undefined;
			if (byWrite && byWrite.owner === owner && mineIds.has(fileId(file))) continue; // listed under `yours`
			const by = byWrite && byWrite.owner !== owner ? ` (by ${byWrite.label}, ${byWrite.tool})` : "";
			(isNew ? created : changed).push(shown(file) + by);
		}
		const deleted = start ? [...start.files.keys()].filter((f) => !end.files.has(f) && gone(f)).map(shown) : [];
		const alongside = [...jobs.values()].filter((o) => o !== job && o.spec.process && o.state !== "queued" && o.startedAt <= to && (o.ended === undefined || (o.endedAt ?? 0) >= from)).map(idOf);
		if (end.stopped) errors.push(`the scan stopped at ${end.files.size} files; files beyond them are not checked`);
		for (const e of end.errors) errors.push(`at the end: ${e}; its files are not checked`);
		return {
			created,
			changed,
			yours: mine.map((m) => `${shown(m.file)} (${m.write.tool})`),
			overwritten: mine.filter((m) => overwritten(m.write)).map((m) => shown(m.file)),
			deleted,
			alongside,
			scanned: `${end.files.size} files (${end.via}); snapshots took ${start ? `${start.ms} ms before the start and ` : ""}${end.ms} ms at the end`,
			...(errors.length ? { errors } : {}),
		};
	}

	/**
	 * Runs one tool call. `work` gets the job handle; it settles the call when it settles within the threshold,
	 * otherwise the call returns a background job result and `work` keeps running under the job's own signal.
	 */
	async function run<R>(spec: RunSpec, work: (handle: JobHandle) => Promise<R>): Promise<R | { content: { type: "text"; text: string }[]; details: any }> {
		const { tool, command, signal, onUpdate } = spec;
		const killable = spec.process;
		// A call whose own timeout ends it within a second after the threshold stays in the foreground: going to the
		// background just before the timeout fires reports a dying command as running (live probe: `timeout: 12`).
		const ownDeadline = typeof spec.timeoutSeconds === "number" && spec.timeoutSeconds > 0 ? spec.timeoutSeconds * 1000 : undefined;
		if ((options.enabled && !options.enabled()) || (ownDeadline !== undefined && ownDeadline <= after + 1000)) {
			const plain: Detachable = {};
			return work({ signal: signal ?? new AbortController().signal, onUpdate: (u) => onUpdate?.(u), data() {}, begin: async () => {}, barrier: plain,
				waitingOn() {}, describe: () => `a call of ${session}`, backgrounded: () => false, note() {}, settle: async () => {} });
		}
		const controller = new AbortController();
		const onAbort = () => controller.abort();
		if (signal?.aborted) controller.abort();
		else signal?.addEventListener("abort", onAbort, { once: true });
		if (disposed) controller.abort();
		let finish!: () => void;
		const done = new Promise<void>((resolve) => { finish = resolve; });
		const job: Job = {
			number: 0, tool, command, state: "queued", started: performance.now(), startedAt: Date.now(), killable, controller, done,
			finish: () => {
				if (job.ended === undefined) {
					job.ended = performance.now();
					job.endedAt = Date.now();
					if (job.number) activityChanged();
				}
				finish();
			},
			tail: "", bytes: 0, latest: "", pending: [], pendingBytes: 0, spec, listeners: new Set(), notes: [],
		};
		const notify = () => { for (const l of job.listeners) l(); };
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
			async begin() {
				job.waitingOn = undefined;
				// Own writes from here on are kept until this job's report is built (or the call ends in the foreground).
				if (killable && !job.unwatch) job.unwatch = watchOwnWrites(owner);
				if (killable && spec.cwd && !job.startSnapshot) {
					try { job.startSnapshot = await snapshot(spec.cwd, controller.signal); }
					catch (error) { job.startSnapshotError = controller.signal.aborted ? "cancelled" : message(error); }
					// An abort during the snapshot reaches the stock tool, which reports it in its own words.
				}
				if (job.state === "queued") { job.state = "running"; job.startedAt = Date.now(); }
			},
			barrier: {},
			waitingOn(blockers) { job.waitingOn = blockers; },
			backgrounded: () => job.number > 0,
			note(line) { job.notes.push(line); },
			settle: () => (job.number && killable ? scan() : Promise.resolve()),
			describe() {
				const who = job.number ? idOf(job) : "a call";
				const base = session === "main" ? who : `${who} of ${session}`;
				return holdsOf(job).length ? `${base} (holds ${holdsOf(job).join(", ")})` : base;
			},
		};
		let scanning: Promise<void> | undefined;
		// One effects scan per job.
		const scan = () => scanning ??= (async () => {
			const endedAt = Date.now();
			try {
				job.effects = await effectsOf(job, endedAt);
			} catch (error) {
				job.effects = { created: [], changed: [], yours: [], overwritten: [], deleted: [], alongside: [], scanned: "no scan", errors: [`effects scan failed: ${message(error)}`] };
			}
		})();
		job.handle = handle;
		handle.barrier.label = () => (job.number ? `${idOf(job)}${holdsOf(job).length ? ` (holds ${holdsOf(job).join(", ")})` : ""}` : undefined);
		handle.barrier.cancel = () => kill(job);
		const work$ = work(handle).then((value) => ({ value }), (error) => ({ error }));
		let timer: ReturnType<typeof setTimeout> | undefined;
		const threshold = new Promise<"handoff">((resolve) => { timer = setTimeout(() => resolve("handoff"), after); });
		const first = await Promise.race([work$, threshold]);
		clearTimeout(timer);
		if (first !== "handoff") {
			signal?.removeEventListener("abort", onAbort);
			job.unwatch?.();
			closeLog(job, true);
			if ("error" in first) throw first.error;
			return first.value;
		}
		// From the handoff the job belongs to the session, not to the call: Esc of this call or any later run no longer
		// kills it. `job kill`, `abortAll` and `dispose` do.
		attached = false;
		signal?.removeEventListener("abort", onAbort);
		handle.barrier.handedOffAt = performance.now();
		job.number = ++counter;
		jobs.set(job.number, job);
		activityChanged();
		// D4 + H1: a bash or codemode job has an unknown footprint and may never end; calls registered from now on (later
		// responses) wait for it only where they touch what it certainly holds. Calls of the same response registered
		// before keep waiting for its real end. A file tool job keeps its paths.
		if (killable) {
			handle.barrier.detach?.(spec.footprint?.held);
			if (spec.footprint?.ports.length) job.releasePorts = servePorts(spec.footprint.ports, handle.describe());
		}
		openLog(job);
		if (!job.bytes && job.latest) try { appendFileSync(job.path!, job.latest + "\n"); } catch {}
		void work$.then(async (outcome) => {
			signal?.removeEventListener("abort", onAbort);
			job.releasePorts?.();
			if (job.ended !== undefined) { job.unwatch?.(); return closeLog(job, false); }
			// The end becomes visible (state, result, effects) at once, after the effects scan.
			let state: JobState;
			let result: string;
			let exitCode: number | undefined;
			if ("error" in outcome) {
				const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
				result = message;
				state = controller.signal.aborted ? "killed" : /Command timed out after/.test(message) ? "timed_out" : "failed";
			} else {
				const value: any = outcome.value;
				result = textOf(value);
				if (value?.details?.rqwToolsNested?.version === 1) job.nestedDisplay = value.details.rqwToolsNested;
				const exit = value?.structuredContent?.exit_code;
				if (typeof exit === "number") exitCode = exit;
				state = value?.isError && typeof exit !== "number" ? "failed" : "exited";
			}
			const endedAt = Date.now();
			if (killable) await scan();
			job.unwatch?.();
			if (job.ended !== undefined) return closeLog(job, false);
			job.result = result;
			job.state = state;
			if (exitCode !== undefined) job.exitCode = exitCode;
			if (!job.bytes) job.stream?.write(result + "\n");
			job.finish();
			job.endedAt = endedAt;
			notify();
			closeLog(job, false);
		});
		return { content: [{ type: "text", text: handoffText(job) }], details: { job: status(job) } };
	}

	/** The result of a wait over `selected`: `finished` ended (shown now), a readiness match, or a timeout. */
	function report(selected: Job[], lines: number, until: RegExp | undefined, finished: Job[]) {
		const hits = until ? selected.filter((j) => j.ended === undefined && until.test(j.tail || j.latest)) : [];
		if (!finished.length && hits.length) {
			return {
				reason: "match",
				timed_out: false,
				matched: hits.map((j) => ({ id: idOf(j), line: (j.tail || j.latest).split("\n").reverse().find((l) => until!.test(l)) ?? "" })),
				statuses: selected.map((j) => shown(j, lines)),
			};
		}
		if (!finished.length) return { reason: "timeout", timed_out: true, statuses: selected.map((j) => shown(j, lines)) };
		return {
			reason: "exit",
			timed_out: false,
			results: finished.map((j) => ({ ...shown(j, lines), result: j.result ?? "",
				...(j.nestedDisplay ? { details: { rqwToolsNested: j.nestedDisplay } } : {}) })),
			statuses: selected.filter((j) => !finished.includes(j)).map((j) => shown(j, lines)),
		};
	}

	const endedOf = (selected: Job[]) => selected.filter((j) => j.ended !== undefined);
	const matchingOf = (selected: Job[], until?: RegExp) => until ? selected.filter((j) => j.ended === undefined && until.test(j.tail || j.latest)) : [];

	async function wait(ids: string[], timeoutMs: number, lines: number, signal?: AbortSignal, until?: RegExp) {
		const selected = ids.map(find);
		// This call returns the result itself; an older notification wait on the same jobs must not announce it again.
		for (const other of [...waiters]) if (other.selected.some((j) => selected.includes(j))) other.cancel();
		const ended = () => endedOf(selected);
		const matching = () => matchingOf(selected, until);
		if (!ended().length && !matching().length) {
			const aborted = new Promise<void>((resolve) => {
				if (signal?.aborted) resolve();
				signal?.addEventListener("abort", () => resolve(), { once: true });
			});
			const matched = Promise.withResolvers<void>();
			const check = () => { if (matching().length) matched.resolve(); };
			if (until) for (const j of selected) j.listeners.add(check);
			try {
				const any = Promise.race([...selected.map((j) => j.done), aborted, matched.promise]);
				await sleep(timeoutMs, any);
				signal?.throwIfAborted();
				if (ended().length && ended().length < selected.length)
					await sleep(SETTLE_MS, Promise.race([Promise.all(selected.map((j) => j.done)), aborted]));
				signal?.throwIfAborted();
			} finally {
				for (const j of selected) j.listeners.delete(check);
			}
		}
		return report(selected, lines, until, ended());
	}

	/**
	 * A notification wait. A result that is ready now (a selected job ended, `until` matched) comes back at once like a
	 * blocking wait's. Otherwise the wait is registered and returns `waiting`; the one notification is sent by events
	 * only: a job ending (the others ending within SETTLE_MS join it), readiness, or the deadline. No polling.
	 * Registration and snapshot happen in one synchronous section, so no end falls between them.
	 */
	function watch(ids: string[], timeoutMs: number, lines: number, until?: RegExp): { result: Record<string, unknown>; waiting: boolean } {
		const selected = ids.map(find);
		// One wait per job: a newer wait on the same job replaces the older one, so a result is never announced twice.
		// This holds for a wait that answers at once too: it hands the result over itself.
		for (const other of [...waiters]) if (other.selected.some((j) => selected.includes(j))) other.cancel();
		if (endedOf(selected).length || matchingOf(selected, until).length) return { result: report(selected, lines, until, endedOf(selected)), waiting: false };
		const release = options.retain?.() ?? (() => {});
		let done = false;
		let settle: ReturnType<typeof setTimeout> | undefined;
		const stopDeadline = runAfter(timeoutMs, () => fire(true));
		// An ended job the model has not been given yet; one it saw through status, wait or kill is not announced.
		const fresh = () => selected.filter((j) => j.ended !== undefined && !j.delivered && !j.reporting);
		const allEnded = () => selected.every((j) => j.ended !== undefined);
		const waiter: Waiter = { selected, cancel };
		function cancel(releaseHold = true) {
			if (done) return;
			done = true;
			stopDeadline();
			clearTimeout(settle);
			for (const j of selected) j.listeners.delete(check);
			waiters.delete(waiter);
			if (releaseHold) release();
		}
		function fire(deadline: boolean) {
			settle = undefined;
			if (done) return;
			const finished = fresh();
			if (!finished.length && !matchingOf(selected, until).length && !deadline) {
				// Everything that ended was already shown to the model: nothing to announce.
				if (allEnded()) cancel();
				return;
			}
			cancel(false);
			try {
				const details = report(selected, lines, until, finished);
				notifyTo?.({ id: randomUUID(), text: modelJson(details), details });
			} finally { release(); }
		}
		function check() {
			if (done) return;
			if (fresh().length) {
				if (allEnded()) { clearTimeout(settle); fire(false); }
				else settle ??= setTimeout(() => fire(false), SETTLE_MS);
			} else if (matchingOf(selected, until).length) fire(false);
		}
		for (const j of selected) { j.listeners.add(check); void j.done.then(check); }
		waiters.add(waiter);
		return { result: { reason: "waiting", timed_out: false, deadline_ms: timeoutMs, statuses: selected.map((j) => shown(j, lines)) }, waiting: true };
	}

	async function killJob(id: string) {
		const job = find(id);
		if (job.ended === undefined && !job.killable && job.state === "running")
			return { ...status(job), cannot_kill: "a running file tool call finishes on its own" };
		// K1: calls of the same response queued behind it may depend on it; they are cancelled before they run.
		const followers = job.ended === undefined ? (job.handle?.barrier.followers?.() ?? []) : [];
		const cancelled: string[] = [];
		for (const f of followers) {
			const label = f.label?.();
			if (!f.cancel || !label) continue;
			f.cancel();
			const other = [...jobs.values()].find((j) => j.handle?.barrier === f);
			cancelled.push(other ? `${label.split(" ")[0]} (${other.tool} ${other.command})` : label);
		}
		job.reporting = true;
		kill(job);
		// The process tree is killed on abort; give the shell a moment to report its end.
		try { await sleep(5000, job.done); } finally { job.reporting = false; }
		return { ...shown(job), ...(cancelled.length ? { cancelled_followers: cancelled } : {}) };
	}

	/** Running bash and codemode jobs, for the evidence notes of file tools. */
	const runningJobs = (): RunningJob[] => [...jobs.values()]
		.filter((j) => j.killable && j.state === "running" && j.ended === undefined)
		.map((j) => ({ id: idOf(j), command: j.command, startedAt: j.startedAt, changed: (file: string) => changedAgainst(j.startSnapshot, file, j.startedAt) }));

	/** N1: one line per job that ended with a non-empty effects report the model has not seen; marks them seen. */
	function piggyback(): string | undefined {
		const lines: string[] = [];
		for (const j of jobs.values()) {
			if (j.ended === undefined || j.endSeen || effectsEmpty(j.effects)) continue;
			j.endSeen = true;
			const e = j.effects!;
			const n = fileChanges(e);
			const how = j.exitCode !== undefined ? `exit ${j.exitCode}` : j.state;
			const what = e.errors?.length ? `its effects report is incomplete (${e.errors.join("; ")})${n ? ` and lists ${n} file change${n === 1 ? "" : "s"}` : ""}` : `its report lists ${n} file change${n === 1 ? "" : "s"}`;
			lines.push(`note: ${idOf(j)} (${j.command.length > 60 ? j.command.slice(0, 60) + "…" : j.command}) ended (${how}); ${what}: job status ${idOf(j)}.`);
		}
		return lines.length ? lines.join("\n") : undefined;
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
		/** Whether a wait can end in a notification (a `notify` callback is set). */
		canNotify: () => notifyTo !== undefined,
		/** The root session learns its mode at session start: print and json end with the run, so there waits block. */
		setNotify(notify: JobsOptions["notify"]) { notifyTo = notify; },
		runningJobs,
		piggyback,
		session,
		/** This registry's identity in the ledger (unique; `session` is only its label). */
		owner,
		kill: killJob,
		status: (ids: string[] | undefined, lines: number) => (ids ? ids.map(find) : [...jobs.values()]).map((j) => shown(j, lines)),
		/** Kills every running job and cancels queued ones (an interrupt of a subagent; never an owner's Esc). */
		abortAll,
		/** The caller session ends: no more notifications; kill everything; new calls start aborted. */
		dispose() { disposed = true; activityChanged(); activityListeners.clear(); for (const w of [...waiters]) w.cancel(); life.abort(); abortAll(); forgetOwner(owner); },
		/** Ids continue above the highest `job#N` an earlier instance of this session reported. */
		seen(n: number) { if (Number.isSafeInteger(n) && n > counter) counter = n; },
		get size() { return jobs.size; },
		/** Resolves when the job ended, without showing it to the model (tests). */
		settled: (id: string) => find(id).done,
	};
}
