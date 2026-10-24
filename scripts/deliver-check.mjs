#!/usr/bin/env node
// Pre-merge gate (PROCESS.md, Delivery). Run from the main checkout before every squash merge:
//   npm run deliver-check -- <branch> <message-file>
// <message-file> is the planned squash commit message. Every failed check prints one line; any failure exits 1.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { findNonVerbatimQuotes, loadOwnerMessages, ownerSessionDirs } from "./owner-quotes.mjs";

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

// gh serves only the checks that need live GitHub data (`QA: #N` labels, the exact-head CI runs below).
const ghRun = (args) => {
	const r = spawnSync("gh", args, { encoding: "utf8", shell: process.platform === "win32", timeout: 30000 });
	if (r.status === 0) return { stdout: r.stdout };
	const reason = String(r.stderr || r.error?.message || `exit ${r.status}`).trim().split(/\r?\n/)[0];
	return { reason };
};

// Informational only (red main never blocks a merge, owner decision): local ci-watch files in
// `<git-common-dir>/ci-watch/`, read synchronously with no gh call. Never merge proof; the exact head CI run is
// checked live below. `status.json` carries the bounded run list, the sidecar `inbox.json` the issue snapshot that
// `npm run ci-watch -- --refresh-inbox` wrote on demand: it says when it was fetched, never that issues are open now.
const CACHE_STALE_MS = 180_000;
const RED = ["failure", "timed_out", "startup_failure", "action_required"];
const readCache = (name) => {
	const dir = resolve(process.cwd(), git("rev-parse", "--git-common-dir"));
	return JSON.parse(readFileSync(join(dir, "ci-watch", name), "utf8"));
};
function inboxLines() {
	let inbox;
	try { inbox = readCache("inbox.json"); } catch (e) {
		return [`  QA inbox: no local snapshot (${e.code ?? e.message}); run npm run ci-watch -- --refresh-inbox, workflow failures shown instead`];
	}
	if (inbox?.version !== 1 || !Array.isArray(inbox.items) || !Number.isFinite(Date.parse(inbox.fetchedAt))) {
		return ["  QA inbox: local snapshot invalid; run npm run ci-watch -- --refresh-inbox"];
	}
	const lines = [`  QA inbox: local cached snapshot from ${inbox.fetchedAt}; not refreshed by ci-watch, not the current state`];
	if (!inbox.items.length) lines.push("  QA inbox: no items in that snapshot");
	for (const i of inbox.items) lines.push(`  QA inbox: ${String(i.level ?? "info").toUpperCase()} ${i.text}${i.url ? ` ${i.url}` : ""}`);
	return lines;
}
function mainRunLines() {
	let cache;
	try { cache = readCache("status.json"); } catch (e) {
		return [`  main runs: unavailable (no readable ci-watch cache: ${e.code ?? e.message})`];
	}
	const age = Date.now() - Date.parse(cache?.fetchedAt);
	if (cache?.version !== 1 || !Array.isArray(cache.runs) || !Number.isFinite(age) || age < 0 || age > CACHE_STALE_MS) {
		return ["  main runs: unavailable (ci-watch cache stale or invalid)"];
	}
	if (cache.error) return [`  main runs: unavailable (ci-watch fetch failed: ${String(cache.error).split(/\r?\n/)[0].slice(0, 200)})`];
	// Newest run per workflow file on main; a red one is extra information.
	const latest = new Map();
	for (const r of cache.runs.filter((x) => x.head_branch === "main")) {
		const key = String(r.path ?? r.name).split("@")[0];
		const prev = latest.get(key);
		if (!prev || Date.parse(r.created_at) > Date.parse(prev.created_at)) latest.set(key, r);
	}
	return [...latest.values()].filter((r) => r.status === "completed" && RED.includes(r.conclusion))
		.map((r) => `  main red (cached): ${r.name ?? r.path} ${r.conclusion} ${r.html_url ?? ""}`.trimEnd());
}
const qaOpenLines = () => [...inboxLines(), ...mainRunLines()];

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

