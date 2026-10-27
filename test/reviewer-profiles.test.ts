import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "smol-toml";

test("project reviewer profiles retain Sol low and the required review contracts", () => {
	const fragments = {
		"code-reviewer": [
			"a concrete reachable trigger, input, state, or ordering",
			"Try to falsify the candidate through guards, callers, framework semantics, tests, and surrounding error handling.",
			"Do not duplicate findings already produced by a configured mechanical checker.",
			"flag structure only with concrete maintenance impact",
			"Keep each extension self-contained and independently disableable; do not import across extension folders.",
			"Use public Pi APIs unless an accepted decision explicitly permits a private seam.",
			"CHECKED: <one or two sentences naming the scoped files, critical paths traced, and applicable project principles checked>",
			"CLEAN with material UNCHECKED evidence is incomplete.",
		],
		"test-reviewer": [
			"Trace requirement -> setup -> public production function -> returned result -> assertion.",
			"one happy-path test per new feature plus only its critical branches; one regression test per real fixed bug",
			"Require an independent oracle from the requirement",
			"Assert only returned results, never internal calls, state, or call order.",
			"Fakes are allowed only for network, model, clock, and Pi; never mock our modules.",
			"No sleeps, real timers, randomness, order dependence, end-to-end, or integration tests.",
			"Byte-exact comparison is allowed only for a required static fragment, never dynamic or whole-file output.",
			"A test costs milliseconds; an extension suite costs about one second.",
			"Check that assertions are reachable and awaited, failures propagate",
			"Give the distinguishing input and observable wrong result.",
			"an equivalent or internal-only mutation is not a finding",
			"Do not claim that you executed a mutation.",
			"For a weakening review, each of these forbidden changes is a finding",
			"Do not require CI history, commit trailers or a separate integrity gate.",
			"Check that each in-scope test or workflow change is needed by the issue or stated reason",
		],
	};
	for (const [name, required] of Object.entries(fragments)) {
		const profile = parse(readFileSync(new URL(`../.pi/agents/${name}.toml`, import.meta.url), "utf8"));
		assert.equal(profile.name, name);
		assert.equal(profile.model, "gpt-6.1-sol");
		assert.equal(profile.model_reasoning_effort, "low");
		assert.equal(typeof profile.developer_instructions, "string");
		for (const fragment of required) {
			assert.ok((profile.developer_instructions as string).includes(fragment), `${name}: ${fragment}`);
		}
	}
});
