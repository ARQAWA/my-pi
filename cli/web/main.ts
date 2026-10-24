import { parseCommandLine } from "./args.ts";
import { runBatch } from "./batch.ts";
import { renderReport } from "./report.ts";
import { fitOutput } from "./truncate.ts";
import { safeMessage } from "./safe-text.ts";
import { UsageError, type TargetRunner } from "./types.ts";

export interface CliIo {
	stdout(text: string): void;
	stderr(text: string): void;
}

export interface CliDeps {
	/** Replaces the native engine; tests inject fakes. */
	runner?: TargetRunner;
	signal?: AbortSignal;
	concurrency?: number;
	timeoutMs?: number;
	graceMs?: number;
	/** Directory for the full result when output is cut. */
	tmpRoot?: string;
}

async function defaultRunner(): Promise<TargetRunner> {
	const { createEngineRunner } = await import("./engine.ts");
	return createEngineRunner();
}

/** Runs the CLI and returns its exit code: 0 all targets ok, 1 some target failed, 2 bad arguments. */
export async function runCli(argv: string[], io: CliIo, deps: CliDeps = {}): Promise<number> {
	try {
		const parsed = parseCommandLine(argv);
		if (parsed.kind === "help") {
			io.stdout(parsed.text);
			return 0;
		}
		const { options } = parsed;
		const runner = deps.runner ?? await defaultRunner();
		io.stderr(`rqw-web: ${options.targets.length} target(s), search model ${options.search.model}, effort ${options.search.effort}, mode ${options.mode}\n`);
		const results = await runBatch(options, runner, {
			signal: deps.signal ?? new AbortController().signal,
			concurrency: deps.concurrency,
			timeoutMs: deps.timeoutMs,
			graceMs: deps.graceMs,
		});
		io.stdout(await fitOutput(renderReport(results, options), deps.tmpRoot));
		return results.every(result => result.status === "ok") ? 0 : 1;
	} catch (error) {
		io.stderr(`rqw-web: ${safeMessage(error)}\n`);
		if (error instanceof UsageError) {
			io.stderr("Run rqw-web --help for usage.\n");
			return 2;
		}
		return 1;
	}
}

/** Process entry: wires stdio and aborts every running target on SIGINT or SIGTERM. */
export async function main(argv: string[]): Promise<number> {
	const controller = new AbortController();
	const stop = () => controller.abort(new Error("cancelled"));
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	try {
		return await runCli(argv, {
			stdout: text => void process.stdout.write(text),
			stderr: text => void process.stderr.write(text),
		}, { signal: controller.signal });
	} finally {
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
	}
}
