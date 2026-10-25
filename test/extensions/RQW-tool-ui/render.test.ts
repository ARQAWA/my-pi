// T08 wiring: the renderers RQW-tool-ui gives Pi, driven with Pi's render context and public events. Collapsed rows
// come from the group model; expanded rows are the original renderers (or Pi's fallbacks) in Pi's shell.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as pi from "@earendil-works/pi-coding-agent";
import { getCapabilities, setCapabilities, type TerminalCapabilities, Text } from "@earendil-works/pi-tui";
import { ToolUi } from "../../../extensions/RQW-tool-ui/render.ts";
import { assertFits, coloredTheme, deepFreeze, identityTheme, SAMPLES } from "./harness.ts";
import { call, context, CWD, fakeTui, messages, session, stockDefinitions, stockTheme, text } from "./transcript.ts";

let caps: TerminalCapabilities;
before(() => {
	pi.initTheme("dark", false);
	caps = getCapabilities();
});
after(() => setCapabilities(caps));

const stock = stockDefinitions();
const theme = identityTheme;

/** One row as Pi draws it: renderCall, then renderResult when there is a result, both with the same state. */
function row(ui: ToolUi, name: string, id: string, args: unknown, o: { result?: string; expanded?: boolean; state?: object; invalidate?: () => void; isPartial?: boolean; outputPad?: number; durationMs?: number } = {}) {
	const r = ui.resolve(name, () => stock[name]);
	const state = o.state ?? {};
	const ctx = context(id, args, { state, expanded: o.expanded ?? false, isPartial: o.isPartial ?? false, outputPad: o.outputPad ?? 1,
		durationMs: o.durationMs ?? 50, ...(o.invalidate ? { invalidate: o.invalidate } : {}) });
	const callView = r.renderCall!(args as never, theme, ctx);
	const resultView = o.result === undefined ? undefined : r.renderResult!({ content: [{ type: "text", text: o.result }], details: undefined }, { expanded: ctx.expanded, isPartial: ctx.isPartial }, theme, ctx);
	return { renderers: r, render: (w: number) => [...callView.render(w), ...(resultView?.render(w) ?? [])] };
}

/** A finished group: read and bash in one step, then (optionally) the answer. */
function finished(withAnswer: boolean) {
	const m = messages();
	const list: unknown[] = [m.user("go"), m.assistant([call("c1", "read", { path: "a.ts" }), call("c2", "bash", { command: "npm test" })]),
		m.result("c1", "read", "one\ntwo", { durationMs: 12 }), m.result("c2", "bash", "ok 1\nok 2\nok 3\nok 4\nok 5", { durationMs: 1200 })];
	if (withAnswer) list.push(m.assistant([text("Done.")]));
	const ui = new ToolUi();
	ui.start(session(list));
	return ui;
}

