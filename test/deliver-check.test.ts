// scripts/deliver-check.mjs against throwaway git repos: a bare origin, a "main checkout" clone, and a fake `gh`
// on PATH that answers `gh run list` from a JSON file. Global and system git config are ignored.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "deliver-check.mjs");
const temps: string[] = [];
after(() => { for (const t of temps) rmSync(t, { recursive: true, force: true }); });

type RunRec = { databaseId: number; headSha: string; status: string; conclusion: string; url: string };

function setup() {
	const tmp = mkdtempSync(join(tmpdir(), "deliver-check-"));
	temps.push(tmp);
	const bin = join(tmp, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "gh.mjs"), [
		'import { readFileSync } from "node:fs";',
		"const a = process.argv.slice(2);",
		'const wf = a[a.indexOf("--workflow") + 1], sha = a[a.indexOf("--commit") + 1];',
		'const runs = JSON.parse(readFileSync(process.env.FAKE_GH_RUNS, "utf8"))[wf] ?? [];',
		"const ignoreCommit = process.env.FAKE_GH_IGNORE_COMMIT === '1'; // a gh that does not filter by --commit",
		"process.stdout.write(JSON.stringify(ignoreCommit ? runs : runs.filter((r) => r.headSha === sha)));",
	].join("\n"));
	if (process.platform === "win32") {
		writeFileSync(join(bin, "gh.cmd"), `@"${process.execPath}" "%~dp0gh.mjs" %*\r\n`);
	} else {
		writeFileSync(join(bin, "gh"), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, "gh.mjs")}" "$@"\n`);
		chmodSync(join(bin, "gh"), 0o755);
	}
	const gitconfig = join(tmp, "gitconfig");
	writeFileSync(gitconfig, "[user]\n\tname = t\n\temail = t@example.com\n[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n");
	const runsFile = join(tmp, "runs.json");
	const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
	const env = {
		...process.env, [pathKey]: bin + delimiter + process.env[pathKey],
		GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: gitconfig, FAKE_GH_RUNS: runsFile,
	};
	const repo = join(tmp, "checkout");
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8" }).trim();
	execFileSync("git", ["init", "--quiet", "--bare", "-b", "main", join(tmp, "origin.git")], { env });
	execFileSync("git", ["clone", "--quiet", join(tmp, "origin.git"), repo], { env, stdio: "ignore" });
	git("symbolic-ref", "HEAD", "refs/heads/main");
	mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
	for (const f of ["tests.yml", "pcli.yml"]) copyFileSync(join(ROOT, ".github", "workflows", f), join(repo, ".github", "workflows", f));
	writeFileSync(join(repo, "README.md"), "x\n");
	git("add", ".");
	git("commit", "--quiet", "-m", "base");
	git("push", "--quiet", "origin", "main");

	const commit = (on: string, files: Record<string, string | null>) => { // null deletes the file
		git("checkout", "--quiet", on);
		for (const [f, text] of Object.entries(files)) {
			if (text === null) { git("rm", "--quiet", f); continue; }
			mkdirSync(dirname(join(repo, f)), { recursive: true });
			writeFileSync(join(repo, f), text);
			git("add", f);
		}
		git("commit", "--quiet", "-m", `change ${Object.keys(files).join(" ")}`);
		const sha = git("rev-parse", "HEAD");
		git("checkout", "--quiet", "main");
		return sha;
	};
	const task = (files: Record<string, string | null>) => {
		git("branch", "task", "main");
		return commit("task", files);
	};
	const runs = (r: Record<string, RunRec[]>) => writeFileSync(runsFile, JSON.stringify(r));
	runs({});
	const run = (message: string, cwd = repo) => {
		const msg = join(tmp, "message.txt");
		writeFileSync(msg, message);
		const r = spawnSync(process.execPath, [SCRIPT, "task", msg], { cwd, env, encoding: "utf8" });
		return { code: r.status, out: r.stdout + r.stderr };
	};
	return { tmp, repo, env, git, commit, task, runs, run };
}

// Replaces the value of pcli.yml's `paths: [...]` filter, whatever the real filter lists.
const setPcliPaths = (text: string, list: string) => text.replace(/^(\s*paths:\s*)\[[^\]]*\]/m, `$1${list}`);

const ok = (id: number, headSha: string, conclusion = "success", status = "completed"): RunRec =>
	({ databaseId: id, headSha, status, conclusion, url: `https://github.com/o/r/actions/runs/${id}` });
