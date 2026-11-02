import assert from "node:assert/strict";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { retainedChildManager } from "../extensions/RQW-agent/persistence.ts";
import { after, it } from "node:test";
import { bashCommand, call, isTask, keys, reportTimings, text, world } from "./synthetic/world.ts";

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

it("the open card follows direct children started and stopped while it is visible", async (t) => {
	const w = await world(t);
	const first = w.model.hold(isTask("first child"));
	const second = w.model.hold(isTask("second child"));
	const third = w.model.hold(isTask("third child"));
	w.model.script(call("agent", { action: "start", task: "first child", title: "First" }, "c1"), text("started"));
	await w.submit("go");
	await w.until(() => first.arrived, "first child starts");
	w.see("wait 1 агент");

	const main = w.model.hold(request => JSON.stringify(request.context.messages).includes("external wake"));
	const busy = w.session.sendCustomMessage({ customType: "external-wake", content: "external wake", display: false }, { triggerTurn: true });
	await w.until(() => main.arrived, "main chat starts without user input");
	const runner = w.session.extensionRunner;
	const tool = runner.getToolDefinition("agent")!;
	const invoke = (args: object) => tool.execute("external", args as never, new AbortController().signal, undefined, runner.createToolContext("external", undefined));
	await invoke({ action: "start", task: "second child", title: "Second" });
	await w.until(() => second.arrived, "second child starts");
	await w.tick(16);
	await w.until(() => w.host.renderer.getScreenLines().some((line: string) => stripTerminalSequences(line).includes("wait 2 агента")), "card repaints after start");
	w.see("agent#2 Second");
	assert.equal(customEntries(w, "rqw-auto-wait-v1").filter(entry => entry.data.phase === "open").length, 1);

	await invoke({ action: "stop", id: "agent#2" });
	await w.until(() => true, "stop notification arrives");
	await w.tick(16);
	await w.until(() => w.host.renderer.getScreenLines().some((line: string) => stripTerminalSequences(line).includes("wait 1 агент")), "card repaints after stop");
	w.notSee("agent#2 Second");
	await invoke({ action: "stop", id: "agent#1" });
	await w.until(() => !w.screen().join("\n").includes("wait 1 агент"), "card closes after last stop");
	await invoke({ action: "start", task: "third child", title: "Third" });
	await w.until(() => third.arrived, "third child starts");
	assert.equal(customEntries(w, "rqw-auto-wait-v1").filter(entry => entry.data.phase === "open").length, 1);
	main.reply(text("done"));
	await busy;
	await w.until(() => w.screen().join("\n").includes("agent#3 Third"), "card returns after the chat settles");
	await invoke({ action: "stop", id: "agent#3" });
	await w.until(() => [1, 2, 3].every(id => !retainedChildManager(w.session.sessionManager, "agent", id)), "stopped children close");
});

