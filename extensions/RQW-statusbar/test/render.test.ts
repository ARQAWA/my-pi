import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { type BarState, contextRow, editorBorder, formatK, gitText, ICON, leftRight, modelName, parsePorcelain,
	placeOf, RateMeter, renderBar, sessionTopBorder, singleLine, thinkingLabel, within } from "../render.ts";

export const sample: BarState = {
	model: { id: "sonnet", name: "Claude Sonnet 5.5", reasoning: true }, thinkingLevel: "high",
	context: { tokens: 13100, limit: 450000 }, compactions: 2, rate: 52.4,
	place: { kind: "worktree", text: "my-pi/statusbar" },
	git: { branch: "rqw-statusbar", unstaged: 1, staged: 2, untracked: 3 }, statuses: [],
};

it("deterministic plain renders match the committed snapshots", () => {
	const actual = Object.fromEntries([80, 48, 24, 8, 1, 0].map(w => [w, renderBar(sample, w).map(stripVTControlCharacters)]));
	const expected = JSON.parse(readFileSync(new URL("./render.snap.json", import.meta.url), "utf8"));
	assert.deepEqual(actual, expected);
});

it("every row fits from zero to 160 columns, with wide and styled metadata", () => {
	for (const state of [sample, { ...sample, model: undefined, context: undefined, git: undefined },
		{ ...sample, context: { tokens: null, limit: 450000 } },
		{ ...sample, place: { kind: "folder" as const, text: "工程/🙂/e\u0301".repeat(30) },
			statuses: ["\x1b[31mhello\x1b[0m\nworld", "x".repeat(200)] }]) {
		for (let width = 0; width <= 160; width++) {
			for (const row of renderBar(state, width, (_role, text) => `\x1b[31m${text}\x1b[39m`)) {
				assert.ok(visibleWidth(row) <= width, `${width}: ${JSON.stringify(row)}`);
				assert.ok(!/[\r\n\t]/.test(row));
			}
		}
	}
	assert.equal(leftRight("left", "right", 12), "left   right");
	assert.equal(stripVTControlCharacters(leftRight("long left", "right", 8)), "l… right");
});

it("context is relative to Pi's threshold; overflow clamps the bar, not the token count", () => {
	assert.match(contextRow({ tokens: 225000, limit: 450000 }, 40), /50% 225k\/450k$/);
	assert.match(contextRow({ tokens: 600000, limit: 450000 }, 40), /100% 600k\/450k$/);
	assert.match(contextRow({ tokens: null, limit: 450000 }, 40), /\?\/450k$/);
	assert.equal(contextRow(undefined, 5), "─────");
	assert.equal(contextRow({ tokens: 1, limit: 0 }, 5), "─────");
	assert.equal(formatK(13100), "13.1k");
	assert.equal(formatK(1000000), "1M");
});

it("the editor border is the context row, with the hidden-lines hint first at every width", () => {
	const styled = (_role: string, text: string) => `\x1b[31m${text}\x1b[39m`;
	const hint = (text: string) => `\x1b[2m${text}\x1b[22m`;
	for (const context of [sample.context, undefined, { tokens: null, limit: 450000 }]) {
		for (let width = 0; width <= 160; width++) {
			assert.equal(editorBorder(context, 0, width, styled, hint), contextRow(context, width, styled));
			for (const hidden of [1, 8, 12345]) {
				const border = editorBorder(context, hidden, width, styled, hint);
				const plainText = stripVTControlCharacters(border);
				assert.equal(visibleWidth(border), width, `${width}/${hidden}: ${JSON.stringify(border)}`);
				if (width >= 2) assert.ok(plainText.startsWith("\u2193"), `${width}/${hidden}: ${plainText}`);
				const text = `\u2193 ${hidden} more `;
				if (width > text.length) assert.equal(plainText, text + stripVTControlCharacters(contextRow(context, width - text.length)));
			}
		}
	}
	assert.equal(editorBorder(sample.context, 8, 40), "\u2193 8 more \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 3% 13.1k/450k");
	assert.equal(stripVTControlCharacters(editorBorder(sample.context, 8, 6)), "\u2193 8 m\u2026");
	assert.equal(editorBorder(sample.context, 8, 0), "");
});

