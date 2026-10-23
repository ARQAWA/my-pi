// scripts/deliver-check.mjs against throwaway git repos: a bare origin, a "main checkout" clone, and a fake `gh`
// on PATH that answers `gh run list`, `gh issue list` and `gh issue view` from JSON files. Global and system git config are ignored.
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

type IssueRec = { number: number; title: string; url: string; labels: { name: string }[] };
type RunRec = { databaseId: number; headSha: string; status: string; conclusion: string; url: string };

function setup() {
	const tmp = mkdtempSync(join(tmpdir(), "deliver-check-"));
	temps.push(tmp);
	const bin = join(tmp, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "gh.mjs"), [
		'import { readFileSync } from "node:fs";',
		"const a = process.argv.slice(2);",
		'if (a[0] === "issue") {',
		'\tif (process.env.FAKE_GH_ISSUE_FAIL === "1") { process.stderr.write("HTTP 502: bad gateway\\nsecond line\\n"); process.exit(1); }',
		'\tconst data = JSON.parse(readFileSync(process.env.FAKE_GH_ISSUES, "utf8"));',
		'\tif (a[1] === "list") { process.stdout.write(JSON.stringify(data.list)); process.exit(0); }',
		'\tconst one = data.view[a[2]];',
		'\tif (!one) { process.stderr.write("GraphQL: Could not resolve to an Issue\\n"); process.exit(1); }',
		'\tprocess.stdout.write(JSON.stringify(one)); process.exit(0);',
		"}",
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
	const issuesFile = join(tmp, "issues.json");
	writeFileSync(issuesFile, JSON.stringify({ list: [], view: {} }));
	const sessions = join(tmp, "sessions");
	mkdirSync(sessions);
	writeFileSync(join(sessions, "owner.jsonl"), JSON.stringify({ type: "message", message: {
		role: "user", content: "Keep the owner's exact words. First line second line. Caf\u00e9 with spaces.",
	} }) + "\n");
	const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
	const env = {
		...process.env, [pathKey]: bin + delimiter + process.env[pathKey],
		GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: gitconfig, FAKE_GH_RUNS: runsFile,
		FAKE_GH_ISSUES: issuesFile, MY_PI_SESSIONS: sessions,
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
	const issues = (data: { list?: IssueRec[]; view?: Record<string, { labels: { name: string }[]; state: string }> }) =>
		writeFileSync(issuesFile, JSON.stringify({ list: data.list ?? [], view: data.view ?? {} }));
	const run = (message: string, cwd = repo) => {
		const msg = join(tmp, "message.txt");
		writeFileSync(msg, message);
		const r = spawnSync(process.execPath, [SCRIPT, "task", msg], { cwd, env, encoding: "utf8" });
		return { code: r.status, out: r.stdout + r.stderr };
	};
	return { tmp, repo, env, git, commit, task, runs, issues, run, sessions };
}

// Replaces the value of pcli.yml's `paths: [...]` filter, whatever the real filter lists.
const setPcliPaths = (text: string, list: string) => text.replace(/^(\s*paths:\s*)\[[^\]]*\]/m, `$1${list}`);

const ok = (id: number, headSha: string, conclusion = "success", status = "completed"): RunRec =>
	({ databaseId: id, headSha, status, conclusion, url: `https://github.com/o/r/actions/runs/${id}` });
const MSG = (ci: number[]) => ["Task", "", "Review: review#7 CLEAN", "Code-review: CLEAN",
	...ci.map((id) => `CI: https://github.com/o/r/actions/runs/${id}`), "Unverified: none", ""].join("\n");

const DOC_MSG = "Docs\n\nReview: agent#7 CLEAN\nUnverified: none\n";
describe("deliver-check owner quote gate", () => {
	it("accepts NFC and whitespace-normalized owner quotes in both documents", () => {
		const t = setup();
		t.task({ "DECISIONS.md": "Owner: «Keep the owner's exact words.»\n",
			"PROCESS.md": "Owner: «Cafe\u0301   with\nspaces.»\n" });
		const result = t.run(DOC_MSG);
		assert.equal(result.code, 0, result.out);
	});

	it("accepts authentic owner ellipses and balanced nested quotes", () => {
		const t = setup();
		const message = "Wait... wait… Use «...» shorthand and «nested «quotes» too».";
		writeFileSync(join(t.sessions, "authentic.jsonl"), JSON.stringify({ type: "message",
			message: { role: "user", content: message } }) + "\n");
		t.task({ "DECISIONS.md": `Owner: «${message}»\n`, "PROCESS.md": "Owner: «Wait... wait…»\n" });
		const result = t.run(DOC_MSG);
		assert.equal(result.code, 0, result.out);
	});

	it("rejects fabricated cuts and nested quotes, empty and unbalanced guillemets", () => {
		for (const quote of ["«Keep exact words.»", "«Keep ... words.»", "«Keep … words.»",
			"«Keep «exact» words.»", "«»", "«Keep the owner's exact words.", "words.»"]) {
			const t = setup();
			t.task({ "DECISIONS.md": `Owner: ${quote}\n` });
			const result = t.run(DOC_MSG);
			assert.equal(result.code, 1, `${quote}\n${result.out}`);
			assert.match(result.out, /FAIL DECISIONS\.md:1 (quote is not verbatim|malformed quote)/);
		}
	});

	it("checks entire multiline spans when only an interior line is added", () => {
		const t = setup();
		t.commit("main", { "PROCESS.md": "  Owner: «First line\nsecond line.»\n" });
		t.git("push", "--quiet", "origin", "main");
		t.task({ "PROCESS.md": "  Owner: «First line\ninvented middle\nsecond line.»\n" });
		const result = t.run(DOC_MSG);
		assert.equal(result.code, 1, result.out);
		assert.match(result.out, /FAIL PROCESS\.md:1 quote is not verbatim/);
	});

	it("ignores unchanged historical spans and deletion-only hunks", () => {
		const t = setup();
		t.commit("main", { "DECISIONS.md": "«historical invention»\nremove me\nuntouched\n" });
		t.git("push", "--quiet", "origin", "main");
		t.task({ "DECISIONS.md": "«historical invention»\nuntouched\nnew plain text\n" });
		const result = t.run(DOC_MSG);
		assert.equal(result.code, 0, result.out);
	});

	it("reads the branch head, not main's or the working tree's document", () => {
		const t = setup();
		t.commit("main", { "DECISIONS.md": "Owner: «Keep the owner's exact words.»\n" });
		t.git("push", "--quiet", "origin", "main");
		t.task({ "DECISIONS.md": "Owner: «invented quote»\n" });
		assert.match(t.run(DOC_MSG).out, /FAIL DECISIONS\.md:1 quote is not verbatim/);
	});

	it("fails closed without session files even on a plain docs change", () => {
		const t = setup();
		t.task({ "README.md": "changed\n" });
		rmSync(t.sessions, { recursive: true });
		const result = t.run(DOC_MSG);
		assert.equal(result.code, 1, result.out);
		assert.match(result.out, /FAIL owner quotes: no session files found/);
	});

	it("uses the platform delimiter for multiple corpus directories", () => {
		const t = setup();
		t.env.MY_PI_SESSIONS = join(t.tmp, "missing") + delimiter + t.sessions;
		t.task({ "DECISIONS.md": "«Keep the owner's exact words.»\n" });
		const result = t.run(DOC_MSG);
		assert.equal(result.code, 0, result.out);
	});
});

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

	it("passes an agent result-review trailer", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		const r = t.run(MSG([11]).replace("review#7", "agent#7"));
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /reviews: agent#7; code review CLEAN/);
	});

	it("fails malformed or absent result-review trailers", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		for (const trailer of ["Review: agent#N CLEAN", "Review: agent7 CLEAN", "Review: agent#7 found issues", ""]) {
			const r = t.run(MSG([11]).replace("Review: review#7 CLEAN", trailer));
			assert.equal(r.code, 1, r.out);
			assert.match(r.out, /FAIL message: missing trailer "Review: review#N CLEAN" or "Review: agent#N CLEAN"/);
		}
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

describe("deliver-check QA open issues", () => {
	it("lists open qa-inbox issues after PASS and never fails on them", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		t.issues({ list: [{ number: 12, title: "[qa] tests: a.test.ts \u203a x (testCodeFailure)", url: "https://github.com/o/r/issues/12",
			labels: [{ name: "qa-inbox" }, { name: "qa:persistent" }] }] });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /deliver-check PASS task/);
		assert.match(r.out, /  QA open: #12 \[qa\] tests: a\.test\.ts \u203a x \(testCodeFailure\) \[qa-inbox, qa:persistent\] https:\/\/github\.com\/o\/r\/issues\/12/);
		assert.ok(r.out.indexOf("PASS") < r.out.indexOf("QA open"));
	});

	it("lists them on failure too", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		t.issues({ list: [{ number: 13, title: "t", url: "https://github.com/o/r/issues/13", labels: [{ name: "qa-inbox" }] }] });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL tests\.yml: no run for/);
		assert.match(r.out, /  QA open: #13 t \[qa-inbox\] https:\/\/github\.com\/o\/r\/issues\/13/);
	});

	it("reports an unavailable gh as one line and still passes", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		t.env.FAKE_GH_ISSUE_FAIL = "1";
		const r = t.run(MSG([11]));
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /  QA open: unavailable \(HTTP 502: bad gateway\)/);
		assert.doesNotMatch(r.out, /second line/);
	});
});

