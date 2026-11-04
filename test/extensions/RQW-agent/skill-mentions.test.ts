import assert from "node:assert/strict";
import { test } from "node:test";
import { runtime, world } from "./fixture.ts";

const reviewer = new URL("../../../extensions/RQW-review/REVIEWER.md", import.meta.url).pathname;

test("new tasks expand mentions before include, except for reviewer briefs", async t => {
	const w = await world(t);
	const skill = await w.put("skill/SKILL.md", "---\nname: example\ndescription: Example\n---\nSKILL BODY\n");
	const run = runtime(w.cwd, w.base);
	const expandedTasks: string[] = [];
	run.events.on("rqw-skill-dollar:expand", (request: any) => request.offer((text: string) => {
		expandedTasks.push(text);
		return text.replace(`[$example](skill://${skill})`, "SKILL BODY").replace("$example", "SKILL BODY");
	}));
	try {
	run.parent.appendMessage({ role: "user", content: "owner $example", timestamp: 1 });
	await run.execute({ action: "start", task: "do $example", include: ["user_messages"], tools: [] });
	await run.live.wait(new AbortController().signal);
	const first = run.requests[0].messages.find((message: any) => message.role === "user").content[0].text;
	assert.match(first, /SKILL BODY/);
	assert.match(first, /<user_messages>\nowner \$example\n<\/user_messages>/);
	await run.execute({ action: "send", id: "agent#1", task: `use [$example](skill://${skill})` });
	await run.live.wait(new AbortController().signal);
	assert.match(run.requests[1].messages.filter((message: any) => message.role === "user").at(-1).content[0].text, /SKILL BODY/);
	await run.execute({ action: "start", task: "brief $example", role_file: reviewer, tools: [] });
	await run.live.wait(new AbortController().signal);
	assert.equal(run.requests[2].messages.find((message: any) => message.role === "user").content[0].text, "brief $example");
	await run.execute({ action: "send", id: "agent#2", task: "again $example" });
	await run.live.wait(new AbortController().signal);
	assert.match(JSON.stringify(run.requests[3].messages), /again \$example/);
	await run.execute({ action: "restart", id: "agent#2", role: "ordinary", task: "restart $example" });
	await run.live.wait(new AbortController().signal);
	assert.match(JSON.stringify(run.requests[4].messages), /SKILL BODY/);
	await run.execute({ action: "start", fork_turns: "all", task: "fork $example", tools: [] });
	await run.live.wait(new AbortController().signal);
	assert.match(run.requests[5].messages.filter((message: any) => message.role === "user").at(-1).content[0].text, /SKILL BODY/);
	assert.deepEqual(expandedTasks, ["do $example", `use [$example](skill://${skill})`, "restart $example", "fork $example"]);
	} finally { run.live.close(); }
});

const spotty = new URL("../../../extensions/RQW-review/profiles/spotty.toml", import.meta.url).pathname;

/** A child saved before the reviewer flag existed: the saved config has no `reviewer`, so restore must decide once. */
async function legacyChild(t: Parameters<typeof world>[0], start: Record<string, unknown>, edit: (config: any) => void) {
	const w = await world(t);
	await w.put("skill/SKILL.md", "---\nname: example\ndescription: Example\n---\nSKILL BODY\n");
	const source = runtime(w.cwd, w.base);
	source.parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	await source.execute({ action: "start", task: "first", tools: [], ...start });
	await source.live.wait(new AbortController().signal);
	source.live.close();
	const config = (source.parent.getBranch().find((entry: any) => entry.customType === "rqw-agent-child") as any).data.config;
	delete config.reviewer;
	edit(config);
	const restored = runtime(w.cwd, w.base, "off", [], [], source.parent);
	restored.events.on("rqw-skill-dollar:expand", (request: any) => request.offer((text: string) => text.replace("$example", "SKILL BODY")));
	await restored.execute({ action: "send", id: "agent#1", task: "again $example" });
	await restored.live.wait(new AbortController().signal);
	const sent = restored.requests.at(-1).messages.filter((message: any) => message.role === "user").at(-1).content[0].text;
	// The restore saves its own record with the decided flag.
	const saved = restored.parent.getBranch().filter((entry: any) => entry.customType === "rqw-agent-child").map((entry: any) => entry.data.config).filter(Boolean).at(-1);
	return { sent, config: saved, restored };
}

test("a legacy child with the package reviewer role keeps its brief unexpanded after restore and the flag is saved", async t => {
	const { sent, config, restored } = await legacyChild(t, { role_file: reviewer }, () => {});
	try {
		assert.equal(sent, "again $example");
		assert.equal(config.reviewer, true);
	} finally { restored.live.close(); }
});

test("a legacy child of the RQW-review profile with the profile role keeps its brief unexpanded after restore", async t => {
	const { sent, config, restored } = await legacyChild(t, { role_file: reviewer }, saved => {
		delete saved.prompt_file;
		saved.profile = { name: "spotty", path: spotty, sha256: "legacy" };
		saved.profile_defaults = { model: true, thinking: true, role: true };
	});
	try {
		assert.equal(sent, "again $example");
		assert.equal(config.reviewer, true);
	} finally { restored.live.close(); }
});

test("a legacy child that is not a reviewer gets its mentions expanded after restore", async t => {
	const { sent, config, restored } = await legacyChild(t, { role: "ordinary" }, () => {});
	try {
		assert.equal(sent, "again SKILL BODY");
		assert.equal(config.reviewer, false);
	} finally { restored.live.close(); }
});
