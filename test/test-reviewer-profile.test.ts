import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { ProfileCatalogue } from "../extensions/RQW-agent/profiles.ts";

test("project test-reviewer is discoverable with its native model and effort", async () => {
	const home = await mkdtemp(join(tmpdir(), "test-reviewer-profile-"));
	try {
		const catalogue = new ProfileCatalogue();
		await catalogue.refresh({ cwd: resolve(import.meta.dirname, ".."), agentDir: join(home, "pi"),
			codexHome: join(home, "codex"), extensionPaths: [] });
		const profile = catalogue.get("test-reviewer");
		assert.ok(profile);
		assert.equal(profile.error, undefined);
		assert.equal(profile.path, resolve(import.meta.dirname, "../.pi/agents/test-reviewer.toml"));
		assert.equal(profile.model, "gpt-6.1-sol");
		assert.equal(profile.model_reasoning_effort, "low");
		assert.ok(profile.developer_instructions?.includes("Review every line of that scope carefully"));
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
