// scripts/deliver-check.mjs against throwaway git repos: a bare origin, a "main checkout" clone, and a fake `gh`
// on PATH that answers `gh run list`, `gh issue view` and the REST `gh api` run metadata and job listings from JSON files
// (`gh issue list` is a test failure). Global and system git config are ignored.
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
type JobRec = { name: string; status?: string; conclusion?: string | null; run_id?: number; head_sha?: string; run_attempt?: number; html_url?: string };

function setup() {
	const tmp = mkdtempSync(join(tmpdir(), "deliver-check-"));
	temps.push(tmp);
	const bin = join(tmp, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "gh.mjs"), [
		'import { appendFileSync, readFileSync, writeFileSync } from "node:fs";',
		"const a = process.argv.slice(2);",
		'appendFileSync(process.env.FAKE_GH_LOG, a.join(" ") + "\\n");',
		'if (a[0] === "issue") {',
		'\tif (process.env.FAKE_GH_ISSUE_FAIL === "1") { process.stderr.write("HTTP 502: bad gateway\\nsecond line\\n"); process.exit(1); }',
		'\tconst data = JSON.parse(readFileSync(process.env.FAKE_GH_ISSUES, "utf8"));',
		'\tif (a[1] === "list") { process.stderr.write("unexpected gh issue list\\n"); process.exit(1); }',
		'\tconst one = data.view[a[2]];',
		'\tif (!one) { process.stderr.write("GraphQL: Could not resolve to an Issue\\n"); process.exit(1); }',
		'\tprocess.stdout.write(JSON.stringify(one)); process.exit(0);',
		"}",
		'if (a[0] === "api") {',
		'	const path = a.find((x) => x.startsWith("repos/")) ?? "";',
		'	const m = /actions\\/runs\\/(\\d+)(?:\\/attempts\\/(\\d+)\\/jobs)?/.exec(path);',
		'	const all = Object.values(JSON.parse(readFileSync(process.env.FAKE_GH_RUNS, "utf8"))).flat();',
		'	const rec = m && all.find((r) => String(r.databaseId) === m[1]);',
		'	if (!rec) { process.stderr.write("HTTP 404: Not Found\\n"); process.exit(1); }',
		'	const over = JSON.parse(readFileSync(process.env.FAKE_GH_API, "utf8"));',
		"	if (!m[2]) {",
		'		let ov = over.metadata[m[1]];',
		'		if (Array.isArray(ov)) { // successive GETs of the same run answer successive entries, the last one repeats',
		'			const counter = process.env.FAKE_GH_API + ".count" + m[1];',
		'			let n = 0; try { n = Number(readFileSync(counter, "utf8")); } catch {}',
		'			writeFileSync(counter, String(n + 1)); ov = ov[Math.min(n, ov.length - 1)];',
		"		}",
		'		process.stdout.write(JSON.stringify({ id: rec.databaseId, head_sha: rec.headSha, run_attempt: 1,',
		'			status: rec.status, conclusion: rec.conclusion || null, ...ov })); process.exit(0);',
		"	}",
		'	// Jobs default to the run\'s own state; a green run has green jobs, a red or unfinished one has none green.',
		'	const done = rec.status === "completed";',
		'	const names = ["test (macos-latest, node 22.19.0)", "test (macos-latest, node 24)", "test (windows-latest, node 22.19.0)",',
		'		"test (windows-latest, node 24)", "windows-portable-git (node 22.19.0)"];',
		'	const ov = over.jobs[m[1]];',
		'	const jobs = (ov?.jobs ?? names.map((name) => ({ name }))).map((j, i) => ({ id: rec.databaseId * 100 + i, run_id: rec.databaseId,',
		'		run_attempt: Number(m[2]), head_sha: rec.headSha, status: rec.status, conclusion: done ? rec.conclusion : null,',
		'		html_url: rec.url + "/job/" + (rec.databaseId * 100 + i), ...j }));',
		'	process.stdout.write(JSON.stringify({ total_count: ov?.total_count ?? jobs.length, jobs })); process.exit(0);',
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
	writeFileSync(issuesFile, JSON.stringify({ view: {} }));
	const sessions = join(tmp, "sessions");
	mkdirSync(sessions);
	writeFileSync(join(sessions, "owner.jsonl"), JSON.stringify({ type: "message", message: {
		role: "user", content: "Keep the owner's exact words. First line second line. Caf\u00e9 with spaces.",
	} }) + "\n");
	const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
	const env = {
		...process.env, [pathKey]: bin + delimiter + process.env[pathKey],
		GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: gitconfig, FAKE_GH_RUNS: runsFile,
		FAKE_GH_ISSUES: issuesFile, MY_PI_SESSIONS: sessions, FAKE_GH_LOG: join(tmp, "gh.log"), FAKE_GH_API: join(tmp, "api.json"),
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
	// REST overrides for the fake `gh api`: defaults are synthesized from the RunRec, so a run listed as red or unfinished
	// gets jobs in that state and a green run gets green jobs.
	const api: { metadata: Record<number, object | object[]>; jobs: Record<number, { jobs?: JobRec[]; total_count?: number }> } = { metadata: {}, jobs: {} };
	const writeApi = () => writeFileSync(join(tmp, "api.json"), JSON.stringify(api));
	writeApi();
	const jobs = (runId: number, list: JobRec[] | undefined, total_count?: number) => {
		api.jobs[runId] = { ...(list ? { jobs: list } : {}), ...(total_count === undefined ? {} : { total_count }) };
		writeApi();
	};
	const metadata = (runId: number, override: object | object[]) => { api.metadata[runId] = override; writeApi(); };
	const issues = (data: { view?: Record<string, { labels: { name: string }[]; state: string }> }) =>
		writeFileSync(issuesFile, JSON.stringify({ view: data.view ?? {} }));
	// The local ci-watch files that deliver-check reads for its informational lines: status.json and the sidecar inbox.json.
	const cacheFile = (name: string, state: Record<string, unknown> | null) => {
		const file = join(repo, ".git", "ci-watch", name);
		if (state === null) { rmSync(file, { force: true }); return; }
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify(state));
	};
	const cache = (state: Record<string, unknown> | null, ageMs = 0) => cacheFile("status.json", state && {
		version: 1, repo: "o/r", fetchedAt: new Date(Date.now() - ageMs).toISOString(), runs: [], ...state });
	const inbox = (state: Record<string, unknown> | null) => cacheFile("inbox.json", state && {
		version: 1, repo: "o/r", fetchedAt: "2026-10-23T09:00:00.000Z", items: [], ...state });
	const run = (message: string, cwd = repo) => {
		const msg = join(tmp, "message.txt");
		writeFileSync(msg, message);
		const r = spawnSync(process.execPath, [SCRIPT, "task", msg], { cwd, env, encoding: "utf8" });
		return { code: r.status, out: r.stdout + r.stderr };
	};
	const ghCalls = () => { try { return readFileSync(join(tmp, "gh.log"), "utf8"); } catch { return ""; } };
	return { tmp, repo, env, git, commit, task, runs, jobs, metadata, issues, cache, inbox, ghCalls, run, sessions };
}

// Replaces the value of pcli.yml's `paths: [...]` filter, whatever the real filter lists.
const setPcliPaths = (text: string, list: string) => text.replace(/^(\s*paths:\s*)\[[^\]]*\]/m, `$1${list}`);

