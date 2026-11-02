import assert from "node:assert/strict";
import { after, it } from "node:test";
import { call, isTask, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

const RULE = "## Communication\n\nThe user has dyslexia.";
const OVERRIDE = "This rule overrides every other rule about communication: message form, length and style.";

type Message = { role: string; content: string | { type: string; text?: string }[] };
const textOf = (message: Message) => (typeof message.content === "string" ? message.content : message.content.map((block) => block.text ?? "").join(""));

it("the rule follows the user message in the request and is not in the session file", async (t) => {
	const w = await world(t);
	w.model.script(text("ok"));
	await w.submit("hello there");

	const [request] = w.requests.filter((item) => item.background === undefined);
	const messages = request.context.messages as unknown as Message[];
	const at = messages.findIndex((message) => message.role === "user" && textOf(message) === "hello there");
	assert.ok(at >= 0, "the user message is in the request");
	assert.ok(textOf(messages[at + 1]).startsWith(RULE), "the rule comes right after the user message");
	assert.ok(textOf(messages[at + 1]).endsWith(OVERRIDE), "the override sentence closes the block");
	assert.doesNotMatch(JSON.stringify(w.jsonl()), /has dyslexia/);
});

it("the request of a subagent does not carry the rule", async (t) => {
	const w = await world(t);
	w.model.when(isTask("count files"), text("three"));
	w.model.script(call("agent", { action: "start", task: "count files" }, "a1"), call("agent", { action: "wait", ids: ["agent#1"] }, "a2"), text("done"));
	await w.submit("go");

	const child = w.requests.find((request) => isTask("count files")(request));
	assert.ok(child, "the child asked the model");
	assert.doesNotMatch(JSON.stringify(child.context.messages), /has dyslexia/);
	const mainRequests = w.requests.filter((request) => request.background === undefined && !isTask("count files")(request));
	assert.match(JSON.stringify(mainRequests.at(-1)!.context.messages), /has dyslexia/);
});
