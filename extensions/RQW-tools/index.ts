import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	SettingsManager,
	createBashToolDefinition,
	createLocalBashOperations,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { groupCodemode, takeOverBuiltinCodemode } from "./codemode.ts";
import { createEditSchema, executeEdit, prepareEditArguments } from "./edit.ts";
import { classifyBash, type Footprint } from "./footprint.ts";
import { createCountsProducer } from "./counts.ts";
import { commandOf, createJobs, createJobTool, filePaths, type JobHandle, type JobNotification, type Jobs, type JobsOptions } from "./jobs.ts";
import { changeNote, claim, recordSeen, recordUncertain, recordWrite, servedBy, stat, withFileLock, writeConflict } from "./ledger.ts";
import { readSpellings, scopeOf } from "./keys.ts";
import { createNestedBarrier } from "./nested.ts";
import { editRenderers, writeRenderers } from "./render.ts";
import { installSelectionIntent, noToolSelection } from "./selection.ts";
import { createReadSchema, createUnchangedReads } from "./unchanged.ts";
import { createWriteSchema, executeWrite, prepareWriteArguments } from "./write.ts";

const NO_LIMIT = 100000;

/** The top-level call a read runs in: what the unchanged-read note needs to find the model's copy of the content. */
type ReadCall = { id: string; ctx: any; job: JobHandle };

/** Adds note lines to a tool result as one more text block; undefined entries are skipped. */
function appendNotes(result: any, notes: (string | undefined)[]): any {
	const lines = notes.filter((n): n is string => !!n);
	if (!lines.length || !result || typeof result !== "object" || !Array.isArray(result.content)) return result;
	return { ...result, content: [...result.content, { type: "text", text: lines.join("\n") }] };
}

function description(name: string): string {
	return readFileSync(new URL(`./descriptions/${name}.md`, import.meta.url), "utf-8").trimEnd();
}

/** Copy of a stock object schema with one property description replaced. */
function withDescription(schema: any, property: string, text: string): any {
	return {
		...schema,
		properties: { ...schema.properties, [property]: { ...schema.properties[property], description: text } },
	};
}

/** Remove null sentinels before Pi can coerce them into search options; required arguments stay untouched. */
function prepareSearchArguments(stock: any, input: unknown): unknown {
	let args = input;
	if (input && typeof input === "object" && !Array.isArray(input)) {
		const required: string[] = stock.parameters.required ?? [];
		args = Object.fromEntries(Object.entries(input).filter(([key, value]) =>
			required.includes(key) || (value != null && value !== "null"),
		));
	}
	return stock.prepareArguments ? stock.prepareArguments(args) : args;
}

/** The settings a getter returns, or undefined when there are none or the read fails (stock defaults then). */
function safely(settings: () => any): any {
	try {
		return settings();
	} catch {
		return undefined;
	}
}

/**
 * Channel on `pi.events` where RQW-agent, when it is loaded, asks for these tools for each subagent session. The
 * request is `{ offer(factory) }`; the answer is `createTools` itself. Nothing in RQW-tools depends on RQW-agent.
 */
const SUBAGENT_TOOLS = "rqw-tools:subagent-tools";

/** Tools whose calls go to the background after 12 s; `job` is on whenever one of them is. */
const BACKGROUNDABLE = ["bash", "codemode", "read", "edit", "write", "grep", "find"];

/** Startup projection channel of RQW-prompt (same literal; no import across folders). See RQW-prompt `STARTUP_PROJECTION`. */
const STARTUP_PROJECTION = "rqw-prompt:startup-projection";

/**
 * The two tool sections of a prompt's options, from the selected and hidden tools of those options. Pure: it writes only
 * `options.sections` and is the one rule for the normal turn (before_agent_start) and the startup projection.
 */
function applyToolSections(options: any): void {
	const visible = (name: string) => options.selectedTools.includes(name) && !options.hiddenTools.includes(name);
	if (["grep", "find", "read"].every(visible)) {
		options.sections.search_method = "- Search with the grep and find tools and read files with read, following the method in the grep description.";
	}
	if (visible("bash")) {
		options.sections.rqw_tools_execution = "- A shell command waits for the calls before it and holds the calls after it; one still running after 12 seconds continues in the background as a job, which holds the later calls of the same response and, from later responses, only calls that change what it names as held: a package folder it installs, the git index, files it writes.";
	}
}

