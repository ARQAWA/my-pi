// T17, wait path: the cards for the results of a `wait` call, and the stock view that stays reachable (Ctrl+O).
// Pure checks with Pi's exported ToolExecutionComponent as the host; no other extension.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { before, it } from "node:test";
import { type ToolDefinition, ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import agentUi from "../index.ts";
import { type CardTheme } from "../card.ts";
import { WAIT_TOOLS, waitCards } from "../wait.ts";

before(() => {
	// Pi reads keybindings and settings from here, never from the owner's ~/.pi.
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "rqw-agent-ui-wait-"));
	initTheme("dark", false);
});

type Resolver = Parameters<Parameters<typeof agentUi>[0]["registerToolRenderer"]>[0];
const captured = { resolvers: [] as Resolver[], messages: [] as string[] };
agentUi({
	registerMessageRenderer: (type: string) => captured.messages.push(type),
	registerToolRenderer: (resolver: Resolver) => captured.resolvers.push(resolver),
} as never);
const [resolve] = captured.resolvers;

const DISPLAY = { id: "agent#3", outcome: "finished", model: "anthropic/claude-opus-5-5", thinking: "medium", seconds: 42 };
const item = (over: object = {}) => ({ id: "agent#3", run: "1:1", delivery: "d-1", text: "Проверил отступы.\nВторая строка.", outcome: "completed", display: DISPLAY, ...over });
const details = (...items: object[]) => ({ reason: "result", timed_out: false, results: items, receipts: [], statuses: [] });
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value });
const WAIT_ARGS = { action: "wait", ids: ["agent#3"] };

const DEFINITION = {
	name: "agent", label: "agent", description: "d",
	parameters: Type.Object({ action: Type.String() }),
	async execute() { return { content: [], details: undefined }; },
} as unknown as ToolDefinition;
const ui = { requestRender() {} } as never;

/** The host component with this tool's renderers resolved (through the extension, or stock when `stock`). */
function host(args: unknown, result: { content: unknown; details: unknown }, expanded: boolean, stock = false) {
	const definition = stock ? DEFINITION : resolve("agent", () => DEFINITION as never) as never;
	const component = new ToolExecutionComponent("agent", "call-1", args, {}, definition, ui, process.cwd());
	component.setExpanded(expanded);
	component.updateResult({ ...result, isError: false } as never, false);
	return component;
}
const rows = (component: ToolExecutionComponent, width: number) => component.render(width);
const plain = (lines: string[]) => lines.map((line) => stripVTControlCharacters(line).trimEnd());