const ok = (id: number, headSha: string, conclusion = "success", status = "completed"): RunRec =>
	({ databaseId: id, headSha, status, conclusion, url: `https://github.com/o/r/actions/runs/${id}` });
const MAC22 = "test (macos-latest, node 22.19.0)";
const MAC24 = "test (macos-latest, node 24)";
const WIN24 = "test (windows-latest, node 24)";
// A job in one state: queued and in_progress are unfinished (no conclusion), anything else is completed with it.
const job = (name: string, state = "success", extra: Partial<JobRec> = {}): JobRec => ({ name, ...(
	["queued", "in_progress", "pending", "waiting"].includes(state) ? { status: state, conclusion: null } : { status: "completed", conclusion: state }), ...extra });
const MSG = (ci: number[]) => ["Task", "", "Review: review#7 CLEAN", "Code-review: CLEAN",
	...ci.map((id) => `CI: https://github.com/o/r/actions/runs/${id}`), "Unverified: none", ""].join("\n");

const DOC_MSG = "Docs\n\nReview: agent#7 CLEAN\nUnverified: none\n";
describe("deliver-check owner quote gate", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
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

describe("deliver-check", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
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
		assert.match(failed.out, /FAIL tests\.yml: [^\n]*macos-latest/);
		t.runs({ "tests.yml": [ok(13, head, "", "in_progress")] });
		assert.match(t.run(MSG([13])).out, /FAIL tests\.yml: [^\n]*macos-latest/);
	});

	it("applies its own headSha filter when gh ignores --commit", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.env.FAKE_GH_IGNORE_COMMIT = "1";
		t.runs({ "tests.yml": [ok(12, "0".repeat(40)), ok(11, head, "failure")] }); // newest run is for another SHA
		const wrong = t.run(MSG([12]));
		assert.equal(wrong.code, 1);
		assert.match(wrong.out, /FAIL tests\.yml: [^\n]*macos-latest/);
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

describe("deliver-check macOS gate", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
	const setupGreenMacs = (overall: { conclusion: string; status?: string } = { conclusion: "failure" }) => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head, overall.conclusion, overall.status ?? "completed")] });
		return { t, head };
	};
	const WIN_URL = "https://github.com/o/r/actions/runs/11/job/901";
	const metadataGets = (t: ReturnType<typeof setup>) => t.ghCalls().split("\n").filter((l) => /^api \S*actions\/runs\/11(\s|$)/.test(l)).length;
	const jobsGets = (t: ReturnType<typeof setup>) => t.ghCalls().split("\n").filter((l) => /actions\/runs\/11\/attempts\/1\/jobs\?per_page=100/.test(l)).length;

	it("passes when both required Mac jobs are green although the workflow failed on Windows, and prints an advisory", () => {
		const { t } = setupGreenMacs();
		t.jobs(11, [job(MAC22), job(MAC24), job(WIN24, "failure", { html_url: WIN_URL }), job("windows-portable-git (node 22.19.0)")]);
		const r = t.run(MSG([11]));
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /deliver-check PASS task/);
		assert.match(r.out, /Windows advisory: test \(windows-latest, node 24\): failure https:\/\/github\.com\/o\/r\/actions\/runs\/11\/job\/901\n[^\n]*no automatic code fix/);
		assert.equal(metadataGets(t), 2, t.ghCalls()); // metadata, jobs, then the same metadata again
		assert.equal(jobsGets(t), 1, t.ghCalls());
		assert.ok(t.ghCalls().indexOf("attempts/1/jobs") > t.ghCalls().indexOf("actions/runs/11\n"));
	});

	it("passes with the overall run in progress and Windows jobs pending when both Mac jobs are green", () => {
		const { t } = setupGreenMacs({ conclusion: "", status: "in_progress" });
		t.jobs(11, [job(MAC22), job(MAC24), job(WIN24, "in_progress", { html_url: WIN_URL }), job("test (windows-latest, node 22.19.0)", "queued")]);
		const r = t.run(MSG([11]));
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /Windows advisory: test \(windows-latest, node 24\): in_progress https:\/\/github\.com\/o\/r\/actions\/runs\/11\/job\/901/);
		assert.match(r.out, /Windows advisory: test \(windows-latest, node 22\.19\.0\): queued /);
	});

	it("requires every returned macos-latest job to be green, including extra jobs", () => {
		const name = "extra-check (macos-latest)";
		for (const status of ["failure", "in_progress", "success"]) {
			const { t } = setupGreenMacs();
			t.jobs(11, [job(MAC22), job(MAC24), job(name, status)]);
			const result = t.run(MSG([11]));
			assert.equal(result.code, status === "success" ? 0 : 1, result.out);
			if (status === "success") assert.match(result.out, /deliver-check PASS task/);
			else assert.ok(result.out.includes(`required macOS job ${name} is ${status}`), result.out);
		}
	});

	const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	it("rejects a missing, duplicated, failed, pending, queued, cancelled or skipped Mac job", () => {
		const missing = (name: string) => new RegExp(`FAIL tests\\.yml: required macOS job missing or duplicated: ${esc(name)}`);
		const state = (name: string, st: string) => new RegExp(`FAIL tests\\.yml: required macOS job ${esc(name)} is ${st}`);
		const cases: [string, JobRec[], RegExp][] = [
			["missing node 24", [job(MAC22), job(WIN24)], missing(MAC24)],
			["missing both", [job(WIN24)], missing(MAC22)],
			["duplicated", [job(MAC22), job(MAC24), job(MAC24)], missing(MAC24)],
			["failed", [job(MAC22), job(MAC24, "failure")], state(MAC24, "failure")],
			["in progress", [job(MAC22, "in_progress"), job(MAC24)], state(MAC22, "in_progress")],
			["queued", [job(MAC22), job(MAC24, "queued")], state(MAC24, "queued")],
			["cancelled", [job(MAC22, "cancelled"), job(MAC24)], state(MAC22, "cancelled")],
			["skipped", [job(MAC22), job(MAC24, "skipped")], state(MAC24, "skipped")],
			["renamed", [job(MAC22), job("test (macos-latest, node 24.1)")], missing(MAC24)],
		];
		for (const [name, list, re] of cases) {
			const { t } = setupGreenMacs();
			t.jobs(11, list);
			const r = t.run(MSG([11]));
			assert.equal(r.code, 1, `${name}\n${r.out}`);
			assert.match(r.out, re, name);
			assert.doesNotMatch(r.out, /PASS/, name);
		}
	});

	it("rejects any job of another run, head or attempt, and incomplete pagination", () => {
		const jobMismatch = /FAIL tests\.yml: job data does not match the exact head\/run\/attempt/;
		const cases: [string, JobRec[], number | undefined, RegExp][] = [
			["Mac job of another run", [job(MAC22), job(MAC24, "success", { run_id: 99 })], undefined, jobMismatch],
			["Mac job of another head", [job(MAC22, "success", { head_sha: "0".repeat(40) }), job(MAC24)], undefined, jobMismatch],
			["Mac job of another attempt", [job(MAC22), job(MAC24, "success", { run_attempt: 2 })], undefined, jobMismatch],
			["Windows job of another run", [job(MAC22), job(MAC24), job(WIN24, "success", { run_id: 99 })], undefined, jobMismatch],
			["total_count larger than jobs", [job(MAC22), job(MAC24)], 3, /FAIL tests\.yml: job list is incomplete or invalid/],
			["total_count smaller than jobs", [job(MAC22), job(MAC24)], 1, /FAIL tests\.yml: job list is incomplete or invalid/],
		];
		for (const [name, list, total, re] of cases) {
			const { t } = setupGreenMacs({ conclusion: "success" });
			t.jobs(11, list, total);
			const r = t.run(MSG([11]));
			assert.equal(r.code, 1, `${name}\n${r.out}`);
			assert.match(r.out, re, name);
			assert.doesNotMatch(r.out, /PASS/, name);
		}
	});

	it("rejects metadata of another head or run, and a rerun detected by the second metadata GET", () => {
		const first = /FAIL tests\.yml: run metadata does not match the exact head\/run\/attempt/;
		const changed = /FAIL tests\.yml: run head\/attempt changed during the fresh macOS check; check again/;
		const cases: [string, object | object[], RegExp][] = [
			["other head in the first GET", { head_sha: "0".repeat(40) }, first],
			["other id in the first GET", { id: 12 }, first],
			["invalid attempt in the first GET", { run_attempt: 0 }, first],
			["attempt changes", [{ run_attempt: 1 }, { run_attempt: 2 }], changed],
			["head changes", [{}, { head_sha: "0".repeat(40) }], changed],
			["id changes", [{}, { id: 12 }], changed],
		];
		for (const [name, override, re] of cases) {
			const { t } = setupGreenMacs({ conclusion: "success" });
			t.metadata(11, override);
			const r = t.run(MSG([11]));
			assert.equal(r.code, 1, `${name}\n${r.out}`);
			assert.match(r.out, re, name);
			assert.doesNotMatch(r.out, /PASS/, name);
		}
	});

	it("uses jobs of the attempt the metadata names", () => {
		const { t } = setupGreenMacs({ conclusion: "success" });
		t.metadata(11, { run_attempt: 2 });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 0, r.out);
		assert.match(t.ghCalls(), /actions\/runs\/11\/attempts\/2\/jobs\?per_page=100/);
	});

	it("does not take an older green run as proof when the newest run for the head is not green on Mac", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(12, head, "", "in_progress"), ok(11, head)] }); // gh lists the newest first
		t.jobs(12, [job(MAC22), job(MAC24, "in_progress")]);
		const r = t.run(MSG([11]));
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /FAIL tests\.yml: required macOS job test \(macos-latest, node 24\) is in_progress/);
		assert.doesNotMatch(t.ghCalls(), /actions\/runs\/11(\/|\s|$)/); // the older run is never fetched
	});

	it("requires the CI trailer to name the exact run even when its Macs are green", () => {
		const { t } = setupGreenMacs({ conclusion: "success" });
		const r = t.run(MSG([10]));
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /FAIL message: missing trailer "CI: https:\/\/github\.com\/o\/r\/actions\/runs\/11"/);
	});

	it("keeps requiring the whole pcli.yml run: a failed or pending Windows pcli job is not excused", () => {
		const t = setup();
		const head = t.task({ "pcli-vscode/x.js": "1\n" });
		const msg = MSG([11, 21]);
		for (const [pcli, re] of [
			[ok(21, head, "failure"), /FAIL pcli\.yml: latest run for \w+ concluded failure/],
			[ok(21, head, "", "in_progress"), /FAIL pcli\.yml: latest run for \w+ is in_progress/],
			[ok(21, head, "cancelled"), /FAIL pcli\.yml: latest run for \w+ concluded cancelled/],
		] as [RunRec, RegExp][]) {
			t.runs({ "tests.yml": [ok(11, head)], "pcli.yml": [pcli] });
			const r = t.run(msg);
			assert.equal(r.code, 1, r.out);
			assert.match(r.out, re);
		}
		t.runs({ "tests.yml": [ok(11, head, "failure")], "pcli.yml": [ok(21, head)] });
		t.jobs(11, [job(MAC22), job(MAC24), job(WIN24, "failure")]);
		assert.equal(t.run(msg).code, 0); // only tests.yml gets the Mac-only rule
	});
});

