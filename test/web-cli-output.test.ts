import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { renderReport } from "../cli/web/report.ts";
import { fitOutput, MAX_BYTES, MAX_LINES } from "../cli/web/truncate.ts";
import type { RunOptions, TargetResult } from "../cli/web/types.ts";

const options: RunOptions = { targets: [], mode: "cached", responseLength: "short", search: { model: "gpt-6-sol", effort: "high" } };
const result = (value: string, summary: string, sources: string[] = []): TargetResult => ({
	target: { kind: "query", value }, model: "gpt-6-sol", effort: "high", mode: "cached", responseLength: "short",
	status: "ok", summary, sources: sources.map(url => ({ url, title: `T ${url}` })), citations: [], actions: [], results: [],
});
const failed = (value: string): TargetResult => ({ ...result(value, ""), status: "error", error: { code: "timeout", message: "Timed out." } });
const tmp = () => mkdtempSync(join(tmpdir(), "rqw-web-test-"));

describe("rqw-web macOS development tooling", {
	skip: process.platform !== "darwin" && "Repo-local development tooling is macOS-only by owner rule; Windows support belongs to later package tool-wrapper phase.",
}, () => {
describe("rqw-web report", () => {
	it("lists statuses and source links first, then answers in input order", () => {
		const text = renderReport([result("a", "Answer A", ["https://a.example/x"]), failed("b")], options);
		const index = text.indexOf("## Targets");
		assert.ok(index > 0 && index < text.indexOf("## Results"));
		assert.match(text, /1\. ok - query: a\n {3}- \[T https:\/\/a\.example\/x\]\(https:\/\/a\.example\/x\)\n2\. error \(timeout\) - query: b/);
		assert.match(text, /### 2\. query: b\nError \(timeout\): Timed out\./);
		assert.ok(text.indexOf("### 1.") < text.indexOf("### 2."));
	});

	it("strips terminal escapes and carriage returns and keeps Unicode", () => {
		const text = renderReport([result("q", "ok \u001b[31mred\u001b[0m\r\nПривет \u4e16\u754c", ["https://x.example/a b"])], options);
		assert.equal(text.includes("\u001b"), false);
		assert.equal(text.includes("\r"), false);
		assert.match(text, /Привет 世界/);
		assert.match(text, /\(https:\/\/x\.example\/a%20b\)/);
	});

	it("escapes parentheses so a Wikipedia style URL stays one link destination", () => {
		const text = renderReport([result("q", "s", ["https://en.wikipedia.org/wiki/Pi_(letter)"])], options);
		assert.match(text, /\]\(https:\/\/en\.wikipedia\.org\/wiki\/Pi_%28letter%29\)/);
		assert.equal(text.includes("](https://en.wikipedia.org/wiki/Pi_(letter)"), false);
	});

	it("drops non-http sources and duplicates", () => {
		const text = renderReport([result("q", "s", ["javascript:alert(1)", "https://a.example/", "https://a.example/"])], options);
		assert.equal(text.includes("javascript"), false);
		assert.equal(text.match(/\(https:\/\/a\.example\/\)/g)?.length, 2, "once in the index, once in the body");
	});

	it("splits a line longer than a read can handle", () => {
		const text = renderReport([result("q", "word ".repeat(5000))], options);
		assert.ok(text.split("\n").every(line => line.length <= 8000));
	});
});

describe("rqw-web output limit", () => {
	it("prints a small report unchanged and creates no file", async () => {
		const root = tmp();
		assert.equal(await fitOutput("small\n", root), "small\n");
	});

	it("cuts by lines and gives the exact read offset into the saved full report", async () => {
		const root = tmp();
		const report = Array.from({ length: 5000 }, (_, index) => `line ${index + 1}`).join("\n") + "\n";
		const out = await fitOutput(report, root);
		const lines = out.replace(/\n$/, "").split("\n");
		assert.ok(lines.length <= MAX_LINES);
		const match = /Full result: (\S+)\]\n\[Continue with: read \1 offset=(\d+)\]\n$/.exec(out)!;
		assert.ok(match);
		const shown = Number(match[2]) - 1;
		assert.equal(lines[shown - 1], `line ${shown}`);
		const full = readFileSync(match[1], "utf8");
		assert.equal(full, report);
		assert.equal(full.split("\n")[shown], `line ${shown + 1}`, "offset points at the first unseen line");
		assert.equal(statSync(match[1]).mode & 0o077, 0, "file is private");
	});

	it("cuts by bytes with multibyte text and stays under the cap", async () => {
		const root = tmp();
		const report = Array.from({ length: 1500 }, () => "Привет мир ".repeat(8)).join("\n") + "\n";
		const out = await fitOutput(report, root);
		assert.ok(Buffer.byteLength(out) <= MAX_BYTES);
		assert.match(out, /offset=\d+\]\n$/);
	});

	it("keeps statuses and source links of every target when the first answer is huge", async () => {
		const root = tmp();
		const huge = Array.from({ length: 6000 }, (_, index) => `para ${index}`).join("\n");
		const text = renderReport([result("first", huge, ["https://a.example/"]), result("second", "short", ["https://b.example/"]), failed("third")], options);
		const out = await fitOutput(text, root);
		for (const needle of ["1. ok - query: first", "2. ok - query: second", "3. error (timeout) - query: third", "https://b.example/"]) {
			assert.ok(out.includes(needle), needle);
		}
	});
});

});
