import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import test from "node:test";
import { createGlobToolDefinition, recursivePattern } from "../../../extensions/RQW-tools/glob.ts";
import { project, type VFile } from "./rg-fake.ts";

const files = (...specs: Array<[string, number]>): VFile[] => specs.map(([path, mtime]) => ({ path, mtime, text: "x\n" }));

test("Glob lists matching files newest first, whatever order ripgrep produced; the name case does not matter; noise stays out", async (t) => {
	const p = await project(t, files(["a.ts", 5], ["src/new.ts", 9], ["src/deep/old.TS", 1], ["notes.md", 7], ["node_modules/x/dep.ts", 8], [".git/hooks/h.ts", 6], [".pytest_cache/c.ts", 4]));
	assert.equal(await p.glob({ glob_pattern: "*.ts" }), "src/new.ts\na.ts\nsrc/deep/old.TS");
	assert.equal(await p.glob({ glob_pattern: "**/SRC/*.TS" }), "src/new.ts");
	assert.equal(p.rg.spawnOptions[0].cwd, p.cwd);
	assert.equal(p.rg.spawnOptions[0].shell, false);
});

test("a pattern with a slash matches from the root at any depth; braces, nested paths and plain names work", async (t) => {
	const p = await project(t, files(["src/a.ts", 6], ["lib/src/b.ts", 5], ["src/deep/c.ts", 4], ["src/d.tsx", 3], ["top.ts", 2]));
	assert.equal(await p.glob({ glob_pattern: "src/*.ts" }), "src/a.ts\nlib/src/b.ts");
	assert.equal(await p.glob({ glob_pattern: "src/**/*.ts" }), "src/a.ts\nlib/src/b.ts\nsrc/deep/c.ts");
	assert.equal(await p.glob({ glob_pattern: "**/src/*.{ts,tsx}" }), "src/a.ts\nlib/src/b.ts\nsrc/d.tsx");
	assert.equal(await p.glob({ glob_pattern: "top.ts" }), "top.ts");
	assert.equal(await p.glob({ glob_pattern: "zzz" }), "No files found matching pattern");
});

test("patterns get the recursive prefix exactly when they lack it; Windows backslashes become slashes only there", () => {
	assert.equal(recursivePattern("*.js", "darwin"), "**/*.js");
	assert.equal(recursivePattern("**/test/**/test_*.ts", "darwin"), "**/test/**/test_*.ts");
	assert.equal(recursivePattern("src/*.ts", "darwin"), "**/src/*.ts");
	assert.equal(recursivePattern("./src/*.ts", "darwin"), "**/src/*.ts");
	assert.equal(recursivePattern("{a,b}/*.{ts,tsx}", "darwin"), "**/{a,b}/*.{ts,tsx}");
	assert.equal(recursivePattern("src\\*.ts", "win32"), "**/src/*.ts");
	assert.equal(recursivePattern("src\\*.ts", "darwin"), "**/src\\*.ts");
	assert.throws(() => recursivePattern("  "), /glob_pattern must not be empty/);
});

test("a positive glob reaches gitignored files, as in Cursor; hidden files are listed", async (t) => {
	const p = await project(t, [
		{ path: "dist/bundle.js", ignored: true, mtime: 3 }, { path: "src/a.js", mtime: 2 }, { path: ".env", mtime: 1 },
	]);
	assert.equal(await p.glob({ glob_pattern: "*" }), "dist/bundle.js\nsrc/a.js\n.env");
	assert.equal(await p.glob({ glob_pattern: "dist/*.js" }), "dist/bundle.js");
});

test("an empty pattern, a missing folder and a file as folder are three errors; no match is an answer", async (t) => {
	const p = await project(t, files(["src/a.ts", 1]));
	await assert.rejects(p.glob({ glob_pattern: "" }), /glob_pattern must not be empty/);
	await assert.rejects(p.glob({ glob_pattern: "*", target_directory: "nope" }), /Path not found: .*nope/);
	await writeFile(p.abs("f.txt"), "x\n");
	await assert.rejects(p.glob({ glob_pattern: "*", target_directory: "f.txt" }), /Not a directory: .*f\.txt/);
	assert.equal(await p.glob({ glob_pattern: "zzz" }), "No files found matching pattern");
	assert.equal(p.rg.calls.length, 1);
});

test("target_directory relative, absolute, with spaces and Cyrillic lists paths relative to it", async (t) => {
	const dir = "папка с пробелом";
	const p = await project(t, files([`${dir}/файл один.ts`, 2], [`${dir}/sub/two.ts`, 1], ["outside.ts", 3]));
	await mkdir(p.abs(dir));
	assert.equal(await p.glob({ glob_pattern: "*.ts", target_directory: dir }), "файл один.ts\nsub/two.ts");
	assert.equal(await p.glob({ glob_pattern: "*.ts", target_directory: p.abs(dir) }), "файл один.ts\nsub/two.ts");
	assert.equal(await p.glob({ glob_pattern: "sub/*.ts", target_directory: dir }), "sub/two.ts");
});

