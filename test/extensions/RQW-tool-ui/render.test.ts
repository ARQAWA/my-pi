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
