import assert from "node:assert/strict";
import { it } from "node:test";
import { mapCaller } from "../../../extensions/RQW-web/core/model-map.ts";

it("maps a known caller and uses the fixed fallback for an unknown caller", () => {
	assert.deepEqual(mapCaller("anthropic/claude-sonnet-5-5", "high"), { model: "gpt-6-sol", effort: "high" });
	assert.deepEqual(mapCaller("unknown/model", "high"), { model: "gpt-6.1-sol", effort: "low" });
});
