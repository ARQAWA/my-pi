import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripVTControlCharacters as strip } from "node:util";
import type { Message } from "@earendil-works/pi-ai";
import {
	ABORTED_MS, ACTIVITY_QUERY, assistant, CTRL_E, CTRL_E_RELEASE, CTRL_R, CTRL_R_RELEASE, deferred, failure, harness, last, MODEL,
	OTHER, piKeybindings, settle, SILENCE_RULE, suggestion, text, USER, SYSTEM,
} from "./harness.ts";

describe("RQW-suggestions generation", () => {
	it("a finished answer alone starts nothing, however long the chat waits", async () => {
		const h = harness();
		h.answer();
		await settle();
		h.answer();
		h.fire("agent_settled");
		await settle();
		assert.equal(h.gets.length, 0);
		assert.equal(h.forks.length, 0);
		assert.equal(h.provider.length, 0);
		assert.equal(h.controller.suggestion(), undefined);
		assert.deepEqual(h.states(), []);
	});

	it("Ctrl+E right after an answer starts the request at once", async () => {
		const h = harness();
		h.answer();
		assert.deepEqual(h.states(), []);
		h.key(CTRL_E);
		assert.deepEqual(h.states(), ["brewing"]);
		await settle();
		assert.equal(h.forks.length, 1);
		assert.equal(h.controller.suggestion(), "run the tests");
	});

	it("Ctrl+E after an answer makes one request with the full context and the served prompt last; the suggestion is kept", async () => {
		const h = harness();
		h.asked();
		await settle();
		assert.equal(h.gets.length, 1);
		assert.equal(h.forks.length, 1);
		const fork = h.forks[0];
		assert.equal(fork.sessionId, "main");
		assert.equal(fork.model, MODEL);
		assert.equal(fork.reasoning, "medium");
		// The transports prepare a big context in small steps only when asked to.
		assert.equal(fork.cooperative, true);
		assert.deepEqual(fork.context.messages.slice(0, -1), [SYSTEM, USER, text("Tests run.")]);
		const instruction = String(last(fork.context).content);
		assert.equal(last(fork.context).role, "user");
		assert.ok(instruction.startsWith("PREDICT PROMPT\n"));
		assert.match(instruction, /Return only JSON matching this schema: \{.*"suggestion".*\}\./);
		assert.ok(instruction.endsWith(SILENCE_RULE));
		assert.equal(h.provider.length, 0);
		assert.equal(h.controller.suggestion(), "run the tests");
		assert.deepEqual(h.states(), ["brewing", "idle"]);
	});

	it("tool calls, errors, aborts and a repeated turn end start nothing", async () => {
		const h = harness();
		h.answer(assistant([{ type: "toolCall", id: "t", name: "read", arguments: {} }], "toolUse"));
		h.answer(failure(), "error");
		h.answer(assistant([], "aborted"), "aborted");
		h.answer();
		h.repeatTurn("answer-4");
		await settle();
		assert.equal(h.gets.length, 0);
		assert.equal(h.forks.length, 0);
	});

	it("a queued user message neither skips nor stops a request", async () => {
		const queued = harness();
		queued.answer();
		queued.state.pending = true;
		queued.key(CTRL_E);
		await settle();
		assert.equal(queued.forks.length, 1);
		assert.equal(queued.controller.suggestion(), "run the tests");

		const late = deferred<{ prompt: string }>();
		const h = harness({ prompts: [late.promise] });
		h.asked();
		await settle();
		assert.equal(h.gets.length, 1);
		h.state.pending = true;
		late.resolve({ prompt: "PREDICT PROMPT" });
		await settle();
		assert.equal(h.forks.length, 1);
		assert.equal(h.controller.suggestion(), "run the tests");
		assert.equal(h.states().at(-1), "idle");
	});

	it("the model answering null, junk or a tool call shows nothing and never repeats", async () => {
		const h = harness({ replies: [suggestion(null), text("not json"), assistant([{ type: "toolCall", id: "t", name: "read", arguments: {} }], "toolUse"), suggestion("   ")] });
		for (let i = 0; i < 4; i++) { h.asked(); await settle(); assert.equal(h.controller.suggestion(), undefined); }
		assert.equal(h.forks.length, 4);
	});

	it("the shown text keeps line breaks and loses terminal control codes", async () => {
		const h = harness({ replies: [suggestion("first\r\nsecond\x1b[31m red\x1b[0m\x07\tend")] });
		h.asked();
		await settle();
		assert.equal(h.controller.suggestion(), "first\nsecond red end");
	});

	it("a hosted-tool refusal from the transport allows no other request; without a transport the provider is called directly", async () => {
		const refused = harness({ fork: false });
		refused.events.on("rqw:context-fork:v1", data => (data as { decline(reason: string): void }).decline("unsupported_hosted_tools"));
		refused.asked();
		await settle();
		assert.equal(refused.provider.length, 0);

		const h = harness({ fork: false });
		h.asked();
		await settle();
		assert.equal(h.provider.length, 1);
		assert.equal(h.provider[0].model, MODEL);
		assert.equal(h.provider[0].options.sessionId, undefined);
		assert.equal(h.provider[0].options.reasoning, "medium");
		assert.equal(h.controller.suggestion(), "run the tests");
	});

	it("never waits for the model: input works while the request is open, and a new answer drops the old request and suggestion", async () => {
		const slow = deferred<ReturnType<typeof text>>();
		const h = harness({ replies: [slow.promise, suggestion("second one")] });
		h.asked();
		await settle();
		h.editor.setText("");
		h.key("h");
		assert.equal(h.editor.getText(), "h");
		const first = h.forks[0].signal;
		h.asked();
		assert.equal(first.aborted, true);
		await settle();
		slow.resolve(suggestion("late one"));
		await settle();
		assert.equal(h.controller.suggestion(), "second one");
		h.answer();
		assert.equal(h.controller.suggestion(), undefined);
	});

	it("new work or another model ends the open request without the aborted paint; a model change keeps the ready one", async () => {
		const slow = deferred<ReturnType<typeof text>>();
		const h = harness({ replies: [slow.promise] });
		h.asked();
		await settle();
		h.fire("agent_start");
		assert.equal(h.forks[0].signal.aborted, true);
		assert.deepEqual(h.states(), ["brewing", "idle"]);
		slow.resolve(suggestion("late"));
		await settle();
		assert.equal(h.controller.suggestion(), undefined);

		const kept = harness({ replies: [suggestion("kept")] });
		kept.asked();
		await settle();
		kept.setModel(OTHER);
		assert.equal(kept.controller.suggestion(), "kept");
	});

	it("opening a chat that has answers generates nothing", async () => {
		const h = harness();
		h.fire("session_start", { reason: "resume" });
		await settle();
		assert.equal(h.gets.length, 0);
	});

	it("another session or branch leaves no result, request or status behind", async () => {
		const slow = deferred<ReturnType<typeof text>>();
		const h = harness({ replies: [slow.promise, suggestion("kept")] });
		h.asked();
		await settle();
		h.switchTo("other");
		assert.equal(h.forks[0].signal.aborted, true);
		slow.resolve(suggestion("stale"));
		await settle();
		assert.equal(h.controller.suggestion(), undefined);
		h.asked();
		await settle();
		assert.equal(h.controller.suggestion(), "kept");
		h.fire("session_tree");
		assert.equal(h.controller.suggestion(), undefined);
	});

	it("quit and reload drop the prompt cache; a chat switch keeps it", () => {
		const h = harness();
		h.fire("session_shutdown", { reason: "new" });
		assert.equal(h.cleared.length, 0);
		h.fire("session_shutdown", { reason: "reload" });
		assert.equal(h.cleared.length, 1);
	});
});

