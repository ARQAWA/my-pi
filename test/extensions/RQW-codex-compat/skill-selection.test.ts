import assert from "node:assert/strict";
import { dirname } from "node:path";
import { it } from "node:test";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { fakePi, world } from "./fixture.ts";

/** Codex world with `$CODEX_HOME` (user) and project `.agents/skills` (repo) skills of one name, plus a unique one. */
async function twin(t: { after(fn: () => void): void }, config?: (user: string) => string) {
	const w = world(t);
	const user = w.skill("codex/skills/same", "same", "user copy");
	const repo = w.skill("project/.agents/skills/same", "same", "repo copy");
	const solo = w.skill("codex/skills/solo", "solo");
	if (config) w.put("codex/config.toml", config(user));
	const pi = fakePi({ env: w.env }, () => commands());
	const ctx = { cwd: w.cwd, model: { provider: "p", id: "m", contextWindow: 100000 }, modelRegistry: { find: () => undefined }, sessionManager: { getSessionId: () => "s" }, ui: { notify: (message: string) => notes.push(message) } };
	const notes: string[] = [];
	await pi.fire("session_start", {}, ctx);
	const found = await pi.fire("resources_discover", { cwd: w.cwd, reason: "startup" }) as { skillPaths: string[] };
	// Pi's real public loader: it keeps only the first skill of a name.
	const piSkills = loadSkills({ cwd: w.cwd, agentDir: w.env.agentDir, skillPaths: found.skillPaths, includeDefaults: false }).skills;
	const commands = () => piSkills.map(skill => ({ name: `skill:${skill.name}`, description: skill.description, source: "skill", sourceInfo: { path: skill.filePath } }));
	return { w, pi, ctx, notes, user, repo, solo, piSkills };
}

it("Pi's loader loses the same-name skill, the catalog keeps both paths", async (t) => {
	const { pi, ctx, user, repo, piSkills } = await twin(t);
	assert.deepEqual(piSkills.map(skill => skill.filePath).filter(path => path === user || path === repo), [user]);
	const event = { systemPromptOptions: { cwd: ctx.cwd, contextFiles: [], skills: piSkills } };
	await pi.fire("before_agent_start", event, ctx);
	assert.deepEqual(event.systemPromptOptions.skills.filter((skill: any) => skill.name === "same").map((skill: any) => skill.filePath).sort(), [repo, user].sort());
});

it("a path rule disables one same-name skill only", async (t) => {
	const { pi, ctx, repo, piSkills } = await twin(t, user => `[[skills.config]]\npath = ${JSON.stringify(user)}\nenabled = false\n`);
	const event = { systemPromptOptions: { cwd: ctx.cwd, contextFiles: [], skills: piSkills } };
	await pi.fire("before_agent_start", event, ctx);
	assert.deepEqual(event.systemPromptOptions.skills.filter((skill: any) => skill.name === "same").map((skill: any) => skill.filePath), [repo]);
});

it("the $ filter lists same-name skills in Codex order: repo before user, unique names stay in place", async (t) => {
	const { pi, user, repo, solo, piSkills } = await twin(t);
	let filter: ((skills: any[]) => any[]) | undefined;
	pi.pi.events.emit("rqw-skill-dollar:filter", { offer(next: any) { filter = next; } });
	const given = piSkills.map(skill => ({ name: skill.name, description: skill.description, filePath: skill.filePath, baseDir: dirname(skill.filePath) }));
	const names = given.map(skill => skill.name);
	const result = filter!(given);
	assert.deepEqual(result.filter(skill => skill.name === "same").map(skill => skill.filePath), [repo, user]);
	assert.equal(result.find(skill => skill.name === "solo").filePath, solo);
	assert.deepEqual([...new Set(result.map(skill => skill.name))], names);
});

it("/skill:name picks the same skill as $name, and Pi expands alone when it would pick the same one", async (t) => {
	const { pi, ctx, repo, user } = await twin(t);
	const result = await pi.fire("input", { text: "/skill:same do it", source: "interactive" }, ctx) as { action: string; text: string };
	assert.equal(result.action, "transform");
	assert.match(result.text, new RegExp(`^<skill name="same" location="${repo.replace(/[\\/.]/g, "\\$&")}">`));
	assert.match(result.text, /same body[\s\S]*<\/skill>\n\ndo it$/);
	assert.doesNotMatch(result.text, new RegExp(user.replace(/[\\/.]/g, "\\$&")));
	assert.equal(await pi.fire("input", { text: "/skill:solo", source: "interactive" }, ctx), undefined);
	assert.equal(await pi.fire("input", { text: "/skill:missing", source: "interactive" }, ctx), undefined);
	assert.equal(await pi.fire("input", { text: "hello", source: "interactive" }, ctx), undefined);
});

it("/skill:name of a disabled skill is not expanded and says why", async (t) => {
	const { pi, ctx, notes } = await twin(t, () => '[[skills.config]]\nname = "solo"\nenabled = false\n');
	assert.deepEqual(await pi.fire("input", { text: "/skill:solo go", source: "interactive" }, ctx), { action: "handled" });
	assert.equal(notes.length, 1);
	assert.match(notes[0], /solo/);
});

it("the $ filter keeps baseDir after /skill:name built the list from commands without one", async (t) => {
	const { pi, ctx, solo, piSkills } = await twin(t);
	// Same name, description and path as the commands, so the cache keys would match without baseDir in the key.
	await pi.fire("input", { text: "/skill:solo", source: "interactive" }, ctx);
	let filter: ((skills: any[]) => any[]) | undefined;
	pi.pi.events.emit("rqw-skill-dollar:filter", { offer(next: any) { filter = next; } });
	// The command list of /skill:solo holds that one skill, so the $ list must hold it alone for the keys to meet.
	const given = piSkills.filter(skill => skill.name === "solo").map(skill => ({ name: skill.name, description: skill.description, filePath: skill.filePath, baseDir: dirname(skill.filePath) }));
	assert.equal(filter!(given).find(skill => skill.name === "solo").baseDir, dirname(solo));
});
