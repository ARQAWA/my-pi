import assert from "node:assert/strict";
import { it } from "node:test";
import { fakePi, promptOf, trust, world } from "./fixture.ts";

const locations = (prompt: string) => [...prompt.matchAll(/<location>(.*?)<\/location>/g)].map(match => match[1]).sort();
// Codex's catalog line and its cost: ceil(bytes / 4) of the line with its newline.
const lineCost = (skill: { name: string; description: string; filePath: string }) =>
	Math.ceil(Buffer.byteLength(`- ${skill.name}: ${skill.description} (file: ${skill.filePath})\n`) / 4);

// The skills the rendered prompt lists, read back from its XML.
const skillsIn = (prompt: string) => [...prompt.matchAll(/<name>(.*?)<\/name>\s*<description>(.*?)<\/description>\s*<location>(.*?)<\/location>/gs)]
	.map(match => ({ name: match[1], description: match[2], filePath: match[3] }));

function setup(t: any) {
	const w = world(t);
	const files = {
		a: w.skill("codex/skills/a", "a"),
		b: w.skill("home/.agents/skills/b", "b"),
		sys: w.skill("codex/skills/.system/sys", "sys"),
	};
	const listed = async (config: string) => {
		w.put("codex/config.toml", config);
		return locations((await promptOf(w, { env: w.env })).system);
	};
	return { w, files, listed };
}

it("skills.config disables by name and by path in the prompt text, later rules win", async (t) => {
	const { files, listed } = setup(t);
	const all = [files.a, files.b, files.sys].sort();
	assert.deepEqual(await listed(""), all);
	assert.deepEqual(await listed('[[skills.config]]\nname = "a"\nenabled = false\n'), [files.b, files.sys].sort());
	assert.deepEqual(await listed(`[[skills.config]]\npath = ${JSON.stringify(files.b)}\nenabled = false\n`), [files.a, files.sys].sort());
	// A later path rule enables the skill again; a later name rule disables it once more.
	const off = '[[skills.config]]\nname = "a"\nenabled = false\n';
	const on = `[[skills.config]]\npath = ${JSON.stringify(files.a)}\nenabled = true\n`;
	assert.deepEqual(await listed(off + on), all);
	assert.deepEqual(await listed(off + on + off), [files.b, files.sys].sort());
	assert.deepEqual(await listed(`[[skills.config]]\npath = ${JSON.stringify(files.a)}\nenabled = false\n[[skills.config]]\nname = "a"\nenabled = true\n`), all);
});

it("skills.bundled.enabled = false drops system skills and their root", async (t) => {
	const { w, files, listed } = setup(t);
	assert.deepEqual(await listed("[skills.bundled]\nenabled = false\n"), [files.a, files.b].sort());
	const result = await fakePi({ env: w.env }).fire("resources_discover", { cwd: w.cwd, reason: "startup" }) as { skillPaths: string[] };
	assert.ok(!result.skillPaths.includes(w.path("codex/skills/.system")));
	assert.ok(result.skillPaths.includes(w.path("codex/skills")));
});

it("skills.include_instructions = false removes every skill from the prompt", async (t) => {
	const { listed } = setup(t);
	assert.deepEqual(await listed("[skills]\ninclude_instructions = false\n"), []);
});

it("skills.config of a trusted project layer is ignored, only the user layer holds rules", async (t) => {
	const { w, files, listed } = setup(t);
	w.put("project/.codex/config.toml", '[[skills.config]]\nname = "b"\nenabled = false\n');
	assert.deepEqual(await listed(trust(w.root, "trusted")), [files.a, files.b, files.sys].sort());
});

it("skills.max_context_tokens fits Codex's per-line budget: round-robin descriptions, then omission", async (t) => {
	const w = world(t);
	const text = "abcdefghij".repeat(4);
	const files = { a: w.skill("codex/skills/a", "a", text), b: w.skill("codex/skills/b", "b", text) };
	const run = async (limit: number) => {
		w.put("codex/config.toml", `[skills]\nmax_context_tokens = ${limit}\n`);
		return skillsIn((await promptOf(w, { env: w.env })).system);
	};
	assert.deepEqual((await run(10000)).map(skill => [skill.name, skill.description]), [["a", text], ["b", text]]);
	// A line is "- a: <description> (file: <path>)\n": 15 bytes besides description and path, a token is 4 bytes.
	// The budget is two lines holding a 20-character description each; the round-robin fills both up to the last
	// byte of their token, so each description grows to 4 * tokens - path - 15 characters.
	const path = Buffer.byteLength(files.a);
	assert.equal(Buffer.byteLength(files.b), path);
	const tokens = Math.ceil((path + 15 + 20) / 4);
	const grown = 4 * tokens - path - 15;
	assert.deepEqual((await run(2 * tokens)).map(skill => [skill.name, skill.description, skill.filePath]), [
		["a", text.slice(0, grown), files.a],
		["b", text.slice(0, grown), files.b],
	]);
	// Room for one line without its description only: the later skill is omitted.
	assert.deepEqual((await run(Math.ceil((path + 15) / 4))).map(skill => [skill.name, skill.description]), [["a", ""]]);
});

it("without a configured limit the catalog gets 2% of the model's context window", async (t) => {
	const w = world(t);
	for (let i = 0; i < 12; i++) w.skill(`codex/skills/s${i}`, `s${i}`, "d".repeat(1000));
	const skills = skillsIn((await promptOf(w, { env: w.env }, 100000)).system);
	assert.equal(skills.length, 12);
	assert.ok(skills.reduce((sum, skill) => sum + lineCost(skill), 0) <= 2000);
	assert.ok(skills.every(skill => skill.description.length < 1000));
	// A window ten times larger leaves the descriptions whole.
	assert.ok(skillsIn((await promptOf(w, { env: w.env }, 1000000)).system).every(skill => skill.description.length === 1000));
});

it("with neither a limit nor a known window the catalog gets Codex's 8000-character fallback", async (t) => {
	const w = world(t);
	for (let i = 0; i < 12; i++) w.skill(`codex/skills/s${i}`, `s${i}`, "d".repeat(1000));
	const skills = skillsIn((await promptOf(w, { env: w.env }, null)).system);
	assert.equal(skills.length, 12);
	const chars = skills.reduce((sum, skill) => sum + Array.from(`- ${skill.name}: ${skill.description} (file: ${skill.filePath})\n`).length, 0);
	assert.ok(chars <= 8000 && chars > 7000, `${chars} characters`);
	assert.ok(skills.every(skill => skill.description.length < 1000));
});

it("the prewarm projection renders the same skill text as the real run", async (t) => {
	const w = world(t);
	w.skill("codex/skills/a", "a");
	w.skill("codex/skills/b", "b");
	w.put("codex/config.toml", '[[skills.config]]\nname = "b"\nenabled = false\n');
	const { system, prewarm, options } = await promptOf(w, { env: w.env });
	assert.equal(prewarm, system);
	assert.deepEqual(options.skills.map((skill: any) => skill.name), ["a"]);
});
