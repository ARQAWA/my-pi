// T05: the summary line of one group. Snapshots: UPDATE_SNAPSHOTS=1 rewrites summary.snap.json.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { classifyChange } from "../changes.ts";
import { classify } from "../classify.ts";
import { renderSummary } from "../summary.ts";
import { assertFits, coloredTheme, deepFreeze, identityTheme, SAMPLES } from "./harness.ts";

const SNAP = new URL("./summary.snap.json", import.meta.url);
const ok = (text = "", details?: unknown) => ({ content: [{ type: "text", text }], details, isError: false });
const fail = (text = "boom") => ({ content: [{ type: "text", text }], isError: true });
const ctx = (id: string, extra: object = {}) => ({ toolCallId: id, isPartial: false, isError: false, cwd: "/w", ...extra });
const diff = (added: number, removed: number) =>
	[...Array.from({ length: removed }, (_, i) => `-${i + 1} old`), ...Array.from({ length: added }, (_, i) => `+${i + 1} new`), " 9 same"].join("\n");

const read = (id: string, path: string) => classify("read", { path }, ok("x"), ctx(id), "linux");
const grep = (id: string) => classify("grep", { pattern: "a" }, ok(), ctx(id), "linux");
const bash = (id: string, exit = 0) => classify("bash", { command: "npm test" }, { ...ok(), details: { exitCode: exit } }, ctx(id), "linux");
const edit = (id: string, path: string, a: number, r: number) => classifyChange("edit", { path }, ok("done", { diff: diff(a, r) }), ctx(id), "linux");
const write = (id: string, path: string, content: string) => classifyChange("write", { path, content }, ok("done"), ctx(id), "linux");
const wait = (id: string, ids: string[]) => classify("agent", { action: "wait", ids }, ok(), ctx(id), "linux");
const other = (id: string) => classify("web_fetch", { url: "https://x" }, ok(), ctx(id), "linux");

/** One group with every part: 2 edited files (+5 -3 confirmed), 2 distinct read files, searches, runs, waits, tools. */
const everything = () => [
	edit("e1", "src/a.ts", 3, 2), edit("e2", "src/a.ts", 1, 1), write("w1", "src/b.ts", "x\ny\n"),
	read("r1", "src/a.ts"), read("r2", "./src/a.ts"), read("r3", "README.md"),
	grep("g1"), bash("b1"), bash("b2", 1), wait("a1", ["agent#1", "agent#2"]), wait("a2", ["agent#1"]), other("o1"),
];

