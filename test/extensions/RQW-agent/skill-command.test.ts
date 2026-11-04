import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { runtime, world } from "./fixture.ts";

const userText = (request: any) => request.messages.filter((message: any) => message.role === "user").at(-1).content[0].text as string;

test("skill commands expand once before included history, without skill-dollar", async t => {
	const w = await world(t);
	const path = await w.put("skill/SKILL.md", "---\nname: example\ndescription: Example\n---\nCOMMAND BODY\n");
	const run = runtime(w.cwd, w.base);
	try {
		run.commands.push({ source: "skill", name: "skill:example", description: "Example", sourceInfo: { path, source: "test", scope: "project", origin: "top-level", baseDir: w.base } });
		run.parent.appendMessage({ role: "user", content: "owner history", timestamp: 1 });
		await run.execute({ action: "start", task: "/skill:example", include: ["user_messages"], tools: [] });
		await run.live.wait(new AbortController().signal);
		const first = userText(run.requests[0]);
		assert.match(first, /^<skill name="example"/);
		assert.equal(first.match(/COMMAND BODY/g)?.length, 1);
		assert.match(first, /<user_messages>\nowner history\n<\/user_messages>$/);
		await run.execute({ action: "send", id: "agent#1", task: "/skill:example argument" });
		await run.live.wait(new AbortController().signal);
		assert.match(userText(run.requests[1]), /COMMAND BODY[\s\S]*argument$/);
		await run.execute({ action: "start", fork_turns: "all", task: "/skill:example fork", tools: [] });
		await run.live.wait(new AbortController().signal);
		assert.match(userText(run.requests[2]), /COMMAND BODY[\s\S]*fork$/);
		await run.execute({ action: "restart", id: "agent#1", task: "/skill:missing" });
		await run.live.wait(new AbortController().signal);
		assert.equal(userText(run.requests[3]), "/skill:missing");
		const reviewer = fileURLToPath(new URL("../../../extensions/RQW-review/REVIEWER.md", import.meta.url));
		await run.execute({ action: "start", task: "/skill:example reviewer", role_file: reviewer, tools: [] });
		await run.live.wait(new AbortController().signal);
		assert.equal(userText(run.requests[4]), "/skill:example reviewer");
	} finally { run.live.close(); }
});

test("offered selection overrides Pi's skill and blocks disabled skills", async t => {
	const w = await world(t);
	const user = await w.put("codex/skills/same/SKILL.md", "---\nname: same\ndescription: User\n---\nUSER BODY\n");
	const project = await w.put("project/.agents/skills/same/SKILL.md", "---\nname: same\ndescription: Project\n---\nPROJECT BODY\n");
	const run = runtime(w.cwd, w.base);
	let disabled = false;
	run.events.on("rqw-skill-dollar:filter", (request: any) => request.offerCommand?.((event: { text: string }) => {
		if (event.text !== "/skill:same") return undefined;
		if (disabled) throw new Error("Skill same is disabled");
		return { action: "transform", text: `<skill name="same" location="${project}">\nPROJECT BODY\n</skill>` };
	}));
	try {
		run.commands.push({ source: "skill", name: "skill:same", description: "User", sourceInfo: { path: user, source: "test", scope: "user", origin: "top-level", baseDir: join(w.base, "codex/skills/same") } });
		await run.execute({ action: "start", task: "/skill:same", tools: [] });
		await run.live.wait(new AbortController().signal);
		assert.match(userText(run.requests[0]), /PROJECT BODY/);
		assert.doesNotMatch(userText(run.requests[0]), /USER BODY/);
		disabled = true;
		await assert.rejects(run.execute({ action: "send", id: "agent#1", task: "/skill:same" }), /Skill same is disabled/);
		await assert.rejects(run.execute({ action: "restart", id: "agent#1", task: "/skill:same" }), /Skill same is disabled/);
		assert.equal(run.requests.length, 1);
		await run.execute({ action: "send", id: "agent#1", task: "still running" });
		await run.live.wait(new AbortController().signal);
		assert.equal(userText(run.requests[1]), "still running");
	} finally { run.live.close(); }
});

test("restored child expands a new skill command on the core path", async t => {
	const w = await world(t);
	const path = await w.put("skill/SKILL.md", "---\nname: example\ndescription: Example\n---\nRESTORED BODY\n");
	const first = runtime(w.cwd, w.base);
	first.parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	first.commands.push({ source: "skill", name: "skill:example", description: "Example", sourceInfo: { path, source: "test", scope: "project", origin: "top-level", baseDir: w.base } });
	await first.execute({ action: "start", task: "initial", tools: [] });
	await first.live.wait(new AbortController().signal);
	const file = first.parent.getSessionFile()!;
	first.live.close();
	const restored = runtime(w.cwd, w.base, "off", [], [], SessionManager.open(file));
	try {
		restored.commands.push(...first.commands);
		await restored.execute({ action: "send", id: "agent#1", task: "/skill:example restored" });
		await restored.live.wait(new AbortController().signal);
		assert.match(userText(restored.requests[0]), /RESTORED BODY[\s\S]*restored$/);
	} finally { restored.live.close(); }
});