/** Startup projection handler: the same sections on the caller's clone; an invalid or failed request is reported, never guessed. */
function projectToolSections(request: unknown): void {
	if (!request || typeof request !== "object") return;
	const req = request as { options?: unknown; error?: string };
	if (req.error !== undefined) return;
	try {
		const options = req.options;
		if (!options || typeof options !== "object") throw new TypeError("startup projection needs normalized options");
		applyToolSections(options);
	} catch (error) {
		req.error = `rqw-tools startup projection failed: ${error instanceof Error ? error.message : String(error)}`;
	}
}

export type { JobNotification } from "./jobs.ts";

/** Customtype of the message that carries a finished notification wait into the main chat. */
const JOB_MESSAGE = "job";

export default function (pi: ExtensionAPI) {
	installRqwTools(pi);
}

/** The extension; `backgroundAfterMs` is for tests (the product's threshold is 12 s). */
export function installRqwTools(pi: ExtensionAPI, options: { backgroundAfterMs?: number } = {}) {
	const selectionShutdown = installSelectionIntent();
	// One barrier per extension instance; every execute registers its scope synchronously before any await. The tool
	// calls of a `codemode` script use the barrier of that script, found by the tool call id (nested.ts); the
	// `codemode` call itself is one call with scope "all" in the outer one.
	const nested = createNestedBarrier();
	// One job registry for the main session: its bash, codemode and file tool calls, and its `job` tool.
	const jobs = createJobs({ enabled: () => pi.getActiveTools().includes("job"), backgroundAfterMs: options.backgroundAfterMs });
	for (const tool of createTools(process.cwd(), () => pi.getSettings(), nested, { jobs })) pi.registerTool(tool);
	const counts = createCountsProducer(jobs, pi.events);
	pi.on("session_start", () => counts.start());
	pi.on("session_shutdown", () => counts.stop());
	// A background job belongs to the session, not to a run: Esc and new owner messages leave it alone. It dies on
	// `job kill` and with the session. Foreground calls still abort with their run (jobs.ts `run`).
	pi.on("session_shutdown", () => {
		jobs.dispose();
		selectionShutdown();
	});
	installNotifications(pi, jobs);

	// Custom sections survive customPrompt; tool promptGuidelines do not. Each turn starts from Pi's base
	// options, so disabling this extension removes the sections on the next turn, including after reload.
	pi.on("before_agent_start", (event) => applyToolSections(event.systemPromptOptions));

	// The same sections for the startup projection of RQW-codex (idle and startup prewarm), so the cold request carries
	// what the first normal turn carries. Subscribed like RQW-prompt: on load and session_start, dropped on shutdown.
	let unsubscribeProjection: (() => void) | undefined;
	const subscribeProjection = () => { unsubscribeProjection ??= pi.events.on(STARTUP_PROJECTION, projectToolSections); };
	subscribeProjection();
	pi.on("session_start", subscribeProjection);
	pi.on("session_shutdown", () => { unsubscribeProjection?.(); unsubscribeProjection = undefined; });

	// Pi calls the handler synchronously inside `emit`, and drops it when this instance goes stale (reload, dispose).
	// The offer is `createTools` itself: a subagent calls it and gets six fresh tools with a barrier of their own, plus
	// its own Pi `codemode` definition (`options.codemode`) as a call of that barrier and a job of its registry.
	pi.events.on(SUBAGENT_TOOLS, (request) => (request as { offer?: (factory: typeof createTools) => void })?.offer?.(createTools));

	// grep and find are on only when the user made no tool selection (see `noToolSelection`). Any selection leaves
	// the active set exactly as stock Pi built it. On `reload` Pi keeps the tools the user switched off during the
	// session, so the handler leaves the active set alone then.
	// Pi's built-in `codemode`, when it is loaded, is replaced by the same definition as a call of the barrier. That
	// runs for every reason, `reload` included: a reload builds a fresh registry with the built-in again.
	pi.on("session_start", (event, ctx) => {
		if (event.reason !== "reload") {
			const active = pi.getActiveTools();
			const missing = noToolSelection(pi, ctx.sessionManager) ? ["grep", "find"].filter((name) => !active.includes(name)) : [];
			// The job tool comes with any tool that can go to the background, whatever the selection.
			if (!active.includes("job") && [...active, ...missing].some((name) => BACKGROUNDABLE.includes(name))) missing.push("job");
			if (missing.length > 0) pi.setActiveTools([...active, ...missing]);
		}
		// Ids continue above the highest job#N this session already reported (reload, resume).
		for (const entry of ((ctx.sessionManager as any)?.getEntries?.() ?? []) as any[]) {
			if (entry?.type !== "message" || entry.message?.role !== "toolResult") continue;
			for (const block of entry.message.content ?? []) {
				if (block?.type !== "text") continue;
				for (const match of String(block.text).matchAll(/\bjob#(\d+)/g)) jobs.seen(Number(match[1]));
			}
		}
		takeOverBuiltinCodemode(pi, nested, jobs);
	});
}

/**
 * Delivers finished notification waits into the main chat. Idle: a custom message that starts a turn. Busy: held here,
 * outside Pi's steering queue (Esc and send-now clear that into the editor), and added at the settlement boundary,
 * which continues the run; after an aborted run it is only appended. Print and json end with the run, so there waits block.
 */
function installNotifications(pi: ExtensionAPI, jobs: Jobs) {
	let main: ExtensionContext | undefined;
	let aborted = false;
	const held: JobNotification[] = [];
	const message = (n: JobNotification) => ({ customType: JOB_MESSAGE, content: `[job] ${n.text}`, display: true, details: { delivery: n.id, ...n.details } });
	const deliver = (n: JobNotification) => {
		if (main?.isIdle() === false) held.push(n);
		else pi.sendMessage(message(n), { triggerTurn: true });
	};
	pi.on("session_start", (_event, ctx) => {
		main = ctx;
		jobs.setNotify(ctx.mode === "print" || ctx.mode === "json" ? undefined : deliver);
	});
	pi.on("agent_start", () => { aborted = false; });
	pi.on("agent_end", (_event, ctx) => {
		if (ctx.signal?.aborted) aborted = true;
		else ctx.signal?.addEventListener("abort", () => { aborted = true; }, { once: true });
	});
	pi.on("agent_before_settle", () => {
		if (aborted || !held.length) return;
		for (const n of held.splice(0)) pi.sendMessage(message(n), { triggerTurn: false });
		return { continue: true };
	});
	pi.on("agent_settled", (event) => {
		const rest = held.splice(0);
		rest.forEach((n, i) => pi.sendMessage(message(n), { triggerTurn: !event.aborted && i === rest.length - 1 }));
	});
	pi.on("session_shutdown", () => { held.length = 0; });
}

/**
 * The six tools with one barrier, plus the `job` tool of one job registry: the main session passes its own `nested`
 * barrier (also used for `codemode`) and registry; a subagent session gets fresh ones. `settings` returns the
 * effective settings of the session whose tools these are. `options.codemode`: a subagent's own Pi `codemode`
 * definition (built from its session's API); it comes back as a call of the same barrier and a job of the same
 * registry, like the main session's, and its scripts take the process-wide codemode worker slots (S1). Without it no
 * `codemode` is returned.
 */
export function createTools(cwd: string, settings: () => any, nested = createNestedBarrier(), options: JobsOptions & { jobs?: Jobs; codemode?: ToolDefinition<any, any, any> } = {}): ToolDefinition[] {
	const tools: ToolDefinition[] = [];
	const jobs = options.jobs ?? createJobs(options);

	type Run = (id: string, params: any, signal: any, onUpdate: any, ctx: any, job?: JobHandle) => Promise<any>;

	function register(name: string, stock: any, overrides: Record<string, unknown>, run: Run) {
		tools.push({
			...stock,
			...overrides,
			execute(id: string, params: any, signal: any, onUpdate: any, ctx: any) {
				const dir = ctx?.cwd || process.cwd();
				// What a bash command certainly touches (holds H1): checked against the holds of background jobs.
				const footprint = name === "bash" ? classifyBash(params?.command, dir) : undefined;
				const refreshFootprint = () => {
					if (!footprint) return false;
					const next = classifyBash(params?.command, dir);
					const same = (a: readonly (string | number)[], b: readonly (string | number)[]) => a.length === b.length && a.every((v, i) => v === b[i]);
					const changed = footprint.server !== next.server || !same(footprint.held.files, next.held.files) || !same(footprint.held.tags, next.held.tags)
						|| !same(footprint.explicit.tags, next.explicit.tags) || !same(footprint.explicit.writes, next.explicit.writes)
						|| !same(footprint.written, next.written) || !same(footprint.ports, next.ports) || !same(footprint.holds, next.holds);
					// A queued handoff may already have given these objects to the barrier: refresh them in place.
					footprint.held.files.splice(0, footprint.held.files.length, ...next.held.files);
					footprint.held.tags.splice(0, footprint.held.tags.length, ...next.held.tags);
					footprint.explicit.tags.splice(0, footprint.explicit.tags.length, ...next.explicit.tags);
					footprint.explicit.writes.splice(0, footprint.explicit.writes.length, ...next.explicit.writes);
					footprint.written.splice(0, footprint.written.length, ...next.written);
					footprint.ports.splice(0, footprint.ports.length, ...next.ports);
					footprint.holds.splice(0, footprint.holds.length, ...next.holds);
					footprint.server = next.server;
					return changed;
				};
				// Resolve after earlier all calls: bash may have changed a symlink target while this call waited.
				const scope = { kind: "all" as const, keys: [], beforeRun: refreshFootprint,
					acquire: undefined as (() => Promise<void | (() => void)>) | undefined, resolve: () => {
						refreshFootprint();
						const resolved = scopeOf(name, params, dir);
						return footprint ? { ...resolved, explicit: footprint.explicit } : resolved;
					} };
				// A call inside a codemode script never goes to the background: the script awaits its real result. Its bash
				// takes the same process-wide git and package-folder claim as a top-level one (holds of other sessions and of
				// background jobs), waiting inside the script.
				if (id.includes("/")) {
					scope.acquire = () => claimFor(footprint, () => `a codemode script call of ${label}`, signal ?? new AbortController().signal);
					return nested.schedule(id, scope, async () => {
						if (signal?.aborted) throw new Error("Operation aborted");
						const result = await withFiles(name, dir, params, false, () => run(id, params, signal, onUpdate, ctx));
						return nested.observe(id, name, params, result);
					});
				}
				// Registered synchronously here, inside `run`, before any await: barrier order stays message order.
				const spec = { tool: name, command: commandOf(name, params), signal, onUpdate, process: name === "bash", cwd: dir, footprint,
					timeoutSeconds: name === "bash" ? params?.timeout : undefined };
				return jobs.run(spec, (job) => {
					// git and package folders are held across sessions of this process (main, subagents).
					scope.acquire = () => claimFor(footprint, () => job.describe(), job.signal, (blockers) => job.waitingOn(blockers));
					return nested.schedule(id, scope, async () => {
						try {
							if (job.signal.aborted) throw new Error("Operation aborted");
							// A server naming a port a running job serves: the note goes into the handoff or the result.
							const portNotes = (footprint?.server ? footprint.ports : []).flatMap((port) => {
								const by = servedBy(port);
								return by ? [`note: ${by} already serves port ${port}.`] : [];
							});
							for (const n of portNotes) job.note(n);
							await job.begin();
							const result = await withFiles(name, dir, params, true, () => run(id, params, job.signal, job.onUpdate, ctx, job), { id, ctx, job });
							// The files a foreground bash command certainly wrote are the caller's own writes (effects reports of
							// its running jobs list them under `yours`); a background job's writes are its own effects.
							if (footprint && !job.backgrounded()) for (const f of footprint.written) recordWrite(owner, label, "bash", f);
							return appendNotes(result, portNotes);
						} finally {
							// Before the barrier releases the calls queued behind it (they may write at once).
							await job.settle();
						}
					}, job.barrier);
				}).then((result) => appendNotes(result, [jobs.piggyback()]));
			},
		} as any);
	}

	// `owner` keys this registry's ledger records (unique per registry); `label` is what other sessions' notes show.
	const owner = jobs.owner;
	const label = jobs.session;
	// Last refused write per session (P1): repeating the identical call overwrites.
	let refused: string | undefined;
	// What this session's reads showed, for the unchanged-read note (unchanged.ts).
	const unchanged = createUnchangedReads();

	/**
	 * The process-wide `git:`/`pkg:` claim of a bash call (H1), or nothing for other calls. Resolves when the call may
	 * run, with its release; throws when `signal` aborts while it waits.
	 */
	async function claimFor(footprint: Footprint | undefined, describe: () => string, signal: AbortSignal, waiting?: (blockers: () => string[]) => void) {
		if (!footprint || !(footprint.held.tags.length || footprint.explicit.tags.length)) return undefined;
		const use = footprint.explicit.tags.filter((t) => !footprint.held.tags.includes(t));
		const c = claim(footprint.held.tags, use, describe, signal);
		waiting?.(c.blockers);
		await c.ready;
		if (signal.aborted) { c.release(); throw new Error("Operation aborted"); }
		return c.release;
	}

	/**
	 * The ledger around a read, edit or write (O1, P1): evidence notes before it runs, a refusal of a write over a file
	 * someone else changed since this session last saw it (once; the identical retry passes), the torn-read check and
	 * the record of what this session saw or wrote. Notes go only into top-level results: a script gets stock values.
	 */
	async function withFiles(name: string, dir: string, params: any, top: boolean, work: () => Promise<any>, call?: ReadCall): Promise<any> {
		// Chosen when the call is about to run, after the calls it waited for: an earlier bash of the same response may
		// have created the spelling stock read will open. Read opens the first existing spelling stock read tries (AM/PM,
		// NFD, curly quote); the lock and the ledger key that one.
		const files = name === "read" && typeof params?.path === "string"
			? [readSpellings(params.path, dir).find((p) => stat(p)) ?? filePaths(params, dir)[0]].filter(Boolean)
			: ["edit", "write"].includes(name) ? filePaths(params, dir) : [];
		if (!files.length) return work();
		// One critical section per file across all sessions: the check, the stock tool and the record (P1).
		return withFileLock(files, () => checkedFiles(name, files, dir, params, top, work, call));
	}

	async function checkedFiles(name: string, files: string[], dir: string, params: any, top: boolean, work: () => Promise<any>, call?: ReadCall): Promise<any> {
		const shownPath = (f: string) => { const r = relative(dir, f); return r && !r.startsWith("..") ? r : f; };
		const running = jobs.runningJobs();
		if (name === "write") {
			const conflicts = files.map((f) => writeConflict(owner, f, shownPath(f), running)).filter((m): m is string => !!m);
			const signature = JSON.stringify(params);
			if (conflicts.length && refused !== signature) {
				refused = signature;
				throw new Error(`${conflicts.join("\n")}\nNothing was written. Read it again, or repeat this exact write to overwrite.`);
			}
			refused = undefined;
		}
		const notes = top ? files.map((f) => changeNote(owner, f, shownPath(f), running)) : [];
		const before = name === "read" ? stat(files[0]) : undefined;
		// Top-level reads only: a codemode script gets the content it asked for, never a note. Any ledger note means
		// something else touched the file, so the content comes back too.
		const skippable = name === "read" && top && !!call && !params?.force;
		if (skippable && notes.every((n) => !n)) {
			const note = await unchanged.check(call.ctx, files[0], params);
			if (note) return { content: [{ type: "text", text: note }] };
		}
		// Bind the cache to bytes from before stock read, not a new version seen only by its later image check.
		const version = name === "read" && top && call ? await unchanged.version(files[0]) : undefined;
		let result: any;
		try {
			result = await work();
		} catch (error) {
			// A one-file write or edit cancelled after its write may have committed: unknown content, not ours, not theirs.
			if (name !== "read" && /aborted/i.test(String((error as Error)?.message ?? error))) for (const f of files) recordUncertain(owner, f);
			throw error;
		}
		if (name === "read") {
			const after = stat(files[0]);
			if (before && after && (before.mtimeMs !== after.mtimeMs || before.size !== after.size)) {
				if (top) notes.push(`note: ${shownPath(files[0])} changed while it was being read; read it again.`);
			} else {
				recordSeen(owner, files[0], after);
				// A read that went to the background hands the model a job placeholder, not this content.
				if (top && call && !call.job?.backgrounded()) await unchanged.remember(call.ctx, files[0], params, call.id, result, version);
			}
		} else {
			const tool = top ? name : `${name} in a codemode script`;
			const perFile = result?.details?.files;
			if (Array.isArray(perFile)) {
				// A multi-file call reports each file: record the written ones even when a sibling failed (the result is then
				// isError), mark the "Possibly changed" ones uncertain, leave the failed ones as they were.
				for (const d of perFile) {
					const file = typeof d?.path === "string" ? filePaths({ path: d.path }, dir)[0] : undefined;
					if (!file) continue;
					if (d.ok) recordWrite(owner, label, tool, file);
					else if (d.outcome === "possibly_changed") recordUncertain(owner, file);
				}
			} else if (!result?.isError) for (const f of files) recordWrite(owner, label, tool, f);
		}
		return top ? appendNotes(result, notes) : result;
	}

	const withDefaultLimit = (stock: any): Run => (id, params, signal, onUpdate, ctx) =>
		stock.execute(id, { ...params, limit: params?.limit ?? NO_LIMIT }, signal, onUpdate, ctx);

	// Effective settings of the running session (trust decision applied), read per call like stock `_buildRuntime`
	// does for its own read and bash. No settings, or a failing read, means stock defaults.
	const sessionSettings = (): any => safely(settings);

	// All six tools are off by default for Pi's own activation. The user's `--tools` / `defaultTools` decide what is
	// on; the session_start handler below adds grep and find only for the default selection.
	const notDefault = { defaultActive: false };

	// The factory-time definitions only carry registration metadata (parameters, renderers, prepareArguments);
	// execution builds a definition with the session's settings.
	const read: any = createReadToolDefinition(cwd);
	register("read", read, { ...notDefault, description: description("read"), parameters: createReadSchema(read.parameters) }, (id, params, signal, onUpdate, ctx) => {
		const { force: _force, ...stockParams } = params ?? {};
		const s = sessionSettings();
		const options = s ? { autoResizeImages: s.images?.autoResize ?? true } : undefined;
		const def: any = createReadToolDefinition(ctx?.cwd || process.cwd(), options);
		return def.execute(id, stockParams, signal, onUpdate, ctx);
	});

	const bash: any = createBashToolDefinition(cwd);
	const bashText = description("bash") + (process.platform === "win32" ? "\n" + description("bash.win32") : "");
	register("bash", bash, { ...notDefault, description: bashText }, (id, params, signal, onUpdate, ctx, job) => {
		const s = sessionSettings();
		const options: any = s
			? { commandPrefix: s.shellCommandPrefix, shellPath: SettingsManager.inMemory({ shellPath: s.shellPath }).getShellPath() }
			: undefined;
		// Stock operations (the same ones stock bash builds), with the output also teed into the job's log.
		if (job) {
			const stock = createLocalBashOperations({ shellPath: options?.shellPath });
			const operations = {
				exec: (command: string, dir: string, o: any) =>
					stock.exec(command, dir, { ...o, onData: (data: Buffer) => { job.data(data); o.onData(data); } }),
			};
			const def: any = createBashToolDefinition(ctx?.cwd || process.cwd(), { ...options, operations });
			return def.execute(id, params, signal, onUpdate, ctx);
		}
		const def: any = createBashToolDefinition(ctx?.cwd || process.cwd(), options);
		return def.execute(id, params, signal, onUpdate, ctx);
	});

	const edit: any = createEditToolDefinition(cwd);
	register(
		"edit",
		edit,
		{
			...notDefault,
			// No strict (constrained) tool sampling for edit: on Anthropic it corrupts non-ASCII oldText/newText
			// (DECISIONS.md, Tools: edit without strict sampling).
			constrainedSampling: undefined,
			description: description("edit"),
			parameters: createEditSchema(edit.parameters),
			prepareArguments: (input: any) => prepareEditArguments(edit.prepareArguments, input),
			...editRenderers(edit),
		},
		(id, params, signal, onUpdate, ctx) => executeEdit(edit.execute, id, params, signal, onUpdate, ctx, cwd),
	);

	const write: any = createWriteToolDefinition(cwd);
	register(
		"write",
		write,
		{
			...notDefault,
			description: description("write"),
			parameters: createWriteSchema(write.parameters),
			prepareArguments: prepareWriteArguments,
			...writeRenderers(write),
		},
		(id, params, signal, onUpdate, ctx) => executeWrite(write.execute, id, params, signal, onUpdate, ctx, cwd),
	);

	const grep: any = createGrepToolDefinition(cwd);
	register(
		"grep",
		grep,
		{
			...notDefault,
			description: description("grep"),
			prepareArguments: (input: unknown) => prepareSearchArguments(grep, input),
			parameters: withDescription(
				grep.parameters,
				"limit",
				"Maximum number of matches (default: no cap; output is still cut at 50KB).",
			),
		},
		withDefaultLimit(grep),
	);

	const find: any = createFindToolDefinition(cwd);
	register(
		"find",
		find,
		{
			...notDefault,
			description: description("find"),
			prepareArguments: (input: unknown) => prepareSearchArguments(find, input),
			parameters: withDescription(
				find.parameters,
				"limit",
				"Maximum number of results (default: no cap; output is still cut at 50KB).",
			),
		},
		withDefaultLimit(find),
	);

	if (options.codemode) tools.push(groupCodemode(options.codemode, nested, jobs));
	tools.push({ ...createJobTool(jobs, description("job")), ...notDefault });
	return tools;
}
