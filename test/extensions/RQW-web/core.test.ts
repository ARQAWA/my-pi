import assert from "node:assert/strict";
import { it } from "node:test";
import { mapCaller } from "../../../extensions/RQW-web/core/model-map.ts";

const LEVELS = ["low", "medium", "high", "xhigh", "max", "ultra"];

const MATRIX: Record<string, { model: string; efforts: string[] }> = {
	"anthropic/claude-opus-5-5": { model: "gpt-6.1-sol", efforts: ["low", "medium", "high", "high", "high", "high"] },
	"anthropic/claude-sonnet-5-5": { model: "gpt-6.1-terra", efforts: ["low", "medium", "high", "xhigh", "xhigh", "xhigh"] },
	"anthropic/claude-haiku-5-5": { model: "gpt-5.6-luna", efforts: ["low", "medium", "high", "xhigh", "xhigh", "xhigh"] },
};

for (const [caller, { model, efforts }] of Object.entries(MATRIX)) {
	for (const [index, thinking] of LEVELS.entries()) {
		it(`maps ${caller} ${thinking} to ${model} ${efforts[index]}`, () => {
			assert.deepEqual(mapCaller(caller, thinking), { model, effort: efforts[index] });
		});
	}

	for (const thinking of ["off", "minimal"]) {
		it(`rejects ${caller} ${thinking}`, () => {
			assert.throws(() => mapCaller(caller, thinking), /no search mapping/);
		});
	}
}

it("passes a GPT caller through as is, including gpt-6.1-terra", () => {
	assert.deepEqual(mapCaller("openai-codex/gpt-6.1-terra", "high"), { model: "gpt-6.1-terra", effort: "high" });
});

it("sends Pi off as native none to a GPT caller that supports none", () => {
	assert.deepEqual(mapCaller("openai-codex/gpt-6.1-terra", "off"), { model: "gpt-6.1-terra", effort: "none" });
});

it("uses the fixed fallback for an unknown caller", () => {
	assert.deepEqual(mapCaller("unknown/model", "high"), { model: "gpt-6.1-sol", effort: "low" });
});
