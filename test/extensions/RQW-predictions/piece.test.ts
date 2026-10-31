import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { draftOf } from "../../../extensions/RQW-predictions/context.ts";
import { ABORTED_MS, assistant, deferred, failure, harness, last, OTHER, settle, SILENCE_RULE, suggestion, text } from "./harness.ts";

const SCHEMA = 'Return only JSON matching this schema: {"type":"object","properties":{"suggestion":{"type":["string","null"]}},"required":["suggestion"],"additionalProperties":false}.';
const at = (value: string, col = value.length, line = 0) => draftOf(value, { line, col });

/** A chat whose automatic attempt has finished; the replies follow it. */
async function chat(...replies: (AssistantMessage | Promise<AssistantMessage>)[]) {
	const h = harness({ replies: [suggestion("auto"), ...replies] });
	h.answer();
	await settle();
	return h;
}

/** The piece the model's reply gives for a draft, or undefined. */
async function pieceFor(reply: AssistantMessage, draft = at("Fix the")) {
	const h = await chat(reply);
	h.controller.continueDraft(draft);
	await settle();
	return h.controller.piece()?.text;
}

describe("RQW-predictions piece request", () => {
	it("sends the draft around the cursor only at the very end; everything before it is the normal request's prefix", async () => {
		const h = await chat(suggestion(" tests"));
		h.controller.continueDraft(at("one two\nthree four", 3));
		await settle();
		const [normal, piece] = h.forks;
		assert.equal(h.forks.length, 2);
		assert.deepEqual(piece.context.messages.slice(0, -1), normal.context.messages.slice(0, -1));
		assert.equal(piece.model, normal.model);
		assert.equal(piece.reasoning, normal.reasoning);
		const content = last(piece.context).content as string;
		assert.equal(content, [
			"PREDICT PROMPT",
			"The user has already started typing the next message. The cursor sits between the two parts below.",
			"<before_cursor>\none\n</before_cursor>",
			"<after_cursor>\n two\nthree four\n</after_cursor>",
			"Set suggestion to only the next few words (at most 6) to insert at the cursor, so that the text before, the suggestion and the text after read as one message.",
			"Start with a space when the words need one. Never repeat text that is already before or after the cursor.",
			SCHEMA,
			SILENCE_RULE,
		].join("\n"));
		assert.equal((last(normal.context).content as string).includes("<before_cursor>"), false);
	});

	it("an empty side is an empty tag, and the cursor on a later line splits the text there", async () => {
		const h = await chat(suggestion(" x"));
		h.controller.continueDraft(at("first\nsecond", 3, 1));
		await settle();
		const content = last(h.forks[1].context).content as string;
		assert.ok(content.includes("<before_cursor>\nfirst\nsec\n</before_cursor>\n<after_cursor>\nond\n</after_cursor>"));
		const end = await chat(suggestion(" x"));
		end.controller.continueDraft(at("Fix the"));
		await settle();
		assert.ok((last(end.forks[1].context).content as string).includes("<before_cursor>\nFix the\n</before_cursor>\n<after_cursor></after_cursor>"));
	});

	it("keeps the piece with the key of its draft and leaves the ready suggestion alone", async () => {
		const h = await chat(suggestion(" and more"));
		const draft = at("Fix the");
		assert.equal(h.controller.suggestion(), "auto");
		h.controller.continueDraft(draft);
		await settle();
		assert.deepEqual(h.controller.piece(), { text: " and more", key: draft.key });
		assert.equal(h.controller.suggestion(), "auto");
		assert.ok(h.renders() > 0);
	});

	it("without a direct fork the piece goes through the provider with the same rule", async () => {
		const h = harness({ fork: false, replies: [suggestion("auto"), suggestion(" tests")] });
		h.answer();
		await settle();
		h.controller.continueDraft(at("Fix the"));
		await settle();
		assert.equal(h.controller.piece()?.text, " tests");
		assert.ok((last(h.provider[1].context).content as string).includes("<before_cursor>\nFix the\n</before_cursor>"));
	});
});

