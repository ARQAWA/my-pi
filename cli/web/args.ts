import { parseArgs } from "node:util";
import { HELP } from "./help.ts";
import { mapCaller, THINKING_LEVELS } from "./model-map.ts";
import { UsageError, type RunOptions, type WebMode, type WebResponseLength, type WebTarget } from "./types.ts";

export type Parsed = { kind: "help"; text: string } | { kind: "run"; options: RunOptions };

const MODES: readonly WebMode[] = ["cached", "live", "indexed"];
const LENGTHS: readonly WebResponseLength[] = ["short", "medium", "long"];

function choice<T extends string>(name: string, value: string | undefined, allowed: readonly T[], fallback: T): T {
	if (value === undefined) return fallback;
	if (!allowed.includes(value as T)) throw new UsageError(`${name} must be one of: ${allowed.join(", ")}.`);
	return value as T;
}

function publicHttpUrl(value: string): string | undefined {
	try {
		const url = new URL(value);
		if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return undefined;
		return url.href;
	} catch {
		return undefined;
	}
}

function readValues(argv: string[]) {
	try {
		return parseArgs({
			args: argv,
			strict: true,
			allowPositionals: true,
			options: {
				"caller-model": { type: "string" },
				thinking: { type: "string" },
				query: { type: "string", multiple: true },
				url: { type: "string", multiple: true },
				focus: { type: "string" },
				mode: { type: "string" },
				"response-length": { type: "string" },
				help: { type: "boolean", short: "h" },
			},
		});
	} catch (error) {
		throw new UsageError(`${(error as Error).message} Use --option=VALUE when a value starts with "-".`);
	}
}

function buildTargets(queries: string[], urls: string[], focus: string | undefined): WebTarget[] {
	if (queries.length > 0 && urls.length > 0) throw new UsageError("Use --query or --url, not both in one call.");
	if (queries.length === 0 && urls.length === 0) throw new UsageError("Give at least one --query or --url.");
	if (focus !== undefined && urls.length === 0) throw new UsageError("--focus applies to --url targets only.");
	if (focus !== undefined && !focus.trim()) throw new UsageError("--focus must not be empty.");
	if (queries.length > 0) {
		return queries.map((value, index) => {
			if (!value.trim()) throw new UsageError(`--query ${index + 1} is empty.`);
			return { kind: "query", value: value.trim() };
		});
	}
	return urls.map((value, index) => {
		const href = publicHttpUrl(value.trim());
		if (!href) throw new UsageError(`--url ${index + 1} is not a public http(s) URL without credentials.`);
		return { kind: "url", value: href, ...(focus === undefined ? {} : { focus: focus.trim() }) };
	});
}

export function parseCommandLine(argv: string[]): Parsed {
	const { values, positionals } = readValues(argv);
	if (values.help) return { kind: "help", text: HELP };
	if (positionals.length > 0) throw new UsageError("Unexpected argument. Targets are given with --query or --url.");
	if (!values["caller-model"]) throw new UsageError("--caller-model is required (your own model, e.g. anthropic/claude-sonnet-5-5).");
	if (!values.thinking) throw new UsageError("--thinking is required (your own thinking level).");
	if (!(THINKING_LEVELS as readonly string[]).includes(values.thinking)) {
		throw new UsageError(`--thinking must be one of: ${THINKING_LEVELS.join(", ")}.`);
	}
	const search = mapCaller(values["caller-model"], values.thinking);
	const targets = buildTargets(values.query ?? [], values.url ?? [], values.focus);
	return {
		kind: "run",
		options: {
			targets,
			search,
			mode: choice("--mode", values.mode, MODES, "cached"),
			responseLength: choice("--response-length", values["response-length"], LENGTHS, "short"),
		},
	};
}
