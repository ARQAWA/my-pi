import assert from "node:assert/strict";
import { after, it } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { call, fail, isTask, reportTimings, text, world } from "./synthetic/world.ts";
import { untilWake } from "./synthetic/wake.ts";

after(() => reportTimings(import.meta.filename));

type World = Awaited<ReturnType<typeof world>>;

/** The text of the tool result the model saw in a request after `toolCallId`. */
function toolResultText(w: World, toolCallId: string): string {
	const result = w.requests.flatMap((request) => request.context.messages).findLast((message) => message.role === "toolResult" && message.toolCallId === toolCallId) as any;
	return JSON.stringify(result?.content ?? "");
}

const userTexts = (entries: any[]): string[] =>
	entries.filter((entry) => entry.type === "message" && entry.message.role === "user").map((entry) => entry.message.content[0].text);

const lastAssistantText = (entries: any[]): string =>
	entries.filter((entry) => entry.type === "message" && entry.message.role === "assistant").at(-1).message.content[0].text;

it("start: the child works on its task, its answer reaches the model, the screen and its own session file", async (t) => {
	const w = await world(t);
	w.model.when(isTask("count files"), text("three files"));
	w.model.script(
		call("agent", { action: "start", task: "count files", title: "Count" }, "a1"),
		text("started"),
		text("child said three"),
	);
	await w.submit("go");
	const delivered = await untilWake(w);

	w.see("child said three");
	assert.match(toolResultText(w, "a1"), /agent#1 started/);
	assert.match(delivered, /three files/);
	const [file] = w.childFiles(1);
	assert.equal(lastAssistantText(w.jsonl(file)), "three files");
	assert.deepEqual(userTexts(w.jsonl(file)), ["count files"]);
	assert.deepEqual(w.errors, []);
});

it("resume retries a child whose last request failed, after a restart, without a new message", async (t) => {
	const w = await world(t);
	w.model.when(isTask("fix"), fail("network down"));
	w.model.script(call("agent", { action: "start", task: "fix", title: "Fix" }, "c1"), text("started"), text("the child failed"));
	await w.submit("go");
	assert.match(await untilWake(w), /network down/);
	w.see("the child failed");

	const w2 = await w.restart();
	w2.model.when(isTask("fix"), text("fixed"));
	w2.model.script(
		call("agent", { action: "resume", id: "agent#1" }, "c2"),
		text("resumed"),
		text("done"),
	);
	await w2.submit("retry");
	assert.match(await untilWake(w2), /fixed/);

	w2.see("done");
	const child = w2.jsonl(w2.childFiles(1)[0]);
	assert.deepEqual(userTexts(child), ["fix"]);
	assert.equal(lastAssistantText(child), "fixed");
	assert.equal(w2.requests.filter((request) => request.background === undefined && isTask("fix")(request)).length, 1);
});

it("send to a running child steers it: the message joins its next request after the current tool call", async (t) => {
	const w = await world(t);
	const first = w.model.hold(isTask("long job"));
	w.model.when(isTask("long job"), text("done with both"));
	w.model.script(
		call("agent", { action: "start", task: "long job", title: "Long" }, "s1"),
		call("agent", { action: "send", id: "agent#1", task: "also check b" }, "s2"),
		text("sent"),
	);
	await w.submit("go");
	await w.until(() => first.arrived, "the child's first request");
	assert.match(toolResultText(w, "s2"), /agent#1/);

	// The child's answer is one tool call; steering arrives after it, before the child's next request.
	first.reply(call("agent", { action: "status", ids: ["agent#99"] }, "k1"));
	await w.until(() => w.requests.filter(isTask("long job")).length === 2, "the child's second request");

	const [firstRequest, secondRequest] = w.requests.filter(isTask("long job"));
	assert.equal(firstRequest.options?.signal?.aborted, false, "send aborts nothing");
	assert.doesNotMatch(JSON.stringify(firstRequest.context.messages), /also check b/);
	assert.match(JSON.stringify(secondRequest.context.messages), /also check b/);

	await w.settle();
});

it("late skill steering preserves reviewer text and expands for ordinary children", async t => {
	const w = await world(t, { beforeExtensions: [{ name: "test-skill", factory: pi => {
		pi.on("resources_discover", event => {
			const dir = join(event.cwd, "test-skill");
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "SKILL.md"), "---\nname: lateprobe\ndescription: Late steering probe\n---\nLATE SKILL BODY\n");
			return { skillPaths: [dir] };
		});
	} }] });
	const reviewer = fileURLToPath(new URL("../extensions/RQW-review/REVIEWER.md", import.meta.url));
	const runner = w.session.extensionRunner;
	const invoke = (id: string, params: any) => runner.getToolDefinition("agent")!.execute(id, params, new AbortController().signal, undefined, runner.createToolContext(id, undefined));
	for (const [id, role] of [[1, reviewer], [2, undefined]] as const) {
		const task = `parent ${id}`;
		const nestedTask = `nested ${id}`;
		const nested = w.model.hold(isTask(nestedTask));
		w.model.when(isTask(task), call("agent", { action: "start", task: nestedTask }, `nested-${id}`), text("waiting"), text("steered"));
		await invoke(`start-${id}`, { action: "start", task, ...(role ? { role_file: role } : {}) });
		await w.until(() => nested.arrived && w.childFiles(id).some(file => w.jsonl(file).some(entry => entry.type === "custom" && entry.customType === "rqw-agent-waiting")), "child turn settled while nested agent runs");
		await invoke(`send-${id}`, { action: "send", id: `agent#${id}`, task: "/skill:lateprobe argument" });
		await w.until(() => w.requests.filter(isTask(task)).length >= 3, "late steering request");
		const request = w.requests.filter(isTask(task)).at(-1)!;
		const user = request.context.messages.filter(message => message.role === "user").at(-1)!;
		const userText = Array.isArray(user.content) ? (user.content[0] as { text: string }).text : user.content;
		if (role) assert.equal(userText, "/skill:lateprobe argument");
		else assert.match(userText, /LATE SKILL BODY[\s\S]*argument$/);
		nested.reply(text("done"));
	}
});

