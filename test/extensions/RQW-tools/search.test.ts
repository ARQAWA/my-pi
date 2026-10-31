import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { syncBuiltinESMExports, createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { PassThrough } from "node:stream";
import test, { type TestContext } from "node:test";
import { createTools } from "../../../extensions/RQW-tools/index.ts";

/** The limit of paths one listing reads, pinned here so a changed limit shows up in this test. */
const LISTING_LIMIT = 10000;

type Reply = { stdout?: string; stderr?: string; code?: number };

const childProcess: any = createRequire(import.meta.url)("node:child_process");

/** The programs rg and fd, replaced at the process spawn: every command must be answered by its exact arguments. */
class Programs {
	replies = new Map<string, Reply>();
	missingFirst = false;
	/** Commands whose process was killed by the code under test. */
	killed: string[] = [];
	private tried = new Set<string>();

	reply(program: "rg" | "fd", args: string[], reply: Reply) {
		this.replies.set(Programs.key(program, args), reply);
	}

	spawn = (binary: string, args: string[]) => {
		const program = basename(binary).replace(/\.exe$/, "");
		const key = `${program === "fdfind" ? "fd" : program} ${JSON.stringify(args)}`;
		const child: any = new EventEmitter();
		child.stdout = new PassThrough();
		child.stderr = new PassThrough();
		child.killed = false;
		child.kill = () => { child.killed = true; this.killed.push(key); };
		const isListing = !args.includes("--json") && !args.includes("--max-results");
		const attempt = `${binary}\0${key}`;
		const missing = this.missingFirst && isListing && !this.tried.has(attempt);
		this.tried.add(attempt);
		setImmediate(() => {
			if (missing) {
				child.emit("error", Object.assign(new Error(`spawn ${binary} ENOENT`), { code: "ENOENT" }));
				return;
			}
			const reply = this.replies.get(key) ?? { stderr: `unexpected command ${key}`, code: 2 };
			child.stderr.end(reply.stderr ?? "");
			child.stdout.once("end", () => setImmediate(() => child.emit("close", reply.code ?? 0)));
			child.stdout.end(reply.stdout ?? "");
		});
		return child;
	};

	/** Pi only asks whether rg or fd exist; every other command goes to the real spawnSync. */
	spawnSync = (command: string, args: string[], ...rest: unknown[]) => {
		const program = basename(command).replace(/\.exe$/, "");
		const isProbe = ["rg", "fd", "fdfind"].includes(program) && JSON.stringify(args) === JSON.stringify(["--version"]);
		return isProbe ? { status: 0, error: undefined } : (this.original.spawnSync as any)(command, args, ...rest);
	};

	private original = { spawn: childProcess.spawn, spawnSync: childProcess.spawnSync };

	static key(program: "rg" | "fd", args: string[]) {
		return `${program} ${JSON.stringify(args)}`;
	}

	install(t: TestContext) {
		const original = this.original;
		childProcess.spawn = this.spawn;
		childProcess.spawnSync = this.spawnSync;
		syncBuiltinESMExports();
		t.after(() => {
			Object.assign(childProcess, original);
			syncBuiltinESMExports();
		});
	}
}

const rgStock = (pattern: string, target: string, extra: string[] = []) =>
	["--no-config", "--json", "--line-number", "--color=never", "--hidden", ...extra, "--", pattern, target];
const rgList = (pattern: string, target: string, noIgnore = false, extra: string[] = []) =>
	["--no-config", "--files-with-matches", "--color=never", "--hidden", ...(noIgnore ? ["--no-ignore"] : []), ...extra, "--", pattern, target];
const fdStock = (pattern: string, target: string) =>
	["--glob", "--color=never", "--hidden", "--max-results", "100000", "--", pattern, target];
const fdList = (pattern: string, target: string, noIgnore = false) =>
	["--glob", "--color=never", "--hidden", ...(noIgnore ? ["--no-ignore"] : []), "--", pattern, target];

interface Project {
	cwd: string;
	abs: (...parts: string[]) => string;
	programs: Programs;
	tools: Record<string, any>;
}

/** A project folder with an empty .git folder, so the stock find sees a repository without any git run. */
async function project(t: TestContext): Promise<Project> {
	const cwd = await mkdtemp(join(tmpdir(), "rqw-search-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	await mkdir(join(cwd, ".git"));
	await mkdir(join(cwd, "sub"));
	const programs = new Programs();
	programs.install(t);
	const tools = Object.fromEntries(createTools(cwd, () => ({})).map((tool) => [tool.name, tool as any]));
	return { cwd, abs: (...parts) => join(cwd, ...parts), programs, tools };
}

async function answer(p: Project, tool: string, params: any): Promise<string> {
	const result = await p.tools[tool].execute("call-1", params, undefined, undefined, { cwd: p.cwd });
	return result.content[0].text;
}

const paths = (p: Project, files: string[]) => files.map((file) => p.abs(file)).join("\n");
const matchEvents = (p: Project, files: string[]) => files.map((file) => JSON.stringify({
	type: "match",
	data: { path: { text: p.abs(file) }, line_number: 1, lines: { text: "export x\n" } },
})).join("\n");

test("find names the ignored folder when the visible answer is empty", async (t) => {
	const p = await project(t);
	p.programs.reply("fd", fdStock("proxies_list", p.cwd), { stdout: "" });
	p.programs.reply("fd", fdList("proxies_list", p.cwd), { stdout: "" });
	p.programs.reply("fd", fdList("proxies_list", p.cwd, true), { stdout: paths(p, ["_profiles/proxies_list"]) });
	p.programs.reply("fd", fdList("proxies_list", p.abs("_profiles")), { stdout: paths(p, ["_profiles/proxies_list"]) });
	assert.equal(
		await answer(p, "find", { pattern: "proxies_list" }),
		"No files found matching pattern\n\nAlso 1 entry in ignored paths: _profiles/ 1. Set path to a listed directory to list it.",
	);
});

test("grep names the ignored folder when the visible answer is empty, with its own flags and path", async (t) => {
	const p = await project(t);
	const flags = ["--ignore-case", "--glob", "*.js"];
	const target = p.abs("sub");
	p.programs.reply("rg", rgStock("proxy", target, flags), { code: 1 });
	p.programs.reply("rg", rgList("proxy", target, false, flags), { code: 1 });
	p.programs.reply("rg", rgList("proxy", target, true, flags), { stdout: paths(p, ["sub/vendor/a.js"]) });
	p.programs.reply("rg", rgList("proxy", p.abs("sub", "vendor"), false, flags), { stdout: paths(p, ["sub/vendor/a.js"]) });
	assert.equal(
		await answer(p, "grep", { pattern: "proxy", path: "sub", ignoreCase: true, glob: "*.js" }),
		"No matches found\n\nAlso 1 file in ignored paths: vendor/ 1. Set path to a listed directory to search it.",
	);
});

test("a non-empty answer keeps its matches; the note counts hidden files and names unreachable ones", async (t) => {
	const p = await project(t);
	const visible = ["src/a.ts", "src/b.ts"];
	const hidden = ["node_modules/x/1.ts", "node_modules/y.ts", "src/secret.ts", "local.ts"];
	p.programs.reply("rg", rgStock("export", p.cwd), { stdout: matchEvents(p, visible) });
	p.programs.reply("rg", rgList("export", p.cwd), { stdout: paths(p, visible) });
	p.programs.reply("rg", rgList("export", p.cwd, true), { stdout: paths(p, [...visible, ...hidden]) });
	p.programs.reply("rg", rgList("export", p.abs("node_modules")), { stdout: paths(p, ["node_modules/x/1.ts", "node_modules/y.ts"]) });
	assert.equal(
		await answer(p, "grep", { pattern: "export" }),
		"src/a.ts:1: export x\nsrc/b.ts:1: export x\n\n"
			+ "Also 4 files in ignored paths: node_modules/ 2, local.ts, src/secret.ts. Set path to a listed directory or file to search it.",
	);
});

test("advice never names a folder whose path search still finds nothing", async (t) => {
	const p = await project(t);
	p.programs.reply("rg", rgStock("token", p.cwd), { code: 1 });
	p.programs.reply("rg", rgList("token", p.cwd), { code: 1 });
	p.programs.reply("rg", rgList("token", p.cwd, true), { stdout: paths(p, ["src/secret.txt"]) });
	p.programs.reply("rg", rgList("token", p.abs("src")), { code: 1 });
	assert.equal(
		await answer(p, "grep", { pattern: "token" }),
		"No matches found\n\nAlso 1 file in ignored paths: src/secret.txt. Set path to a listed file to search it.",
	);
});

test("find says entries, names an ignored folder entry, and does not offer a path it cannot use", async (t) => {
	const p = await project(t);
	p.programs.reply("fd", fdStock("node_modules", p.cwd), { stdout: "" });
	p.programs.reply("fd", fdList("node_modules", p.cwd), { stdout: "" });
	p.programs.reply("fd", fdList("node_modules", p.cwd, true), { stdout: p.abs("node_modules") + sep });
	p.programs.reply("fd", fdList("node_modules", p.abs("node_modules")), { stdout: "" });
	assert.equal(
		await answer(p, "find", { pattern: "node_modules" }),
		"No files found matching pattern\n\nAlso 1 entry in ignored paths: node_modules/. find cannot list the paths named one by one.",
	);
});

test("a listing cut off at the path limit gives a lower bound and is stopped", async (t) => {
	const p = await project(t);
	const many = Array.from({ length: LISTING_LIMIT + 5 }, (_, i) => `node_modules/pkg/f${i}.js`);
	p.programs.reply("rg", rgStock("x", p.cwd), { code: 1 });
	p.programs.reply("rg", rgList("x", p.cwd), { code: 1 });
	p.programs.reply("rg", rgList("x", p.cwd, true), { stdout: paths(p, many) });
	p.programs.reply("rg", rgList("x", p.abs("node_modules")), { stdout: paths(p, many) });
	assert.equal(
		await answer(p, "grep", { pattern: "x" }),
		"No matches found\n\nAlso at least 10000 files in ignored paths: node_modules/ 10000. Set path to a listed directory to search it.",
	);
	// Both cut-off listings were stopped, not read to the end.
	assert.deepEqual(p.programs.killed.sort(), [
		Programs.key("rg", rgList("x", p.cwd, true)),
		Programs.key("rg", rgList("x", p.abs("node_modules"))),
	].sort());
});

test("a cut-off visible list gives no note, since the difference would be wrong", async (t) => {
	const p = await project(t);
	const many = Array.from({ length: LISTING_LIMIT + 1 }, (_, i) => `src/f${i}.ts`);
	p.programs.reply("rg", rgStock("x", p.cwd), { stdout: matchEvents(p, ["src/f0.ts"]) });
	p.programs.reply("rg", rgList("x", p.cwd), { stdout: paths(p, many) });
	p.programs.reply("rg", rgList("x", p.cwd, true), { stdout: paths(p, ["node_modules/z.ts", ...many]) });
	assert.equal(await answer(p, "grep", { pattern: "x" }), "src/f0.ts:1: export x");
});

test("a program that is not there yet is retried after the search", async (t) => {
	const p = await project(t);
	p.programs.missingFirst = true;
	p.programs.reply("rg", rgStock("token", p.cwd), { code: 1 });
	p.programs.reply("rg", rgList("token", p.cwd), { code: 1 });
	p.programs.reply("rg", rgList("token", p.cwd, true), { stdout: paths(p, ["src/secret.txt"]) });
	p.programs.reply("rg", rgList("token", p.abs("src")), { code: 1 });
	assert.match(await answer(p, "grep", { pattern: "token" }), /\n\nAlso 1 file in ignored paths: src\/secret\.txt\./);
});

test("an fd listing that exits 1 is a failure, not a complete list", async (t) => {
	const p = await project(t);
	p.programs.reply("fd", fdStock("*.ts", p.cwd), { stdout: paths(p, ["a.ts"]) });
	p.programs.reply("fd", fdList("*.ts", p.cwd), { stdout: paths(p, ["a.ts"]) });
	p.programs.reply("fd", fdList("*.ts", p.cwd, true), { stdout: paths(p, ["a.ts", "node_modules/b.ts"]), code: 1 });
	assert.equal(await answer(p, "find", { pattern: "*.ts" }), "a.ts");
});

// Guards: these expect the answer the tools gave before the note existed, so they pass without it too.
test("guard: equal listings leave the answer as it was", async (t) => {
	const p = await project(t);
	p.programs.reply("fd", fdStock("*.ts", p.cwd), { stdout: paths(p, ["a.ts"]) });
	p.programs.reply("fd", fdList("*.ts", p.cwd), { stdout: paths(p, ["a.ts"]) });
	p.programs.reply("fd", fdList("*.ts", p.cwd, true), { stdout: paths(p, ["a.ts"]) });
	assert.equal(await answer(p, "find", { pattern: "*.ts" }), "a.ts");
});

test("guard: a failing listing never breaks the search answer", async (t) => {
	const p = await project(t);
	p.programs.reply("rg", rgStock("x", p.cwd), { stdout: matchEvents(p, ["a.ts"]) });
	p.programs.reply("rg", rgList("x", p.cwd), { stderr: "boom", code: 2 });
	p.programs.reply("rg", rgList("x", p.cwd, true), { stderr: "boom", code: 2 });
	assert.equal(await answer(p, "grep", { pattern: "x" }), "a.ts:1: export x");
});

test("the advice only speaks of the entries the note shows", async (t) => {
	const p = await project(t);
	const folders = ["d1", "d2", "d3", "d4", "d5"];
	const inFolders = folders.flatMap((dir) => [`${dir}/a.ts`, `${dir}/b.ts`]);
	p.programs.reply("rg", rgStock("x", p.cwd), { code: 1 });
	p.programs.reply("rg", rgList("x", p.cwd), { code: 1 });
	p.programs.reply("rg", rgList("x", p.cwd, true), { stdout: paths(p, [...inFolders, "local.ts"]) });
	for (const dir of folders) p.programs.reply("rg", rgList("x", p.abs(dir)), { stdout: paths(p, [`${dir}/a.ts`, `${dir}/b.ts`]) });
	assert.equal(
		await answer(p, "grep", { pattern: "x" }),
		"No matches found\n\nAlso 11 files in ignored paths: d1/ 2, d2/ 2, d3/ 2, d4/ 2, d5/ 2, 1 more. Set path to a listed directory to search it.",
	);
});
