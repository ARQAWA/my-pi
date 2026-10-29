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
	let filter: ((skills: any[], submit?: boolean) => any[]) | undefined;
	pi.pi.events.emit("rqw-skill-dollar:filter", { offer(next: any) { filter = next; } });
	const given = [on, off, sys].map(filePath => ({ name: basename(dirname(filePath)), filePath, baseDir: dirname(filePath) }));
	assert.deepEqual(filter!(given).map(skill => skill.name), ["on", "sys"]);
	// A changed config file counts at the next submit, without a new session start or prompt.
	w.put("codex/config.toml", '[skills.bundled]\nenabled = false\n[[skills.config]]\nname = "on"\nenabled = false\n');
	assert.deepEqual(filter!(given, true).map(skill => skill.name), ["off"]);
});

it("an autocomplete request reuses the ordered list: no config read, no rebuild until a submit, new skills or new resources", async (t) => {
	const w = world(t);
	const on = w.skill("codex/skills/on", "on");
	const off = w.skill("codex/skills/off", "off");
	w.put("codex/config.toml", "");
	const pi = fakePi({ env: w.env });
	await pi.fire("session_start", {}, { cwd: w.cwd });
	let filter: ((skills: any[], submit?: boolean) => any[]) | undefined;
	pi.pi.events.emit("rqw-skill-dollar:filter", { offer(next: any) { filter = next; } });
	const make = (...paths: string[]) => paths.map(filePath => ({ name: basename(dirname(filePath)), filePath, baseDir: dirname(filePath) }));
	const first = filter!(make(on, off));
	// Fresh objects with the same content (as each keystroke gives) get the very same list back.
	assert.equal(filter!(make(on, off)), first);
	// A config change is not looked at while typing ...
	w.put("codex/config.toml", `[[skills.config]]\npath = ${JSON.stringify(off)}\nenabled = false\n`);
	assert.equal(filter!(make(on, off)), first);
	assert.deepEqual(filter!(make(on, off)).map(skill => skill.name), ["on", "off"]);
	// ... and is read at the next submit; the list is then rebuilt once and reused again.
	const submitted = filter!(make(on, off), true);
	assert.deepEqual(submitted.map(skill => skill.name), ["on"]);
	assert.equal(filter!(make(on, off)), submitted);
	// Another set of skills, and a resource reload, rebuild it.
	assert.deepEqual(filter!(make(on)).map(skill => skill.name), ["on"]);
	assert.notEqual(filter!(make(on)), submitted);
	const before = filter!(make(on));
	await pi.fire("resources_discover", { cwd: w.cwd, reason: "reload" });
	assert.notEqual(filter!(make(on)), before);
});
