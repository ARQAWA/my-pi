import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, it } from "node:test";
import { reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

type World = Awaited<ReturnType<typeof world>>;

/** A section of the system message of the chat's first request, not of a background helper. */
function sectionOf(w: World, name: string): string {
	const request = w.requests.find((entry) => entry.background === undefined);
	assert.ok(request, "the chat sent a model request");
	const system = request.context.messages[0] as unknown as { sections?: Record<string, string> };
	return system.sections?.[name] ?? "";
}

it("a skill from CODEX_HOME/skills is in the model's skill catalog", async (t) => {
	const w = await world(t);
	w.model.script(text("first"));
	await w.submit("hello");

	// Skill roots are offered when Pi loads its resources, so the skill must exist before the next start.
	const skillDir = join(w.dirs.codex, "skills", "synth-skill");
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(join(skillDir, "SKILL.md"), "---\nname: synth-skill\ndescription: Checks the synthetic catalog.\n---\nBody of the skill.\n");

	const w2 = await w.restart();
	// The old world is disposed now: a request made while it shut down would show here.
	assert.deepEqual(w.networkAttempts, []);
	w2.model.script(text("second"));
	await w2.submit("again");
	assert.deepEqual(w2.errors, []);
	assert.deepEqual(w2.networkAttempts, []);
	const skills = sectionOf(w2, "skills");
	assert.match(skills, /synth-skill/);
	assert.match(skills, /Checks the synthetic catalog\./);
	assert.ok(skills.includes(join(skillDir, "SKILL.md")), "the catalog names the skill file");
});

it("the project's AGENTS.md reaches the model request", async (t) => {
	const w = await world(t);
	writeFileSync(join(w.dirs.project, "AGENTS.md"), "Project rule: always answer in haiku.\n");
	w.model.script(text("done"));
	await w.submit("hello");
	assert.match(sectionOf(w, "project_context"), /Project rule: always answer in haiku\./);
	assert.deepEqual(w.networkAttempts, []);
});

it("an untrusted project's AGENTS.md is skipped while the global Codex file stays", async (t) => {
	const w = await world(t);
	writeFileSync(join(w.dirs.codex, "config.toml"), `[projects.${JSON.stringify(w.dirs.project)}]\ntrust_level = "untrusted"\n`);
	writeFileSync(join(w.dirs.codex, "AGENTS.md"), "Global rule: be brief.\n");
	writeFileSync(join(w.dirs.project, "AGENTS.md"), "Project rule: always answer in haiku.\n");
	w.model.script(text("done"));
	await w.submit("hello");
	const prompt = sectionOf(w, "project_context");
	assert.match(prompt, /Global rule: be brief\./);
	assert.doesNotMatch(prompt, /Project rule: always answer in haiku\./);
	assert.deepEqual(w.networkAttempts, []);
});
