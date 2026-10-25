import { readFileSync } from "node:fs";
import type { AgentToolResult, ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runBatch } from "./core/batch.ts";
import { mapCaller } from "./core/model-map.ts";
import { renderReport } from "./core/report.ts";
import { fitOutput } from "./core/truncate.ts";
import { UsageError, type RunOptions, type TargetRunner, type WebTarget } from "./core/types.ts";

const parameters = Type.Object({
	queries: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Independent search questions; do not mix with urls." })),
	urls: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Known public HTTP(S) pages to read; do not mix with queries." })),
	focus: Type.Optional(Type.String({ minLength: 1, description: "The exact evidence needed from the URLs; URLs only." })),
	mode: Type.Optional(Type.Union([Type.Literal("cached"), Type.Literal("live"), Type.Literal("indexed")], { description: "Default cached. Use live for fresh facts and pages." })),
	response_length: Type.Optional(Type.Union([Type.Literal("short"), Type.Literal("medium"), Type.Literal("long")], { description: "Requested detail, default short; not an exact size." })),
}, { additionalProperties: false });

export interface WebInput {
	queries?: string[];
	urls?: string[];
	focus?: string;
	mode?: "cached" | "live" | "indexed";
	response_length?: "short" | "medium" | "long";
}

export interface WebDependencies {
	runner?: TargetRunner;
	tmpRoot?: string;
}

function targetsOf(input: WebInput): WebTarget[] {
	if (input.queries !== undefined && input.urls !== undefined) throw new UsageError("Give queries or urls, never both.");
	const values = input.queries ?? input.urls;
	if (!Array.isArray(values) || values.length === 0) throw new UsageError("Give a nonempty queries or urls array.");
	if (input.focus !== undefined && (!input.urls || typeof input.focus !== "string" || !input.focus.trim())) {
		throw new UsageError("focus must be nonempty and applies only to urls.");
	}
	return values.map(value => {
		if (typeof value !== "string" || !value.trim()) throw new UsageError("Targets must be nonempty strings.");
		if (input.queries) return { kind: "query", value: value.trim() };
		let url: URL;
		try { url = new URL(value.trim()); }
		catch { throw new UsageError("urls must contain public HTTP(S) URLs without credentials."); }
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
			throw new UsageError("urls must contain public HTTP(S) URLs without credentials.");
		}
		return { kind: "url", value: url.href, ...(input.focus === undefined ? {} : { focus: input.focus.trim() }) };
	});
}

export function createWebTool(pi: Pick<ExtensionAPI, "getThinkingLevel">, deps: WebDependencies = {}): ToolDefinition<typeof parameters> {
	return {
		name: "web",
		label: "Web",
		description: readFileSync(new URL("./description.md", import.meta.url), "utf8").trim(),
		promptSnippet: "Search independent questions together, or read known public URLs with a focus; returns summaries with sources.",
		parameters,
		prepareArguments: args => {
			if (!args || typeof args !== "object" || Array.isArray(args)) return args as WebInput;
			return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null)) as WebInput;
		},
		annotations: { destructiveHint: false, openWorldHint: true },
		async execute(_id, input, signal, _update, ctx) {
			// Capture the caller before I/O; a later picker change cannot reroute this invocation.
			const targets = targetsOf(input);
			const caller = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "";
			const options: RunOptions = {
				targets,
				search: mapCaller(caller, pi.getThinkingLevel()),
				mode: input.mode ?? "cached",
				responseLength: input.response_length ?? "short",
			};
			if (!["cached", "live", "indexed"].includes(options.mode) || !["short", "medium", "long"].includes(options.responseLength)) {
				throw new UsageError("Invalid mode or response_length.");
			}
			const runner = deps.runner ?? (await import("./core/engine.ts")).createEngineRunner();
			const results = await runBatch(options, runner, { signal: signal ?? new AbortController().signal });
			const text = await fitOutput(renderReport(results, options), deps.tmpRoot);
			// Pi's type requires metadata, but this tool intentionally persists only text.
			return { content: [{ type: "text", text }] } as AgentToolResult;
		},
	};
}
