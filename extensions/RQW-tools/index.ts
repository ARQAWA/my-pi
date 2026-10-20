import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	getAgentDir,
	SettingsManager,
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

export default function (pi: ExtensionAPI) {
	// One barrier per extension instance; every execute registers its scope synchronously before any await.
	const schedule = createBarrier();
	const cwd = process.cwd();

	type Run = (id: string, params: any, signal: any, onUpdate: any, ctx: any) => Promise<any>;

	function register(name: string, stock: any, overrides: Record<string, unknown>, run: Run) {
		pi.registerTool({
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

	const stockRun = (stock: any): Run => (id, params, signal, onUpdate, ctx) => stock.execute(id, params, signal, onUpdate, ctx);
	const withDefaultLimit = (stock: any): Run => (id, params, signal, onUpdate, ctx) =>
		stock.execute(id, { ...params, limit: params?.limit ?? NO_LIMIT }, signal, onUpdate, ctx);

	// Same options stock Pi builds read and bash with (agent-session.js _buildRuntime).
	let settings: SettingsManager | undefined;
	try {
		settings = SettingsManager.create(cwd, getAgentDir());
	} catch {}

	// read, bash, edit and write replace the built-ins of the same name, so Pi's own default and the user's
	// `--tools` / `defaultTools` decide whether they are on; grep and find keep default activation.
	const notDefault = { defaultActive: false };

	const read: any = createReadToolDefinition(cwd, settings ? { autoResizeImages: settings.getImageAutoResize() } : undefined);
	register("read", read, { ...notDefault, description: description("read") }, stockRun(read));

	const bash: any = createBashToolDefinition(
		cwd,
		settings ? { commandPrefix: settings.getShellCommandPrefix(), shellPath: settings.getShellPath() } : undefined,
	);
	const bashText = description("bash") + (process.platform === "win32" ? "\n" + description("bash.win32") : "");
	register("bash", bash, { ...notDefault, description: bashText }, stockRun(bash));

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
			description: description("find"),
			parameters: withDescription(
				find.parameters,
				"limit",
				"Maximum number of results (default: no cap; output is still cut at 50KB).",
			),
		},
		withDefaultLimit(find),
	);

	// A resumed session may lack grep and find; they are registered, but the active set comes from the transcript.
	// An explicit tool choice on the command line wins.
	const TOOL_FLAGS = ["--tools", "--exclude-tools", "--no-tools"];
	pi.on("session_start", (event: any) => {
		if (event?.reason !== "resume" && event?.reason !== "fork") return;
		if (process.argv.some((a) => TOOL_FLAGS.some((f) => a === f || a.startsWith(f + "=")))) return;
		const active = pi.getActiveTools();
		const missing = ["grep", "find"].filter((name) => !active.includes(name));
		if (missing.length > 0) pi.setActiveTools([...active, ...missing]);
	});
}
