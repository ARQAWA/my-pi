// scripts/qa-inbox.mjs: the TAP parser and signatures on TAP cut from the real failing run 39953202155 (plus a
// nested-suite failure recorded with Node's TAP reporter), the pure issue planner, and the CLI against a fake `gh`
// on PATH that serves JSON fixtures and records every call. No network.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
// @ts-ignore: plain ESM scripts without types
import { applyRun, buildIssue, jobFailure, matchArtifact, normalizeFile, parseTap, signature, signatureKey } from "../scripts/qa-inbox.mjs";
// @ts-ignore: plain ESM scripts without types
import { decodeState } from "../scripts/qa-state.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "qa-inbox.mjs");
const FIX = join(ROOT, "test", "fixtures", "qa");
const tap = (name: string) => readFileSync(join(FIX, name), "utf8");
const temps: string[] = [];
after(() => { for (const t of temps) rmSync(t, { recursive: true, force: true }); });

const sigs = (text: string) => parseTap(text).map((f: any) => signature(signatureKey(f, "tests")));

describe("TAP parser", () => {
	it("finds the real assertion failure, nested leaves and the dead test file; parents and ok tests are no leaves", () => {
		const f = parseTap(tap("tests-macos.tap"));
		assert.deepEqual(f.map((x: any) => [x.kind, x.file, x.test, x.failureType, x.errorClass, x.code]), [
			["test", "test/zz-nested.test.ts", "outer suite › inner suite › rejects a bad # value", "testCodeFailure", "AssertionError", "ERR_ASSERTION"],
			["test", "test/zz-nested.test.ts", "outer suite › throws a type error", "testCodeFailure", "TypeError", "ERR_TEST_FAILURE"],
			["test", "test/zz-evidence-fail.test.ts", "evidence proof: a deliberately failing assertion", "testCodeFailure", "AssertionError", "ERR_ASSERTION"],
			["process-exit", "test/zz-evidence-kill.test.ts", null, "testCodeFailure", null, "SIGKILL"],
		]);
		const real = f[2].errorExcerpt;
		assert.match(real, /Expected values to be strictly equal:/);
		assert.match(real, /1 !== 2/);
		assert.doesNotMatch(real, /duration_ms/);
		assert.ok(f.every((x: any) => x.errorExcerpt.split("\n").length <= 40));
		assert.equal(parseTap(tap("tests-windows.tap"))[3].code, "1");
	});

	it("an ok-only file and TODO points have no failures", () => {
		assert.deepEqual(parseTap(tap("ok-only.tap")), []);
		assert.deepEqual(parseTap("TAP version 13\nnot ok 1 - later # TODO not done\n1..1\n"), []);
	});

	it("reads CRLF TAP the same way", () => {
		const lf = tap("tests-macos.tap").replace(/\r\n/g, "\n"); // a Windows checkout may already have CRLF
		assert.deepEqual(sigs(lf.replace(/\n/g, "\r\n")), sigs(lf));
		assert.equal(sigs(lf).length, 4);
	});
});

describe("signature", () => {
	it("is the same on the macOS workspace, the Windows workspace and the Cyrillic copy path", () => {
		const mac = sigs(tap("tests-macos.tap"));
		const win = sigs(tap("tests-windows.tap"));
		const cyr = sigs(tap("tests-cyrillic.tap"));
		assert.deepEqual(cyr, mac);
		// The dead file is one signature although macOS reports SIGKILL and Windows exit code 1.
		assert.deepEqual(win, mac);
		assert.equal(new Set(mac).size, 4);
	});

	it("normalizes workspace, temp copy and file URL locations to the repo-relative file", () => {
		for (const loc of [
			"/Users/runner/work/my-pi/my-pi/test/a.test.ts:4:1",
			"D:\\\\a\\\\my-pi\\\\my-pi\\\\test\\\\a.test.ts:4:1",
			"D:\\a\\my-pi\\my-pi\\test\\a.test.ts",
			"/Users/runner/work/_temp/проба с пробелом/my-pi/test/a.test.ts:9:3",
			"D:\\a\\_temp\\проба с пробелом\\my-pi\\test\\a.test.ts:9:3",
			"file:///D:/a/my-pi/my-pi/test/a.test.ts:4:71",
			"file:///Users/runner/work/_temp/%D0%BF%D1%80%D0%BE%D0%B1%D0%B0%20x/my-pi/test/a.test.ts",
		]) assert.equal(normalizeFile(loc), "test/a.test.ts", loc);
	});

	it("keys follow the contract", () => {
		assert.equal(signatureKey({ kind: "test", file: "f", test: "a › b", failureType: "t", errorClass: "E" }, "tests"), "test|tests|f|a › b|t|E");
		assert.equal(signatureKey({ kind: "process-exit", file: "f", code: "SIGKILL" }, "tests"), "exit|tests|f");
		assert.equal(signatureKey({ kind: "job", jobFamily: "e2e", step: "Build VSIX" }, "pcli"), "job|pcli|e2e|Build VSIX");
		assert.match(signature("x"), /^[0-9a-f]{40}$/);
	});

	it("matches evidence artifacts to jobs by matrix and attempt", () => {
		const arts = ["macos-latest-node24", "macos-latest-node22.19.0", "windows-portable-git"].flatMap((c) =>
			[1, 2].map((n) => ({ name: `test-evidence-${c}-attempt${n}` })));
		assert.equal(matchArtifact("test (macos-latest, node 24)", 2, arts)?.name, "test-evidence-macos-latest-node24-attempt2");
		assert.equal(matchArtifact("test (macos-latest, node 22.19.0)", 1, arts)?.name, "test-evidence-macos-latest-node22.19.0-attempt1");
		assert.equal(matchArtifact("windows-portable-git (node 22.19.0)", 1, arts)?.name, "test-evidence-windows-portable-git-attempt1");
		assert.equal(matchArtifact("bun-codemode (windows-latest, bun 1.4.3)", 1, arts), null);
	});
});

