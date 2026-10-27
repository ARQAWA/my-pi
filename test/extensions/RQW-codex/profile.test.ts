import assert from "node:assert/strict";
import test from "node:test";
import { codexModelCapabilities } from "../../../extensions/RQW-codex/profile.ts";

test("regression: Terra lookup exposes its context window and reasoning efforts", () => {
	const capabilities = codexModelCapabilities("gpt-6.1-terra");
	assert.equal(capabilities.contextWindow, 1_050_000);
	assert.deepEqual(capabilities.supportedReasoningLevels, ["none", "low", "medium", "high", "xhigh", "max"]);
});
