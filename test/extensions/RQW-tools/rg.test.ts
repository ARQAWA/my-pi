import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRgToolDefinition } from "../../../extensions/RQW-tools/rg.ts";
import { NOISE_DIRS, resolveInputPath } from "../../../extensions/RQW-tools/search-policy.ts";
import { fileEvents, jsonLines, manyHits, project } from "./rg-fake.ts";

const NOISE = NOISE_DIRS.flatMap((name) => ["--iglob", `!**/${name}`]);
const BASE = ["--no-config", "--color=never", "--hidden", "--follow", "--with-filename"];

test("a pattern with a leading dash and a bracket reaches ripgrep whole, without a shell", async (t) => {
	const p = await project(t, [{ path: "src/a.ts", text: "call -foo(1)\nother\n" }]);
	assert.equal(await p.search({ pattern: "-foo\\(" }), "src/a.ts:1: call -foo(1)");
	assert.deepEqual(p.rg.calls[0], [...BASE, "--case-sensitive", "--json", ...NOISE, "--regexp=-foo\\(", "--", "."]);
	assert.equal(p.rg.spawnOptions[0].shell, false);
	assert.equal(p.rg.spawnOptions[0].cwd, p.cwd);
});

test("content search is case-sensitive unless -i is true; Unicode text is found", async (t) => {
	const p = await project(t, [{ path: "a.ts", text: "Needle\nneedle\nИголка\n" }]);
	assert.equal(await p.search({ pattern: "needle" }), "a.ts:2: needle");
	assert.equal(await p.search({ pattern: "needle", "-i": false }), "a.ts:2: needle");
	assert.equal(await p.search({ pattern: "needle", "-i": true }), "a.ts:1: Needle\na.ts:2: needle");
	assert.equal(await p.search({ pattern: "иголка", "-i": true }), "a.ts:3: Иголка");
});

test("glob filters are case-insensitive and stay separate from -i; type alone filters by file type", async (t) => {
	const p = await project(t, [{ path: "A.TS", text: "hit\n" }, { path: "b.py", text: "hit\n" }, { path: "c.js", text: "hit\n" }]);
	assert.equal(await p.search({ pattern: "hit", glob: "*.ts", output_mode: "files_with_matches" }), "A.TS");
	assert.equal(await p.search({ pattern: "HIT", glob: "*.ts", output_mode: "files_with_matches" }), "No matches found");
	assert.equal(await p.search({ pattern: "hit", type: "py", output_mode: "files_with_matches" }), "b.py");
	assert.equal(await p.search({ pattern: "hit", glob: "*.{ts,js}", output_mode: "files_with_matches" }), "A.TS\nc.js");
});

test("content lines show path, number and text; context lines and gaps use rg's - and -- marks, CRLF is dropped", async (t) => {
	const p = await project(t, [
		{ path: "src/a.ts", text: "one\r\nbefore\r\nneedle\r\nafter\r\nfive\r\nsix\r\nseven\r\neight\r\nneedle two\r\n" },
		{ path: "b.ts", text: "needle three\n" },
	]);
	assert.equal(await p.search({ pattern: "needle", "-C": 1 }), [
		"b.ts:1: needle three", "--", "src/a.ts-2- before", "src/a.ts:3: needle", "src/a.ts-4- after", "--", "src/a.ts-8- eight", "src/a.ts:9: needle two",
	].join("\n"));
});

test("-A and -B win over -C; -C alone gives both sides; fractions round up; bad values are errors", async (t) => {
	const p = await project(t, [{ path: "a.ts", text: "l1\nl2\nneedle\nl4\nl5\n" }]);
	assert.equal(await p.search({ pattern: "needle", "-A": 1.2, "-C": 5 }), "a.ts:3: needle\na.ts-4- l4\na.ts-5- l5");
	assert.equal(await p.search({ pattern: "needle", "-B": 1, "-A": 0, "-C": 5 }), "a.ts-2- l2\na.ts:3: needle");
	assert.equal(await p.search({ pattern: "needle", "-C": 0.5 }), "a.ts-2- l2\na.ts:3: needle\na.ts-4- l4");
	assert.equal(await p.search({ pattern: "needle", "-C": 0 }), "a.ts:3: needle");
	await assert.rejects(p.search({ pattern: "x", "-A": -1 }), /-A must not be negative/);
	await assert.rejects(p.search({ pattern: "x", "-C": Number.NaN }), /-C must be a finite number/);
});