// ----- planner -----

const REPO = "ARQAWA/my-pi";
const SHA = "a".repeat(40);
const OLD = "b".repeat(40);
const FIXSHA = "f".repeat(40);
type Run = { id: number; event: string; conclusion: string; head_sha: string; run_attempt?: number };
const run = (id: number, conclusion: string, head_sha = SHA, event = "schedule", run_attempt = 1): Run =>
	({ id, event, conclusion, head_sha, run_attempt });
const occ = (runId: number, job = "test (macos-latest, node 24)", attempt = 1, sha = SHA) => ({
	runId, attempt, job, sha, event: "schedule", at: `2026-10-23T${String(runId % 24).padStart(2, "0")}:00:00Z`,
	url: `https://github.com/${REPO}/actions/runs/${runId}`,
});
const failure = () => parseTap(tap("tests-macos.tap"))[2];
// git stub: fix commits by issue number; FIXSHA is an ancestor of every run head listed in `after`.
const gitStub = ({ fixes = {} as Record<number, any[]>, after = new Set<string>(), log = ["c1 one", "c2 two"] } = {}) => ({
	fixes: (n: number) => fixes[n] ?? [],
	isAncestor: (a: string, b: string) => (a === FIXSHA ? after.has(b) : a === b ? true : false),
	log: () => ({ lines: log }),
});
const asIssue = (number: number, action: any, state = "OPEN") => ({ number, title: action.title, body: action.body, state, labels: action.labels });

