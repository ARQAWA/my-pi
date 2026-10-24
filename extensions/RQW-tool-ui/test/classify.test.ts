import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { classify } from "../classify.ts";
import { deepFreeze, SAMPLES } from "./harness.ts";

const done = (text = "", extra: object = {}) => ({ content: [{ type: "text", text }], details: undefined, ...extra });
const ctx = { toolCallId: "call-1", isPartial: false, isError: false };

describe("classify", () => {
	it("classify-read", () => {
		const r = classify("read", { path: "src/a.ts" }, done("one\ntwo"), ctx);
		assert.deepEqual(r, { kind: "read", target: "src/a.ts", status: "done", countKey: "src/a.ts", countKeys: ["src/a.ts"], outputText: "one\ntwo" });
		assert.equal(classify("read", { path: "a.ts", offset: 10 }, undefined, ctx).target, "a.ts L10");
		assert.equal(classify("read", { path: "a.ts", offset: 10, limit: 5 }, undefined, ctx).target, "a.ts L10-14");
		assert.equal(classify("read", { path: "a.ts", offset: 1, limit: 1 }, undefined, ctx).target, "a.ts L1-1");
		for (const bad of [{ offset: 0 }, { offset: -3, limit: 2 }, { offset: 1.5 }, { offset: "4" }, { limit: 20 }, { offset: Number.NaN }])
			assert.equal(classify("read", { path: "a.ts", ...bad }, undefined, ctx).target, "a.ts", JSON.stringify(bad));
		assert.equal(classify("read", { path: "a.ts", offset: 3, limit: 0 }, undefined, ctx).target, "a.ts L3", "invalid limit keeps the offset only");
		// The same file under different spellings is one count key.
		const keys = ["./src/a.ts", "src//a.ts", "src/x/../a.ts", "@src/a.ts", "/w/src/a.ts"].map((path) =>
			classify("read", { path }, undefined, { ...ctx, cwd: "/w" }, "linux").countKey);
		assert.deepEqual(new Set(keys), new Set(["/w/src/a.ts"]));
		assert.equal(classify("read", { path: "C:\\w\\a.ts" }, undefined, ctx, "win32").countKey, "C:/w/a.ts");
		assert.equal(classify("read", { path: "a.ts" }, done("x"), { ...ctx, isError: true }).status, "error");
	});

	it("classify-path-aliases", () => {
		const key = (path: string, cwd?: string, platform: string) => classify("read", { path }, undefined, { ...ctx, cwd }, platform).countKey;
		// Windows: shell drive forms, drive letter with either separator, `..` and `.` are one file, as Pi resolves them.
		const win = ["/c/work/a.ts", "/mnt/c/work/a.ts", "/cygdrive/c/work/a.ts", "/C/work/a.ts", "C:\\work\\a.ts", "C:/work/a.ts",
			"/c/work/x/../a.ts", "C:\\work\\.\\a.ts", "@C:\\work\\a.ts"];
		assert.deepEqual(new Set(win.map((p) => key(p, undefined, "win32"))), new Set(["C:/work/a.ts"]));
		// Relative paths resolve against a shell-form cwd the same way.
		assert.deepEqual(new Set(["a.ts", "./a.ts", "..\\work\\a.ts", "..\\work\\.\\a.ts"].map((p) => key(p, "/c/work", "win32"))), new Set(["C:/work/a.ts"]));
		assert.equal(key("a.ts", "C:\\work\\", "win32"), "C:/work/a.ts", "a trailing separator on the cwd is not doubled");
		// Pi does not fold case: a different drive letter case is a different spelling, as Pi's resolved string is.
		assert.equal(key("c:\\work\\a.ts", undefined, "win32"), "c:/work/a.ts");
		// POSIX: a backslash is an ordinary name character, not a separator; shell drive forms are not rewritten.
		assert.equal(key("a\\b.ts", "/w", "linux"), "/w/a\\b.ts");
		assert.equal(key("a/b.ts", "/w", "linux") === key("a\\b.ts", "/w", "linux"), false, "POSIX backslash is distinct from a separator");
		assert.equal(key("/c/work/a.ts", undefined, "linux"), "/c/work/a.ts");
		assert.equal(key("C:\\work\\a.ts", undefined, "linux"), "C:\\work\\a.ts", "no drive on POSIX");
		assert.equal(key("/c/work/a.ts", undefined, "linux") === key("C:/work/a.ts", undefined, "linux"), false);
		assert.equal(key("x/../../y", "/w", "linux"), "/y", "POSIX root does not climb");
	});

	it("classify-path-root-and-unc", () => {
		const key = (path: string, cwd?: string, platform: string) => classify("read", { path }, undefined, { ...ctx, cwd }, platform).countKey;
		// A root-relative Windows path takes the cwd drive: the same file as the drive form.
		assert.equal(key("\\work\\a.ts", "C:\\project", "win32"), "C:/work/a.ts");
		assert.equal(key("\\work\\a.ts", "C:\\project", "win32"), key("C:\\work\\a.ts", "C:\\project", "win32"));
		assert.equal(key("\\work\\a.ts", "/c/project", "win32"), "C:/work/a.ts");
		// A UNC root is kept with its double separator, and different shares are different files.
		assert.equal(key("\\\\server\\share\\a.ts", undefined, "win32"), "//server/share/a.ts");
		assert.equal(key("\\\\server\\share\\x\\..\\a.ts", undefined, "win32"), "//server/share/a.ts");
		assert.equal(key("a.ts", "\\\\server\\share\\dir", "win32"), "//server/share/dir/a.ts");
		assert.equal(key("\\\\server\\share\\a.ts", undefined, "win32") === key("\\\\server\\other\\a.ts", undefined, "win32"), false, "different shares are distinct");
		assert.equal(key("\\\\server\\share\\a.ts", undefined, "win32") === key("/server/share/a.ts", undefined, "win32"), false, "a UNC root is not a POSIX-style root");
		assert.equal(key("\\\\server\\share\\a.ts", undefined, "win32") === key("\\server\\share\\a.ts", undefined, "win32"), false, "a UNC root is not a rooted path");
		// POSIX: the cwd resolves as before.
		assert.equal(key("a.ts", "/w/x", "linux"), "/w/x/a.ts");
	});

	it("classify-path-lexical-steps", () => {
		// Host platform, so the home folder is native; every expectation is an equality of keys, not a literal path.
		const key = (path: string, cwd?: string, platform: string = process.platform) => classify("read", { path }, undefined, { ...ctx, cwd }, platform).countKey;
		const home = homedir();
		const file = join(home, "src", "a.ts");
		const expected = key(file);
		// ~, ~/, absolute and file:// forms of one file are one key.
		for (const spelling of ["~/src/a.ts", "@~/src/a.ts", pathToFileURL(file).href, `@${pathToFileURL(file).href}`, "src/a.ts", "./src/../src/a.ts"])
			assert.equal(key(spelling, spelling.startsWith("src") || spelling.startsWith("./") ? home : "/elsewhere"), expected, spelling);
		assert.equal(key("~"), key(home));
		// NBSP, U+2000-200A, U+202F, U+205F and U+3000 read as a space.
		for (const space of ["\u00A0", "\u2000", "\u2005", "\u200A", "\u202F", "\u205F", "\u3000"])
			assert.equal(key(`my${space}file.ts`, home), key("my file.ts", home), `U+${space.charCodeAt(0).toString(16)}`);
		// The cwd base takes the same expansions as the path: ~, ~/ and file://, but no space folding.
		assert.equal(key("src/a.ts", "~"), expected);
		assert.equal(key("a.ts", "~/src"), expected);
		assert.equal(key("a.ts", pathToFileURL(join(home, "src")).href), expected);
		assert.notEqual(key("a.ts", "/w\u00A0x"), key("a.ts", "/w x"), "the base is not folded");
		// Platform-fixed cases without a home folder.
		assert.equal(key("~\\a.ts", "/w", "linux"), "/w/~\\a.ts", "`~\\` is a separator only on Windows");
		assert.equal(key("file://host/x/a.ts", "/w", "linux"), "/w/file:/host/x/a.ts", "a URL Node rejects stays a plain name, never throws");
		assert.equal(key("file:///w/a.ts", undefined, "linux"), "/w/a.ts");
		assert.equal(key("file:///c:/work/a.ts", undefined, "win32"), "c:/work/a.ts");
		assert.equal(key("file:///C:/work/a.ts", undefined, "win32"), key("C:\\work\\a.ts", undefined, "win32"));
		assert.equal(key("my\u00A0file.ts", "/c/work", "win32"), "C:/work/my file.ts");
	});

	it("classify-search", () => {
		const g = classify("grep", { pattern: "foo\\(bar\\)|^x.*$" }, done("a.ts:1: foo"), ctx);
		assert.deepEqual(g, { kind: "search", target: "foo\\(bar\\)|^x.*$ in .", status: "done", countKey: "call-1", countKeys: ["call-1"], outputText: "a.ts:1: foo" });
		assert.equal(classify("grep", { pattern: "[a-z]+", path: "src" }, undefined, ctx).target, "[a-z]+ in src");
		assert.equal(classify("find", { pattern: "*.ts" }, undefined, ctx).target, "*.ts");
		assert.equal(classify("find", { pattern: "**/*.md", path: "docs" }, undefined, ctx).target, "**/*.md in docs");
		assert.equal(classify("find", { pattern: "*.ts" }, undefined, ctx).kind, "search");
		assert.equal(classify("grep", { pattern: "x" }, done(), { ...ctx, toolCallId: "call-2" }).countKey, "call-2", "each search counts");
	});

	it("classify-run", () => {
		const r = classify("bash", { command: "cd src &&\n  npm test \\\n  --watch\r\necho\tdone" }, done("ok"), ctx);
		assert.equal(r.target, "cd src && npm test \\ --watch echo done");
		assert.deepEqual([r.kind, r.status, r.countKey, r.exitCode], ["run", "done", "call-1", undefined]);
		assert.equal(classify("bash", { command: SAMPLES.ansi }, undefined, ctx).target, "red bold green", "terminal escapes are dropped");
		// Pi 1.4.0 bash reports the exit code in structuredContent and marks the result an error.
		const piFail = done("boom\n\nCommand exited with code 2", { isError: true, structuredContent: { output: "boom", exit_code: 2, truncated: false, wall_time_seconds: 0.1 } });
		assert.deepEqual([classify("bash", { command: "false" }, piFail, ctx).status, classify("bash", { command: "false" }, piFail, ctx).exitCode], ["error", 2]);
		assert.equal(classify("bash", { command: "x" }, done("", { details: { exitCode: 1 } }), ctx).status, "error", "nonzero exit in details");
		assert.equal(classify("bash", { command: "x" }, done("", { details: { exit_code: 0 } }), ctx).status, "done");
		assert.equal(classify("bash", { command: "x" }, done("", { structuredContent: { exit_code: 0 } }), ctx).exitCode, 0);
		assert.equal(classify("bash", { command: "x" }, done("replayed"), { ...ctx, isError: true }).status, "error", "context.isError from history");
	});

	it("classify-other", () => {
		const r = classify("web_fetch", { timeout: 5, url: "", query: "line1\nline2", extra: "later" }, done("page"), ctx);
		assert.deepEqual(r, { kind: "other", target: "web_fetch line1 line2", status: "done", countKey: "call-1", countKeys: ["call-1"], outputText: "page" });
		assert.equal(classify("todo", { n: 1, flag: true, list: ["a"] }, undefined, ctx).target, "todo", "no string argument");
		assert.equal(classify("todo", { blank: " \n\t" }, undefined, ctx).target, "todo", "whitespace is not a nonempty argument");
		assert.equal(classify("agent", { action: "start", task: "do it" }, undefined, ctx).kind, "other", "only wait is a wait");
		assert.equal(classify("ls", {}, done("a\nb", { content: [{ type: "image", data: "x" }, { type: "text", text: "a" }, { type: "text", text: "b" }] }), ctx).outputText, "a\nb");
	});

	it("classify-partial", () => {
		for (const args of [undefined, null, {}, "garbage", 7, { path: 42 }, { pattern: null }, { command: ["x"] }, { action: "wait", ids: "agent#1" }])
			for (const name of ["read", "grep", "find", "bash", "agent", "custom"]) {
				const r = classify(name, args, undefined, {});
				assert.equal(r.status, "running");
				assert.equal(typeof r.target, "string");
				assert.equal(typeof r.countKey, "string");
			}
		assert.equal(classify("bash", { command: "npm te" }, done("partial out"), { ...ctx, isPartial: true }).status, "running", "streaming result");
		assert.equal(classify("read", { path: "a" }, undefined, ctx).status, "running", "not finished");
		assert.equal(classify("read", { path: "a" }, done("x"), {}).status, "done", "a replayed result has no other context");
	});

	it("classify-pure", () => {
		const args = deepFreeze({ command: "a\nb", nested: { x: ["y"] } });
		const result = deepFreeze(done("out", { details: { exitCode: 3, list: [1] }, structuredContent: { exit_code: 3 } }));
		const context = deepFreeze({ ...ctx, cwd: "/w" });
		const copy = structuredClone({ args, result, context });
		for (const name of ["read", "grep", "find", "bash", "agent", "other"]) classify(name, args, result, context);
		assert.deepEqual({ args, result, context }, copy);
		assert.deepEqual(classify("bash", args, result, context), classify("bash", args, result, context), "same input, same output");
	});

	it("wait calls are their own kind, one count key per waited ID", () => {
		for (const tool of ["agent", "review"]) {
			const ids = [`${tool}#2`, `${tool}#5`, `${tool}#2`];
			const r = classify(tool, { action: "wait", ids, timeout_ms: 600000 }, done(`[${tool}#2] result`), ctx);
			assert.deepEqual(r, { kind: "wait", target: `${tool}#2 ${tool}#5`, status: "done", countKey: `${tool}#2`, countKeys: [`${tool}#2`, `${tool}#5`], outputText: `[${tool}#2] result` });
		}
		const streaming = classify("agent", { action: "wait" }, undefined, ctx);
		assert.deepEqual([streaming.kind, streaming.status, streaming.countKey, streaming.countKeys], ["wait", "running", "call-1", []]);
		assert.equal(classify("agent", { action: "wait", ids: ["agent#1"] }, done("timeout"), { ...ctx, isError: true }).status, "error");
	});
});