describe("RQW-suggestions manual keys", () => {
	it("Ctrl+E in the main editor makes exactly one request and does not move the cursor", async () => {
		const h = harness();
		h.ran();
		h.editor.setText("hello");
		h.key("\x01");
		assert.equal(h.editor.getCursor().col, 0);
		h.key(CTRL_E);
		await settle();
		assert.equal(h.gets.length, 1);
		assert.equal(h.forks.length, 1);
		assert.equal(h.editor.getCursor().col, 0);
		assert.equal(h.controller.suggestion(), "run the tests");
		// The key is taken once: the editor's own handler never sees it.
		assert.deepEqual(h.reached, ["\x01"]);
	});

	it("manual runs repeat without a limit and replace the old suggestion", async () => {
		const h = harness({ replies: [suggestion("one"), suggestion("two")] });
		h.ran();
		h.key(CTRL_E);
		await settle();
		assert.equal(h.controller.suggestion(), "one");
		h.key(CTRL_E);
		await settle();
		assert.equal(h.controller.suggestion(), "two");
		assert.equal(h.forks.length, 2);
	});

	it("a failed manual run keeps the old suggestion and says why; null from the model clears it", async () => {
		const h = harness({ replies: [suggestion("one"), failure(), suggestion(null)] });
		h.key(CTRL_E);
		await settle();
		h.key(CTRL_E);
		await settle();
		assert.equal(h.controller.suggestion(), "one");
		assert.deepEqual(h.notes, ["Suggestion failed: provider exploded"]);
		h.key(CTRL_E);
		await settle();
		assert.equal(h.controller.suggestion(), undefined);
	});

	for (const [name, idle, pending] of [["idle", true, false], ["a running turn", false, false], ["a queued message", true, true], ["a running turn with a queued message", false, true]] as const) {
		it(`Ctrl+E starts a request and the next Ctrl+E cancels it in this state: ${name}`, async () => {
			const h = harness({ replies: [deferred<ReturnType<typeof text>>().promise, suggestion("again")] });
			h.ran();
			h.state.idle = idle;
			h.state.pending = pending;
			h.key(CTRL_E);
			await settle();
			assert.equal(h.gets.length, 1);
			assert.equal(h.forks.length, 1);
			assert.deepEqual(h.states(), ["brewing"]);
			h.key(CTRL_E);
			assert.equal(h.forks[0].signal.aborted, true);
			assert.deepEqual(h.states(), ["brewing", "aborted"]);
			h.key(CTRL_E);
			await settle();
			assert.equal(h.forks.length, 2);
			assert.equal(h.controller.suggestion(), "again");
		});
	}

	it("key release and key repeat do nothing", async () => {
		const h = harness();
		h.key(CTRL_E_RELEASE);
		h.key(CTRL_R_RELEASE);
		await settle();
		assert.equal(h.gets.length, 0);
		h.key(CTRL_E);
		h.key("\x1b[101;5:2u");
		await settle();
		assert.equal(h.gets.length, 1);
	});

	it("Ctrl+E while a request runs cancels it, paints aborted for 2000 ms and drops the late answer", async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		const slow = deferred<ReturnType<typeof text>>();
		const h = harness({ replies: [slow.promise] });
		h.ran();
		h.key(CTRL_E);
		await settle();
		h.key(CTRL_E);
		assert.equal(h.forks[0].signal.aborted, true);
		assert.deepEqual(h.states(), ["brewing", "aborted"]);
		assert.equal(h.activity.at(-1)!.abortedUntil, h.clock.now + ABORTED_MS);
		slow.resolve(suggestion("late"));
		await settle();
		assert.equal(h.controller.suggestion(), undefined);
		assert.equal(h.states().at(-1), "aborted");
		t.mock.timers.tick(ABORTED_MS - 1);
		assert.equal(h.states().at(-1), "aborted");
		t.mock.timers.tick(1);
		assert.equal(h.states().at(-1), "idle");
	});

	it("a new run ends the aborted paint", async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		const h = harness({ replies: [deferred<ReturnType<typeof text>>().promise, deferred<ReturnType<typeof text>>().promise] });
		h.key(CTRL_E);
		await settle();
		h.key(CTRL_E);
		assert.equal(h.states().at(-1), "aborted");
		h.key(CTRL_E);
		assert.equal(h.states().at(-1), "brewing");
		t.mock.timers.tick(ABORTED_MS);
		assert.equal(h.states().at(-1), "brewing");
	});

	it("Ctrl+R is free: it cancels nothing, starts nothing and reaches no Pi action", async () => {
		const h = harness({ realKeys: true, keybindings: piKeybindings(), replies: [deferred<ReturnType<typeof text>>().promise] });
		h.ran();
		let renames = 0;
		h.editor.onAction("app.session.rename", () => { renames++; });
		h.key(CTRL_R);
		await settle();
		assert.equal(h.gets.length, 0);
		assert.deepEqual(h.states(), []);
		h.key(CTRL_E);
		await settle();
		h.key(CTRL_R);
		h.key(CTRL_R_RELEASE);
		assert.equal(h.forks[0].signal.aborted, false);
		assert.deepEqual(h.states(), ["brewing"]);
		assert.equal(renames, 0);
		assert.equal(h.editor.getText(), "");
	});

	it("keys reach only the main editor and are not taken while autocomplete shows or the editor lost focus", async () => {
		const h = harness();
		h.setFocus({});
		h.key(CTRL_E);
		await settle();
		// A dialog or another editor holds focus: the main editor never sees the key, so nothing starts.
		h.setFocus(h.editor);
		(h.editor as unknown as { isShowingAutocomplete(): boolean }).isShowingAutocomplete = () => true;
		h.editor.setText("hello");
		h.key("\x01");
		h.key(CTRL_E);
		await settle();
		assert.equal(h.gets.length, 0);
		// Pi's own Ctrl+E action is freed, so the key does nothing in the open menu; End still moves.
		assert.equal(h.editor.getCursor().col, 0);
		h.key("\x1b[F");
		assert.equal(h.editor.getCursor().col, 5);
	});

	it("an empty chat with no answer has nothing to predict from", async () => {
		const h = harness({ branch: [{ type: "message", message: USER }] });
		h.key(CTRL_E);
		await settle();
		assert.equal(h.gets.length, 0);
	});

	it("ending the session gives the editor its own method back", () => {
		const h = harness();
		h.fire("session_shutdown", { reason: "quit" });
		h.key(CTRL_E);
		h.key(CTRL_R);
		assert.deepEqual(h.reached, [CTRL_E, CTRL_R]);
		assert.equal(h.gets.length, 0);
	});
});

