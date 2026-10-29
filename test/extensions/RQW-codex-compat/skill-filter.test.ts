import assert from "node:assert/strict";
import { basename, dirname } from "node:path";
import { it } from "node:test";
import { fakePi, world } from "./fixture.ts";

it("without a Codex root the catalog stays Pi's own list", async (t) => {
	const w = world(t);
	const own = w.skill("agent/skills/mine", "mine");
	const pi = fakePi({ env: w.env });
	const piSkill = { name: "mine", description: "d", filePath: own, baseDir: "", sourceInfo: { scope: "user" }, disableModelInvocation: false };
	const event = { systemPromptOptions: { cwd: w.cwd, contextFiles: [], skills: [piSkill] } };
	await pi.fire("before_agent_start", event);
	assert.deepEqual(event.systemPromptOptions.skills.map((skill: any) => skill.filePath), [own]);
});

it("the filter offered on rqw-skill-dollar:filter drops disabled and bundled-off skills and re-reads the config", async (t) => {
	const w = world(t);
	const on = w.skill("codex/skills/on", "on");
	const off = w.skill("codex/skills/off", "off");
	const sys = w.skill("codex/skills/.system/sys", "sys");
	w.put("codex/config.toml", `[[skills.config]]\npath = ${JSON.stringify(off)}\nenabled = false\n`);
	const pi = fakePi({ env: w.env });
	await pi.fire("session_start", {}, { cwd: w.cwd });
	let filter: ((skills: any[]) => any[]) | undefined;
	pi.pi.events.emit("rqw-skill-dollar:filter", { offer(next: any) { filter = next; } });
	const given = [on, off, sys].map(filePath => ({ name: basename(dirname(filePath)), filePath, baseDir: dirname(filePath) }));
	assert.deepEqual(filter!(given).map(skill => skill.name), ["on", "sys"]);
	// A changed config file counts at the next call, without a new session start or prompt.
	w.put("codex/config.toml", '[skills.bundled]\nenabled = false\n[[skills.config]]\nname = "on"\nenabled = false\n');
	assert.deepEqual(filter!(given).map(skill => skill.name), ["off"]);
});
