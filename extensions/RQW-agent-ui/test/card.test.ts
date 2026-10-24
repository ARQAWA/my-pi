import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CARD_TYPES, type CardTheme, createAgentCard, formatSeconds, shortModel } from "../card.ts";
import { clean, wrap } from "../fit.ts";

const identity: CardTheme = { fg: (_color, text) => text, bold: (text) => text };
/** Marks every paint, so a test sees which semantic color was asked for. */
const tagged: CardTheme = { fg: (color, text) => `<${color}>${text}</${color}>`, bold: (text) => `*${text}*` };
const ansi: CardTheme = { fg: (_color, text) => `\x1b[31m${text}\x1b[39m`, bold: (text) => `\x1b[1m${text}\x1b[22m` };

type Message = Parameters<typeof createAgentCard>[0];
function message(customType: string, content: unknown, details?: unknown): Message {
	return { role: "custom", customType, content: content as string, display: true, details, timestamp: 0 } as Message;
}
function render(m: Message, width: number, expanded = false, theme: CardTheme = identity): string[] {
	const component = createAgentCard(m, { expanded, outputPad: 0 }, theme as never);
	assert.ok(component, `${m.customType} gets a card`);
	return component.render(width);
}
const details = { delivery: "d-4", run: "1:1", id: "agent#3", outcome: "finished", model: "anthropic/claude-opus-5-5", thinking: "medium", seconds: 42,
	prompt_file: { kind: "role", path: "/tmp/agent-role.md", sha256: "a".repeat(64) } };

it("card-collapsed: a muted status line with model, effort and seconds, then the first nonempty answer line", () => {
	assert.deepEqual(render(message("agent", "[agent#3] \n\nПроверил отступы.\nВторая строка.", details), 80),
		["agent#3 finished · opus medium · 42s", "  Проверил отступы."]);
	assert.deepEqual(render(message("agent", "[agent#3] Done", { ...details, seconds: 12.34, model: "openai-codex/gpt-6.1-sol", thinking: "xhigh" }), 80),
		["agent#3 finished · gpt-6.1-sol xhigh · 12.3s", "  Done"]);
	const long = render(message("agent", `[agent#3] ${"очень длинный ответ ".repeat(10)}`, details), 40);
	assert.equal(long.length, 2);
	assert.ok(stripVTControlCharacters(long[1]).endsWith("…") && visibleWidth(long[1]) <= 40, long[1]);
	assert.deepEqual(render(message("agent", "[agent#3] ", details), 80), ["agent#3 finished · opus medium · 42s"], "no answer, no second row");
	assert.equal(formatSeconds(65), "1m 05s");
	assert.equal(formatSeconds(0.04), "0s");
	assert.equal(shortModel("anthropic/claude-sonnet-5-5"), "sonnet");
	assert.equal(shortModel("gpt-6.1-sol"), "gpt-6.1-sol");
});

it("card-expanded-full-text: the whole original text, wrapped, nothing added or lost", () => {
	const text = "Первая строка с длинным русским текстом, который не помещается.\n\n  отступ и [скобки] внутри\nNEXT: 1. сделать\n\n";
	for (const width of [80, 30, 12, 8, 7, 2, 1]) {
		const rows = render(message("agent", `[agent#3] ${text}`, details), width, true);
		const indent = width >= 8 ? 2 : 0;
		const body = rows.slice(1).map((row) => row.slice(indent)).join("");
		assert.equal(body, text.replace(/\n/g, ""), `${width}: wrapped rows rejoin to the original text`);
	}
	const wide = render(message("agent", `[agent#3] ${text}`, details), 80, true);
	assert.deepEqual(wide, ["agent#3 finished · opus medium · 42s",
		"  Первая строка с длинным русским текстом, который не помещается.", "", "    отступ и [скобки] внутри", "  NEXT: 1. сделать", "", ""]);
	assert.deepEqual(wrap("aaaa bbbb cccc", 9), ["aaaa ", "bbbb cccc"]);
	assert.equal(wrap("abcdefgh", 3).join(""), "abcdefgh");
});

