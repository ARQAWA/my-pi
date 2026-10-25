import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import { themePaint } from "../../../extensions/RQW-statusbar/index.ts";
import { effortText, modelRow, type Role } from "../../../extensions/RQW-statusbar/render.ts";

const { loadThemeFromPath } = await import(new URL("./modes/interactive/theme/theme.js",
	import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const asset = fileURLToPath(new URL("./effort-theme.json", import.meta.url));
const levels = { off: "no", minimal: "min", low: "lo", medium: "md", high: "hi", xhigh: "xh", max: "mx" } as const;
const tokens = { off: "thinkingOff", minimal: "thinkingMinimal", low: "thinkingLow", medium: "thinkingMedium",
	high: "thinkingHigh", xhigh: "thinkingXhigh", max: "thinkingMax" } as const;

it("every footer effort exactly uses Pi's native resolver and picker thinking role in both colour modes", () => {
	for (const mode of ["truecolor", "256color"] as const) {
		const theme: Theme = loadThemeFromPath(asset, mode);
		const paint = themePaint(theme);
		for (const [level, label] of Object.entries(levels)) {
			const key = level as keyof typeof levels;
			const native = theme.getThinkingBorderColor(key)(label);
			assert.equal(native, theme.fg(tokens[key], label));
			const expected = ["medium", "high", "xhigh", "max"].includes(level) ? `\x1b[1m${native}\x1b[22m` : native;
			assert.equal(effortText(level, label, paint), expected, `${mode}/${level}`);
			const row = modelRow({ model: { id: "fixture", name: "Fixture", reasoning: true }, thinkingLevel: level,
				compactions: 0, place: { kind: "folder", text: "x" }, statuses: [] }, 100, paint);
			const left = ` ${theme.fg("text", "\uec19 Fixture")} ${expected}`;
			assert.equal(row, left + " ".repeat(100 - " \uec19 Fixture ".length - label.length - 5) + theme.fg("muted", "cmp 0"));
		}
		assert.equal(effortText(undefined, "no", paint), theme.getThinkingBorderColor("off")("no"));
	}
});

it("effort paint calls the supplied theme's native resolver, not a cached palette", () => {
	const theme: Theme = loadThemeFromPath(asset, "truecolor");
	const calls: string[] = [];
	const native = theme.getThinkingBorderColor.bind(theme);
	theme.getThinkingBorderColor = (level) => { calls.push(level); return native(level); };
	const paint = themePaint(theme);
	for (const level of Object.keys(levels)) paint("effort", "label", level);
	assert.deepEqual(calls, Object.keys(levels));
	assert.equal(paint("effort", "lo", "low"), "\x1b[38;2;128;255;196mlo\x1b[39m");
	assert.equal(paint("effort", "md", "medium"), "\x1b[38;2;0;223;119mmd\x1b[39m");
});

it("all non-effort footer roles retain their native theme colours", () => {
	const theme: Theme = loadThemeFromPath(asset, "truecolor");
	const roles: Record<Exclude<Role, "effort">, ThemeColor> = {
		bar: "text", barEmpty: "dim", label: "muted", model: "text", path: "text",
		gitClean: "success", gitDirty: "warning", staged: "success", unstaged: "warning",
		untracked: "muted", sep: "dim", info: "muted",
	};
	for (const [role, token] of Object.entries(roles)) {
		assert.equal(themePaint(theme)(role as Role, "unchanged"), theme.fg(token, "unchanged"));
	}
});
