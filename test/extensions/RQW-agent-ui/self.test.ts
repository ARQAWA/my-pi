// A tool-ui-like self shell proves the outer wrapper without importing another extension.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { initTheme, ToolExecutionComponent, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import { cardLines } from "../../../extensions/RQW-agent-ui/card.ts";
import { selfShellWaitRenderers } from "../../../extensions/RQW-agent-ui/self.ts";
import { waitCards } from "../../../extensions/RQW-agent-ui/wait.ts";

before(() => {
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "rqw-agent-ui-self-"));
	initTheme("dark", false);
});

const EMPTY: Component = { render: () => [], invalidate() {} };
const args = { action: "wait", ids: ["agent#3", "agent#4"], until: "all" };
const result = {
	content: [{ type: "text" as const, text: "ORIGINAL JSON" }],
	details: { reason: "result", results: [
		{ id: "agent#3", text: "FIRST\nFULL TAIL [inside]", display: { title: "Check sources", outcome: "finished", model: "anthropic/claude-opus-5-5", thinking: "medium", seconds: 42 } },
		{ id: "agent#4", text: "SECOND FIRST\nSECOND TAIL", display: { outcome: "failed", seconds: 3 } },
	] },
};
const plain = (rows: string[]) => rows.map(stripVTControlCharacters).join("\n");
const ui = { requestRender() {} } as never;
function host(renderers: ToolRenderers, input = args, pad = 1) {
	return new ToolExecutionComponent("agent", "wait-call", input, { outputPad: pad }, renderers, ui, process.cwd());
}
function selfShell() {
	return {
		renderShell: "self" as const,
		renderCall(input: unknown, _theme: unknown, context: { expanded: boolean }) {
			if (!context.expanded && (input as { leader?: boolean }).leader === false) return EMPTY;
			return new Text(context.expanded ? "INNER ORIGINAL CALL" : "GROUP SUMMARY + LIVE", 0, 0);
		},
		renderResult(_result: unknown, options: { expanded: boolean }) {
			return options.expanded ? new Text("INNER ORIGINAL RESULT", 0, 0) : EMPTY;
		},
	} as ToolRenderers;
}

it("self-folded-delegation: leader and nonleader return the exact inner components with the original contexts", () => {
	for (const leader of [false, true]) {
		const call = leader ? new Text("SUMMARY", 0, 0) : EMPTY;
		const contexts: unknown[] = [];
		const inner: ToolRenderers = {
			renderShell: "self",
			renderCall: (_args, _theme, context) => { contexts.push(context); return call; },
			renderResult: (_result, _options, _theme, context) => { contexts.push(context); return EMPTY; },
		};
		const wrapped = selfShellWaitRenderers("agent", inner);
		const invalidate = () => {};
		const state = { existing: "owner state" };
		const context = { args, state, invalidate, expanded: false } as never;
		assert.equal(wrapped.renderCall!(args, {} as never, context), call);
		assert.equal(wrapped.renderResult!(result, { expanded: false, isPartial: false }, {} as never, context), EMPTY);
		assert.deepEqual(contexts, [context, context]);
		assert.equal(contexts[0], context);
		assert.equal(contexts[1], context);
		assert.deepEqual(state, { existing: "owner state" });
		assert.equal(wrapped.renderShell, inner.renderShell);
	}
});

it("self-expanded-cards: full answers appear once, Ctrl+O back restores leader and zero-row nonleader", () => {
	for (const leader of [true, false]) {
		const input = { ...args, leader };
		const inner = selfShell();
		const wrapped = host(selfShellWaitRenderers("agent", inner), input);
		const stock = host(inner, input);
		wrapped.updateResult({ ...result, isError: false }, false);
		stock.updateResult({ ...result, isError: false }, false);
		const collapsed = wrapped.render(100);
		assert.deepEqual(collapsed, stock.render(100));
		if (!leader) assert.deepEqual(collapsed, []);
		for (const expanded of [true, false, true, false]) {
			wrapped.setExpanded(expanded);
			if (!expanded) { assert.deepEqual(wrapped.render(100), collapsed); continue; }
			const text = plain(wrapped.render(100));
			assert.match(text, /agent#3 Check sources finished · opus medium · 42s/);
			assert.match(text, /agent#4 failed · 3s/);
			for (const part of ["FULL TAIL [inside]", "SECOND TAIL"]) assert.equal(text.split(part).length - 1, 1);
			assert.doesNotMatch(text, /ORIGINAL JSON|INNER ORIGINAL|GROUP SUMMARY/);
		}
	}
});

it("self-stock-box-parity: expanded header, theme background and output padding match Pi's native shell", () => {
	for (const pad of [0, 1, 3]) {
		const actual = host(selfShellWaitRenderers("agent", selfShell()), args, pad);
		const expected = host({ renderResult: (_result, _options, theme) => ({
			render: (width) => waitCards("agent", args, result)!.flatMap((card) => cardLines(card, true, theme, width)), invalidate() {},
		}) }, args, pad);
		for (const component of [actual, expected]) {
			component.setExpanded(true);
			component.updateResult({ ...result, isError: false }, false);
		}
		for (const width of [24, 80, 160]) assert.deepEqual(actual.render(width), expected.render(width), `padding ${pad}, width ${width}`);
	}
});

it("self-diagnostics-and-updates: alerts, errors, partials and other actions retain inner rendering; invalidation stays live", () => {
	let redraws = 0;
	let latest: { invalidate(): void } | undefined;
	const inner = selfShell();
	const originalCall = inner.renderCall!;
	inner.renderCall = (input, theme, context) => { latest = context; return originalCall(input, theme, context); };
	const wrapped = new ToolExecutionComponent("agent", "live", args, {}, selfShellWaitRenderers("agent", inner), { requestRender() { redraws++; } } as never, process.cwd());
	const stock = host(inner);
	const diagnostic = { content: [{ type: "text" as const, text: "alert" }], details: { reason: "alert", results: [] } };
	wrapped.setExpanded(true); stock.setExpanded(true);
	for (const [value, partial, error] of [[result, false, false], [diagnostic, false, false], [result, true, false], [result, false, true]] as const) {
		wrapped.updateResult({ ...value, isError: error }, partial);
		stock.updateResult({ ...value, isError: error }, partial);
		if (value === result && !partial && !error) assert.match(plain(wrapped.render(100)), /FULL TAIL/);
		else assert.deepEqual(wrapped.render(100), stock.render(100));
	}
	// Trigger the outer host's public invalidate callback after restoring a collapsed row.
	wrapped.setExpanded(false);
	const before = redraws;
	latest!.invalidate();
	assert.equal(redraws, before + 1);
	stock.setExpanded(false);
	assert.deepEqual(wrapped.render(100), stock.render(100), "invalidation retains exact native row padding");
	wrapped.updateArgs({ action: "status", ids: args.ids });
	wrapped.setExpanded(true);
	assert.match(plain(wrapped.render(100)), /INNER ORIGINAL CALL/);
	assert.doesNotMatch(plain(wrapped.render(100)), /FULL TAIL/);
});