describe("planner", () => {
	it("creates one issue for one signature on several jobs and dedupes a second pass", () => {
		const runs = [run(90, "success", OLD), run(100, "failure")];
		const f = failure();
		const failures = [{ failure: f, occurrence: occ(100) }, { failure: f, occurrence: occ(100, "test (windows-latest, node 24)") }];
		const a = applyRun({ repo: REPO, workflow: "tests", failures, issues: [], runs, git: gitStub() });
		assert.equal(a.length, 1);
		assert.equal(a[0].op, "create");
		assert.equal(a[0].title, "[qa] tests: test/zz-evidence-fail.test.ts › evidence proof: a deliberately failing assertion (testCodeFailure)");
		assert.deepEqual(a[0].labels, ["qa-inbox", "qa:new"]);
		const s = decodeState(a[0].body);
		assert.equal(s.occurrences.length, 2);
		assert.equal(s.lastGreenSha, OLD);
		assert.equal(s.firstRedSha, SHA);
		assert.deepEqual(s.rate, { k: 1, n: 1 });
		assert.match(a[0].body, /c1 one\nc2 two/);
		assert.match(a[0].body, /Expected values to be strictly equal/);
		// The same run again: nothing changes. A later run with the same signature: the same issue, one more occurrence.
		const issue = asIssue(7, a[0]);
		assert.deepEqual(applyRun({ repo: REPO, workflow: "tests", failures, issues: [issue], runs, git: gitStub() }), []);
		const runs2 = [...runs, run(110, "failure")];
		const b = applyRun({ repo: REPO, workflow: "tests", failures: [{ failure: f, occurrence: occ(110) }], issues: [issue], runs: runs2, git: gitStub() });
		assert.equal(b.length, 1);
		assert.equal(b[0].op, "update");
		assert.equal(b[0].number, 7);
		assert.equal(decodeState(b[0].body).occurrences.length, 3);
		assert.deepEqual(decodeState(b[0].body).rate, { k: 2, n: 2 });
		assert.ok(b[0].labels.includes("qa:persistent"));
	});

	it("keeps a qa:claimed label when a recurring failure adds an occurrence", () => {
		const runs = [run(90, "success", OLD), run(100, "failure")];
		const f = failure();
		const created = applyRun({ repo: REPO, workflow: "tests", failures: [{ failure: f, occurrence: occ(100) }], issues: [], runs, git: gitStub() })[0];
		const claimed = { ...asIssue(7, created), labels: [...created.labels, "qa:claimed"] };
		const b = applyRun({ repo: REPO, workflow: "tests", failures: [{ failure: f, occurrence: occ(110) }], issues: [claimed],
			runs: [...runs, run(110, "failure")], git: gitStub() });
		assert.equal(b.length, 1);
		assert.equal(decodeState(b[0].body).occurrences.length, 2);
		assert.ok(b[0].labels.includes("qa:claimed"));
	});

	it("recomputes the rate from the runs list on a pass without the signature (self-healing)", () => {
		const runs = [run(90, "success", OLD), run(100, "failure"), run(110, "failure")];
		const f = failure();
		const created = applyRun({ repo: REPO, workflow: "tests", failures: [{ failure: f, occurrence: occ(100) }, { failure: f, occurrence: occ(110) }],
			issues: [], runs, git: gitStub() })[0];
		// Three later scheduled runs passed, one dispatch run and one cancelled run do not count.
		const later = [...runs, run(120, "success"), run(130, "success"), run(140, "success"), run(135, "success", SHA, "workflow_dispatch"), run(145, "cancelled")];
		const a = applyRun({ repo: REPO, workflow: "tests", failures: [], issues: [asIssue(3, created)], runs: later, git: gitStub() });
		assert.equal(a.length, 1);
		const s = decodeState(a[0].body);
		assert.deepEqual(s.rate, { k: 2, n: 5 });
		assert.equal(s.needGreen, 8);
		assert.ok(a[0].labels.includes("qa:intermittent"));
		assert.ok(!a[0].labels.includes("qa:persistent"));
		// An issue of another workflow is left alone.
		const other = { ...asIssue(4, created), body: buildIssue({ ...decodeState(created.body), workflow: "pcli" }, { repo: REPO }).body };
		assert.deepEqual(applyRun({ repo: REPO, workflow: "tests", failures: [], issues: [other], runs: later, git: gitStub() }), []);
	});

	it("closes only with a fix and needGreen green scheduled runs after it", () => {
		const runs = [run(90, "success", OLD), run(100, "failure"), run(110, "failure")];
		const f = failure();
		const created = applyRun({ repo: REPO, workflow: "tests", failures: [{ failure: f, occurrence: occ(100) }, { failure: f, occurrence: occ(110) }],
			issues: [], runs, git: gitStub() })[0];
		const issue = asIssue(5, created);
		const fixes = { 5: [{ sha: FIXSHA, subject: "Fix the thing", at: "2026-10-23T12:00:00Z" }] };
		const greens = (count: number, first = 200) => Array.from({ length: count }, (_, i) => run(first + i * 10, "success", `c${i}`.padEnd(40, "0")));
		const plan = (extra: Run[]) => applyRun({ repo: REPO, workflow: "tests", failures: [], issues: [issue], runs: [...runs, ...extra],
			git: gitStub({ fixes, after: new Set(extra.map((r) => r.head_sha)) }) });
		// No fix: six greens do not close.
		const noFix = applyRun({ repo: REPO, workflow: "tests", failures: [], issues: [issue], runs: [...runs, ...greens(6)], git: gitStub() });
		assert.ok(noFix.every((a: any) => a.state === "open"));
		const five = plan(greens(5));
		assert.equal(five[0].state, "open");
		assert.ok(five[0].labels.includes("qa:fix-merged"));
		assert.equal(decodeState(five[0].body).greenAfterFix, 5);
		// A success only after a re-run proves nothing and does not count.
		assert.equal(decodeState(plan([...greens(5), run(260, "success", "r".repeat(40), "schedule", 2)])[0].body).greenAfterFix, 5);
		const six = plan(greens(6));
		assert.equal(six[0].state, "closed");
		assert.ok(six[0].close);
		assert.match(six[0].body, /Closed by the bot: fix fffffff is on main and 6 scheduled runs/);
		// A flake with p = 0.1 (1 of 10 scheduled runs) needs 30 greens.
		const flakeRuns = [run(90, "success", OLD), run(100, "failure"), ...Array.from({ length: 9 }, (_, i) => run(101 + i, "success"))];
		const flake = applyRun({ repo: REPO, workflow: "tests", failures: [{ failure: f, occurrence: occ(100) }], issues: [], runs: flakeRuns, git: gitStub() })[0];
		assert.equal(decodeState(flake.body).needGreen, 30);
		const flakePlan = (n: number) => {
			const g = greens(n);
			return applyRun({ repo: REPO, workflow: "tests", failures: [], issues: [asIssue(5, flake)], runs: [...flakeRuns, ...g],
				git: gitStub({ fixes, after: new Set(g.map((r) => r.head_sha)) }) })[0];
		};
		assert.equal(decodeState(flakePlan(29).body).needGreen, 30);
		assert.equal(flakePlan(29).state, "open");
		assert.equal(flakePlan(30).state, "closed");
	});

	it("reopens a closed signature as qa:regressed and ignores its old fix", () => {
		const runs = [run(90, "success", OLD), run(100, "failure", OLD.replace(/^b/, "c"))];
		const f = failure();
		const created = applyRun({ repo: REPO, workflow: "tests", failures: [{ failure: f, occurrence: occ(100) }], issues: [], runs, git: gitStub() })[0];
		const closed = asIssue(9, { ...created, labels: ["qa-inbox", "qa:triaged", "qa:fix-merged"] }, "CLOSED");
		const runs2 = [...runs, run(300, "failure")];
		const fixes = { 9: [{ sha: FIXSHA, subject: "old fix", at: "x" }] };
		// The old fix is an ancestor of the new first red SHA, so it is not this episode's fix.
		const a = applyRun({ repo: REPO, workflow: "tests", failures: [{ failure: f, occurrence: occ(300) }], issues: [closed], runs: runs2,
			git: gitStub({ fixes, after: new Set([SHA]) }) });
		assert.equal(a.length, 1);
		assert.equal(a[0].op, "update");
		assert.ok(a[0].reopen);
		assert.equal(a[0].state, "open");
		assert.deepEqual(a[0].labels, ["qa-inbox", "qa:regressed", "qa:triaged"]);
		const s = decodeState(a[0].body);
		assert.equal(s.fix, null);
		assert.equal(s.firstRedSha, SHA);
		assert.equal(s.occurrences.length, 2);
		// Occurrences the closed issue already had do not reopen it.
		assert.deepEqual(applyRun({ repo: REPO, workflow: "tests", failures: [{ failure: f, occurrence: occ(100) }], issues: [closed], runs: runs2, git: gitStub() }), []);
	});

	it("a failure on a SHA that was green before is intermittent or drift, never caused by a commit", () => {
		const runs = [run(90, "success"), run(100, "failure")];
		const a = applyRun({ repo: REPO, workflow: "tests", failures: [{ failure: failure(), occurrence: occ(100) }], issues: [], runs, git: gitStub() })[0];
		assert.ok(a.labels.includes("qa:intermittent"));
		assert.match(a.body, /intermittent or environment drift/);
		assert.doesNotMatch(a.body, /Main commits in/);
	});

	it("the history baseline is the last green scheduled run, never a dispatch success", () => {
		const runs = [run(80, "success", OLD), run(90, "success", "d".repeat(40), "workflow_dispatch"), run(100, "failure")];
		const a = applyRun({ repo: REPO, workflow: "tests", failures: [{ failure: failure(), occurrence: occ(100) }], issues: [], runs, git: gitStub() })[0];
		assert.equal(decodeState(a.body).lastGreenSha, OLD);
	});

	it("an earlier run read later moves the episode start, baseline and rate window back", () => {
		const C = "c".repeat(40);
		const runs = [run(90, "success", OLD), run(150, "failure", C), run(200, "failure")];
		const f = failure();
		const created = applyRun({ repo: REPO, workflow: "tests", failures: [{ failure: f, occurrence: occ(200) }], issues: [], runs, git: gitStub() })[0];
		const s0 = decodeState(created.body);
		assert.deepEqual([s0.firstRunId, s0.firstRedSha, s0.rate], [200, SHA, { k: 1, n: 1 }]);
		const a = applyRun({ repo: REPO, workflow: "tests", failures: [{ failure: f, occurrence: occ(150, undefined, 1, C) }], issues: [asIssue(6, created)],
			runs, git: gitStub({ log: ["c3 earlier"] }) });
		const s = decodeState(a[0].body);
		assert.deepEqual([s.firstRunId, s.firstRedSha, s.firstSeen, s.lastGreenSha], [150, C, occ(150).at, OLD]);
		assert.deepEqual(s.rate, { k: 2, n: 2 });
		assert.deepEqual(s.history.lines, ["c3 earlier"]);
	});

	it("a failed setup step without TAP is an infra job signature", () => {
		const job = { name: "test (windows-latest, node 24)", conclusion: "failure", steps: [
			{ number: 1, name: "Set up job", conclusion: "success" }, { number: 4, name: "Run npm ci", conclusion: "failure" },
			{ number: 5, name: "npm test", conclusion: "skipped" }] };
		const f = jobFailure(job);
		assert.deepEqual([f.kind, f.jobFamily, f.step], ["job", "test", "Run npm ci"]);
		const a = applyRun({ repo: REPO, workflow: "tests", failures: [{ failure: f, occurrence: occ(100) }], issues: [], runs: [run(100, "failure")], git: gitStub() })[0];
		assert.equal(a.title, "[qa] tests: test › Run npm ci");
		assert.ok(a.labels.includes("qa:infra"));
	});
});

