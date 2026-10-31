import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { parse } from "smol-toml";
import { ProfileCatalogue } from "../extensions/RQW-agent/profiles.ts";
import { reviewCounts } from "../extensions/RQW-agent-ui/review.ts";

test("review cards count mixed-severity findings with the added protocol fields", () => {
	const findings = ["P2", "P3"].map((severity, index) => [
		`FINDING ${index + 1}`,
		`SEVERITY: ${severity}`,
		"TRIGGER: A guarded command is submitted.",
		"RESULT_IF_UNFIXED: The command is refused incorrectly.",
		"REQUIREMENT: Allowed commands remain usable. (request)",
		"MISMATCH: The guard rejects the allowed command.",
		'EVIDENCE: "return refused;" (guard.ts)',
		"REQUIRED OUTCOME: The allowed command succeeds.",
	].join("\n"));
	const verdict = ["FINDINGS:", ...findings, "CHECKED: guard.ts",
		"UNCHECKED:", "- external specification - unavailable"].join("\n");
	assert.deepEqual(reviewCounts(verdict), { findings: 2, unchecked: 1 });
});

test("project reviewer profiles use Terra high and the required review contracts", async () => {
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
			"Inspect the whole scope before you answer; do not stop at the first finding.",
			"return all remaining findings in one pass",
			"On a re-review, check every earlier finding against its fix up to that final state, then every changed line and its affected callers",
		],
		"requirements-test-reviewer": [
			"Check whether its checks actually verify the owner's requirements, test plan and acceptance criteria",
			"Do not edit files, change state, spawn agents, run tests or execute the code under review.",
			"Current code and conversation are sufficient inputs",
			"Any element beyond the owner's requirements and decisions the owner himself accepted is a finding.",
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
			"return all remaining findings in one pass",
			"On a re-review, check every earlier finding against its fix, then every changed line",
		],
	};
	for (const [name, required] of Object.entries(fragments)) {
		const profile = parse(readFileSync(new URL(`../.pi/agents/${name}.toml`, import.meta.url), "utf8"));
		assert.equal(profile.name, name);
		assert.equal(profile.model, "gpt-6.1-terra");
		assert.equal(profile.model_reasoning_effort, "high");
		assert.equal(typeof profile.developer_instructions, "string");
		for (const fragment of required) {
			assert.ok((profile.developer_instructions as string).includes(fragment), `${name}: ${fragment}`);
		}
	}
	const root = fileURLToPath(new URL("..", import.meta.url));
	const agentDir = await mkdtemp(join(tmpdir(), "my-pi-review-discovery-"));
	try {
		const profiles = await new ProfileCatalogue().refresh({ cwd: root, agentDir, codexHome: agentDir, extensionPaths: [] });
		const profile = profiles.find(item => item.name === "requirements-test-reviewer");
		assert.equal(profile?.path, join(root, ".pi", "agents", "requirements-test-reviewer.toml"));
		const skills = loadSkills({ cwd: root, agentDir, skillPaths: [], includeDefaults: true }).skills;
		const skill = skills.find(item => item.name === "testreview");
		assert.equal(skill?.filePath, join(root, ".pi", "skills", "testreview", "SKILL.md"));
		const text = readFileSync(skill!.filePath, "utf8");
		assert.ok(text.includes('agent_type: "requirements-test-reviewer"'));
		assert.ok(text.includes("openai-codex/gpt-6.1-terra"));
		assert.ok(!text.includes("role_file"));
	} finally {
		await rm(agentDir, { recursive: true, force: true });
	}
});