describe("deliver-check QA cache lines", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
	const redRun = { id: 5, name: "tests", path: ".github/workflows/tests.yml@refs/heads/main", head_branch: "main", status: "completed",
		conclusion: "failure", created_at: "2026-10-23T10:00:00Z", html_url: "https://github.com/o/r/actions/runs/5" };
	const passing = (t: ReturnType<typeof setup>) => {
		const head = t.task({ "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
	};

	it("reports the sidecar inbox snapshot with its date as local cached, after PASS, with no gh issue list", () => {
		const t = setup();
		passing(t);
		t.inbox({ items: [{ id: "i1", level: "red", text: "#12 [qa] tests: a.test.ts failing", url: "https://github.com/o/r/issues/12" }] });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /  QA inbox: local cached snapshot from 2026-10-23T09:00:00\.000Z; not refreshed by ci-watch, not the current state/);
		assert.match(r.out, /  QA inbox: RED #12 \[qa\] tests: a\.test\.ts failing https:\/\/github\.com\/o\/r\/issues\/12/);
		assert.ok(r.out.indexOf("PASS") < r.out.indexOf("QA inbox"));
		assert.doesNotMatch(t.ghCalls(), /issue list/);
		assert.match(t.ghCalls(), /run list/); // the exact-head CI check still uses gh
	});

	it("never says the inbox is empty or open without a snapshot; an empty snapshot says so with its date", () => {
		const t = setup();
		passing(t);
		const none = t.run(MSG([11]));
		assert.equal(none.code, 0, none.out);
		assert.match(none.out, /QA inbox: no local snapshot \(ENOENT\); run npm run ci-watch -- --refresh-inbox/);
		assert.doesNotMatch(none.out, /no items|QA open/);
		t.inbox({ items: [] });
		const empty = t.run(MSG([11]));
		assert.match(empty.out, /QA inbox: local cached snapshot from 2026-10-23T09:00:00\.000Z/);
		assert.match(empty.out, /QA inbox: no items in that snapshot/);
	});

	it("ignores the old inboxItems field of status.json and reports an invalid sidecar", () => {
		const t = setup();
		passing(t);
		t.cache({ inboxItems: [{ id: "x", level: "red", text: "old shim item", url: "" }] });
		const old = t.run(MSG([11]));
		assert.doesNotMatch(old.out, /old shim item/);
		assert.match(old.out, /QA inbox: no local snapshot/);
		for (const bad of [{ version: 2 }, { items: "x" }, { fetchedAt: "not a date" }]) {
			t.inbox(bad);
			const r = t.run(MSG([11]));
			assert.equal(r.code, 0, r.out);
			assert.match(r.out, /QA inbox: local snapshot invalid/);
		}
	});

	it("reports an absent, stale or failed status cache as one unavailable line and still passes", () => {
		const t = setup();
		passing(t);
		const absent = t.run(MSG([11]));
		assert.equal(absent.code, 0, absent.out);
		assert.match(absent.out, /main runs: unavailable \(no readable ci-watch cache: ENOENT\)/);
		t.cache({}, 181_000);
		assert.match(t.run(MSG([11])).out, /main runs: unavailable \(ci-watch cache stale or invalid\)/);
		t.cache({ error: "HTTP 502: bad gateway\nsecond line" });
		const failed = t.run(MSG([11]));
		assert.equal(failed.code, 0, failed.out);
		assert.match(failed.out, /main runs: unavailable \(ci-watch fetch failed: HTTP 502: bad gateway\)/);
		assert.doesNotMatch(failed.out, /second line/);
	});

	it("shows a red main run from the cache as extra information, also on failure, and ignores other branches", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		t.cache({ runs: [redRun, { ...redRun, id: 6, head_branch: "task", html_url: "https://x/6" }] });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL tests\.yml: no run for/);
		assert.match(r.out, /  main red \(cached\): tests failure https:\/\/github\.com\/o\/r\/actions\/runs\/5/);
		assert.doesNotMatch(r.out, /x\/6/);
	});

	it("keeps the exact-head CI gate even when the cache lists a green run for the head", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.cache({ runs: [{ ...redRun, conclusion: "success", head_sha: head, head_branch: "task" }] });
		const r = t.run(MSG([11]));
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL tests\.yml: no run for/);
	});
});

