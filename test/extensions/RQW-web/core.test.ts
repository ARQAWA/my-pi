import assert from "node:assert/strict";
import { it } from "node:test";
import { mapCaller } from "../../../extensions/RQW-web/core/model-map.ts";

it("maps a known caller and uses the fixed fallback for an unknown caller", () => {
	assert.deepEqual(mapCaller("anthropic/claude-sonnet-5-5", "high"), { model: "gpt-6-sol", effort: "high" });
	assert.deepEqual(mapCaller("unknown/model", "high"), { model: "gpt-6.1-sol", effort: "low" });
});

// Regression: cf09b60 mapped every Kimi caller, including future model IDs.
it("maps every supported Kimi effort to Sol 6.1", () => {
	for (const [thinking, effort] of [["low", "low"], ["high", "medium"], ["max", "high"]]) {
		assert.deepEqual(mapCaller("kimi-coding/future-model", thinking), { model: "gpt-6.1-sol", effort });
	}
});
