import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createCoordinatorGuard, promptSection } from "../.pi/extensions/coordinator-guard/index.ts";
import { loadRules, parseRules } from "../.pi/extensions/coordinator-guard/rules.ts";
import { Slots } from "../.pi/extensions/coordinator-guard/slots.ts";
import { registerSessionRuntime } from "../extensions/RQW-agent/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

const SOL = "openai-codex/gpt-6.1-sol";
const OPUS = "anthropic/claude-opus-5-5";
const TERRA = "openai-codex/gpt-6.1-terra";
const SONNET = "anthropic/claude-sonnet-5-5";

function fixture(randomInt: (max: number) => number, callerModel?: { provider: string; id: string }) {
	const handlers = new Map<string, (...args: any[]) => any>();
	let tool: ToolDefinition;
	const noop = () => {};
	const pi = new Proxy({
		events: { on: noop, emit: noop },
		on: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler),
		registerTool: (definition: ToolDefinition) => { tool = definition; },
	}, { get: (target, key) => target[key as keyof typeof target] ?? noop }) as unknown as ExtensionAPI;
	registerSessionRuntime(pi);
	createCoordinatorGuard({ root, randomInt, slots: new Slots() })(pi);
	let calls = 0;
	let agents = 0;
	const call = (input: { action: string; task?: string; model?: string; thinking?: string; fork_turns?: string; id?: string; agent_type?: string }) => {
		const args = validateToolArguments(tool, { type: "toolCall", id: "synthetic", name: "agent", arguments: input });
		const toolCallId = `call-${++calls}`;
		const result = handlers.get("tool_call")!({ toolName: "agent", toolCallId, input: args }, { cwd: root, model: callerModel, sessionManager: { getBranch: () => [] } });
		return { result, args, toolCallId };
	};
	// What Pi emits when the call ended: the tool result of the `agent` tool.
	const end = (toolCallId: string, text: string, details: object = {}, isError = false) =>
		handlers.get("tool_execution_end")!({ toolName: "agent", toolCallId, result: { content: [{ type: "text", text }], details }, isError });
	// A start that succeeds: the guard admits it and RQW-agent answers `agent#N started`.
	const started = (input: Parameters<typeof call>[0]) => {
		const made = call(input);
		assert.equal(made.result, undefined);
		end(made.toolCallId, `agent#${++agents} started`);
		return made.args.model as string;
	};
	// The automatic message that delivers the final results of these agents.
	const delivered = (...ids: string[]) => handlers.get("message_end")!({
		message: { role: "custom", customType: "rqw-auto-wait-results", details: { results: ids.map((id) => ({ id, outcome: "completed" })) } },
	});
	return Object.assign(call, { end, started, delivered });
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

test("a fork start passes without a model and is not rewritten", () => {
	const call = fixture(() => 0);
	const { result, args } = call({ action: "start", fork_turns: "all", task: "synthetic" });
	assert.equal(result, undefined);
	assert.equal(args.model, undefined);
	assert.equal(args.thinking, undefined);
	assert.equal(args.fork_turns, "all");
});

test("a fork restart passes without a model too", () => {
	const call = fixture(() => 0);
	const { result, args } = call({ action: "restart", id: "agent#1", fork_turns: "all", task: "synthetic" });
	assert.equal(result, undefined);
	assert.equal(args.model, undefined);
});

test("a plain start without a category is still refused", () => {
	for (const fork_turns of [undefined, "none"]) {
		const call = fixture(() => 0);
		const { result } = call({ action: "start", fork_turns, task: "synthetic" });
		assert.equal(result.block, true);
		assert.match(result.reason, /pass the category name as model/);
	}
});

const analysis = { action: "start", model: "analysis", task: "synthetic" };

/** Ten analysis starts: with the first free model drawn, five fill Sol and five fill Opus. */
function fullPair() {
	const call = fixture(() => 0);
	const models = Array.from({ length: 10 }, () => call.started(analysis));
	assert.deepEqual(models, [...Array(5).fill(SOL), ...Array(5).fill(OPUS)]);
	return call;
}

test("a category start draws only among the pair's models that have a free slot", () => {
	const call = fixture(() => 0);
	for (let i = 0; i < 5; i++) assert.equal(call.started(analysis), SOL);
	assert.equal(call.started(analysis), OPUS);
});

test("a start whose whole pair is full is refused with the counts", () => {
	const call = fullPair();
	const { result } = call(analysis);
	assert.equal(result.block, true);
	assert.match(result.reason, /slots full: openai-codex\/gpt-6\.1-sol 5\/5, anthropic\/claude-opus-5-5 5\/5/);
	// Another category with free models is not affected.
	assert.equal(call.started({ action: "start", model: "code", task: "synthetic" }), TERRA);
});

