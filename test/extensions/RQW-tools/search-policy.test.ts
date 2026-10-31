import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createGlobToolDefinition } from "../../../extensions/RQW-tools/glob.ts";
import { createRgToolDefinition } from "../../../extensions/RQW-tools/rg.ts";
import { fileEvents, jsonLines, project, type VFile } from "./rg-fake.ts";

/** The accepted noise list, written out here so that removing a name from the code fails this test. */
const ACCEPTED = [
	".git", "node_modules", "__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache", ".cache", ".tox", ".nox",
	".venv", "venv", ".turbo", ".next", ".nuxt", ".pnpm", ".yarn", ".nyc_output",
];
const dirLink = (target: string, link: string) => symlink(target, link, process.platform === "win32" ? "junction" : "dir");
const noisyTree = (): VFile[] => [
	{ path: "src/real.txt", text: "hit\n" },
	...ACCEPTED.map((name) => ({ path: `${name}/deep/inner.txt`, text: "hit\n" })),
];

test("a broad search skips every accepted noise folder, in both tools and all three output modes", async (t) => {
	const p = await project(t, noisyTree());
	assert.equal(await p.search({ pattern: "hit", glob: "**/*" }), "src/real.txt:1: hit");
	assert.equal(await p.search({ pattern: "hit" }), "src/real.txt:1: hit");
	assert.equal(await p.search({ pattern: "hit", output_mode: "files_with_matches" }), "src/real.txt");
	assert.equal(await p.search({ pattern: "hit", output_mode: "count" }), "src/real.txt:1");
	assert.equal(await p.glob({ glob_pattern: "*" }), "src/real.txt");
	assert.equal(await p.glob({ glob_pattern: "**/*.txt" }), "src/real.txt");
});

test("other hidden and build folders are not noise", async (t) => {
	const names = [".github", ".env.d", "dist", "build", "target", "out", "tmp", "logs", "bin"];
	const p = await project(t, names.map((name) => ({ path: `${name}/f.txt`, text: "hit\n" })));
	const shown = (await p.search({ pattern: "hit", output_mode: "files_with_matches" })).split("\n");
	assert.deepEqual(shown, names.map((name) => `${name}/f.txt`).sort());
	assert.deepEqual((await p.glob({ glob_pattern: "*.txt" })).split("\n").sort(), shown);
});

test("a search path inside a noise folder, or a glob that names one, searches it; a bare star does not", async (t) => {
	const p = await project(t, noisyTree());
	await mkdir(p.abs("node_modules", "deep"), { recursive: true });
	assert.equal(await p.search({ pattern: "hit", path: "node_modules/deep" }), "inner.txt:1: hit");
	assert.equal(await p.glob({ glob_pattern: "*.txt", target_directory: "node_modules" }), "deep/inner.txt");
	assert.equal(await p.search({ pattern: "hit", glob: "**/node_modules/**", output_mode: "files_with_matches" }), "node_modules/deep/inner.txt");
	assert.equal(await p.search({ pattern: "hit", glob: "{src,.venv}/**", output_mode: "files_with_matches" }), ".venv/deep/inner.txt\nsrc/real.txt");
	assert.equal(await p.glob({ glob_pattern: "**/.pytest_cache/**" }), ".pytest_cache/deep/inner.txt");
	assert.equal(await p.glob({ glob_pattern: "*" }), "src/real.txt");
});

test("a symlink into a noise folder is dropped before counts and pages; a link to ordinary code stays", async (t) => {
	const outside = await mkdtemp(join(tmpdir(), "rqw-outside-"));
	t.after(() => rm(outside, { recursive: true, force: true }));
	const files = ["deps-link/i.js", "ext-noise/d.js", "ext-lib/o.ts", "src-link/a.ts", "src/a.ts"];
	const p = await project(t, files.map((path) => ({ path, text: "hit\n" })));
	await mkdir(p.abs("node_modules", "pkg"), { recursive: true });
	await mkdir(join(outside, "node_modules", "dep"), { recursive: true });
	await mkdir(join(outside, "lib"), { recursive: true });
	await dirLink(p.abs("node_modules", "pkg"), p.abs("deps-link"));
	await dirLink(join(outside, "node_modules", "dep"), p.abs("ext-noise"));
	await dirLink(join(outside, "lib"), p.abs("ext-lib"));
	await dirLink(p.abs("src"), p.abs("src-link"));
	const kept = ["ext-lib/o.ts", "src-link/a.ts", "src/a.ts"];
	assert.equal(await p.search({ pattern: "hit", output_mode: "files_with_matches" }), kept.join("\n"));
	assert.equal(await p.search({ pattern: "hit", output_mode: "count" }), kept.map((file) => `${file}:1`).join("\n"));
	assert.equal(await p.search({ pattern: "hit" }), kept.map((file) => `${file}:1: hit`).join("\n"));
	assert.equal(await p.search({ pattern: "hit", output_mode: "files_with_matches", head_limit: 1 }).then((text) => text.split("\n")[0]), "ext-lib/o.ts");
	assert.equal(await p.search({ pattern: "hit", output_mode: "files_with_matches", offset: 3 }), "No files at offset 3; only 3 files found.");
	assert.equal(await p.glob({ glob_pattern: "*.{js,ts}" }), kept.join("\n"));
});

