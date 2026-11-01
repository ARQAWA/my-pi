import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { CTRL_R, CTRL_R_RELEASE, ESC, harness } from "./harness.ts";

const USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const user = () => ({ role: "user", content: "build it", timestamp: 1 });
const reply = (stopReason: string, content: unknown[] = []) => ({ role: "assistant", content, api: "anthropic-messages", provider: "anthropic", model: "test", usage: USAGE, stopReason, timestamp: 2 });
const toolCall = [{ type: "toolCall", id: "call-1", name: "bash", arguments: {} }];
const waitResult = { role: "toolResult", toolCallId: "call-1", toolName: "agent", content: [{ type: "text", text: "{\"reason\":\"waiting\"}" }], details: { reason: "waiting", timed_out: false }, isError: false, timestamp: 3 };
const twoCalls = [...toolCall, { type: "toolCall", id: "call-2", name: "agent", arguments: {} }];
const toolResult = { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "done" }], isError: false, timestamp: 3 };

type Step = (manager: SessionManager) => unknown;
const message = (value: unknown): Step => manager => manager.appendMessage(value as never);
const customEntry: Step = manager => manager.appendCustomEntry("rqw-send-now", { timestamp: 2 });
const finished: Step = message(reply("stop", [{ type: "text", text: "Done." }]));

/** A session file written by one Pi process, as the next `pi -c` opens it. */
function reopened(t: TestContext, steps: Step[]) {
	const directory = mkdtempSync(join(tmpdir(), "rqw-resume-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const writer = SessionManager.create(directory, directory);
	for (const step of steps) step(writer);
	return SessionManager.open(writer.getSessionFile()!, directory, directory);
}

/** An idle main chat over the given session file. */
function idleChat(t: TestContext, steps: Step[]) {
	const h = harness(t, { manager: reopened(t, steps) });
	h.state.idle = true;
	return h;
}

describe("Ctrl+R restarts an interrupted turn", () => {
	it("after Escape aborted the turn it starts Pi's custom-message run once", (t) => {
		const manager = SessionManager.inMemory();
		const h = harness(t, { manager });
		manager.appendMessage(user() as never);
		assert.equal(h.press(ESC), undefined, "Escape stays Pi's interrupt");
		manager.appendMessage(reply("aborted") as never);
		h.state.idle = true;
		assert.deepEqual(h.press(CTRL_R), { consume: true });
		assert.equal(h.resumed.length, 1);
		// Pi's own routing started the run: a hidden custom message, not a queued steer.
		assert.equal(h.resumed[0].customType, "rqw-resume");
		assert.match(h.resumed[0].content, /interrupted/);
		assert.equal(h.resumed[0].display, false);
		// Busy at once, and the restart note ends the branch: a second press finds nothing to restart.
		assert.equal(h.press(CTRL_R), undefined);
		h.state.idle = true;
		assert.equal(h.press(CTRL_R), undefined);
		assert.equal(h.resumed.length, 1);
	});

	it("keeps the editor draft", (t) => {
		const h = idleChat(t, [message(user()), message(reply("aborted"))]);
		h.state.editor = "half-typed";
		assert.deepEqual(h.press(CTRL_R), { consume: true });
		assert.equal(h.state.editor, "half-typed");
	});

	for (const [name, steps] of [
		["a session file ending with an aborted reply", [message(user()), message(reply("aborted"))]],
		["an aborted reply followed by a bookkeeping entry", [message(user()), message(reply("aborted")), customEntry]],
		["a quit before the first reply was saved", [message(user()), finished, message(user())]],
		["a quit while a tool ran", [message(user()), message(reply("toolUse", toolCall))]],
		["a quit after the tools, before the next reply", [message(user()), message(reply("toolUse", toolCall)), message(toolResult)]],
		["a quit while a later tool of the batch still ran", [message(user()), message(reply("toolUse", twoCalls)), message(waitResult)]],
		["a quit after a batch where only the last tool was a wait", [message(user()), message(reply("toolUse", toolCall)), message(toolResult), message(waitResult)]],
	] as const) it(`after a reload from ${name} it restarts`, (t) => {
		const h = idleChat(t, [...steps]);
		assert.deepEqual(h.press(CTRL_R), { consume: true });
		assert.equal(h.resumed.length, 1);
	});

	for (const [name, steps] of [
		["a finished answer", [message(user()), finished]],
		["a cut-off reply that is a finished answer", [message(user()), message(reply("length", [{ type: "text", text: "Long" }]))]],
		["a failed request", [message(user()), message(reply("error"))]],
		["a turn a wait ended on purpose", [message(user()), message(reply("toolUse", toolCall)), message(waitResult)]],
		["an empty session", []],
		["an aborted reply that a later answer followed", [message(user()), message(reply("aborted")), message(user()), finished]],
	] as const) it(`is inert after ${name}`, (t) => {
		const h = idleChat(t, [...steps]);
		assert.equal(h.press(CTRL_R), undefined);
		assert.equal(h.resumed.length, 0);
	});

	describe("is inert when the chat cannot take a run", () => {
		const aborted = [message(user()), message(reply("aborted"))];
		const cases: [string, (h: ReturnType<typeof idleChat>) => void][] = [
			["the turn is running", h => { h.state.idle = false; }],
			["a compaction is running", h => { h.state.compacting = true; }],
			["no model is selected", h => { h.state.model = false; }],
			["autocomplete is open", h => { h.state.autocomplete = true; }],
			["the main editor has no focus", h => { h.state.focused = false; }],
		];
		for (const [name, setup] of cases) it(name, (t) => {
			const h = idleChat(t, aborted);
			setup(h);
			assert.equal(h.press(CTRL_R), undefined);
			assert.equal(h.resumed.length, 0);
		});

		it("the key was released", (t) => {
			const h = idleChat(t, aborted);
			assert.equal(h.press(CTRL_R_RELEASE), undefined);
			assert.equal(h.resumed.length, 0);
		});
	});
});
