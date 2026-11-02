import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { basename, dirname } from "node:path";
import { it } from "node:test";
import { fakePi, trust, world } from "./fixture.ts";

it("trust removed in config.toml after the resources loaded drops the project .codex skills at once", async (t) => {
	const w = world(t);
	const project = w.skill("project/.codex/skills/proj", "proj");
	const mine = w.skill("codex/skills/mine", "mine");
	// A project skill that is a directory link (a junction on Windows, which needs no privilege) to a folder outside `.codex/skills`.
	w.skill("outside/linked", "linked");
	symlinkSync(w.path("outside/linked"), w.path("project/.codex/skills/linked"), "junction");
	const linked = w.path("project/.codex/skills/linked/SKILL.md");
	w.put("codex/config.toml", trust(w.root, "trusted"));
	const pi = fakePi({ env: w.env });
	await pi.fire("session_start", {}, { cwd: w.cwd });
	await pi.fire("resources_discover", { type: "resources_discover", cwd: w.cwd, reason: "startup" });
	const given = [project, linked, mine].map(filePath => ({ name: basename(dirname(filePath)), description: "d", filePath, baseDir: dirname(filePath), sourceInfo: { scope: "user" }, disableModelInvocation: false }));
	const catalog = async () => {
		const event = { systemPromptOptions: { cwd: w.cwd, contextFiles: [], skills: given } };
		await pi.fire("before_agent_start", event, {});
		return event.systemPromptOptions.skills.map((skill: any) => skill.name);
	};
	let filter: ((skills: any[], submit?: boolean) => any[]) | undefined;
	pi.pi.events.emit("rqw-skill-dollar:filter", { offer(next: any) { filter = next; } });
	assert.deepEqual(await catalog(), ["proj", "linked", "mine"]);
	assert.deepEqual(filter!(given, true).map(skill => skill.name), ["proj", "linked", "mine"]);

	// No /reload: the config file alone changes.
	w.put("codex/config.toml", trust(w.root, "untrusted"));
	assert.deepEqual(await catalog(), ["mine"]);
	assert.deepEqual(filter!(given, true).map(skill => skill.name), ["mine"]);
});
