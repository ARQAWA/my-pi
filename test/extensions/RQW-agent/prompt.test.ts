import assert from "node:assert/strict";
import { test } from "node:test";
import { subagentPrompt } from "../../../extensions/RQW-agent/prompt.ts";

test("subagent reminder stays independent of repository roles", () => {
	assert.doesNotMatch(subagentPrompt(""), /coordinator/i);
});

test("subagent prompt carries exactly the Cursor reminder, then the role", () => {
	const reminder = "<subagent>\nYou are running as a subagent under a parent agent. Do not spawn additional subagents unless requested by the user or by your instructions.\n</subagent>";
	assert.equal(subagentPrompt("ROOT", "R"), `ROOT\n\n${reminder}\n\n<role>\nR\n</role>`);
	assert.doesNotMatch(subagentPrompt("ROOT"), /Canvas|caller agent/);
});
