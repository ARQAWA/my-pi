import assert from "node:assert/strict";
import { after, it } from "node:test";
import { call, isTask, keys, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

type World = Awaited<ReturnType<typeof world>>;

const RESULTS = "rqw-auto-wait-results";
const customEntries = (w: World, type: string) => w.jsonl().filter((entry) => entry.type === "custom" && entry.customType === type);

/** The results the hidden wake message carries, when the request ends with it. */
function wakeResults(request: World["requests"][number]): { id: string; text: string }[] | undefined {
	const last = request.context.messages.at(-1) as { role: string; content: { text: string }[] };
	if (last.role !== "user" || !last.content[0]?.text.startsWith('{"results"')) return undefined;
	return JSON.parse(last.content[0].text).results;
}
/** True once the child's result is stored in the session, which is when RQW-agent hands it to the waiting sources. */
const resultStored = (w: World) => w.jsonl().some((entry) => entry.type === "custom" && entry.customType === "rqw-agent-child" && entry.data.result);
const wakeRequests = (w: World) => w.requests.filter((request) => wakeResults(request) !== undefined);

it("while a child runs the chat shows one wait card with the child's id and title", async (t) => {
	const w = await world(t);
	const child = w.model.hold(isTask("count files"));
	w.model.script(call("agent", { action: "start", task: "count files", title: "Count" }, "c1"), text("started"));
	await w.submit("go");
	await w.until(() => child.arrived, "the child's request");

	w.see("wait 1 агент");
	w.see("agent#1 Count");
	w.see("Ждём готовый результат.");
	assert.equal(customEntries(w, "rqw-auto-wait-v1").filter((entry) => entry.data.phase === "open").length, 1);
});

it("a result that is ready when the turn settles wakes the chat with one hidden message and one request", async (t) => {
	const w = await world(t);
	w.model.when(isTask("count files"), text("3"));
	// The main chat's request after the tool result waits until the child's result is stored, so the turn settles with it ready.
	const afterStart = w.model.hold((request) => request.background === undefined && !isTask("count files")(request) && request.context.messages.some((message) => message.role === "toolResult"));
	w.model.script(call("agent", { action: "start", task: "count files", title: "Count" }, "c1"), text("child said 3"));
	w.type("go");
	w.press(keys.enter);
	await w.until(() => afterStart.arrived && resultStored(w), "the child's result is stored");
	afterStart.reply(text("started"));
	await w.until(() => wakeRequests(w).length === 1, "the wake request");
	await w.settle();

	w.see("child said 3");
	assert.equal(wakeRequests(w).length, 1, "one wake request carries the result");
	const [result] = wakeResults(wakeRequests(w)[0])!;
	assert.equal(result.id, "agent#1");
	assert.match(result.text, /^3\n\nPerform any necessary follow-up/);
	const saved = w.jsonl().filter((entry) => entry.type === "custom_message" && entry.customType === RESULTS);
	assert.equal(saved.length, 1);
	assert.equal(saved[0].display, false);
	assert.deepEqual(w.model.unscripted, []);
});

it("a message from the user closes the wait card as interrupted, the child keeps working and the card comes back", async (t) => {
	const w = await world(t);
	const child = w.model.hold(isTask("count files"));
	w.model.script(call("agent", { action: "start", task: "count files", title: "Count" }, "c1"), text("started"), text("other answered"));
	await w.submit("go");
	await w.submit("something else");

	w.see("прервано вводом");
	w.see("Работа агентов продолжается.");
	w.see("other answered");
	assert.deepEqual(customEntries(w, "rqw-auto-wait-v1").filter((entry) => entry.data.phase === "close").map((entry) => entry.data.reason), ["input"]);
	// The child was not stopped: it still waits for its answer, and a new open card follows the turn.
	await w.until(() => child.arrived, "the child's request");
	assert.equal(customEntries(w, "rqw-auto-wait-v1").filter((entry) => entry.data.phase === "open").length, 2);
	assert.equal(w.requests.filter((request) => request.background === undefined && isTask("count files")(request)).length, 1);
});

it("a child that finishes while the chat is idle wakes it once", async (t) => {
	const w = await world(t);
	const child = w.model.hold(isTask("count files"));
	w.model.script(call("agent", { action: "start", task: "count files", title: "Count" }, "c1"), text("started"), text("child said 3"));
	await w.submit("go");
	child.reply(text("3"));
	await w.until(() => wakeRequests(w).length === 1, "the wake request");
	await w.settle();

	w.see("child said 3");
	assert.equal(wakeRequests(w).length, 1);
});

it("a result that is ready exactly when Pi reloads starts no wake request after the reload", async (t) => {
	const w = await world(t);
	w.model.when(isTask("count files"), text("3"));
	const afterStart = w.model.hold((request) => request.background === undefined && !isTask("count files")(request) && request.context.messages.some((message) => message.role === "toolResult"));
	w.model.script(call("agent", { action: "start", task: "count files", title: "Count" }, "c1"), text("child said 3"));
	// The reload begins in the same tick in which the wake message is handed to the session.
	let reloaded: Promise<void> | undefined;
	const send = w.session.sendCustomMessage.bind(w.session);
	t.mock.method(w.session, "sendCustomMessage", (message: { customType?: string }, options?: object) => {
		const started = send(message as never, options as never);
		if (message.customType === RESULTS) reloaded ??= w.session.reload();
		return started;
	});
	w.type("go");
	w.press(keys.enter);
	await w.until(() => afterStart.arrived && resultStored(w), "the child's result is stored");
	afterStart.reply(text("started"));
	await w.until(() => reloaded !== undefined, "the wake message is sent");
	await reloaded;
	await w.settle();

	assert.equal(wakeRequests(w).length, 0);
	assert.deepEqual(w.model.unscripted, []);
});