test("2001 matches show the newest 2000 and say more exist; exactly 2000 say nothing", async (t) => {
	const many = (count: number) => files(...Array.from({ length: count }, (_unused, i): [string, number] => [`f${i}.ts`, count - i]));
	const p = await project(t, many(2001));
	const over = await p.glob({ glob_pattern: "*.ts" });
	const lines = over.split("\n");
	assert.equal(lines[0], "f0.ts");
	assert.equal(lines.filter((line) => line.endsWith(".ts")).length, 2000);
	assert.ok(!over.includes("f2000.ts"));
	assert.ok(over.endsWith("[Showing the newest 2000 paths; more match. Narrow glob_pattern or target_directory.]"));
	p.rg.tree = many(2000);
	const exact = await p.glob({ glob_pattern: "*.ts" });
	assert.equal(exact.split("\n").length, 2000);
	assert.ok(!exact.includes("["));
});

test("long paths are cut by whole entries at 50KiB with a footer", async (t) => {
	const long = "d".repeat(200);
	const p = await project(t, files(...Array.from({ length: 1000 }, (_unused, i): [string, number] => [`${long}/${i}.ts`, 1000 - i])));
	const text = await p.glob({ glob_pattern: "*.ts" });
	assert.ok(Buffer.byteLength(text) <= 50 * 1024);
	const shown = text.split("\n").filter((line) => line.endsWith(".ts"));
	assert.ok(shown.every((line) => line.startsWith(`${long}/`)));
	assert.ok(text.includes(`Output cut at 50KiB after ${shown.length} paths.`));
});

test("a scan of more than 10000 paths, a timeout and an rg failure are all marked, never shown as an empty tree", async (t) => {
	const p = await project(t, files(...Array.from({ length: 10005 }, (_unused, i): [string, number] => [`f${i}.ts`, i])));
	assert.ok((await p.glob({ glob_pattern: "*.ts" })).includes("Scan incomplete: stopped after 10000 entries"));
	p.rg.handler = () => ({ code: 2, stderr: "rg: error parsing glob '[': unclosed character class" });
	await assert.rejects(p.glob({ glob_pattern: "[" }), /error parsing glob/);
	p.rg.handler = () => ({ code: 2, stderr: "rg: locked: Permission denied (os error 13)", stdout: "./a.ts\u0000" });
	assert.equal(await p.glob({ glob_pattern: "*.ts" }), "a.ts\n\n[Some paths could not be searched: rg: locked: Permission denied (os error 13). Results may be missing.]");
});

test("a listing that outlives the backend limit is killed and marked incomplete", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const p = await project(t, [], { hang: true });
	const running = p.glob({ glob_pattern: "*.ts" });
	await p.rg.started();
	t.mock.timers.tick(25000);
	assert.equal(await running, "No files found before the scan stopped\n\n[Scan incomplete: timed out after 25 seconds. Results may be missing; narrow glob_pattern or target_directory.]");
	assert.equal(p.rg.killed, 1);
});

test("abort before launch runs nothing; abort during the listing kills rg", async (t) => {
	const p = await project(t, [], { hang: true });
	const tool: any = createGlobToolDefinition(p.cwd);
	const before = new AbortController();
	before.abort();
	await assert.rejects(tool.execute("c", { glob_pattern: "*" }, before.signal, undefined, { cwd: p.cwd }), /Operation aborted/);
	assert.equal(p.rg.calls.length, 0);
	const during = new AbortController();
	const running = tool.execute("c", { glob_pattern: "*" }, during.signal, undefined, { cwd: p.cwd });
	await p.rg.started();
	during.abort();
	await assert.rejects(running, /Operation aborted/);
	assert.equal(p.rg.killed, 1);
});

test("parallel Glob calls keep their own folder", async (t) => {
	const p = await project(t, files(["src/s.ts", 1], ["lib/l.ts", 1]));
	await mkdir(p.abs("lib"));
	const [one, two] = await Promise.all([p.glob({ glob_pattern: "*.ts", target_directory: "src" }), p.glob({ glob_pattern: "*.ts", target_directory: "lib" })]);
	assert.equal(one, "s.ts");
	assert.equal(two, "l.ts");
});

test("a missing rg is installed once for two parallel Glob calls", async (t) => {
	const p = await project(t, files(["a.ts", 1]));
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const agent = await mkdtemp(join(tmpdir(), "rqw-agent-"));
	const saved = { path: process.env.PATH, agent: process.env.PI_CODING_AGENT_DIR };
	t.after(async () => {
		for (const [key, value] of [["PATH", saved.path], ["PI_CODING_AGENT_DIR", saved.agent]] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(agent, { recursive: true, force: true });
	});
	process.env.PATH = "";
	process.env.PI_CODING_AGENT_DIR = agent;
	let ensures = 0;
	const createGrep: any = (_cwd: string, grepOptions: any) => ({
		async execute() {
			ensures++;
			await new Promise((resolve) => setImmediate(resolve));
			await mkdir(join(agent, "bin"), { recursive: true });
			await writeFile(join(agent, "bin", process.platform === "win32" ? "rg.exe" : "rg"), "binary");
			await grepOptions.operations.isDirectory("/x");
			throw new Error("Path not found");
		},
	});
	const [one, two] = await Promise.all([p.glob({ glob_pattern: "*.ts" }, { createGrep }), p.glob({ glob_pattern: "a.*" }, { createGrep })]);
	assert.equal(one, "a.ts");
	assert.equal(two, "a.ts");
	assert.equal(ensures, 1);
});