describe("RQW-predictions piece text", () => {
	it("keeps its own leading space and cuts to six words", async () => {
		assert.equal(await pieceFor(suggestion(" run the tests")), " run the tests");
		assert.equal(await pieceFor(suggestion(" one two three four five six seven eight")), " one two three four five six");
		assert.equal(await pieceFor(suggestion("one  two three four five six")), "one  two three four five six");
	});

	it("drops the space the text before the cursor already ends with, and the one the text after already starts with", async () => {
		assert.equal(await pieceFor(suggestion(" tests"), at("Fix the ")), "tests");
		assert.equal(await pieceFor(suggestion("tests "), at("Fix the", 7)), "tests ");
		assert.equal(await pieceFor(suggestion("tests "), draftOf("Fix the  now", { line: 0, col: 7 })), "tests");
		assert.equal(await pieceFor(suggestion(" tests "), draftOf("Fix the \nnow", { line: 0, col: 8 })), "tests");
	});

	it("takes only the first line and removes control codes; tabs become one space", async () => {
		assert.equal(await pieceFor(suggestion(" run\nthe tests")), " run");
		assert.equal(await pieceFor(suggestion(" run\x1b[31m red\x07\tit")), " run red it");
	});

	it("shows nothing for a null, blank, newline-first, non-JSON or tool answer and stops there", async () => {
		const tool = assistant([{ type: "toolCall", id: "t", name: "read", arguments: {} }]);
		for (const reply of [suggestion(null), suggestion("   "), suggestion("\nnext line"), text("run the tests"), tool, suggestion("")]) {
			assert.equal(await pieceFor(reply), undefined);
		}
	});

	it("an expanded paste marker reaches the model, not the marker", async () => {
		const h = await chat(suggestion(" x"));
		const expand = (value: string) => value.replace("[paste #1 +2 lines]", "line a\nline b");
		h.controller.continueDraft(draftOf("see [paste #1 +2 lines] now", { line: 0, col: 4 }, expand));
		await settle();
		assert.ok((last(h.forks[1].context).content as string).includes("<before_cursor>\nsee \n</before_cursor>"));
		const whole = draftOf("[paste #1 +2 lines] now", { line: 0, col: 19 }, expand);
		assert.equal(whole.before, "line a\nline b");
		assert.equal(whole.after, " now");
	});

	it("a failed request tells the user for Ctrl+E but stays quiet in a chain", async () => {
		const manual = await chat(failure());
		manual.controller.continueDraft(at("Fix the"));
		await settle();
		assert.equal(manual.controller.piece(), undefined);
		assert.deepEqual(manual.notes, ["Prediction failed: provider exploded"]);
		const quiet = await chat(failure());
		quiet.controller.chain(at("Fix the"));
		await settle();
		assert.deepEqual(quiet.notes, []);
	});
});

