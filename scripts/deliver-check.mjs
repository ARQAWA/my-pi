#!/usr/bin/env node
// Pre-merge gate (PROCESS.md, Delivery). Run from the main checkout before every squash merge:
//   npm run deliver-check -- <branch> <message-file>
// <message-file> is the planned squash commit message. Every failed check prints one line; any failure exits 1.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [branch, messageFile] = process.argv.slice(2);
if (!branch || !messageFile) {
	console.error("usage: npm run deliver-check -- <branch> <message-file>");
	process.exit(1);
}

const failures = [];
const fail = (line) => failures.push(line);
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const short = (sha) => sha.slice(0, 7);
const finish = () => {
	if (!failures.length) return;
	for (const line of failures) console.error(`FAIL ${line}`);
	for (const line of qaOpenLines()) console.error(line);
	console.error(`deliver-check: ${failures.length} failure(s), do not merge ${branch}`);
	process.exit(1);
};

// Informational only: open failure-inbox issues (red main never blocks a merge, owner decision). gh runs in the cwd,
// so it takes the repository from the checkout's remote. A gh failure is one line, never a check failure.
const ghRun = (args) => {
	const r = spawnSync("gh", args, { encoding: "utf8", shell: process.platform === "win32", timeout: 30000 });
	if (r.status === 0) return { stdout: r.stdout };
	const reason = String(r.stderr || r.error?.message || `exit ${r.status}`).trim().split(/\r?\n/)[0];
	return { reason };
};
function qaOpenLines() {
	const r = ghRun(["issue", "list", "--label", "qa-inbox", "--state", "open", "--json", "number,title,labels,url", "--limit", "50"]);
	if (r.reason !== undefined) return [`  QA open: unavailable (${r.reason})`];
	let issues;
	try {
		issues = JSON.parse(r.stdout);
	} catch (e) {
		return [`  QA open: unavailable (unreadable gh output: ${e.message})`];
	}
	if (!issues.length) return ["  QA open: none"];
	return issues.map((i) => `  QA open: #${i.number} ${i.title} [${(i.labels ?? []).map((l) => l.name ?? l).join(", ")}] ${i.url}`);
}

const root = git("rev-parse", "--show-toplevel");

// The script gates a merge into main: it must run in the checkout that has main checked out, never in the task worktree.
let onMain = false;
try { onMain = git("symbolic-ref", "-q", "HEAD") === "refs/heads/main"; } catch { /* detached HEAD */ }
if (!onMain) fail(`${root} does not have refs/heads/main checked out: run deliver-check from the main checkout`);

// 4. The main checkout has no uncommitted or untracked changes.
if (git("status", "--porcelain")) fail(`main checkout ${root} has uncommitted or untracked changes`);

try {
	git("fetch", "--quiet", "origin");
} catch (e) {
	fail(`git fetch origin failed: ${String(e.stderr || e.message).trim()}`);
	finish();
}
let head, main, local;
try {
	head = git("rev-parse", "--verify", `${branch}^{commit}`);
	main = git("rev-parse", "--verify", "origin/main^{commit}");
	local = git("rev-parse", "--verify", "HEAD^{commit}");
} catch {
	fail(`cannot resolve ${branch}, origin/main or HEAD of the main checkout`);
	finish();
}

// 1. The branch head contains the current origin/main and the merge destination (this checkout's HEAD),
// so the tested tree is the tree that gets merged.
const contains = (base) => spawnSync("git", ["merge-base", "--is-ancestor", base, head]).status === 0;
if (!contains(main)) {
	fail(`${branch} (${short(head)}) does not contain origin/main (${short(main)}): rebase on current main and retest`);
}
if (local !== main && !contains(local)) {
	fail(`main checkout HEAD (${short(local)}) is not origin/main (${short(main)}) and not contained in ${branch}: `
		+ "push or drop the local commits, then rebase and retest");
}

