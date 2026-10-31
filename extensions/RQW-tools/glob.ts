import path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	baseArgs, dropNulls, failureOf, FOOTER_RESERVE, fitPrefix, incompleteReason, inspectRoot, listPaths, OUTPUT_BYTES, readDescription,
	resolveRipgrep, SCAN_ENTRIES, SEARCH_TIMEOUT_MS, type RgOptions,
} from "./rg.ts";
import { createPolicy, resolveInputPath } from "./search-policy.ts";

/** Paths one answer shows; the rest is counted as "more". */
export const GLOB_LIMIT = 2000;

const globSchema = Type.Object({
	glob_pattern: Type.String({
		description: "The glob pattern to match files against.\nPatterns not starting with \"**/\" are automatically prepended with \"**/\" to enable recursive searching.\n\nExamples:\n\t- \"*.js\" (becomes \"**/*.js\") - find all .js files\n\t- \"**/node_modules/**\" - find all node_modules directories\n\t- \"**/test/**/test_*.ts\" - find all test_*.ts files in any test directory",
	}),
	target_directory: Type.Optional(Type.String({ description: "Relative or absolute path to directory to search for files in. If not provided, defaults to current working directory." })),
});

type GlobParams = { glob_pattern: string; target_directory?: string };

/** The pattern as rg's --iglob takes it: forward slashes on Windows, no leading ./ or /, and the recursive prefix. */
export function recursivePattern(input: unknown, platform: NodeJS.Platform = process.platform): string {
	if (typeof input !== "string" || input.trim() === "") throw new Error("glob_pattern must not be empty");
	let pattern = platform === "win32" ? input.replaceAll("\\", "/") : input;
	pattern = pattern.replace(/^(\.\/|\/)+/, "");
	return pattern.startsWith("**/") ? pattern : `**/${pattern}`;
}

export function createGlobToolDefinition(cwd: string, options: RgOptions = {}): ToolDefinition<any, any, any> {
	return {
		name: "rqw_glob",
		label: "glob",
		description: readDescription("rqw_glob"),
		promptSnippet: "Find files by glob pattern, newest first (respects .gitignore)",
		parameters: globSchema,
		prepareArguments: (input: unknown) => dropNulls(input, ["glob_pattern"]) as any,
		async execute(_id: string, params: GlobParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
			if (signal?.aborted) throw new Error("Operation aborted");
			const pattern = recursivePattern(params?.glob_pattern);
			const root = resolveInputPath(params.target_directory, ctx?.cwd || cwd);
			if (!(await inspectRoot(root)).isDirectory) throw new Error(`Not a directory: ${root}`);
			const policy = await createPolicy(root, pattern, true);
			// Newest first needs rg's own modified-time sort; doing it here would stat every file.
			const args = [...baseArgs(), "--files", "--null", "--sortr", "modified", "--iglob", pattern, ...policy.excludes.flatMap((glob) => ["--iglob", glob]), "--", "."];
			const binary = await resolveRipgrep(ctx?.cwd || cwd, options.createGrep);
			const filter = async (candidates: string[]) => {
				await policy.check(candidates, signal);
				return candidates.filter((file) => policy.allows(file));
			};
			const listing = await listPaths(binary, args, root, SCAN_ENTRIES, filter, signal, SEARCH_TIMEOUT_MS);
			const files = listing.paths;
			const failure = failureOf(listing.outcome, files.length > 0);
			if (failure.error) throw failure.error;
			if (signal?.aborted) throw new Error("Operation aborted");
			const incomplete = incompleteReason(listing.outcome, listing.cut);
			const text = formatPaths(files, root, incomplete, failure.partial);
			return { content: [{ type: "text" as const, text: text.text }], details: { total: files.length, shown: text.shown, incomplete } };
		},
	} as ToolDefinition<any, any, any>;
}

function formatPaths(files: string[], root: string, incomplete: string | undefined, partial: string | undefined) {
	const names = files.slice(0, GLOB_LIMIT).map((file) => path.relative(root, file).split(path.sep).join("/"));
	const budget = OUTPUT_BYTES - FOOTER_RESERVE;
	const shown = fitPrefix(names.length, (count) => names.slice(0, count), budget);
	const footers: string[] = [];
	if (shown < names.length) footers.push(`[Output cut at ${OUTPUT_BYTES / 1024}KiB after ${shown} paths. Narrow glob_pattern or target_directory.]`);
	else if (files.length > GLOB_LIMIT) footers.push(`[Showing the newest ${GLOB_LIMIT} paths; more match. Narrow glob_pattern or target_directory.]`);
	if (incomplete) footers.push(`[Scan incomplete: ${incomplete}. Results may be missing; narrow glob_pattern or target_directory.]`);
	if (partial) footers.push(`[Some paths could not be searched: ${partial}. Results may be missing.]`);
	const body = shown > 0 ? names.slice(0, shown).join("\n") : incomplete ? "No files found before the scan stopped" : "No files found matching pattern";
	return { text: [body, ...(footers.length ? [footers.join("\n")] : [])].join("\n\n"), shown };
}
