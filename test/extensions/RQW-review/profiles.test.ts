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
	assert.deepEqual(paths, ["spotty", "bossy", "requirements-test-reviewer"].map((name) => join(ROOT, "profiles", `${name}.toml`)));
	assert.ok(paths.every(isAbsolute));
	assert.deepEqual(handlers.get("resources_discover")!().skillPaths,
		["reviewer", "blindreview", "highreview", "testreview"].map((name) => join(ROOT, "skills", name, "SKILL.md")));
});

it("pins the native reviewer models and efforts", () => {
	const profiles = ["spotty", "bossy", "requirements-test-reviewer"].map((name) =>
		parse(readFileSync(join(ROOT, "profiles", `${name}.toml`), "utf8")));
	assert.deepEqual(profiles.map((profile) => [profile.name, profile.model, profile.model_reasoning_effort]), [
		["spotty", "gpt-6.1-terra", "low"],
		["bossy", "gpt-6.1-terra", "medium"],
		["requirements-test-reviewer", "gpt-6.1-sol", "low"],
	]);
});