test("an enormous context only shows the lines of the file", async (t) => {
	const p = await project(t, [{ path: "a.ts", text: "l1\nneedle\nl3\n" }]);
	// A walk over the context range would look up billions of line numbers; the probe turns that into a failure.
	const original = { get: Map.prototype.get, has: Map.prototype.has };
	let lookups = 0;
	const probe = (name: "get" | "has") => function (this: Map<unknown, unknown>, key: unknown) {
		if (++lookups > 100000) throw new Error("the context walk is not bounded by the lines received");
		return original[name].call(this, key);
	};
	Map.prototype.get = probe("get") as typeof Map.prototype.get;
	Map.prototype.has = probe("has") as typeof Map.prototype.has;
	t.after(() => Object.assign(Map.prototype, original));
	const huge = await p.search({ pattern: "needle", "-C": 2147483647 });
	const oneSided = await p.search({ pattern: "needle", "-A": 1e12, "-B": 0 });
	Object.assign(Map.prototype, original);
	assert.equal(huge, "a.ts-1- l1\na.ts:2: needle\na.ts-3- l3");
	assert.equal(oneSided, "a.ts:2: needle\na.ts-3- l3");
});

test("context flags change nothing outside content mode", async (t) => {
	const p = await project(t, [{ path: "a.ts", text: "l1\nneedle\nl3\n" }]);
	assert.equal(await p.search({ pattern: "needle", output_mode: "files_with_matches", "-A": 3, "-C": 2 }), "a.ts");
	assert.equal(await p.search({ pattern: "needle", output_mode: "count", "-A": 3 }), "a.ts:1");
});

test("empty pattern, empty glob and an unknown output_mode are errors; null options are dropped", async (t) => {
	const p = await project(t, [{ path: "a.ts", text: "x\n" }]);
	await assert.rejects(p.search({ pattern: "" }), /pattern must not be empty/);
	await assert.rejects(p.search({ pattern: "x", glob: "" }), /glob must not be empty/);
	await assert.rejects(p.search({ pattern: "x", output_mode: "lines" }), /Invalid output_mode "lines"/);
	assert.equal(await p.search({ pattern: "x", head_limit: null, offset: null, glob: null, "-i": "null" }), "a.ts:1: x");
});

test("head_limit defaults to 2000 and the footer gives the exact next offset; head_limit 0 removes only that limit", async (t) => {
	const p = await project(t, [manyHits("src/a.ts", 2100)]);
	const first = (await p.search({ pattern: "hit" })).split("\n");
	assert.equal(first.filter((line) => line.startsWith("src/a.ts:")).length, 2000);
	assert.equal(first.at(-1), "[Showing 2000 matches; more exist. Use offset=2000 to continue, or narrow path, pattern or glob.]");
	const all = await p.search({ pattern: "hit", head_limit: 0 });
	assert.equal(all.split("\n").filter((line) => line.startsWith("src/a.ts:")).length, 2100);
	assert.ok(!all.includes("more exist"));
});

test("offset skips matches before head_limit; the end of the list and a position past it are told apart from no matches", async (t) => {
	const p = await project(t, [manyHits("src/a.ts", 5)]);
	assert.equal(await p.search({ pattern: "hit", offset: 1, head_limit: 2 }), [
		"src/a.ts:2: hit 2", "src/a.ts:3: hit 3", "",
		"[Showing 2 matches; more exist. Use offset=3 to continue, or narrow path, pattern or glob.]",
	].join("\n"));
	assert.equal(await p.search({ pattern: "hit", offset: 4.9 }), "src/a.ts:5: hit 5");
	assert.equal(await p.search({ pattern: "hit", offset: 5 }), "No matches at offset 5; only 5 matches found.");
	assert.equal(await p.search({ pattern: "zzz" }), "No matches found");
	assert.equal((await p.search({ pattern: "hit", head_limit: 1.2 })).split("\n").length, 4);
});

