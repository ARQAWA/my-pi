// Shared deterministic fixtures for RQW-tool-ui tests: width sweep, wide and styled samples, theme painters
// and a fixed clock. Public Pi/pi-tui exports only; nothing from another extension folder.
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

export const WIDTHS: readonly number[] = Array.from({ length: 161 }, (_, i) => i);

/** Every physical line `render(width)` returns fits `width` columns and holds no line break, for every width. */
export function assertFits(render: (width: number) => string | readonly string[], widths: readonly number[] = WIDTHS): void {
	for (const width of widths) {
		const out = render(width);
		for (const line of typeof out === "string" ? [out] : out) {
			assert.ok(!/[\r\n]/.test(line), `width ${width}: embedded line break in ${JSON.stringify(line)}`);
			assert.ok(visibleWidth(line) <= width, `width ${width}: ${visibleWidth(line)} columns in ${JSON.stringify(line)}`);
		}
	}
}

/** Text that is hard to fit: wide, combining, styled, tabbed, very long. */
export const SAMPLES = {
	cyrillic: "Привет, мир: проверка ширины строки",
	emoji: "deploy 🚀 done ✅ 👩‍💻 ok",
	cjk: "工程目录/测试文件名称.ts",
	combining: "e\u0301te\u0301 cafe\u0301 n\u0303",
	tabs: "a\tb\t\tc",
	ansi: "\x1b[31mred\x1b[0m \x1b[1;32mbold green\x1b[0m",
	longPath: `/Users/someone/${"very-long-directory-name/".repeat(12)}файл-🙂.ts`,
	longCommand: `npm run build && ${"node --test extensions/RQW-tool-ui/test/*.test.ts ".repeat(6)}| tail -n 40`,
} as const;

/** A supplied theme that paints nothing: plain text for snapshots. */
export const identityTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
	inverse: (text: string) => text,
	strikethrough: (text: string) => text,
} as unknown as Theme;

/** A supplied theme with a distinct SGR color per role, to prove styling is re-derived from the theme given. */
export function coloredTheme(seed = 0): Theme {
	const code = (role: string) => 16 + ((seed * 31 + [...role].reduce((h, c) => (h * 33 + c.codePointAt(0)!) % 216, 7)) % 216);
	return {
		fg: (color: string, text: string) => `\x1b[38;5;${code(color)}m${text}\x1b[39m`,
		bg: (color: string, text: string) => `\x1b[48;5;${code(color)}m${text}\x1b[49m`,
		bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
		italic: (text: string) => `\x1b[3m${text}\x1b[23m`,
		underline: (text: string) => `\x1b[4m${text}\x1b[24m`,
		inverse: (text: string) => `\x1b[7m${text}\x1b[27m`,
		strikethrough: (text: string) => `\x1b[9m${text}\x1b[29m`,
	} as unknown as Theme;
}

/** Fixes `Date` at `now` for this test only; node:test restores the real clock when the test ends. */
export function fixedClock(t: TestContext, now = Date.UTC(2026, 0, 2, 3, 4, 5)): number {
	t.mock.timers.enable({ apis: ["Date"], now });
	return now;
}

/** Deep-freezes a fixture so a classifier that mutates its input throws. */
export function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const v of Object.values(value)) deepFreeze(v);
	}
	return value;
}