describe("summary", () => {
	it("summary-snapshots", () => {
		const cases = { everything: everything(), reads: [read("r1", "a.ts")], empty: [] };
		const got: Record<string, Record<string, string>> = {};
		for (const [name, calls] of Object.entries(cases))
			got[name] = Object.fromEntries([80, 48, 24, 8, 1, 0].map((w) => [w, renderSummary(calls, w, identityTheme)]));
		if (process.env.UPDATE_SNAPSHOTS === "1" || !existsSync(SNAP)) writeFileSync(SNAP, `${JSON.stringify(got, null, "\t")}\n`);
		assert.deepEqual(got, JSON.parse(readFileSync(SNAP, "utf8")));
	});

	it("summary-order-and-plural", () => {
		assert.equal(renderSummary(everything(), 200, identityTheme),
			"Edited 2 files +6 -3 · read 2 files · searched 1 time · ran 2 commands · waited for 2 agents · used 1 tool · 1 failed");
		const one = [edit("e", "a.ts", 1, 0), read("r", "a.ts"), grep("g"), bash("b"), wait("w", ["agent#3"]), other("o")];
		assert.equal(renderSummary(one, 200, identityTheme),
			"Edited 1 file +1 -0 · read 1 file · searched 1 time · ran 1 command · waited for 1 agent · used 1 tool");
		assert.equal(renderSummary([grep("g1"), grep("g2"), grep("g3")], 200, identityTheme), "Searched 3 times");
		assert.equal(renderSummary([wait("w", ["agent#1", "review#2", "agent#3"])], 200, identityTheme), "Waited for 3 agents");
		// Zero parts are omitted; the first remaining part is capitalized.
		assert.equal(renderSummary([bash("b", 2)], 200, identityTheme), "Ran 1 command · 1 failed");
		assert.equal(renderSummary([], 200, identityTheme), "");
	});

	it("summary-no-glyph", () => {
		// The line is the colored text only: no leading arrow or other glyph for any mix of calls.
		for (const calls of [[edit("e", "a", 1, 1)], [write("w", "a", "x")], [bash("b")], [read("r", "a"), grep("g")], [other("o")], [wait("w", ["agent#1"])]])
			assert.match(renderSummary(calls, 80, identityTheme), /^[A-Z]/);
	});

	it("summary-counts", () => {
		// The same path through several spellings and tools counts once; +A -R sum confirmed counts only.
		assert.equal(renderSummary([edit("e1", "a.ts", 2, 1), edit("e2", "/w/a.ts", 3, 4)], 80, identityTheme), "Edited 1 file +5 -5");
		// A write confirms only added lines: no minus without a confirmed removal.
		assert.equal(renderSummary([write("w", "a.ts", "1\n2\n3\n")], 80, identityTheme), "Edited 1 file +3");
		// Unknown counts (still running, failed, possibly changed) are not invented.
		const running = classifyChange("edit", { path: "a.ts" }, undefined, ctx("e", { isPartial: true }), "linux");
		assert.equal(renderSummary([running], 80, identityTheme), "Edited 1 file");
		const failed = classifyChange("edit", { path: "a.ts" }, fail(), ctx("e", { isError: true }), "linux");
		assert.equal(renderSummary([failed], 80, identityTheme), "Edited 1 file · 1 failed");
		// RQW multi-file edit: each file its own outcome; a failed sibling does not taint the others.
		const multi = classifyChange("edit", { edits: [{ path: "a.ts" }, { path: "b.ts" }, { path: "c.ts" }] }, ok("", { files: [
			{ path: "a.ts", ok: true, details: { diff: diff(2, 1) } },
			{ path: "b.ts", ok: false, error: "no match" },
			{ path: "c.ts", ok: false, outcome: "possibly_changed" },
		] }), ctx("m"), "linux");
		assert.equal(renderSummary([multi], 80, identityTheme), "Edited 3 files +2 -1 · 1 failed");
		// Reads: distinct files; failures count per failed call.
		assert.equal(renderSummary([read("r1", "a"), read("r2", "a"), classify("read", { path: "b" }, fail(), ctx("r3", { isError: true }), "linux")], 80, identityTheme),
			"Read 2 files · 1 failed");
		// Waits: distinct waited IDs across calls.
		assert.equal(renderSummary([wait("w1", ["agent#1", "agent#2"]), wait("w2", ["agent#2", "review#4"])], 80, identityTheme), "Waited for 3 agents");
	});

	it("summary-width-fit", () => {
		const long = [
			...Object.values(SAMPLES).map((s, i) => read(`r${i}`, s)),
			...Object.values(SAMPLES).map((s, i) => edit(`e${i}`, s, 1000 + i, 2000 + i)),
			bash("b", 3), other("o"), grep("g"), wait("w", ["agent#1"]),
		];
		for (const theme of [identityTheme, coloredTheme()]) {
			assertFits((w) => renderSummary(long, w, theme));
			assertFits((w) => renderSummary(everything(), w, theme));
		}
		assert.equal(renderSummary(everything(), 24, identityTheme), "Edited 2 files +6 -3 · …");
		assert.equal(renderSummary(everything(), 1, identityTheme), "…");
		assert.equal(renderSummary(everything(), 0, identityTheme), "");
	});

	it("summary-theme", () => {
		const calls = deepFreeze(everything());
		const a = renderSummary(calls, 200, coloredTheme(0));
		const b = renderSummary(calls, 200, coloredTheme(1));
		assert.notEqual(a, b, "a different supplied theme paints differently");
		assert.equal(stripTerminalSequences(a), stripTerminalSequences(b));
		assert.equal(renderSummary(calls, 200, coloredTheme(0)), a, "the same theme paints the same; no state kept between calls");
		const t = coloredTheme(0);
		assert.ok(a.includes(t.fg("toolDiffAdded", "+6")) && a.includes(t.fg("toolDiffRemoved", "-3")) && a.includes(t.fg("error", "1 failed")));
		assert.ok(a.startsWith(t.fg("muted", "Edited 2 files")));
	});
});
