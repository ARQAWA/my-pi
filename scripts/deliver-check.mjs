#!/usr/bin/env node
// Pre-merge gate (PROCESS.md, Delivery). Run from the release checkout before every squash merge:
//   npm run deliver-check -- <branch> <message-file>
// <message-file> is the planned squash commit message. Every failed check prints one line; any failure exits 1.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { checkDocuments } from "./doc-check.mjs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { findNonVerbatimQuotes, loadOwnerMessages, ownerSessionDirs } from "./owner-quotes.mjs";
import { selectTargetedTests } from "./targeted-tests.mjs";

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

// Only QA issue labels need live GitHub data.
const ghRun = (args) => {
	const r = spawnSync("gh", args, { encoding: "utf8", shell: process.platform === "win32", timeout: 30000 });
	if (r.status === 0) return { stdout: r.stdout };
	const reason = String(r.stderr || r.error?.message || `exit ${r.status}`).trim().split(/\r?\n/)[0];
	return { reason };
};

// Informational only (red main never blocks a merge, owner decision): local ci-watch files in
// `<git-common-dir>/ci-watch/`, read synchronously with no gh call. Never merge proof.
// `status.json` carries the bounded run list, the sidecar `inbox.json` the issue snapshot that
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

if (process.platform !== "darwin") {
	console.error("deliver-check requires the owner's macOS laptop");
	process.exit(1);
}

const root = git("rev-parse", "--show-toplevel");

// The script gates a merge into release: it must run in the checkout that has release checked out, never in the task worktree.
let onRelease = false;
try { onRelease = git("symbolic-ref", "-q", "HEAD") === "refs/heads/release"; } catch { /* detached HEAD */ }
if (!onRelease) fail(`${root} does not have refs/heads/release checked out: run deliver-check from the release checkout`);

// 4. The release checkout has no uncommitted or untracked changes.
if (git("status", "--porcelain")) fail(`release checkout ${root} has uncommitted or untracked changes`);

try {
	git("fetch", "--quiet", "origin");
} catch (e) {
	fail(`git fetch origin failed: ${String(e.stderr || e.message).trim()}`);
	finish();
}
let head, release, local;
try {
	head = git("rev-parse", "--verify", `${branch}^{commit}`);
	release = git("rev-parse", "--verify", "origin/release^{commit}");
	local = git("rev-parse", "--verify", "HEAD^{commit}");
} catch {
	fail(`cannot resolve ${branch}, origin/release or HEAD of the release checkout`);
	finish();
}

// 1. The branch head contains the current origin/release and the merge destination (this checkout's HEAD),
// so the tested tree is the tree that gets merged.
const contains = (base) => spawnSync("git", ["merge-base", "--is-ancestor", base, head]).status === 0;
if (!contains(release)) {
	fail(`${branch} (${short(head)}) does not contain origin/release (${short(release)}): rebase on current release and retest`);
}
if (local !== release && !contains(local)) {
	fail(`release checkout HEAD (${short(local)}) is not origin/release (${short(release)}) and not contained in ${branch}: `
		+ "push or drop the local commits, then rebase and retest");
}

// --no-renames keeps both sides of moves in targeted-test classification.
const changed = git("diff", "-z", "--no-renames", "--name-only", `${release}...${head}`).split("\0").filter(Boolean);