describe("RQW-predictions piece chain and cancel", () => {
	it("after a piece is taken the next one starts at once for the new draft; while it runs no piece is shown", async () => {
		const slow = deferred<AssistantMessage>();
		const h = await chat(suggestion(" the"), slow.promise);
		h.controller.continueDraft(at("Fix"));
		await settle();
		assert.equal(h.controller.piece()?.text, " the");
		const next = at("Fix the");
		h.controller.chain(next);
		assert.equal(h.controller.piece(), undefined);
		await settle();
		assert.equal(h.forks.length, 3);
		assert.ok((last(h.forks[2].context).content as string).includes("<before_cursor>\nFix the\n</before_cursor>"));
		assert.equal(h.states().at(-1), "brewing");
		slow.resolve(suggestion(" tests"));
		await settle();
		assert.deepEqual(h.controller.piece(), { text: " tests", key: next.key });
		assert.equal(h.states().at(-1), "idle");
	});

	it("a null answer ends the chain", async () => {
		const h = await chat(suggestion(" the"), suggestion(null));
		h.controller.continueDraft(at("Fix"));
		await settle();
		h.controller.chain(at("Fix the"));
		await settle();
		assert.equal(h.controller.piece(), undefined);
		assert.equal(h.forks.length, 3);
		await settle();
		assert.equal(h.forks.length, 3);
	});

	it("runs one request at a time and only for an idle chat without queued messages or an answer-less branch", async () => {
		const slow = deferred<AssistantMessage>();
		const h = await chat(slow.promise);
		h.controller.continueDraft(at("Fix"));
		h.controller.continueDraft(at("Fix the"));
		h.controller.chain(at("Fix the"));
		await settle();
		assert.equal(h.forks.length, 2);
		h.controller.interrupt();

		h.state.idle = false;
		h.controller.continueDraft(at("Fix"));
		h.state.idle = true;
		h.state.pending = true;
		h.controller.continueDraft(at("Fix"));
		h.state.pending = false;
		h.state.branch = [{ type: "message", message: { role: "user" } }];
		h.controller.continueDraft(at("Fix"));
		await settle();
		assert.equal(h.forks.length, 2);
	});

	it("a draft key that no longer fits drops the running request quietly and its late answer", async () => {
		const slow = deferred<AssistantMessage>();
		const h = await chat(slow.promise);
		const draft = at("Fix");
		h.controller.continueDraft(draft);
		await settle();
		h.controller.moved(() => draft.key);
		assert.equal(h.states().at(-1), "brewing");
		h.controller.moved(() => at("Fixe").key);
		assert.equal(h.states().at(-1), "idle");
		assert.equal(h.states().includes("aborted"), false);
		assert.equal(h.forks[1].signal.aborted, true);
		slow.resolve(suggestion(" the"));
		await settle();
		assert.equal(h.controller.piece(), undefined);
	});

	it("a draft key that no longer fits removes the piece for good, even when the text comes back", async () => {
		const h = await chat(suggestion(" the"));
		const draft = at("Fix");
		h.controller.continueDraft(draft);
		await settle();
		const before = h.renders();
		h.controller.moved(() => draft.key);
		assert.deepEqual(h.controller.piece(), { text: " the", key: draft.key });
		h.controller.moved(() => at("Fix", 2).key);
		assert.equal(h.controller.piece(), undefined);
		assert.ok(h.renders() > before);
		h.controller.moved(() => draft.key);
		assert.equal(h.controller.piece(), undefined);
	});

	it("Ctrl+R during a request is the maroon abort; on a shown piece it only removes it", async () => {
		const slow = deferred<AssistantMessage>();
		const h = await chat(slow.promise, suggestion(" the"));
		h.controller.continueDraft(at("Fix"));
		await settle();
		h.controller.cancel();
		assert.equal(h.states().at(-1), "aborted");
		h.clock.now += ABORTED_MS;
		slow.resolve(suggestion(" late"));
		await settle();
		assert.equal(h.controller.piece(), undefined);

		const shown = await chat(suggestion(" the"));
		shown.controller.continueDraft(at("Fix"));
		await settle();
		shown.controller.cancel();
		assert.equal(shown.controller.piece(), undefined);
		assert.equal(shown.states().includes("aborted"), false);
	});

	it("a new answer removes the piece also when a queued message stops the automatic attempt", async () => {
		const h = await chat(suggestion(" the"));
		h.controller.continueDraft(at("Fix"));
		await settle();
		h.state.pending = true;
		h.answer();
		assert.equal(h.controller.piece(), undefined);
	});

	it("a new turn, a new answer, another model and another branch end the request and the piece without the aborted paint", async () => {
		const slow = deferred<AssistantMessage>();
		const h = await chat(slow.promise);
		h.controller.continueDraft(at("Fix"));
		await settle();
		h.fire("agent_start");
		assert.equal(h.states().at(-1), "idle");
		assert.equal(h.forks[1].signal.aborted, true);

		const events: [string, (g: Awaited<ReturnType<typeof chat>>) => void][] = [
			["agent_start", g => g.fire("agent_start")],
			["model_select", g => g.setModel(OTHER)],
			["turn_end", g => g.answer()],
			["session_tree", g => g.fire("session_tree")],
		];
		for (const [name, run] of events) {
			const g = await chat(suggestion(" the"));
			g.controller.continueDraft(at("Fix"));
			await settle();
			assert.equal(g.controller.piece()?.text, " the", name);
			const brewing = g.states().length;
			run(g);
			assert.equal(g.controller.piece(), undefined, name);
			assert.equal(g.states().slice(brewing).includes("aborted"), false, name);
		}
	});
});
