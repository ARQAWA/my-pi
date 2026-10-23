// The expanded original (Ctrl+O) against Pi itself: every row a call with this extension's renderers draws, whole, as
// Pi's root-exported ToolExecutionComponent.render() draws it, against the same component with the stock definition.
// Covers the five cases of the owner's comparison preview (my-pi-evidence/p3-tool-ui-wiring/preview), the fallbacks
// reproduced in fallback.ts (missing and throwing renderers, unknown tools, errors, images), widths and paddings, and
// the renderers' own timer: a call expanded while running, then folded, stops redrawing once it ends.
import assert from "node:assert/strict";
import { after, before, describe, it, type TestContext } from "node:test";
import * as pi from "@earendil-works/pi-coding-agent";
import { getCapabilities, setCapabilities, type TerminalCapabilities, Text } from "@earendil-works/pi-tui";
import { classify } from "../classify.ts";
import { PI_FALLBACK_VERSION } from "../fallback.ts";
import { ToolUi } from "../render.ts";
import { assertFits } from "./harness.ts";
import { CWD, fakeTui, stockDefinitions } from "./transcript.ts";

let caps: TerminalCapabilities;
before(() => {
	pi.initTheme("dark", false);
	caps = getCapabilities();
});
after(() => setCapabilities(caps));

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
interface Result { content: Content[]; details?: unknown; isError?: boolean; durationMs?: number }

/** A registered tool without renderCall and renderResult, as RQW-agent's tools and RQW-review's review are. */
const bare = (name: string) => ({ name, label: name, description: "fixture", parameters: { type: "object" }, execute: async () => ({ content: [] }) }) as unknown as pi.ToolRenderers;

const waitText = JSON.stringify({ reason: "result", timed_out: false, results: [{ id: "agent#3", run: 1, delivery: "wait",
	text: "Готово: найдено 2 места, где drawOriginal читает children[1]; см. render.ts:286 и README.", outcome: "finished" }], receipts: [],
	statuses: [{ id: "code_writer#5", state: "running", turns: 4 }] });

/** The five cases of the owner's preview, with the same arguments and results. */
const PREVIEW: { key: string; name: string; definition: pi.ToolRenderers | undefined; args: Record<string, unknown>; result: Result }[] = [
	{ key: "wait", name: "agent", definition: bare("agent"), args: { action: "wait", ids: ["agent#3", "code_writer#5"], timeout_ms: 600000 },
		result: { content: [{ type: "text", text: waitText }], durationMs: 41250 } },
	{ key: "cw-error", name: "code_writer", definition: bare("code_writer"), args: { task: "goal: fix render.ts\nfiles: extensions/RQW-tool-ui/render.ts", title: "fix render" },
		result: { content: [{ type: "text", text: "Error: brief is ambiguous (blocked)\nmissing: exact decided change" }], isError: true, durationMs: 900 } },
	{ key: "unknown", name: "mcp_lookup", definition: undefined, args: { query: "expanded original", filters: { kind: ["tool", "agent"], limit: 3 }, verbose: true },
		result: { content: [{ type: "text", text: "match 1\tToolExecutionComponent.render(width) adds a leading spacer row before the shell and then images\nmatch 2\tformatToolCallWithArgs is private to render-utils.js\nmatch 3\tgetTextOutput strips ANSI and binary control characters" }], durationMs: 300 } },
	{ key: "unknown-error", name: "mcp_lookup", definition: undefined, args: { query: "x" },
		result: { content: [{ type: "text", text: "Error: tool \"mcp_lookup\" is not registered in this session\n(it was available when the call was recorded)" }], isError: true } },
	{ key: "bash", name: "bash", definition: stockDefinitions().bash, args: { command: "npm test -- --grep render" },
		result: { content: [{ type: "text", text: "> my-pi@0.0.0 test\n\n✔ render-expanded-original (12ms)\n✔ render-width-fit (4ms)\n2 passing" }], details: {}, durationMs: 2400 } },
];

/** The same call twice: Pi's component with this extension's renderers, and with the stock definition. */
function pair(name: string, definition: pi.ToolRenderers | undefined, args: unknown, o: { outputPad?: number; showImages?: boolean; ui?: ToolUi } = {}) {
	const tui = fakeTui();
	const ui = o.ui ?? new ToolUi();
	const options = { outputPad: o.outputPad ?? 1, showImages: o.showImages ?? true };
	const ours = new pi.ToolExecutionComponent(name, "c1", args, options, ui.resolve(name, () => definition), tui as never, CWD);
	const stock = new pi.ToolExecutionComponent(name, "c1", args, options, definition, tui as never, CWD);
	const both = (f: (c: pi.ToolExecutionComponent) => void) => { f(ours); f(stock); };
	const same = (widths: number[], what: string) => {
		for (const w of widths) assert.deepEqual(ours.render(w), stock.render(w), `${what}, width ${w}`);
	};
	return { ours, stock, both, same, tui, ui };
}