test("a search path that is itself a noise folder keeps results reached through links inside it", async (t) => {
	const p = await project(t, [{ path: "node_modules/link/a.js", text: "x\n" }]);
	await mkdir(p.abs("node_modules", "pkg", "lib"), { recursive: true });
	await dirLink(p.abs("node_modules", "pkg", "lib"), p.abs("node_modules", "link"));
	assert.equal(await p.search({ pattern: "x", path: "node_modules", output_mode: "files_with_matches" }), "link/a.js");
});

test("a hidden ordinary file and a file in a hidden ordinary folder are found", async (t) => {
	const p = await project(t, [{ path: ".github/ci.yml", text: "hit\n", mtime: 2 }, { path: ".env.example", text: "hit\n", mtime: 1 }]);
	assert.equal(await p.search({ pattern: "hit" }), ".env.example:1: hit\n.github/ci.yml:1: hit");
	assert.equal(await p.glob({ glob_pattern: "*" }), ".github/ci.yml\n.env.example");
});

test("a file symlink that points into a noise folder is not shown", async (t) => {
	const p = await project(t, [{ path: "link.js", text: "hit\n" }, { path: "src/ok.js", text: "hit\n" }]);
	await mkdir(p.abs("node_modules", "pkg"), { recursive: true });
	await writeFile(p.abs("node_modules", "pkg", "a.js"), "hit\n");
	await symlink(p.abs("node_modules", "pkg", "a.js"), p.abs("link.js"));
	await writeFile(p.abs("src", "ok.js"), "hit\n");
	assert.equal(await p.search({ pattern: "hit", output_mode: "files_with_matches" }), "src/ok.js");
	assert.equal(await p.glob({ glob_pattern: "*.js" }), "src/ok.js");
});

test("more than 10000 files behind a symlink into a noise folder do not push the real files out of the scan", async (t) => {
	const many = Array.from({ length: 10100 }, (_unused, i) => ({ path: `a-link/f${String(i).padStart(5, "0")}.js`, text: "hit\n" }));
	const p = await project(t, [...many, { path: "z-real/ok.js", text: "hit\n" }]);
	await mkdir(p.abs("node_modules", "pkg"), { recursive: true });
	await dirLink(p.abs("node_modules", "pkg"), p.abs("a-link"));
	assert.equal(await p.search({ pattern: "hit", output_mode: "files_with_matches" }), "z-real/ok.js");
	assert.equal(await p.glob({ glob_pattern: "*.js" }), "z-real/ok.js");
});

test("aborting after ripgrep has finished, while the symlink check runs, ends the search with the abort error", async (t) => {
	const p = await project(t, [{ path: "a-link/f.js", text: "hit\n" }]);
	await mkdir(p.abs("node_modules", "pkg"), { recursive: true });
	await dirLink(p.abs("node_modules", "pkg"), p.abs("a-link"));
	const controller = new AbortController();
	p.rg.handler = () => ({ stdout: jsonLines(fileEvents("./src/a.ts", [{ n: 1, text: "hit" }])), afterClose: () => controller.abort() });
	const tool: any = createRgToolDefinition(p.cwd);
	await assert.rejects(tool.execute("c", { pattern: "hit" }, controller.signal, undefined, { cwd: p.cwd }), /Operation aborted/);
	const glob: any = createGlobToolDefinition(p.cwd);
	const again = new AbortController();
	p.rg.handler = () => ({ stdout: "./src/a.ts\u0000", afterClose: () => again.abort() });
	await assert.rejects(glob.execute("c", { glob_pattern: "*.ts" }, again.signal, undefined, { cwd: p.cwd }), /Operation aborted/);
});
