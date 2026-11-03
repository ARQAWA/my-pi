import assert from "node:assert/strict";
import { it } from "node:test";
import { mapCaller } from "../../../extensions/RQW-web/core/model-map.ts";

const LEVELS = ["off", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const STEP_UP = ["medium", "medium", "medium", "medium", "high", "xhigh", "xhigh", "xhigh", "xhigh"];
const TERRA = ["medium", "medium", "medium", "medium", "medium", "high", "xhigh", "xhigh", "xhigh"];
const LUNA = ["low", "low", "low", "low", "medium", "high", "xhigh", "xhigh", "xhigh"];

const MATRIX: Record<string, { model: string; efforts: string[] }> = {
	"openai-codex/gpt-6.1-sol": { model: "gpt-6.1-terra", efforts: STEP_UP },
	"openai-codex/gpt-6-sol": { model: "gpt-6.1-terra", efforts: STEP_UP },
	"anthropic/claude-opus-5-5": { model: "gpt-6.1-terra", efforts: STEP_UP },
	"openai-codex/gpt-6.1-terra": { model: "gpt-6.1-terra", efforts: TERRA },
	"anthropic/claude-sonnet-5-5": { model: "gpt-6.1-terra", efforts: TERRA },
	"openai-codex/gpt-6-luna": { model: "gpt-6-luna", efforts: LUNA },
	"openai-codex/gpt-5.6-luna": { model: "gpt-5.6-luna", efforts: LUNA },
	"anthropic/claude-haiku-5-5": { model: "gpt-5.6-luna", efforts: LUNA },
};

for (const [caller, { model, efforts }] of Object.entries(MATRIX)) {
	for (const [index, thinking] of LEVELS.entries()) {
		it(`maps ${caller} ${thinking} to ${model} ${efforts[index]}`, () => {
			assert.deepEqual(mapCaller(caller, thinking), { model, effort: efforts[index] });
		});
	}
}

it("uses Terra medium for unknown or missing callers regardless of effort", () => {
	for (const caller of ["", "unknown/model", "openai-codex/unknown", "anthropic/unknown", "other/gpt-6.1-sol"]) {
		for (const effort of LEVELS) {
			assert.deepEqual(mapCaller(caller, effort), { model: "gpt-6.1-terra", effort: "medium" });
		}
	}
});