// ----- CLI with a fake gh -----

// runsById: GET runs/<id>; jobs by "<run>/<attempt>"; artifacts by run; runs: the workflow's main runs; recent: the
// repository's runs list of the catch-up; downloads by "<run>/<artifact>".
type Fake = {
	runsById: Record<string, any>; jobs: Record<string, any[]>; artifacts: Record<string, any[]>; runs: any[]; recent: any[];
	issues: any[]; downloads: Record<string, string>; fail?: string;
};

function setup(fake: Fake) {
	const tmp = mkdtempSync(join(tmpdir(), "qa-inbox-"));
	temps.push(tmp);
	const bin = join(tmp, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "gh.mjs"), [
		'import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";',
		'import { join } from "node:path";',
		"const a = process.argv.slice(2);",
		"const file = process.env.FAKE_GH_STATE;",
		'const s = JSON.parse(readFileSync(file, "utf8"));',
		'appendFileSync(process.env.FAKE_GH_CALLS, JSON.stringify(a) + "\\n");',
		'const out = (v) => { process.stdout.write(JSON.stringify(v)); process.exit(0); };',
		'if (s.fail && a.join(" ").includes(s.fail)) { process.stderr.write("HTTP 502: fake failure"); process.exit(1); }',
		'const opt = (k) => a[a.indexOf(k) + 1];',
		'const page = Number((a.find((x) => x.startsWith("page=")) ?? "page=1").slice(5));',
		'if (a[0] === "api") {',
		'  const method = a.includes("-X") ? opt("-X") : "GET";',
		'  const path = a.find((x) => x.startsWith("repos/"));',
		'  let m;',
		'  if (method === "POST" && /\\/issues$/.test(path)) { const p = JSON.parse(readFileSync(opt("--input"), "utf8")); const number = 100 + s.issues.length;',
		'    s.issues.push({ number, title: p.title, body: p.body, state: "OPEN", labels: p.labels.map((name) => ({ name })) }); writeFileSync(file, JSON.stringify(s)); out({ number }); }',
		'  if (method === "PATCH" && (m = /\\/issues\\/(\\d+)$/.exec(path))) { const p = JSON.parse(readFileSync(opt("--input"), "utf8")); const i = s.issues.find((x) => x.number === Number(m[1]));',
		'    i.body = p.body; i.labels = p.labels.map((name) => ({ name })); i.state = p.state.toUpperCase(); writeFileSync(file, JSON.stringify(s)); out(i); }',
		'  if ((m = /\\/runs\\/(\\d+)\\/attempts\\/(\\d+)\\/jobs$/.exec(path))) out({ total_count: 0, jobs: page === 1 ? s.jobs[m[1] + "/" + m[2]] ?? [] : [] });',
		'  if ((m = /\\/runs\\/(\\d+)\\/artifacts$/.exec(path))) out({ artifacts: page === 1 ? s.artifacts[m[1]] ?? [] : [] });',
		'  if (/\\/workflows\\/\\d+\\/runs$/.test(path)) out({ workflow_runs: page === 1 ? s.runs : [] });',
		'  if (/\\/actions\\/runs$/.test(path)) out({ workflow_runs: page === 1 ? s.recent : [] });',
		'  if ((m = /\\/actions\\/runs\\/(\\d+)$/.exec(path))) out(s.runsById[m[1]]);',
		'}',
		'if (a[0] === "run" && a[1] === "download") { const dir = opt("-D"); mkdirSync(dir, { recursive: true });',
		'  copyFileSync(s.downloads[a[2] + "/" + opt("-n")], join(dir, "npm-test.tap")); process.exit(0); }',
		'if (a[0] === "issue" && a[1] === "list") out(s.issues);',
		'if (a[0] === "label" && a[1] === "list") out([]);',
		'if (a[0] === "label" && a[1] === "create") process.exit(0);',
		'process.stderr.write("fake gh: unexpected " + a.join(" ")); process.exit(2);',
	].join("\n"));
	if (process.platform === "win32") {
		writeFileSync(join(bin, "gh.cmd"), `@"${process.execPath}" "%~dp0gh.mjs" %*\r\n`);
	} else {
		writeFileSync(join(bin, "gh"), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, "gh.mjs")}" "$@"\n`);
		chmodSync(join(bin, "gh"), 0o755);
	}
	const stateFile = join(tmp, "state.json");
	const callsFile = join(tmp, "calls.jsonl");
	writeFileSync(stateFile, JSON.stringify(fake));
	writeFileSync(callsFile, "");
	const gitconfig = join(tmp, "gitconfig");
	writeFileSync(gitconfig, "[user]\n\tname = t\n\temail = t@example.com\n[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n");
	const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
	const env = { ...process.env, [pathKey]: bin + delimiter + process.env[pathKey], GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: gitconfig,
		FAKE_GH_STATE: stateFile, FAKE_GH_CALLS: callsFile, GITHUB_REPOSITORY: "" };
	const repo = join(tmp, "repo");
	mkdirSync(repo);
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8" }).trim();
	git("init", "--quiet", "-b", "main");
	writeFileSync(join(repo, "a.txt"), "a\n");
	git("add", ".");
	git("commit", "--quiet", "-m", "base");
	const base = git("rev-parse", "HEAD");
	writeFileSync(join(repo, "a.txt"), "b\n");
	git("commit", "--quiet", "-am", "Feature: break the evidence test");
	const head = git("rev-parse", "HEAD");
	const cli = (...args: string[]) => {
		const r = spawnSync(process.execPath, [SCRIPT, "--repo", REPO, "--git-ref", "HEAD", ...args], { cwd: repo, env, encoding: "utf8" });
		return { code: r.status, out: r.stdout + r.stderr };
	};
	const calls = () => readFileSync(callsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]);
	const state = () => JSON.parse(readFileSync(stateFile, "utf8")) as Fake;
	const write = (f: Fake) => writeFileSync(stateFile, JSON.stringify(f));
	return { cli, calls, state, write, base, head, git, repo };
}