test("starts of one turn that are not answered yet already hold their slots", () => {
	const call = fixture(() => 0);
	const pending = Array.from({ length: 5 }, () => call(analysis));
	assert.deepEqual(pending.map((p) => p.args.model), Array(5).fill(SOL));
	assert.equal(call(analysis).args.model, OPUS);
	// A start that fails gives its hold back.
	call.end(pending[0].toolCallId, "boom", {}, true);
	assert.equal(call(analysis).args.model, SOL);
});

test("a blocked start holds nothing", () => {
	const call = fullPair();
	for (let i = 0; i < 3; i++) assert.equal(call(analysis).result.block, true);
	call.delivered("agent#1");
	assert.equal(call(analysis).result, undefined);
});

test("a slot is freed when the agent's final result is delivered, failure included", () => {
	const call = fullPair();
	call.delivered("agent#2");
	assert.equal(call.started(analysis), SOL);
	assert.equal(call(analysis).result.block, true);
	call.delivered("agent#7");
	assert.equal(call.started(analysis), OPUS);
});

test("a slot is freed when the agent is stopped, also after its final was delivered", () => {
	const call = fullPair();
	const stop = call({ action: "stop", id: "agent#7" });
	assert.equal(stop.result, undefined);
	call.end(stop.toolCallId, "agent#7 stopped");
	assert.equal(call.started(analysis), OPUS);
	call.delivered("agent#3");
	const again = call({ action: "stop", id: "agent#3" });
	call.end(again.toolCallId, "agent#3 stopped");
	const send = call({ action: "send", id: "agent#3", task: "more" });
	call.end(send.toolCallId, "agent#3: sent");
	assert.equal(call.started(analysis), SOL, "a stopped agent is gone and a send does not bring it back");
	assert.equal(call(analysis).result.block, true);
});

test("a reviewer start counts on its fixed model and is refused when that model is full", () => {
	const call = fixture(() => 0);
	const spotty = { action: "start", agent_type: "spotty", model: TERRA, thinking: "high", task: "synthetic" };
	for (let i = 0; i < 10; i++) call.started(spotty);
	const { result } = call(spotty);
	assert.equal(result.block, true);
	assert.match(result.reason, /slots full: openai-codex\/gpt-6\.1-terra 10\/10/);
	// The reviewers took the Terra slots of the executor pair.
	assert.equal(call.started({ action: "start", model: "mechanical", task: "synthetic" }), SONNET);
});

test("a fork start counts on the caller's model and is refused when it is full", () => {
	const call = fixture(() => 0, { provider: "openai-codex", id: "gpt-6.1-sol" });
	const fork = { action: "start", fork_turns: "all", task: "synthetic" };
	for (let i = 0; i < 5; i++) call.started(fork);
	const { result, args } = call(fork);
	assert.equal(result.block, true);
	assert.match(result.reason, /slots full: openai-codex\/gpt-6\.1-sol 5\/5/);
	assert.equal(args.model, undefined);
	assert.equal(call.started(analysis), OPUS);
});

test("restart and send keep the agent's slot and are never refused for it", () => {
	const call = fullPair();
	const restart = call({ action: "restart", id: "agent#1", model: "analysis", task: "again" });
	assert.equal(restart.result, undefined);
	assert.equal(restart.args.model, SOL);
	call.end(restart.toolCallId, "agent#1 restarted");
	const send = call({ action: "send", id: "agent#4", task: "more" });
	assert.equal(send.result, undefined);
	call.end(send.toolCallId, "agent#4: queued after the current tool call");
	assert.equal(call(analysis).result.block, true, "neither took a second slot");
});

test("a send to an agent whose final was delivered takes its slot again", () => {
	const call = fullPair();
	call.delivered("agent#1");
	const send = call({ action: "send", id: "agent#1", task: "more" });
	assert.equal(send.result, undefined);
	call.end(send.toolCallId, "agent#1: sent");
	assert.equal(call(analysis).result.block, true);
});

test("a send to an ended agent is refused when its model filled up meanwhile", () => {
	const call = fullPair();
	call.delivered("agent#1");
	assert.equal(call.started(analysis), SOL);
	const send = call({ action: "send", id: "agent#1", task: "more" });
	assert.equal(send.result.block, true);
	assert.match(send.result.reason, /slots full: openai-codex\/gpt-6\.1-sol 5\/5/);
});

