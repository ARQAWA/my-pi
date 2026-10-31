import { readFileSync } from "node:fs";
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
import { createCountsProducer } from "./counts.ts";
import { commandOf, createJobs, createJobTool, type JobHandle, type JobNotification, type Jobs, type JobsOptions } from "./jobs.ts";
import { editRenderers, writeRenderers } from "./render.ts";
import { withHiddenNote } from "./search.ts";
import { installSelectionIntent, noToolSelection } from "./selection.ts";
import { createWriteSchema, executeWrite, prepareWriteArguments } from "./write.ts";

const NO_LIMIT = 100000;

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

/** Channel on which RQW-agent asks for fresh tools for each subagent session. */
const SUBAGENT_TOOLS = "rqw-tools:subagent-tools";
const BACKGROUNDABLE = ["bash", "codemode", "read", "edit", "write", "grep", "find"];
const STARTUP_PROJECTION = "rqw-prompt:startup-projection";

/** Apply the same optional prompt sections to normal turns and the startup projection. */
function applyToolSections(options: any): void {
	const visible = (name: string) => options.selectedTools.includes(name) && !options.hiddenTools.includes(name);
	if (["grep", "find", "read"].every(visible)) {
		options.sections.search_method = "- Search with the grep and find tools and read files with read, following the method in the grep description.";
	}
	if (visible("bash")) {
		options.sections.rqw_tools_execution = "- Bash and codemode calls run independently of other tool calls; one still running after 12 seconds continues in the background as a job.";
	}
}

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
const JOB_MESSAGE = "job";

export default function (pi: ExtensionAPI) {
	installRqwTools(pi);
}