// Job names follow tests.yml's macos-latest Node matrix. Windows jobs remain advisory.
const REQUIRED_MAC_JOBS = ["test (macos-latest, node 22.19.0)", "test (macos-latest, node 24)"];
function liveJson(args) {
	const result = ghRun(args);
	if (result.reason !== undefined) throw new Error(result.reason);
	return JSON.parse(result.stdout);
}
function macJobsGreen(run) {
	const endpoint = `repos/{owner}/{repo}/actions/runs/${run.databaseId}`;
	const before = liveJson(["api", endpoint]);
	if (before.id !== run.databaseId || before.head_sha !== head || !Number.isSafeInteger(before.run_attempt) || before.run_attempt < 1) {
		throw new Error("run metadata does not match the exact head/run/attempt");
	}
	const data = liveJson(["api", `${endpoint}/attempts/${before.run_attempt}/jobs?per_page=100`]);
	if (!Array.isArray(data.jobs) || !Number.isSafeInteger(data.total_count) || data.total_count !== data.jobs.length) {
		throw new Error("job list is incomplete or invalid; cannot verify all required macOS jobs");
	}
	if (data.jobs.some((job) => job.run_id !== before.id || job.run_attempt !== before.run_attempt || job.head_sha !== head)) {
		throw new Error("job data does not match the exact head/run/attempt");
	}
	for (const job of data.jobs.filter((job) => /windows/i.test(job.name))) {
		if (job.status !== "completed" || job.conclusion !== "success") {
			console.log(`  Windows advisory: ${job.name}: ${job.status === "completed" ? job.conclusion : job.status} ${job.html_url ?? run.url}`);
			console.log("    Triage via scheduled main qa-inbox or an explicit issue; no automatic code fix.");
		}
	}
	for (const name of REQUIRED_MAC_JOBS) {
		const matches = data.jobs.filter((job) => job.name === name);
		if (matches.length !== 1) throw new Error(`required macOS job missing or duplicated: ${name}`);
	}
	for (const job of data.jobs.filter((job) => job.name.includes("macos-latest"))) {
		if (job.status !== "completed" || job.conclusion !== "success") {
			throw new Error(`required macOS job ${job.name} is ${job.status === "completed" ? job.conclusion : job.status}: ${job.html_url ?? run.url}`);
		}
	}
	// A rerun may start while jobs are fetched. Never accept jobs from an earlier attempt.
	const after = liveJson(["api", endpoint]);
	if (after.id !== before.id || after.head_sha !== head || after.run_attempt !== before.run_attempt) {
		throw new Error("run head/attempt changed during the fresh macOS check; check again");
	}
}

