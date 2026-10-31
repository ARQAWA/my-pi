import assert from "node:assert/strict";
import { it } from "node:test";
import { createWebExtension } from "../extensions/RQW-web/index.ts";

it("the subagent offer returns a report using the child's model and thinking", async () => {
	const channels = new Map<string, (request: unknown) => void>();
	const parent = {
		registerTool() {},
		events: { on(name: string, handler: (request: unknown) => void) { channels.set(name, handler); return () => {}; } },
	};
	createWebExtension({ runner: async run => ({
		target: run.target, model: run.model, effort: run.effort, mode: run.mode, responseLength: run.responseLength,
		status: "ok", summary: "done", sources: [], citations: [], actions: [], results: [],
	}) })(parent as never);
	let tool: any;
	const child = { getThinkingLevel: () => "high", registerTool: (definition: unknown) => { tool = definition; } };
	channels.get("rqw-search:subagent-web")!({ offer: (register: (pi: unknown) => void) => register(child) });
	const result = await tool.execute("call", { queries: ["docs"] }, undefined, undefined, {
		model: { provider: "anthropic", id: "claude-sonnet-5-5" },
	});
	const report = result.content[0].text;
	assert.match(report, /search model gpt-6.1-terra, effort high/);
	assert.match(report, /done/);
});
