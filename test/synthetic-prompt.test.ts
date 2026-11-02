import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, it } from "node:test";
import { reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

const SYSTEM = readFileSync(new URL("../extensions/RQW-prompt/SYSTEM.md", import.meta.url), "utf8").trimEnd();

/** The system message of a request: its sections carry the prompt text. */
function systemSections(request: { context: { messages: readonly unknown[] } }): Record<string, string> {
	const system = request.context.messages.find((message) => (message as { role: string }).role === "system") as { sections: Record<string, string> };
	return system.sections;
}

it("the first request starts with SYSTEM.md and ends with the environment and date blocks", async (t) => {
	const w = await world(t);
	w.model.script(text("hello"));
	await w.submit("hi");

	const [first] = w.requests.filter((request) => request.background === undefined);
	const sections = systemSections(first);
	assert.ok(sections.preamble.startsWith(SYSTEM), "the preamble starts with the text of SYSTEM.md");
	assert.match(sections.preamble, /<project-context>\n<workstation>\n- OS: \S+ .+\n- Arch: \S+\n- Model: anthropic\/claude-opus-5-5\n<\/workstation>/);
	assert.match(sections.preamble, /<critical>\n- Each response MUST advance the task/);
	assert.ok(sections.preamble.includes(`paths: absolute like ${w.dirs.home.replace(/\\/g, "/")}/... with forward slashes`), "the environment block names the home folder");
	assert.ok(sections.preamble.endsWith("Today (UTC): 2026-11-02. Do not repeat this information in your reply."), "the date block is last");
	// Pi still appends its own working directory section after the prefix.
	assert.ok(sections.cwd.replace(/\\/g, "/").includes(w.dirs.project.replace(/\\/g, "/")));
});

it("Pi's default prompt text is gone from the request", async (t) => {
	const w = await world(t);
	w.model.script(text("hello"));
	await w.submit("hi");

	const [first] = w.requests.filter((request) => request.background === undefined);
	assert.doesNotMatch(Object.values(systemSections(first)).join("\n"), /You are an expert coding assistant operating inside pi/);
});
