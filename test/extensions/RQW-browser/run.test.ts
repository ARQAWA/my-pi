import assert from "node:assert/strict";
import { it } from "node:test";
import { createBrowserExtension } from "../../../extensions/RQW-browser/index.ts";

function setup(provider = "anthropic", available: any[] = [{ provider, id: provider === "anthropic" ? "claude-haiku-5-5" : "gpt-6-luna", reasoning: true }]) {
	let tool: any;
	let loads = 0;
	const lookups: string[] = [];
	createBrowserExtension({ load: async () => { loads++; throw new Error("browser must not open"); } })({ registerTool(value: unknown) { tool = value; }, on() {} } as never);
	const ctx = { model: { provider }, modelRegistry: { async getAvailableOfType(type: string, selected: string) { assert.equal(type, "chat"); lookups.push(selected); return available; } } };
	return { tool, lookups, loads: () => loads, call: (input: unknown) => tool.execute("id", input, undefined, undefined, ctx) };
}
const valid = { action: "run", url: "https://example.test", actions: ["Press Search"], expected: "Results are visible" };

it("validates the run contract and limits before model or browser work", async () => {
	const env = setup();
	const invalid = [
		{ ...valid, name: "main" }, { ...valid, url: undefined }, { ...valid, url: " " },
		{ ...valid, actions: [] }, { ...valid, actions: Array(9).fill("click") }, { ...valid, actions: [" "] },
		{ ...valid, expected: " " }, { ...valid, timeout: 0 }, { ...valid, timeout: 121 },
		{ ...valid, conditions: [{ kind: "unknown", value: "x", effect: "require" }] },
		{ ...valid, conditions: [{ kind: "text_visible", value: "", effect: "require" }] },
		{ ...valid, conditions: [{ kind: "url_contains", value: "x", effect: "ignore" }] },
		{ ...valid, conditions: [{ kind: "control_enabled", value: "x", effect: "stop_if", extra: true }] },
		{ ...valid, code: "alert(1)" }, { ...valid, expected: "x".repeat(42001) },
	];
	for (const input of invalid) await assert.rejects(env.call(input), /Browser run/);
	assert.deepEqual(env.lookups, []);
	assert.equal(env.loads(), 0);
	assert.ok(env.tool.parameters.properties.actions);
	assert.ok(env.tool.parameters.properties.expected);
	assert.ok(env.tool.parameters.properties.conditions);
});

it("selects only the caller provider's exact authenticated model before browser work", async () => {
	for (const [provider, id, thinkingLevelMap] of [
		["anthropic", "claude-haiku-5-5", { low: null, high: null }],
		["openai-codex", "gpt-6-luna", { low: null, medium: null }],
	] as const) {
		const env = setup(provider, [{ provider, id, reasoning: true, thinkingLevelMap }]);
		await assert.rejects(env.call({ ...valid, conditions: [{ kind: "text_visible", value: "Found", effect: "require" }, { kind: "url_contains", value: "login", effect: "stop_if" }, { kind: "control_enabled", value: "Search", effect: "require" }], timeout: 120 }), /browser must not open/);
		assert.deepEqual(env.lookups, [provider]);
		assert.equal(env.loads(), 1);
	}
	const named = setup();
	await assert.rejects(named.call({ ...valid, url: undefined, name: "main", expected: "x".repeat(12001), timeout: 1.0001 }), /No tab named/);
});

it("refuses unknown providers, unavailable accounts, wrong models and unsupported effort before browser work", async () => {
	for (const [provider, available, error] of [
		["other", [], /no model for the caller/],
		["anthropic", [], /authenticated model anthropic\/claude-haiku-5-5/],
		["openai-codex", [{ provider: "openai-codex", id: "gpt-5.6-luna", reasoning: true }], /authenticated model openai-codex\/gpt-6-luna/],
		["anthropic", [{ provider: "openai-codex", id: "claude-haiku-5-5", reasoning: true }], /authenticated model/],
		["anthropic", [{ provider: "anthropic", id: "claude-haiku-5-5", reasoning: true, thinkingLevelMap: { medium: null } }], /medium reasoning/],
		["openai-codex", [{ provider: "openai-codex", id: "gpt-6-luna", reasoning: true, thinkingLevelMap: { high: null } }], /high reasoning/],
	] as const) {
		const env = setup(provider, [...available]);
		await assert.rejects(env.call(valid), error);
		assert.equal(env.loads(), 0);
	}
});
