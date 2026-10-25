// The shared fixtures themselves: the width sweep catches over-wide output, the extension folder imports only
// itself and public Pi/pi-tui exports, and the fixed clock does not outlive its test.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { assertFits, coloredTheme, fixedClock, identityTheme, SAMPLES } from "./harness.ts";

const FOLDER = join(dirname(fileURLToPath(import.meta.url)), "../../../extensions/RQW-tool-ui");

/** A local dummy component: every sample on its own row, styled, cut to the width. */
const dummy = (width: number) =>
	Object.values(SAMPLES).map((s) => truncateToWidth(coloredTheme().fg("muted", s.replace(/\t/g, "   ")), width));

it("fixture-width-fit", () => {
	assertFits(dummy);
	assertFits((width) => truncateToWidth(identityTheme.fg("muted", SAMPLES.cjk), width));
	assert.throws(() => assertFits((width) => SAMPLES.cjk.slice(0, width + 1)), /columns/, "over-wide output fails");
	assert.throws(() => assertFits(() => ["a\nb"], [5]), /line break/, "an embedded newline fails");
	assert.throws(() => assertFits(() => [SAMPLES.emoji], [3]), /columns/);
	assert.notEqual(coloredTheme(0).fg("muted", "x"), coloredTheme(1).fg("muted", "x"), "colored painters differ by seed");
	assert.notEqual(coloredTheme().fg("muted", "x"), coloredTheme().fg("error", "x"), "colored painter differs by role");
});

it("fixture-isolation", () => {
	const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
		d.isDirectory() ? files(join(dir, d.name)) : /\.(m?[jt]s)$/.test(d.name) ? [join(dir, d.name)] : []);
	const allowed = /^(?:node:[a-z_/]+|@earendil-works\/(?:pi-coding-agent|pi-tui|pi-ai))$/;
	const bad: string[] = [];
	for (const file of [...files(FOLDER), ...files(import.meta.dirname)]) {
		const text = readFileSync(file, "utf8");
		for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)) {
			const spec = m[1];
			if (spec.startsWith(".")) {
				if (![FOLDER, import.meta.dirname].some((folder) => resolve(dirname(file), spec).startsWith(folder + sep))) bad.push(`${file}: ${spec}`);
			} else if (!allowed.test(spec)) bad.push(`${file}: ${spec}`);
		}
		if (/import\.meta\.resolve|\/dist\//.test(text.replace(/\/\/.*$/gm, ""))) bad.push(`${file}: deep or resolved import`);
	}
	assert.deepEqual(bad, []);
});

let fixed = 0;
it("fixed-clock-restored", async (t) => {
	await t.test("fixed inside the test", (st) => {
		fixed = fixedClock(st);
		assert.equal(Date.now(), fixed);
		assert.equal(new Date().getTime(), fixed);
	});
	await t.test("real again after it", () => {
		assert.notEqual(Date.now(), fixed);
		assert.ok(Math.abs(Date.now() - performance.timeOrigin - performance.now()) < 60_000, "Date follows the real clock");
	});
});