// 3. The squash message records clean reviews and what was not verified live.
let lines = [];
try {
	lines = readFileSync(messageFile, "utf8").split(/\r?\n/).map((l) => l.trimEnd());
} catch (e) {
	fail(`cannot read message file ${messageFile}: ${e.message}`);
}
const has = (re) => lines.some((l) => re.test(l));
const reviews = lines.filter((l) => /^Review: agent#\d+ CLEAN$/.test(l)).map((l) => l.slice(8, -6));

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
		diff = execFileSync("git", ["diff", "--no-renames", "--no-color", "-U0", `${release}...${head}`, "--", file],
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
const hasTestReview = has(/^Test-review: agent#\d+ CLEAN$/);
const weak = changed.filter((f) => isTestFile(f) || isWorkflowFile(f)).map((f) => ({ file: f, rules: weakeningRules(f) }))
	.filter((w) => w.rules.length);
for (const w of weak) {
	const missing = [];
	if (!hasTestChange) missing.push('"Test-change: <text>"');
	if (!hasTestReview) missing.push('"Test-review: agent#N CLEAN"');
	if (missing.length) fail(`test integrity: ${w.file} ${w.rules.join("; ")}: missing trailer ${missing.join(" and ")}; review with agent_type: "test-reviewer"`);
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

// 3c. The declared class selects one ordinary review, critical result plus code review, or proofreading checks.
const changeClasses = lines.filter((l) => l.startsWith("Change-class:"));
const docChecks = lines.filter((l) => l.startsWith("Doc-check:")).map((l) => l.slice(10).trim());
const isPassiveDoc = (f) => /^[^/]+\.md$/.test(f) && !["AGENTS.md", "INSTALL.md"].includes(f) || /^notes\/.+\.md$/.test(f);
const rulesBlock = (rev) => {
	const files = git("ls-tree", "-r", "--name-only", rev, "--", "PROCESS.md", "process/").split("\n")
		.filter((file) => file.endsWith(".md"));
	return JSON.stringify(files.flatMap((file) => [...git("show", `${rev}:${file}`)
		.matchAll(/^```json coordinator-rules\r?\n([\s\S]*?)^```/gm)].map((match) => [file, match[1]])));
};
const existsAt = (rev, f) => spawnSync("git", ["cat-file", "-e", `${rev}:${f}`]).status === 0;
// An allowlist, independent of workflow review filters. Both sides of deletions and moves count.
const isDocumentPath = (file) => {
	if (/^(?:\.agents|\.pi)\//.test(file) || /(?:^|\/)(?:SYSTEM|AGENTS|INSTALL)\.md$/.test(file)
		|| /^extensions\/RQW-tools\/descriptions\//.test(file)
		|| /^extensions\/RQW-review\/skills\//.test(file)) return false;
	return isPassiveDoc(file) || /^(?:docs|process)\/.+\.md$/.test(file)
		|| /(?:^|\/)(?:README|THIRD-PARTY-NOTICES)\.md$/.test(file)
		|| /^extensions\/[^/]+\/docs\/.+\.md$/.test(file);
};
function isPlainDocument(rev, file) {
	const entry = git("ls-tree", rev, "--", file);
	if (!entry) return true; // Additions/deletions are checked on the side where they exist.
	if (!entry.startsWith("100644 blob ")) return false;
	return !git("show", `${rev}:${file}`).startsWith("#!");
}
const documentOnly = changed.length > 0 && changed.every((file) => isDocumentPath(file)
	&& [release, head].every((rev) => isPlainDocument(rev, file)))
	&& rulesBlock(release) === rulesBlock(head);
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
	const bad = changed.filter((f) => !isPassiveDoc(f) || !isDocumentPath(f)
		|| ![release, head].every((rev) => isPlainDocument(rev, f)));
	if (bad.length) problems.push(`not passive documents: ${bad.slice(0, 5).join(", ")}`);
	if (!changed.length) problems.push("no changed files");
	const moved = changed.filter((f) => !existsAt(release, f) || !existsAt(head, f));
	if (moved.length) problems.push(`added or deleted files: ${moved.slice(0, 5).join(", ")}`);
	if (changed.includes("PROCESS.md") && (rulesBlock(release) === "[]" || rulesBlock(release) !== rulesBlock(head))) {
		problems.push("PROCESS.md coordinator-rules block changed or unreadable");
	}
	if (qaIssues.length) problems.push('"QA: #N" is not proofreading');
	return problems;
}
let proofreading = false;
if (changeClasses.includes("Change-class: proofreading")) {
	const problems = proofreadingProblems();
	for (const p of problems) fail(`message: proofreading exemption: ${p}`);
	proofreading = !problems.length;
}
const proofreadingClass = changeClasses.length === 1 && changeClasses[0] === "Change-class: proofreading";
const ordinary = changeClasses.length === 1 && changeClasses[0] === "Change-class: ordinary";
const critical = changeClasses.length === 1 && changeClasses[0] === "Change-class: critical";
if (!proofreadingClass && !ordinary && !critical) {
	fail('message: expected exactly one "Change-class: ordinary", "Change-class: critical" or "Change-class: proofreading"');
}
if (lines.some((l) => l.startsWith("Combined-review:"))) {
	fail('message: "Combined-review:" was removed; ordinary work uses one "Review: agent#N CLEAN" for result and code');
}
if (!proofreadingClass && reviews.length !== 1) {
	fail('message: expected exactly one "Review: agent#N CLEAN" covering result and code');
}
if (critical && !has(/^Code-review: CLEAN$/)) fail('message: critical change requires "Code-review: CLEAN"');
if (!has(/^Unverified: \S/)) fail('message: missing trailer "Unverified: <text or none>"');

// 5. Only head-version quote spans touching added lines need provenance. Historical quotes stay untouched.
const docCheckStart = failures.length;
try {
	const common = resolve(root, git("rev-parse", "--git-common-dir"));
	const mainCheckout = dirname(common);
	const checkouts = [mainCheckout, ...git("worktree", "list", "--porcelain", "-z").split("\0")
		.filter((field) => field.startsWith("worktree ")).map((field) => field.slice(9))];
	const messages = loadOwnerMessages(ownerSessionDirs(checkouts));
	for (const file of changed.filter((file) => documentOnly || file === "DECISIONS.md" || file === "PROCESS.md"
		|| /^process\/.+\.md$/.test(file))) {
		const diff = git("diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "-U0",
			`${release}...${head}`, "--", file);
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

let documentLog;
if (documentOnly) {
	try {
		for (const issue of checkDocuments({ git, base: release, head, files: changed })) fail(issue);
	} catch (error) { fail(`document checks: ${error.message}`); }
	documentLog = join(mkdtempSync(join(tmpdir(), "my-pi-doc-check-")), "checks.log");
	const issues = failures.slice(docCheckStart);
	writeFileSync(documentLog, [
		`Document checks at ${head}; base ${release}`,
		`Files: ${changed.join(", ")}`,
		"Owner quotes: touched spans in all changed documents, checked against owner sessions.",
		"Links: touched links and newly broken existing links in changed documents; local targets and anchors; external URL syntax only, no network requests.",
		"Format: git diff --check and Markdown fences.",
		...issues.map((issue) => `FAIL ${issue}`),
		issues.length ? "Document checks FAIL" : "Document checks PASS",
		"",
	].join("\n"));
	console.log(`  document checks log: ${documentLog}`);
}

// Use the existing task checkout, never create a worktree or install dependencies.
finish();
const branchRef = git("rev-parse", "--symbolic-full-name", branch);
let taskWorktree;
let worktree;
for (const field of git("worktree", "list", "--porcelain", "-z").split("\0")) {
	if (field.startsWith("worktree ")) worktree = field.slice(9);
	if (field === `branch ${branchRef}`) taskWorktree = worktree;
}
if (!taskWorktree) fail(`no existing worktree for ${branch}`);
finish();
const taskGit = (...args) => git("-C", taskWorktree, ...args);
function checkTaskHead(when) {
	try {
		if (taskGit("rev-parse", "HEAD") !== head || git("rev-parse", branchRef) !== head
			|| taskGit("symbolic-ref", "-q", "HEAD") !== branchRef) {
			fail(`targeted tests: ${branch} head changed ${when}; expected ${head}`);
		}
		if (taskGit("status", "--porcelain")) fail(`task checkout ${taskWorktree} has uncommitted or untracked changes ${when}`);
	} catch (error) {
		fail(`targeted tests: cannot verify task checkout ${when}: ${error.message}`);
	}
}
checkTaskHead("before tests");
finish();
let selected = [];
if (!documentOnly) {
	try { selected = selectTargetedTests({ root: taskWorktree, changed }); }
	catch (error) { fail(`targeted tests: cannot select tests: ${error.message}`); }
	finish();
	console.log(`  targeted tests at ${head}: ${selected.length ? selected.join(", ") : "none discovered; no runtime tests executed"}`);
	console.log("  selection covers extension owners and static local references; dynamic dependencies are not proven");
	if (selected.length) {
		const tests = spawnSync("node", ["--test", ...selected], { cwd: taskWorktree, stdio: "inherit" });
		if (tests.status !== 0) fail(`targeted tests failed: ${tests.error?.message ?? tests.signal ?? `exit ${tests.status}`}`);
	}
}
checkTaskHead("after tests");
finish();
console.log(`deliver-check PASS ${branch} ${short(head)}`);
console.log(`  contains origin/release ${short(release)}; ${changed.length} changed file(s)`);
if (documentOnly) console.log(`  document checks: PASS ${head}; targeted tests not required; ${documentLog}`);
else console.log(`  targeted tests: ${selected.length ? "PASS" : "NONE"} ${head} in ${taskWorktree}`);
if (proofreading) console.log(`  reviews: exempt (proofreading, Doc-check ${docChecks[0]})`);
else console.log(`  reviews: ${reviews.join(", ")} (result and code)${critical ? "; separate code review CLEAN" : ""}`);
if (weak.length) console.log(`  test integrity: ${weak.length} weakening file(s) accepted with Test-change and Test-review`);
if (qaIssues.length) console.log(`  QA: ${qaIssues.map((n) => `#${n}`).join(", ")} (qa-inbox issues)`);
for (const line of qaOpenLines()) console.log(line);
