import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { it } from "node:test";
import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import agentUi from "../../../extensions/RQW-agent-ui/index.ts";
import { type CardTheme, createAgentCard, setModelLookup } from "../../../extensions/RQW-agent-ui/card.ts";
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
	assert.deepEqual(collapsed.render(80), ["agent#3 finished · opus-5-5 md · 42s", "  First Second"]);
	const expanded = createAgentCard(input as never, { expanded: true, outputPad: 0 }, identity as never)!;
	assert.deepEqual(expanded.render(80), ["agent#3 finished · opus-5-5 md · 42s", "  First", "  Second"]);
});

it("shows the picker model label and the short effort in the card", () => {
	const names: Record<string, string> = {
		"anthropic/claude-sonnet-5-5": "Claude Sonnet 5.5", "openai-codex/gpt-6.1-terra": "GPT-6.1  Terra",
	};
	setModelLookup({ find: (provider, id) => { const name = names[`${provider}/${id}`]; return name ? { id, name } : undefined; } });
	const render = (model: string, thinking: string, theme: CardTheme = identity, width = 80) => {
		const input = message("agent", "[agent#3] Done", { outcome: "finished", model, thinking, seconds: 5 });
		return createAgentCard(input as never, { expanded: false, outputPad: 0 }, theme as never)!.render(width)[0];
	};
	assert.equal(render("anthropic/claude-sonnet-5-5", "medium"), "agent#3 finished · Sonnet 5.5 md · 5s");
	assert.equal(render("openai-codex/gpt-6.1-terra", "xhigh"), "agent#3 finished · GPT-6.1 Terra xh · 5s");
	assert.equal(render("anthropic/claude-unknown-1", "high"), "agent#3 finished · unknown-1 hi · 5s");
	const tagged: CardTheme = { fg: (color, text) => `<${color}>${text}</>`, bold: (text) => `<b>${text}</b>` };
	const wide = (thinking: string) => render("anthropic/claude-sonnet-5-5", thinking, tagged, 400);
	assert.match(wide("low"), /<text>Sonnet 5\.5<\/>/);
	assert.doesNotMatch(wide("low"), /<b><text>/);
	assert.match(wide("medium"), /<b><thinkingMedium>md<\/><\/b>/);
	assert.match(wide("low"), /<thinkingLow>lo<\/>/);
	assert.doesNotMatch(wide("low"), /<b><thinkingLow>/);
	setModelLookup(undefined);
});