it("card-missing-details: the id comes from the prefix, unknown parts are left out", () => {
	assert.deepEqual(render(message("agent", "[agent#2] ok"), 80), ["agent#2", "  ok"]);
	assert.deepEqual(render(message("agent", "[agent#9] ok", {}), 80), ["agent#9", "  ok"]);
	assert.deepEqual(render(message("agent", "[agent#9] ok", { delivery: 1, run: "1:1" }), 80), ["agent#9", "  ok"]);
	assert.deepEqual(render(message("agent", "[agent#9] ok", { outcome: "failed" }), 80), ["agent#9 failed", "  ok"]);
	assert.deepEqual(render(message("agent", "[agent#9] ok", { thinking: "high" }), 80), ["agent#9 · high", "  ok"]);
	assert.deepEqual(render(message("agent", "[agent#9] ok", { model: "x/y" }), 80), ["agent#9 · y", "  ok"]);
	assert.deepEqual(render(message("agent", "[agent#9] ok", { seconds: 3 }), 80), ["agent#9 · 3s", "  ok"]);
	// Unusable values are unknown, not shown.
	assert.deepEqual(render(message("agent", "[agent#9] ok", { outcome: "weird", seconds: -1, model: 5, thinking: {} }), 80), ["agent#9", "  ok"]);
	assert.deepEqual(render(message("agent", "[agent#9] ok", { seconds: Number.NaN }), 80), ["agent#9", "  ok"]);
	assert.deepEqual(render(message("agent", "[agent#9] ok", null), 80), ["agent#9", "  ok"]);
	// No prefix: the id from details, else the message type; the text is all body.
	assert.deepEqual(render(message("agent", "plain answer", { id: "agent#5" }), 80), ["agent#5", "  plain answer"]);
	assert.deepEqual(render(message("agent", "plain answer"), 80), ["agent", "  plain answer"]);
	assert.deepEqual(render(message("agent", [{ type: "text", text: "[agent#2] from parts" }]), 80), ["agent#2", "  from parts"]);
	assert.deepEqual(render(message("agent", undefined), 80), ["agent"]);
});

it("card-prefix-only: just the outer prefix is removed, inner brackets stay", () => {
	assert.deepEqual(render(message("agent", "[agent#1] see [agent#2] and [x] [y]"), 80, true),
		["agent#1", "  see [agent#2] and [x] [y]"]);
	assert.deepEqual(render(message("agent", "[agent#1] [review#3] CLEAN"), 80, true), ["agent#1", "  [review#3] CLEAN"]);
	assert.deepEqual(render(message("agent", "[agent#1][x]"), 80, true), ["agent#1", "  [x]"]);
	// Another type's prefix, or one that does not start the text, is not ours.
	assert.deepEqual(render(message("agent", "[review#1] hi"), 80, true), ["agent", "  [review#1] hi"]);
	assert.deepEqual(render(message("agent", "x [agent#1] hi"), 80, true), ["agent", "  x [agent#1] hi"]);
	assert.deepEqual(render(message("agent", "[agent#1]\nsecond"), 80, true), ["agent#1", "", "  second"], "only a following space belongs to the prefix");
});

it("card-agent-type: agent messages get cards; other types are left to Pi", () => {
	assert.deepEqual([...CARD_TYPES], ["agent"]);
	for (const type of CARD_TYPES) {
		assert.deepEqual(render(message(type, `[${type}#2] done`, { outcome: "finished", seconds: 1 }), 80), [`${type}#2 finished · 1s`, "  done"]);
	}
	for (const type of ["review", "child_wait", "custom", "agent2", ""]) {
		assert.equal(createAgentCard(message(type, `[${type}#2] x`), { expanded: false, outputPad: 1 }, identity as never), undefined);
	}
});