const update = (r: Result, partial = false) => (c: pi.ToolExecutionComponent) =>
	c.updateResult({ content: r.content as never, details: r.details, isError: r.isError === true, ...(r.durationMs !== undefined ? { durationMs: r.durationMs } : {}) }, partial);

const WIDTHS = [0, 1, 2, 10, 24, 64, 80, 120];

describe("RQW-tool-ui expanded original against Pi's component", () => {
	it("original-fallback-version-pin (the reproduced formatting is Pi's of this version)", () => {
		assert.equal(pi.VERSION, PI_FALLBACK_VERSION, "Pi changed: compare fallback.ts with Pi's sources again (see its header)");
	});

	for (const c of PREVIEW) {
		it(`original-preview-${c.key} (whole render, ANSI included)`, () => {
			for (const outputPad of [0, 1, 3]) {
				const p = pair(c.name, c.definition, c.args, { outputPad });
				p.both((x) => x.markExecutionStarted());
				p.both((x) => x.setArgsComplete());
				p.both((x) => x.setExpanded(true));
				p.same(WIDTHS, `${c.key} pad ${outputPad}: arguments, before any result`);
				p.both(update(c.result));
				p.same(WIDTHS, `${c.key} pad ${outputPad}: final result`);
				assert.ok(p.ours.render(64).length > 3, "an expanded original is drawn");
				p.both((x) => x.setExpanded(false));
				assert.deepEqual(p.ours.render(64), [], "folded: no session, no group, nothing");
				p.both((x) => x.setExpanded(true));
				p.same([64], `${c.key}: expanded again`);
			}
		});
	}

	it("original-partial-then-error (pending, then error background, through updates)", () => {
		for (const c of PREVIEW) {
			const p = pair(c.name, c.definition, c.args);
			p.both((x) => x.setExpanded(true));
			p.both(update({ content: [{ type: "text", text: "partial line" }] }, true));
			p.same([64], `${c.key}: partial`);
			p.both((x) => x.updateArgs({ ...c.args, extra: "changed\twith tab" }));
			p.same([64], `${c.key}: arguments changed`);
			p.both(update({ ...c.result, isError: true }));
			p.same([64, 80], `${c.key}: error`);
			p.both((x) => x.invalidate());
			p.same([64], `${c.key}: invalidated`);
		}
	});

	it("original-renderers-throw (Pi's fallbacks for throwing and missing renderers)", () => {
		const call: pi.ToolRenderers["renderCall"] = (args) => new Text(`call ${JSON.stringify(args)}`, 0, 0);
		const result: pi.ToolRenderers["renderResult"] = (r) => new Text(`result ${(r.content[0] as { text: string }).text}`, 0, 0);
		const boom = () => { throw new Error("boom"); };
		const definitions: [string, pi.ToolRenderers][] = [["both throw", { renderCall: boom, renderResult: boom }], ["call throws", { renderCall: boom, renderResult: result }],
			["result throws", { renderCall: call, renderResult: boom }], ["call only", { renderCall: call }], ["result only", { renderResult: result }], ["none", {}]];
		for (const [label, definition] of definitions) {
			const p = pair("t", definition, { a: 1, nested: { b: [1, 2] }, s: "x\ty\r\nz" });
			p.both((x) => x.setExpanded(true));
			p.same(WIDTHS, `${label}: call`);
			p.both(update({ content: [{ type: "text", text: "one\ntwo" }] }, true));
			p.same(WIDTHS, `${label}: partial`);
			p.both(update({ content: [{ type: "text", text: "three" }], isError: true }));
			p.same(WIDTHS, `${label}: error`);
			p.both(update({ content: [] }));
			p.same(WIDTHS, `${label}: empty result`);
		}
	});

	it("original-renderers-throw-in-step (same call sequence as Pi)", () => {
		// A renderer whose outcome depends only on its input, so both components see the same thing whenever they call.
		const byArgs: pi.ToolRenderers = {
			renderCall: (args, _theme, ctx) => {
				if ((args as { fail?: boolean }).fail) throw new Error("call boom");
				return new Text(`call ${JSON.stringify(args)} last=${ctx.lastComponent ? "kept" : "none"}`, 0, 0);
			},
			renderResult: (result, options, _theme, ctx) => {
				const text = (result.content[0] as { text: string }).text;
				if (text.includes("boom")) throw new Error("result boom");
				return new Text(`result ${text} partial=${options.isPartial} last=${ctx.lastComponent ? "kept" : "none"}`, 0, 0);
			},
		};
		const p = pair("t", byArgs, { a: 1 });
		p.both((x) => x.markExecutionStarted());
		p.both((x) => x.setExpanded(true));
		p.same([64], "call");
		p.both(update({ content: [{ type: "text", text: "one" }] }, true));
		p.same([64], "partial: last component kept");
		p.both((x) => x.updateArgs({ fail: true }));
		p.same([64], "call throws: Pi's call fallback");
		p.both(update({ content: [{ type: "text", text: "boom\nline" }] }, true));
		p.same([64], "result throws: Pi's result fallback");
		p.both((x) => x.updateArgs({ a: 2 }));
		p.both(update({ content: [{ type: "text", text: "done" }] }));
		p.same(WIDTHS, "recovered: last component forgotten after a throw");
	});

	it("original-self-shell (an original that draws its own frame)", () => {
		const self: pi.ToolRenderers = { renderShell: "self", renderCall: (args) => new Text(`SELF ${JSON.stringify(args)}`, 0, 0),
			renderResult: (r) => new Text(`OUT ${(r.content[0] as { text: string }).text}`, 2, 0) };
		const p = pair("s", self, { q: 1 });
		p.both((x) => x.setExpanded(true));
		p.both(update({ content: [{ type: "text", text: "x" }] }));
		p.same(WIDTHS, "self shell: no box, no background");
	});

	it("original-images (Pi's own image rows and fallback indicators unchanged)", () => {
		const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
		const result: Result = { content: [{ type: "text", text: "\x1b[31mcolored\x1b[0m\r\nbinary\x07bell" }, { type: "image", data: png, mimeType: "image/png" }] };
		const id = (rows: string[]) => rows.map((l) => l.replace(/,i=\d+;/, ",i=ID;"));
		try {
			for (const images of [false, "kitty"] as const) {
				setCapabilities({ images: images || null, trueColor: true, hyperlinks: false } as TerminalCapabilities);
				for (const showImages of [true, false]) for (const c of PREVIEW) {
					const p = pair(c.name, c.definition, c.args, { showImages });
					p.both((x) => x.setExpanded(true));
					p.both(update(result));
					assert.deepEqual(id(p.ours.render(64)), id(p.stock.render(64)), `${c.key} images=${images} show=${showImages}`);
				}
			}
		} finally {
			setCapabilities(caps);
		}
	});

	it("original-background-jobs (RQW-tools job tool and a bash handed to the background: no new semantics)", () => {
		// RQW-tools registers `job` without renderers: expanded it is Pi's fallback, folded it counts as another tool.
		const job = bare("job");
		const jobArgs = { action: "wait", ids: ["job#1"], timeout_ms: 600000 };
		const jobResult: Result = { content: [{ type: "text", text: JSON.stringify({ results: [{ id: "job#1", state: "done", exit: 0, output: "ok" }] }) }], durationMs: 3000 };
		const handoff: Result = { content: [{ type: "text", text: "job#1 (bash) is still running after 12 s and continues in the background." }], details: {}, durationMs: 12000 };
		for (const [name, definition, args, result] of [["job", job, jobArgs, jobResult], ["bash", stockDefinitions().bash, { command: "npm ci" }, handoff]] as const) {
			const p = pair(name, definition, args);
			p.both((x) => x.markExecutionStarted());
			p.both((x) => x.setExpanded(true));
			p.both(update(result));
			p.same(WIDTHS, `${name}: expanded is stock`);
		}
		const ctx = { toolCallId: "j1", isPartial: false, isError: false };
		assert.equal(classify("job", jobArgs, jobResult as never, ctx).kind, "other", "job wait is not an agent wait");
		assert.equal(classify("bash", { command: "npm ci" }, handoff as never, ctx).kind, "run", "a background handoff is still the command it ran");
	});

	it("original-width-fit", () => {
		for (const c of PREVIEW) {
			const p = pair(c.name, c.definition, c.args);
			p.both((x) => x.setExpanded(true));
			p.both(update(c.result));
			assertFits((w) => p.ours.render(w), Array.from({ length: 157 }, (_, i) => i + 4));
		}
	});
});