describe("deliver-check test integrity", () => {
	const TRAILERS = "Test-change: the old assertion checked a timing that is not part of the contract\nTest-review: agent#8 CLEAN\n";
	const BASE_TEST = 'import assert from "node:assert/strict";\nit("a", () => {\n\tassert.equal(1, 1);\n\tassert.equal(2, 2);\n});\n';
	const withMain = (t: ReturnType<typeof setup>, files: Record<string, string>) => {
		t.commit("main", files);
		t.git("push", "--quiet", "origin", "main");
	};

	it("fails an added skip without trailers and passes with both", () => {
		const t = setup();
		withMain(t, { "test/a.test.ts": BASE_TEST });
		const head = t.task({ "test/a.test.ts": BASE_TEST.replace('it("a"', 'it.skip("a"') });
		t.runs({ "tests.yml": [ok(11, head)] });
		const bad = t.run(MSG([11]));
		assert.equal(bad.code, 1, bad.out);
		assert.match(bad.out, /FAIL test integrity: test\/a\.test\.ts adds skip\/todo: missing trailer "Test-change: <text>" and "Test-review: agent#N CLEAN"/);
		const partial = t.run(MSG([11]) + "Test-change: why\n");
		assert.match(partial.out, /FAIL test integrity: test\/a\.test\.ts adds skip\/todo: missing trailer "Test-review: agent#N CLEAN"/);
		const good = t.run(MSG([11]) + TRAILERS);
		assert.equal(good.code, 0, good.out);
		assert.match(good.out, /test integrity: 1 weakening file\(s\) accepted/);
	});

	it("catches todo options, retries and continue-on-error", () => {
		for (const [file, text, rule] of [
			["extensions/X/test/b.test.ts", 'it("b", { todo: true }, () => {});\n', "adds skip/todo"],
			["extensions/X/test/b.test.ts", 'it("b", { skip: "windows" }, () => {});\n', "adds skip/todo"],
			["test/b.test.ts", 'describe.todo("b");\n', "adds skip/todo"],
			[".github/workflows/x.yml", "      - run: node --test --test-retry=2\n", "adds --test-retry"],
			[".github/workflows/x.yml", "    continue-on-error: true\n", "adds continue-on-error"],
		]) {
			const t = setup();
			const head = t.task({ [file]: text });
			t.runs({ "tests.yml": [ok(11, head)] });
			const r = t.run(MSG([11]));
			assert.equal(r.code, 1, `${file} ${rule}\n${r.out}`);
			assert.ok(r.out.includes(`FAIL test integrity: ${file} ${rule}`), r.out);
		}
	});

	it("ignores comments, continue-on-error false and non-test files", () => {
		const t = setup();
		const head = t.task({ "test/c.test.ts": "// it.skip(\"later\")\nit(\"c\", () => {});\n",
			".github/workflows/x.yml": "# continue-on-error: true is forbidden\njobs:\n  a:\n    continue-on-error: false\n",
			"src/skip.js": "it.skip('x');\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 0, r.out);
	});

	it("fails a raised timeout and passes a lowered or unchanged one", () => {
		const t = setup();
		const tests = readFileSync(join(ROOT, ".github", "workflows", "tests.yml"), "utf8");
		const key = /timeout-minutes: (\d+)/.exec(tests);
		assert.ok(key, "tests.yml has a timeout-minutes line");
		const raised = tests.replace(/timeout-minutes: \d+/, `timeout-minutes: ${Number(key[1]) + 20}`);
		const head = t.task({ ".github/workflows/tests.yml": raised });
		t.runs({ "tests.yml": [ok(11, head)] });
		const bad = t.run(MSG([11]));
		assert.equal(bad.code, 1, bad.out);
		assert.match(bad.out, new RegExp(`FAIL test integrity: \\.github/workflows/tests\\.yml raises timeout-minutes ${key[1]} -> ${Number(key[1]) + 20}: missing trailer`));
		assert.equal(t.run(MSG([11]) + TRAILERS).code, 0);

		const u = setup();
		const lowered = tests.replace(/timeout-minutes: \d+/, "timeout-minutes: 5");
		const uhead = u.task({ ".github/workflows/tests.yml": lowered });
		u.runs({ "tests.yml": [ok(11, uhead)] });
		assert.equal(u.run(MSG([11])).code, 0);
	});

	it("fails a raised timeout in a test file but not a moved or new one", () => {
		const t = setup();
		withMain(t, { "test/d.test.ts": "it(\"d\", { timeout: 5000 }, () => {});\nconst timeoutMs = 100;\n" });
		const head = t.task({ "test/d.test.ts": "const timeoutMs = 100;\nit(\"d\", { timeout: 60_000 }, () => {});\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /FAIL test integrity: test\/d\.test\.ts raises timeout 5000 -> 60000/);
		assert.doesNotMatch(r.out, /timeoutMs/);

		const u = setup();
		withMain(u, { "test/d.test.ts": "it(\"d\", { timeout: 5000 }, () => {});\nconst timeoutMs = 100;\n" });
		const uhead = u.task({ "test/d.test.ts": "const timeoutMs = 100;\nit(\"d\", { timeout: 5000 }, () => {});\nit(\"e\", { timeout: 90000 }, () => {});\n" });
		u.runs({ "tests.yml": [ok(11, uhead)] });
		assert.equal(u.run(MSG([11])).code, 0);
	});

	it("fails when a test file loses assertions and passes when the count holds", () => {
		const t = setup();
		withMain(t, { "test/a.test.ts": BASE_TEST });
		const head = t.task({ "test/a.test.ts": 'import assert from "node:assert/strict";\nit("a", () => {\n\tassert.equal(1, 1);\n});\n' });
		t.runs({ "tests.yml": [ok(11, head)] });
		const bad = t.run(MSG([11]));
		assert.equal(bad.code, 1, bad.out);
		assert.match(bad.out, /FAIL test integrity: test\/a\.test\.ts removes assertions \(removed 1, added 0\): missing trailer/);
		assert.equal(t.run(MSG([11]) + TRAILERS).code, 0);

		const u = setup();
		withMain(u, { "test/a.test.ts": BASE_TEST });
		const uhead = u.task({ "test/a.test.ts": BASE_TEST.replace("assert.equal(2, 2)", "assert.deepEqual([2], [2])") });
		u.runs({ "tests.yml": [ok(11, uhead)] });
		assert.equal(u.run(MSG([11])).code, 0);

		const d = setup();
		withMain(d, { "test/a.test.ts": BASE_TEST });
		const dhead = d.task({ "test/a.test.ts": null });
		d.runs({ "tests.yml": [ok(11, dhead)] });
		assert.match(d.run(MSG([11])).out, /FAIL test integrity: test\/a\.test\.ts removes assertions \(removed 2, added 0\)/);
	});

	const inbox = { labels: [{ name: "qa-inbox" }], state: "OPEN" };

	it("QA: #N needs a qa-inbox issue", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		t.issues({ view: { "5": { labels: [{ name: "bug" }], state: "OPEN" }, "6": inbox } });
		const wrong = t.run(MSG([11]) + "QA: #5\nTest-review: agent#8 CLEAN\n");
		assert.equal(wrong.code, 1, wrong.out);
		assert.match(wrong.out, /FAIL message: "QA: #5" is not a qa-inbox issue/);
		const missing = t.run(MSG([11]) + "QA: #99\nTest-review: agent#8 CLEAN\n");
		assert.match(missing.out, /FAIL message: "QA: #99": gh issue view failed: GraphQL: Could not resolve to an Issue/);
		t.env.FAKE_GH_ISSUE_FAIL = "1";
		assert.match(t.run(MSG([11]) + "QA: #6\nTest-review: agent#8 CLEAN\n").out, /FAIL message: "QA: #6": gh issue view failed: HTTP 502/);
	});

	it("QA: #N valid with Test-review passes; a missing Test-review or malformed line fails", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		t.issues({ view: { "6": inbox } });
		const good = t.run(MSG([11]) + "QA: #6\nTest-review: agent#8 CLEAN\n");
		assert.equal(good.code, 0, good.out);
		assert.match(good.out, /QA: #6 \(qa-inbox issues/);
		const noReview = t.run(MSG([11]) + "QA: #6\n");
		assert.equal(noReview.code, 1);
		assert.match(noReview.out, /FAIL message: "QA: #N" requires trailer "Test-review: agent#N CLEAN"/);
		assert.doesNotMatch(noReview.out, /requires trailer "Test-change/); // no test or workflow file changed
		const malformed = t.run(MSG([11]) + "QA: 6\nTest-review: agent#8 CLEAN\n");
		assert.match(malformed.out, /FAIL message: malformed line "QA: 6"/);
	});

	it("QA: #N with test files changed also needs Test-change", () => {
		const t = setup();
		const head = t.task({ "test/new.test.ts": 'import assert from "node:assert/strict";\nit("n", () => assert.ok(true));\n' });
		t.runs({ "tests.yml": [ok(11, head)] });
		t.issues({ view: { "6": inbox } });
		const msg = MSG([11]) + "QA: #6\nTest-review: agent#8 CLEAN\n";
		const bad = t.run(msg);
		assert.equal(bad.code, 1, bad.out);
		assert.match(bad.out, /FAIL message: "QA: #N" with test or workflow files changed requires trailer "Test-change: <text>"/);
		const good = t.run(msg + "Test-change: the new test proves the fixed race\n");
		assert.equal(good.code, 0, good.out);
	});
});