it("card-width-fit: no row is wider than the width, from 0 to 160", () => {
	const texts = [
		"Проверил отступы и запустил все тесты, результат ниже, очень длинная строка без конца ".repeat(3),
		"emoji 🙂🙂🙂 and 工程/🙂 e\u0301e\u0301 wide\tcols\ttabs",
		"\x1b[31mred\x1b[0m and \x1b]8;;http://x\x07link\x1b]8;;\x07 and \x1b[2Jclear",
		"x".repeat(300),
		"line\r\nwith\rcarriage\u0000controls",
		"",
	];
	const detailsSets = [details, { ...details, outcome: "failed", model: "p/" + "m".repeat(80), thinking: "max", seconds: 3725 }, undefined];
	for (const theme of [identity, ansi]) {
		for (const text of texts) {
			for (const d of detailsSets) {
				for (const expanded of [false, true]) {
					for (let width = 0; width <= 160; width++) {
						for (const row of render(message("agent", `[agent#12] ${text}`, d), width, expanded, theme)) {
							assert.ok(visibleWidth(row) <= width, `${width}: ${JSON.stringify(row)}`);
							assert.ok(!/[\r\n\t\u0000]/.test(row), JSON.stringify(row));
							assert.ok(!/\x1b\[2J|\x1b\]8/.test(row), "no foreign terminal sequence reaches the screen");
						}
					}
				}
			}
		}
	}
	assert.equal(clean("a\tb\x1b[1mc\x1b[0m\r\nd"), "a    bc\nd");
});

it("card-theme: only supplied semantic colors, failed in error, effort levels colored", () => {
	const rows = (extra: object, expanded = false) => render(message("agent", "[agent#3] answer", { ...details, ...extra }), 400, expanded, tagged);
	assert.deepEqual(rows({}), [
		"<muted>agent#3</muted><muted> </muted><success>finished</success><dim> · </dim><dim>opus</dim><dim> </dim>*<thinkingMedium>medium</thinkingMedium>*<dim> · </dim><dim>42s</dim>",
		"  <muted>answer</muted>",
	]);
	const failed = rows({ outcome: "failed" });
	assert.match(failed[0], /<error>failed<\/error>/);
	assert.equal(failed[1], "  <error>answer</error>");
	assert.equal(rows({ outcome: "failed" }, true)[1], "  <error>answer</error>");
	assert.match(rows({})[0], /<success>finished<\/success>/);
	assert.doesNotMatch(rows({ outcome: undefined })[0], /finished|failed/, "no outcome: no status");
	const effort = (thinking: string) => rows({ thinking })[0].match(/<dim> <\/dim>(.*?)<dim> · <\/dim>/)![1];
	assert.equal(effort("low"), "<thinkingLow>low</thinkingLow>");
	assert.equal(effort("medium"), "*<thinkingMedium>medium</thinkingMedium>*");
	assert.equal(effort("high"), "*<thinkingHigh>high</thinkingHigh>*");
	assert.equal(effort("xhigh"), "*<thinkingXhigh>xhigh</thinkingXhigh>*");
	assert.equal(effort("max"), "*<thinkingMax>max</thinkingMax>*");
	assert.equal(effort("minimal"), "<thinkingLow>minimal</thinkingLow>");
	assert.equal(effort("off"), "<thinkingLow>off</thinkingLow>");
	// Nothing is painted outside the supplied theme.
	const calls: string[] = [];
	const spy: CardTheme = { fg: (color, text) => (calls.push(color), text), bold: (text) => text };
	render(message("agent", "[agent#3] answer", { ...details, outcome: "failed", thinking: "high" }), 100, true, spy);
	assert.ok(calls.length > 0 && calls.every((color) => ["muted", "dim", "error", "success", "thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh", "thinkingMax"].includes(color)), calls.join());
	for (const row of render(message("agent", "[agent#3] answer", details), 100, true, identity)) assert.ok(!row.includes("\x1b"), "identity theme: no own paint");
});