describe("RQW-suggestions status", () => {
	it("the stock status line shows brewing and the aborted text, then clears", async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		const h = harness({ replies: [deferred<ReturnType<typeof text>>().promise] });
		h.key(CTRL_E);
		await settle();
		assert.equal(h.statuses.at(-1), "suggestion");
		h.key(CTRL_E);
		assert.equal(strip(h.statuses.at(-1)!), "suggestion aborted");
		assert.match(h.statuses.at(-1)!, /^\x1b\[38;2;53;28;34m/);
		t.mock.timers.tick(ABORTED_MS);
		assert.equal(h.statuses.at(-1), undefined);
	});

	it("a footer that asked for the state gets it, and the stock status line stays, so it survives /statusbar off", async () => {
		const h = harness({ replies: [deferred<ReturnType<typeof text>>().promise] });
		let offered: unknown;
		h.events.emit(ACTIVITY_QUERY, { offer: (state: unknown) => { offered = state; } });
		assert.deepEqual(offered, { sessionId: "main", state: "idle" });
		h.key(CTRL_E);
		await settle();
		h.events.emit(ACTIVITY_QUERY, { offer: (state: unknown) => { offered = state; } });
		assert.deepEqual(offered, { sessionId: "main", state: "brewing" });
		assert.equal(h.statuses.at(-1), "suggestion");
		assert.deepEqual(h.states(), ["brewing"]);
	});
});