// gh is gh.exe on Windows; the shell there also finds a .cmd shim. Arguments are fixed words and a hex SHA.
function latestRun(workflow) {
	try {
		const runs = liveJson(["run", "list", "--workflow", workflow, "--commit", head, "--limit", "20",
			"--json", "databaseId,headSha,status,conclusion,url"]);
		const run = runs.find((item) => item.headSha === head); // gh lists the newest run first
		if (!run) throw new Error(`no run for ${short(head)}; push the branch and wait for CI`);
		if (workflow === "tests.yml") macJobsGreen(run);
		else if (run.status !== "completed") throw new Error(`latest run for ${short(head)} is ${run.status}: ${run.url}`);
		else if (run.conclusion !== "success") throw new Error(`latest run for ${short(head)} concluded ${run.conclusion}: ${run.url}`);
		return run;
	} catch (error) {
		fail(`${workflow}: ${error.message}`);
		return null;
	}
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
// 3b. Detected test/workflow weakening needs both a reason and an independent test-integrity review.
// `QA: #N` also needs a reason for test/workflow edits, but is not itself an integrity-review trigger.
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

// 3c. Review gates. Two declared shortcuts, both conservative:
// - `Change-class: proofreading` + `Doc-check: <absolute log path>`: passive documents only, no review trailers.
// - `Combined-review: agent#N CLEAN`: one reviewer for result and code review; at most 100 added plus deleted lines,
//   every changed path inside one extensions/RQW-*/ folder. "No visible behavior change" stays the reviewer's attestation.
const changeClasses = lines.filter((l) => l.startsWith("Change-class:"));
const docChecks = lines.filter((l) => l.startsWith("Doc-check:")).map((l) => l.slice(10).trim());
const combinedLines = lines.filter((l) => /^Combined-review: (?:review|agent)#\d+ CLEAN$/.test(l)).map((l) => l.slice(17, -6));
const COMBINED_MAX_LINES = 100;
const isPassiveDoc = (f) => /^[^/]+\.md$/.test(f) && !["AGENTS.md", "INSTALL.md"].includes(f) || /^notes\/.+\.md$/.test(f);
const rulesBlock = (rev) => {
	try { return /^```json coordinator-rules\r?\n([\s\S]*?)^```/m.exec(git("show", `${rev}:PROCESS.md`))?.[1]; } catch { return undefined; }
};
const existsAt = (rev, f) => spawnSync("git", ["cat-file", "-e", `${rev}:${f}`]).status === 0;
function proofreadingProblems() {
	const problems = [];
	if (changeClasses.length !== 1 || changeClasses[0] !== "Change-class: proofreading") {
		return ['malformed "Change-class:" line(s), expected exactly "Change-class: proofreading"'];
	}
	if (docChecks.length !== 1 || !isAbsolute(docChecks[0])) problems.push('needs exactly one "Doc-check: <absolute local log path>"');
	else {
		let size = 0;
		try { size = statSync(docChecks[0]).isFile() ? statSync(docChecks[0]).size : 0; } catch { /* missing */ }
		if (!size) problems.push(`Doc-check log ${docChecks[0]} is missing or empty`);
	}
	const bad = changed.filter((f) => !isPassiveDoc(f));
	if (bad.length) problems.push(`not passive documents: ${bad.slice(0, 5).join(", ")}`);
	if (!changed.length) problems.push("no changed files");
	const moved = changed.filter((f) => !existsAt(main, f) || !existsAt(head, f));
	if (moved.length) problems.push(`added or deleted files: ${moved.slice(0, 5).join(", ")}`);
	if (changed.includes("PROCESS.md") && (rulesBlock(main) === undefined || rulesBlock(main) !== rulesBlock(head))) {
		problems.push("PROCESS.md coordinator-rules block changed or unreadable");
	}
	if (codeChanged || required.length) problems.push("CI is required for this change");
	if (qaIssues.length) problems.push('"QA: #N" is not proofreading');
	return problems;
}
let proofreading = false;
if (changeClasses.length) {
	const problems = proofreadingProblems();
	for (const p of problems) fail(`message: proofreading exemption: ${p}`);
	proofreading = !problems.length;
}
// Added plus deleted lines of the whole change; null when a binary or non-numeric entry makes the size unknowable.
function changedLineCount() {
	let total = 0;
	for (const row of git("diff", "--numstat", "--no-renames", `${main}...${head}`).split(/\r?\n/).filter(Boolean)) {
		const [add, del] = row.split("\t");
		if (!/^\d+$/.test(add) || !/^\d+$/.test(del)) return null;
		total += Number(add) + Number(del);
	}
	return total;
}
const combinedProblems = () => {
	const problems = [];
	const folders = new Set(changed.map((f) => /^(extensions\/RQW-[^/]+)\/./.exec(f)?.[1] ?? ""));
	if (!changed.length || folders.has("") || folders.size !== 1) problems.push("changed paths are not all inside one extensions/RQW-*/ folder");
	const lines = changedLineCount();
	if (lines === null) problems.push("binary or non-numeric diff entry");
	else if (lines > COMBINED_MAX_LINES) problems.push(`${lines} added plus deleted lines, at most ${COMBINED_MAX_LINES}`);
	if (weak.length) problems.push("test integrity rule triggered");
	if (qaIssues.length) problems.push('"QA: #N" fix');
	if (changed.some(isWorkflowFile)) problems.push("workflow file changed");
	return problems;
};
const combinedProblem = combinedLines.length ? combinedProblems() : [];
const combined = combinedLines.length > 0 && !combinedProblem.length;
const needsReview = !reviews.length && !combined && !proofreading;
const needsCodeReview = codeChanged && !has(/^Code-review: CLEAN$/) && !combined;
if (combinedProblem.length && (needsReview || needsCodeReview)) {
	fail(`message: "Combined-review:" not allowed (${combinedProblem.join("; ")}): use separate "Review:" and "Code-review: CLEAN"`);
}
if (needsReview) fail('message: missing trailer "Review: review#N CLEAN" or "Review: agent#N CLEAN"');
if (needsCodeReview) fail('message: missing trailer "Code-review: CLEAN" (non-doc files changed)');
if (!has(/^Unverified: \S/)) fail('message: missing trailer "Unverified: <text or none>"');

// 5. Only head-version quote spans touching added lines need provenance. Historical quotes stay untouched.
try {
	const common = resolve(root, git("rev-parse", "--git-common-dir"));
	const mainCheckout = dirname(common);
	const checkouts = [mainCheckout, ...git("worktree", "list", "--porcelain", "-z").split("\0")
		.filter((field) => field.startsWith("worktree ")).map((field) => field.slice(9))];
	const messages = loadOwnerMessages(ownerSessionDirs(checkouts));
	for (const file of ["DECISIONS.md", "PROCESS.md"]) {
		const diff = git("diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "-U0",
			`${main}...${head}`, "--", file);
		const ranges = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)]
			.map((match) => ({ start: Number(match[1]), count: Number(match[2] ?? 1) }))
			.filter((range) => range.count > 0);
		if (!ranges.length) continue;
		const text = execFileSync("git", ["show", `${head}:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		for (const span of findNonVerbatimQuotes(text, messages)) {
			if (!ranges.some((range) => span.startLine < range.start + range.count && span.endLine >= range.start)) continue;
			const quote = span.text.replace(/\s+/gu, " ").trim();
			fail(`${file}:${span.startLine} ${span.malformed ? "malformed quote" : "quote is not verbatim in any owner message"}: «${quote}»`);
		}
	}
} catch (error) {
	fail(`owner quotes: ${error.message}`);
}

finish();
console.log(`deliver-check PASS ${branch} ${short(head)}`);
console.log(`  contains origin/main ${short(main)}; ${changed.length} changed file(s)`);
console.log(`  CI: ${passed.length ? passed.join("; ") : "not required (docs-only)"}`);
if (proofreading) console.log(`  reviews: exempt (proofreading, Doc-check ${docChecks[0]})`);
else if (combined && !reviews.length) console.log(`  reviews: combined ${combinedLines.join(", ")} (result and code review)`);
else console.log(`  reviews: ${reviews.join(", ")}${codeChanged ? "; code review CLEAN" : ""}`);
if (weak.length) console.log(`  test integrity: ${weak.length} weakening file(s) accepted with Test-change and Test-review`);
if (qaIssues.length) console.log(`  QA: ${qaIssues.map((n) => `#${n}`).join(", ")} (qa-inbox issues)`);
for (const line of qaOpenLines()) console.log(line);
