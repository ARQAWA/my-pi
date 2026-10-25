import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { CONCURRENCY, runBatch, TARGET_TIMEOUT_MS } from "../../../extensions/RQW-web/core/batch.ts";
import { createEngineRunner } from "../../../extensions/RQW-web/core/engine.ts";
import { mapCaller } from "../../../extensions/RQW-web/core/model-map.ts";
import { renderReport } from "../../../extensions/RQW-web/core/report.ts";
import { fitOutput } from "../../../extensions/RQW-web/core/truncate.ts";
import { UsageError, type RunOptions, type TargetResult } from "../../../extensions/RQW-web/core/types.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../extensions/RQW-web");

describe("self-contained web core", () => {
	it("keeps every relative source import inside the extension", async () => {
		async function inspect(directory: string): Promise<void> {
			for (const entry of await readdir(directory, { withFileTypes: true })) {
				const path = join(directory, entry.name);
				if (entry.isDirectory()) await inspect(path);
				else if (path.endsWith(".ts")) {
					const source = await readFile(path, "utf8");
					for (const match of source.matchAll(/(?:from\s*|import\s*\()(["'])(\.[^"']+)\1/g)) {
						const destination = resolve(dirname(path), match[2]);
						assert.ok(!relative(root, destination).startsWith(".."), `${path}: ${match[2]}`);
					}
				}
			}
		}
		await inspect(join(root, "core"));
		await inspect(join(root, "vendor"));
		await inspect(import.meta.dirname);
	});

	it("exposes the wrapper pipeline without loading or writing credentials", async () => {
		assert.equal(typeof createEngineRunner, "function");
		assert.equal(CONCURRENCY, 3);
		assert.equal(TARGET_TIMEOUT_MS, 120_000);
		const options: RunOptions = {
			targets: [{ kind: "query", value: "example" }], search: mapCaller("", "high"),
			mode: "live", responseLength: "short",
		};
		const results: TargetResult[] = await runBatch(options, async run => ({
			...run, status: "ok", summary: "Example evidence", sources: [{ url: "https://example.com/" }],
			citations: [], actions: [], results: [],
		}), { signal: new AbortController().signal });
		const report = renderReport(results, options);
		assert.equal(await fitOutput(report), report);
		assert.match(report, /search model gpt-6\.1-sol, effort low, mode live/);
		assert.match(report, /Example evidence/);
	});

	it("keeps recognized mappings and errors but never derives effort for an unknown caller", () => {
		assert.deepEqual(mapCaller("anthropic/claude-haiku-5-5", "medium"), { model: "gpt-5.6-luna", effort: "medium" });
		assert.deepEqual(mapCaller("anthropic/claude-sonnet-5-5", "high"), { model: "gpt-6-sol", effort: "high" });
		for (const [thinking, effort] of Object.entries({ low: "low", medium: "high", high: "xhigh", xhigh: "max", max: "max", ultra: "max" })) {
			assert.deepEqual(mapCaller("anthropic/claude-opus-5-5", thinking), { model: "gpt-6.1-sol", effort });
		}
		assert.deepEqual(mapCaller("openai-codex/gpt-6-luna", "medium"), { model: "gpt-6-luna", effort: "medium" });
		for (const caller of ["", "new-provider/model", "openai-codex/new-model"]) {
			assert.deepEqual(mapCaller(caller, "ultra"), { model: "gpt-6.1-sol", effort: "low" });
		}
		assert.throws(() => mapCaller("openai-codex/gpt-6-luna", "ultra"), UsageError);
		assert.throws(() => mapCaller("anthropic/claude-opus-5-5", "invalid"), UsageError);
	});
});