test("a restart on another model holds that model's slot until it ends", () => {
	let pick = 0;
	const call = fixture((max) => Math.min(pick, max - 1));
	for (let i = 0; i < 5; i++) assert.equal(call.started(analysis), SOL);
	pick = 1;
	for (let i = 0; i < 4; i++) assert.equal(call.started(analysis), OPUS);
	const restart = call({ action: "restart", id: "agent#1", model: "analysis", task: "again" });
	assert.equal(restart.args.model, OPUS);
	assert.equal(call(analysis).result.block, true, "the last Opus slot is held by the restart");
	call.end(restart.toolCallId, "agent#1 restarted");
	assert.equal(call.started(analysis), SOL, "Sol has a free slot again, Opus has none");
});

test("a failed restart keeps the slot and a stop, even a failed one, frees it", () => {
	const call = fullPair();
	call.end(call({ action: "restart", id: "agent#1", model: "analysis", task: "again" }).toolCallId, "boom", {}, true);
	assert.equal(call(analysis).result.block, true);
	call.end(call({ action: "stop", id: "agent#1" }).toolCallId, "unknown agent", {}, true);
	assert.equal(call.started(analysis), SOL);
});

test("a send that made its agent live is not counted twice, and a stop cancels sends in flight", () => {
	const call = fullPair();
	call.delivered("agent#1", "agent#2");
	const first = call({ action: "send", id: "agent#1", task: "a" });
	call({ action: "send", id: "agent#1", task: "b" });
	call.end(first.toolCallId, "agent#1: sent");
	assert.equal(call.started(analysis), SOL, "one Sol slot is free: the live agent and the pending send are one slot");
	assert.equal(call(analysis).result.block, true);
	call.end(call({ action: "stop", id: "agent#1" }).toolCallId, "agent#1 stopped");
	assert.equal(call.started(analysis), SOL, "the stop freed the slot, the pending send does not hold it");
});

test("a late send result does not change the model of an agent restarted meanwhile", () => {
	let pick = 0;
	const call = fixture((max) => Math.min(pick, max - 1));
	call.started(analysis);
	call.delivered("agent#1");
	const send = call({ action: "send", id: "agent#1", task: "a" });
	pick = 1;
	const restart = call({ action: "restart", id: "agent#1", model: "analysis", task: "again" });
	assert.equal(restart.args.model, OPUS);
	call.end(restart.toolCallId, "agent#1 restarted");
	call.end(send.toolCallId, "agent#1: sent");
	// Opus holds the restarted agent and four more: its limit of five is reached.
	for (let i = 0; i < 4; i++) assert.equal(call.started(analysis), OPUS);
	assert.equal(call.started(analysis), SOL, "Opus is full, so the draw falls to Sol");
});

test("a send still in flight when its agent is stopped does not bring the agent back", () => {
	const call = fullPair();
	call.delivered("agent#1");
	const send = call({ action: "send", id: "agent#1", task: "a" });
	call.end(call({ action: "stop", id: "agent#1" }).toolCallId, "agent#1 stopped");
	call.end(send.toolCallId, "agent#1: sent");
	assert.equal(call.started(analysis), SOL);
	assert.equal(call(analysis).result.block, true);
});

test("concurrent sends to one ended agent share one slot", () => {
	const call = fullPair();
	call.delivered("agent#1");
	assert.equal(call({ action: "send", id: "agent#1", task: "a" }).result, undefined);
	assert.equal(call({ action: "send", id: "agent#1", task: "b" }).result, undefined);
	assert.equal(call(analysis).result.block, true);
});

test("the slot limits of PROCESS.md are in the rules block", () => {
	const loaded = loadRules(`${root}PROCESS.md`);
	assert.equal(loaded.ok, true);
	assert.deepEqual(loaded.ok && loaded.rules.slots, { [SOL]: 5, [OPUS]: 5, [TERRA]: 10, [SONNET]: 10 });
});

test("a bad slots entry is a rules error", () => {
	const block = (slots: string) => '```json coordinator-rules\n{"agentModels":{"a":[["p/m","low"]]},"slots":' + slots + "}\n```";
	assert.deepEqual(parseRules(block('{"p/m":2}')).slots, { "p/m": 2 });
	for (const bad of ['{"p/m":0}', '{"p/m":1.5}', '{"m":1}', "[]"]) assert.throws(() => parseRules(block(bad)), /slots/);
});

test("the prompt says Main performs no action itself and works only with tasks, BACKLOG.md, context and subagents", () => {
	const section = promptSection(loadRules(`${root}PROCESS.md`), "PROCESS.md");
	assert.ok(section.includes("Main performs no action itself."));
	assert.ok(section.includes("running commands, opening files for the owner and every other action go to a subagent"));
	assert.ok(section.includes("Main works only with tasks, BACKLOG.md, its context and subagents."));
});
