// Upper border, compaction metallic, status letters, title row, branch mark and effort colours: pure renders at fixed frames and widths.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	contextLabel, effortText, GOLD, GOLD_EDGE, GOLD_SHEEN, metallicColor, metallicText, mix, placeRow, RULE_SILVER,
	SILVER, shimmerPhase, shimmerText, sheenRow, titleRow, topBorder,
} from "../render.ts";

const plain = (_role: string, text: string) => text;
const ESC = "\x1b[";
const hexSgr = (hex: string, bold: boolean, text: string) => {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
	return `${ESC}${bold ? "1;" : ""}38;2;${r};${g};${b}m${text}${ESC}22;39m`;
};
const rule = (width: number) => "\u2500".repeat(Math.max(0, width));
const id = "0b6f1d2e-9c1a-4f7e-8a3b-5d2c7e9f1a04";
const chrome = (text: string, compacting: boolean, frame: number) => ({ text, compacting, frame });

describe("status letters", () => {
	it("follow f = (.5 + .5 cos(i*.32 - frame*.22))**2 by their global column, bold on the crest only", () => {
		assert.equal(shimmerPhase(0, 0), 1);
		assert.ok(Math.abs(shimmerPhase(5, 3) - (0.5 + 0.5 * Math.cos(5 * 0.32 - 3 * 0.22)) ** 2) < 1e-12);
		const text = "Compacting";
		const expected = Array.from(text).map((ch, i) => {
			const f = shimmerPhase(12 + i, 7);
			return hexSgr(mix(GOLD, f), f > 0.85, ch);
		}).join("");
		assert.equal(shimmerText(text, 12, 7, GOLD), expected);
	});

	it("gold compaction and silver busy letters share the phase and differ only in colour; spaces stay plain", () => {
		const gold = shimmerText("A B", 3, 7, GOLD);
		const silver = shimmerText("A B", 3, 7, SILVER);
		assert.notEqual(gold, silver);
		assert.equal(stripVTControlCharacters(gold), "A B");
		assert.equal(gold.split(" ").length, 2, "the space is not coloured");
		assert.equal(gold.split(`${ESC}1;`).length - 1, silver.split(`${ESC}1;`).length - 1, "same crest");
	});
});

describe("metallic global column geometry", () => {
	const W = 60;
	const frame = 4;

	it("the base is the full-width gold gradient at x/(W-1); the midpoint is a stop, a singleton uses the midpoint", () => {
		assert.equal(metallicColor(0, W, frame), GOLD[0], "x=0 at d=56 is the first gold stop");
		assert.equal(metallicColor(W - 1 - 4, W, frame), mix(GOLD, (W - 5) / (W - 1)), "x=55 at d=51 along the gradient");
		assert.equal(metallicColor(59, W, frame), GOLD[2], "the last column before the edge run gets the gradient end (d=55)");
		assert.equal(mix(GOLD, 0.5), GOLD[1], "the midpoint is the middle stop");
	});

	it("the sheen is six cells from d=0, the edge is d=6 and the last cell, the offset wraps with the frame", () => {
		for (let x = 4; x <= 9; x++) assert.equal(metallicColor(x, W, frame), GOLD_SHEEN, `sheen at ${x}`);
		assert.equal(metallicColor(10, W, frame), GOLD_EDGE, "d=6 is the edge");
		assert.equal(metallicColor(3, W, frame), GOLD_EDGE, "d=59 is the last cell: the edge");
		assert.notEqual(metallicColor(4, W, frame), metallicColor(4, W, frame + 1), "the sheen moves with the frame");
		assert.equal(metallicColor(0, W, frame), metallicColor(0, W, frame + W), "the frame wraps at the width");
	});

	it("exact colour values: sheen #f2de8a, edge #d9b84a, base stops #8a6d1c/#c9a227/#e3c45a", () => {
		assert.equal(GOLD_SHEEN, "#f2de8a");
		assert.equal(GOLD_EDGE, "#d9b84a");
		assert.deepEqual(GOLD, ["#8a6d1c", "#c9a227", "#e3c45a"]);
		assert.equal(metallicText("\u2501", 1, 0), hexSgr(GOLD_SHEEN, true, "\u2501"), "one cell is the sheen");
		assert.equal(metallicText("\u2501", 7, 1, 0), hexSgr(GOLD_EDGE, true, "\u2501"), "d=6 at width 7 is the edge");
	});

	it("the same global column gets the same colour in every row, a segment does not restart the geometry", () => {
		const whole = metallicText("x".repeat(20), 40, 2);
		const cut = metallicText("x".repeat(8), 40, 2, 0) + metallicText("x".repeat(12), 40, 2, 8);
		assert.equal(whole, cut);
	});

	it("every width 0..160 renders exactly its width in metallic cells", () => {
		for (let width = 0; width <= 160; width++) {
			assert.equal(visibleWidth(metallicText(rule(width), width, 3)), width, `${width}`);
			assert.equal(visibleWidth(sheenRow({ tokens: 13000, limit: 450000 }, width, 3, 8)), width, `${width}`);
			assert.equal(visibleWidth(sheenRow({ tokens: null, limit: 450000 }, width, 3)), width, `${width}`);
		}
	});
});

