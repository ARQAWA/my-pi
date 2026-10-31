import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { parse } from "smol-toml";
import reviewProfiles from "../../../extensions/RQW-review/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../extensions/RQW-review");

it("offers native profiles and skills without registering a runner", () => {
	const channels = new Map<string, (payload: any) => void>();
	const handlers = new Map<string, () => { skillPaths: string[] }>();
	reviewProfiles({
		events: { on: (name: string, handler: any) => { channels.set(name, handler); return () => channels.delete(name); } },
		on: (name: string, handler: any) => handlers.set(name, handler),
	} as never);
	let paths: string[] = [];
	channels.get("rqw-agent:profiles")!({ offer: (offered: string[]) => { paths = offered; } });
	assert.deepEqual(paths, ["spotty", "bossy"].map((name) => join(ROOT, "profiles", `${name}.toml`)));
	assert.ok(paths.every(isAbsolute));
	assert.deepEqual(handlers.get("resources_discover")!().skillPaths,
		["reviewer", "blindreview", "highreview"].map((name) => join(ROOT, "skills", name, "SKILL.md")));
});

it("pins the native reviewer models and efforts", () => {
	const profiles = ["spotty", "bossy"].map((name) =>
		parse(readFileSync(join(ROOT, "profiles", `${name}.toml`), "utf8")));
	assert.deepEqual(profiles.map((profile) => [profile.name, profile.model, profile.model_reasoning_effort]), [
		["spotty", "gpt-6.1-terra", "medium"],
		["bossy", "gpt-6.1-terra", "xhigh"],
	]);
});

it("keeps the canonical severity gate byte-identical in both profiles", () => {
	const role = readFileSync(join(ROOT, "REVIEWER.md"), "utf8").replace(/\r\n/g, "\n");
	for (const name of ["spotty", "bossy"]) {
		const profile = parse(readFileSync(join(ROOT, "profiles", `${name}.toml`), "utf8"));
		assert.equal(profile.developer_instructions, role);
	}
	for (const fragment of [
		"Matching quotes alone do not admit a finding",
		"Grade doc and record gaps by their real impact too",
		"a gap that makes the ordered result wrong or breaks an owner decision is P0-P2",
		"Any risk to data, security or a destructive action is at least P2",
		"Report P3 findings only together with at least one admitted P0-P2 finding",
		"If only P3 remain, return CLEAN without reporting or mentioning them",
		"SEVERITY:", "TRIGGER:", "RESULT_IF_UNFIXED:",
	]) assert.ok(role.includes(fragment), fragment);
});

it("allows required review launches without authorizing unsolicited ones", () => {
	const skill = readFileSync(join(ROOT, "skills", "reviewer", "SKILL.md"), "utf8");
	assert.ok(skill.includes("Launch a reviewer when the user, the caller's brief, an invoked skill or applicable project instructions require it."));
	assert.ok(skill.includes("Without such a request or requirement, never launch one on your own initiative or as an automatic step of other work."));
});