const MSG = (ci: number[]) => ["Task", "", "Review: review#7 CLEAN", "Code-review: CLEAN",
	...ci.map((id) => `CI: https://github.com/o/r/actions/runs/${id}`), "Unverified: none", ""].join("\n");

describe("deliver-check", () => {
	it("passes a branch on current main with green CI and all trailers", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /deliver-check PASS task/);
		assert.match(r.out, /tests\.yml https:\/\/github\.com\/o\/r\/actions\/runs\/11/);
	});

	it("fails a branch that does not contain the current origin/main", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.commit("main", { "src/b.js": "2\n" });
		t.git("push", "--quiet", "origin", "main");
		t.runs({ "tests.yml": [ok(11, head)] });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL task \(\w+\) does not contain origin\/main/);
	});

	it("fails when the local main has an unpushed commit the branch does not contain", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.commit("main", { "src/b.js": "2\n" }); // advanced locally, not pushed
		t.runs({ "tests.yml": [ok(11, head)] });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL main checkout HEAD \(\w+\) is not origin\/main \(\w+\) and not contained in task/);
		assert.doesNotMatch(r.out, /does not contain origin\/main/);
	});

	it("fails when the local main diverged from origin/main", () => {
		const t = setup();
		t.commit("main", { "src/b.js": "2\n" });
		t.git("push", "--quiet", "origin", "main");
		t.git("reset", "--quiet", "--hard", "HEAD~1");
		t.commit("main", { "src/c.js": "3\n" }); // local main: base + c; origin/main: base + b
		t.git("branch", "task", "origin/main");
		const head = t.commit("task", { "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL main checkout HEAD .* not contained in task/);
	});

	it("fails on missing, failed or unfinished CI for the head SHA", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(10, "0".repeat(40))] });
		assert.match(t.run(MSG([10])).out, /FAIL tests\.yml: no run for/);
		t.runs({ "tests.yml": [ok(12, head, "failure"), ok(11, head)] });
		const failed = t.run(MSG([11]));
		assert.equal(failed.code, 1);
		assert.match(failed.out, /FAIL tests\.yml: latest run for \w+ concluded failure/);
		t.runs({ "tests.yml": [ok(13, head, "", "in_progress")] });
		assert.match(t.run(MSG([13])).out, /FAIL tests\.yml: latest run for \w+ is in_progress/);
	});

	it("applies its own headSha filter when gh ignores --commit", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.env.FAKE_GH_IGNORE_COMMIT = "1";
		t.runs({ "tests.yml": [ok(12, "0".repeat(40)), ok(11, head, "failure")] }); // newest run is for another SHA
		const wrong = t.run(MSG([12]));
		assert.equal(wrong.code, 1);
		assert.match(wrong.out, /FAIL tests\.yml: latest run for \w+ concluded failure/);
		assert.doesNotMatch(wrong.out, /PASS/);
		t.runs({ "tests.yml": [ok(12, "0".repeat(40))] });
		assert.match(t.run(MSG([12])).out, /FAIL tests\.yml: no run for/);
	});

	it("fails unless the checkout it runs in has main checked out", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		const worktree = join(t.tmp, "task-worktree");
		t.git("worktree", "add", "--quiet", worktree, "task");
		const inTask = t.run(MSG([11]), worktree);
		assert.equal(inTask.code, 1);
		assert.match(inTask.out, /FAIL .*task-worktree does not have refs\/heads\/main checked out/);
		assert.doesNotMatch(inTask.out, /PASS/);
		t.git("checkout", "--quiet", "--detach", "main");
		const detached = t.run(MSG([11]));
		assert.equal(detached.code, 1);
		assert.match(detached.out, /FAIL .* does not have refs\/heads\/main checked out/);
		t.git("checkout", "--quiet", "main");
		assert.equal(t.run(MSG([11])).code, 0);
	});

	it("narrowing the pcli filter in the same change still requires the pcli run", () => {
		const t = setup();
		const pcli = readFileSync(join(ROOT, ".github", "workflows", "pcli.yml"), "utf8");
		const narrowed = setPcliPaths(pcli, "['extra/**']");
		assert.notEqual(narrowed, pcli);
		// The head's filter matches neither pcli-vscode/** nor pcli.yml; main's filter matches both.
		const head = t.task({ ".github/workflows/pcli.yml": narrowed, "pcli-vscode/x.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL pcli\.yml: no run for/);
		t.runs({ "tests.yml": [ok(11, head)], "pcli.yml": [ok(21, head)] });
		assert.equal(t.run(MSG([11, 21])).code, 0);
	});

	it("widening a filter at the head adds the requirement", () => {
		const t = setup();
		const pcli = readFileSync(join(ROOT, ".github", "workflows", "pcli.yml"), "utf8");
		const base = setPcliPaths(pcli, "['pcli-vscode/**']");
		assert.notEqual(base, pcli);
		t.commit("main", { ".github/workflows/pcli.yml": base }); // main's filter matches neither extra/** nor pcli.yml
		t.git("push", "--quiet", "origin", "main");
		const widened = setPcliPaths(base, "['pcli-vscode/**', 'extra/**']");
		const head = t.task({ ".github/workflows/pcli.yml": widened, "extra/x.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL pcli\.yml: no run for/);
	});

	it("fails clearly when a workflow file or filter is missing in main or at the head", () => {
		const t = setup();
		t.task({ ".github/workflows/pcli.yml": null, "src/a.js": "1\n" });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL cannot read \.github\/workflows\/pcli\.yml at \w+/);
		const u = setup();
		u.commit("main", { ".github/workflows/pcli.yml": "name: pcli\n" }); // main has no paths filter
		u.git("push", "--quiet", "origin", "main");
		u.task({ "src/a.js": "1\n" });
		const m = u.run(MSG([11]));
		assert.equal(m.code, 1);
		assert.match(m.out, /FAIL cannot read paths from \.github\/workflows\/pcli\.yml at \w+/);
	});

	it("needs no CI or code review for a docs-only change", () => {
		const t = setup();
		t.task({ "README.md": "y\n", "notes/n.md": "n\n", ".agents/reviewers/x.md": "r\n" });
		const r = t.run("Docs\n\nReview: review#3 CLEAN\nUnverified: none\n");
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /CI: not required/);
	});

	it("requires a green pcli.yml run when pcli-vscode changes", () => {
		const t = setup();
		const head = t.task({ "pcli-vscode/x.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		const missing = t.run(MSG([11]));
		assert.equal(missing.code, 1);
		assert.match(missing.out, /FAIL pcli\.yml: no run for/);
		t.runs({ "tests.yml": [ok(11, head)], "pcli.yml": [ok(21, head)] });
		assert.match(t.run(MSG([11])).out, /FAIL message: missing trailer "CI: https:\/\/github\.com\/o\/r\/actions\/runs\/21"/);
		const r = t.run(MSG([11, 21]));
		assert.equal(r.code, 0, r.out);
	});

	it("counts both sides of a move: code into notes/ needs CI and code review", () => {
		const t = setup();
		const code = "export const a = 1;\nexport const b = 2;\n";
		t.commit("main", { "src/a.js": code });
		t.git("push", "--quiet", "origin", "main");
		t.task({ "src/a.js": null, "notes/a.js": code });
		const r = t.run("Move\n\nReview: review#3 CLEAN\nUnverified: none\n");
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL tests\.yml: no run for/);
		assert.match(r.out, /"Code-review: CLEAN"/);
	});

	it("requires pcli.yml when a file moves out of pcli-vscode", () => {
		const t = setup();
		const code = "export const x = 1;\nexport const y = 2;\n";
		t.commit("main", { "pcli-vscode/x.js": code });
		t.git("push", "--quiet", "origin", "main");
		const head = t.task({ "pcli-vscode/x.js": null, "src/x.js": code });
		t.runs({ "tests.yml": [ok(11, head)] });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL pcli\.yml: no run for/);
	});

	it("lists every missing trailer", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		const r = t.run("Task\n\nReview: review#7 found issues\n");
		assert.equal(r.code, 1);
		for (const re of [/"CI: https:\/\/github\.com\/o\/r\/actions\/runs\/11"/, /"Review: review#N CLEAN"/,
			/"Code-review: CLEAN"/, /"Unverified: <text or none>"/]) assert.match(r.out, re);
	});

	it("fails when the main checkout has uncommitted changes", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		writeFileSync(join(t.repo, "stray.txt"), "x\n");
		const r = t.run(MSG([11]));
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL main checkout .* has uncommitted or untracked changes/);
	});
});
