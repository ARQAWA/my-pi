import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { it } from "node:test";
import { type CardTheme, createAgentCard } from "../../../extensions/RQW-agent-ui/card.ts";
import { createChildWaitCard } from "../../../extensions/RQW-agent-ui/child-wait.ts";
import { createReviewCard, reviewCounts } from "../../../extensions/RQW-agent-ui/review.ts";
import { selfShellWaitRenderers } from "../../../extensions/RQW-agent-ui/self.ts";
import { waitCards } from "../../../extensions/RQW-agent-ui/wait.ts";

const identity: CardTheme = { fg: (_color, text) => text, bold: (text) => text };
const message = (customType: string, content: unknown, details?: unknown) => ({
	role: "custom", customType, content, details, display: true, timestamp: 0,
});

it("renders collapsed and expanded agent answers", () => {
	const input = message("agent", "[agent#3] First\nSecond", {
		outcome: "finished", model: "anthropic/claude-opus-5-5", thinking: "medium", seconds: 42,
	});
	const collapsed = createAgentCard(input as never, { expanded: false, outputPad: 0 }, identity as never)!;
	assert.deepEqual(collapsed.render(80), ["agent#3 finished · opus medium · 42s", "  First Second"]);
	const expanded = createAgentCard(input as never, { expanded: true, outputPad: 0 }, identity as never)!;
	assert.deepEqual(expanded.render(80), ["agent#3 finished · opus medium · 42s", "  First", "  Second"]);
});

const longAnswer = `# BEGINNING\n\n${"filler line of the middle\n".repeat(400)}\nthe **end** with \`code\` DONE`;

it("shows only the plain tail of a long collapsed answer, cut to the width", () => {
	const card = createAgentCard(message("agent", `[agent#7] ${longAnswer}`) as never, { expanded: false, outputPad: 0 }, identity as never)!;
	const rows = card.render(40);
	assert.equal(rows.length, 2);
	// Plain text: the markdown wrappers stay as written, and the start of the answer is never read.
	assert.equal(rows[1], "  …e middle the **end** with `code` DONE");
	assert.equal(card.render(40), rows);
});

it("shows the plain tail in a collapsed child wait result", () => {
	const details = { reason: "result", results: [{ id: "agent#7", outcome: "completed", text: longAnswer }] };
	const card = createChildWaitCard(message("child_wait", JSON.stringify(details), details) as never,
		{ expanded: false, outputPad: 0 }, identity as never)!;
	const rows = card.render(40);
	assert.equal(rows.length, 2);
	assert.equal(rows[1], "  …e middle the **end** with `code` DONE");
});

it("cuts the collapsed tail on whole graphemes and cleans terminal sequences", () => {
	const text = "start\u001b[31m red \u001b[0m 👨‍👩‍👧 e\u0301e\u0301e\u0301";
	const card = createAgentCard(message("agent", `[agent#8] ${text}`) as never, { expanded: false, outputPad: 0 }, identity as never)!;
	assert.equal(card.render(80)[1], "  start red 👨‍👩‍👧 e\u0301e\u0301e\u0301");
	assert.equal(card.render(8)[1], "  … e\u0301e\u0301e\u0301");
});

it("renders review verdicts and counts real sections", () => {
	const clean = createReviewCard(message("review", "[review#2] CLEAN\nCHECKED:\n- proof", { n: 2 }) as never,
		{ expanded: false, outputPad: 0 }, identity as never)!;
	assert.deepEqual(clean.render(80), ["review#2 CLEAN", "  CLEAN"]);
	const body = "FINDINGS:\nFINDING 1\nREQUIREMENT: x\nMISMATCH: x\nEVIDENCE: x\nREQUIRED OUTCOME: x\nUNCHECKED:\n- missing";
	assert.deepEqual(reviewCounts(body), { findings: 1, unchecked: 1 });
});

it("renders child wait results and preserves expanded answers", () => {
	const details = { reason: "result", results: [
		{ id: "agent#3", outcome: "completed", text: "First\nSecond" },
		{ id: "agent#4", outcome: "error", text: "Failed" },
	] };
	const collapsed = createChildWaitCard(message("child_wait", JSON.stringify(details), details) as never,
		{ expanded: false, outputPad: 0 }, identity as never)!;
	assert.deepEqual(collapsed.render(80), [
		"child_wait · 2 results · 1 failed", "  agent#3 finished", "    First Second", "  agent#4 failed", "    Failed",
	]);
	const expanded = createChildWaitCard(message("child_wait", JSON.stringify(details), details) as never,
		{ expanded: true, outputPad: 0 }, identity as never)!;
	assert.ok(expanded.render(80).includes("    Second"));
});

it("parses delivered wait cards and rejects diagnostics", () => {
	const details = { reason: "result", results: [{ id: "agent#3", text: "Done", display: { outcome: "finished" } }] };
	assert.deepEqual(waitCards("agent", { action: "wait" }, { details })?.map((card) => [card.id, card.body]), [["agent#3", "Done"]]);
	assert.equal(waitCards("agent", { action: "wait" }, { details: { reason: "alert", results: [] } }), undefined);
});

it("keeps folded self-shell rows and replaces expanded ones with cards", () => {
	const innerView = { render: () => ["INNER"], invalidate() {} };
	const wrapped = selfShellWaitRenderers("agent", {
		renderShell: "self", renderCall: () => innerView, renderResult: () => innerView,
	} as never);
	const theme = { ...identity, bg: (_role: string, text: string) => text };
	const state = {};
	const base = { args: { action: "wait" }, state, outputPad: 0, isError: false, invalidate() {} };
	assert.deepEqual(wrapped.renderCall!(base.args, theme as never, { ...base, expanded: false } as never).render(80), ["INNER"]);
	const context = { ...base, expanded: true };
	const view = wrapped.renderCall!(base.args, theme as never, context as never);
	wrapped.renderResult!({ content: [{ type: "text", text: "RAW" }], details: {
		reason: "result", results: [{ id: "agent#3", text: "FULL ANSWER", display: { outcome: "finished" } }],
	} }, { expanded: true, isPartial: false }, theme as never, context as never);
	const rows = view.render(80).map(strip);
	assert.equal(rows.some((row) => row.includes("FULL ANSWER")), true);
	assert.equal(rows.some((row) => row.includes("RAW")), false);
});

it("hides the follow-up sentence in collapsed and expanded cards and keeps other bodies", () => {
	const followUp = "Perform any necessary follow-up actions in response to the subagent completion above. If no follow-up work is needed, no further action is required. Don't repeat the same confirmation every time.";
	const render = (content: string, expanded: boolean) =>
		createAgentCard(message("agent", content) as never, { expanded, outputPad: 0 }, identity as never)!.render(80);
	const withFollowUp = `[agent#4] First\nreal last words\n\n${followUp}`;
	const collapsed = render(withFollowUp, false).join("\n");
	assert.ok(collapsed.includes("real last words"));
	for (const expanded of [false, true]) assert.ok(!render(withFollowUp, expanded).join("\n").includes("follow-up actions"));
	const plain = render("[agent#4] First\n\nSecond", true).join("\n");
	assert.ok(plain.includes("First") && plain.includes("Second"));
});
