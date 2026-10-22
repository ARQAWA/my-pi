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
	console.error(`deliver-check: ${failures.length} failure(s), do not merge ${branch}`);
	process.exit(1);
};

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
if (!reviews.length) fail('message: missing trailer "Review: review#N CLEAN" or "Review: agent#N CLEAN"');
if (codeChanged && !has(/^Code-review: CLEAN$/)) fail('message: missing trailer "Code-review: CLEAN" (non-doc files changed)');
if (!has(/^Unverified: \S/)) fail('message: missing trailer "Unverified: <text or none>"');

finish();
console.log(`deliver-check PASS ${branch} ${short(head)}`);
console.log(`  contains origin/main ${short(main)}; ${changed.length} changed file(s)`);
console.log(`  CI: ${passed.length ? passed.join("; ") : "not required (docs-only)"}`);
console.log(`  reviews: ${reviews.join(", ")}${codeChanged ? "; code review CLEAN" : ""}`);