it("send to a running child restored after a restart is queued in its session, like a fresh child's", async (t) => {
	const w = await world(t);
	w.model.when(isTask("fix"), fail("network down"));
	w.model.script(call("agent", { action: "start", task: "fix", title: "Fix" }, "c1"), text("started"), text("the child failed"));
	await w.submit("go");
	assert.match(await untilWake(w), /network down/);

	const w2 = await w.restart();
	const child = w2.model.hold(isTask("fix"));
	w2.model.script(call("agent", { action: "resume", id: "agent#1" }, "c2"), text("resumed"));
	await w2.submit("retry");
	await w2.until(() => child.arrived, "the restored child's request");

	// The public steer of the child's session is the one entry that announces the queued message to every listener.
	const steered: string[] = [];
	const steer = AgentSession.prototype.steer;
	t.mock.method(AgentSession.prototype, "steer", function (this: AgentSession, message: string, ...rest: unknown[]) { steered.push(message); return (steer as any).call(this, message, ...rest); });
	w2.model.script(call("agent", { action: "send", id: "agent#1", task: "also check docs" }, "c3"), text("sent"));
	await w2.submit("steer it");
	assert.deepEqual(steered, ["also check docs"]);

	// Delivered once, after the child's current tool call, nothing aborted.
	w2.model.when(isTask("fix"), text("fixed"));
	child.reply(call("agent", { action: "status", ids: ["agent#99"] }, "k1"));
	await w2.until(() => w2.requests.filter(isTask("fix")).length === 2, "the restored child's second request");
	const [firstRequest, secondRequest] = w2.requests.filter(isTask("fix"));
	assert.equal(firstRequest.options?.signal?.aborted, false, "send aborts nothing");
	assert.doesNotMatch(JSON.stringify(firstRequest.context.messages), /also check docs/);
	assert.equal(JSON.stringify(secondRequest.context.messages).split("also check docs").length - 1, 1);
	await w2.settle();
	assert.deepEqual(w2.errors, []);
});
