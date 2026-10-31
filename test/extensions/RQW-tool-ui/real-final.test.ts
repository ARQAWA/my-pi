import assert from "node:assert/strict";
import { afterEach, it, mock } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { buildTurns, FINAL_ENTRY, messageKey } from "../../../extensions/RQW-tool-ui/groups.ts";
import { assistant, load, makeHost, makeScreen, Session, text, user } from "./fold-host.ts";

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const labels = (entries: readonly SessionEntry[]) => [...buildTurns(entries).values()];
const markers = (entries: readonly SessionEntry[]) =>
	entries.filter((e) => e.type === "custom" && e.customType === FINAL_ENTRY).map((e) => (e as { data: unknown }).data);

/** A history: the owner's prompt, work, a first answer, then whatever `rest` adds. `marks` are written after the first answer. */
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

it("an answer marked not final does not close its fold: one fold runs to the real final", () => {
	const s = history([{ final: false }], second);
	assert.deepEqual(labels(s.manager.getBranch()), ["worked for 1m 04s"]);
});

it("without the mark every answer closes its own fold", () => {
	const s = history([], second);
	assert.deepEqual(labels(s.manager.getBranch()), ["worked for 5s", "worked for 4s"]);
});

it("a final: true mark closes the span on the marked answer again, timed to that answer", () => {
	const s = history([{ final: false }, { final: true }], second);
	assert.deepEqual(labels(s.manager.getBranch()), ["worked for 5s", "worked for 4s"]);
});

it("a mark for another answer changes nothing", () => {
	const s = history([{ final: false, key: "assistant@999@" }], second);
	assert.deepEqual(labels(s.manager.getBranch()), ["worked for 5s", "worked for 4s"]);
});

it("a final: true mark that follows later messages changes nothing", () => {
	const s = history([{ final: false }], (h) => {
		h.card("late child result", 60_000);
		h.manager.appendCustomEntry(FINAL_ENTRY, { key: messageKey(assistant([text("first answer")], "stop", 2)), final: true });
	});
	assert.deepEqual(labels(s.manager.getBranch()), []);
});

/** The extension in a fullscreen host, a fake counts producer, and a fake `setTimeout` fired by hand. */
function live() {
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
	screen.frame();
	cleanups.push(() => screen.stop());

	let counts = { agents: 0, backgroundProcesses: 0 };
	const listeners = new Set<(value: unknown) => void>();
	const offer = () => loaded.events.emit("rqw:running-counts:offer", {
		version: 1,
		source: { version: 1, snapshot: () => ({ ...counts }), subscribe: (listener: (value: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); } },
	});
	offer();

	const timers = new Map<number, () => void>();
	let next = 1;
	const set = mock.method(globalThis, "setTimeout", ((fn: () => void) => { timers.set(next, fn); return next++; }) as never);
	const clear = mock.method(globalThis, "clearTimeout", ((id: number) => { timers.delete(id); }) as never);
	cleanups.push(() => { set.mock.restore(); clear.mock.restore(); });

	const add = (message: unknown, at: number) => {
		session.add(message, at);
		host.addMessageToChat(message);
	};
	const rows = () => screen.frame().join("\n");
	return {
		session, loaded, add, rows, timers, offer,
		count: (agents: number, backgroundProcesses = 0) => { counts = { agents, backgroundProcesses }; for (const listener of [...listeners]) listener(counts); },
		fire: () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
		settle: (aborted = false) => loaded.handlers.get("agent_settled")!({ type: "agent_settled", aborted }),
		start: () => loaded.handlers.get("agent_start")!({ type: "agent_start" }),
		marks: () => markers(session.manager.getBranch()),
	};
}

/** The first run: prompt, work, and an answer given while one agent still runs. Returns the answer's key. */
function firstRun(t: ReturnType<typeof live>): string {
	t.count(1);
	t.start();
	t.add(user("go", 0), 0);
	t.add(assistant([text("step one")], "toolUse", 1), 1_000);
	const first = assistant([text("first answer")], "stop", 2);
	t.add(first, 5_000);
	t.settle();
	return messageKey(first)!;
}

it("an answer given while an agent runs keeps the work open; the fold closes when the background ends", () => {
	const t = live();
	const key = firstRun(t);
	assert.deepEqual(t.marks(), [{ key, final: false }]);
	assert.ok(t.rows().includes("step one") && !t.rows().includes("worked for"));
	t.count(0);
	assert.equal(t.timers.size, 1);
	t.fire();
	assert.deepEqual(t.marks(), [{ key, final: false }, { key, final: true }]);
	assert.ok(t.rows().includes("worked for 5s ›") && !t.rows().includes("step one") && t.rows().includes("first answer"));
});

it("a background process counts like an agent", () => {
	const t = live();
	t.count(0, 1);
	t.start();
	t.add(user("go", 0), 0);
	t.add(assistant([text("first answer")], "stop", 2), 5_000);
	t.settle();
	assert.equal(t.marks().length, 1);
});

it("a woken run that ends in the real final puts everything under one fold", () => {
	const t = live();
	const key = firstRun(t);
	t.count(0);
	t.start();
	t.add(assistant([text("second answer")], "stop", 3), 30_000);
	t.settle();
	t.fire();
	assert.deepEqual(t.marks(), [{ key, final: false }]);
	const rows = t.rows();
	assert.ok(rows.includes("worked for 30s ›") && !rows.includes("worked for 5s") && rows.includes("second answer"));
	assert.ok(!rows.includes("first answer") && !rows.includes("step one"));
});

it("a run that starts before the pause ends writes no final mark", () => {
	const t = live();
	const key = firstRun(t);
	t.count(0);
	t.start();
	t.fire();
	assert.deepEqual(t.marks(), [{ key, final: false }]);
});

it("a card that lands after the answer stops the pending final mark", () => {
	const t = live();
	const key = firstRun(t);
	t.count(0);
	t.session.card("late child result", 20_000);
	t.fire();
	assert.deepEqual(t.marks(), [{ key, final: false }]);
});

it("the background starting again before the pause ends cancels the final mark", () => {
	const t = live();
	const key = firstRun(t);
	t.count(0);
	t.count(1);
	t.fire();
	assert.deepEqual(t.marks(), [{ key, final: false }]);
});

it("an answer with nothing running, and an aborted run, write no mark", () => {
	const t = live();
	t.start();
	t.add(user("go", 0), 0);
	t.add(assistant([text("answer")], "stop", 2), 5_000);
	t.settle();
	assert.deepEqual(t.marks(), []);
	t.count(1);
	t.start();
	t.add(assistant([text("another")], "stop", 3), 9_000);
	t.settle(true);
	assert.deepEqual(t.marks(), []);
});

it("outside the TUI nothing is written", () => {
	const t = live();
	t.loaded.shutdown();
	t.loaded.handlers.get("session_start")!({}, { mode: "print", hasUI: false, sessionManager: t.session.manager });
	t.offer();
	t.count(1);
	t.add(user("go", 0), 0);
	t.add(assistant([text("answer")], "stop", 2), 5_000);
	t.settle();
	assert.deepEqual(t.loaded.appended, []);
});