test("pages are stable: files come in path order whatever order ripgrep produced them", async (t) => {
	const p = await project(t, ["c", "a", "b"].map((name) => ({ path: `${name}.ts`, text: "hit\n" })));
	assert.equal(await p.search({ pattern: "hit", output_mode: "files_with_matches" }), "a.ts\nb.ts\nc.ts");
	assert.equal(await p.search({ pattern: "hit", output_mode: "files_with_matches", offset: 1, head_limit: 1 }).then((text) => text.split("\n")[0]), "b.ts");
});

test("a complete scan runs on all cores and is ordered here; a scan cut at the budget runs again in path order", async (t) => {
	const p = await project(t, Array.from({ length: 10005 }, (_unused, i) => ({ path: `f${String(i).padStart(5, "0")}.ts`, text: "hit\n" })));
	const text = await p.search({ pattern: "hit", output_mode: "files_with_matches", head_limit: 3 });
	assert.ok(text.startsWith("f00000.ts\nf00001.ts\nf00002.ts\n"));
	assert.ok(text.includes("Scan incomplete: stopped after 10000 entries"));
	assert.equal(p.rg.calls.length, 2);
	assert.ok(!p.rg.calls[0].includes("--sort"));
	assert.deepEqual(p.rg.calls[1].slice(p.rg.calls[1].indexOf("--sort"), p.rg.calls[1].indexOf("--sort") + 2), ["--sort", "path"]);
	p.rg.tree = p.rg.tree.slice(0, 20);
	p.rg.calls.length = 0;
	assert.equal((await p.search({ pattern: "hit", output_mode: "files_with_matches", head_limit: 2 })).split("\n")[0], "f00000.ts");
	assert.equal(p.rg.calls.length, 1);
});

test("when the path-ordered rerun cannot finish, the first run's results stay, marked as unordered", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const tree = Array.from({ length: 10005 }, (_unused, i) => ({ path: `f${String(i).padStart(5, "0")}.ts`, text: "hit\n" }));
	const p = await project(t, tree);
	const simulated = p.rg.handler;
	p.rg.handler = (args, options) => (args.includes("--sort") ? { hang: true } : simulated(args, options));
	const running = p.search({ pattern: "hit", output_mode: "files_with_matches", head_limit: 2 });
	await p.rg.started(2);
	t.mock.timers.tick(25000);
	const text = await running;
	// The unsorted run saw the last 10000 paths; they are shown in path order, not discarded.
	assert.ok(text.startsWith("f00005.ts\nf00006.ts\n"));
	assert.ok(text.includes("stopped after 10000 entries; the path-ordered rerun timed out, so these results are an arbitrary part of the tree and offsets are not stable"));
	assert.ok(!text.includes("No matches found"));
	assert.equal(p.rg.killed, 2);
});

test("files_with_matches and count read NUL records; a path with a colon stays whole", async (t) => {
	const p = await project(t, [{ path: "a:b.ts", text: "x\nx\nx\n" }, { path: "src/a.ts", text: "x\n" }]);
	assert.equal(await p.search({ pattern: "x", output_mode: "files_with_matches" }), "a:b.ts\nsrc/a.ts");
	assert.equal(await p.search({ pattern: "x", output_mode: "count" }), "a:b.ts:3\nsrc/a.ts:1");
	assert.equal(await p.search({ pattern: "x", output_mode: "count", head_limit: 1, offset: 1 }), "src/a.ts:1");
});

