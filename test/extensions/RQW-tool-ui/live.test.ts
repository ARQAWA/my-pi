// T06: the live block of the current call. Snapshots: UPDATE_SNAPSHOTS=1 rewrites live.snap.json.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { classifyChange } from "../../../extensions/RQW-tool-ui/changes.ts";
import { type CallContext, type CallResult, classify } from "../../../extensions/RQW-tool-ui/classify.ts";
import { diffOf, formatDuration, type LiveCall, renderLive } from "../../../extensions/RQW-tool-ui/live.ts";
import { assertFits, coloredTheme, deepFreeze, identityTheme, SAMPLES } from "./harness.ts";

const SNAP = new URL("./live.snap.json", import.meta.url);
const ok = (text = "", details?: unknown): CallResult => ({ content: [{ type: "text", text }], details, isError: false });
const ctx = (extra: CallContext = {}): CallContext => ({ toolCallId: "c1", isPartial: false, isError: false, ...extra });

/** A live call the way the wiring builds it: the classified call plus tool name, final duration and diff. */
function live(toolName: string, args: unknown, result?: CallResult, context: CallContext = ctx(), durationMs?: number): LiveCall {
	const c = toolName === "edit" || toolName === "write" ? classifyChange(toolName, args, result, context, "linux") : classify(toolName, args, result, context, "linux");
	const diff = toolName === "edit" ? diffOf(result) : undefined;
	return { ...c, toolName, ...(durationMs !== undefined ? { durationMs } : {}), ...(diff !== undefined ? { diff } : {}) };
}
/** Rows without the three-column indent and the card padding. */
const text = (rows: string[]) => rows.map((r) => stripTerminalSequences(r).slice(3).trimEnd());

const bashRunning = (out: string) => live("bash", { command: "npm test" }, ok(out), ctx({ isPartial: true }));