/** Fixed `Date` and fake intervals for this test only. */
function clock(t: TestContext) {
	t.mock.timers.enable({ apis: ["Date", "setInterval"], now: Date.UTC(2026, 0, 2, 3, 4, 5) });
	return (ms: number) => t.mock.timers.tick(ms);
}

describe("RQW-tool-ui original renderers finish what they start", () => {
	const running: Result = { content: [{ type: "text", text: "building..." }] };
	const done: Result = { content: [{ type: "text", text: "built" }], details: {}, durationMs: 2400 };

	/** Bash expanded while it runs: Pi's bash renderer starts its one-second redraw timer. */
	function expandedRunning(t: TestContext) {
		const tick = clock(t);
		const ui = new ToolUi();
		const p = pair("bash", stockDefinitions().bash, { command: "make" }, { ui });
		p.both((x) => x.markExecutionStarted());
		p.both((x) => x.setArgsComplete());
		p.both(update(running, true));
		p.ours.setExpanded(true);
		p.stock.setExpanded(true);
		const before = p.tui.renders;
		tick(3000);
		assert.ok(p.tui.renders >= before + 6, "both rows redraw every second while running (the timer is live)");
		tick(1000);
		assert.deepEqual(p.ours.render(80), p.stock.render(80), "expanded while running: Pi's elapsed time");
		return { ...p, tick };
	}

	it("timer-expanded-collapsed-completed (no redraws left after the call ends folded)", (t) => {
		const p = expandedRunning(t);
		p.ours.setExpanded(false);
		p.stock.setExpanded(false);
		p.tick(2000);
		p.both(update(done));
		const after = p.tui.renders;
		p.tick(10_000);
		assert.equal(p.tui.renders, after, "no timer left: neither row redraws");
		p.both((x) => x.setExpanded(true));
		assert.deepEqual(p.ours.render(80), p.stock.render(80), "expanded after the end: Pi's final time");
	});

	it("timer-error-ends (a failed or cancelled call stops the timer too)", (t) => {
		const p = expandedRunning(t);
		p.ours.setExpanded(false);
		p.stock.setExpanded(false);
		p.both(update({ content: [{ type: "text", text: "Command aborted" }], isError: true }, true));
		const after = p.tui.renders;
		p.tick(10_000);
		assert.equal(p.tui.renders, after, "an error result, even partial, stops the timer");
	});

	it("timer-shutdown-reload (session end and a rebuilt transcript keep no timer)", (t) => {
		const p = expandedRunning(t);
		p.ours.setExpanded(false);
		p.ours.updateResult({ content: done.content as never, details: done.details, isError: false, durationMs: 2400 }, false);
		p.stock.updateResult({ content: done.content as never, details: done.details, isError: false, durationMs: 2400 }, false);
		p.ui.shutdown();
		// /reload: Pi builds new rows from history with a new resolver; the old rows are dropped.
		const ui = new ToolUi();
		const fresh = pair("bash", stockDefinitions().bash, { command: "make" }, { ui });
		fresh.both(update(done));
		fresh.both((x) => x.setExpanded(true));
		fresh.same([80], "reloaded: Pi's final row");
		ui.shutdown();
		const after = p.tui.renders + fresh.tui.renders;
		p.tick(10_000);
		assert.equal(p.tui.renders + fresh.tui.renders, after, "no timer after shutdown and reload");
	});

	it("timer-expanded-late (the clock runs from the start of execution, as Pi's)", (t) => {
		const tick = clock(t);
		const p = pair("bash", stockDefinitions().bash, { command: "make" });
		p.both((x) => x.markExecutionStarted());
		p.both((x) => x.setArgsComplete());
		tick(4000);
		p.both(update(running, true));
		tick(6000);
		p.both((x) => x.setExpanded(true));
		assert.deepEqual(p.ours.render(80), p.stock.render(80), "expanded after ten seconds: the same elapsed time");
		assert.ok(p.ours.render(80).some((l) => l.includes("10.0s")));
		tick(3000);
		assert.deepEqual(p.ours.render(80), p.stock.render(80), "and it keeps counting");
		p.both(update(done));
		const after = p.tui.renders;
		tick(5000);
		assert.equal(p.tui.renders, after);
	});

	it("timer-never-expanded (a folded call never starts the original renderers)", (t) => {
		const tick = clock(t);
		const p = pair("bash", stockDefinitions().bash, { command: "make" });
		p.ours.markExecutionStarted();
		p.ours.setArgsComplete();
		p.ours.updateResult({ content: running.content as never, isError: false }, true);
		const before = p.tui.renders;
		tick(5000);
		assert.equal(p.tui.renders, before, "no original renderer ran, so no timer");
	});
});