// 2. Required CI: the workflows' own path filters decide whether the change needs them. Both versions of each
// filter count, origin/main's and the branch head's, so a branch cannot narrow a filter in the change it gates.
// A workflow file or filter missing in either version is a failure, not a guess.
function workflowPaths(rev, file, key) {
	let text;
	try {
		text = git("show", `${rev}:.github/workflows/${file}`);
	} catch (e) {
		fail(`cannot read .github/workflows/${file} at ${short(rev)}: ${String(e.stderr || e.message).trim()}`);
		finish();
	}
	const m = new RegExp(`^\\s*${key}:\\s*\\[([^\\]]*)\\]`, "m").exec(text);
	if (!m) {
		fail(`cannot read ${key} from .github/workflows/${file} at ${short(rev)}`);
		finish();
	}
	return m[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
}
// GitHub path filter globs: ** crosses directories, * and ? do not.
const globRe = (glob) => new RegExp(`^${glob.split(/(\*\*|\*|\?)/).map((p) =>
	p === "**" ? ".*" : p === "*" ? "[^/]*" : p === "?" ? "[^/]" : p.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("")}$`);
const matchesAny = (file, globs) => globs.some((g) => globRe(g).test(file));

// --no-renames: a move lists both its source and its destination, so moving code into notes/ is not docs-only.
const changed = git("diff", "-z", "--no-renames", "--name-only", `${main}...${head}`).split("\0").filter(Boolean);
const ignoredBy = [main, head].map((rev) => workflowPaths(rev, "tests.yml", "paths-ignore"));
const pcliPaths = [main, head].map((rev) => workflowPaths(rev, "pcli.yml", "paths"));
const codeChanged = changed.some((f) => !ignoredBy.every((globs) => matchesAny(f, globs))); // docs-only if both ignore it
const required = [];
if (codeChanged) required.push("tests.yml");
if (changed.some((f) => pcliPaths.some((globs) => matchesAny(f, globs)))) required.push("pcli.yml");

// gh is gh.exe on Windows; the shell there also finds a .cmd shim. Arguments are fixed words and a hex SHA.
function latestRun(workflow) {
	const args = ["run", "list", "--workflow", workflow, "--commit", head, "--limit", "20",
		"--json", "databaseId,headSha,status,conclusion,url"];
	const r = spawnSync("gh", args, { encoding: "utf8", shell: process.platform === "win32" });
	if (r.status !== 0) {
		fail(`${workflow}: gh run list failed: ${String(r.stderr || r.error?.message || "").trim()}`);
		return null;
	}
	const run = JSON.parse(r.stdout).find((x) => x.headSha === head); // gh lists the newest run first
	if (!run) fail(`${workflow}: no run for ${short(head)}; push the branch and wait for CI`);
	else if (run.status !== "completed") fail(`${workflow}: latest run for ${short(head)} is ${run.status}: ${run.url}`);
	else if (run.conclusion !== "success") fail(`${workflow}: latest run for ${short(head)} concluded ${run.conclusion}: ${run.url}`);
	else return run;
	return null;
}

// 3. The squash message records clean reviews, the CI runs and what was not verified live.
let lines = [];
try {
	lines = readFileSync(messageFile, "utf8").split(/\r?\n/).map((l) => l.trimEnd());
} catch (e) {
	fail(`cannot read message file ${messageFile}: ${e.message}`);
}
const has = (re) => lines.some((l) => re.test(l));
const reviews = lines.filter((l) => /^Review: (?:review|agent)#\d+ CLEAN$/.test(l)).map((l) => l.slice(8, -6));
const ciIds = lines.map((l) => /^CI: \S*\/actions\/runs\/(\d+)/.exec(l)?.[1]).filter(Boolean);

const passed = [];
for (const workflow of required) {
	const run = latestRun(workflow);
	if (run && !ciIds.includes(String(run.databaseId))) fail(`message: missing trailer "CI: ${run.url}"`);
	if (run) passed.push(`${workflow} ${run.url}`);
	if (!run && !ciIds.length) fail(`message: missing trailer "CI: <run url>" for ${workflow}`);
}
// 3b. Test integrity: a change that weakens tests or workflows needs a recorded reason and an independent
// test-integrity review. `QA: #N` lines tie the squash to failure-inbox issues and carry the same requirement.
const isTestFile = (f) => /(^|\/)test\//.test(f) || /(^|\/)[^/]*\.test\.[^/]*$/.test(f);
const isWorkflowFile = (f) => f.startsWith(".github/workflows/");
const SKIP_RES = [/\.(?:skip|todo)\s*\(/, /\{\s*(?:skip|todo)\s*:/, /\b(?:skip|todo)\s*:\s*(?:true|['"])/];
const TIMEOUT_RE = /\b(timeout-minutes|timeout_ms|timeoutMs|timeout)["']?\s*[:=]\s*(\d[\d_]*)/g;
const ASSERT_RE = /\bassert\b|\bexpect\(/;
const timeouts = (texts) => {
	const byKey = new Map();
	for (const t of texts) for (const m of t.matchAll(TIMEOUT_RE)) {
		byKey.set(m[1], [...(byKey.get(m[1]) ?? []), Number(m[2].replaceAll("_", ""))]);
	}
	return byKey;
};
// Rules the added and removed lines of one file break. Comment lines count for nothing.
function weakeningRules(file) {
	let diff;
	try {
		diff = execFileSync("git", ["diff", "--no-renames", "--no-color", "-U0", `${main}...${head}`, "--", file],
			{ encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
	} catch (e) {
		fail(`test integrity: cannot diff ${file}: ${String(e.stderr || e.message).trim()}`);
		return [];
	}
	const comment = isWorkflowFile(file) ? /^\s*#/ : /^\s*(?:\/\/|\/\*|\*)/;
	const added = [], removed = [];
	let inHunk = false;
	for (const raw of diff.split(/\r?\n/)) {
		if (raw.startsWith("@@")) { inHunk = true; continue; }
		if (!inHunk || (raw[0] !== "+" && raw[0] !== "-")) continue;
		const text = raw.slice(1);
		if (comment.test(text)) continue;
		(raw[0] === "+" ? added : removed).push(text);
	}
	const rules = [];
	if (added.some((l) => SKIP_RES.some((re) => re.test(l)))) rules.push("adds skip/todo");
	if (added.some((l) => /--test-retry\b/.test(l))) rules.push("adds --test-retry");
	if (added.some((l) => /\bcontinue-on-error\b(?!["']?\s*:\s*false\b)/.test(l))) rules.push("adds continue-on-error");
	// Equal values on both sides are unchanged or moved lines; a remaining added value above a remaining removed one is a raise.
	const was = timeouts(removed);
	for (const [key, nows] of timeouts(added)) {
		const olds = [...(was.get(key) ?? [])];
		const fresh = nows.filter((n) => { const i = olds.indexOf(n); if (i < 0) return true; olds.splice(i, 1); return false; });
		if (fresh.length && olds.length && Math.max(...fresh) > Math.min(...olds)) {
			rules.push(`raises ${key} ${Math.min(...olds)} -> ${Math.max(...fresh)}`);
		}
	}
	if (!isWorkflowFile(file)) {
		const asserts = (ls) => ls.filter((l) => !/^\s*import\b/.test(l) && ASSERT_RE.test(l)).length;
		if (asserts(removed) > asserts(added)) rules.push(`removes assertions (removed ${asserts(removed)}, added ${asserts(added)})`);
	}
	return rules;
}
const hasTestChange = has(/^Test-change: \S/);
const hasTestReview = has(/^Test-review: (?:review|agent)#\d+ CLEAN$/);
const weak = changed.filter((f) => isTestFile(f) || isWorkflowFile(f)).map((f) => ({ file: f, rules: weakeningRules(f) }))
	.filter((w) => w.rules.length);
for (const w of weak) {
	const missing = [];
	if (!hasTestChange) missing.push('"Test-change: <text>"');
	if (!hasTestReview) missing.push('"Test-review: agent#N CLEAN"');
	if (missing.length) fail(`test integrity: ${w.file} ${w.rules.join("; ")}: missing trailer ${missing.join(" and ")}`);
}
const qaIssues = [];
for (const l of lines.filter((x) => x.startsWith("QA:"))) {
	const n = /^QA: #(\d+)$/.exec(l)?.[1];
	if (!n) fail(`message: malformed line "${l}", expected "QA: #<issue number>"`);
	else if (!qaIssues.includes(n)) qaIssues.push(n);
}
if (qaIssues.length) {
	if (!hasTestReview) fail('message: "QA: #N" requires trailer "Test-review: agent#N CLEAN"');
	if (!hasTestChange && changed.some((f) => isTestFile(f) || isWorkflowFile(f))) {
		fail('message: "QA: #N" with test or workflow files changed requires trailer "Test-change: <text>"');
	}
	for (const n of qaIssues) {
		const r = ghRun(["issue", "view", n, "--json", "labels,state"]);
		let issue;
		try { issue = r.reason === undefined ? JSON.parse(r.stdout) : null; } catch { issue = null; }
		if (r.reason !== undefined) fail(`message: "QA: #${n}": gh issue view failed: ${r.reason}`);
		else if (!issue) fail(`message: "QA: #${n}": unreadable gh issue view output`);
		else if (!(issue.labels ?? []).some((l) => (l.name ?? l) === "qa-inbox")) fail(`message: "QA: #${n}" is not a qa-inbox issue`);
	}
}

if (!reviews.length) fail('message: missing trailer "Review: review#N CLEAN" or "Review: agent#N CLEAN"');
if (codeChanged && !has(/^Code-review: CLEAN$/)) fail('message: missing trailer "Code-review: CLEAN" (non-doc files changed)');
if (!has(/^Unverified: \S/)) fail('message: missing trailer "Unverified: <text or none>"');

finish();
console.log(`deliver-check PASS ${branch} ${short(head)}`);
console.log(`  contains origin/main ${short(main)}; ${changed.length} changed file(s)`);
console.log(`  CI: ${passed.length ? passed.join("; ") : "not required (docs-only)"}`);
console.log(`  reviews: ${reviews.join(", ")}${codeChanged ? "; code review CLEAN" : ""}`);
if (weak.length) console.log(`  test integrity: ${weak.length} weakening file(s) accepted with Test-change and Test-review`);
if (qaIssues.length) console.log(`  QA: ${qaIssues.map((n) => `#${n}`).join(", ")} (qa-inbox issues, Test-review present)`);
for (const line of qaOpenLines()) console.log(line);
