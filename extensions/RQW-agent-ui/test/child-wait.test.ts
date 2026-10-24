import assert from "node:assert/strict";
import { it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { CardTheme } from "../card.ts";
import { createChildWaitCard } from "../child-wait.ts";

const identity: CardTheme = { fg: (_color, text) => text, bold: (text) => text };
const tagged: CardTheme = { fg: (color, text) => `<${color}>${text}</${color}>`, bold: (text) => text };

type Message = Parameters<typeof createChildWaitCard>[0];
/** A `child_wait` notification the way RQW-agent builds it: the wait details, and the same object as JSON content. */
function notification(details: unknown, extra: Partial<Message> = {}): Message {
	return { role: "custom", customType: "child_wait", content: JSON.stringify(details), display: true, details, timestamp: 0, ...extra } as Message;
}
function render(m: Message, width: number, expanded = false, theme: CardTheme = identity): string[] | undefined {
	return createChildWaitCard(m, { expanded, outputPad: 0 }, theme as never)?.render(width);
}

const ok = { id: "agent#418", run: "r:1", delivery: "d-1", outcome: "completed", text: "Yes: exclusion holds.\nSecond line [with brackets].\nThird line." };
const failed = { id: "code_writer#9", run: "r:2", delivery: "d-2", outcome: "error", text: "error: edit refused\nfile changed since the last read" };
const done = { id: "shell_runner#4", run: "r:3", delivery: "d-3", outcome: "completed", text: "npm test: 214 passed" };
const wait = (...results: unknown[]) => ({ reason: "result", timed_out: false, results, receipts: [], statuses: [], wait_id: "w-1" });

it("child-wait-single: a completed result is one card, never the raw JSON", () => {
	assert.deepEqual(render(notification(wait(ok)), 80), ["child_wait · agent#418 finished", "  Yes: exclusion holds."]);
});

it("child-wait-multiple: a summary row, one indented card per result, a failure counted and painted as an error", () => {
	assert.deepEqual(render(notification(wait(ok, failed, done)), 80), [
		"child_wait · 3 results · 1 failed",
		"  agent#418 finished", "    Yes: exclusion holds.",
		"  code_writer#9 failed", "    error: edit refused",
		"  shell_runner#4 finished", "    npm test: 214 passed",
	]);
	const painted = render(notification(wait(ok, failed)), 80, false, tagged)!.join("\n");
	assert.match(painted, /<error>1 failed<\/error>/);
	assert.match(painted, /code_writer#9<\/muted><muted> <\/muted><error>failed<\/error>\n\s+<error>error: edit refused<\/error>/, "the failed status and its answer are error-coloured, not hidden");
	assert.match(painted, /<success>finished<\/success>/);
	assert.deepEqual(render(notification(wait(failed)), 80), ["child_wait · code_writer#9 failed", "  error: edit refused"], "a single failure keeps its status");
});

it("child-wait-expanded: the whole answer of every result, wrapped, nothing dropped", () => {
	const rows = render(notification(wait(ok, failed)), 80, true)!;
	assert.deepEqual(rows, [
		"child_wait · 2 results · 1 failed",
		"  agent#418 finished", "    Yes: exclusion holds.", "    Second line [with brackets].", "    Third line.",
		"  code_writer#9 failed", "    error: edit refused", "    file changed since the last read",
	]);
	assert.deepEqual(render(notification(wait(ok)), 80, true), ["child_wait · agent#418 finished", "  Yes: exclusion holds.", "  Second line [with brackets].", "  Third line."]);
});

it("child-wait-no-result: timeouts, alerts, receipts, empty and unreadable notifications stay stock", () => {
	for (const details of [
		{ reason: "timeout", timed_out: true, results: [], statuses: [] },
		{ reason: "alert", timed_out: false, results: [], statuses: [{ id: "agent#1", alerts: ["long_turn"] }] },
		{ reason: "receipt", results: [], receipts: [{}] },
		{ reason: "idle", results: [] },
		{ reason: "result", results: [] },
		{ reason: "result", results: ["x", null] },
		{ reason: "result" },
	]) assert.equal(render(notification(details), 80), undefined, JSON.stringify(details));
	assert.equal(render(notification(undefined, { content: "not json" }), 80), undefined);
	assert.equal(render(notification(undefined, { content: "[1,2]" }), 80), undefined);
	assert.equal(render({ ...notification(wait(ok)), customType: "agent" } as Message, 80), undefined, "only the child_wait type");
});

it("child-wait-content-fallback: with no details the JSON content is the source; unknown outcome shows no status", () => {
	const m = notification(undefined, { content: JSON.stringify(wait({ ...ok, outcome: "weird" })) });
	assert.deepEqual(render(m, 80), ["child_wait · agent#418", "  Yes: exclusion holds."]);
});

it("child-wait-width: no row is wider than the width, down to zero, and the input is never changed", () => {
	const m = notification(wait(ok, failed, done));
	const before = JSON.stringify(m);
	for (const width of [0, 1, 2, 7, 8, 20, 120]) {
		for (const expanded of [false, true]) {
			const rows = render(m, width, expanded)!;
			if (width === 0) assert.deepEqual(rows, []);
			for (const row of rows) assert.ok(visibleWidth(row) <= width, `${width}: ${row}`);
		}
	}
	assert.equal(JSON.stringify(m), before);
});

it("child-wait-padding: every card row keeps one free cell at both sides, collapsed and expanded, single and several", () => {
	for (const details of [wait(ok), wait(ok, failed, done)]) for (const expanded of [false, true]) {
		const rows = createChildWaitCard(notification(details), { expanded, outputPad: 1 }, identity as never)!.render(60);
		assert.ok(rows[0].startsWith(" child_wait") && !rows[0].startsWith("  "), `header: ${JSON.stringify(rows[0])}`);
		for (const row of rows) assert.ok(visibleWidth(row) <= 59, `${row}`);
		assert.ok(rows.slice(1).every((row) => !row || row.startsWith("   ")), "body rows keep the pad and their indent");
	}
	assert.deepEqual(createChildWaitCard(notification(wait(ok)), { expanded: false, outputPad: 1 }, identity as never)!.render(80), [" child_wait · agent#418 finished", "   Yes: exclusion holds."]);
	assert.deepEqual(createChildWaitCard(notification(wait(ok)), { expanded: false, outputPad: 1 }, identity as never)!.render(0), []);
});
