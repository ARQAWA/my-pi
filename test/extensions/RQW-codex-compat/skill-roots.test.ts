import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { it } from "node:test";
import { fakePi, linkedWorktree, trust, world } from "./fixture.ts";

async function roots(w: ReturnType<typeof world>, cwd = w.cwd) {
	const pi = fakePi({ env: w.env });
	const result = await pi.fire("resources_discover", { type: "resources_discover", cwd, reason: "startup" }) as { skillPaths?: string[] } | undefined;
	return result?.skillPaths ?? [];
}

it("offers personal, system, admin and trusted project roots in Codex order", async (t) => {
	const w = world(t);
	w.skill("codex/skills/user-skill", "user-skill");
	w.skill("codex/skills/.system/sys", "sys");
	w.skill("home/.agents/skills/personal", "personal");
	w.skill("etc-codex/skills/admin", "admin");
	w.skill("project/.agents/skills/root-agents", "root-agents");
	w.skill("project/pkg/.agents/skills/cwd-agents", "cwd-agents");
	w.skill("project/.codex/skills/root-codex", "root-codex");
	w.skill("project/pkg/.codex/skills/cwd-codex", "cwd-codex");
	w.put("codex/config.toml", trust(w.root, "trusted"));
	assert.deepEqual(await roots(w), [
		w.path("project/pkg/.codex/skills"), w.path("project/.codex/skills"),
		w.path("codex/skills"), w.path("home/.agents/skills"), w.path("codex/skills/.system"),
		w.path("etc-codex/skills"),
		w.path("project/.agents/skills"), w.path("project/pkg/.agents/skills"),
	]);
});

it("skips .codex project skills unless the project is trusted, keeps .agents skills", async (t) => {
	const w = world(t);
	w.skill("project/.codex/skills/a", "a");
	w.skill("project/.agents/skills/b", "b");
	assert.deepEqual(await roots(w), [w.path("project/.agents/skills")]);
	w.put("codex/config.toml", trust(w.root, "untrusted"));
	assert.deepEqual(await roots(w), [w.path("project/.agents/skills")]);
	w.put("codex/config.toml", trust(w.root, "trusted"));
	assert.deepEqual(await roots(w), [w.path("project/.codex/skills"), w.path("project/.agents/skills")]);
	// A trusted subdirectory does not trust the project layer above it.
	w.skill("project/pkg/.codex/skills/c", "c");
	w.put("codex/config.toml", trust(w.cwd, "trusted"));
	assert.deepEqual(await roots(w), [w.path("project/pkg/.codex/skills"), w.path("project/.agents/skills")]);
});

it("project_root_markers bound the project layers; no marker leaves only cwd", async (t) => {
	const w = world(t);
	w.skill("project/.agents/skills/root", "root");
	w.skill("project/pkg/.agents/skills/leaf", "leaf");
	w.put("codex/config.toml", "project_root_markers = []\n");
	assert.deepEqual(await roots(w), [w.path("project/pkg/.agents/skills")]);
	w.put("codex/config.toml", 'project_root_markers = ["pkg.marker"]\n');
	w.put("project/pkg/pkg.marker");
	assert.deepEqual(await roots(w), [w.path("project/pkg/.agents/skills")]);
	w.put("codex/config.toml", 'project_root_markers = ["missing.marker"]\n');
	assert.deepEqual(await roots(w), [w.path("project/pkg/.agents/skills")]);
});

it("offers nothing when no Codex folder exists", async (t) => {
	assert.deepEqual(await roots(world(t)), []);
});

it("administrative and managed Codex config is not supported: trust comes from the user config only", async (t) => {
	const w = world(t);
	w.skill("project/.codex/skills/a", "a");
	w.put("etc-codex/config.toml", trust(w.root, "trusted"));
	w.put("etc-codex/managed_config.toml", trust(w.root, "trusted"));
	assert.deepEqual(await roots(w), []);
	w.put("codex/config.toml", trust(w.root, "trusted"));
	assert.deepEqual(await roots(w), [w.path("project/.codex/skills")]);
});

it("any existing marker is a root, a .git directory without HEAD included", async (t) => {
	const w = world(t);
	w.put("other/.git/config");
	w.put("other/pkg/keep");
	w.skill("other/.agents/skills/a", "a");
	assert.deepEqual(await roots(w, w.path("other/pkg")), [w.path("other/.agents/skills")]);
});

it("a linked worktree takes trust from its main checkout, also with a separate git directory", async (t) => {
	for (const separate of [false, true]) {
		const w = world(t);
		const link = linkedWorktree(w, separate);
		w.skill("wt/.codex/skills/a", "a");
		assert.deepEqual(await roots(w, link.wt), [], "no trust yet");
		w.put("codex/config.toml", trust(link.main, "trusted"));
		assert.deepEqual(await roots(w, link.wt), [w.path("wt/.codex/skills")], `separate=${separate}`);
	}
});

it("a worktree link with incomplete or inconsistent metadata gets no trust", async (t) => {
	const w = world(t);
	const link = linkedWorktree(w);
	w.skill("wt/.codex/skills/a", "a");
	w.put("codex/config.toml", trust(link.main, "trusted"));
	assert.equal((await roots(w, link.wt)).length, 1);
	for (const name of ["gitdir", "commondir"]) {
		for (const text of [undefined, "", "x".repeat(65_537)]) {
			const file = `${link.admin}/${name}`;
			const saved = readFileSync(file, "utf8");
			if (text === undefined) rmSync(file); else writeFileSync(file, text);
			assert.deepEqual(await roots(w, link.wt), [], `${name} ${text?.length}`);
			writeFileSync(file, saved);
		}
	}
	// The administrative gitdir points at another checkout, or the common dir link leads elsewhere.
	writeFileSync(`${link.admin}/gitdir`, `${w.path("elsewhere/.git")}\n`);
	assert.deepEqual(await roots(w, link.wt), []);
	writeFileSync(`${link.admin}/gitdir`, `${w.path("wt/.git")}\n`);
	writeFileSync(`${link.admin}/commondir`, "../../..\n");
	assert.deepEqual(await roots(w, link.wt), []);
});

it("project .codex layers skip a .git directory without HEAD, .agents/skills roots accept it", async (t) => {
	const w = world(t);
	w.put("other/.git/config");
	w.put("other/pkg/keep");
	w.skill("other/.codex/skills/c", "c");
	w.skill("other/.agents/skills/a", "a");
	w.put("codex/config.toml", trust(w.path("other"), "trusted"));
	assert.deepEqual(await roots(w, w.path("other/pkg")), [w.path("other/.agents/skills")]);
	// With HEAD the same directory is the layer root and its trusted .codex layer counts.
	w.put("other/.git/HEAD", "ref: refs/heads/main\n");
	assert.deepEqual(await roots(w, w.path("other/pkg")), [w.path("other/.codex/skills"), w.path("other/.agents/skills")]);
});