it("card-theme-real: Pi 1.4.0's Theme accepts the five thinking tokens in fg() and gives each its own color", () => {
	const schema = JSON.parse(readFileSync(new URL("../../../node_modules/@earendil-works/pi-coding-agent/schemas/theme.schema.json", import.meta.url), "utf8"));
	const keys = Object.keys(schema.properties.colors.properties);
	const colors: Record<string, string> = {};
	keys.forEach((key, index) => (colors[key] = `#${(index + 16).toString(16).padStart(2, "0").repeat(3)}`));
	const real = new Theme(colors as never, colors as never, "truecolor");
	const levels = ["low", "medium", "high", "xhigh", "max"];
	const painted = levels.map((level) => render(message("agent", "[agent#3] ok", { thinking: level }), 80, false, real as never)[0]);
	assert.equal(new Set(painted.map((row) => row.match(/\x1b\[38;2;[\d;]+m(?=\w+\x1b\[39m$)/)?.[0])).size, levels.length, painted.join("|"));
	for (const [index, row] of painted.entries()) assert.equal(stripVTControlCharacters(row), `agent#3 · ${levels[index]}`);
});

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object") for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

it("card-pure: the stored message is not changed and rendering is repeatable", () => {
	const input = message("agent", "[agent#3] Первая строка\nВторая [x]", { ...details });
	const before = structuredClone(input);
	const frozen = deepFreeze(structuredClone(input));
	for (const expanded of [false, true]) {
		const component = createAgentCard(frozen, { expanded, outputPad: 0 }, tagged as never)!;
		const first = component.render(40);
		assert.deepEqual(component.render(40), first);
		component.invalidate();
		assert.deepEqual(component.render(40), first);
		assert.deepEqual(render(input, 40, expanded, tagged), first);
	}
	assert.deepEqual(input, before);
	assert.deepEqual(frozen, before);
});

it("card-title: details.title follows the id, fitted to the width before the status; no title, no change", () => {
	const titled = { ...details, title: "Find the  flaky\ttest" };
	assert.deepEqual(render(message("agent", "[agent#3] Done", titled), 80),
		["agent#3 Find the flaky test finished · opus medium · 42s", "  Done"], "one line, whitespace collapsed");
	assert.deepEqual(render(message("agent", "[agent#3] Done", titled), 400, false, tagged)[0],
		"<muted>agent#3</muted><muted> </muted><muted>Find the flaky test</muted><muted> </muted><success>finished</success><dim> · </dim><dim>opus</dim><dim> </dim>*<thinkingMedium>medium</thinkingMedium>*<dim> · </dim><dim>42s</dim>");
	// Narrow: the title is cut with "…" and the status stays whole.
	const narrow = stripVTControlCharacters(render(message("agent", "[agent#3] Done", titled), 46)[0]);
	assert.ok(narrow.endsWith(" finished · opus medium · 42s"), narrow);
	assert.match(narrow, /^agent#3 Find.*… finished/);
	assert.ok(visibleWidth(narrow) <= 46);
	// No room for even two cells of title: it is left out and the rest fits as before.
	assert.equal(render(message("agent", "[agent#3] Done", titled), 38)[0], "agent#3 finished · opus medium · 42s");
	for (const width of [1, 5, 10, 20, 30]) assert.ok(visibleWidth(render(message("agent", "[agent#3] Done", titled), width)[0]) <= width, `${width}`);
	// Missing, empty or unusable titles change nothing.
	for (const title of [undefined, "", "   ", 5, {}, null]) {
		assert.deepEqual(render(message("agent", "[agent#3] Done", { ...details, title }), 80), ["agent#3 finished · opus medium · 42s", "  Done"], String(title));
	}
	assert.deepEqual(render(message("agent", "[agent#1] ok", { title: "Run tests" }), 80), ["agent#1 Run tests", "  ok"]);
	assert.deepEqual(render(message("agent", "[agent#3] Done", { ...titled, title: "\x1b[31mred\x1b[0m title" }), 80)[0], "agent#3 red title finished · opus medium · 42s", "terminal sequences removed");
});

/** Pi's output padding is one cell: the card sits inside it, the same as the text blocks around it. */
function padded(m: Message, width: number, expanded: boolean): string[] {
	const component = createAgentCard(m, { expanded, outputPad: 1 }, identity as never);
	assert.ok(component);
	return component.render(width);
}

it("card-padding: header and body keep one free cell at both sides, collapsed and expanded", () => {
	const long = `${"очень длинный ответ ".repeat(8)}конец`;
	for (const expanded of [false, true]) {
		const rows = padded(message("agent", `[agent#3] ${long}\nвторая строка`, details), 60, expanded);
		assert.ok(rows[0].startsWith(" agent#3 finished") && !rows[0].startsWith("  "), `header: one space, ${JSON.stringify(rows[0])}`);
		assert.ok(rows[1].startsWith("   ") && !rows[1].startsWith("    "), `body: the pad plus the two-cell indent, ${JSON.stringify(rows[1])}`);
		for (const row of rows) assert.ok(visibleWidth(row) <= 59, `a free cell stays at the right edge: ${visibleWidth(row)} ${row}`);
	}
	// The wrapping works on the narrower width and still rejoins to the original text.
	const rows = padded(message("agent", `[agent#3] ${long}`, details), 40, true);
	assert.equal(rows.slice(1).map((row) => row.slice(3)).join(""), long);
	// The same layout, shifted by the padding.
	assert.deepEqual(padded(message("agent", "[agent#3] Done", details), 80, false), [" agent#3 finished · opus medium · 42s", "   Done"]);
});

it("card-padding-narrow: widths at or below the padding draw as before, down to zero", () => {
	for (const width of [0, 1, 2, 3, 4]) {
		const rows = padded(message("agent", "[agent#3] Done", details), width, true);
		for (const row of rows) assert.ok(visibleWidth(row) <= width, `${width}: ${row}`);
		if (width === 0) assert.deepEqual(rows, []);
	}
});

it("card-markdown-snippet: the collapsed line shows no ** or backtick wrappers, the expanded text is the original", () => {
	const answer = "**Микрофикс доставлен в `main`: `ddc6b9e`.**\nВторая строка с `кодом`.";
	assert.deepEqual(render(message("agent", `[agent#3] ${answer}`, details), 80), ["agent#3 finished · opus medium · 42s", "  Микрофикс доставлен в main: ddc6b9e."]);
	const expanded = render(message("agent", `[agent#3] ${answer}`, details), 80, true).slice(1).map((row) => row.trim());
	assert.deepEqual(expanded, answer.split("\n"), "the original source is kept in full");
	// Meaningful source characters that are not wrappers stay, and a list marker stays.
	assert.equal(render(message("agent", "[agent#3] 1. путь [a] <b> snake_case_name 2 * 3", details), 80)[1], "  1. путь [a] <b> snake_case_name 2 * 3");
	// The colour of the line is kept, a failed answer stays an error.
	const failed = render(message("agent", "[agent#3] **error: `x` не найден**", { ...details, outcome: "failed" }), 80, false, tagged);
	assert.match(failed[1], /<error>error: <\/error>/);
	assert.doesNotMatch(failed[1], /\*\*|`/);
	assert.ok(visibleWidth(stripVTControlCharacters(render(message("agent", `[agent#3] **${"ш".repeat(200)}**`, details), 30)[1])) <= 30);
});

it("card-markdown-constructs: a construct over several lines is seen whole, nothing is silently dropped, styles are kept", () => {
	const row = (answer: string, theme: CardTheme = identity) => render(message("agent", `[agent#3] ${answer}`, details), 200, false, theme)[1];
	assert.equal(row("**первая\nвторая**"), "  первая", "bold over two lines: its first row, no leftover wrapper");
	assert.equal(row("[result]: /tmp/report.json"), "  [result]: /tmp/report.json", "a line Markdown would swallow stays as its source");
	assert.equal(row("   \n\n  [result]: /tmp/report.json\n\nвторой блок"), "  [result]: /tmp/report.json");
	// Real styling for strikethrough and italic when the theme has it; the real Pi Theme does.
	const styled = { ...identity, strikethrough: (text: string) => `\x1b[9m${text}\x1b[29m`, italic: (text: string) => `\x1b[3m${text}\x1b[23m` };
	const line = row("~~old~~ *new*", styled);
	assert.ok(line.includes("\x1b[9mold\x1b[29m") && line.includes("\x1b[3mnew\x1b[23m"), JSON.stringify(line));
	assert.equal(stripVTControlCharacters(line), "  old new");
	// Markdown can render more or less text than the source has (a reference link may show its URL): the row is complete
	// or cut by the card with an ellipsis, never wrapped early and silently shortened.
	const links = `${"[x][r] ".repeat(10)}\n[r]: https://example.com/report.json`;
	const linkRow = stripVTControlCharacters(row(links));
	assert.ok(linkRow.trim() === "[x][r] ".repeat(10).trim() || linkRow.endsWith("…") || linkRow.includes("report.json"), linkRow);
	assert.ok(visibleWidth(linkRow) <= 200);
	// A long first block is cut by the card, not by the renderer.
	assert.ok(visibleWidth(stripVTControlCharacters(row(`**${"ш ".repeat(3000)}**`))) <= 200);
});
