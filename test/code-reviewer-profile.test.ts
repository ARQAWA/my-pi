import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ProfileCatalogue } from "../extensions/RQW-agent/profiles.ts";

test("project code reviewer is discovered with its native model and bounded read-only role", async () => {
	const root = join(import.meta.dirname, "..");
	const catalogue = new ProfileCatalogue();
	await catalogue.refresh({ cwd: root, agentDir: join(root, "test/no-agent-home"),
		codexHome: join(root, "test/no-codex-home"), extensionPaths: [] });
	const profile = catalogue.get("code-reviewer");
	assert.ok(profile);
	assert.equal(profile.error, undefined);
	assert.equal(profile.path, join(root, ".pi/agents/code-reviewer.toml"));
	assert.equal(profile.model, "gpt-6.1-sol");
	assert.equal(profile.model_reasoning_effort, "low");
	assert.match(profile.developer_instructions!, /Carefully check every line/);
	assert.match(profile.developer_instructions!, /never report an out-of-scope defect/);
	assert.match(profile.developer_instructions!, /Do not edit files, change state, run programs or tests, or spawn agents/);
	assert.match(profile.developer_instructions!, /On rechecks, inspect fixes and affected dependencies only/);
	assert.match(profile.developer_instructions!, /If none qualify, return CLEAN/);
	const process = await fs.readFile(join(root, "PROCESS.md"), "utf8");
	assert.match(process, /agent_type: "code-reviewer"/);
	assert.doesNotMatch(process, /\.agents\/reviewers\/code\.md/);
	await assert.rejects(fs.access(join(root, ".agents/reviewers/code.md")), { code: "ENOENT" });
});