const mutating = (c: string[]) => (c[0] === "api" && c.includes("-X") && c[c.indexOf("-X") + 1] !== "GET")
	|| (c[0] === "issue" && c[1] !== "list") || (c[0] === "label" && c[1] !== "list");

const job = (run: number, id: number, name: string, conclusion: string, attempt: number, failedStep = "npm test") => ({
	id, name, conclusion, run_attempt: attempt, completed_at: `2026-10-23T1${attempt}:00:00Z`,
	html_url: `https://github.com/${REPO}/actions/runs/${run}/job/${id}`,
	steps: [{ number: 1, name: "Set up job", conclusion: "success" }, { number: 6, name: failedStep, conclusion: conclusion === "failure" ? "failure" : "success" }],
});
const mainRun = (id: number, conclusion: string, head_sha: string, over: any = {}) => ({
	id, name: "tests", event: "schedule", head_branch: "main", head_sha, run_attempt: 1, status: "completed", conclusion,
	workflow_id: 77, updated_at: new Date(Date.now() - 3600_000).toISOString(), ...over,
});
const evidence = (run: number) => ({
	artifacts: { [run]: [{ name: "test-evidence-macos-latest-node24-attempt1", expired: false }, { name: "test-evidence-windows-latest-node24-attempt1", expired: false }] },
	downloads: { [`${run}/test-evidence-macos-latest-node24-attempt1`]: join(FIX, "tests-macos.tap"),
		[`${run}/test-evidence-windows-latest-node24-attempt1`]: join(FIX, "tests-windows.tap") },
});

