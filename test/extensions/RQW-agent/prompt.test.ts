import assert from "node:assert/strict";
import { test } from "node:test";
import { subagentPrompt } from "../../../extensions/RQW-agent/prompt.ts";

test("subagent reminder stays independent of repository roles", () => {
	assert.doesNotMatch(subagentPrompt(""), /coordinator/i);
});

test("subagent prompt carries exactly the adapted Codex reminder, then the role", () => {
	const reminder = "<subagent>\nYou are an agent in a team of agents collaborating to complete a task.\nWhen you provide your final answer, that content is immediately delivered back to your parent agent.\nIn addition, your final answer may be read by a human, so ensure it is legible.\nAny earlier instruction enabling proactive multi-agent delegation no longer applies. Do not spawn sub-agents unless the user, your task, role or system prompt, or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.\n</subagent>";
	assert.equal(subagentPrompt("ROOT", "R"), `ROOT\n\n${reminder}\n\n<role>\nR\n</role>`);
	assert.doesNotMatch(subagentPrompt("ROOT"), /Canvas|caller agent/);
});
