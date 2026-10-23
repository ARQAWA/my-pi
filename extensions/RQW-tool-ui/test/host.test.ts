// T09 host composition: a transcript built from Pi's root-exported AssistantMessageComponent and
// ToolExecutionComponent, as Pi's interactive mode stacks them, with the RQW-tool-ui renderers. Only exported
// constructors and methods; nothing of Pi is replaced. Only this extension is loaded: no thinking-text hider, so a
// hidden thinking step keeps Pi's label row.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import * as pi from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences } from "@earendil-works/pi-tui";
import { ToolUi } from "../render.ts";
import { assertFits } from "./harness.ts";
import { type Block, call, CWD, fakeTui, messages, session, stockDefinitions, text, thinking } from "./transcript.ts";

before(() => pi.initTheme("dark", false));
const tmp = mkdtempSync(join(tmpdir(), "rqw-tool-ui-host-"));
after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const stock = stockDefinitions();
const m = messages();
const prompt = m.user("fix it");
const step1 = m.assistant([thinking("look first"), call("c1", "read", { path: "a.ts" }), call("c2", "read", { path: "b.ts" })]);
const r1 = m.result("c1", "read", "alpha", { durationMs: 5 });
const r2 = m.result("c2", "read", "beta", { durationMs: 6 });
const step2 = m.assistant([thinking("now test"), call("c3", "bash", { command: "npm test" })]);
const r3 = m.result("c3", "bash", "ok 1\nok 2\nok 3\nok 4\nok 5", { durationMs: 2300 });
const answer = m.assistant([thinking("done"), text("All green.")]);
const results = new Map([["c1", r1], ["c2", r2], ["c3", r3]]);

type Definitions = (name: string) => pi.ToolRenderers | undefined;

/** Pi's chat as interactive mode builds it from history: each assistant message, then a row per tool call. */
function transcript(list: readonly unknown[], definitions: Definitions, o: { hideThinking?: boolean } = {}) {
	const tui = fakeTui();
	const tools: pi.ToolExecutionComponent[] = [];
	const parts: { kind: string; component: Component }[] = [];
	for (const message of list) {
		const msg = message as { role: string; content: Block[] };
		if (msg.role !== "assistant") continue;
		parts.push({ kind: "assistant", component: new pi.AssistantMessageComponent(message as never, o.hideThinking ?? true, undefined, "Thinking...", 1) });
		for (const block of msg.content) {
			if (block.type !== "toolCall") continue;
			const row = new pi.ToolExecutionComponent(block.name, block.id, block.arguments, { outputPad: 1 }, definitions(block.name), tui as never, CWD);
			row.markExecutionStarted();
			row.setArgsComplete();
			const saved = results.get(block.id);
			if (saved && list.includes(saved)) row.updateResult({ content: saved.content, isError: false, durationMs: saved.durationMs as number });
			tools.push(row);
			parts.push({ kind: block.id, component: row });
		}
	}
	return {
		tools,
		render: (w: number) => parts.flatMap((p) => p.component.render(w)),
		rows: (w: number) => parts.map((p) => ({ kind: p.kind, rows: p.component.render(w).map((l) => stripTerminalSequences(l).trimEnd()) })),
		expand: (on: boolean) => { for (const t of tools) t.setExpanded(on); },
	};
}

function ours(list: readonly unknown[]): Definitions {
	const ui = new ToolUi();
	ui.start(session(list));
	return (name) => ui.resolve(name, () => stock[name]);
}

const FULL = [prompt, step1, r1, r2, step2, r3, answer];
const RUNNING = [prompt, step1, r1, r2, step2, r3];

describe("RQW-tool-ui in Pi's transcript components", () => {
	it("host-non-leader-zero-rows", () => {
		const t = transcript(FULL, ours(FULL));
		const rows = t.rows(80);
		assert.deepEqual(rows.find((r) => r.kind === "c1")!.rows, []);
		assert.deepEqual(rows.find((r) => r.kind === "c2")!.rows, []);
	});

	it("host-leader-rows (one Pi blank row, the summary, the live block while active)", () => {
		const done = transcript(FULL, ours(FULL)).rows(80).find((r) => r.kind === "c3")!.rows;
		assert.deepEqual(done, ["", " ↳ Read 2 files · ran 1 command"]);
		const running = transcript(RUNNING, ours(RUNNING)).rows(80).find((r) => r.kind === "c3")!.rows;
		assert.deepEqual(running.map((l) => l.trim()), ["", "↳ Read 2 files · ran 1 command", "$ npm test", "ok 2", "ok 3", "ok 4", "ok 5", "✓ 2.3s"]);
	});

	it("host-thinking-steps-blank-rows (only RQW-tool-ui: Pi's blank row and label row per thinking step, nothing more)", () => {
		const hidden = transcript(FULL, ours(FULL)).rows(80);
		assert.deepEqual(hidden.flatMap((r) => r.rows), [
			"", " Thinking...", // step 1: Pi's blank row and its hidden-thinking label; its two reads draw nothing
			"", " Thinking...", // step 2
			"", " ↳ Read 2 files · ran 1 command", // the leader: Pi's blank row and the summary
			"", " Thinking...", "", " All green.", // the answer step
		]);
		// Shown thinking: the label row becomes the thinking text, the blank rows stay the same.
		const shown = transcript(FULL, ours(FULL), { hideThinking: false }).rows(80).flatMap((r) => r.rows);
		assert.deepEqual(shown, ["", " look first", "", " now test", "", " ↳ Read 2 files · ran 1 command", "", " done", "", " All green."]);
	});

	it("host-expanded-original (Ctrl+O shows every call as Pi draws it, and back)", () => {
		const mine = transcript(FULL, ours(FULL));
		const theirs = transcript(FULL, (name) => stock[name]);
		const folded = mine.render(80);
		mine.expand(true);
		theirs.expand(true);
		assert.deepEqual(mine.render(80), theirs.render(80), "every call at its own place, exactly the stock look");
		for (let i = 0; i < mine.tools.length; i++) assert.deepEqual(mine.tools[i].render(80), theirs.tools[i].render(80));
		mine.expand(false);
		assert.deepEqual(mine.render(80), folded, "Ctrl+O again folds back");
	});

	it("host-extension-absent (without the resolver every call is stock)", async () => {
		const agentDir = join(tmp, "agent");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [], extensions: [] }));
		const loader = new pi.DefaultResourceLoader({ cwd: tmp, agentDir, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().extensions.flatMap((e) => e.toolRenderers ?? []), [], "no resolver loaded");
		// Pi then uses the tool's own renderers: the transcript is the stock one, unlike with the extension.
		const absent = transcript(FULL, (name) => stock[name]);
		const stockRows = absent.rows(80);
		for (const id of ["c1", "c2", "c3"]) assert.ok(stockRows.find((r) => r.kind === id)!.rows.length > 2, `${id}: Pi's tool box`);
		assert.notDeepEqual(transcript(FULL, ours(FULL)).render(80), absent.render(80));
	});

	it("host widths 0/1/24/80 fit", () => {
		for (const list of [FULL, RUNNING]) {
			const t = transcript(list, ours(list));
			assertFits((w) => t.tools.flatMap((c) => c.render(w)), [0, 1, 24, 80]);
			assertFits((w) => t.render(w), [24, 80]);
		}
	});
});