describe("RQW-suggestions context", () => {
	it("a chat without a recorded request is predicted from its saved branch and the current prompt", async () => {
		const h = harness();
		h.setModel(OTHER);
		h.key(CTRL_E);
		await settle();
		// No main request was recorded; Codex still gets no routing id for the main thread.
		assert.equal(h.forks.length, 0);
		assert.equal(h.provider[0].model, OTHER);
		assert.equal(h.provider[0].options.sessionId, undefined);
		const messages = h.provider[0].context.messages;
		assert.equal(messages[0].role, "system");
		assert.equal(messages[0].content, "CURRENT PROMPT");
		assert.equal(messages.length, 4);
	});

	it("the request carries tool results, images and the compaction summary exactly as the main model saw them, then the answer and the prompt", async () => {
		const IMAGE = { type: "image", data: "aGk=", mimeType: "image/png" } as const;
		const summary = { role: "user", content: "Summary of earlier work: SUMMARY BODY", timestamp: 1 } as Message;
		const picture = { role: "user", content: [{ type: "text", text: "Look at this" }, IMAGE], timestamp: 2 } as Message;
		const call = assistant([{ type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } }], "toolUse");
		const result = { role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "file body" }, IMAGE], isError: false, timestamp: 4 } as Message;
		const hanging = assistant([{ type: "toolCall", id: "c2", name: "read", arguments: {} }], "toolUse");
		const h = harness();
		h.request({ messages: [SYSTEM, summary, picture, call, result] });
		h.fire("message_end", { message: text("Done.") });
		h.fire("message_end", { message: hanging });
		h.fire("turn_end", { outcome: "completed", message: text("Done."), messageEntryId: "a1", toolResults: [], toolResultEntryIds: [] });
		h.key(CTRL_E);
		await settle();
		const messages = h.forks[0].context.messages;
		assert.deepEqual(messages.slice(0, -1), [SYSTEM, summary, picture, call, result, text("Done.")]);
		assert.equal(last(h.forks[0].context).role, "user");
	});

	it("without a recorded request the saved branch is sent: the summary, the image and the tool result stay, an unanswered tool call is cut", async () => {
		const IMAGE = { type: "image", data: "aGk=", mimeType: "image/png" } as const;
		const picture = { role: "user", content: [{ type: "text", text: "Look at this" }, IMAGE], timestamp: 2 } as Message;
		const call = assistant([{ type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } }], "toolUse");
		const result = { role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "file body" }, IMAGE], isError: false, timestamp: 4 } as Message;
		const hanging = assistant([{ type: "toolCall", id: "c2", name: "read", arguments: {} }], "toolUse");
		const compacted = { role: "compactionSummary", summary: "SUMMARY BODY", tokensBefore: 1234, timestamp: 1 };
		const h = harness({ projection: [compacted, picture, call, result, text("Done."), hanging] });
		h.key(CTRL_E);
		await settle();
		const messages = h.provider[0].context.messages;
		assert.equal(messages[0].role, "system");
		assert.equal(messages[0].content, "CURRENT PROMPT");
		assert.equal(messages[1].role, "user");
		assert.match(JSON.stringify(messages[1].content), /SUMMARY BODY/);
		assert.deepEqual(messages.slice(2, -1), [picture, call, result, text("Done.")]);
		assert.equal(last(h.provider[0].context).role, "user");
		assert.equal(JSON.stringify(messages).includes("c2"), false);
	});
});

describe("RQW-suggestions token errors", () => {
	const plain = (row: string) => strip(row.replace(/\x1b_[^\x07]*\x07/g, ""));
	const errorStatus = (h: ReturnType<typeof harness>) => h.keyed.filter(([key]) => key === "rqw-suggestions-error");

	it("a Codex model answering 401 shows it, and the Ctrl+E hint stays", async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		const h = harness({ replies: [{ ...failure(), errorMessage: "401 Unauthorized" }] });
		h.setModel(OTHER);
		h.answer();
		h.key(CTRL_E);
		await settle();
		assert.match(strip(errorStatus(h).at(-1)![1]!), /Codex token expired or rejected/);
		assert.equal(plain(h.screen()[1]).trim(), "ctrl+e to suggest");
	});

	it("an Anthropic 401 is not a Codex token failure", async () => {
		const h = harness({ replies: [{ ...failure(), errorMessage: "401 Unauthorized" }] });
		h.asked();
		await settle();
		assert.deepEqual(errorStatus(h), []);
		assert.equal(h.notes.length, 1);
	});
});
