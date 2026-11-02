import assert from "node:assert/strict";
import { after, it } from "node:test";
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
