import assert from "node:assert/strict";
import { test } from "node:test";
import { subagentPrompt } from "../../../extensions/RQW-agent/prompt.ts";

test("subagent reminder stays independent of repository roles", () => {
	assert.doesNotMatch(subagentPrompt(""), /coordinator/i);
});