test("multiline finds a block across lines and counts blocks; without it the same pattern finds the first line only", async (t) => {
	const p = await project(t, [{ path: "src/a.ts", text: "x\ny\nstart\nmiddle\nend\n" }]);
	assert.equal(await p.search({ pattern: "start.*middle", multiline: true }), "src/a.ts:3: start\nsrc/a.ts:4: middle");
	assert.equal(await p.search({ pattern: "start.*middle", multiline: true, output_mode: "count" }), "src/a.ts:1");
	assert.equal(await p.search({ pattern: "start.*middle" }), "No matches found");
	assert.equal(await p.search({ pattern: "start|middle", output_mode: "count" }), "src/a.ts:2");
});

test("output stays inside 50KiB including the footer, and the footer offset continues without a gap", async (t) => {
	const p = await project(t, [manyHits("src/a.ts", 200, "x".repeat(900))]);
	const first = await p.search({ pattern: "x" });
	assert.ok(Buffer.byteLength(first) <= 50 * 1024);
	const shown = first.split("\n").filter((line) => line.startsWith("src/a.ts:")).length;
	assert.ok(shown > 40 && shown < 200);
	assert.ok(first.includes(`Output cut at 50KiB after ${shown} matches. Use offset=${shown} to continue`));
	const next = await p.search({ pattern: "x", offset: shown });
	assert.ok(next.startsWith(`src/a.ts:${shown + 1}: `));
});

test("a line over 1000 characters is cut at a code point and marked, with a footer that names the reader tool", async (t) => {
	const p = await project(t, [{ path: "src/a.ts", text: "😀".repeat(700) }]);
	const text = await p.search({ pattern: "😀" });
	assert.ok(text.includes(" [line cut: 1000 of 1400 characters]"));
	assert.ok(!text.includes("\uFFFD"));
	assert.ok(text.includes("Read the file with rqw_readfile"));
});

test("no matches, a bad regex and a partly unreadable tree are three different answers", async (t) => {
	const p = await project(t, [{ path: "src/a.ts", text: "hit\n" }]);
	assert.equal(await p.search({ pattern: "zzz" }), "No matches found");
	await assert.rejects(p.search({ pattern: "a(" }), /regex parse error/);
	p.rg.handler = () => ({ code: 2, stderr: "rg: secret: Permission denied (os error 13)", stdout: jsonLines(fileEvents("./src/a.ts", [{ n: 1, text: "hit" }])) });
	assert.equal(await p.search({ pattern: "hit" }), "src/a.ts:1: hit\n\n[Some paths could not be searched: rg: secret: Permission denied (os error 13). Results may be missing.]");
});

test("a missing path, a file path and a folder path are told apart; a file result shows its base name", async (t) => {
	const p = await project(t, [{ path: "src/a.ts", text: "hit\n" }, { path: "b.ts", text: "hit\n" }]);
	await assert.rejects(p.search({ pattern: "x", path: "nope" }), /Path not found: .*nope/);
	assert.equal(await p.search({ pattern: "hit", path: "src/a.ts" }), "a.ts:1: hit");
	assert.equal(await p.search({ pattern: "hit", path: "src" }), "a.ts:1: hit");
	assert.equal(await p.search({ pattern: "hit" }), "b.ts:1: hit\nsrc/a.ts:1: hit");
	assert.equal(await p.search({ pattern: "hit", path: p.abs("src") }), "a.ts:1: hit");
});

test("a glob and a type together are intersected, inside the folder the glob names", async (t) => {
	const p = await project(t, [
		{ path: "src/a.py", text: "x\n" }, { path: "src/b.js", text: "x\n" }, { path: "src/deep/c.pyi", text: "x\n" },
		{ path: "other/d.py", text: "x\n" }, { path: "e.pyi", text: "x\n" },
	]);
	assert.equal(await p.search({ pattern: "x", glob: "src/*", type: "py", output_mode: "files_with_matches" }), "src/a.py");
	assert.equal(await p.search({ pattern: "x", glob: "**/src/**", type: "py", output_mode: "files_with_matches" }), "src/a.py\nsrc/deep/c.pyi");
	await assert.rejects(p.search({ pattern: "x", glob: "*", type: "nosuch" }), /unrecognized file type: nosuch/);
});

