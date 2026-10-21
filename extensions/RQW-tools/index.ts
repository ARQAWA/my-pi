import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createBarrier } from "./barrier.ts";
import { createEditSchema, executeEdit, prepareEditArguments } from "./edit.ts";
import { scopeOf } from "./keys.ts";
import { editRenderers, writeRenderers } from "./render.ts";
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

export default function (pi: ExtensionAPI) {
	for (const tool of createTools(process.cwd(), () => pi.getSettings())) pi.registerTool(tool);

	// Pi calls the handler synchronously inside `emit`, and drops it when this instance goes stale (reload, dispose).
	pi.events.on(SUBAGENT_TOOLS, (request) => (request as { offer?: (factory: typeof createTools) => void })?.offer?.(createTools));

	// grep and find are on only when the user made no tool selection: no tool flag in argv (any spelling) and no
	// `defaultTools` setting. Any selection leaves the active set exactly as stock Pi built it.
	// The extension API exposes no `tools` / `noTools` / `excludeTools` session options, so argv is the signal.
	const TOOL_FLAGS = ["--tools", "-t", "--exclude-tools", "-xt", "--no-tools", "-nt", "--no-builtin-tools", "-nbt"];
	pi.on("session_start", () => {
		if (process.argv.some((a) => TOOL_FLAGS.some((f) => a === f || a.startsWith(f + "=")))) return;
		const settings = safely(() => pi.getSettings());
		if (!settings || settings.defaultTools !== undefined) return;
		const active = pi.getActiveTools();
		const missing = ["grep", "find"].filter((name) => !active.includes(name));
		if (missing.length > 0) pi.setActiveTools([...active, ...missing]);
	});
}

/**
 * The six tools with one barrier of their own: one call for the main session, one per subagent session. `settings`
 * returns the effective settings of the session whose tools these are.
 */
export function createTools(cwd: string, settings: () => any): ToolDefinition[] {
	// One barrier per call; every execute registers its scope synchronously before any await.
	const schedule = createBarrier();
	const tools: ToolDefinition[] = [];

	type Run = (id: string, params: any, signal: any, onUpdate: any, ctx: any) => Promise<any>;

	function register(name: string, stock: any, overrides: Record<string, unknown>, run: Run) {
		tools.push({
			...stock,
			...overrides,
			execute(id: string, params: any, signal: any, onUpdate: any, ctx: any) {
				return schedule(scopeOf(name, params, ctx?.cwd || process.cwd()), async () => {
					if (signal?.aborted) throw new Error("Operation aborted");
					return run(id, params, signal, onUpdate, ctx);
				});
			},
		} as any);
	}

	const withDefaultLimit = (stock: any): Run => (id, params, signal, onUpdate, ctx) =>
		stock.execute(id, { ...params, limit: params?.limit ?? NO_LIMIT }, signal, onUpdate, ctx);

	// Effective settings of the running session (trust decision applied), read per call like stock `_buildRuntime`
	// does for its own read and bash. No settings, or a failing read, means stock defaults.
	const sessionSettings = (): any => safely(settings);
	const expandTilde = (p: string) => (p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

	// All six tools are off by default for Pi's own activation. The user's `--tools` / `defaultTools` decide what is
	// on; the session_start handler below adds grep and find only for the default selection.
	const notDefault = { defaultActive: false };

	// The factory-time definitions only carry registration metadata (parameters, renderers, prepareArguments);
	// execution builds a definition with the session's settings.
	const read: any = createReadToolDefinition(cwd);
	register("read", read, { ...notDefault, description: description("read") }, (id, params, signal, onUpdate, ctx) => {
		const s = sessionSettings();
		const options = s ? { autoResizeImages: s.images?.autoResize ?? true } : undefined;
		const def: any = createReadToolDefinition(ctx?.cwd || process.cwd(), options);
		return def.execute(id, params, signal, onUpdate, ctx);
	});

	const bash: any = createBashToolDefinition(cwd);
	const bashText = description("bash") + (process.platform === "win32" ? "\n" + description("bash.win32") : "");
	register("bash", bash, { ...notDefault, description: bashText }, (id, params, signal, onUpdate, ctx) => {
		const s = sessionSettings();
		const options = s
			? { commandPrefix: s.shellCommandPrefix, shellPath: s.shellPath ? expandTilde(s.shellPath) : s.shellPath }
			: undefined;
		const def: any = createBashToolDefinition(ctx?.cwd || process.cwd(), options);
		return def.execute(id, params, signal, onUpdate, ctx);
	});

	const edit: any = createEditToolDefinition(cwd);
	register(
		"edit",
		edit,
		{
			...notDefault,
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
			parameters: withDescription(
				find.parameters,
				"limit",
				"Maximum number of results (default: no cap; output is still cut at 50KB).",
			),
		},
		withDefaultLimit(find),
	);

	return tools;
}