describe("live", () => {
	it("live-snapshots", () => {
		const cases = {
			bash: live("bash", { command: "npm --prefix /Users/demo/ai-project/my-pi test -- --test-name-pattern=\"input borders\"" },
				ok("> node --test\nsuite: input\nstarting checks\nok 1 - empty idle status\nok 2 - static normal borders\ntests 2; failures 0\n"), ctx(), 1234),
			edit: live("edit", { path: "/Users/demo/ai-project/my-pi/src/app.ts" }, ok("Successfully replaced text", { diff: "-12 const padding = 8;\n+12 const padding = 3;\n 13 const x = 1;\n-14 const idle = \"Ready\";\n+14 const idle = \"\";" }), ctx(), 400),
			read: live("read", { path: "src/app.ts", offset: 10, limit: 5 }, undefined, ctx({ isPartial: true })),
			wait: live("agent", { action: "wait", ids: ["agent#1", "agent#2"] }, ok("[agent#1] done"), ctx(), 65_000),
		};
		const got: Record<string, Record<string, string[]>> = {};
		for (const [name, call] of Object.entries(cases))
			got[name] = Object.fromEntries([80, 48, 24, 8, 1, 0].map((w) => [w, renderLive(call, w, identityTheme)]));
		if (process.env.UPDATE_SNAPSHOTS === "1" || !existsSync(SNAP)) writeFileSync(SNAP, `${JSON.stringify(got, null, "\t")}\n`);
		assert.deepEqual(got, JSON.parse(readFileSync(SNAP, "utf8")));
	});

	it("live-header-keeps-end", () => {
		const cmd = live("bash", { command: SAMPLES.longCommand }, undefined, ctx({ isPartial: true }));
		const [header] = text(renderLive(cmd, 40, identityTheme));
		assert.equal(header, `…${SAMPLES.longCommand.slice(-36)}`);
		assert.ok(header.endsWith("| tail -n 40"));
		const path = live("read", { path: SAMPLES.longPath }, undefined, ctx({ isPartial: true }));
		assert.ok(text(renderLive(path, 30, identityTheme))[0].endsWith("файл-🙂.ts"));
		assert.equal(visibleWidth(text(renderLive(path, 30, identityTheme))[0]), 27);
		// Headers of every kind.
		const headers = [
			live("grep", { pattern: "x", path: "src" }), live("find", { pattern: "*.ts" }), live("edit", { path: "a.ts" }),
			live("write", { files: [{ path: "a.ts", content: "" }, { path: "b.ts", content: "" }] }), live("web_fetch", { url: "https://x" }),
			live("agent", { action: "wait", ids: ["agent#1", "review#2"] }), live("bash", { command: "ls\n-la" }),
		].map((c) => text(renderLive(c, 80, identityTheme))[0]);
		assert.deepEqual(headers, ["grep x in src", "find *.ts", "edit a.ts", "write a.ts +1 more", "web_fetch https://x", "wait agent#1 review#2", "$ ls -la"]);
	});

	it("live-tail-four", () => {
		const body = (out: string) => text(renderLive(bashRunning(out), 80, identityTheme)).slice(1, -1);
		assert.deepEqual(body(""), []);
		assert.deepEqual(body("one"), ["one"]);
		assert.deepEqual(body("1\n2\n3\n4"), ["1", "2", "3", "4"]);
		assert.deepEqual(body("1\n2\n3\n4\n5\n6"), ["3", "4", "5", "6"]);
		assert.deepEqual(body("1\n2\n3\n4\n5\n6\n\n  \n"), ["3", "4", "5", "6"], "trailing empty lines dropped first");
		assert.deepEqual(body("1\n\n3\n"), ["1", "", "3"], "inner empty lines stay");
		// A carriage return keeps the last text drawn; a trailing one erases nothing.
		assert.deepEqual(body("Downloading 10%\r\nDownloading 5%\rDownloading 60%\r\na\rb\r\r"), ["Downloading 10%", "Downloading 60%", "b"]);
		assert.equal(renderLive(bashRunning("1\n2\n3\n4\n5\n6"), 80, identityTheme).length, 6, "at most six rows");
	});

	it("live-edit-diff", () => {
		const theme = coloredTheme();
		const d = "-1 a\n+1 b\n 2 c\n-3 d\n+3 e\n";
		const rows = renderLive(live("edit", { path: "a.ts" }, ok("Successfully replaced", { diff: d })), 80, theme);
		assert.deepEqual(text(rows).slice(1, -1), ["+1 b", " 2 c", "-3 d", "+3 e"]);
		assert.ok(rows[1].includes(theme.fg("toolDiffAdded", "+1 b")));
		assert.ok(rows[2].includes(theme.fg("toolDiffContext", " 2 c")));
		assert.ok(rows[3].includes(theme.fg("toolDiffRemoved", "-3 d")));
		// RQW multi-file edit: each file's own diff.
		const multi = live("edit", { edits: [{ path: "a.ts" }, { path: "b.ts" }] }, ok("", { files: [
			{ path: "a.ts", ok: true, details: { diff: "-1 x\n+1 y" } }, { path: "b.ts", ok: true, details: { diff: "+5 z" } }] }));
		assert.deepEqual(text(renderLive(multi, 80, identityTheme)).slice(1, -1), ["-1 x", "+1 y", "+5 z"]);
		// No confirmed diff: the result text.
		const failed = live("edit", { path: "a.ts" }, { content: [{ type: "text", text: "Could not find the text" }], isError: true }, ctx({ isError: true }));
		assert.deepEqual(text(renderLive(failed, 80, identityTheme)), ["edit a.ts", "Could not find the text", "✗ error"]);
	});

	it("live-status", () => {
		const status = (c: LiveCall) => text(renderLive(c, 80, identityTheme)).at(-1);
		assert.equal(status(bashRunning("x")), "running");
		assert.equal(status(live("bash", { command: "true" }, ok("", { exitCode: 0 }), ctx(), 1200)), "✓ 1.2s");
		assert.equal(status(live("bash", { command: "false" }, ok("", { exitCode: 2 }), ctx(), 3100)), "✗ exit 2 · 3.1s");
		assert.equal(status(live("read", { path: "a" }, { content: [], isError: true }, ctx({ isError: true }), 50)), "✗ error · 0.1s");
		// Unknown duration is omitted, never invented.
		assert.equal(status(live("read", { path: "a" }, ok("x"))), "✓");
		assert.equal(status(live("bash", { command: "false" }, ok("", { exitCode: 1 }))), "✗ exit 1");
		const theme = coloredTheme();
		assert.ok(renderLive(live("read", { path: "a" }, ok("x"), ctx(), 5), 80, theme).at(-1)!.includes(theme.fg("success", "✓ 0.0s")));
		assert.ok(renderLive(live("bash", { command: "false" }, ok("", { exitCode: 1 })), 80, theme).at(-1)!.includes(theme.fg("error", "✗ exit 1")));
		assert.ok(renderLive(bashRunning(""), 80, theme).at(-1)!.includes(theme.fg("muted", "running")));
	});

	it("live-elapsed-format", () => {
		assert.deepEqual([400, 10_000, 65_000].map(formatDuration), ["0.4s", "10s", "1m 05s"]);
		assert.deepEqual([0, 9_940, 9_960, 59_400, 59_600, 600_000, 3_725_000].map(formatDuration), ["0.0s", "9.9s", "10s", "59s", "1m 00s", "10m 00s", "62m 05s"]);
	});

	it("live-width-fit", () => {
		const out = [SAMPLES.ansi, SAMPLES.tabs, SAMPLES.cjk, SAMPLES.emoji, SAMPLES.combining, SAMPLES.longPath, `progress 10%\rprogress 99%`, "bell\x07 nul\x00 \x1b]8;;http://x\x07link\x1b]8;;\x07"].join("\n");
		const calls = [
			live("bash", { command: SAMPLES.longCommand }, ok(out, { exitCode: 4 }), ctx(), 61_000),
			live("read", { path: SAMPLES.longPath }, ok(Object.values(SAMPLES).join("\n"))),
			live("edit", { path: SAMPLES.cyrillic }, ok("", { diff: `+1 ${SAMPLES.cjk}\n-2 ${SAMPLES.ansi}\n 3 ${SAMPLES.tabs}` })),
			live("agent", { action: "wait", ids: [SAMPLES.emoji] }, undefined, ctx({ isPartial: true })),
		];
		for (const theme of [identityTheme, coloredTheme()]) for (const c of calls) assertFits((w) => renderLive(c, w, theme));
		// Output rows: no terminal sequences or controls of their own, tabs as spaces, what a carriage return drew last.
		const body = text(renderLive(calls[0], 400, identityTheme)).slice(1, -1);
		assert.deepEqual(body, [SAMPLES.combining, SAMPLES.longPath, "progress 99%", "bell nul link"]);
		assert.deepEqual(text(renderLive(bashRunning(SAMPLES.ansi + "\n" + SAMPLES.tabs), 80, identityTheme)).slice(1, -1), ["red bold green", "a   b      c"]);
		// Every row of a card is the full width: one solid rectangle under the three-column indent.
		for (const row of renderLive(calls[0], 50, coloredTheme())) assert.equal(visibleWidth(row), 50);
		assert.deepEqual(renderLive(calls[0], 2, identityTheme), ["  ", "  ", "  ", "  ", "  ", "  "]);
	});

	it("live-theme", () => {
		const call = deepFreeze(live("bash", { command: "npm test" }, ok("a\nb", { exitCode: 0 }), ctx(), 400));
		const a = renderLive(call, 60, coloredTheme(0));
		const b = renderLive(call, 60, coloredTheme(1));
		assert.notDeepEqual(a, b, "a different supplied theme paints differently");
		assert.deepEqual(a.map(stripTerminalSequences), b.map(stripTerminalSequences));
		assert.deepEqual(renderLive(call, 60, coloredTheme(0)), a, "no state kept between calls");
		const t = coloredTheme(0);
		assert.ok(a[0].includes(t.fg("toolTitle", "$ npm test")) && a[1].includes(t.fg("toolOutput", "a")));
		assert.ok(a.every((r) => r.startsWith(`   ${t.bg("toolSuccessBg", "").slice(0, -5)}`)), "finished card on Pi's success surface");
		const running = renderLive(bashRunning("x"), 60, t), failed = renderLive(live("bash", { command: "x" }, ok("", { exitCode: 1 })), 60, t);
		assert.ok(running.every((r) => r.includes(t.bg("toolPendingBg", "").slice(0, -5))));
		assert.ok(failed.every((r) => r.includes(t.bg("toolErrorBg", "").slice(0, -5))));
	});
});
