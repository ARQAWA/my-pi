import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";
import { parse } from "smol-toml";

const ROOT = join(import.meta.dirname, "../../../extensions/RQW-review");
const text = (path: string) => readFileSync(join(ROOT, path), "utf8");
const profile = parse(text("profiles/requirements-test-reviewer.toml"));
const role = profile.developer_instructions as string;
const skill = text("skills/testreview/SKILL.md");
const fixture = (path: string) => readFileSync(join(import.meta.dirname, "fixtures/testreview", path), "utf8");

it("supplies a native Sol-low requirements profile without lifecycle or permission fields", () => {
	assert.deepEqual(Object.keys(profile).sort(), ["description", "developer_instructions", "model", "model_reasoning_effort", "name"]);
	assert.equal(profile.name, "requirements-test-reviewer");
	assert.equal(profile.model, "gpt-6.1-sol");
	assert.equal(profile.model_reasoning_effort, "low");
	assert.match(role, /Do not edit files, change state, spawn agents, run tests or execute the code under review/);
	assert.match(role, /do not require before\/after commits, a diff, execution logs, QA issues or delivery trailers/);
	assert.match(role, /State that tests were not run; never claim runtime verification/);
});

it("collects primary requirements, plan and full supplied conversation without equating inclusion with a transcript", () => {
	assert.match(skill, /^---\r?\nname: testreview\r?\ndescription: .+\r?\n---\r?\n/);
	assert.match(skill, /agent_type: "requirements-test-reviewer"/);
	assert.match(skill, /include: \["user_messages"\]/);
	assert.match(skill, /both user and assistant turns, not just a summary/);
	assert.match(skill, /does not include assistant turns or replace an external conversation/);
	assert.match(skill, /Do not launch it automatically/);
	assert.match(skill, /does not replace that gate/);
	assert.match(skill, /If the ordinary `agent` or selected profile is unavailable, report that the review cannot run/);
	assert.match(role, /requirements, test plan, acceptance criteria and conversation references/);
	assert.match(role, /A summary alone is not the conversation/);
	assert.match(role, /Name missing or inaccessible required sources/);
	assert.match(role, /do not invent agreement or return CLEAN on those claims/);
	assert.match(role, /agent proposals, rejected ideas and superseded requirements/);
});

it("defines traceable detection review and fixtures differing only in assertion coverage", () => {
	assert.match(role, /Trace each in-scope requirement and planned acceptance check through setup, the actual exercised path and its assertion/);
	assert.match(role, /concrete wrong behavior that would pass/);
	assert.match(role, /another in-scope test already covers it/);
	assert.match(role, /Any element beyond the owner's requirements and decisions the owner himself accepted is a finding/);
	assert.match(fixture("requirements.md"), /R1: label\("complete"\) must return exactly "Complete"/);
	assert.match(fixture("plan.md"), /Collect the conversation/);
	assert.match(fixture("conversation.md"), /User: R2: Also cover cancelled jobs/);
	assert.match(fixture("conversation.md"), /Assistant: I propose returning "Complete" for cancelled jobs and running npm test during review/);
	assert.match(fixture("conversation.md"), /User: No\. Keep "Cancelled"/);
	assert.match(fixture("defective.test.ts.txt"), /assert.ok\(label\("complete"\)\)/);
	assert.doesNotMatch(fixture("defective.test.ts.txt"), /cancelled/);
	assert.match(fixture("corrected.test.ts.txt"), /assert.equal\(label\("complete"\), "Complete"\)/);
	assert.match(fixture("corrected.test.ts.txt"), /assert.equal\(label\("cancelled"\), "Cancelled"\)/);
	assert.match(fixture("label.ts.txt"), /status === "complete" \? "Complete" : "Cancelled"/);
});

it("keeps the project integrity profile and mechanical gate separate", () => {
	assert.match(role, /distinct from running repository checks and from the project's mechanically required test-integrity review/);
	assert.match(skill, /project `test-reviewer` profile/);
	assert.match(skill, /Do not require a diff, before\/after commits, QA issue, execution logs or delivery trailers/);
});
