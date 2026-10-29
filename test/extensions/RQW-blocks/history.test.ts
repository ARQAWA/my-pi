import assert from "node:assert/strict";
import { it } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { installHistory } from "../../../extensions/RQW-blocks/history.ts";
import { installCompaction } from "../../../extensions/RQW-blocks/index.ts";
import { buildSession, makeHost } from "./history-host.ts";

initTheme();

const rows = (host: { chatContainer: { render(width: number): string[] } }) => host.chatContainer.render(80).map(stripTerminalSequences).map((line) => line.trim()).filter(Boolean);
// Position of a line; a missing line fails here instead of passing an order check as -1.
const at = (lines: string[], text: string) => {
	const index = lines.findIndex((line) => line.includes(text));
	assert.ok(index >= 0, `line "${text}" is missing`);
	return index;
};
const prompts = (lines: string[]) => lines.filter((line) => /^prompt \d+$/.test(line));
const all = (n: number) => Array.from({ length: n }, (_, i) => `prompt ${i}`);

// Six turns; the compaction after turn 2 keeps only turn 2 for the model.
const compacted = () => buildSession(6, 3, 1);

it("draws the whole branch on resume, with the compaction at its place", () => {
	const restore = installHistory();
	try {
		const host = makeHost(compacted().manager);
		host.renderInitialMessages();
		const lines = rows(host);
		assert.deepEqual(prompts(lines), all(6));
		assert.ok(at(lines, "answer 2") < at(lines, "Compacted from") && at(lines, "Compacted from") < at(lines, "prompt 3"));
	} finally { restore(); }
});

it("keeps both compactions in place with every prompt", () => {
	const restore = installHistory();
	const restoreCompaction = installCompaction(() => ({ fg: (_key: string, text: string) => text, getColorMode: () => "truecolor" }) as never);
	try {
		const host = makeHost(buildSession(7, 3, 1).manager);
		host.renderInitialMessages();
		const raw = host.chatContainer.render(80);
		const lines = raw.map(stripTerminalSequences).map((line) => line.trim()).filter(Boolean);
		assert.deepEqual(prompts(lines), all(7));
		const markers = lines.map((line, index) => line.includes("compaction ·") ? index : -1).filter((index) => index >= 0);
		assert.equal(markers.length, 2);
		assert.ok(at(lines, "answer 2") < markers[0] && markers[0] < at(lines, "prompt 3"));
		assert.ok(at(lines, "answer 5") < markers[1] && markers[1] < at(lines, "prompt 6"));
		const gold = raw.filter((line) => stripTerminalSequences(line).includes("compaction ·"));
		assert.equal(gold.length, 2);
		for (const line of gold) assert.ok(line.includes("\x1b[38;2;138;109;28m"));
	} finally { restoreCompaction(); restore(); }
});

it("draws the whole branch on a rebuild such as /reload or a settings change", () => {
	const restore = installHistory();
	try {
		const host = makeHost(compacted().manager);
		host.rebuildChatFromMessages();
		assert.deepEqual(prompts(rows(host)), all(6));
	} finally { restore(); }
});

it("keeps the history when a compaction finishes", async () => {
	const restore = installHistory();
	try {
		const { manager, turnUserIds } = buildSession(4);
		const host = makeHost(manager);
		host.renderInitialMessages();
		assert.deepEqual(prompts(rows(host)), all(4));
		manager.appendCompaction("fresh", turnUserIds[3], 5000);
		await host.handleEvent({ type: "compaction_end", reason: "threshold", result: { summary: "fresh", tokensBefore: 5000 } } as never);
		const lines = rows(host);
		assert.deepEqual(prompts(lines), all(4));
		assert.ok(at(lines, "answer 3") < at(lines, "Compacted from"));
	} finally { restore(); }
});

it("keeps the history when a compaction is stored at a turn boundary", async () => {
	const restore = installHistory();
	try {
		const { manager, turnUserIds } = buildSession(4);
		const host = makeHost(manager);
		host.renderInitialMessages();
		const id = manager.appendCompaction("boundary", turnUserIds[3], 5000);
		manager.appendMessage({ role: "user", content: "after", timestamp: 99 } as never);
		await host.handleEvent({ type: "entry_appended", entry: manager.getEntry(id) } as never);
		const lines = rows(host);
		assert.deepEqual(prompts(lines), all(4));
		assert.ok(at(lines, "answer 3") < at(lines, "Compacted from") && at(lines, "Compacted from") < at(lines, "after"));
	} finally { restore(); }
});

it("ignores a prototype of another shape", () => {
	const foreign = { renderSessionEntries() {} };
	installHistory(foreign)();
	assert.deepEqual(Object.keys(foreign), ["renderSessionEntries"]);
});

it("falls back to Pi when the session manager has another shape", () => {
	const restore = installHistory();
	try {
		const host = makeHost(compacted().manager);
		const manager = host.sessionManager;
		host.runtimeHost.session.sessionManager = Object.create(manager, { getBranch: { value: undefined } });
		host.renderInitialMessages();
		assert.deepEqual(prompts(rows(host)), ["prompt 2", "prompt 3", "prompt 4", "prompt 5"]);
	} finally { restore(); }
});

it("is installed by the extension on load and removed on shutdown", async () => {
	const { default: blocks } = await import("../../../extensions/RQW-blocks/index.ts");
	const handlers = new Map<string, () => void>();
	blocks({ on: (name: string, fn: () => void) => handlers.set(name, fn) } as never);
	const host = makeHost(compacted().manager);
	host.renderInitialMessages();
	assert.deepEqual(prompts(rows(host)), all(6));
	handlers.get("session_shutdown")!();
	const stock = makeHost(compacted().manager);
	stock.renderInitialMessages();
	assert.deepEqual(prompts(rows(stock)), ["prompt 2", "prompt 3", "prompt 4", "prompt 5"]);
});
