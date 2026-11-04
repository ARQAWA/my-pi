import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { runtime, world } from "./fixture.ts";

const MAIN_MODEL = "persist-test/model";
const prompt = (model: string) => `intro\n<workstation>\n- OS: test\n- Model: ${model}\n</workstation>\nrest`;
const MAIN = prompt(MAIN_MODEL);
const OWN = prompt("persist-test/other");

async function started(t: any, extra: Record<string, unknown>, task = "task") {
	const w = await world(t);
	const run = runtime(w.cwd, w.base, "off", [], [], undefined, MAIN);
	// A session file is written only once it holds a user message.
	run.parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	await run.emit("session_start");
	await run.execute({ action: "start", task, tools: [], ...extra });
	await run.live.wait(new AbortController().signal);
	return { w, run };
}

test("a child that inherits the caller prompt reads its own model in the Model line", async t => {
	const { run } = await started(t, { model: "persist-test/other" });
	const system = run.systemOf("task");
	assert.ok(system.includes(OWN));
	assert.ok(!system.includes(MAIN));
	run.live.close();
});

test("a child on the caller's model keeps the line as it is", async t => {
	const { run } = await started(t, {});
	assert.ok(run.systemOf("task").includes(MAIN));
	run.live.close();
});

test("an own system prompt is not touched", async t => {
	const { run } = await started(t, { model: "persist-test/other", system: MAIN });
	const system = run.systemOf("task");
	assert.ok(system.startsWith(MAIN));
	assert.ok(!system.includes(OWN));
	run.live.close();
});

test("a restart onto another model gives the line of that model", async t => {
	const { run } = await started(t, {});
	await run.execute({ action: "restart", id: "agent#1", task: "again", tools: [], model: "persist-test/other" });
	await run.live.wait(new AbortController().signal);
	assert.ok(run.systemOf("again").includes(OWN));
	run.live.close();
});

test("a restored child saved with the caller's line reads its own model after a send", async t => {
	const { w, run } = await started(t, { model: "persist-test/other" });
	const file = run.parent.getSessionFile()!;
	run.live.close();
	// A child saved before this change carries the caller's line.
	await writeFile(file, (await readFile(file, "utf8")).replaceAll(`- Model: persist-test/other`, `- Model: ${MAIN_MODEL}`));
	const second = runtime(w.cwd, w.base, "off", [], [], SessionManager.open(file), MAIN);
	await second.emit("session_start");
	await second.execute({ action: "send", id: "agent#1", task: "after restore" });
	await second.live.wait(new AbortController().signal);
	// The restored child answers on its old history, so the request is the last one.
	const system = second.requests.at(-1).messages.find((m: any) => m.role === "system").content as string;
	assert.ok(system.includes(OWN));
	assert.ok(!system.includes(MAIN));
	second.live.close();
});
