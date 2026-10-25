// Deterministic layout and cell-based animation, without a terminal or model request.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripVTControlCharacters as strip } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	activityRows, contextLabel, effortText, GOLD, GOLD_FALLOFF_CELLS, GOLD_PLATEAU_CELLS,
	mix, placeRow, RULE_SILVER, SHIMMER_CELLS_PER_FRAME, SHIMMER_PERIOD_CELLS,
	SILVER, SILVER_FALLOFF_CELLS, SILVER_PLATEAU_CELLS, shimmerPhase, shimmerText,
	sheenRow, titleRow, topBorder,
} from "../render.ts";
import { STATUS_FRAME_MS } from "../index.ts";

const plain = (_role: string, text: string) => text;
const ESC = "\x1b[";
const hexSgr = (hex: string, bold: boolean, text: string) => {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
	return `${ESC}${bold ? "1;" : ""}38;2;${r};${g};${b}m${text}${ESC}22;39m`;
};
const rule = (width: number) => "\u2500".repeat(Math.max(0, width));
const id = "0b6f1d2e-9c1a-4f7e-8a3b-5d2c7e9f1a04";
const chrome = (text: string, compacting = false, frame = 0) => ({ text, compacting, frame });

describe("cell-based shimmer", () => {
	it("has a bright flat three-cell silver peak and a six-to-seven-cell gold peak", () => {
		assert.equal(SILVER_PLATEAU_CELLS, 3);
		assert.equal(GOLD_PLATEAU_CELLS, 6.5);
		assert.equal(SILVER.at(-1), "#ffffff");
		assert.equal(GOLD.at(-1), "#fff4c2");
		const peakCells = (center: number, gold: boolean) => Array.from({ length: 19 }, (_, i) => i - 9)
			.filter((i) => shimmerPhase(i, center / SHIMMER_CELLS_PER_FRAME, gold) === 1).length;
		for (const center of [0, 0.1, 0.4, 0.5, 0.6, 0.9]) {
			assert.equal(peakCells(center, false), 3);
			const painted = shimmerText("x".repeat(19), -9, center / SHIMMER_CELLS_PER_FRAME, SILVER);
			assert.equal(painted.split(hexSgr(SILVER.at(-1)!, true, "x")).length - 1, 3);
		}
		assert.equal(peakCells(0, true), 7);
		assert.equal(peakCells(0.5, true), 6);
		for (const [stops, count] of [[SILVER, 3], [GOLD, 7]] as const) {
			const painted = shimmerText("x".repeat(19), -9, 0, stops);
			assert.equal(painted.split(hexSgr(stops.at(-1)!, true, "x")).length - 1, count);
			assert.doesNotMatch(painted, /\x1b\[(?:3|23)m/, "no slant");
		}
	});

	it("falls off monotonically and smoothly per letter on both sides, with the broadest shoulder in gold", () => {
		assert.equal(SILVER_FALLOFF_CELLS, 4.5);
		assert.equal(GOLD_FALLOFF_CELLS, 6);
		for (const gold of [false, true]) {
			const half = (gold ? GOLD_PLATEAU_CELLS : SILVER_PLATEAU_CELLS) / 2;
			const shoulder = gold ? GOLD_FALLOFF_CELLS : SILVER_FALLOFF_CELLS;
			let previous = 1;
			for (let distance = half; distance <= half + shoulder; distance += 0.05) {
				const next = shimmerPhase(distance, 0, gold);
				assert.ok(next >= 0 && next <= previous + 1e-12);
				assert.ok(previous - next < 0.02, "no abrupt brightness steps");
				assert.ok(Math.abs(next - shimmerPhase(-distance, 0, gold)) <= 1 / 255 + 1e-12);
				previous = next;
			}
			const colors = Array.from({ length: 10 }, (_, i) => mix(gold ? GOLD : SILVER, shimmerPhase(i, 0, gold)))
				.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
			for (let i = 1; i < colors.length; i++) {
				for (let channel = 0; channel < 3; channel++) assert.ok(colors[i][channel] <= colors[i - 1][channel]);
			}
		}
		// The first letter beyond the plateau fades less in gold than in silver.
		assert.ok(1 - shimmerPhase(GOLD_PLATEAU_CELLS / 2 + 1, 0, true)
			< 1 - shimmerPhase(SILVER_PLATEAU_CELLS / 2 + 1, 0));
	});

	it("travels exactly twice the previous speed for silver and gold, independent of redraw cadence", () => {
		assert.equal(STATUS_FRAME_MS, 80);
		assert.equal(SHIMMER_CELLS_PER_FRAME, 0.22 / 0.32);
		assert.equal(SHIMMER_PERIOD_CELLS, 2 * Math.PI / 0.32);
		const oldCellsPerMs = (0.22 / 0.32) / 160;
		assert.equal(SHIMMER_CELLS_PER_FRAME / STATUS_FRAME_MS, oldCellsPerMs * 2);
		for (const gold of [false, true]) {
			for (const elapsed of [20, 87, 160, 1100]) {
				const moved = elapsed * oldCellsPerMs * 2;
				for (let x = 0; x < 30; x++) {
					assert.ok(Math.abs(shimmerPhase(x, elapsed / STATUS_FRAME_MS, gold) - shimmerPhase(x - moved, 0, gold)) < 1e-12);
				}
			}
		}
	});

	it("uses terminal cells across segments, wide glyphs and combining marks; spaces stay plain", () => {
		assert.equal(shimmerText("x".repeat(20), 0, 2, GOLD), shimmerText("x".repeat(8), 0, 2, GOLD) + shimmerText("x".repeat(12), 8, 2, GOLD));
		assert.equal(shimmerText("界e\u0301x", 0, 2, SILVER), shimmerText("界", 0, 2, SILVER)
			+ shimmerText("e", 2, 2, SILVER) + shimmerText("\u0301x", 3, 2, SILVER));
		assert.equal(shimmerText("A B", 3, 7, GOLD).split(" ").length, 2);
	});
});

describe("activity widget", () => {
	it("adds only a one-space status and trailing gap; idle adds no rows or gaps", () => {
		assert.deepEqual(activityRows(80, undefined), []);
		const active = chrome("Planning next moves");
		assert.deepEqual(activityRows(80, active), [" " + shimmerText(active.text, 1, 0, SILVER), ""]);
		assert.deepEqual(activityRows(80, chrome("Compacting context", true, 4)), [" " + shimmerText("Compacting context", 1, 4, GOLD), ""]);
		assert.deepEqual(activityRows(80, chrome("Waiting for 2 agents")).map(strip), [" Waiting for 2 agents", ""]);
	});

	it("fits widths 0..160 and sanitizes status metadata", () => {
		for (let width = 0; width <= 160; width++) {
			const rows = activityRows(width, chrome("Planning next moves"));
			assert.equal(rows.length, 2);
			assert.ok(visibleWidth(rows[0]) <= width);
			if (width > 0) assert.ok(strip(rows[0]).startsWith(" "));
			assert.equal(rows[1], "");
		}
		assert.deepEqual(activityRows(80, chrome("\x1b[31mA\nB\tC")).map(strip), [" A B C", ""]);
	});
});

describe("title in top border", () => {
	it("keeps name left between rules, full ID right, and no activity in the border", () => {
		const line = topBorder(80, id, chrome("Running npm test"), 0, plain, "Session name");
		assert.equal(strip(line), `── Session name ${rule(24)} ${id} ──`);
		assert.ok(line.includes(titleRow("Session name", 12)));
		assert.doesNotMatch(strip(line), /Running|Planning/);
		assert.equal(topBorder(80, id, undefined, 0, plain, "Session name"), line);
	});

	it("keeps exact widths and the hint at widths 0..160, with long or Unicode titles and compaction", () => {
		for (let width = 0; width <= 160; width++) {
			for (const name of [undefined, "Session name", "x".repeat(90), "界e\u0301 title"]) {
				for (const hidden of [0, 8, 12345]) {
					for (const compacting of [false, true]) {
						const line = topBorder(width, id, chrome("Not in border", compacting, 4), hidden, plain, name);
						assert.equal(visibleWidth(line), width, `${width} ${hidden} ${name}`);
						assert.doesNotMatch(strip(line), /\x1b|\[0m/);
					}
				}
			}
		}
	});

	it("drops the ID whole before cutting title or hint, preserving existing narrow behavior", () => {
		assert.equal(strip(topBorder(41, id, undefined)), rule(41));
		assert.equal(strip(topBorder(42, id, undefined)), `${rule(2)} ${id} ──`);
		assert.equal(strip(topBorder(64, id, undefined, 0, plain, "Planning next moves")).includes(id), false);
		assert.equal(strip(topBorder(65, id, undefined, 0, plain, "Planning next moves")).includes(id), true);
		assert.equal(strip(topBorder(51, id, undefined, 8)).includes(id), false);
		assert.ok(strip(topBorder(51, id, undefined, 8)).includes(" ↑ 8 more "));
		assert.equal(strip(topBorder(80, id, undefined, 8)), `${rule(15)} ↑ 8 more ${rule(15)} ${id} ──`);
		assert.equal(strip(topBorder(1, id, undefined, 8)), "─");
	});

	it("ordinary rules stay silver and the ID uses the label paint", () => {
		assert.equal(RULE_SILVER, "#b6b6b4");
		assert.equal(topBorder(20, undefined, undefined), hexSgr(RULE_SILVER, false, rule(20)));
		assert.equal(topBorder(42, id, undefined, 0, plain), `${hexSgr(RULE_SILVER, false, rule(2))}${hexSgr(RULE_SILVER, false, " ")}${id}${hexSgr(RULE_SILVER, false, " ──")}`);
	});

	it("compaction shimmers the title, rules, hint and full ID in synchronized gold columns", () => {
		const line = topBorder(120, id, chrome("Compacting context", true, 4), 8, plain, "Title");
		assert.equal(strip(line), `── Title ${rule(26)} ↑ 8 more ${rule(35)} ${id} ──`);
		assert.ok(line.includes(shimmerText("Title", 3, 4, GOLD)));
		assert.ok(line.includes(shimmerText(" ↑ 8 more ", 35, 4, GOLD)));
		assert.ok(line.includes(shimmerText(id, 81, 4, GOLD)));
		assert.notEqual(line, topBorder(120, id, chrome("Compacting context", true, 8), 8, plain, "Title"));
	});
});

describe("compaction meter", () => {
	it("is a full gold busy meter, retaining known and unknown labels and hints", () => {
		for (const context of [{ tokens: 13000, limit: 450000 }, { tokens: null, limit: 450000 }]) {
			const label = contextLabel(context);
			assert.equal(sheenRow(context, 60, 4, 8), shimmerText("↓ 8 more " + "━".repeat(60 - 9 - label.length) + label, 0, 4, GOLD));
		}
		assert.equal(strip(sheenRow(undefined, 20, 0)), "━".repeat(20));
		assert.equal(strip(sheenRow({ tokens: null, limit: 0 }, 20, 0)), "━".repeat(20));
		for (let width = 0; width <= 160; width++) {
			assert.equal(visibleWidth(sheenRow({ tokens: 13000, limit: 450000 }, width, 3, 8)), width);
			assert.equal(visibleWidth(sheenRow({ tokens: null, limit: 450000 }, width, 3)), width);
		}
		assert.equal(strip(sheenRow({ tokens: 1, limit: 100 }, 1, 0, 8)), "…");
	});
});

describe("static title", () => {
	it("is empty until named and keeps its own gold gradient and clipping outside compaction", () => {
		assert.equal(titleRow(undefined, 40), "");
		assert.equal(titleRow("  ", 40), "");
		assert.equal(titleRow("A", 40), hexSgr("#c9a227", true, "A"));
		assert.equal(titleRow("ABC", 40), hexSgr("#8a6d1c", true, "A")
			+ hexSgr("#c9a227", true, "B") + hexSgr("#e3c45a", true, "C"));
		assert.ok(topBorder(80, id, undefined, 0, plain, "ABC").includes(titleRow("ABC", 40)));
		assert.ok(topBorder(80, id, chrome("Compacting context", true), 0, plain, "ABC")
			.includes(shimmerText("ABC", 3, 0, GOLD)));
		assert.equal(strip(titleRow("Long name here", 6)), "Long …");
		assert.equal(strip(titleRow("Long name here", 1)), "…");
		assert.equal(visibleWidth(titleRow("Тест имени", 40)), 10);
		assert.ok(titleRow("Тест", 40).startsWith(hexSgr("#8a6d1c", true, "Т")));
		assert.ok(titleRow("Тест", 40).includes(hexSgr("#e3c45a", true, "т")));
	});
});

describe("branch mark on the place row", () => {
	const state = (branch: number | undefined, width: number) => placeRow({
		branch, place: { kind: "folder", text: "~/ai-project/my-pi" }, statuses: [], git: undefined,
		context: undefined, compactions: 0,
	} as never, width, plain);
	it("shows after the folder with two spaces only when off the original branch", () => {
		assert.equal(state(undefined, 60), " \uf115 ~/ai-project/my-pi");
		assert.equal(state(2, 60), " \uf115 ~/ai-project/my-pi  \u2442 fork #2");
	});
	it("drops the whole mark before the folder is cut", () => {
		assert.ok(state(2, 32).endsWith("\u2442 fork #2"));
		assert.equal(state(2, 31), state(undefined, 31));
		assert.ok(state(2, 31).includes("~/ai-project/my-pi"));
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
