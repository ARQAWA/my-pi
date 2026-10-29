import assert from "node:assert/strict";
import { it } from "node:test";
import { fakePi, linkedWorktree, run, trust, world, type Files } from "./fixture.ts";

const paths = (files: Files) => files.map(file => file.path);

it("orders global override, Pi's personal file, then project files from root to cwd", async (t) => {
	const w = world(t);
	const override = w.put("codex/AGENTS.override.md", "  global override \n");
	w.put("codex/AGENTS.md", "global agents");
	const mine = w.put("agent/AGENTS.md", "pi personal");
	const rootDoc = w.put("project/AGENTS.md", "root doc");
	const cwdOverride = w.put("project/pkg/AGENTS.override.md", "pkg override");
	w.put("project/pkg/AGENTS.md", "pkg agents is shadowed");
	const piAncestor = { path: w.path("project/CLAUDE.md"), content: "pi ancestor" };
	const files = await run(w, [{ path: mine, content: "pi personal" }, piAncestor]);
	assert.deepEqual(files, [
		{ path: override, content: "global override" },
		{ path: mine, content: "pi personal" },
		{ path: rootDoc, content: "root doc" },
		{ path: cwdOverride, content: "pkg override" },
	]);
});

it("skips an empty global override for AGENTS.md and an empty project file", async (t) => {
	const w = world(t);
	w.put("codex/AGENTS.override.md", " \n");
	const agents = w.put("codex/AGENTS.md", "global agents\n");
	w.put("project/AGENTS.md", "  \n");
	const leaf = w.put("project/pkg/AGENTS.md", "leaf");
	assert.deepEqual(paths(await run(w)), [agents, leaf]);
});

it("uses fallback file names as names only, per directory, and never adds CLAUDE.md alone", async (t) => {
	const w = world(t);
	w.put("codex/config.toml", 'project_doc_fallback_filenames = ["CLAUDE.md", "../escape.md", "sub/x.md", ""]\n');
	w.put("project/CLAUDE.md", "claude root");
	w.put("project/pkg/AGENTS.md", "pkg agents");
	w.put("project/pkg/CLAUDE.md", "ignored behind AGENTS.md");
	w.put("escape.md", "must not load");
	assert.deepEqual((await run(w)).map(file => file.content), ["claude root", "pkg agents"]);
	w.put("codex/config.toml", "");
	assert.deepEqual((await run(w)).map(file => file.content), ["pkg agents"]);
});

it("project_root_markers bound the walk; no marker leaves only cwd", async (t) => {
	const w = world(t);
	w.put("project/AGENTS.md", "root");
	w.put("project/pkg/AGENTS.md", "leaf");
	w.put("codex/config.toml", "project_root_markers = []\n");
	assert.deepEqual((await run(w)).map(file => file.content), ["leaf"]);
	w.put("codex/config.toml", 'project_root_markers = ["pkg.marker"]\n');
	w.put("project/pkg/pkg.marker");
	assert.deepEqual((await run(w)).map(file => file.content), ["leaf"]);
});

it("an explicitly untrusted project adds no project files, global files stay", async (t) => {
	const w = world(t);
	const global = w.put("codex/AGENTS.md", "global");
	const mine = w.put("agent/AGENTS.md", "mine");
	w.put("project/AGENTS.md", "project");
	w.put("codex/config.toml", trust(w.root, "untrusted"));
	assert.deepEqual(paths(await run(w, [{ path: mine, content: "mine" }])), [global, mine]);
	w.put("codex/config.toml", trust(w.root, "trusted"));
	assert.equal((await run(w)).length, 2);
});

it("the cwd project entry wins over the repository root, even without a trust level", async (t) => {
	const w = world(t);
	w.put("project/AGENTS.md", "root doc");
	w.put("codex/config.toml", `${trust(w.root, "untrusted")}\n[projects."${w.cwd}"]\nnote = "no trust level here"\n`);
	assert.deepEqual((await run(w)).map(file => file.content), ["root doc"]);
	// Without a cwd entry the repository root decides.
	w.put("codex/config.toml", trust(w.root, "untrusted"));
	assert.deepEqual(await run(w), []);
});

it("a .git directory without HEAD still marks the project root", async (t) => {
	const w = world(t);
	w.put("other/.git/config");
	w.put("other/AGENTS.md", "other root");
	w.put("other/pkg/keep");
	const pi = fakePi({ env: w.env });
	const event = { systemPromptOptions: { cwd: w.path("other/pkg"), skills: [], contextFiles: [] } };
	await pi.fire("before_agent_start", event, { ui: { notify() {} } });
	assert.deepEqual(event.systemPromptOptions.contextFiles.map((file: any) => file.content), ["other root"]);
});

it("a linked worktree takes the active trust of its main checkout", async (t) => {
	const w = world(t);
	const link = linkedWorktree(w);
	w.put("wt/AGENTS.md", "worktree doc");
	w.put("codex/config.toml", trust(link.main, "untrusted"));
	const pi = fakePi({ env: w.env });
	const event = { systemPromptOptions: { cwd: w.path("wt"), skills: [], contextFiles: [] } };
	await pi.fire("before_agent_start", event, { ui: { notify() {} } });
	assert.deepEqual(event.systemPromptOptions.contextFiles, []);
});
