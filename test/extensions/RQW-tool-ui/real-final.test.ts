import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { buildTurns, FINAL_ENTRY, messageKey, TurnIndex } from "../../../extensions/RQW-tool-ui/groups.ts";
import { assistant, load, makeHost, makeScreen, Session, text, user } from "./fold-host.ts";

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const labels = (entries: readonly SessionEntry[]) => [...buildTurns(entries).values()];

function history(marks: { final: boolean; key?: string }[], rest: (s: Session) => void) {
	const s = new Session();
	cleanups.push(() => s.end());
	s.add(user("go", 0), 0);
	s.add(assistant([text("work")], "toolUse", 1), 1_000);
	const first = assistant([text("first answer")], "stop", 2);
	s.add(first, 5_000);
	for (const mark of marks) s.manager.appendCustomEntry(FINAL_ENTRY, { key: mark.key ?? messageKey(first), final: mark.final });
	rest(s);
	return s;
}

const second = (s: Session) => {
	s.card("late child result", 60_000);
	s.add(assistant([text("second answer")], "stop", 61), 64_000);
};

it("reads an old not-final mark and joins its span to the next answer", () => {
	assert.deepEqual(labels(history([{ final: false }], second).manager.getBranch()), ["worked for 1m 04s"]);
});

it("reads an old final mark and closes the span on the marked answer", () => {
	assert.deepEqual(labels(history([{ final: false }, { final: true }], second).manager.getBranch()), ["worked for 5s", "worked for 4s"]);
});

it("ignores a mark for another answer", () => {
	assert.deepEqual(labels(history([{ final: false, key: "assistant@999@" }], second).manager.getBranch()), ["worked for 5s", "worked for 4s"]);
});

it("ignores a final mark after later messages", () => {
	const s = history([{ final: false }], (h) => {
		h.card("late child result", 60_000);
		h.manager.appendCustomEntry(FINAL_ENTRY, { key: messageKey(assistant([text("first answer")], "stop", 2)), final: true });
	});
	assert.deepEqual(labels(s.manager.getBranch()), []);
});

it("an automatic wait is a boundary after an old not-final answer", () => {
	const s = history([{ final: false }], session => {
		session.manager.appendCustomEntry("rqw-auto-wait-v1", { version: 1, waitId: "one", phase: "open", targets: ["agent#1"] });
		session.card("later work", 60_000);
		session.add(assistant([text("later answer")], "stop", 61), 64_000);
	});
	const index = new TurnIndex();
	index.append(s.manager.getBranch());
	assert.equal(index.prefixes.size, 1);
	assert.deepEqual([...index.finals.values()].map(span => span.label), ["worked for 4s"]);
});

it("keeps the final answer visible across an automatic wait while folding intermediate work", () => {
	const session = new Session();
	cleanups.push(() => session.end());
	session.add(user("prompt", 0), 0);
	session.add(assistant([text("intermediate work")], "toolUse", 1_000), 1_000);
	session.add(assistant([text("turn final answer")], "stop", 2_000), 5_000);
	session.manager.appendCustomEntry("rqw-auto-wait-v1", { version: 1, waitId: "one", phase: "open", targets: ["agent#1"] });
	session.card("delivered result", 10_000);
	session.add(assistant([text("next final answer")], "stop", 11_000), 12_000);
	const loaded = load();
	cleanups.push(() => loaded.shutdown());
	const screen = makeScreen();
	const host = makeHost(session.manager, loaded, screen.screen);
	(host as any).runtimeHost.session.extensionRunner.getEntryRenderer = () => () => ({ render: () => ["wait agent#1"], invalidate() {} });
	host.renderInitialMessages();
	loaded.start(session.manager);
	screen.screen.addChild(host.chatContainer);
	screen.screen.start();
	cleanups.push(() => screen.stop());
	const rows = screen.frame();
	assert.ok(rows.some(row => row.includes("wait agent#1")));
	assert.ok(rows.some(row => row.includes("turn final answer")));
	assert.ok(rows.some(row => row.includes("next final answer")));
	assert.ok(!rows.some(row => row.includes("intermediate work")));
	assert.ok(!rows.some(row => row.includes("delivered result")));
	assert.equal(rows.filter(row => row.includes("worked for")).length, 2);
});

it("includes a long wait and old history in one fold despite live background counts", () => {
	const session = new Session();
	cleanups.push(() => session.end());
	const loaded = load();
	cleanups.push(() => loaded.shutdown());
	const screen = makeScreen();
	const host = makeHost(session.manager, loaded, screen.screen) as unknown as ReturnType<typeof makeHost> & { addMessageToChat(message: unknown): void };
	host.renderInitialMessages();
	loaded.start(session.manager);
	screen.screen.addChild(host.chatContainer);
	screen.screen.start();
	cleanups.push(() => screen.stop());
	const listeners = new Set<(value: unknown) => void>();
	loaded.events.emit("rqw:running-counts:offer", { version: 1, source: {
		version: 1, snapshot: () => ({ agents: 1, backgroundProcesses: 1 }),
		subscribe: (listener: (value: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
	} });
	const add = (message: unknown, at: number) => { session.add(message, at); host.addMessageToChat(message); };
	add(user("go", 0), 0);
	add(assistant([text("old work")], "toolUse", 200), 200);
	const oldAnswer = assistant([text("old answer")], "stop", 500);
	add(oldAnswer, 500);
	session.manager.appendCustomEntry(FINAL_ENTRY, { key: messageKey(oldAnswer), final: false });
	add(assistant([{ type: "toolCall", id: "wait", name: "agent", arguments: { action: "wait", ids: ["agent#1"] } }], "toolUse", 1_000), 1_000);
	assert.ok(!screen.frame().some(row => row.includes("worked for")));
	session.add({ role: "toolResult", toolCallId: "wait", toolName: "agent", content: [text("done")], isError: false, timestamp: 125_000 }, 125_000);
	add(assistant([text("answer")], "stop", 126_000), 126_000);
	loaded.handlers.get("agent_settled")!({ type: "agent_settled", aborted: false });
	const rows = screen.frame();
	assert.equal(rows.filter(row => row.includes("worked for")).length, 1);
	assert.ok(rows.some(row => row.includes("worked for 2m 06s")));
	assert.ok(rows.some(row => row.includes("answer")));
	assert.ok(!rows.some(row => row.includes("old answer")));
	assert.deepEqual(loaded.appended, []);
	for (const listener of listeners) listener({ agents: 0, backgroundProcesses: 0 });
	assert.ok(screen.frame().some(row => row.includes("worked for 2m 06s")));
	assert.deepEqual(loaded.appended, []);
});
