import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { runtime, world } from "./fixture.ts";

const role = (name: string, description: string, extra = "") =>
	`name = "${name}"\ndescription = "${description}"\ndeveloper_instructions = "${description} rules"\n${extra}`;
const trust = (path: string, level: string) => `[projects.${JSON.stringify(path)}]\ntrust_level = "${level}"\n`;

/** The roles the `agent` tool offers, from the public tool description. */
async function catalogue(w: Awaited<ReturnType<typeof world>>) {
	const run = runtime(w.cwd, w.base);
	await run.emit("session_start");
	const lines = run.description().split("\n");
	run.live.close();
	return (name: string) => lines.find(line => line.startsWith(`${name}: `));
}

test("project .codex roles load only for a trusted project, .pi roles stay open", async (t) => {
	const w = await world(t);
	await w.put("project/.codex/agents/scout.toml", role("scout", "codex scout"));
	await w.put("project/.pi/agents/pi-scout.toml", role("pi-scout", "pi scout"));
	let roles = await catalogue(w);
	assert.equal(roles("scout"), undefined);
	assert.match(roles("pi-scout")!, /^pi-scout: pi scout;/);
	await w.put("codex/config.toml", trust(w.project, "untrusted"));
	assert.equal((await catalogue(w))("scout"), undefined);
	await w.put("codex/config.toml", trust(w.project, "trusted"));
	roles = await catalogue(w);
	assert.match(roles("scout")!, /^scout: codex scout;/);
	assert.ok(roles("pi-scout"));
});

test("trust is per layer: a trusted subdirectory does not open its parent's .codex roles", async (t) => {
	const w = await world(t);
	await w.put("project/.codex/agents/root-role.toml", role("root-role", "root"));
	await w.put("project/pkg/.codex/agents/leaf-role.toml", role("leaf-role", "leaf"));
	await w.put("codex/config.toml", trust(w.cwd, "trusted"));
	const roles = await catalogue(w);
	assert.equal(roles("root-role"), undefined);
	assert.match(roles("leaf-role")!, /^leaf-role: leaf;/);
});

test("a linked worktree takes trust from its main checkout, also with a separate git directory", async (t) => {
	for (const separate of [false, true]) {
		const w = await world(t);
		const common = separate ? "main/.git-data" : "main/.git";
		if (separate) await w.put("main/.git", `gitdir: ${join(w.base, common)}\n`);
		await w.put(`${common}/HEAD`, "ref: refs/heads/main\n");
		await w.put(`${common}/worktrees/wt/gitdir`, `${join(w.base, "wt", ".git")}\n`);
		await w.put(`${common}/worktrees/wt/commondir`, "../..\n");
		await w.put("wt/.git", `gitdir: ${join(w.base, common, "worktrees", "wt")}\n`);
		await w.put("wt/.codex/agents/wt-role.toml", role("wt-role", "worktree role"));
		const inWorktree = { ...w, cwd: join(w.base, "wt") };
		assert.equal((await catalogue(inWorktree))("wt-role"), undefined, "no trust yet");
		await w.put("codex/config.toml", trust(join(w.base, "main"), "trusted"));
		assert.ok((await catalogue(inWorktree))("wt-role"), `separate=${separate}`);
	}
});

test("a worktree link with incomplete or inconsistent metadata gets no trust", async (t) => {
	const w = await world(t);
	const admin = join(w.base, "main", ".git", "worktrees", "wt");
	await w.put("main/.git/HEAD", "ref: refs/heads/main\n");
	await w.put("main/.git/worktrees/wt/gitdir", `${join(w.base, "wt", ".git")}\n`);
	await w.put("main/.git/worktrees/wt/commondir", "../..\n");
	await w.put("wt/.git", `gitdir: ${admin}\n`);
	await w.put("wt/.codex/agents/wt-role.toml", role("wt-role", "worktree role"));
	await w.put("codex/config.toml", trust(join(w.base, "main"), "trusted"));
	const inWorktree = { ...w, cwd: join(w.base, "wt") };
	assert.ok((await catalogue(inWorktree))("wt-role"));
	for (const name of ["gitdir", "commondir"]) {
		for (const text of [undefined, "", "x".repeat(65_537)]) {
			const saved = await readFile(join(admin, name), "utf8");
			if (text === undefined) await rm(join(admin, name)); else await writeFile(join(admin, name), text);
			assert.equal((await catalogue(inWorktree))("wt-role"), undefined, `${name} ${text?.length}`);
			await writeFile(join(admin, name), saved);
		}
	}
	// The registered checkout is another directory: a forged link.
	await writeFile(join(admin, "gitdir"), `${join(w.base, "elsewhere", ".git")}\n`);
	assert.equal((await catalogue(inWorktree))("wt-role"), undefined);
});

