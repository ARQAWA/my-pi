import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createCoordinatorGuard } from "../.pi/extensions/coordinator-guard/index.ts";
import { registerSessionRuntime } from "../extensions/RQW-agent/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

function fixture(randomInt: (max: number) => number) {
	const handlers = new Map<string, (...args: any[]) => any>();
	let tool: ToolDefinition;
	const noop = () => {};
	const pi = new Proxy({
		events: { on: noop, emit: noop },
		on: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler),
		registerTool: (definition: ToolDefinition) => { tool = definition; },
	}, { get: (target, key) => target[key as keyof typeof target] ?? noop }) as unknown as ExtensionAPI;
	registerSessionRuntime(pi);
	createCoordinatorGuard({ root, now: () => 0, randomInt })(pi);
	return (input: { action: string; model: string; task: string; thinking?: string }) => {
		const args = validateToolArguments(tool, { type: "toolCall", id: "synthetic", name: "agent", arguments: input });
		const result = handlers.get("tool_call")!({ toolName: "agent", input: args }, { cwd: root, sessionManager: { getBranch: () => [] } });
		return { result, args };
	};
}

test("schema-valid category calls reach the guard and receive the drawn pair", () => {
	const expected = [
		["openai-codex/gpt-6.1-terra", "xhigh"],
		["anthropic/claude-sonnet-5-5", "high"],
	];
	for (const index of [0, 1]) {
		const call = fixture(max => index % max);
		const { result, args } = call({ action: "start", model: "code", task: "synthetic" });
		assert.equal(result, undefined);
		assert.deepEqual([args.model, args.thinking], expected[index]);
	}
});

test("explicit executor model pairs are blocked with category guidance", () => {
	const call = fixture(() => 0);
	const { result } = call({ action: "start", model: "openai-codex/gpt-6.1-terra", thinking: "high", task: "synthetic" });
	assert.equal(result.block, true);
	assert.match(result.reason, /pass the category name as model \(code, mechanical, ordinary, analysis, hardest, design\)/);
});