it("wait-cards-title: a result's display.title shows after its id; a result without one shows none", () => {
	const body = plain(rows(host(WAIT_ARGS, text(details(item({ display: { ...DISPLAY, title: "Check indents" } }), item({ id: "code_writer#2", text: "Готово.", display: { id: "code_writer#2", outcome: "finished" } }))), false), 100)).join("\n");
	assert.match(body, /agent#3 Check indents finished · opus medium · 42s/);
	assert.match(body, /code_writer#2 finished/);
	assert.doesNotMatch(body, /code_writer#2 \S+ finished/);
});

it("wait-cards: a finished wait shows one card per delivered result, from details.results[i].display", () => {
	const collapsed = plain(rows(host(WAIT_ARGS, text(details(item(), item({ id: "code_writer#2", text: "Готово.", display: { id: "code_writer#2", outcome: "failed", seconds: 7.25 } }))), false), 100));
	const body = collapsed.join("\n");
	assert.match(body, /agent#3 finished · opus medium · 42s/);
	assert.match(body, /Проверил отступы\./);
	assert.doesNotMatch(body, /Вторая строка/, "collapsed: the first answer line only");
	assert.match(body, /code_writer#2 failed · 7\.3s/);
	assert.doesNotMatch(body, /"reason"|"delivery"/, "not the JSON");
	assert.deepEqual(WAIT_TOOLS, ["agent", "code_writer", "shell_runner"]);
});

it("wait-originals: Ctrl+O shows the stock result view, byte for byte what Pi draws without this extension", () => {
	const wait = text(details(item()));
	const long = { content: [{ type: "text", text: Array.from({ length: 25 }, (_, i) => `строка ${i + 1}\twith tab \x1b[31mred\x1b[0m`).join("\n") }], details: { reason: "x" } };
	const cases: [string, unknown, { content: unknown; details: unknown }][] = [
		["wait result", WAIT_ARGS, wait],
		["wait alert", WAIT_ARGS, text({ reason: "alert", timed_out: false, results: [], statuses: [{ id: "agent#3", alerts: [{ kind: "long_turn", message: "Still running" }] }] })],
		["alert with result-shaped diagnostics", WAIT_ARGS, text({ reason: "alert", results: [item()] })],
		["target changed", WAIT_ARGS, text({ reason: "target_changed", results: [], changed: [{ id: "agent#3", change: "stopped" }] })],
		["status result", { action: "status", ids: ["agent#3"] }, text({ statuses: [{ id: "agent#3", state: "running" }] })],
		["start result", { action: "start", task: "x" }, { content: [{ type: "text", text: "agent#4 started" }], details: undefined }],
		["25 lines", { action: "status" }, long],
		["empty content", { action: "stop" }, { content: [], details: undefined }],
		["timeout wait without results", WAIT_ARGS, text(details())],
		["wait with receipts only", WAIT_ARGS, text({ reason: "result", results: [], receipts: [{ id: "agent#3", delivered_via: "message" }] })],
		["wait results of the wrong shape", WAIT_ARGS, text({ results: "none" })],
		["wait result with no details", WAIT_ARGS, { content: [{ type: "text", text: "plain" }], details: undefined }],
	];
	for (const [name, args, result] of cases) {
		for (const width of [100, 40, 8]) {
			const ours = rows(host(args, result, true), width);
			const stock = rows(host(args, result, true, true), width);
			assert.deepEqual(ours, stock, `${name} expanded @${width}`);
		}
	}
	// Collapsed, everything that is not a delivered wait result is stock too.
	for (const [name, args, result] of cases.filter(([name]) => name !== "wait result")) {
		for (const width of [100, 40, 8]) assert.deepEqual(rows(host(args, result, false), width), rows(host(args, result, false, true), width), `${name} collapsed @${width}`);
	}
	// The expanded wait result is the original JSON text, not a card.
	assert.match(plain(rows(host(WAIT_ARGS, wait, true), 400)).join("\n"), /"reason":"result"/);
});

it("wait-missing-details: results without display metadata still get a card (id from the item), unknown parts omitted", () => {
	const noDisplay = text(details({ id: "shell_runner#2", run: "1:1", text: "ok", outcome: "completed" }, { run: "1:2", text: "no id", outcome: "completed" }, { id: "agent#9", outcome: "error" }));
	const lines = plain(rows(host(WAIT_ARGS, noDisplay, false), 80));
	const body = lines.join("\n");
	assert.match(body, /shell_runner#2\n\s+ok/, "no status, no model, no seconds");
	assert.doesNotMatch(body, /finished|failed|completed/);
	assert.match(body, /agent\n\s+no id/, "no id at all: the tool name");
	assert.match(body, /agent#9/);
	// Not a delivered answer: no card.
	assert.equal(waitCards("agent", WAIT_ARGS, { details: undefined }), undefined);
	assert.equal(waitCards("agent", WAIT_ARGS, { details: { results: [] } }), undefined);
	assert.equal(waitCards("agent", WAIT_ARGS, { details: { results: [null, 3, "x"] } }), undefined);
	assert.equal(waitCards("agent", { action: "status" }, { details: details(item()) }), undefined, "only a wait call");
	assert.equal(waitCards("agent", undefined, { details: details(item()) }), undefined);
});

it("wait-layering: over another extension's renderers the collapsed wait is the card, everything else is theirs", () => {
	const marker = { render: () => ["INNER"], invalidate() {} };
	const calls: string[] = [];
	const inner = { renderCall: () => marker, renderResult: (_r: unknown, options: { expanded: boolean }) => (calls.push(`result expanded=${options.expanded}`), marker), renderShell: "default" as const };
	const layered = resolve("agent", () => inner as never) as never as typeof inner;
	assert.equal(layered.renderShell, "default", "the inner shell choice and call renderer are kept");
	assert.equal(layered.renderCall, inner.renderCall);
	const context = (args: unknown, over: object = {}) => ({ args, isError: false, ...over }) as never;
	const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t } as never;
	const result = text(details(item())) as never;
	const render = (args: unknown, options: object, over?: object) => layered.renderResult(result, options as never, theme, context(args, over)).render(100);
	assert.match(render(WAIT_ARGS, { expanded: false, isPartial: false }).join("\n"), /agent#3 finished/);
	assert.deepEqual(render(WAIT_ARGS, { expanded: true, isPartial: false }), ["INNER"]);
	assert.deepEqual(render(WAIT_ARGS, { expanded: false, isPartial: true }), ["INNER"]);
	assert.deepEqual(render(WAIT_ARGS, { expanded: false, isPartial: false }, { isError: true }), ["INNER"]);
	assert.deepEqual(render({ action: "status" }, { expanded: false, isPartial: false }), ["INNER"]);
	assert.deepEqual(calls, ["result expanded=true", "result expanded=false", "result expanded=false", "result expanded=false"]);
	// Other tools and unknown renderers pass through untouched.
	assert.equal(resolve("read", () => inner as never), inner);
	assert.equal(resolve("agent", () => undefined), undefined);
	assert.deepEqual(captured.messages, ["agent", "code_writer", "shell_runner", "child_wait", "review"]);
	const self = { ...inner, renderShell: "self" as const };
	assert.equal(resolve("agent", () => self as never)?.renderShell, "self", "a self-shell owner keeps its static shell choice");
});

const identity: CardTheme = { fg: (_c, t) => t, bold: (t) => t };
const ansi: CardTheme = { fg: (_c, t) => `\x1b[31m${t}\x1b[39m`, bold: (t) => `\x1b[1m${t}\x1b[22m` };
/** The collapsed wait result component the extension returns for `result`. */
function card(result: unknown, theme: CardTheme = identity) {
	const layered = resolve("agent", () => DEFINITION as never) as never as { renderResult: (...a: unknown[]) => { render(w: number): string[] } };
	return layered.renderResult(result, { expanded: false, isPartial: false }, theme, { args: WAIT_ARGS, isError: false });
}

it("wait-width-fit: no card row is wider than the width, from 0 to 160", () => {
	const texts = ["Проверил отступы и запустил все тесты, очень длинная строка без конца ".repeat(3), "emoji 🙂🙂🙂 and 工程/🙂 e\u0301e\u0301\twide", "\x1b[31mred\x1b[0m \x1b]8;;http://x\x07link\x1b]8;;\x07 \x1b[2J", "x".repeat(300), ""];
	for (const answer of texts) {
		const result = text(details(item({ text: answer }), item({ id: "shell_runner#4", text: answer, display: { ...DISPLAY, id: "shell_runner#4", outcome: "failed", model: `p/${"m".repeat(80)}`, seconds: 3725 } })));
		for (let width = 0; width <= 160; width++) for (const theme of [identity, ansi]) {
			// The result component itself: Pi's own call row and box are not ours to fit.
			for (const line of card(result, theme).render(width)) {
				assert.ok(visibleWidth(line) <= width, `${width}: ${JSON.stringify(line)}`);
				assert.ok(!/[\r\n\t\u0000]/.test(line) && !/\x1b\[2J|\x1b\]8/.test(line), JSON.stringify(line));
			}
		}
	}
});

it("wait-pure: the stored result is not changed by drawing it", () => {
	const input = text(details(item()));
	const before = structuredClone(input);
	for (const expanded of [false, true]) rows(host(WAIT_ARGS, input, expanded), 80);
	assert.deepEqual(input, before);
	const frozen = JSON.parse(JSON.stringify(input), (_k, v) => (v && typeof v === "object" ? Object.freeze(v) : v));
	assert.doesNotThrow(() => waitCards("agent", WAIT_ARGS, frozen));
});

it("wait-theme: the cards use the supplied theme's semantic colors only", () => {
	const calls = new Set<string>();
	const spy: CardTheme = { fg: (color, t) => (calls.add(color), t), bold: (t) => t };
	const layered = resolve("agent", () => DEFINITION as never) as never as { renderResult: (...a: unknown[]) => { render(w: number): string[] } };
	layered.renderResult(text(details(item(), item({ display: { ...DISPLAY, outcome: "failed" } }))), { expanded: false, isPartial: false }, spy, { args: WAIT_ARGS, isError: false }).render(100);
	assert.deepEqual([...calls].sort(), ["dim", "error", "muted", "success", "thinkingMedium"]);
});