it("a delivered child stays idle and is excluded from the active counts", async (t) => {
	const w = await world(t);
	const active = w.model.hold(isTask("active child"));
	const finished = w.model.hold(isTask("finished child"));
	w.model.script(call("agent", { action: "start", task: "active child", title: "Active" }, "c1"), text("started"), text("received"));
	await w.submit("go");
	await w.until(() => active.arrived, "active child starts");
	const runner = w.session.extensionRunner;
	const tool = runner.getToolDefinition("agent")!;
	const invoke = (args: object) => tool.execute("external", args as never, new AbortController().signal, undefined, runner.createToolContext("external", undefined));
	await invoke({ action: "start", task: "finished child", title: "Finished" });
	await w.until(() => finished.arrived, "second child starts");
	w.see("wait 2 агента");
	finished.reply(text("done"));
	await w.until(() => wakeRequests(w).length === 1, "finished child delivered");
	await w.settle();
	w.see("Waiting for 1 agent");
	w.see("1 idle agent");
	const rows = w.screen();
	const card = rows.slice(rows.findIndex(line => line.includes("wait 1 агент")), rows.findIndex(line => line.includes("wait 1 агент")) + 4).join("\n");
	assert.match(card, /agent#1 Active/);
	assert.doesNotMatch(card, /agent#2|2 агента/);
	await invoke({ action: "stop", id: "agent#1" });
	await invoke({ action: "stop", id: "agent#2" });
	await w.until(() => [1, 2].every(id => !retainedChildManager(w.session.sessionManager, "agent", id)), "children close");
});

it("the status counts the active tree, while the card counts only direct children", async (t) => {
	const w = await world(t);
	const parent = w.model.hold(isTask("parent task"));
	const nested = w.model.hold(isTask("nested task"));
	w.model.when(isTask("parent task"), text("parent waiting"));
	w.model.script(call("agent", { action: "start", task: "parent task", title: "Parent" }, "c1"), text("started"));
	await w.submit("go");
	await w.until(() => parent.arrived, "parent starts");
	w.see("wait 1 агент");
	parent.reply(call("agent", { action: "start", task: "nested task", title: "Nested" }, "n1"));
	await w.until(() => nested.arrived, "nested child starts");
	await w.until(() => w.screen().join("\n").includes("Waiting for 2 agents"), "whole tree counted");
	w.see("wait 1 агент");
	w.notSee("agent#1.1 Nested");
	const runner = w.session.extensionRunner;
	await runner.getToolDefinition("agent")!.execute("stop-parent", { action: "stop", id: "agent#1" } as never,
		new AbortController().signal, undefined, runner.createToolContext("stop-parent", undefined));
	await w.until(() => !w.screen().join("\n").includes("Waiting for 2 agents"), "tree stops");
	await w.until(() => !retainedChildManager(w.session.sessionManager, "agent", 1), "parent closes");
});

it("the open card follows a new background job and its delivered result", async (t) => {
	const w = await world(t);
	const child = w.model.hold(isTask("held child"));
	const process = w.processes.hold(bashCommand("sleep 30"));
	w.model.script(call("agent", { action: "start", task: "held child", title: "Held" }, "c1"), text("started"), text("job received"));
	await w.submit("go");
	await w.until(() => child.arrived, "child starts");
	const runner = w.session.extensionRunner;
	const bash = runner.getToolDefinition("bash")!;
	const running = bash.execute("external-bash", { command: "sleep 30" } as never, new AbortController().signal,
		undefined, runner.createToolContext("external-bash", undefined));
	await w.until(() => process.arrived, "process starts");
	await w.tick(12_000);
	await running;
	await w.until(() => w.screen().join("\n").includes("job#1"), "job appears on the card");
	w.see("wait 1 агент, 1 задача");
	assert.equal(customEntries(w, "rqw-auto-wait-v1").filter(entry => entry.data.phase === "open").length, 1);
	process.finish({ stdout: "done\n" });
	await w.until(() => wakeRequests(w).length === 1, "job result delivered");
	await w.settle();
	w.see("wait 1 агент");
	const rows = w.screen();
	const start = rows.findIndex(line => line.includes("wait 1 агент"));
	assert.ok(start >= 0);
	assert.doesNotMatch(rows.slice(start, start + 4).join("\n"), /job#1|задач/);
	const agent = runner.getToolDefinition("agent")!;
	await agent.execute("stop-child", { action: "stop", id: "agent#1" } as never, new AbortController().signal,
		undefined, runner.createToolContext("stop-child", undefined));
	await w.until(() => !retainedChildManager(w.session.sessionManager, "agent", 1), "child closes");
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

/** `other` is an earlier saved session of the same chat folder, the switch's destination. */
const SHUTDOWNS: [string, (w: World, other: string) => Promise<unknown>][] = [
	["reloads", (w) => w.session.reload()],
	["starts a new session", (w) => w.runtime.newSession()],
	["switches to another session", (w, other) => w.runtime.switchSession(other)],
];

for (const [name, shutdown] of SHUTDOWNS) it(`a result that is ready exactly when Pi ${name} starts no wake request afterwards`, async (t) => {
	const w = await world(t);
	w.model.script(text("first chat"));
	await w.submit("first");
	const other = w.sessionFile!;
	await w.runtime.newSession();
	w.model.when(isTask("count files"), text("3"));
	const afterStart = w.model.hold((request) => request.background === undefined && !isTask("count files")(request) && request.context.messages.some((message) => message.role === "toolResult"));
	w.model.script(call("agent", { action: "start", task: "count files", title: "Count" }, "c1"), text("child said 3"));
	// The shutdown begins in the same tick in which the wake message is handed to the session.
	let shutDown: Promise<unknown> | undefined;
	const send = w.session.sendCustomMessage.bind(w.session);
	t.mock.method(w.session, "sendCustomMessage", (message: { customType?: string }, options?: object) => {
		const started = send(message as never, options as never);
		if (message.customType === RESULTS) shutDown ??= shutdown(w, other);
		return started;
	});
	w.type("go");
	w.press(keys.enter);
	await w.until(() => afterStart.arrived && resultStored(w), "the child's result is stored");
	afterStart.reply(text("started"));
	await w.until(() => shutDown !== undefined, "the wake message is sent");
	const outcome = (await shutDown) as { cancelled?: boolean } | undefined;
	await w.settle();

	assert.notEqual(outcome?.cancelled, true, "the shutdown ran");
	if (name.startsWith("switches")) assert.equal(w.sessionFile, other, "the destination session is open");
	assert.equal(wakeRequests(w).length, 0);
	assert.deepEqual(w.model.unscripted, []);
});

it("after a reload the open wait card still draws", async (t) => {
	const w = await world(t);
	const child = w.model.hold(isTask("count files"));
	w.model.script(call("agent", { action: "start", task: "count files", title: "Count" }, "c1"), text("started"));
	await w.submit("go");
	await w.until(() => child.arrived, "the child's request");
	w.see("wait 1 агент");

	await w.session.reload();
	await w.until(() => true, "the reload settles");

	assert.deepEqual(w.errors, []);
	w.see("agent#1 Count");
});