test("a .git directory without HEAD is no root of the .codex layers, but still of Pi's .pi folders", async (t) => {
	const w = await world(t);
	await w.put("other/.git/config", "");
	await w.put("other/.codex/agents/codex-role.toml", role("codex-role", "codex"));
	await w.put("other/.pi/agents/pi-role.toml", role("pi-role", "pi"));
	await w.put("other/pkg/keep", "");
	await w.put("codex/config.toml", trust(join(w.base, "other"), "trusted"));
	const roles = await catalogue({ ...w, cwd: join(w.base, "other", "pkg") });
	assert.equal(roles("codex-role"), undefined);
	assert.ok(roles("pi-role"));
});

test("administrative and managed Codex config is not supported: neither trust nor roles come from it", async (t) => {
	const w = await world(t);
	await w.put("project/.codex/agents/scout.toml", role("scout", "codex scout"));
	await w.put("etc-codex/config.toml", trust(w.project, "trusted"));
	await w.put("etc-codex/managed_config.toml", trust(w.project, "trusted"));
	await w.put("etc-codex/agents/admin-only.toml", role("admin-only", "admin only"));
	const roles = await catalogue(w);
	assert.equal(roles("scout"), undefined);
	assert.equal(roles("admin-only"), undefined);
});

test("root to cwd layers override and inherit missing metadata", async (t) => {
	const w = await world(t);
	await w.put("codex/config.toml", trust(w.project, "trusted"));
	await w.put("codex/agents/shared.toml", role("shared", "user text", 'nickname_candidates = ["Ada"]\n'));
	await w.put("project/.codex/agents/shared.toml", role("shared", "root text"));
	await w.put("project/pkg/.codex/config.toml", '[agents.shared]\ndescription = "leaf text"\n');
	const roles = await catalogue(w);
	// The leaf declaration has no file: it keeps the nearest lower file, so its source is the root layer's file.
	assert.match(roles("shared")!, new RegExp(`^shared: leaf text;.*source=${join(w.base, "project", ".codex", "agents", "shared.toml").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
	// The role applies the root layer's instructions, as the nearest lower file says.
	const run = runtime(w.cwd, w.base);
	await run.execute({ action: "start", task: "t", agent_type: "shared", tools: [] });
	await run.live.wait(new AbortController().signal);
	assert.match(run.systemOf("t"), /root text rules/);
	run.live.close();
});

test("Pi's .pi profiles keep their own project root; only .codex layers follow Codex's markers", async (t) => {
	const w = await world(t);
	await w.put("project/.pi/agents/root-pi.toml", role("root-pi", "root pi"));
	await w.put("project/pkg/.pi/agents/leaf-pi.toml", role("leaf-pi", "leaf pi"));
	await w.put("project/.codex/agents/root-codex.toml", role("root-codex", "root codex"));
	await w.put("project/pkg/.codex/agents/leaf-codex.toml", role("leaf-codex", "leaf codex"));
	await w.put("codex/config.toml", `project_root_markers = []\n[projects.${JSON.stringify(w.project)}]\ntrust_level = "trusted"\n[projects.${JSON.stringify(w.cwd)}]\ntrust_level = "trusted"\n`);
	const roles = await catalogue(w);
	// Empty markers leave only cwd for Codex layers, while the Pi folders still reach the Git root.
	assert.equal(roles("root-codex"), undefined);
	assert.ok(roles("leaf-codex"));
	assert.ok(roles("root-pi"));
	assert.ok(roles("leaf-pi"));
});