describe("top border", () => {
	it("is exact at every width 0..160 with and without the ID, status, hint and compaction", () => {
		for (let width = 0; width <= 160; width++) {
			for (const [chromeNow, hidden] of [
				[undefined, 0], [undefined, 8], [chrome("Planning next moves", false, 2), 0],
				[chrome("Running npm test", false, 2), 12345], [chrome("Compacting context", true, 4), 0],
				[chrome("x".repeat(90), false, 1), 3],
			] as const) {
				const line = topBorder(width, id, chromeNow, hidden, plain);
				assert.equal(visibleWidth(line), width, `${width} ${hidden} ${chromeNow?.text}`);
			}
		}
	});

	it("ordinary rule is the fixed silver #b6b6b4, the ID is the muted paint (plain here)", () => {
		assert.equal(RULE_SILVER, "#b6b6b4");
		assert.equal(topBorder(20, undefined, undefined, 0, plain), hexSgr(RULE_SILVER, false, rule(20)));
		assert.equal(topBorder(42, id, undefined, 0, plain),
			`${hexSgr(RULE_SILVER, false, rule(2))}${hexSgr(RULE_SILVER, false, " ")}${id}${hexSgr(RULE_SILVER, false, " \u2500\u2500")}`);
	});

	it("the ID is whole only from width 42 and only when the status and hint fit beside it", () => {
		assert.equal(stripVTControlCharacters(topBorder(41, id, undefined, 0, plain)), rule(41), "one cell short: dropped whole");
		assert.equal(stripVTControlCharacters(topBorder(42, id, undefined, 0, plain)), `${rule(2)} ${id} \u2500\u2500`);
		assert.equal(stripVTControlCharacters(topBorder(64, id, chrome("Planning next moves", false, 0), 0, plain)).includes(id), false);
		assert.equal(stripVTControlCharacters(topBorder(65, id, chrome("Planning next moves", false, 0), 0, plain)).includes(id), true);
		// The hint is kept whole, the ID goes first.
		const hinted = stripVTControlCharacters(topBorder(51, id, undefined, 8, plain));
		assert.equal(hinted.includes(id), false, "hint 10 cells + ID 40 do not fit beside each other in 51");
		assert.ok(hinted.includes(" \u2191 8 more "));
	});

	it("drops the ID before cutting the status, never cuts the ID", () => {
		const line = stripVTControlCharacters(topBorder(60, id, chrome("x".repeat(40), false, 0), 0, plain));
		assert.ok(!line.includes(id.slice(0, 8)), "the ID is not partly shown");
		assert.ok(line.startsWith("\u2500\u2500 "));
	});

	it("ordinary busy letters shimmer silver by global column after `── `", () => {
		const line = topBorder(60, undefined, chrome("Planning next moves", false, 2), 0, plain);
		assert.ok(line.startsWith(`${hexSgr(RULE_SILVER, false, "\u2500\u2500 ")}${shimmerText("Planning next moves", 3, 2, SILVER)}`));
	});

	it("compaction: status letters gold by the cosine, the rest and the ID metallic by global column", () => {
		const frame = 4;
		const line = topBorder(80, id, chrome("Compacting context", true, frame), 0, plain);
		assert.ok(line.startsWith(`${metallicText("\u2500\u2500 ", 80, frame, 0)}${shimmerText("Compacting context", 3, frame, GOLD)}`));
		assert.ok(line.includes(metallicText(id, 80, frame, 80 - 40 + 1)), "the ID is metallic at its global columns");
		assert.equal(stripVTControlCharacters(line), `\u2500\u2500 Compacting context ${rule(18)} ${id} \u2500\u2500`);
	});

	it("the hint is centred in the head as Pi centres it, in metallic cells while compacting", () => {
		assert.equal(stripVTControlCharacters(topBorder(80, id, undefined, 8, plain)),
			`${rule(15)} \u2191 8 more ${rule(15)} ${id} \u2500\u2500`);
		// At 120 the head is 80 cells: the hint starts at cell 35, the status (18) fits before it, so the ID stays.
		const compacting = topBorder(120, id, chrome("Compacting context", true, 0), 8, plain);
		assert.ok(compacting.includes(metallicText(" \u2191 8 more ", 120, 0, 35)));
		assert.equal(stripVTControlCharacters(compacting),
			`\u2500\u2500 Compacting context ${rule(13)} \u2191 8 more ${rule(35)} ${id} \u2500\u2500`);
	});
});