describe("deliver-check proofreading exemption and combined review", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
	const doc = (t: ReturnType<typeof setup>) => {
		const log = join(t.tmp, "doc-check.log");
		writeFileSync(log, "doc check ok\n");
		return log;
	};
	const PROOF = (log: string) => `Fix typos\n\nChange-class: proofreading\nDoc-check: ${log}\nUnverified: none\n`;
	const withMain = (t: ReturnType<typeof setup>, files: Record<string, string>) => {
		t.commit("main", files);
		t.git("push", "--quiet", "origin", "main");
	};

	it("accepts proofreading of passive documents with a Doc-check log and no review trailers", () => {
		const t = setup();
		withMain(t, { "DECISIONS.md": "a\n", "notes/n.md": "n\n" });
		t.task({ "DECISIONS.md": "b\n", "notes/n.md": "m\n" });
		const r = t.run(PROOF(doc(t)));
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /reviews: exempt \(proofreading, Doc-check /);
	});

	it("rejects a missing, relative, absent or empty Doc-check and a malformed class", () => {
		const t = setup();
		t.task({ "README.md": "changed\n" });
		const log = doc(t);
		const empty = join(t.tmp, "empty.log");
		writeFileSync(empty, "");
		for (const [msg, re] of [
			["Change-class: proofreading\nUnverified: none\n", /needs exactly one "Doc-check: <absolute local log path>"/],
			["Change-class: proofreading\nDoc-check: doc.log\nUnverified: none\n", /needs exactly one "Doc-check/],
			[`Change-class: proofreading\nDoc-check: ${join(t.tmp, "absent.log")}\nUnverified: none\n`, /is missing or empty/],
			[`Change-class: proofreading\nDoc-check: ${empty}\nUnverified: none\n`, /is missing or empty/],
			[`Change-class: typo\nDoc-check: ${log}\nUnverified: none\n`, /malformed "Change-class:"/],
		] as [string, RegExp][]) {
			const r = t.run(`Fix\n\n${msg}`);
			assert.equal(r.code, 1, r.out);
			assert.match(r.out, re);
		}
	});

	it("without the exemption a docs-only change still needs a Review trailer", () => {
		const t = setup();
		t.task({ "README.md": "changed\n" });
		const r = t.run("Docs\n\nUnverified: none\n");
		assert.equal(r.code, 1);
		assert.match(r.out, /missing trailer "Review: review#N CLEAN"/);
	});

	it("rejects proofreading of runtime prompts, config, source, workflows, agent files and added or deleted files", () => {
		for (const files of [
			{ "AGENTS.md": "x\n" }, { "INSTALL.md": "x\n" }, { "extensions/RQW-prompt/SYSTEM.md": "x\n" }, { "extensions/RQW-x/README.md": "x\n" },
			{ ".agents/reviewers/x.md": "x\n" }, { "package.json": "{}\n" }, { "src/a.js": "1\n" }, { ".github/workflows/x.yml": "a: 1\n" },
			{ "notes/new.md": "new\n" }, { "README.md": null },
		] as Record<string, string | null>[]) {
			const t = setup();
			t.task(files);
			const r = t.run(PROOF(doc(t)));
			assert.equal(r.code, 1, `${Object.keys(files)}\n${r.out}`);
			assert.match(r.out, /FAIL message: proofreading exemption: /);
		}
	});

	it("allows PROCESS.md prose but not a change of the coordinator-rules JSON", () => {
		const block = (v: string) => `intro\n\n\`\`\`json coordinator-rules\n{"v": ${v}}\n\`\`\`\n\nouter prose\n`;
		const t = setup();
		withMain(t, { "PROCESS.md": block("1") });
		t.task({ "PROCESS.md": block("1").replace("outer prose", "outer proza") });
		const ok1 = t.run(PROOF(doc(t)));
		assert.equal(ok1.code, 0, ok1.out);

		const u = setup();
		withMain(u, { "PROCESS.md": block("1") });
		u.task({ "PROCESS.md": block("2") });
		const bad = u.run(PROOF(doc(u)));
		assert.equal(bad.code, 1, bad.out);
		assert.match(bad.out, /PROCESS\.md coordinator-rules block changed or unreadable/);
	});

	it("rejects proofreading together with a QA line and keeps the owner quote gate", () => {
		const t = setup();
		withMain(t, { "DECISIONS.md": "a\n" });
		t.task({ "DECISIONS.md": "Owner: \u00abinvented words\u00bb\n" });
		const quote = t.run(PROOF(doc(t)));
		assert.equal(quote.code, 1, quote.out);
		assert.match(quote.out, /FAIL DECISIONS\.md:1 quote is not verbatim/);
		const qa = t.run(PROOF(doc(t)) + "QA: #6\nTest-review: agent#8 CLEAN\n");
		assert.match(qa.out, /"QA: #N" is not proofreading/);
	});

	const EXT = "extensions/RQW-x";
	const lines = (n: number, tag = "n") => Array.from({ length: n }, (_, i) => `${tag}${i}\n`).join(""); // distinct lines, so a rewrite counts both sides
	const COMBINED = (extra = "") => `Task\n\nCombined-review: agent#7 CLEAN\nCI: https://github.com/o/r/actions/runs/11\n${extra}Unverified: none\n`;
	// Runs one combined-review change; `base` files are first committed to main.
	const combined = (files: Record<string, string | null>, base: Record<string, string> = {}, extra = "") => {
		const t = setup();
		if (Object.keys(base).length) { t.commit("main", base); t.git("push", "--quiet", "origin", "main"); }
		const head = t.task(files);
		t.runs({ "tests.yml": [ok(11, head)] });
		t.issues({ view: { "6": { labels: [{ name: "qa-inbox" }], state: "OPEN" } } });
		return t.run(COMBINED(extra));
	};

	it("accepts Combined-review in place of Review and Code-review inside one extension", () => {
		const r = combined({ [`${EXT}/a.js`]: "1\n", [`${EXT}/sub/b.js`]: "2\n" });
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /reviews: combined agent#7 \(result and code review\)/);
		const t = setup();
		const head = t.task({ [`${EXT}/a.js`]: "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		for (const bad of ["Combined-review: agent#N CLEAN", "Combined-review: agent#7 found issues"]) {
			assert.match(t.run(COMBINED().replace("Combined-review: agent#7 CLEAN", bad)).out, /missing trailer "Review: review#N CLEAN"/);
		}
	});

	it("counts added plus deleted lines: 100 passes, 101 fails", () => {
		assert.equal(combined({ [`${EXT}/a.js`]: lines(100) }).code, 0);
		const over = combined({ [`${EXT}/a.js`]: lines(101) });
		assert.equal(over.code, 1, over.out);
		assert.match(over.out, /"Combined-review:" not allowed \(101 added plus deleted lines, at most 100\)/);
		// 60 deleted + 40 added = 100 passes; 60 + 41 = 101 fails.
		const base = { [`${EXT}/a.js`]: lines(60, "old") };
		assert.equal(combined({ [`${EXT}/a.js`]: lines(40) }, base).code, 0);
				assert.match(combined({ [`${EXT}/a.js`]: lines(41) }, base).out, /101 added plus deleted lines/);
	});

	it("allows more than five files in one extension within 100 lines", () => {
		const files = Object.fromEntries([17, 17, 17, 17, 16, 16].map((n, i) => [`${EXT}/f${i}.js`, lines(n)]));
		const r = combined(files);
		assert.equal(r.code, 0, r.out);
	});

	it("requires every changed path in the same extensions/RQW-*/ folder", () => {
		for (const [name, files] of [
			["two extensions", { "extensions/RQW-x/a.js": "1\n", "extensions/RQW-y/b.js": "1\n" }],
			["outside folder", { "extensions/RQW-x/a.js": "1\n", "src/b.js": "1\n" }],
			["ancillary doc", { "extensions/RQW-x/a.js": "1\n", "README.md": "doc\n" }],
			["extension root file", { "extensions/RQW-x": "1\n" }],
			["not an RQW folder", { "extensions/other/a.js": "1\n" }],
		] as [string, Record<string, string>][]) {
			const r = combined(files);
			assert.equal(r.code, 1, `${name}\n${r.out}`);
			assert.match(r.out, /"Combined-review:" not allowed \(changed paths are not all inside one extensions\/RQW-\*\/ folder\)/, name);
		}
	});

	it("treats a binary diff entry as ineligible", () => {
		const r = combined({ [`${EXT}/a.bin`]: "a\0b\n" });
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /"Combined-review:" not allowed \(binary or non-numeric diff entry\)/);
	});

	it("rejects Combined-review for test weakening, QA fixes and workflow changes", () => {
		const BASE_TEST = 'import assert from "node:assert/strict";\nit("a", () => {\n\tassert.equal(1, 1);\n\tassert.equal(2, 2);\n});\n';
		const testFile = `${EXT}/test/a.test.ts`;
		const weak = combined({ [testFile]: BASE_TEST.replace('it("a"', 'it.skip("a"') }, { [testFile]: BASE_TEST },
			"Test-change: why\nTest-review: agent#8 CLEAN\n");
		assert.match(weak.out, /"Combined-review:" not allowed \(test integrity rule triggered\)/);
		const qa = combined({ [`${EXT}/a.js`]: "1\n" }, {}, "QA: #6\nTest-review: agent#8 CLEAN\n");
		assert.match(qa.out, /"Combined-review:" not allowed \(\"QA: #N\" fix\)/);
		const wf = combined({ ".github/workflows/x.yml": "a: 1\n" });
		assert.match(wf.out, /"Combined-review:" not allowed .*workflow file changed/);
		for (const r of [weak, qa, wf]) assert.equal(r.code, 1, r.out);
	});

	it("ignores an ineligible Combined-review when separate review trailers are present", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n", [`${EXT}/b.js`]: "1\n" }); // outside one extension: combined is ineligible
		t.runs({ "tests.yml": [ok(11, head)] });
		const r = t.run(MSG([11]) + "Combined-review: agent#9 CLEAN\n");
		assert.equal(r.code, 0, r.out);
	});
});

describe("deliver-check test integrity", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
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

	it("QA: #N without weakening needs neither integrity trailer but still rejects malformed QA lines", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.runs({ "tests.yml": [ok(11, head)] });
		t.issues({ view: { "6": inbox } });
		const good = t.run(MSG([11]) + "QA: #6\n");
		assert.equal(good.code, 0, good.out);
		assert.match(good.out, /QA: #6 \(qa-inbox issues\)/);
		assert.doesNotMatch(good.out, /Test-review present|test integrity:/);
		const malformed = t.run(MSG([11]) + "QA: 6\n");
		assert.equal(malformed.code, 1, malformed.out);
		assert.match(malformed.out, /FAIL message: malformed line "QA: 6"/);
	});

	it("ordinary QA test or workflow changes need Test-change but not Test-review without weakening", () => {
		for (const files of [
			{ "test/new.test.ts": 'import assert from "node:assert/strict";\nit("n", () => assert.ok(true));\n' },
			{ ".github/workflows/extra.yml": "name: extra\non: workflow_dispatch\njobs: {}\n" },
		]) {
			const t = setup();
			const head = t.task(files);
			t.runs({ "tests.yml": [ok(11, head)] });
			t.issues({ view: { "6": inbox } });
			const msg = MSG([11]) + "QA: #6\n";
			const missingReason = t.run(msg);
			assert.equal(missingReason.code, 1, missingReason.out);
			assert.match(missingReason.out, /"QA: #N" with test or workflow files changed requires trailer "Test-change: <text>"/);
			assert.doesNotMatch(missingReason.out, /test integrity:|requires trailer "Test-review/);
			const good = t.run(msg + "Test-change: proves the corrected QA behavior\n");
			assert.equal(good.code, 0, good.out);
			assert.doesNotMatch(good.out, /test integrity:/);
		}
	});

	it("detected weakening requires both integrity trailers with or without a QA flag", () => {
		const t = setup();
		withMain(t, { "test/a.test.ts": BASE_TEST });
		const head = t.task({ "test/a.test.ts": BASE_TEST.replace('it("a"', 'it.skip("a"') });
		t.runs({ "tests.yml": [ok(11, head)] });
		t.issues({ view: { "6": inbox } });
		for (const qa of ["", "QA: #6\n"]) {
			for (const trailer of ["", "Test-change: approved reason\n", "Test-review: agent#8 CLEAN\n"]) {
				const result = t.run(MSG([11]) + qa + trailer);
				assert.equal(result.code, 1, result.out);
				assert.match(result.out, /FAIL test integrity: test\/a\.test\.ts adds skip\/todo: missing trailer/);
				if (!trailer.startsWith("Test-change:")) assert.ok(result.out.includes('"Test-change: <text>"'), result.out);
				if (!trailer.startsWith("Test-review:")) assert.ok(result.out.includes('"Test-review: agent#N CLEAN"'), result.out);
			}
			const good = t.run(MSG([11]) + qa + TRAILERS);
			assert.equal(good.code, 0, good.out);
			assert.match(good.out, /test integrity: 1 weakening file\(s\) accepted/);
		}
	});
});