function fakeRun(base: string, head: string, over: Partial<Fake> = {}): Fake {
	return {
		runsById: { 500: mainRun(500, "success", head, { run_attempt: 2 }) },
		// Attempt 1 failed on macOS and Windows; the manual re-run (attempt 2) passed and must not hide it.
		jobs: {
			"500/1": [job(500, 1, "test (macos-latest, node 24)", "failure", 1), job(500, 2, "test (windows-latest, node 24)", "failure", 1),
				job(500, 3, "bun-codemode (windows-latest, bun 1.4.3)", "failure", 1, "Codemode script under Bun (write then read, 60 s limit)")],
			"500/2": [job(500, 11, "test (macos-latest, node 24)", "success", 2), job(500, 12, "test (windows-latest, node 24)", "success", 2),
				job(500, 13, "bun-codemode (windows-latest, bun 1.4.3)", "success", 2)],
		},
		...evidence(500),
		runs: [{ id: 500, event: "schedule", conclusion: "success", head_sha: head, run_attempt: 2 },
			{ id: 400, event: "schedule", conclusion: "success", head_sha: base, run_attempt: 1 }],
		recent: [],
		issues: [],
		...over,
	};
}

describe("CLI with a fake gh", () => {
	it("dry run reads every attempt and the evidence, prints full bodies and makes no mutating gh call", () => {
		const t = setup({} as Fake);
		t.write(fakeRun(t.base, t.head));
		const r = t.cli("--run", "500", "--dry-run");
		assert.equal(r.code, 0, r.out);
		const calls = t.calls();
		assert.deepEqual(calls.filter(mutating), []);
		assert.ok(calls.some((c) => c.join(" ").includes("attempts/1/jobs")));
		assert.ok(calls.some((c) => c.join(" ").includes("attempts/2/jobs")));
		assert.equal(calls.filter((c) => c[0] === "run" && c[1] === "download").length, 2);
		// 3 test leaves and 1 dying file shared by both jobs, 1 bun job: 5 planned issues.
		assert.equal((r.out.match(/^PLAN create/gm) ?? []).length, 5, r.out);
		assert.match(r.out, /PLAN create: \[qa\] tests: test\/zz-evidence-kill\.test\.ts process exit \[/);
		assert.match(r.out, /\| Process exit \| `SIGKILL`, `1` \|/);
		assert.match(r.out, /PLAN create: \[qa\] tests: test\/zz-evidence-fail\.test\.ts › evidence proof: a deliberately failing assertion \(testCodeFailure\)/);
		assert.match(r.out, /PLAN create: \[qa\] tests: bun-codemode › Codemode script under Bun/);
		assert.match(r.out, /Feature: break the evidence test/);
		assert.match(r.out, /qa-state:v1 /);
		assert.match(r.out, /dry run: nothing changed/);
		assert.equal(t.state().issues.length, 0);
	});

	it("a real pass creates the issues once; the same run again changes nothing", () => {
		const t = setup({} as Fake);
		t.write(fakeRun(t.base, t.head));
		const r = t.cli("--run", "500");
		assert.equal(r.code, 0, r.out);
		const issues = t.state().issues;
		assert.equal(issues.length, 5);
		const kill = decodeState(issues.find((i: any) => i.title.endsWith("zz-evidence-kill.test.ts process exit")).body);
		assert.deepEqual(kill.occurrences.map((o: any) => [o.job, o.detail]), [["test (macos-latest, node 24)", "SIGKILL"], ["test (windows-latest, node 24)", "1"]]);
		const evidence = issues.find((i: any) => i.title.includes("zz-evidence-fail"));
		const s = decodeState(evidence.body);
		assert.deepEqual(s.occurrences.map((o: any) => [o.attempt, o.job]), [[1, "test (macos-latest, node 24)"], [1, "test (windows-latest, node 24)"]]);
		assert.deepEqual(s.rate, { k: 1, n: 1 });
		assert.equal(s.lastGreenSha, t.base);
		assert.ok(t.calls().some((c) => c[0] === "label" && c[1] === "create" && c[2] === "qa:new"));
		const before = t.calls().length;
		const again = t.cli("--run", "500");
		assert.equal(again.code, 0, again.out);
		assert.deepEqual(t.calls().slice(before).filter(mutating), []);
		assert.equal(t.state().issues.length, 5);
	});

	it("ignores a branch run, refuses --force-any-branch without --dry-run, fails loudly on a gh error", () => {
		const t = setup({} as Fake);
		const f = fakeRun(t.base, t.head);
		t.write({ ...f, runsById: { 500: { ...f.runsById[500], event: "push", head_branch: "task" } } });
		const ignored = t.cli("--run", "500");
		assert.equal(ignored.code, 0, ignored.out);
		assert.match(ignored.out, /ignored/);
		assert.equal(t.calls().length, 1);
		const forced = t.cli("--run", "500", "--force-any-branch");
		assert.notEqual(forced.code, 0);
		const proof = t.cli("--run", "500", "--force-any-branch", "--dry-run");
		assert.equal(proof.code, 0, proof.out);
		assert.match(proof.out, /PLAN create/);
		t.write({ ...f, fail: "issue list" });
		const broken = t.cli("--run", "500");
		assert.equal(broken.code, 1, broken.out);
		assert.match(broken.out, /::error::qa-inbox: gh issue list failed: HTTP 502/);
	});

	it("catch-up: a missed failed main run is read by the next pass, and only once", () => {
		const t = setup({} as Fake);
		const f = fakeRun(t.base, t.head);
		const missed = mainRun(450, "failure", t.head);
		t.write({ ...f,
			runsById: { 600: mainRun(600, "success", t.head) },
			jobs: { "600/1": [job(600, 21, "test (macos-latest, node 24)", "success", 1)], "450/1": [job(450, 31, "test (macos-latest, node 24)", "failure", 1)] },
			...evidence(450),
			runs: [mainRun(600, "success", t.head), missed, mainRun(400, "success", t.base)],
			// Ignored: older than 48 h, a push, a branch run, a cancelled run.
			recent: [mainRun(600, "success", t.head), missed, mainRun(300, "failure", t.head, { updated_at: new Date(Date.now() - 72 * 3600_000).toISOString() }),
				mainRun(460, "failure", t.head, { event: "push" }), mainRun(470, "failure", t.head, { head_branch: "task" }), mainRun(480, "cancelled", t.head)],
		});
		const r = t.cli("--run", "600");
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /catch-up: run 450 /);
		assert.doesNotMatch(r.out, /catch-up: run (300|460|470|480) /);
		const issues = t.state().issues;
		assert.equal(issues.length, 4);
		assert.ok(issues.every((i: any) => decodeState(i.body).occurrences.some((o: any) => o.runId === 450)));
		const before = t.calls().length;
		const again = t.cli("--run", "600");
		assert.equal(again.code, 0, again.out);
		assert.doesNotMatch(again.out, /catch-up/);
		const later = t.calls().slice(before);
		assert.deepEqual(later.filter((c) => c.join(" ").includes("runs/450/")), []);
		assert.deepEqual(later.filter(mutating), []);
	});

	it("catch-up: a missed recurrence after the fix resets the greens and prevents closing", () => {
		const t = setup({} as Fake);
		const f = fakeRun(t.base, t.head);
		// Pass 1 records the failure of run 450.
		t.write({ ...f, runsById: { 450: mainRun(450, "failure", t.head) },
			jobs: { "450/1": [job(450, 31, "test (macos-latest, node 24)", "failure", 1)] }, ...evidence(450),
			runs: [mainRun(450, "failure", t.head), mainRun(400, "success", t.base)], recent: [] });
		assert.equal(t.cli("--run", "450").code, 0);
		const issue = t.state().issues.find((i: any) => i.title.includes("zz-evidence-fail"));
		writeFileSync(join(t.repo, "a.txt"), "fixed\n");
		t.git("commit", "--quiet", "-am", `Fix the evidence test\n\nQA: #${issue.number}`);
		const fix = t.git("rev-parse", "HEAD");
		// Seven green scheduled runs on the fix; run 535 between them failed again and no pass read it.
		const greens = [510, 520, 530, 540, 550, 560, 570].map((id) => mainRun(id, "success", fix));
		const missed = mainRun(535, "failure", fix);
		const s = t.state();
		const base = { ...s, runsById: { 570: greens[6] }, jobs: { ...s.jobs, "570/1": [job(570, 41, "test (macos-latest, node 24)", "success", 1)],
			"535/1": [job(535, 51, "test (macos-latest, node 24)", "failure", 1)] },
			artifacts: { ...s.artifacts, ...evidence(535).artifacts }, downloads: { ...s.downloads, ...evidence(535).downloads },
			runs: [...greens, missed, mainRun(450, "failure", t.head), mainRun(400, "success", t.base)] };
		// Without the catch-up the seven greens would close it.
		t.write({ ...base, recent: [] });
		const blind = t.cli("--run", "570", "--dry-run");
		assert.equal(blind.code, 0, blind.out);
		assert.match(blind.out, new RegExp(`PLAN close #${issue.number}:`));
		t.write({ ...base, recent: [greens[6], missed] });
		const r = t.cli("--run", "570");
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /catch-up: run 535 /);
		const after = t.state().issues.find((i: any) => i.number === issue.number);
		assert.equal(after.state, "OPEN");
		const st = decodeState(after.body);
		assert.ok(st.occurrences.some((o: any) => o.runId === 535));
		assert.equal(st.fix.sha, fix);
		assert.equal(st.greenAfterFix, 4);
	});
});

