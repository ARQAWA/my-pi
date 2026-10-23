import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createEditToolDefinition, createWriteToolDefinition, generateDiffString, generateUnifiedPatch } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { classifyChange, contentLines, countDiff, countPatch } from "../changes.ts";
import { assertFits, deepFreeze, SAMPLES } from "./harness.ts";

const ctx = { toolCallId: "call-1", isPartial: false, isError: false };
const text = (t: string) => [{ type: "text", text: t }];
const OLD = "one\ntwo\n--flag\nthree\nfour\nfive\nsix\nseven\neight\nnine\n";
const NEW = "one\nTWO\n++plus\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n";
// Pi's own fixtures: 2 lines removed (two, --flag), 3 added (TWO, ++plus, ten), with headers and context around.
const piDetails = (path = "a.ts") => ({ diff: generateDiffString(OLD, NEW).diff, patch: generateUnifiedPatch(path, OLD, NEW) });

const tmp = mkdtempSync(join(tmpdir(), "rqw-tool-ui-changes-"));
after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe("classifyChange", () => {
	it("edit-single", async () => {
		// A real stock edit, executed by Pi's own tool definition in a temporary folder.
		writeFileSync(join(tmp, "a.ts"), OLD);
		const args = { path: "a.ts", edits: [{ oldText: "two\n--flag\n", newText: "TWO\n++plus\n" }, { oldText: "nine\n", newText: "nine\nten\n" }] };
		const result = await createEditToolDefinition(tmp).execute("call-1", args as never, undefined, undefined, {} as never);
		const r = classifyChange("edit", args, result, { ...ctx, cwd: tmp });
		const key = `${tmp.replace(/\\/g, "/")}/a.ts`.replace(/^([a-z]):/, (d) => d.toUpperCase());
		assert.deepEqual(r, { kind: "edit", target: "edit a.ts", status: "done", countKey: key, countKeys: [key], outputText: result.content.map((c) => (c as { text: string }).text).join("\n"),
			files: [{ path: "a.ts", status: "done", countKey: key, added: 3, removed: 2 }] });
		const running = classifyChange("edit", args, undefined, ctx);
		assert.deepEqual([running.status, running.files], ["running", [{ path: "a.ts", status: "running", countKey: "a.ts" }]]);
	});

	it("edit-multi-files", () => {
		const args = { path: "top.ts", edits: [{ path: "b.ts", oldText: "x", newText: "y" }, { oldText: "p", newText: "q" }, { path: "b.ts", oldText: "z", newText: "w" },
			{ path: "c.ts", oldText: "1", newText: "2" }, { path: "./b.ts", oldText: "3", newText: "4" }] };
		const r = classifyChange("edit", args, undefined, ctx);
		assert.deepEqual(r.files.map((f) => f.path), ["b.ts", "top.ts", "c.ts"], "first-seen order with top-level fallback, each file once");
		assert.deepEqual(r.countKeys, ["b.ts", "top.ts", "c.ts"], "the same file under two spellings counts once");
		assert.equal(r.target, "edit b.ts +2 more");
		assert.deepEqual(classifyChange("edit", { path: "only.ts", edits: [{ oldText: "a", newText: "b" }] }, undefined, ctx).countKeys, ["only.ts"], "stock args.path");
		assert.equal(classifyChange("edit", { edits: [{ oldText: "a", newText: "b" }] }, undefined, ctx).target, "edit", "no path yet");
	});

	it("edit-aliases-dedupe-per-platform", () => {
		// Windows: the same file under shell, drive-letter and separator spellings, relative to a shell-form cwd, is one file.
		const win = { ...ctx, cwd: "/c/work" };
		const edits = [{ oldText: "a", newText: "b" }];
		const r = classifyChange("edit", { edits: [{ path: "/c/work/a.ts", oldText: "x", newText: "y" }, { path: "C:\\work\\a.ts", oldText: "x", newText: "y" },
			{ path: "/mnt/c/work/./a.ts", oldText: "x", newText: "y" }, { path: "..\\work\\a.ts", oldText: "x", newText: "y" }, { path: "b.ts", oldText: "x", newText: "y" }] }, undefined, win, "win32");
		assert.deepEqual(r.countKeys, ["C:/work/a.ts", "C:/work/b.ts"], "every alias of one file counts once");
		assert.deepEqual(r.files.map((f) => f.path), ["/c/work/a.ts", "b.ts"], "first spelling kept");
		assert.equal(r.target, "edit /c/work/a.ts +1 more");
		// The write form dedupes the same way.
		const w = classifyChange("write", { files: [{ path: "/c/work/n.ts", content: "1\n" }, { path: "C:/work/n.ts", content: "2\n" }] }, undefined, win, "win32");
		assert.deepEqual(w.countKeys, ["C:/work/n.ts"]);
		// POSIX: a backslash is a name character, so the two spellings are two files.
		const posix = classifyChange("edit", { edits: [{ path: "a\\b.ts", oldText: "x", newText: "y" }, { path: "a/b.ts", oldText: "x", newText: "y" }, { path: "./a/b.ts", oldText: "x", newText: "y" }] },
			undefined, { ...ctx, cwd: "/w" }, "linux");
		assert.deepEqual(posix.countKeys, ["/w/a\\b.ts", "/w/a/b.ts"]);
		assert.equal(classifyChange("edit", { edits }, undefined, { ...ctx, cwd: "/w" }, "linux").countKeys.length, 0, "no path yet");
	});

	it("edit-counts-from-details", () => {
		assert.deepEqual(countPatch(piDetails().patch), { added: 3, removed: 2 }, "patch: ---/+++ headers, @@ and context excluded, -- and ++ content counted");
		assert.deepEqual(countDiff(piDetails().diff), { added: 3, removed: 2 }, "display diff: context and ... excluded");
		const withHeaders = `diff --git a/a.ts b/a.ts\nindex 1..2 100644\n${piDetails().patch}\\ No newline at end of file\n`;
		assert.deepEqual(countPatch(withHeaders), { added: 3, removed: 2 });
		const stock = classifyChange("edit", { path: "a.ts", edits: [{ oldText: "o", newText: "n" }] }, { content: text("ok"), details: piDetails() }, ctx);
		assert.deepEqual(stock.files[0], { path: "a.ts", status: "done", countKey: "a.ts", added: 3, removed: 2 });
		const diffOnly = classifyChange("edit", { path: "a.ts", edits: [] }, { content: text("ok"), details: { diff: piDetails().diff } }, ctx);
		assert.deepEqual([diffOnly.files[0].added, diffOnly.files[0].removed], [3, 2]);
		// RQW multi-file: each file's own details, not the requested text.
		const rqw = classifyChange("edit", { edits: [{ path: "a.ts", oldText: "never\ncounted\n", newText: "x" }, { path: "b.ts", oldText: "q", newText: "r" }] }, {
			content: text("Edited: a.ts\nEdited: b.ts"),
			details: { files: [{ path: "a.ts", ok: true, details: piDetails() }, { path: "b.ts", ok: true, details: { patch: generateUnifiedPatch("b.ts", "q\n", "r\ns\n") } }] },
		}, ctx);
		assert.deepEqual(rqw.files.map((f) => [f.path, f.status, f.added, f.removed]), [["a.ts", "done", 3, 2], ["b.ts", "done", 2, 1]]);
	});

	it("edit-compact-nested-counts", () => {
		const compact = (counts: object, ok = true) => ({ content: [], details: { files: [{ path: "actual.ts", ok, details: { rqwToolsNestedCounts: counts } }] } });
		for (const counts of [{ added: 3, removed: 2 }, { added: 0, removed: 0 }, { added: 4 }, { removed: 1 }]) {
			assert.deepEqual(classifyChange("edit", {}, compact(counts), ctx).files,
				[{ path: "actual.ts", countKey: "actual.ts", status: "done", ...counts }], "compact counts work without restoring arguments or a diff");
		}
		assert.deepEqual(classifyChange("edit", {}, compact({ added: 99, removed: 99 }, false), ctx).files,
			[{ path: "actual.ts", countKey: "actual.ts", status: "error" }], "only successful files confirm counts");
		assert.deepEqual(classifyChange("edit", { path: "requested.ts" }, compact({ added: 3, removed: 2 }), { ...ctx, isPartial: true }).files,
			[{ path: "requested.ts", countKey: "requested.ts", status: "running" }], "partial calls never confirm counts");
		assert.deepEqual(classifyChange("edit", {}, compact({ added: -1, removed: NaN }), ctx).files,
			[{ path: "actual.ts", countKey: "actual.ts", status: "done" }], "invalid compact counts are omitted");
		assert.deepEqual(classifyChange("edit", { path: "a.ts" }, { content: [], details: { added: 90, removed: 90 } }, ctx).files,
			[{ path: "a.ts", countKey: "a.ts", status: "done" }], "unmarked result counts remain unsupported");
	});

	it("edit-unknown-count-omitted", () => {
		const args = { path: "a.ts", edits: [{ oldText: "a\nb\nc", newText: "d" }] };
		for (const result of [{ content: text("ok"), details: undefined }, { content: text("ok"), details: { diff: "", patch: "garbage" } }, { content: text("ok"), details: { firstChangedLine: 3 } }]) {
			const f = classifyChange("edit", args, result, ctx).files[0];
			assert.deepEqual(f, { path: "a.ts", status: "done", countKey: "a.ts" }, JSON.stringify(result));
		}
		assert.deepEqual(classifyChange("edit", args, { content: text("partial"), details: piDetails() }, { ...ctx, isPartial: true }).files[0], { path: "a.ts", status: "running", countKey: "a.ts" });
		assert.deepEqual(classifyChange("edit", args, { content: text("Could not find"), details: piDetails(), isError: true }, ctx).files[0], { path: "a.ts", status: "error", countKey: "a.ts" });
		assert.deepEqual(classifyChange("edit", args, { content: text("x"), details: undefined }, { ...ctx, isError: true }).files[0], { path: "a.ts", status: "error", countKey: "a.ts" });
	});

	it("write-single", async () => {
		const args = { path: "new.ts", content: "a\n\nb\n" };
		const result = await createWriteToolDefinition(tmp).execute("call-1", args as never, undefined, undefined, {} as never);
		assert.equal(result.details, undefined, "stock write success has no details");
		const r = classifyChange("write", args, result, ctx);
		assert.deepEqual(r, { kind: "edit", target: "write new.ts", status: "done", countKey: "new.ts", countKeys: ["new.ts"], outputText: `Successfully wrote to new.ts`,
			files: [{ path: "new.ts", status: "done", countKey: "new.ts", added: 3 }] });
		assert.deepEqual(classifyChange("write", args, undefined, ctx).files[0], { path: "new.ts", status: "running", countKey: "new.ts" });
		assert.deepEqual(classifyChange("write", { path: "x" }, { content: text("ok"), details: undefined }, ctx).files[0], { path: "x", status: "done", countKey: "x" }, "no content, no count");
	});

	it("write-files", () => {
		const args = { files: [{ path: "a.ts", content: "1\n2\n" }, { path: "b.ts", content: "x" }, { path: "c.ts", content: "" }] };
		const r = classifyChange("write", args, { content: text("Written: a.ts\nWritten: b.ts\nWritten: c.ts"),
			details: { files: [{ path: "a.ts", ok: true }, { path: "b.ts", ok: true }, { path: "c.ts", ok: true }] } }, ctx);
		assert.deepEqual(r.files, [{ path: "a.ts", status: "done", countKey: "a.ts", added: 2 }, { path: "b.ts", status: "done", countKey: "b.ts", added: 1 },
			{ path: "c.ts", status: "done", countKey: "c.ts", added: 0 }]);
		assert.equal(r.target, "write a.ts +2 more");
		assert.ok(r.files.every((f) => f.removed === undefined), "writes have no minus");
		assert.deepEqual(classifyChange("write", { path: "single.ts", content: "s\n" }, undefined, ctx).countKeys, ["single.ts"]);
	});

	it("write-line-count", () => {
		for (const [content, lines] of [["", 0], ["a", 1], ["a\n", 1], ["a\n\n", 2], ["a\nb", 2], ["\n", 1], ["a\n\nb\n", 3], ["a\r\nb\r\n", 2], ["\n\n\n", 3]] as const)
			assert.equal(contentLines(content), lines, JSON.stringify(content));
	});

	it("mixed-outcomes", () => {
		const edit = classifyChange("edit", { edits: [{ path: "ok.ts", oldText: "a", newText: "b" }, { path: "bad.ts", oldText: "a", newText: "b" }, { path: "maybe.ts", oldText: "a", newText: "b" }] }, {
			content: text("Edited: ok.ts (1 block(s))\nFailed: bad.ts: not found\nPossibly changed: maybe.ts: Operation aborted. Read this file before retrying."),
			details: { files: [{ path: "ok.ts", ok: true, details: piDetails("ok.ts") }, { path: "bad.ts", ok: false, error: "not found" },
				{ path: "maybe.ts", ok: false, error: "Operation aborted", outcome: "possibly_changed" }] },
			isError: true,
		}, { ...ctx, isError: true });
		assert.equal(edit.status, "error");
		assert.deepEqual(edit.files, [{ path: "ok.ts", status: "done", countKey: "ok.ts", added: 3, removed: 2 }, { path: "bad.ts", status: "error", countKey: "bad.ts" },
			{ path: "maybe.ts", status: "possibly_changed", countKey: "maybe.ts" }]);
		const write = classifyChange("write", { files: [{ path: "w.ts", content: "1\n" }, { path: "v.ts", content: "2\n" }] }, {
			content: text("Written: w.ts\nFailed: v.ts: EACCES"), details: { files: [{ path: "w.ts", ok: true }, { path: "v.ts", ok: false, error: "EACCES" }] }, isError: true }, ctx);
		assert.deepEqual(write.files.map((f) => [f.status, f.added]), [["done", 1], ["error", undefined]]);
	});

	it("edit-identity-merged-aliases", () => {
		// RQW edit groups by filesystem identity: `link.ts` is another spelling of `a.ts` and runs inside a.ts's group.
		const edits = [{ path: "a.ts", oldText: "x", newText: "y" }, { path: "link.ts", oldText: "p", newText: "q" }, { path: "b.ts", oldText: "1", newText: "2" }];
		const result = { content: text("Edited: a.ts (2 block(s))\nFailed: b.ts: not found"), isError: true,
			details: { files: [{ path: "a.ts", ok: true, details: piDetails() }, { path: "b.ts", ok: false, error: "not found" }] } };
		const r = classifyChange("edit", { edits }, result, { ...ctx, isError: true });
		// (A) The finished call lists the files RQW grouped: the merged alias is never an error and never a second entry.
		assert.deepEqual(r.files, [{ path: "a.ts", status: "done", countKey: "a.ts", added: 3, removed: 2 }, { path: "b.ts", status: "error", countKey: "b.ts" }]);
		assert.deepEqual(r.countKeys, ["a.ts", "b.ts"]);
		assert.equal(r.target, "edit a.ts +1 more");
		// While it runs, and with no list at all, the requested args are the fallback.
		assert.deepEqual(classifyChange("edit", { edits }, undefined, ctx).countKeys, ["a.ts", "link.ts", "b.ts"]);
		assert.deepEqual(classifyChange("edit", { edits }, { content: text("x"), details: { files: [] } }, ctx).files.map((f) => f.status), ["error", "error", "error"], "an empty list confirms nothing");
		// The list's own order and spellings win over the args, and the list wins for a path the args never named.
		const swapped = classifyChange("edit", { edits }, { content: text("ok"), details: { files: [{ path: "b.ts", ok: true, details: piDetails() }, { path: "a.ts", ok: true }] } }, ctx);
		assert.deepEqual(swapped.files, [{ path: "b.ts", status: "done", countKey: "b.ts", added: 3, removed: 2 }, { path: "a.ts", status: "done", countKey: "a.ts" }]);
		// (B) One identity, no files[]: one stock result for several requested spellings is exposed once, as the first path.
		const single = classifyChange("edit", { edits: edits.slice(0, 2) }, { content: text("Edited a.ts"), details: piDetails() }, ctx);
		assert.deepEqual(single.files, [{ path: "a.ts", status: "done", countKey: "a.ts", added: 3, removed: 2 }]);
		assert.deepEqual(single.countKeys, ["a.ts"], "one count key");
		assert.equal(single.target, "edit a.ts");
		// A failed single identity confirms nothing, and is exposed once.
		assert.deepEqual(classifyChange("edit", { edits: edits.slice(0, 2) }, { content: text("no"), details: piDetails(), isError: true }, ctx).files.map((f) => [f.path, f.status, f.added]), [["a.ts", "error", undefined]]);
	});

	it("collection-coercion-mirrors-execution", () => {
		// Models send `files` / `edits` as a JSON string or as one object; RQW-tools turns both into arrays before execution.
		const jsonFiles = JSON.stringify([{ path: "a.ts", content: "1\n" }, { path: "b.ts", content: "x\n2\n" }]);
		const writeResult = { content: text("Written: a.ts\nWritten: b.ts"), details: { files: [{ path: "a.ts", ok: true }, { path: "b.ts", ok: true }] } };
		const w = classifyChange("write", { files: jsonFiles }, writeResult, ctx);
		assert.equal(w.target, "write a.ts +1 more");
		assert.deepEqual(w.countKeys, ["a.ts", "b.ts"], "two countKeys from the JSON string");
		assert.deepEqual(w.files, [{ path: "a.ts", status: "done", countKey: "a.ts", added: 1 }, { path: "b.ts", status: "done", countKey: "b.ts", added: 2 }], "confirmed added counts");
		assert.deepEqual(classifyChange("write", { files: jsonFiles }, undefined, ctx).countKeys, ["a.ts", "b.ts"], "running keeps the requested list");

		// One object instead of an array is one file.
		const single = classifyChange("write", { files: { path: "s.ts", content: "a\nb\n" } }, { content: text("Written: s.ts"), details: { files: [{ path: "s.ts", ok: true }] } }, ctx);
		assert.deepEqual(single, { kind: "edit", target: "write s.ts", status: "done", countKey: "s.ts", countKeys: ["s.ts"], outputText: "Written: s.ts",
			files: [{ path: "s.ts", status: "done", countKey: "s.ts", added: 2 }] });

		// JSON string edits: the per-entry paths and the top-level fallback apply, as for an array.
		const jsonEdits = JSON.stringify([{ path: "b.ts", oldText: "x", newText: "y" }, { oldText: "p", newText: "q" }, { path: "./b.ts", oldText: "3", newText: "4" }]);
		const e = classifyChange("edit", { path: "top.ts", edits: jsonEdits }, undefined, ctx);
		assert.deepEqual(e.countKeys, ["b.ts", "top.ts"]);
		assert.equal(e.target, "edit b.ts +1 more");
		// One object instead of an array for edits.
		assert.deepEqual(classifyChange("edit", { edits: { path: "o.ts", oldText: "a", newText: "b" } }, undefined, ctx).countKeys, ["o.ts"]);
		// Finished single-identity stock edit with a JSON string list: only the first path is exposed.
		const finished = classifyChange("edit", { edits: JSON.stringify([{ path: "a.ts", oldText: "x", newText: "y" }, { path: "link.ts", oldText: "p", newText: "q" }]) },
			{ content: text("Edited a.ts"), details: piDetails() }, ctx);
		assert.deepEqual(finished.files, [{ path: "a.ts", status: "done", countKey: "a.ts", added: 3, removed: 2 }]);
		assert.equal(finished.target, "edit a.ts");

		// Malformed or non-collection input is unusable, as in execution: the top-level path stands alone.
		assert.deepEqual(classifyChange("write", { path: "m.ts", content: "x", files: "[not json" }, undefined, ctx).countKeys, ["m.ts"]);
		assert.deepEqual(classifyChange("edit", { path: "m.ts", edits: "[not json" }, undefined, ctx).countKeys, ["m.ts"]);
		assert.deepEqual(classifyChange("write", { path: "n.ts", content: "x", files: "42" }, undefined, ctx).countKeys, ["n.ts"]);
		assert.deepEqual(classifyChange("edit", { path: "n.ts", edits: "null" }, undefined, ctx).countKeys, ["n.ts"]);
		assert.equal(classifyChange("edit", { edits: "[bad" }, undefined, ctx).target, "edit", "no path yet");

		// Purity: frozen args in every coerced form, no mutation, same classification twice.
		const frozen = deepFreeze({ files: jsonFiles, edits: jsonEdits, path: "top.ts", content: "c" });
		const before = structuredClone(frozen);
		classifyChange("write", frozen, writeResult, ctx);
		classifyChange("edit", frozen, undefined, ctx);
		assert.deepEqual(frozen, before, "args are not mutated");
		assert.deepEqual(classifyChange("write", frozen, undefined, ctx), classifyChange("write", frozen, undefined, ctx));
	});

	it("changes-pure", () => {
		const args = deepFreeze({ edits: [{ path: "a.ts", oldText: "x", newText: "y" }], path: "b.ts", files: [{ path: "c", content: "d" }] });
		const result = deepFreeze({ content: text("ok"), details: { files: [{ path: "a.ts", ok: true, details: piDetails() }], diff: "+1 x", patch: "@@ -1 +1 @@\n-a\n+b" } });
		const context = deepFreeze({ ...ctx, cwd: "/w" });
		const copy = structuredClone({ args, result, context });
		classifyChange("edit", args, result, context);
		classifyChange("write", args, result, context);
		assert.deepEqual({ args, result, context }, copy);
		assert.deepEqual(classifyChange("edit", args, result, context), classifyChange("edit", args, result, context));
	});

	it("changes-width", () => {
		const paths = [SAMPLES.longPath, `${SAMPLES.cjk}\n${SAMPLES.ansi}`, SAMPLES.combining, `${SAMPLES.emoji}\t${SAMPLES.cyrillic}`];
		const r = classifyChange("write", { files: paths.map((path) => ({ path, content: "x\n" })) }, undefined, ctx);
		assert.ok(!/[\r\n\t\x1b]/.test(r.target), "the target is one clean display row");
		assert.ok(r.target.startsWith("write /Users/"));
		assert.ok(r.target.endsWith(" +3 more"));
		assertFits((width) => truncateToWidth(r.target, width));
		for (const path of paths) assertFits((width) => truncateToWidth(`${classifyChange("edit", { path, edits: [] }, undefined, ctx).target}`, width));
	});
});
