import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { it } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { themePaint } from "../../../extensions/RQW-statusbar/index.ts";
import { activityRows, type BarState, effortText, fastMark, gitText, ICON, mix, modelRow, parsePorcelain,
	RateMeter, renderBar, SHIMMER, SHIMMER_CELLS_PER_FRAME, shimmerPhase, shimmerText, SILVER, silverGlintPosition
} from "../../../extensions/RQW-statusbar/render.ts";

const sample: BarState = {
	model: { id: "sonnet", name: "Claude Sonnet 5.5", reasoning: true }, thinkingLevel: "high",
	context: { tokens: 13100, limit: 450000 }, compactions: 2, rate: 52.4,
	place: { kind: "worktree", text: "my-pi/statusbar" },
	git: { branch: "rqw-statusbar", unstaged: 1, staged: 2, untracked: 3 }, statuses: [],
};

it("keeps status colors but removes terminal commands and line breaks at narrow widths", () => {
	const status = "\x1b[1;91mERROR\x1b[22;39m\x1b]0;evil\x07\nnext\x1b[2J";
	const state = { ...sample, statuses: [status], compactions: undefined, rate: undefined };
	const row = modelRow(state, 80);
	assert.match(row, /\x1b\[1;91mERROR\x1b\[22;39m next/);
	assert.doesNotMatch(row, /evil|\x1b\]0|\x1b\[2J|\n/);
	const narrow = modelRow(state, 26);
	assert.ok(strip(narrow).length <= 26);
	assert.match(narrow, /\x1b\[1;91mERROR/);
	assert.doesNotMatch(narrow, /evil|\x1b\]0|\x1b\[2J|\n/);
	const withMetrics = modelRow({ ...sample, statuses: ["\x1b[1;91mCtrl+E failed: Codex token expired\x1b[22;39m"] }, 40);
	assert.match(withMetrics, /\x1b\[1;91mCtrl\+E failed/);
	assert.ok(strip(withMetrics).length <= 40);
});

it("removes embedded controls inside seven and eight bit OSC and DCS strings", () => {
	const status = "\x1b[1;91mOK\x1b[0m" +
		"\x1b]0;hidden\x1b[32mESCOSC\x07" + "\x1bPqhidden\x1b[33mESCDCS\x1b\\" +
		"\x9d0;hidden\x1b[34m\x9b31mC1OSC\x9c" + "\x90qhidden\x1b[35m\x9b31mC1DCS\x9c" +
		"\x9b2J end";
	const row = modelRow({ ...sample, statuses: [status], compactions: undefined, rate: undefined }, 80);
	assert.match(row, /\x1b\[1;91mOK\x1b\[0m/);
	assert.doesNotMatch(row, /hidden|ESCOSC|ESCDCS|C1OSC|C1DCS|\x1b\[(?:32|33|34|35)m|\x9b/);
	assert.match(strip(row), /OK end/);
});

it("renders the context, model and repository rows", () => {
	assert.deepEqual(renderBar(sample, 48).map(strip), [
		"━───────────────────────────────── 3% 13.1k/450k",
		` ${ICON.model} Sonnet 5.5 hi             cmp 2 · ${ICON.throughput}52.4 tok/s`,
		` ${ICON.worktree} my-pi/statusbar      ${ICON.branch} rqw-statusbar *1 +2 ?3`,
	]);
});

it("keeps one branch colour whatever the file counts; only the marks carry state", () => {
	const paint = (role: string, text: string) => `<${role}>${text}</${role}>`;
	const branch = `<gitBranch>${ICON.branch} main</gitBranch>`;
	assert.equal(gitText({ branch: "main", staged: 0, unstaged: 0, untracked: 0 }, paint), branch);
	assert.equal(gitText({ branch: "main", staged: 2, unstaged: 1, untracked: 3 }, paint),
		`${branch} <unstaged>*1</unstaged> <staged>+2</staged> <untracked>?3</untracked>`);
});

it("keeps both background statuses before moving git to another row", () => {
	const state: BarState = { ...sample, place: { kind: "folder", text: "a-very-long-folder-name" },
		backgroundFrame: 0, suggestion: { state: "aborted" }, git: { branch: "main", staged: 0, unstaged: 0, untracked: 0 } };
	const roomy = renderBar(state, 55).map(strip);
	assert.equal(roomy.length, 3);
	assert.match(roomy[2], /bg compaction  suggestion aborted.*main/);
	const tight = renderBar(state, 39).map(strip);
	assert.equal(tight.length, 4);
	assert.match(tight[2], /bg compaction  suggestion aborted/);
	assert.match(tight[3], /main/);
	assert.ok(tight.every((row) => row.length <= 39));
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