it("shows verdict labels with semantic colors", () => {
	const theme: CardTheme = { fg: (color, text) => `\u001b[${color === "success" ? 32 : color === "error" ? 31 : 0}m${text}\u001b[0m`, bold: (text) => text };
	for (const [body, label, color] of [
		["\n CLEAN \nchecked", "CLEAN", 32],
		["FINDINGS:\nFINDING 1  \nproof", "1 finding", 31],
		[" FINDINGS: \nproof", "findings", 31],
		["FINDINGS:\nFINDING 1\nproof\nFINDING 2", "2 findings", 31],
		[" FINDINGS: 3 \nproof", "3 findings", 31],
		["ordinary answer", "finished", 32],
	] as const) {
		const card = createAgentCard(message("agent", `[agent#3] ${body}`, { outcome: "finished" }) as never,
			{ expanded: false, outputPad: 0 }, theme as never)!;
		const header = card.render(100)[0];
		assert.equal(strip(header), `agent#3 ${label}`);
		assert.ok(header.includes(`\u001b[${color}m${label}`));
	}
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

const painted: CardTheme = { fg: (color, text) => `<${color}>${text}`, bold: (text) => text };

it("counts only real findings of a protocol body, not quoted examples", () => {
	const body = "FINDINGS:\nFINDING 1\nREQUIREMENT: x\nMISMATCH: x\nEVIDENCE: example\n```\nFINDING 99\n```\nREQUIRED OUTCOME: x\nCHECKED:\n- x";
	const card = createAgentCard(message("agent", `[agent#3] ${body}`, { outcome: "finished" }) as never,
		{ expanded: false, outputPad: 0 }, painted as never)!;
	const header = card.render(100)[0];
	assert.ok(header.includes("<error>1 finding"), header);
	assert.ok(!header.includes("<success>"), header);
});

it("counts findings when the heading and FINDING lines have surrounding whitespace", () => {
	const body = "  FINDINGS:  \n  FINDING 1  \nREQUIREMENT: x\nMISMATCH: x\nEVIDENCE: e\nREQUIRED OUTCOME: x\n\t FINDING 2 \nREQUIREMENT: x\nMISMATCH: x\nEVIDENCE: e\nREQUIRED OUTCOME: x\nCHECKED:\n- x";
	assert.deepEqual(reviewCounts(body), { findings: 2, unchecked: 0 });
	const card = createAgentCard(message("agent", `[agent#3] ${body}`, { outcome: "finished" }) as never,
		{ expanded: false, outputPad: 0 }, painted as never)!;
	assert.ok(card.render(100)[0].includes("<error>2 findings"));
	const quoted = "FINDINGS:\n  FINDING 1 \nREQUIREMENT: x\nMISMATCH: x\nEVIDENCE: ex\n```\n  FINDING 99  \n```\nREQUIRED OUTCOME: x";
	assert.equal(reviewCounts(quoted).findings, 1);
});

it("colours a stored review verdict after trimming its first line", () => {
	const card = createReviewCard(message("review", "[review#2]  CLEAN \nCHECKED:\n- x") as never,
		{ expanded: false, outputPad: 0 }, painted as never)!;
	assert.ok(card.render(80)[0].includes("<success>CLEAN"));
	const none = createReviewCard(message("review", "[review#3] FINDINGS:\nproof") as never,
		{ expanded: false, outputPad: 0 }, painted as never)!;
	assert.ok(!none.render(80)[0].includes("0 "));
});

const LONG = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango";
const squash = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "").replace(/[^a-z]/g, "");

it("does not repaint the remaining cards at an unchanged width and refreshes after invalidate", () => {
	let paints = 0;
	const counting: CardTheme = { fg: (_color, text) => (paints++, text), bold: (text) => text };
	const options = { expanded: true, outputPad: 0 };
	const review = createReviewCard(message("review", `[review#2] CLEAN\nCHECKED:\n- ${LONG}`) as never, options, counting as never)!;
	const self = selfShellWaitRenderers("agent", { renderShell: "self", renderCall: () => ({ render: () => [], invalidate() {} }) } as never);
	const theme = { ...counting, bg: (_role: string, text: string) => text };
	const base = { args: { action: "wait" }, state: {}, outputPad: 0, isError: false, invalidate() {}, expanded: true };
	const view = self.renderCall!(base.args, theme as never, base as never);
	self.renderResult!({ content: [], details: { reason: "result", results: [{ id: "agent#3", text: LONG, display: { outcome: "finished" } }] } },
		{ expanded: true, isPartial: false }, theme as never, base as never);
	for (const [component, id, answer] of [[review, "review#2", LONG], [view, "agent#3", LONG]] as const) {
		const first = [...component.render(80)];
		const before = paints;
		assert.deepEqual(component.render(80), first);
		assert.equal(paints, before);
		const resized = component.render(60);
		assert.ok(paints > before);
		assert.ok(resized.some((row) => row.includes(id)));
		assert.ok(resized.every((row) => strip(row).length <= 60));
		assert.ok(resized.length > first.length);
		assert.ok(squash(resized.join(" ")).includes(squash(answer)));
		const second = paints;
		component.invalidate();
		const refreshed = component.render(60);
		assert.ok(paints > second);
		assert.ok(refreshed.some((row) => row.includes(id)));
		assert.ok(refreshed.every((row) => strip(row).length <= 60));
		assert.ok(squash(refreshed.join(" ")).includes(squash(answer)));
	}
});

it("takes the model names from the registry of the started session", () => {
	setModelLookup(undefined);
	const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
	const renderers = new Map<string, MessageRenderer>();
	agentUi({
		on: (name: string, handler: (event: unknown, ctx: unknown) => void) => handlers.set(name, handler),
		registerMessageRenderer: (name: string, renderer: MessageRenderer) => renderers.set(name, renderer),
		registerToolRenderer() {},
	} as never);
	const registry = { find: (_provider: string, id: string) => ({ id, name: "Claude Sonnet 5.5" }) };
	handlers.get("session_start")!({ type: "session_start" }, { modelRegistry: registry });
	const input = message("agent", "[agent#3] Done", { outcome: "finished", model: "anthropic/claude-sonnet-5-5", thinking: "medium" });
	assert.equal(renderers.get("agent")!(input as never, { expanded: false, outputPad: 0 }, identity as never)!.render(80)[0], "agent#3 finished · Sonnet 5.5 md");
	setModelLookup(undefined);
});