test("a scan stopped at 10000 matches says so; a larger offset is not reported as no matches", async (t) => {
	const p = await project(t, [manyHits("src/a.ts", 10005)]);
	const text = await p.search({ pattern: "hit", head_limit: 3, offset: 9999 });
	assert.ok(text.startsWith("src/a.ts:10000: hit 10000\n"));
	assert.ok(text.includes("Scan incomplete: stopped after 10000 entries"));
	const beyond = await p.search({ pattern: "hit", offset: 20000 });
	assert.ok(beyond.startsWith("No matches at offset 20000") || beyond.startsWith("No matches found before the scan stopped"));
	assert.ok(beyond.includes("Scan incomplete"));
});

test("output over the 8 MiB buffer ends the process and the answer is marked incomplete", async (t) => {
	const p = await project(t, [], () => ({ stdout: jsonLines(fileEvents("./src/a.ts", [{ n: 1, text: "hit" }])) + "z".repeat(9 * 1024 * 1024) }));
	const text = await p.search({ pattern: "hit" });
	assert.ok(text.includes("src/a.ts:1: hit"));
	assert.ok(text.includes("Scan incomplete: stopped after 8 MiB of ripgrep output"));
	// The first run and its path-ordered rerun are both stopped at the buffer.
	assert.equal(p.rg.killed, 2);
});

test("a search that outlives the backend limit is killed and marked incomplete", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const p = await project(t, [], { hang: true });
	const running = p.search({ pattern: "x" });
	await p.rg.started();
	t.mock.timers.tick(25000);
	assert.ok((await running).includes("Scan incomplete: timed out after 25 seconds"));
	assert.equal(p.rg.killed, 1);
});

test("abort before launch runs nothing; abort during the search kills the process", async (t) => {
	const p = await project(t, [], { hang: true });
	const tool: any = createRgToolDefinition(p.cwd);
	const before = new AbortController();
	before.abort();
	await assert.rejects(tool.execute("c", { pattern: "x" }, before.signal, undefined, { cwd: p.cwd }), /Operation aborted/);
	assert.equal(p.rg.calls.length, 0);
	const during = new AbortController();
	const running = tool.execute("c", { pattern: "x" }, during.signal, undefined, { cwd: p.cwd });
	await p.rg.started();
	during.abort();
	await assert.rejects(running, /Operation aborted/);
	assert.equal(p.rg.killed, 1);
});

test("parallel searches keep their own folder and parameters", async (t) => {
	const p = await project(t, [{ path: "src/f.ts", text: "Hit\n" }, { path: "lib/f.ts", text: "Hit\nhit\n" }]);
	await mkdir(p.abs("lib"));
	const [one, two] = await Promise.all([p.search({ pattern: "hit", path: "src" }), p.search({ pattern: "hit", path: "lib", "-i": true })]);
	assert.equal(one, "No matches found");
	assert.equal(two, "f.ts:1: Hit\nf.ts:2: hit");
});

