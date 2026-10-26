import assert from "node:assert/strict";
import { it } from "node:test";
import { createWebTool } from "../../../extensions/RQW-web/tool.ts";
import type { TargetResult, TargetRun } from "../../../extensions/RQW-web/core/types.ts";

const ok = (run: TargetRun): TargetResult => ({
	target: run.target, model: run.model, effort: run.effort, mode: run.mode, responseLength: run.responseLength,
	status: "ok", summary: `Answer for ${run.target.value}`, sources: [{ url: "https://example.com/docs" }],
	citations: [], actions: [], results: [],
});
function tool() {
	return createWebTool({ getThinkingLevel: () => "high" }, { runner: async run => ok(run) });
}
async function execute(input: { queries?: string[]; urls?: string[]; focus?: string }) {
	const result = await tool().execute("call", input, undefined, undefined, {
		model: { provider: "anthropic", id: "claude-sonnet-5-5" },
	} as never);
	return result.content.map(part => part.type === "text" ? part.text : "").join("\n");
}

it("returns a sourced report for a query", async () => {
	const report = await execute({ queries: ["Pi documentation"] });
	assert.match(report, /1 target, 1 ok, 0 failed/);
	assert.match(report, /search model gpt-6-sol, effort high/);
	assert.match(report, /Answer for Pi documentation/);
});

it("returns a normalized URL target with its focused result", async () => {
	const report = await execute({ urls: [" https://example.com "], focus: "exact fact" });
	assert.match(report, /url: https:\/\/example\.com\//);
	assert.match(report, /Answer for https:\/\/example\.com\//);
});

it("keeps a successful sibling when another target fails", async () => {
	const web = createWebTool({ getThinkingLevel: () => "high" }, { runner: async run => {
		if (run.target.value === "bad") throw new Error("fake network failure");
		return ok(run);
	} });
	const result = await web.execute("call", { queries: ["bad", "good"] }, undefined, undefined, {
		model: { provider: "anthropic", id: "claude-sonnet-5-5" },
	} as never);
	const report = result.content.map(part => part.type === "text" ? part.text : "").join("\n");
	assert.match(report, /2 targets, 1 ok, 1 failed/);
	assert.match(report, /Answer for good/);
});
