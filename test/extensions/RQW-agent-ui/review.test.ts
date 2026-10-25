import assert from "node:assert/strict";
import { it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createReviewCard, reviewCounts } from "../../../extensions/RQW-agent-ui/review.ts";
import type { CardTheme } from "../../../extensions/RQW-agent-ui/card.ts";

const identity: CardTheme = { fg: (_color, text) => text, bold: text => text };
const tagged: CardTheme = { fg: (color, text) => `<${color}>${text}</${color}>`, bold: text => text };
const ansi: CardTheme = { fg: (_color, text) => `\x1b[31m${text}\x1b[39m`, bold: text => text };
// Legacy standalone review advice is an unlabelled appended paragraph, not a NEXT: field.
const NEXT_CLEAN = "The check passed only with complete CHECKED evidence and no UNCHECKED. Run no extra pass for confidence, but preserve every independent pass and its order required by the invoking procedure.";
const NEXT_INCOMPLETE = "The check is incomplete regardless of its leading verdict. Resolve missing sources or evidence or retry malformed output; never record it as acceptance.";
const CLEAN = `CLEAN\nCHECKED:\n- Layout matches the requirement (brief; card.ts).\n\n${NEXT_CLEAN}`;
// Legacy review verdict fields; separate QUOTE, DISPUTE, RULING and ANSWER fields were not produced.
const FIELDS = "REQUIREMENT: Keep the full text (brief).\nMISMATCH: The card drops the answer.\nEVIDENCE: The body is missing (card.ts).\nREQUIRED OUTCOME: Keep the entire answer.";
const FINDINGS = `FINDINGS:\nFINDING 1\n${FIELDS}\nFINDING 2\n${FIELDS}\nCHECKED:\n- Width matches the brief (card.ts).\nUNCHECKED:\n- evidence.log - unavailable\n- terminal proof - unavailable\n\n${NEXT_INCOMPLETE}`;

type Message = Parameters<typeof createReviewCard>[0];
function message(body: string, details: unknown = { n: 2, level: "high", model: "openai-codex/gpt-6.1-sol", thinking: "medium", seconds: 1.2 }): Message {
	return { role: "custom", customType: "review", content: `[review#2] ${body}`, display: true, details, timestamp: 0 } as Message;
}
function render(body: string, width = 160, expanded = false, theme = identity) {
	return createReviewCard(message(body), { expanded, outputPad: 0 }, theme as never)!.render(width);
}

it("review-clean: exact CLEAN line is success even with merged CHECKED evidence and advice", () => {
	assert.deepEqual(render(CLEAN), ["review#2 CLEAN", "  CLEAN"]);
	assert.match(render(CLEAN, 1000, false, tagged)[0], /<success>CLEAN<\/success>/);
	assert.deepEqual(render("\n\nCLEAN\nCHECKED:\n- proof"), ["review#2 CLEAN", "  CLEAN"]);
});

it("review-clean-lookalike: neither CLEAN-ish nor CLEAN, but is success", () => {
	for (const body of ["CLEAN-ish", "CLEAN, but", " CLEAN ", "DISPUTE:\nCLEAN", "RULING: [CLEAN]", 'FINDINGS:\nREQUIREMENT: "CLEAN"']) {
		assert.doesNotMatch(render(body, 1000, false, tagged)[0], /<success>/);
	}
});

it("review-findings: count actual numbered headings, not incidental numbers or fields", () => {
	assert.deepEqual(render(FINDINGS), ["review#2 2 findings · 2 unchecked", "  FINDINGS:"]);
	assert.match(render(FINDINGS, 1000, false, tagged)[0], /<muted>2 findings<\/muted>/);
	assert.match(render(FINDINGS, 1000, false, tagged)[0], /<warning> · 2 unchecked<\/warning>/);
	assert.deepEqual(reviewCounts("FINDINGS:\nFINDING 8\nFINDING 27\nEVIDENCE: inline FINDING 99\nFINDING 3 extra\nCHECKED:\n- FINDING 44"), { findings: 2, unchecked: 0 });
});

