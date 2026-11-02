import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, it } from "node:test";
import { bashCommand, call, keys, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

type World = Awaited<ReturnType<typeof world>>;

/** Requests of the conversation, without the naming request the world answers on its own. */
const turns = (w: World) => w.requests.filter((request) => request.background === undefined);

/** The tool result the model saw in its requests for `toolCallId`. */
function toolResultText(w: World, toolCallId: string): string {
	const result = w.requests.flatMap((request) => request.context.messages).findLast((message) => message.role === "toolResult" && message.toolCallId === toolCallId) as any;
	return JSON.stringify(result?.content ?? "");
}

it("rqw_readfile numbers every tenth line like Cursor", async (t) => {
	const w = await world(t);
	const file = join(w.dirs.project, "lines.txt");
	writeFileSync(file, Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"));
	w.model.script(call("rqw_readfile", { path: file, offset: null, limit: null }, "r1"), text("read it"));
	await w.submit("read the file");

	w.see("read it");
	const result = toolResultText(w, "r1");
	assert.match(result, /line 9\\n\s+10\|line 10\\n/);
	assert.match(result, /line 1\\n/);
});

it("bash refuses a command that reads a file and starts no process", async (t) => {
	const w = await world(t);
	w.model.script(call("bash", { command: "cat package.json" }, "b1"), text("refused"));
	await w.submit("show it");

	w.see("refused");
	assert.match(toolResultText(w, "b1"), /bash does not search, list or read files/);
	assert.deepEqual(w.processes.calls, []);
	assert.deepEqual(w.processAttempts, []);
});

it("a bash command still running after 12 s becomes job#1 and job wait returns its result", async (t) => {
	const w = await world(t);
	const run = w.processes.hold(bashCommand("sleep 30"));
	w.model.script(
		call("bash", { command: "sleep 30" }, "b1"),
		call("job", { action: "wait", ids: ["job#1"], timeout_ms: 60000 }, "j1"),
		text("job finished"),
	);
	w.type("run it");
	w.press(keys.enter);
	await w.until(() => run.arrived, "the process starts");

	await w.tick(11_000);
	assert.equal(turns(w).length, 1, "before 12 s the call is still open");
	await w.tick(1_000);
	await w.until(() => turns(w).length >= 2, "the model sees the handoff");
	assert.match(toolResultText(w, "b1"), /job#1 \(bash\) is still running after 12 s/);

	run.finish({ stdout: "slept\n" });
	await w.settle();
	w.see("job finished");
	assert.match(toolResultText(w, "j1"), /job#1/);
	assert.match(toolResultText(w, "j1"), /slept/);
});
