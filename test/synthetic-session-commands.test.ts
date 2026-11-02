import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { after, it, type TestContext } from "node:test";
import { call, isTask, keys, reportTimings, text, world } from "./synthetic/world.ts";
import { untilWake } from "./synthetic/wake.ts";

after(() => reportTimings(import.meta.filename));

type World = Awaited<ReturnType<typeof world>>;

/** One project folder of Pi's history below the agent folder, the place `/cleanup` looks in. */
const historyFolder = (w: World) => join(w.dirs.agent, "sessions", "--project--");

/** The command reads folders on real disk, so its notice comes a few turns after the session settles. */
const shows = (w: World, notice: string) => w.until(() => w.screen().join("\n").includes(notice), `the notice "${notice}"`);

function plantTree(folder: string, name: string): string {
	const tree = join(folder, `${name}.jsonl.children`, "agent-1");
	mkdirSync(tree, { recursive: true });
	writeFileSync(join(tree, "child.jsonl"), "{}\n");
	return join(folder, `${name}.jsonl.children`);
}

/** Linux without a display has no clipboard tool: Pi then answers `/copy-session` with the OSC 52 escape on stdout. Nothing touches the real clipboard. */
function headlessLinux(t: TestContext): { writes: string[] } {
	const writes: string[] = [];
	const environment = { ...process.env };
	for (const name of ["DISPLAY", "WAYLAND_DISPLAY", "TERMUX_VERSION", "WSL_DISTRO_NAME", "WSL_INTEROP"]) delete process.env[name];
	t.mock.method(os, "platform", () => "linux");
	t.mock.method(process.stdout, "write", (chunk: unknown) => { writes.push(String(chunk)); return true; });
	syncBuiltinESMExports();
	t.after(() => Object.assign(process.env, environment));
	return { writes };
}

it("/copy-session copies the session id and says so", async (t) => {
	const w = await world(t);
	const clipboard = headlessLinux(t);
	await w.submit("/copy-session");

	const id = w.session.sessionManager.getSessionId();
	w.see(`Session ID copied: ${id}`);
	assert.ok(clipboard.writes.some((chunk) => chunk === `\x1b]52;c;${Buffer.from(id).toString("base64")}\x07`), "the id went out as OSC 52");
});

it("/remove asks first and answering No keeps the session file and the chat", async (t) => {
	const w = await world(t);
	w.model.script(text("an answer"));
	await w.submit("a question");
	const file = w.sessionFile!;

	w.type("/remove");
	w.press(keys.enter);
	await w.until(() => w.screen().join("\n").includes("Delete this session?"), "the question shows");
	w.press(keys.enter);
	await w.settle();

	assert.ok(existsSync(file), "the file stays");
	assert.equal(w.sessionFile, file, "the chat stays");
	w.see("an answer");
	w.notSee("Delete this session?");
});

it("/remove with Yes starts a fresh chat and deletes only the session file", async (t) => {
	const w = await world(t);
	w.model.script(text("an answer"));
	await w.submit("a question");
	const file = w.sessionFile!;
	const children = `${file}.children`;
	mkdirSync(children, { recursive: true });
	w.processes.reply((call) => call.command === "trash" && call.args[0] === file, { code: 1, stderr: "unavailable" });

	w.type("/remove");
	w.press(keys.enter);
	await w.until(() => w.screen().join("\n").includes("Delete this session?"), "the question shows");
	w.press(keys.down);
	w.press(keys.enter);
	await w.until(() => w.sessionFile !== file && !existsSync(file), "fresh chat and deleted file");
	await shows(w, "Session deleted");
	assert.ok(existsSync(children), "the child tree stays");
	assert.deepEqual(w.processes.calls.filter((call) => call.command === "trash").map((call) => call.args), [[file]]);
	assert.deepEqual(w.processAttempts, []);
});

it("/cleanup removes a child tree whose session file is gone and keeps live trees and the current one", async (t) => {
	const w = await world(t);
	w.model.when(isTask("count files"), text("three"));
	w.model.script(call("agent", { action: "start", task: "count files" }, "a1"), text("waiting"), text("done"));
	await w.submit("go");
	await untilWake(w);
	const [childFile] = w.childFiles(1);
	assert.ok(childFile, "the current session has a child tree");

	const folder = historyFolder(w);
	const orphan = plantTree(folder, "orphan");
	const live = plantTree(folder, "live");
	writeFileSync(join(folder, "live.jsonl"), "");
	await w.submit("/cleanup");

	await shows(w, "Cleanup removed 1 orphaned child session folders");
	assert.ok(!existsSync(orphan), "the orphan tree is removed");
	assert.ok(existsSync(live), "a tree with its session file stays");
	assert.ok(existsSync(childFile), "the current session's tree stays");
});

it("/cleanup with nothing to remove says so", async (t) => {
	const w = await world(t);
	await w.submit("/cleanup");

	await shows(w, "Nothing to clean");
});