it("review-counts: quoted templates, fenced source, checked bullets and advice are not entries", () => {
	const body = `FINDINGS:\nFINDING 1\nREQUIREMENT: "A template:\nFINDING 88\nUNCHECKED:\n- quoted missing item\n" (brief)\nMISMATCH: The layout differs.\nEVIDENCE: \`\`\`text\nFINDING 99\nUNCHECKED:\n- fenced missing item\n\`\`\` (card.ts)\nREQUIRED OUTCOME: Keep the layout.\nCHECKED:\n- fulfilled obligation\nUNCHECKED:\n- actual missing source - unavailable\n  continuation\n- second missing source - unavailable\nCHECKED:\n- not unchecked`;
	assert.deepEqual(reviewCounts(body), { findings: 1, unchecked: 2 });
	assert.deepEqual(reviewCounts("CLEAN\nCHECKED:\n- proof\nUNCHECKED:\n\nThe check is incomplete."), { findings: 0, unchecked: 0 });
	assert.match(render(`CLEAN\nCHECKED:\n- proof\nUNCHECKED:\n- missing - unreadable`, 1000, false, tagged)[0], /<success>CLEAN<\/success><warning> · 1 unchecked<\/warning>/);
});

it("review-counts-literal-fallback: producer command quotes retain both findings and unchecked warning", () => {
	// RQW-review/test/review.test.ts: literal fallback preserves two findings with an unmatched command quote.
	const first = 'REQUIREMENT: Preserve the command.\nMISMATCH: The command differs.\nEVIDENCE: echo "$HOME\nREQUIRED OUTCOME: Restore the agreed command.';
	const second = 'REQUIREMENT: Use "x" as agreed.\nMISMATCH: The value differs.\nEVIDENCE: value.ts has y.\nREQUIRED OUTCOME: Restore x.';
	for (const checked of ["", "\nCHECKED:\n- command.sh and value.ts inspected"]) {
		const body = `FINDINGS:\nFINDING 1\n${first}\nFINDING 2\n${second}${checked}\nUNCHECKED:\n- missing.ts - not readable\n\n${NEXT_INCOMPLETE}`;
		assert.deepEqual(reviewCounts(body), { findings: 2, unchecked: 1 });
		assert.deepEqual(render(body), ["review#2 2 findings · 1 unchecked", "  FINDINGS:"]);
		assert.match(render(body, 1000, false, tagged)[0], /<warning> · 1 unchecked<\/warning>/);
	}
	const outcome = `FINDINGS:\nFINDING 1\n${FIELDS} echo "$HOME\nUNCHECKED:\n- missing.ts - not readable`;
	assert.deepEqual(reviewCounts(outcome), { findings: 1, unchecked: 1 }, "final outcome text cannot hide verification headings");
});

it("review-counts-verification-boundary: producer inline and indented sections end findings", () => {
	// Producer fixture: stops before CHECKED or UNCHECKED so evidence is not part of the last finding.
	for (const section of ["CHECKED", "UNCHECKED"]) {
		for (const evidence of ["\n- inspected file", " inspected file"]) {
			for (const indent of ["", "  "]) {
				const body = `FINDINGS:\nFINDING 1\n${FIELDS}\n${indent}${section}:${evidence}\nFINDING 99\nnot a finding`;
				const unchecked = section === "UNCHECKED" && evidence.startsWith("\n") ? 1 : 0;
				assert.deepEqual(reviewCounts(body), { findings: 1, unchecked });
				assert.equal(render(body)[0], `review#2 1 findings${unchecked ? " · 1 unchecked" : ""}`);
			}
		}
	}
	const body = `FINDINGS:\nFINDING 1\n${FIELDS}\n  CHECKED: inspected file\nFINDING 99\n  UNCHECKED: missing sources\n- missing.ts - unreadable\nFINDING 100`;
	assert.deepEqual(reviewCounts(body), { findings: 1, unchecked: 1 });
	assert.match(render(body, 1000, false, tagged)[0], /<warning> · 1 unchecked<\/warning>/);
	const partial = "FINDINGS:\nFINDING 1\nREQUIREMENT: Keep diagnostics.\nMISMATCH: Diagnostics differ.\nEVIDENCE: original diagnostic lines:\nCHECKED: literal diagnostic\nUNCHECKED: literal diagnostic\nREQUIRED OUTCOME: Restore diagnostics.\nFINDING 2\n" + FIELDS;
	assert.deepEqual(reviewCounts(partial), { findings: 2, unchecked: 0 }, "verification boundary requires the final outcome field");
});