/** The extension; `backgroundAfterMs` is for tests (the product's threshold is 12 s). */
export function installRqwTools(pi: ExtensionAPI, options: { backgroundAfterMs?: number } = {}) {
	const selectionShutdown = installSelectionIntent();
	const jobs = createJobs({ enabled: () => pi.getActiveTools().includes("job"), backgroundAfterMs: options.backgroundAfterMs });
	for (const tool of createTools(process.cwd(), () => pi.getSettings(), { jobs })) pi.registerTool(tool);
	const counts = createCountsProducer(jobs, pi.events);
	pi.on("session_start", () => counts.start());
	pi.on("session_shutdown", () => counts.stop());
	pi.on("session_shutdown", () => {
		jobs.dispose();
		selectionShutdown();
	});
	installNotifications(pi, jobs);

	pi.on("before_agent_start", (event) => applyToolSections(event.systemPromptOptions));
	let unsubscribeProjection: (() => void) | undefined;
	const subscribeProjection = () => { unsubscribeProjection ??= pi.events.on(STARTUP_PROJECTION, projectToolSections); };
	subscribeProjection();
	pi.on("session_start", subscribeProjection);
	pi.on("session_shutdown", () => { unsubscribeProjection?.(); unsubscribeProjection = undefined; });
	pi.events.on(SUBAGENT_TOOLS, (request) => (request as { offer?: (factory: typeof createTools) => void })?.offer?.(createTools));

	pi.on("session_start", (event, ctx) => {
		if (event.reason !== "reload") {
			const active = pi.getActiveTools();
			const missing = noToolSelection(pi, ctx.sessionManager) ? ["grep", "find"].filter((name) => !active.includes(name)) : [];
			if (!active.includes("job") && [...active, ...missing].some((name) => BACKGROUNDABLE.includes(name))) missing.push("job");
			if (missing.length > 0) pi.setActiveTools([...active, ...missing]);
		}
		// Ids continue above the highest job#N this session already reported.
		for (const entry of ((ctx.sessionManager as any)?.getEntries?.() ?? []) as any[]) {
			if (entry?.type !== "message" || entry.message?.role !== "toolResult") continue;
			for (const block of entry.message.content ?? []) {
				if (block?.type !== "text") continue;
				for (const match of String(block.text).matchAll(/\bjob#(\d+)/g)) jobs.seen(Number(match[1]));
			}
		}
		takeOverBuiltinCodemode(pi, jobs);
	});
}

/** Deliver finished notification waits into the main chat. */
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

/** Fresh base tools and one job registry for a main session or a subagent. */
export function createTools(cwd: string, settings: () => any, options: JobsOptions & { jobs?: Jobs; codemode?: ToolDefinition<any, any, any> } = {}): ToolDefinition[] {
	const tools: ToolDefinition[] = [];
	const jobs = options.jobs ?? createJobs(options);
	type Run = (id: string, params: any, signal: any, onUpdate: any, ctx: any, job?: JobHandle) => Promise<any>;

	function register(name: string, stock: any, overrides: Record<string, unknown>, run: Run) {
		tools.push({
			...stock,
			...overrides,
			execute(id: string, params: any, signal: any, onUpdate: any, ctx: any) {
				// Calls made by a codemode script return their real result to that script.
				if (id.includes("/")) return run(id, params, signal, onUpdate, ctx);
				return jobs.run({
					tool: name,
					command: commandOf(name, params),
					signal,
					onUpdate,
					process: name === "bash",
					timeoutSeconds: name === "bash" ? params?.timeout : undefined,
				}, (job) => run(id, params, job.signal, job.onUpdate, ctx, job));
			},
		} as any);
	}

	const withDefaultLimit = (stock: any): Run => (id, params, signal, onUpdate, ctx) =>
		stock.execute(id, { ...params, limit: params?.limit ?? NO_LIMIT }, signal, onUpdate, ctx);
	const sessionSettings = (): any => safely(settings);
	const notDefault = { defaultActive: false };

	const read: any = createReadToolDefinition(cwd);
	register("read", read, { ...notDefault, description: description("read") }, (id, params, signal, onUpdate, ctx) => {
		const s = sessionSettings();
		const options = s ? { autoResizeImages: s.images?.autoResize ?? true } : undefined;
		const def: any = createReadToolDefinition(ctx?.cwd || process.cwd(), options);
		return def.execute(id, params, signal, onUpdate, ctx);
	});

	const bash: any = createBashToolDefinition(cwd);
	const bashText = description("bash") + (process.platform === "win32" ? "\n" + description("bash.win32") : "");
	register("bash", bash, { ...notDefault, description: bashText }, (id, params, signal, onUpdate, ctx, job) => {
		const s = sessionSettings();
		const options: any = s
			? { commandPrefix: s.shellCommandPrefix, shellPath: SettingsManager.inMemory({ shellPath: s.shellPath }).getShellPath() }
			: undefined;
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
	register("edit", edit, {
		...notDefault,
		constrainedSampling: undefined,
		description: description("edit"),
		parameters: createEditSchema(edit.parameters),
		prepareArguments: (input: any) => prepareEditArguments(edit.prepareArguments, input),
		...editRenderers(edit),
	}, (id, params, signal, onUpdate, ctx) => executeEdit(edit.execute, id, params, signal, onUpdate, ctx, cwd));

	const write: any = createWriteToolDefinition(cwd);
	register("write", write, {
		...notDefault,
		description: description("write"),
		parameters: createWriteSchema(write.parameters),
		prepareArguments: prepareWriteArguments,
		...writeRenderers(write),
	}, (id, params, signal, onUpdate, ctx) => executeWrite(write.execute, id, params, signal, onUpdate, ctx, cwd));

	const grep: any = createGrepToolDefinition(cwd);
	register("grep", grep, {
		...notDefault,
		description: description("grep"),
		prepareArguments: (input: unknown) => prepareSearchArguments(grep, input),
		parameters: withDescription(grep.parameters, "limit", "Maximum number of matches (default: no cap; output is still cut at 50KB)."),
	}, withHiddenNote("grep", withDefaultLimit(grep), cwd));

	const find: any = createFindToolDefinition(cwd);
	register("find", find, {
		...notDefault,
		description: description("find"),
		prepareArguments: (input: unknown) => prepareSearchArguments(find, input),
		parameters: withDescription(find.parameters, "limit", "Maximum number of results (default: no cap; output is still cut at 50KB)."),
	}, withHiddenNote("find", withDefaultLimit(find), cwd));

	if (options.codemode) tools.push(groupCodemode(options.codemode, jobs));
	tools.push({ ...createJobTool(jobs, description("job")), ...notDefault });
	return tools;
}
