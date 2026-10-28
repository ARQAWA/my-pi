import assert from "node:assert/strict";
import { it } from "node:test";
import type { SessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import { classifyChange } from "../../../extensions/RQW-tool-ui/changes.ts";
import { classify } from "../../../extensions/RQW-tool-ui/classify.ts";
import { buildGroups } from "../../../extensions/RQW-tool-ui/groups.ts";
import { renderLive } from "../../../extensions/RQW-tool-ui/live.ts";
import { collapsedRows } from "../../../extensions/RQW-tool-ui/render.ts";
import { renderSummary } from "../../../extensions/RQW-tool-ui/summary.ts";

const theme = { fg: (_role: string, text: string) => text, bg: (_role: string, text: string) => text } as Theme;
const ok = (text = "", extra: object = {}) => ({ content: [{ type: "text", text }], ...extra });
const call = (id: string, name = "read", args: object = { path: "a.ts" }) => ({ type: "toolCall", id, name, arguments: args });
const assistant = (content: unknown[], stopReason = "toolUse") => ({ role: "assistant", content, stopReason, timestamp: 1 });
const result = (id: string, name = "read", extra: object = {}) => ({
	role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text: "out" }], isError: false, timestamp: 2, ...extra,
});
const entries = (...messages: unknown[]) => messages.map((message, i) => ({
	type: "message", id: `e${i}`, parentId: i ? `e${i - 1}` : null, timestamp: "t", message,
})) as SessionEntry[];

it("classifies calls and nonzero exits", () => {
	assert.equal(classify("read", { path: "a.ts", offset: 3, limit: 2 }, ok(), { toolCallId: "r" }).target, "a.ts L3-4");
	const failed = classify("bash", { command: "false" }, ok("no", { details: { exitCode: 2 } }), { toolCallId: "b" });
	assert.deepEqual([failed.kind, failed.status, failed.exitCode], ["run", "error", 2]);
});

it("classifies confirmed edit and write counts", () => {
	const edit = classifyChange("edit", { path: "a.ts" }, ok("done", { details: { diff: "-1 old\n+1 new\n+2 next" } }));
	assert.deepEqual(edit.files, [{ path: "a.ts", status: "done", countKey: "a.ts", added: 2, removed: 1 }]);
	const write = classifyChange("write", { path: "b.ts", content: "one\ntwo\n" }, ok());
	assert.equal(write.files[0].added, 2);
});

it("renders a summary and the last four live output rows", () => {
	const edit = classifyChange("edit", { path: "a.ts" }, ok("done", { details: { diff: "-1 old\n+1 new" } }));
	const read = classify("read", { path: "b.ts" }, ok(), { toolCallId: "r" });
	assert.equal(renderSummary([edit, read], 80, theme), "Edited 1 file +1 -1 · read 1 file");
	const running = classify("bash", { command: "npm test" }, ok("1\n2\n3\n4\n5\n6"), { toolCallId: "b", isPartial: true });
	assert.deepEqual(renderLive({ ...running, toolName: "bash" }, 80, theme).map((row) => row.trim()),
		["$ npm test", "3", "4", "5", "6", "running"]);
});

it("paints live agent cards purple by state and leaves normal tools on theme backgrounds", () => {
	const tagged = { fg: (_role: string, text: string) => text, bg: (role: string, text: string) => `<${role}>${text}` } as Theme;
	const liveRows = (name: string, args: object, res: object | undefined, isError = false, isPartial = false) =>
		renderLive({ ...classify(name, args, res, { toolCallId: "x", isError, isPartial }), toolName: name, durationMs: 300 }, 40, tagged);
	const live = (name: string, args: object, res: object | undefined, isError = false) =>
		liveRows(name, args, res, isError)[0];
	const start = { action: "start" };
	// The purple background covers the whole card: header, output rows and status, in every state.
	const wholeCard = (rows: string[], color: RegExp) => {
		assert.equal(rows.length, 4, "header, two output rows and status");
		// Indent, then the background, then the visible text, then the only reset at the very end.
		rows.forEach((row, i) => {
			const parts = row.match(/^( *)(\x1b\[48;2;[\d;]+m)(.*)(\x1b\[49m)$/);
			assert.ok(parts, `row ${i}: background does not wrap the row text`);
			assert.match(parts[2], color, `row ${i} lacks the card background`);
			assert.ok(parts[3].trim() !== "", `row ${i}: no visible text inside the background`);
			assert.doesNotMatch(parts[3], /\x1b\[(?:49|0)?m/, `row ${i}: background reset before the end of the text`);
		});
		rows.forEach((row, i) => assert.doesNotMatch(row, /<tool/, `row ${i} has a tool background`));
	};
	wholeCard(liveRows("agent", start, ok("o1\no2"), false, true), /\x1b\[48;2;40;32;43m/);
	wholeCard(liveRows("agent", start, ok("o1\no2")), /\x1b\[48;2;33;13;43m/);
	wholeCard(liveRows("agent", { action: "wait", ids: ["agent#1"] }, ok("o1\no2"), true), /\x1b\[48;2;53;28;52m/);
	assert.match(live("agent", start, undefined), /\x1b\[48;2;40;32;43m/);
	assert.match(live("agent", start, ok("agent#1 started")), /\x1b\[48;2;33;13;43m/);
	assert.match(live("agent", { action: "wait", ids: ["agent#1"] }, ok("failed"), true), /\x1b\[48;2;53;28;52m/);
	assert.doesNotMatch(live("agent", start, undefined), /<tool/);
	assert.match(live("read", { path: "a.ts" }, ok("x")), /<toolSuccessBg>/);
});

it("groups calls between answers and folds the live card", () => {
	const log = entries(assistant([call("r")]), result("r", "read", { durationMs: 1000 }));
	const active = buildGroups(log).get("r")!;
	assert.equal(active.active, true);
	assert.deepEqual(collapsedRows(active, 80, theme, "/w").map((row) => row.trim()),
		["Read 1 file", "read a.ts", "out", "✓ 1.0s"]);
	const answered = buildGroups(entries(assistant([call("r")]), result("r"), assistant([{ type: "text", text: "Done" }], "stop"))).get("r")!;
	assert.deepEqual(collapsedRows(answered, 80, theme, "/w"), ["Read 1 file"]);
});

it("renders an aborted call without inventing a result", () => {
	// Regression for 75ecea60e6851a2ca126cc9afe39c8ab47b088e1.
	const group = buildGroups(entries(assistant([call("b", "bash", { command: "make" })], "aborted"))).get("b")!;
	assert.equal(group.members[0].result, undefined);
	assert.equal(group.members[0].isPartial, false);
	assert.deepEqual(collapsedRows(group, 80, theme, "/w").map((row) => row.trim()), ["Ran 1 command", "$ make", "aborted"]);
});

it("keeps a failed codemode parent visible beside a nested success", () => {
	// Regression for 1633d508ea19ffbd1f500559b9b55894f1cb364a.
	const final = result("p", "codemode", {
		content: [{ type: "text", text: "Error: SCRIPT_BROKE" }], isError: true, durationMs: 1200,
		nestedCalls: { complete: true, calls: [{ id: "p/1", name: "read", arguments: { path: "a.ts" }, status: "ok" }] },
	});
	const group = buildGroups(entries(assistant([call("p", "codemode", { code: "throw" })]), final)).get("p")!;
	assert.deepEqual(collapsedRows(group, 80, theme, "/w").map((row) => row.trim()),
		["Read 1 file · 1 failed", "codemode throw", "Error: SCRIPT_BROKE", "✗ error · 1.2s"]);
});