test("a missing rg is installed by Pi's own ensure step once for parallel cold starts; both searches then run", async (t) => {
	const emptyAgent = await mkdtemp(join(tmpdir(), "rqw-agent-"));
	const saved = { path: process.env.PATH, agent: process.env.PI_CODING_AGENT_DIR };
	t.after(async () => {
		for (const [key, value] of [["PATH", saved.path], ["PI_CODING_AGENT_DIR", saved.agent]] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(emptyAgent, { recursive: true, force: true });
	});
	process.env.PATH = "";
	process.env.PI_CODING_AGENT_DIR = emptyAgent;
	const p = await project(t, [{ path: "src/a.ts", text: "hit\n" }]);
	const managed = join(emptyAgent, "bin", process.platform === "win32" ? "rg.exe" : "rg");
	let ensures = 0;
	// Pi's stock grep downloads rg first and only then asks whether the path is a folder.
	const createGrep: any = (_cwd: string, grepOptions: any) => ({
		async execute() {
			ensures++;
			await new Promise((resolve) => setImmediate(resolve));
			await mkdir(join(emptyAgent, "bin"), { recursive: true });
			await writeFile(managed, "binary");
			await grepOptions.operations.isDirectory("/x");
			throw new Error("Path not found");
		},
	});
	const [one, two] = await Promise.all([p.search({ pattern: "hit" }, { createGrep }), p.search({ pattern: "hit", output_mode: "count" }, { createGrep })]);
	assert.equal(one, "src/a.ts:1: hit");
	assert.equal(two, "src/a.ts:1");
	assert.equal(ensures, 1);
	assert.deepEqual(p.rg.binaries, [managed, managed]);
});

test("a failed download is Pi's error, not a search result, and the next call tries again", async (t) => {
	const emptyAgent = await mkdtemp(join(tmpdir(), "rqw-agent-"));
	const saved = { path: process.env.PATH, agent: process.env.PI_CODING_AGENT_DIR };
	t.after(async () => {
		for (const [key, value] of [["PATH", saved.path], ["PI_CODING_AGENT_DIR", saved.agent]] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(emptyAgent, { recursive: true, force: true });
	});
	process.env.PATH = "";
	process.env.PI_CODING_AGENT_DIR = emptyAgent;
	const p = await project(t, [{ path: "src/a.ts", text: "x\n" }]);
	let attempts = 0;
	const createGrep: any = () => ({ async execute() { attempts++; throw new Error("ripgrep (rg) is not available and could not be downloaded"); } });
	await assert.rejects(p.search({ pattern: "x" }, { createGrep }), /could not be downloaded/);
	await assert.rejects(p.search({ pattern: "x" }, { createGrep }), /could not be downloaded/);
	assert.equal(attempts, 2);
	assert.equal(p.rg.calls.length, 0);
});

test("a path that starts with @ names a real folder and is searched as written", async (t) => {
	const p = await project(t, [{ path: "@scope/pkg/file.ts", text: "hit\n" }, { path: "pkg/file.ts", text: "hit\n" }]);
	await mkdir(p.abs("@scope", "pkg"), { recursive: true });
	await writeFile(p.abs("@scope", "pkg", "file.ts"), "hit\n");
	assert.equal(await p.search({ pattern: "hit", path: "@scope/pkg" }), "file.ts:1: hit");
	assert.equal(await p.search({ pattern: "hit", path: "@scope/pkg/file.ts" }), "file.ts:1: hit");
	assert.equal(await p.glob({ glob_pattern: "*.ts", target_directory: "@scope" }), "pkg/file.ts");
	await assert.rejects(p.search({ pattern: "hit", path: "@nope" }), /Path not found: .*@nope/);
});

test("input paths keep Windows drive spellings apart from POSIX ones, and the pattern is never rewritten", () => {
	const win = (input: string) => resolveInputPath(input, "C:\\work\\proj", "win32");
	assert.equal(win("/c/Users/me/a b"), "C:\\Users\\me\\a b");
	assert.equal(win("/mnt/d/код/файл.ts"), "D:\\код\\файл.ts");
	assert.equal(win("/cygdrive/c"), "C:\\");
	assert.equal(win("C:\\x\\y"), "C:\\x\\y");
	assert.equal(win("\\\\server\\share\\dir"), "\\\\server\\share\\dir");
	assert.equal(win("src\\a.ts"), "C:\\work\\proj\\src\\a.ts");
	assert.equal(win("dir/file:stream"), "C:\\work\\proj\\dir\\file:stream");
	assert.equal(resolveInputPath("/c/x", "/work", "linux"), "/c/x");
	assert.equal(resolveInputPath("@scope/file.ts", "/work", "darwin"), "/work/@scope/file.ts");
});
