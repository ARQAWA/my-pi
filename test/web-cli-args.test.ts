import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCommandLine } from "../cli/web/args.ts";
import { HELP } from "../cli/web/help.ts";
import { mapCaller } from "../cli/web/model-map.ts";
import { UsageError } from "../cli/web/types.ts";

const base = ["--caller-model", "anthropic/claude-sonnet-5-5", "--thinking", "high"];
const run = (...extra: string[]) => {
	const parsed = parseCommandLine([...base, ...extra]);
	assert.equal(parsed.kind, "run");
	return parsed.kind === "run" ? parsed.options : (undefined as never);
};
const refuses = (argv: string[], pattern: RegExp) => assert.throws(() => parseCommandLine(argv), error => error instanceof UsageError && pattern.test(error.message));

describe("rqw-web cross-platform CLI", () => {
describe("rqw-web arguments", () => {
	it("repeats --query in input order with defaults", () => {
		const options = run("--query", "first", "--query", "second");
		assert.deepEqual(options.targets, [{ kind: "query", value: "first" }, { kind: "query", value: "second" }]);
		assert.equal(options.mode, "cached");
		assert.equal(options.responseLength, "short");
		assert.deepEqual(options.search, { model: "gpt-6-sol", effort: "high" });
	});

	it("takes --url with --focus and normalizes the URL", () => {
		const options = run("--url", "https://example.com/a", "--url", "http://example.org", "--focus", "the limits", "--mode", "live", "--response-length", "long");
		assert.deepEqual(options.targets, [
			{ kind: "url", value: "https://example.com/a", focus: "the limits" },
			{ kind: "url", value: "http://example.org/", focus: "the limits" },
		]);
		assert.equal(options.mode, "live");
		assert.equal(options.responseLength, "long");
	});

	it("refuses mixed targets, no targets, and focus without URLs", () => {
		refuses([...base, "--query", "a", "--url", "https://example.com"], /not both/);
		refuses(base, /at least one/);
		refuses([...base, "--query", "a", "--focus", "x"], /--url targets only/);
		refuses([...base, "--url", "https://example.com", "--focus", "  "], /must not be empty/);
	});

	it("refuses bad URLs without echoing them", () => {
		for (const bad of ["ftp://example.com", "not a url", "https://user:pass@example.com/"]) {
			assert.throws(() => parseCommandLine([...base, "--url", bad]), error => error instanceof UsageError && !error.message.includes("pass") && /public http\(s\) URL/.test(error.message));
		}
	});

	it("requires model and thinking and validates choices", () => {
		refuses(["--thinking", "high", "--query", "a"], /--caller-model is required/);
		refuses(["--caller-model", "anthropic/claude-sonnet-5-5", "--query", "a"], /--thinking is required/);
		refuses([...base, "--query", "a", "--mode", "fresh"], /--mode must be/);
		refuses([...base, "--query", "a", "--response-length", "huge"], /--response-length must be/);
		refuses([...base, "--query", "a", "--bogus"], /bogus/);
		refuses([...base, "--query", "a", "stray"], /Unexpected argument/);
	});

	it("accepts more than 32 targets: longer batches queue, they are not refused", () => {
		const options = run(...Array.from({ length: 33 }, (_, index) => ["--query", `q${index}`]).flat());
		assert.equal(options.targets.length, 33);
	});

	it("returns help without needing any other option", () => {
		const parsed = parseCommandLine(["--help"]);
		assert.deepEqual(parsed, { kind: "help", text: HELP });
		assert.equal(parseCommandLine(["-h"]).kind, "help");
	});

	it("teaches batching, direct URLs, primary sources, usage cost and honesty about memory", () => {
		for (const phrase of [/Batch every independent target in ONE call/, /known public http\(s\) page/, /primary sources/i, /subscription usage/, /reply from memory is not a search/, /read-only/]) {
			assert.match(HELP, phrase);
		}
	});
});

describe("rqw-web caller mapping", () => {
	it("GPT callers keep their exact model and effort, including both Luna models", () => {
		assert.deepEqual(mapCaller("openai-codex/gpt-6-luna", "medium"), { model: "gpt-6-luna", effort: "medium" });
		assert.deepEqual(mapCaller("openai-codex/gpt-5.6-luna", "xhigh"), { model: "gpt-5.6-luna", effort: "xhigh" });
		assert.deepEqual(mapCaller("openai-codex/gpt-6.1-sol", "low"), { model: "gpt-6.1-sol", effort: "low" });
		assert.deepEqual(mapCaller("openai-codex/gpt-6-sol", "ultra"), { model: "gpt-6-sol", effort: "ultra" });
	});

	it("Haiku and Sonnet keep the effort on their search model; the model profile decides what exists", () => {
		for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
			assert.deepEqual(mapCaller("anthropic/claude-haiku-5-5", effort), { model: "gpt-5.6-luna", effort });
			assert.deepEqual(mapCaller("anthropic/claude-sonnet-5-5", effort), { model: "gpt-6-sol", effort });
		}
		assert.deepEqual(mapCaller("anthropic/claude-sonnet-5-5", "ultra"), { model: "gpt-6-sol", effort: "ultra" });
		assert.throws(() => mapCaller("anthropic/claude-haiku-5-5", "ultra"), /gpt-5\.6-luna does not support/);
	});

	it("Opus maps low->low, medium->high, high->xhigh, higher->max", () => {
		const effort = (thinking: string) => mapCaller("anthropic/claude-opus-5-5", thinking).effort;
		assert.deepEqual(["low", "medium", "high", "xhigh", "max", "ultra"].map(effort), ["low", "high", "xhigh", "max", "max", "max"]);
		assert.equal(mapCaller("anthropic/claude-opus-5-5", "low").model, "gpt-6.1-sol");
	});

	it("refuses off and minimal for Claude and for GPT, with no downgrade", () => {
		for (const caller of ["anthropic/claude-haiku-5-5", "anthropic/claude-sonnet-5-5", "anthropic/claude-opus-5-5"]) {
			for (const level of ["off", "minimal"]) assert.throws(() => mapCaller(caller, level), /Unsupported: Claude thinking/);
		}
		assert.throws(() => mapCaller("openai-codex/gpt-6-luna", "minimal"), UsageError);
		assert.throws(() => mapCaller("openai-codex/gpt-6-luna", "ultra"), /does not support/);
	});

	it("uses the fixed low-effort fallback for unknown and missing callers regardless of thinking", () => {
		for (const caller of ["", "gpt-6-sol", "openai-codex/gpt-9", "anthropic/claude-sonnet-4", "openrouter/claude-sonnet-5-5", "/x", "x/"]) {
			for (const thinking of ["", "high", "unknown"]) {
				assert.deepEqual(mapCaller(caller, thinking), { model: "gpt-6.1-sol", effort: "low" });
			}
		}
	});

	it("rejects unknown thinking for known callers, including Opus", () => {
		for (const caller of ["openai-codex/gpt-6.1-sol", "anthropic/claude-opus-5-5", "anthropic/claude-sonnet-5-5"]) {
			assert.throws(() => mapCaller(caller, "unexpected"), UsageError);
		}
	});
});

});