it("the session ID ends the top border whole, framed by single spaces, or is dropped", () => {
	const rule = (width: number) => "\u2500".repeat(Math.max(0, width));
	const id = "019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b";
	const border = (text: string) => `\x1b[2m${text}\x1b[22m`;
	const styled = (_role: string, text: string) => `\x1b[31m${text}\x1b[39m`;
	for (let width = 0; width <= 160; width++) {
		const line = sessionTopBorder(width, id, rule, border, styled);
		assert.equal(visibleWidth(line), width, `${width}`);
		// The ID needs its 36 cells, a space on each side, two rule cells after it and at least two before it.
		if (width >= 42) {
			assert.equal(stripVTControlCharacters(line), `${rule(width - 40)} ${id} \u2500\u2500`);
			assert.ok(line.includes(`\x1b[31m${id}\x1b[39m`), "the ID is one uninterrupted run of text");
		} else assert.equal(line, rule(width));
	}
	// No ID, an empty one or one that would not copy as a single word: Pi's border as it is.
	for (const bad of [undefined, "", " \n ", "two words", "a\x1b[31mb\nc"]) assert.equal(sessionTopBorder(80, bad, rule), rule(80));
	// Terminal controls never reach the border.
	assert.equal(sessionTopBorder(10, "ab\x07c\x1b[39m", rule), `${rule(3)} abc \u2500\u2500`);
	// A stock border whose text changes at the reduced width (a status cut, a hint lost) keeps the full width.
	const status = (width: number) => width >= 30 ? `\u2500\u2500 Working long status \u2500${rule(width - 24)}` : rule(width);
	assert.equal(sessionTopBorder(60, id, status), status(60));
	assert.equal(stripVTControlCharacters(sessionTopBorder(80, id, status)), `${status(40)} ${id} \u2500\u2500`);
	// A stock border without two rule cells before the ID keeps the full width.
	const tight = (width: number) => `\u2500\u2500 ${"x".repeat(Math.max(0, width - 3))}`;
	assert.equal(sessionTopBorder(80, id, tight), tight(80));
});

it("model labels, missing metadata and reasoning levels match the owner's symbols", () => {
	assert.equal(modelName(sample.model), "Sonnet 5.5");
	assert.equal(modelName(undefined), "no-model");
	assert.equal(modelName({ id: "fallback", name: "" }), "fallback");
	for (const [level, short] of Object.entries({ off: "no", minimal: "min", low: "lo", medium: "md", high: "hi", xhigh: "xh", max: "mx" })) {
		assert.equal(thinkingLabel(sample.model, level), short);
	}
	assert.equal(thinkingLabel({ id: "plain", reasoning: false }, "high"), "");
	assert.equal(thinkingLabel(sample.model, "future"), "future");
	assert.equal(singleLine("\x1b[31ma\x1b[0m\n\tb\x07"), "a b");
	assert.equal(gitText({ branch: null, unstaged: 1, staged: 0, untracked: 0 }), "*1");
	assert.equal(gitText({ branch: "main", unstaged: 0, staged: 0, untracked: 0 }), `${ICON.branch} main`);
});

it("place handles POSIX, Windows drive and UNC paths with directory boundaries", () => {
	const place = (cwd: string, home = "/home/u", scratchRoots = ["/tmp"]) => placeOf({ cwd, home, scratchRoots });
	assert.deepEqual(place("/tmp/probe"), { kind: "scratch", text: "probe" });
	assert.deepEqual(place("/tmp-other/probe"), { kind: "folder", text: "/tmp-other/probe" });
	assert.equal(place("/home/u/Projects/app").text, "app");
	assert.equal(place("/home/u/repos/app").text, "app");
	assert.equal(place("/work/app").text, "app");
	assert.equal(place("/home/u/app").text, "~/app");
	assert.equal(place("C:\\Users\\Bob\\repos\\app", "c:\\users\\bob", []).text, "app");
	assert.deepEqual(place("C:\\TEMP\\app", "C:\\Users\\Bob", ["c:\\temp"]), { kind: "scratch", text: "app" });
	assert.equal(within("\\\\server\\share", "\\\\SERVER\\SHARE\\app"), "app");
	assert.equal(within("C:\\temp", "C:\\temporary"), null);
	assert.equal(within("/", "/foo"), "foo");
	assert.equal(placeOf({ cwd: "/tmp/tree/sub", home: "/home/u", scratchRoots: ["/tmp"],
		worktree: { project: "app", name: "feature" }, branch: "feature" }).text, "app");
	assert.equal(place("/" + "🙂".repeat(50)).text, "…" + "🙂".repeat(39));
});

it("porcelain counts staged, unstaged, conflicts, untracked and two-record renames", () => {
	assert.deepEqual(parsePorcelain("M  staged\0 M unstaged\0MM both\0?? new\0!! ignored\0R  dest\0?? source\0 R dest2\0 M source2\0UU conflict\0"),
		{ staged: 4, unstaged: 4, untracked: 1 });
	assert.deepEqual(parsePorcelain(""), { staged: 0, unstaged: 0, untracked: 0 });
});

it("rate uses streamed estimates, then provider output, and resets without NaN", () => {
	const rate = new RateMeter();
	assert.equal(rate.value(0), undefined);
	rate.start(0); rate.push("x".repeat(400), 1000);
	assert.equal(rate.value(1000), 100);
	rate.end(300, 2000);
	assert.equal(rate.value(10000), 150);
	rate.start(10000); rate.push("x".repeat(80), 11000); rate.end(NaN, 11000);
	assert.equal(rate.value(11000), 20);
	rate.reset(); assert.equal(rate.value(12000), undefined);
});