describe("RQW-tool-ui wiring", () => {
	it("render-non-leader-empty", () => {
		const ui = finished(true);
		const r = row(ui, "read", "c1", { path: "a.ts" }, { result: "one\ntwo" });
		assert.equal(r.renderers.renderShell, "self");
		for (const w of [0, 1, 24, 80]) assert.deepEqual(r.render(w), [], `width ${w}: a non-leader draws nothing, call and result`);
	});

	it("render-leader-summary-and-live", () => {
		// Answer given: the group is over, only the summary line.
		const done = row(finished(true), "bash", "c2", { command: "npm test" }, { result: "ok 5" });
		assert.deepEqual(done.render(80), [" Read 1 file · ran 1 command"]);
		// No answer yet: the group is active and the live card of the current call (the last started) follows.
		const active = row(finished(false), "bash", "c2", { command: "npm test" }, { result: "ok 5" });
		const rows = active.render(80);
		assert.equal(rows[0], " Read 1 file · ran 1 command");
		assert.deepEqual(rows.slice(1).map((l) => l.trim()), ["$ npm test", "ok 2", "ok 3", "ok 4", "ok 5", "✓ 1.2s"]);
		for (const l of rows.slice(1)) assert.ok(l.startsWith("    "), "live rows: output padding plus the three-column indent");
	});

	it("render-leader-moves (old redraws empty, new draws the line)", () => {
		const m = messages();
		const ui = new ToolUi();
		ui.start(session([m.user("go")]));
		const streamed = m.assistant([call("c1", "read", { path: "a.ts" })]);
		ui.messageStart(streamed);
		const redraws: string[] = [];
		const first = row(ui, "read", "c1", { path: "a.ts" }, { invalidate: () => redraws.push("c1"), isPartial: true });
		assert.equal(first.render(80)[0], " Read 1 file", "the only call leads");
		// The same step streams a second call: it leads now.
		ui.messageUpdate({ ...streamed, content: [...streamed.content, call("c2", "bash", { command: "ls" })] });
		assert.ok(redraws.includes("c1"), "the old leader was asked to redraw");
		assert.deepEqual(first.render(80), [], "the old leader draws nothing");
		const second = row(ui, "bash", "c2", { command: "ls" }, { isPartial: true });
		const rows = second.render(80);
		assert.equal(rows[0], " Read 1 file · ran 1 command");
		assert.equal(rows[1].trim(), "$ ls", "the live card follows the new call");
		assert.equal(rows.at(-1)!.trim(), "running");
	});

	it("render-answer-folds-live", () => {
		const m = messages();
		const ui = new ToolUi();
		const sm = session([m.user("go"), m.assistant([call("c1", "bash", { command: "make" })]), m.result("c1", "bash", "built", { durationMs: 400 })]);
		ui.start(sm);
		let redraws = 0;
		const leader = row(ui, "bash", "c1", { command: "make" }, { result: "built", invalidate: () => redraws++ });
		assert.equal(leader.render(80).length, 4, "summary, header, one output row, status");
		// The answer starts streaming: the group stops and its live card folds at once.
		const answer = m.assistant([text("")]);
		ui.messageStart(answer);
		assert.equal(leader.render(80).length, 4, "an empty text block is not an answer yet");
		ui.messageUpdate({ ...answer, content: [text("Here")] });
		assert.ok(redraws > 0);
		assert.deepEqual(leader.render(80), [" Ran 1 command"]);
		// Pi saves the message, then reports its end; the run ends after that.
		const saved = { ...answer, content: [text("Here it is.")] };
		sm.appendMessage(saved as never);
		ui.messageEnd(saved);
		ui.agentEnd();
		assert.deepEqual(leader.render(80), [" Ran 1 command"]);
	});

	it("render-expanded-original (Ctrl+O on and off)", () => {
		const ui = finished(true);
		const tui = fakeTui();
		const piTheme = stockTheme();
		const cases: [string, string, Record<string, unknown>, string, pi.ToolRenderers | undefined][] = [
			["read", "c1", { path: "a.ts" }, "one\ntwo", stock.read],
			["bash", "c2", { command: "npm test" }, "ok 1\nok 2\nok 3\nok 4\nok 5\nok 6\nok 7\nok 8\nok 9\nok 10\nok 11\nok 12", stock.bash],
			["mystery", "x1", { q: "a" }, "plain", undefined], // no definition: Pi's text fallback
			["plain", "x2", { q: "b" }, "plain", {}], // a definition without renderers: Pi's call and result fallbacks
			["selfie", "x3", { q: "c" }, "own", { renderShell: "self", renderCall: () => new Text("SELF", 0, 0) }],
		];
		for (const [name, id, args, output, definition] of cases) {
			const r = ui.resolve(name, () => definition);
			const state = {};
			for (const expanded of [true, false, true]) {
				const ctx = context(id, args, { state, expanded });
				// Pi hands every renderer its active theme; the original is drawn with the theme given.
				const t = expanded ? piTheme : theme;
				const view = r.renderCall!(args as never, t, ctx);
				r.renderResult!({ content: [{ type: "text", text: output }], details: undefined }, { expanded, isPartial: false }, t, ctx);
				const original = new pi.ToolExecutionComponent(name, id, args, { outputPad: 1 }, definition, tui as never, CWD);
				original.markExecutionStarted();
				original.setArgsComplete();
				original.setExpanded(expanded);
				original.updateResult({ content: [{ type: "text", text: output }], isError: false, durationMs: 50 });
				if (expanded) {
					// Pi's component starts with its blank row, which Pi also puts before a self-drawn row.
					assert.deepEqual(view.render(80), original.render(80).slice(1), `${name}: the original, exactly as Pi draws it`);
				} else assert.deepEqual(view.render(80), id === "c2" ? [" Read 1 file · ran 1 command"] : [], `${name}: folded again`);
			}
		}
	});

	it("render-images-kept (the renderers draw no image and leave Pi's untouched)", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
		try {
			const m = messages();
			const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
			const result = deepFreeze({ content: [{ type: "text", text: "Read image file [image/png]" }, { type: "image", data: png, mimeType: "image/png" }], isError: false });
			const ui = new ToolUi();
			ui.start(session([m.user("go"), m.assistant([call("c1", "read", { path: "a.png" }), call("c2", "bash", { command: "ls" })]),
				m.result("c1", "read", "x"), m.result("c2", "bash", "a.png"), m.assistant([text("ok")])]));
			const tui = fakeTui();
			const ours = new pi.ToolExecutionComponent("read", "c1", { path: "a.png" }, { showImages: true }, ui.resolve("read", () => stock.read), tui as never, CWD);
			const theirs = new pi.ToolExecutionComponent("read", "c1", { path: "a.png" }, { showImages: true }, stock.read, tui as never, CWD);
			for (const c of [ours, theirs]) c.updateResult(result as never);
			// Each Pi Image picks its own random kitty image ID.
			const id = (rows: string[]) => rows.map((l) => l.replace(/,i=\d+;/, ",i=ID;"));
			const mine = id(ours.render(80)), stockRows = id(theirs.render(80));
			assert.ok(mine.length > 0, "Pi still appends the image to a folded call");
			// Folded, the row is exactly Pi's image part (spacer and image rows), nothing of the renderers.
			assert.deepEqual(mine, stockRows.slice(stockRows.length - mine.length));
			assert.ok(mine.some((l) => l.includes("\x1b_G")), "a kitty image line, drawn by Pi");
			ours.setExpanded(true);
			theirs.setExpanded(true);
			assert.deepEqual(id(ours.render(80)), id(theirs.render(80)), "expanded: exactly the stock call, result and image");
		} finally {
			setCapabilities(caps);
		}
	});

	it("render-session-reset", () => {
		const ui = finished(false);
		let redraws = 0;
		const r = row(ui, "bash", "c2", { command: "npm test" }, { result: "ok 5", invalidate: () => redraws++ });
		assert.ok(r.render(80).length > 1);
		assert.ok(ui.rowCount > 0);
		ui.shutdown();
		assert.equal(ui.installed, false);
		assert.equal(ui.rowCount, 0, "no row callbacks kept");
		assert.deepEqual(r.render(80), [], "without a session nothing is drawn");
		// A new session starts empty: the old call is unknown there.
		const m = messages(5_000);
		ui.start(session([m.user("other")]));
		assert.deepEqual(r.render(80), []);
		assert.equal(ui.group("c2"), undefined);
		ui.toolStart({ toolCallId: "z", toolName: "bash" });
		assert.equal(redraws, 0, "the old session's rows are never asked to redraw");
	});

	it("render-width-fit", () => {
		const m = messages();
		const long = [SAMPLES.cyrillic, SAMPLES.emoji, SAMPLES.cjk, SAMPLES.combining, SAMPLES.tabs, SAMPLES.ansi, SAMPLES.longPath].join("\n");
		const ui = new ToolUi();
		ui.start(session([m.user("go"), m.assistant([call("c1", "read", { path: SAMPLES.longPath }), call("c2", "bash", { command: SAMPLES.longCommand })]),
			m.result("c1", "read", long), m.result("c2", "bash", long, { durationMs: 65_000 })]));
		for (const t of [identityTheme, coloredTheme(3)]) {
			const ctx = context("c2", { command: SAMPLES.longCommand });
			const view = ui.resolve("bash", () => stock.bash).renderCall!({ command: SAMPLES.longCommand } as never, t, ctx);
			assert.ok(view.render(80).length === 7, "summary, header, four output rows, status");
			for (const pad of [0, 1, 4]) {
				const padded = ui.resolve("bash", () => stock.bash).renderCall!({ command: SAMPLES.longCommand } as never, t, { ...ctx, outputPad: pad });
				assertFits((w) => padded.render(w));
			}
		}
		// Expanded rows are Pi's own drawing; they fit wherever Pi's box has room for its padding.
		const ctx = context("c2", { command: SAMPLES.longCommand }, { expanded: true });
		const r = ui.resolve("bash", () => stock.bash);
		const view = r.renderCall!({ command: SAMPLES.longCommand } as never, theme, ctx);
		r.renderResult!({ content: [{ type: "text", text: long }], details: undefined }, { expanded: true, isPartial: false }, theme, ctx);
		assertFits((w) => view.render(w), Array.from({ length: 157 }, (_, i) => i + 4));
	});
});