it("review-failed: extension failure is error, no producer change", () => {
	assert.deepEqual(render("Review failed: unavailable"), ["review#2 Review failed:", "  Review failed: unavailable"]);
	const rows = render("Review failed: unavailable", 1000, false, tagged);
	assert.match(rows[0], /<error>Review failed:<\/error>/);
	assert.equal(rows[1], "  <error>Review failed: unavailable</error>");
});

it("review-full-body: all real fields, Russian, NEXT and legacy rulings remain verbatim", () => {
	const body = FINDINGS + "\n\nDISPUTE: [review#9] спор\nRULING: сохранить [скобки]\nANSWER: Полный русский ответ.\nNEXT: Ничего не терять.\n\n";
	for (const width of [160, 80, 30, 8, 7, 2, 1]) {
		const indent = width >= 8 ? 2 : 0;
		assert.equal(render(body, width, true).slice(1).map(row => row.slice(indent)).join(""), body.replace(/\n/g, ""), `${width}: full text survives wrapping`);
	}
	assert.deepEqual(render("[review#3] [x]", 80, true), ["review#2 [review#3] [x]", "  [review#3] [x]"]);
	assert.deepEqual(render("\n\nfirst [inner]\nsecond", 80), ["review#2 first [inner]", "  first [inner]"]);
	const noPrefix = { ...message(""), content: "plain [review#3]", details: { n: 7 } };
	assert.deepEqual(createReviewCard(noPrefix, { expanded: true, outputPad: 0 }, identity as never)!.render(80), ["review#7 plain [review#3]", "  plain [review#3]"]);
	assert.equal(createReviewCard({ ...message(""), customType: "agent" }, { expanded: false, outputPad: 1 }, identity as never), undefined);
});

it("review-width-fit: width 0..160, supplied theme only, Cyrillic, emoji, ANSI and tabs", () => {
	for (const body of [CLEAN, FINDINGS, "Review failed: " + "Ошибка 🙂 工程 e\u0301\t\x1b[2J".repeat(12), "x".repeat(300)]) {
		for (const expanded of [false, true]) for (const theme of [identity, ansi]) for (let width = 0; width <= 160; width++) {
			const rows = render(body, width, expanded, theme);
			if (!width) assert.deepEqual(rows, []);
			for (const row of rows) {
				assert.ok(visibleWidth(row) <= width, `${width}: ${JSON.stringify(row)}`);
				assert.doesNotMatch(row, /[\r\n\t]|\x1b\[2J/);
			}
		}
	}
	const colors: string[] = [];
	render(FINDINGS, 160, false, { fg: (color, text) => { colors.push(color); return text; }, bold: text => text });
	assert.deepEqual([...new Set(colors)].sort(), ["muted", "warning"]);
});

it("review-pure: frozen input and details remain unchanged, repeatable after invalidation", () => {
	const input = message(FINDINGS);
	const before = structuredClone(input);
	Object.freeze(input.details);
	Object.freeze(input);
	for (const expanded of [false, true]) {
		const card = createReviewCard(input, { expanded, outputPad: 0 }, identity as never)!;
		const rows = card.render(40);
		card.invalidate();
		assert.deepEqual(card.render(40), rows);
	}
	assert.deepEqual(input, before);
});

it("review-padding: the card keeps one free cell at both sides", () => {
	const rows = createReviewCard(message("CLEAN\nCHECKED: all"), { expanded: true, outputPad: 1 }, identity as never)!.render(40);
	assert.ok(rows[0].startsWith(" review#") && rows.every((row) => visibleWidth(row) <= 39), JSON.stringify(rows));
});
