import assert from "node:assert/strict";
import { after, it } from "node:test";
import { simulateRipgrep, type VFile } from "./extensions/RQW-tools/rg-fake.ts";
import { bashCommand, call, isTask, reportTimings, ripgrep, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

type World = Awaited<ReturnType<typeof world>>;

/** The tool result the model saw in its request after `toolCallId`. */
function toolResultText(w: World, toolCallId: string): string {
	const result = w.requests.flatMap((request) => request.context.messages).findLast((message) => message.role === "toolResult" && message.toolCallId === toolCallId) as any;
	return JSON.stringify(result?.content ?? "");
}

it("a shell command is answered by its fake process, and only that one", async (t) => {
	const w = await world(t);
	w.processes.reply(bashCommand("echo hello"), { stdout: "hello from the fake\n", code: 0 });
	w.model.script(call("bash", { command: "echo hello" }, "b1"), text("done"));
	await w.submit("run it");
	w.see("done");
	assert.match(toolResultText(w, "b1"), /hello from the fake/);
	assert.deepEqual(w.processes.calls.map((spawned) => spawned.args.at(-1)), ["echo hello"]);
	assert.deepEqual(w.processAttempts, []);
});

it("a shell command without a fake process fails the call and is recorded as blocked", async (t) => {
	const w = await world(t);
	w.model.script(call("bash", { command: "rm -rf /" }, "b1"), text("done"));
	await w.submit("run it");
	assert.match(toolResultText(w, "b1"), /process blocked/);
	assert.equal(w.processAttempts.length, 1);
});

it("a failing command reports its exit code to the model", async (t) => {
	const w = await world(t);
	w.processes.reply(bashCommand("make"), { stderr: "no rule\n", code: 2 });
	w.model.script(call("bash", { command: "make" }, "b1"), text("done"));
	await w.submit("build");
	assert.match(toolResultText(w, "b1"), /no rule/);
	assert.match(toolResultText(w, "b1"), /code 2/);
});

it("a held process keeps the tool call open until the test finishes it", async (t) => {
	const w = await world(t);
	const run = w.processes.hold(bashCommand("sleep"));
	w.model.script(call("bash", { command: "sleep 5" }, "b1"), text("done"));
	w.type("wait for it");
	w.press("\r");
	await w.until(() => run.arrived, "the process starts");
	w.notSee("done");
	run.finish({ stdout: "woke up\n" });
	await w.settle();
	w.see("done");
	assert.match(toolResultText(w, "b1"), /woke up/);
});

it("ripgrep is answered from a simulated tree through the real rqw_rg tool", async (t) => {
	const w = await world(t);
	const tree: VFile[] = [{ path: "src/a.ts", text: "const needle = 1;\nconst other = 2;\n" }, { path: "src/b.ts", text: "nothing here\n" }];
	w.processes.reply(ripgrep, (spawned) => simulateRipgrep(tree, w.dirs.project, spawned.args, spawned.cwd ?? w.dirs.project));
	w.model.script(call("rqw_rg", { pattern: "needle", output_mode: "files_with_matches" }, "g1"), text("searched"));
	await w.submit("find it");
	w.see("searched");
	assert.match(toolResultText(w, "g1"), /src\/a\.ts/);
	assert.doesNotMatch(toolResultText(w, "g1"), /src\/b\.ts/);
});

it("a restart continues the same session file: the screen, the file and the next request carry the history", async (t) => {
	const w = await world(t);
	w.model.script(text("first answer"));
	await w.submit("first question");
	const file = w.sessionFile;
	assert.ok(file);

	const w2 = await w.restart();
	assert.equal(w2.sessionFile, file);
	w2.see("first answer");
	w2.model.script(text("second answer"));
	await w2.submit("second question");
	w2.see("second answer");

	const roles = w2.jsonl().filter((entry) => entry.type === "message" && entry.message.role !== "system").map((entry) => entry.message.role);
	assert.deepEqual(roles, ["user", "assistant", "user", "assistant"]);
	const lastRequest = w2.requests.filter((request) => request.background === undefined).at(-1)!;
	assert.match(JSON.stringify(lastRequest.context.messages), /first question/);
});

it("a subagent's session file is found under the parent's children folder", async (t) => {
	const w = await world(t);
	w.model.when(isTask("count files"), text("three files"));
	w.model.script(call("agent", { action: "start", task: "count files" }, "a1"), call("agent", { action: "wait", ids: ["agent#1"] }, "a2"), text("child said three"));
	await w.submit("go");
	w.see("child said three");
	const [file] = w.childFiles(1);
	assert.ok(file, "the child has a session file");
	const reply = w.jsonl(file).filter((entry) => entry.type === "message" && entry.message.role === "assistant").at(-1);
	assert.equal(reply.message.content[0].text, "three files");
});
