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
	assert.deepEqual(collapsed.render(80), ["agent#3 finished · opus medium · 42s", "  First"]);
	const expanded = createAgentCard(input as never, { expanded: true, outputPad: 0 }, identity as never)!;
	assert.deepEqual(expanded.render(80), ["agent#3 finished · opus medium · 42s", "  First", "  Second"]);
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
		"child_wait · 2 results · 1 failed", "  agent#3 finished", "    First", "  agent#4 failed", "    Failed",
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
