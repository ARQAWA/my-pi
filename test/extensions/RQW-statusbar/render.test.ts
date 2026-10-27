import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { themePaint } from "../../../extensions/RQW-statusbar/index.ts";
import { activityRows, type BarState, effortText, fastMark, ICON, mix, modelRow, parsePorcelain,
	RateMeter, renderBar, SHIMMER, SHIMMER_CELLS_PER_FRAME, shimmerPhase, shimmerText, SILVER, silverGlintPosition
} from "../../../extensions/RQW-statusbar/render.ts";

const sample: BarState = {
	model: { id: "sonnet", name: "Claude Sonnet 5.5", reasoning: true }, thinkingLevel: "high",
	context: { tokens: 13100, limit: 450000 }, compactions: 2, rate: 52.4,
	place: { kind: "worktree", text: "my-pi/statusbar" },
	git: { branch: "rqw-statusbar", unstaged: 1, staged: 2, untracked: 3 }, statuses: [],
};

it("renders the context, model and repository rows", () => {
	assert.deepEqual(renderBar(sample, 48).map(strip), [
		"━───────────────────────────────── 3% 13.1k/450k",
		` ${ICON.model} Sonnet 5.5 hi             cmp 2 · ${ICON.throughput}52.4 tok/s`,
		` ${ICON.worktree} my-pi/statusbar      ${ICON.branch} rqw-statusbar *1 +2 ?3`,
	]);
});

it("renders the fast marker and activity row", () => {
	const row = strip(modelRow({ ...sample, fast: {} }, 80));
	assert.ok(row.includes(`Sonnet 5.5 ${ICON.fast} hi`));
	assert.equal(fastMark(SHIMMER.length), fastMark(0));
	assert.deepEqual(activityRows(80, { text: "Planning next moves", compacting: false, frame: 0 }).map(strip),
		[" Planning next moves", ""]);
});

it("parses git records and measures a qualified response rate", () => {
	assert.deepEqual(parsePorcelain("M  staged\0 M unstaged\0?? new\0"), { staged: 1, unstaged: 1, untracked: 1 });
	const rate = new RateMeter();
	rate.record({ usage: { output: 300 }, durationMs: 2000 });
	assert.equal(rate.value(), 150);
	rate.record({ usage: { output: 5 }, durationMs: 3000, stopReason: "aborted" });
	assert.equal(rate.value(), 150);
	rate.reset();
	assert.equal(rate.value(), undefined);
});

it("keeps Unicode graphemes on their measured terminal columns", () => {
	// Regression for c576f3697603dc5f789984ef1fdbd35cc2e9e7b8.
	const frame = silverGlintPosition(4, 2) / SHIMMER_CELLS_PER_FRAME;
	const silverAt = (text: string, column: number) => {
		const phase = shimmerPhase(column, frame);
		const rgb = [1, 3, 5].map((i) => parseInt(mix(SILVER, phase).slice(i, i + 2), 16)).join(";");
		return `\x1b[${phase > 0.85 ? "1;" : ""}38;2;${rgb}m${text}\x1b[22;39m`;
	};
	assert.equal(shimmerText("界e\u0301x", 0, 2, SILVER), silverAt("界", 0) + silverAt("e\u0301", 2) + silverAt("x", 3));
});

it("delegates effort color to the supplied Pi theme", () => {
	// Regression for 34e6bd3d12fbb3939457f5987be9c950c34e62f2.
	const theme = {
		fg: (_role: string, text: string) => text,
		getThinkingBorderColor: (level: string) => (text: string) => `<${level}>${text}`,
	} as unknown as Theme;
	assert.equal(effortText("high", "hi", themePaint(theme)), "\x1b[1m<high>hi\x1b[22m");
});