describe("full meter and label", () => {
	it("busy is full ━ whatever the tokens, the label keeps its text; unknown tokens too", () => {
		const meter = sheenRow({ tokens: 13000, limit: 450000 }, 60, 4);
		assert.equal(stripVTControlCharacters(meter), "━".repeat(60 - contextLabel({ tokens: 13000, limit: 450000 }).length) + contextLabel({ tokens: 13000, limit: 450000 }));
		const unknown = stripVTControlCharacters(sheenRow({ tokens: null, limit: 450000 }, 40, 4));
		assert.equal(unknown, "━".repeat(40 - contextLabel({ tokens: null, limit: 450000 }).length) + contextLabel({ tokens: null, limit: 450000 }));
		assert.ok(unknown.endsWith("?/450k"));
	});

	it("without a valid context the row is still the full busy ━, and the hint comes first when lines are hidden", () => {
		assert.equal(stripVTControlCharacters(sheenRow(undefined, 20, 0)), "━".repeat(20));
		assert.equal(stripVTControlCharacters(sheenRow({ tokens: null, limit: 0 }, 20, 0)), "━".repeat(20));
		// At width 40 the label leaves room for the fill after the hint; at 20 the hint and the label still fit whole.
		const wide = stripVTControlCharacters(sheenRow({ tokens: 1, limit: 100 }, 40, 0, 8));
		assert.equal(visibleWidth(wide), 40);
		assert.equal(wide.startsWith("↓ 8 more ━"), true);
		const narrow = stripVTControlCharacters(sheenRow({ tokens: 1, limit: 100 }, 20, 0, 8));
		assert.equal(visibleWidth(narrow), 20);
		assert.equal(narrow.startsWith("↓ 8 more "), true);
	});

	it("tiny widths: clipped title, status, hint and meter are plain cells with no escape fragments", () => {
		const name = "Long name here";
		assert.equal(stripVTControlCharacters(titleRow(name, 6)), "Long …");
		assert.equal(stripVTControlCharacters(titleRow(name, 1)), "…");
		for (let width = 1; width <= 16; width++) {
			const title = titleRow(name, width);
			assert.equal(visibleWidth(title), Math.min(width, name.length), `title ${width}`);
			assert.doesNotMatch(stripVTControlCharacters(title), /\[0m|\x1b/, `title ${width}`);
			const status = topBorder(width, undefined, chrome("Planning next moves", false, 0), 0, plain);
			assert.equal(visibleWidth(status), width, `status ${width}`);
			assert.doesNotMatch(stripVTControlCharacters(status), /\[0m|\x1b/, `status ${width}`);
			const compact = topBorder(width, id, chrome("Compacting context", true, 2), 8, plain);
			assert.equal(visibleWidth(compact), width, `compact ${width}`);
			assert.doesNotMatch(stripVTControlCharacters(compact), /\[0m|\x1b/, `compact ${width}`);
			const hint = sheenRow({ tokens: 1, limit: 100 }, width, 0, 8);
			assert.equal(visibleWidth(hint), width, `hint ${width}`);
			assert.doesNotMatch(stripVTControlCharacters(hint), /\[0m|\x1b/, `hint ${width}`);
		}
		assert.equal(stripVTControlCharacters(sheenRow({ tokens: 1, limit: 100 }, 1, 0, 8)), "…");
	});
});

describe("title row", () => {
	it("is empty until a name exists and then static gold over its own code points", () => {
		assert.equal(titleRow(undefined, 40), "");
		assert.equal(titleRow("  ", 40), "");
		const one = titleRow("A", 40);
		assert.equal(one, hexSgr(mix(GOLD, 0.5), true, "A"), "a singleton takes the midpoint");
		assert.equal(titleRow("A", 40), titleRow("A", 40), "frame and state invariant");
	});

	it("is a gold gradient over the title's own Unicode code points, not the terminal width", () => {
		assert.equal(visibleWidth(titleRow("Тест имени", 40)), 10);
		assert.equal(visibleWidth(titleRow("Long name here", 6)), 6);
		const points = Array.from("Тест");
		const first = titleRow("Тест", 40);
		assert.ok(first.startsWith(hexSgr(mix(GOLD, 0), true, "Т")), "first code point at the gold base");
		assert.ok(first.includes(hexSgr(mix(GOLD, 1), true, "т")), "last code point at the gold end");
		assert.equal(points.length, 4);
	});
});

describe("branch mark on the place row", () => {
	const state = (branch: number | undefined, width: number) => placeRow({
		branch, place: { kind: "folder", text: "~/ai-project/my-pi" }, statuses: [], git: undefined,
		context: undefined, compactions: 0,
	} as never, width, plain);

	it("shows after the folder with two spaces only when off the original branch", () => {
		assert.equal(state(undefined, 60), " \uf115 ~/ai-project/my-pi");
		assert.equal(state(2, 60), " \uf115 ~/ai-project/my-pi  \u2442 ветка 2");
	});

	it("drops the whole mark before the folder is cut", () => {
		assert.equal(state(2, 26), state(undefined, 26));
		assert.ok(state(2, 26).includes("~/ai-project/my-pi"));
	});
});

describe("effort colours", () => {
	it("low stays plain; medium green, high gold, xhigh bright purple, max bright red, all bold", () => {
		assert.equal(effortText("low", "lo", plain), "lo");
		assert.ok(effortText("medium", "md", plain).startsWith(`${ESC}1;32m`));
		assert.ok(effortText("high", "hi", plain).startsWith(`${ESC}1;38;2;201;162;39m`));
		assert.ok(effortText("xhigh", "xh", plain).startsWith(`${ESC}1;95m`));
		assert.ok(effortText("max", "mx", plain).startsWith(`${ESC}1;91m`));
	});
});
