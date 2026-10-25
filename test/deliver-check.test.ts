// Throwaway repositories with fake node and gh; never runs the real targeted tests.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "deliver-check.mjs");
const temps: string[] = [];
after(() => { for (const t of temps) rmSync(t, { recursive: true, force: true }); });

function setup() {
	const tmp = mkdtempSync(join(tmpdir(), "deliver-check-"));
	temps.push(tmp);
	const bin = join(tmp, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "gh.mjs"), `
import { appendFileSync, readFileSync } from "node:fs";
const a = process.argv.slice(2);
appendFileSync(process.env.FAKE_GH_LOG, a.join(" ") + "\\n");
if (a[0] !== "issue" || a[1] !== "view") throw new Error("unexpected gh call");
if (process.env.FAKE_GH_ISSUE_FAIL === "1") { process.stderr.write("HTTP 502: bad gateway\\nsecond line\\n"); process.exit(1); }
const one = JSON.parse(readFileSync(process.env.FAKE_GH_ISSUES, "utf8")).view[a[2]];
if (!one) { process.stderr.write("GraphQL: Could not resolve to an Issue\\n"); process.exit(1); }
process.stdout.write(JSON.stringify(one));
`);
	writeFileSync(join(bin, "node.mjs"), `
import { appendFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
appendFileSync(process.env.FAKE_NODE_LOG, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), head: git("rev-parse", "HEAD") }) + "\\n");
if (process.env.FAKE_NODE_MODE === "dirty") writeFileSync("stray.txt", "test output");
if (process.env.FAKE_NODE_MODE === "head") git("commit", "--quiet", "--allow-empty", "-m", "changed during tests");
if (process.env.FAKE_NODE_MODE === "detach") git("checkout", "--quiet", "--detach");
process.exit(process.env.FAKE_NODE_MODE === "fail" ? 23 : 0);
`);
	for (const name of ["node", "gh"]) {
		writeFileSync(join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, name + ".mjs")}" "$@"\n`);
		chmodSync(join(bin, name), 0o755);
	}
	const gitconfig = join(tmp, "gitconfig");
	writeFileSync(gitconfig, "[user]\n\tname = t\n\temail = t@example.com\n[commit]\n\tgpgsign = false\n[core]\n\tautocrlf = false\n");
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
		GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: gitconfig,
		FAKE_GH_ISSUES: issuesFile, MY_PI_SESSIONS: sessions, FAKE_GH_LOG: join(tmp, "gh.log"), FAKE_NODE_LOG: join(tmp, "node.log"), FAKE_NODE_MODE: "",
	};
	const repo = join(tmp, "checkout");
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8" }).trim();
	execFileSync("git", ["init", "--quiet", "--bare", "-b", "release", join(tmp, "origin.git")], { env });
	execFileSync("git", ["clone", "--quiet", join(tmp, "origin.git"), repo], { env, stdio: "ignore" });
	git("symbolic-ref", "HEAD", "refs/heads/release");
	mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
	copyFileSync(join(ROOT, ".github", "workflows", "tests.yml"), join(repo, ".github", "workflows", "tests.yml"));
	writeFileSync(join(repo, "README.md"), "x\n");
	mkdirSync(join(repo, "test"), { recursive: true });
	writeFileSync(join(repo, "test/relevant.test.ts"), "\"../src/a.js\"; \"../README.md\"; \"../pcli-vscode/x.js\"; \"../AGENTS.md\"; \"../INSTALL.md\"; \"../SYSTEM.md\"; \"../.agents/reviewers/x.md\"; \"../.agents/roles/x.md\"; \"../.pi/agents/x.toml\"; \"../extensions/RQW-prompt/SYSTEM.md\"; \"../extensions/RQW-review/profiles/x.toml\"; \"../extensions/RQW-review/skills/x/SKILL.md\"; \"../extensions/RQW-tools/descriptions/read.md\"; \"../package.json\"; \"../.github/workflows/x.yml\"; \"../scripts/x.mjs\"; \"../PROCESS.md\"; \"../process/subagent-models.md\"; \"../scripts/run.js\"; \"../notes/run.md\";\n");
	git("add", ".");
	git("commit", "--quiet", "-m", "base");
	git("push", "--quiet", "origin", "release");

	const worktree = join(tmp, "task-worktree");
	const commit = (on: string, files: Record<string, string | null>) => {
		if (on !== "release" && !git("worktree", "list", "--porcelain").includes(`branch refs/heads/${on}\n`)) {
			git("worktree", "add", "--quiet", worktree, on);
		}
		const cwd = on === "release" ? repo : worktree;
		const localGit = (...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
		for (const [f, text] of Object.entries(files)) {
			if (text === null) { localGit("rm", "--quiet", f); continue; }
			mkdirSync(dirname(join(cwd, f)), { recursive: true });
			writeFileSync(join(cwd, f), text);
			localGit("add", f);
		}
		localGit("commit", "--quiet", "-m", `change ${Object.keys(files).join(" ")}`);
		return localGit("rev-parse", "HEAD");
	};
	const task = (files: Record<string, string | null>) => {
		git("branch", "task", "release");
		return commit("task", files);
	};
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
	const nodeCalls = () => { try { return readFileSync(env.FAKE_NODE_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch { return []; } };
	return { tmp, repo, worktree, bin, env, git, commit, task, issues, cache, inbox, ghCalls, nodeCalls, run, sessions };
}

const MSG = () => "Task\n\nReview: review#7 CLEAN\nCode-review: CLEAN\nUnverified: none\n";

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
		t.commit("release", { "PROCESS.md": "  Owner: «First line\nsecond line.»\n" });
		t.git("push", "--quiet", "origin", "release");
		t.task({ "PROCESS.md": "  Owner: «First line\ninvented middle\nsecond line.»\n" });
		const result = t.run(DOC_MSG);
		assert.equal(result.code, 1, result.out);
		assert.match(result.out, /FAIL PROCESS\.md:1 quote is not verbatim/);
	});

	it("ignores unchanged historical spans and deletion-only hunks", () => {
		const t = setup();
		t.commit("release", { "DECISIONS.md": "«historical invention»\nremove me\nuntouched\n" });
		t.git("push", "--quiet", "origin", "release");
		t.task({ "DECISIONS.md": "«historical invention»\nuntouched\nnew plain text\n" });
		const result = t.run(DOC_MSG);
		assert.equal(result.code, 0, result.out);
	});

	it("reads the branch head, not release's or the working tree's document", () => {
		const t = setup();
		t.commit("release", { "DECISIONS.md": "Owner: «Keep the owner's exact words.»\n" });
		t.git("push", "--quiet", "origin", "release");
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
	it("passes a branch on current release with local tests and review trailers", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		const r = t.run(MSG());
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /deliver-check PASS task/);
		assert.match(r.out, /targeted tests: PASS/);
		assert.equal(t.ghCalls(), "");
		assert.deepEqual(t.nodeCalls(), [{ args: ["--test", "test/relevant.test.ts"], cwd: realpathSync(t.worktree), head }]);
		assert.equal(t.run(MSG()).code, 0);
		assert.equal(t.nodeCalls().length, 2);
	});

	it("passes an agent result-review trailer", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		const r = t.run(MSG().replace("review#7", "agent#7"));
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /reviews: agent#7; code review CLEAN/);
	});

	it("fails malformed or absent result-review trailers", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		for (const trailer of ["Review: agent#N CLEAN", "Review: agent7 CLEAN", "Review: agent#7 found issues", ""]) {
			const r = t.run(MSG().replace("Review: review#7 CLEAN", trailer));
			assert.equal(r.code, 1, r.out);
			assert.match(r.out, /FAIL message: missing trailer "Review: review#N CLEAN" or "Review: agent#N CLEAN"/);
		}
	});

	it("fails a branch that does not contain the current origin/release", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		t.commit("release", { "src/b.js": "2\n" });
		t.git("push", "--quiet", "origin", "release");
		const r = t.run(MSG());
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL task \(\w+\) does not contain origin\/release/);
	});

	it("fails when the local release has an unpushed commit the branch does not contain", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		t.commit("release", { "src/b.js": "2\n" }); // advanced locally, not pushed
		const r = t.run(MSG());
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL release checkout HEAD \(\w+\) is not origin\/release \(\w+\) and not contained in task/);
		assert.doesNotMatch(r.out, /does not contain origin\/release/);
	});

	it("fails when the local release diverged from origin/release", () => {
		const t = setup();
		t.commit("release", { "src/b.js": "2\n" });
		t.git("push", "--quiet", "origin", "release");
		t.git("reset", "--quiet", "--hard", "HEAD~1");
		t.commit("release", { "src/c.js": "3\n" }); // local release: base + c; origin/release: base + b
		t.git("branch", "task", "origin/release");
		t.commit("task", { "src/a.js": "1\n" });
		const r = t.run(MSG());
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL release checkout HEAD .* not contained in task/);
	});


	it("fails unless the checkout it runs in has release checked out", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		const worktree = t.worktree;
		const inTask = t.run(MSG(), worktree);
		assert.equal(inTask.code, 1);
		assert.match(inTask.out, /FAIL .*task-worktree does not have refs\/heads\/release checked out/);
		assert.doesNotMatch(inTask.out, /PASS/);
		t.git("checkout", "--quiet", "--detach", "release");
		const detached = t.run(MSG());
		assert.equal(detached.code, 1);
		assert.match(detached.out, /FAIL .* does not have refs\/heads\/release checked out/);
		t.git("checkout", "--quiet", "release");
		assert.equal(t.run(MSG()).code, 0);
	});



	it("checks documents without a test child and keeps agent roles on the targeted-test path", () => {
		const t = setup();
		t.task({ "README.md": "y\n", "notes/n.md": "n\n" });
		const r = t.run("Docs\n\nReview: review#3 CLEAN\nUnverified: none\n");
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /document checks: PASS/);
		assert.equal(t.nodeCalls().length, 0);
		const u = setup();
		u.task({ ".agents/reviewers/x.md": "r\n" });
		const roles = u.run(DOC_MSG);
		assert.equal(roles.code, 0, roles.out);
		assert.deepEqual(u.nodeCalls(), [{ args: ["--test", "test/relevant.test.ts"], cwd: realpathSync(u.worktree), head: u.git("-C", u.worktree, "rev-parse", "HEAD") }]);
	});

	it("counts both sides of a move: code into notes/ needs code review", () => {
		const t = setup();
		const code = "export const a = 1;\nexport const b = 2;\n";
		t.commit("release", { "src/a.js": code });
		t.git("push", "--quiet", "origin", "release");
		t.task({ "src/a.js": null, "notes/a.js": code });
		const r = t.run("Move\n\nReview: review#3 CLEAN\nUnverified: none\n");
		assert.equal(r.code, 1);
		assert.match(r.out, /"Code-review: CLEAN"/);
	});

	it("lists every missing trailer", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		const r = t.run("Task\n\nReview: review#7 found issues\n");
		assert.equal(r.code, 1);
		for (const re of [/"Review: review#N CLEAN"/,
			/"Code-review: CLEAN"/, /"Unverified: <text or none>"/]) assert.match(r.out, re);
	});

	it("fails when the release checkout has uncommitted changes", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		writeFileSync(join(t.repo, "stray.txt"), "x\n");
		const r = t.run(MSG());
		assert.equal(r.code, 1);
		assert.match(r.out, /FAIL release checkout .* has uncommitted or untracked changes/);
	});
});

describe("deliver-check targeted tests", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
	it("fails closed without an existing task worktree", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		t.git("worktree", "remove", t.worktree);
		const r = t.run(MSG());
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /FAIL no existing worktree for task/);
		assert.deepEqual(t.nodeCalls(), []);
	});

	it("rejects staged, unstaged and untracked task changes before node starts", () => {
		for (const mode of ["staged", "unstaged", "untracked"]) {
			const t = setup();
			t.task({ "src/a.js": "1\n" });
			writeFileSync(join(t.worktree, mode === "untracked" ? "stray.txt" : "src/a.js"), "dirty\n");
			if (mode === "staged") t.git("-C", t.worktree, "add", "src/a.js");
			const r = t.run(MSG());
			assert.equal(r.code, 1, r.out);
			assert.match(r.out, /FAIL task checkout .* has uncommitted or untracked changes before tests/);
			assert.deepEqual(t.nodeCalls(), []);
		}
	});

	it("fails closed on nonzero targeted tests", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		t.env.FAKE_NODE_MODE = "fail";
		const r = t.run(MSG());
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /FAIL targeted tests failed: exit 23/);
		assert.equal(t.nodeCalls().length, 1);
	});

	it("rejects dirty output, a changed head and a detached task after successful targeted tests", () => {
		for (const mode of ["dirty", "head", "detach"] as const) {
			const t = setup();
			const head = t.task({ "src/a.js": "1\n" });
			t.env.FAKE_NODE_MODE = mode;
			const r = t.run(MSG());
			assert.equal(r.code, 1, r.out);
			const error = { dirty: /uncommitted or untracked changes after tests/, head: /head changed after tests/,
				detach: /cannot verify task checkout after tests:.*symbolic-ref -q HEAD/ }[mode];
			assert.match(r.out, error);
			assert.doesNotMatch(r.out, /deliver-check PASS/);
			assert.deepEqual(t.nodeCalls(), [{ args: ["--test", "test/relevant.test.ts"], cwd: realpathSync(t.worktree), head }]);
			assert.equal(t.ghCalls(), "");
		}
	});

	it("always tests pcli changes without reading pcli filters or querying Actions", () => {
		const t = setup();
		const head = t.task({ "pcli-vscode/x.js": "1\n", ".github/workflows/pcli.yml": "no filter\n" });
		const r = t.run(MSG());
		assert.equal(r.code, 0, r.out);
		assert.deepEqual(t.nodeCalls(), [{ args: ["--test", "test/relevant.test.ts"], cwd: realpathSync(t.worktree), head }]);
		assert.equal(t.ghCalls(), "");
	});

	it("keeps both versions of tests.yml exclusions for code-review classification", () => {
		const t = setup();
		const tests = readFileSync(join(ROOT, ".github/workflows/tests.yml"), "utf8");
		t.task({ ".github/workflows/tests.yml": tests.replace(/paths-ignore:\s*\[[^\]]*\]/g, "paths-ignore: ['**']"), "src/a.js": "1\n" });
		const r = t.run(DOC_MSG);
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /missing trailer "Code-review: CLEAN"/);
		assert.equal(t.ghCalls(), "");
	});

	it("fails closed when tests.yml or its exclusions cannot be read", () => {
		for (const text of [null, "name: tests\n"]) {
			const t = setup();
			t.task({ ".github/workflows/tests.yml": text });
			const r = t.run(MSG());
			assert.equal(r.code, 1, r.out);
			assert.match(r.out, /FAIL cannot read (?:paths-ignore from )?\.github\/workflows\/tests\.yml/);
			assert.deepEqual(t.nodeCalls(), []);
		}
	});
});

describe("deliver-check mechanical document path", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
	const block = '```json coordinator-rules\n{"v": 1}\n```\n';
	const base = (t: ReturnType<typeof setup>, files: Record<string, string>) => {
		t.commit("release", files);
		t.git("push", "--quiet", "origin", "release");
	};
	const savedLog = (out: string) => {
		const path = /document checks log: (.+)/.exec(out)?.[1];
		assert.ok(path, out);
		return readFileSync(path, "utf8");
	};

	it("checks meaning changes, doc adds/deletes, extension READMEs and moved process sections", () => {
		const t = setup();
		base(t, { "PROCESS.md": block + "old rule\n", "notes/removed.md": "old\n" });
		t.task({ "PROCESS.md": block + "# Process\nNew mandatory rule.\n", "process/subagent-models.md": "old rule\n",
			"process/delivery.md": "# Delivery\nNew rule.\n", "notes/removed.md": null,
			"notes/new.md": "new\n", "extensions/RQW-x/README.md": "# Extension\n",
			"cli/web/README.md": "# CLI\n", "vendor/THIRD-PARTY-NOTICES.md": "# Notices\n" });
		const r = t.run(MSG());
		assert.equal(r.code, 0, r.out);
		assert.deepEqual(t.nodeCalls(), []);
		assert.match(savedLog(r.out), /Document checks PASS/);
		assert.match(savedLog(r.out), /external URL syntax only, no network requests/);
	});

	it("still requires a result review and extension README code review", () => {
		const t = setup();
		t.task({ "README.md": "A new rule.\n" });
		assert.match(t.run("Docs\n\nUnverified: none\n").out, /missing trailer "Review:/);
		const u = setup();
		u.task({ "extensions/RQW-x/README.md": "A new rule.\n" });
		assert.match(u.run(DOC_MSG).out, /missing trailer "Code-review:/);
	});

	it("runs targeted tests for every excluded runtime/config path and mixed changes", () => {
		for (const file of ["AGENTS.md", "INSTALL.md", "SYSTEM.md", ".agents/reviewers/x.md", ".agents/roles/x.md",
			".pi/agents/x.toml", "extensions/RQW-prompt/SYSTEM.md", "extensions/RQW-review/profiles/x.toml",
			"extensions/RQW-review/skills/x/SKILL.md", "extensions/RQW-tools/descriptions/read.md",
			"package.json", ".github/workflows/x.yml", "scripts/x.mjs"]) {
			const t = setup();
			t.task({ [file]: "runtime\n", "README.md": "doc\n" });
			const r = t.run(MSG());
			assert.equal(r.code, 0, `${file}\n${r.out}`);
			assert.deepEqual(t.nodeCalls(), [{ args: ["--test", "test/relevant.test.ts"], cwd: realpathSync(t.worktree), head: t.git("-C", t.worktree, "rev-parse", "HEAD") }], file);
		}
	});

	it("runs targeted tests for changed or removed coordinator blocks, including split process sections", () => {
		for (const file of ["PROCESS.md", "process/subagent-models.md"]) {
			for (const text of [block.replace("1", "2"), "Rule without block.\n"]) {
				const t = setup();
				base(t, { [file]: block });
				t.task({ [file]: text });
				const r = t.run(MSG());
				assert.equal(r.code, 0, r.out);
				assert.deepEqual(t.nodeCalls(), [{ args: ["--test", "test/relevant.test.ts"], cwd: realpathSync(t.worktree), head: t.git("-C", t.worktree, "rev-parse", "HEAD") }], file);
			}
		}
	});

	it("runs targeted tests when an unchanged coordinator block moves away from root PROCESS.md", () => {
		for (const root of ["# Process\n", null]) {
			const t = setup();
			base(t, { "PROCESS.md": block });
			t.task({ "PROCESS.md": root, "process/subagent-models.md": block });
			const r = t.run(MSG());
			assert.equal(r.code, 0, r.out);
			assert.deepEqual(t.nodeCalls(), [{ args: ["--test", "test/relevant.test.ts"], cwd: realpathSync(t.worktree), head: t.git("-C", t.worktree, "rev-parse", "HEAD") }], root === null ? "deleted root" : "removed root block");
			assert.doesNotMatch(r.out, /document checks: PASS/);
		}
	});

	it("checks touched owner quotes in every eligible document but preserves historical quotes", () => {
		for (const file of ["README.md", "notes/quotes.md", "docs/quotes.md", "extensions/RQW-x/README.md"]) {
			const t = setup();
			base(t, { [file]: "Owner: «historical invention».\n\nOld text.\n" });
			t.task({ [file]: "Owner: «historical invention».\n\nOwner: «Keep the owner's exact words.»\n" });
			const good = t.run(MSG());
			assert.equal(good.code, 0, `${file}\n${good.out}`);
			assert.match(savedLog(good.out), /Document checks PASS/);
			writeFileSync(join(t.worktree, file), "Owner: «historical invention».\n\nOwner: «fabricated touched owner requirement».\n");
			t.git("-C", t.worktree, "add", file);
			t.git("-C", t.worktree, "commit", "--quiet", "-m", "fabricated touched quote");
			const bad = t.run(MSG());
			assert.equal(bad.code, 1, `${file}\n${bad.out}`);
			assert.match(bad.out, /quote is not verbatim.*fabricated touched owner requirement/);
			assert.match(savedLog(bad.out), /Document checks FAIL/);
			assert.deepEqual(t.nodeCalls(), []);
		}
	});

	it("keeps the existing process owner-quote gate on mixed executable changes", () => {
		const t = setup();
		t.task({ "PROCESS.md": "Owner: «fabricated mixed requirement».\n", "scripts/run.mjs": "export {};\n" });
		const r = t.run(MSG());
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /PROCESS\.md:1 quote is not verbatim/);
	});

	it("rejects newly broken existing links in touched documents and saves failures", () => {
		for (const mode of ["same document heading", "target heading", "deleted target"]) {
			const t = setup();
			base(t, { "README.md": "[existing](#before)\n\n# Before\nOld prose.\n",
				"notes/source.md": "[existing](target.md#before)\n\nOld prose.\n",
				"notes/target.md": "# Before\n" });
			if (mode === "same document heading") t.task({ "README.md": "[existing](#before)\n\n# After\nOld prose.\n" });
			else t.task({ "notes/source.md": "[existing](target.md#before)\n\nNew prose.\n",
				"notes/target.md": mode === "deleted target" ? null : "# After\n" });
			const r = t.run(MSG());
			assert.equal(r.code, 1, `${mode}\n${r.out}`);
			assert.match(r.out, /missing (?:Markdown anchor|local target)/);
			assert.match(savedLog(r.out), /Document checks FAIL/);
			assert.deepEqual(t.nodeCalls(), []);
		}
	});

	it("counts deleted executable paths and Markdown modes/shebangs on both sides of a move", () => {
		for (const kind of ["script move", "executable markdown", "removed shebang", "new shebang"]) {
			const t = setup();
			if (kind === "script move") {
				base(t, { "scripts/run.js": "console.log(1);\n" });
				t.task({ "scripts/run.js": null, "notes/run.md": "console.log(1);\n" });
			} else if (kind === "executable markdown") {
				t.task({ "notes/run.md": "doc\n" });
				t.git("-C", t.worktree, "update-index", "--chmod=+x", "notes/run.md");
				chmodSync(join(t.worktree, "notes/run.md"), 0o755);
				t.git("-C", t.worktree, "commit", "--quiet", "-m", "mode");
			} else if (kind === "removed shebang") {
				base(t, { "notes/run.md": "#!/usr/bin/env node\ncode\n" });
				t.task({ "notes/run.md": "doc\n" });
			} else t.task({ "notes/run.md": "#!/usr/bin/env node\ncode\n" });
			const r = t.run(MSG());
			assert.equal(r.code, 0, `${kind}\n${r.out}`);
			assert.deepEqual(t.nodeCalls(), [{ args: ["--test", "test/relevant.test.ts"], cwd: realpathSync(t.worktree), head: t.git("-C", t.worktree, "rev-parse", "HEAD") }], kind);
		}
	});

	it("fails broken links, anchors, formatting and invented touched quotes despite a claimed log", () => {
		for (const [file, text] of [["README.md", "[missing](absent.md)\n"],
			["README.md", "[missing](README.md#absent)\n"], ["README.md", "trailing  \t\n"],
			["README.md", "```js\nunclosed\n"], ["process/delivery.md", "Owner: «invented requirement».\n"]]) {
			const t = setup();
			t.task({ [file]: text });
			const fake = join(t.tmp, "claimed.log");
			writeFileSync(fake, "everything passed\n");
			const r = t.run(MSG() + `Doc-check: ${fake}\n`);
			assert.equal(r.code, 1, `${file}: ${text}\n${r.out}`);
			assert.match(savedLog(r.out), /Document checks FAIL/);
			assert.deepEqual(t.nodeCalls(), []);
		}
	});

	it("ignores untouched historical archive links", () => {
		const t = setup();
		base(t, { "DECISIONS-ARCHIVE.md": "[historical](../gone.md#old)\n\nUnchanged.\n" });
		t.task({ "DECISIONS-ARCHIVE.md": "[historical](../gone.md#old)\n\nNew text.\n" });
		const r = t.run(DOC_MSG);
		assert.equal(r.code, 0, r.out);
		assert.deepEqual(t.nodeCalls(), []);
	});
});

describe("deliver-check targeted release integration", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
	it("fails closed on a real selector filesystem read error without launching tests", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n", ".gitignore": "unreadable/\n" });
		const unreadable = join(t.worktree, "unreadable");
		mkdirSync(unreadable);
		chmodSync(unreadable, 0o000);
		try {
			const r = t.run(MSG());
			assert.equal(r.code, 1, r.out);
			assert.match(r.out, /FAIL targeted tests: cannot select tests: EACCES/);
			assert.doesNotMatch(r.out, /deliver-check PASS/);
			assert.deepEqual(t.nodeCalls(), []);
		} finally {
			chmodSync(unreadable, 0o700);
		}
	});

	it("rejects a main destination even when release refs exist", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		t.git("checkout", "--quiet", "-b", "main");
		const r = t.run(MSG());
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /does not have refs\/heads\/release checked out/);
		assert.deepEqual(t.nodeCalls(), []);
	});

	it("does not fall back to main when origin/release is absent", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		t.git("push", "--quiet", "origin", "release:main");
		t.git("-C", join(t.tmp, "origin.git"), "symbolic-ref", "HEAD", "refs/heads/main");
		t.git("push", "--quiet", "origin", ":release");
		t.git("update-ref", "-d", "refs/remotes/origin/release");
		const r = t.run(MSG());
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /cannot resolve task, origin\/release/);
		assert.deepEqual(t.nodeCalls(), []);
	});

	it("passes only concrete selected paths to node in the task worktree, supporting both layouts", () => {
		const t = setup();
		t.commit("release", {
			"test/isolation.test.ts": "export {};\n",
			"test/owner.test.ts": '"extensions/RQW-x/index.ts";\n',
			"test/unrelated.test.ts": '"other/file.ts";\n',
			"extensions/RQW-x/test/current.test.ts": "export {};\n",
			"test/extensions/RQW-x/moved.test.ts": "export {};\n",
			"extensions/RQW-y/test/unrelated.test.ts": "export {};\n",
		});
		t.git("push", "--quiet", "origin", "release");
		const head = t.task({ "extensions/RQW-x/index.ts": "export {};\n" });
		const r = t.run(MSG());
		assert.equal(r.code, 0, r.out);
		assert.deepEqual(t.nodeCalls(), [{ args: ["--test", "extensions/RQW-x/test/current.test.ts",
			"test/extensions/RQW-x/moved.test.ts", "test/isolation.test.ts", "test/owner.test.ts"],
			cwd: realpathSync(t.worktree), head }]);
	});

	it("reports no discovered coverage without running node's default full discovery", () => {
		const t = setup();
		t.task({ "unknown/no-static-owner.ts": "export {};\n" });
		const r = t.run(MSG());
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /none discovered; no runtime tests executed/);
		assert.match(r.out, /targeted tests: NONE/);
		assert.deepEqual(t.nodeCalls(), []);
	});
});

describe("deliver-check QA cache lines", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
	const redRun = { id: 5, name: "tests", path: ".github/workflows/tests.yml@refs/heads/main", head_branch: "main", status: "completed",
		conclusion: "failure", created_at: "2026-10-23T10:00:00Z", html_url: "https://github.com/o/r/actions/runs/5" };
	const passing = (t: ReturnType<typeof setup>) => {
		t.task({ "src/a.js": "1\n" });
	};

	it("reports the sidecar inbox snapshot with its date as local cached, after PASS, with no gh issue list", () => {
		const t = setup();
		passing(t);
		t.inbox({ items: [{ id: "i1", level: "red", text: "#12 [qa] tests: a.test.ts failing", url: "https://github.com/o/r/issues/12" }] });
		const r = t.run(MSG());
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /  QA inbox: local cached snapshot from 2026-10-23T09:00:00\.000Z; not refreshed by ci-watch, not the current state/);
		assert.match(r.out, /  QA inbox: RED #12 \[qa\] tests: a\.test\.ts failing https:\/\/github\.com\/o\/r\/issues\/12/);
		assert.ok(r.out.indexOf("PASS") < r.out.indexOf("QA inbox"));
		assert.doesNotMatch(t.ghCalls(), /issue list/);
		assert.equal(t.ghCalls(), "");
	});

	it("never says the inbox is empty or open without a snapshot; an empty snapshot says so with its date", () => {
		const t = setup();
		passing(t);
		const none = t.run(MSG());
		assert.equal(none.code, 0, none.out);
		assert.match(none.out, /QA inbox: no local snapshot \(ENOENT\); run npm run ci-watch -- --refresh-inbox/);
		assert.doesNotMatch(none.out, /no items|QA open/);
		t.inbox({ items: [] });
		const empty = t.run(MSG());
		assert.match(empty.out, /QA inbox: local cached snapshot from 2026-10-23T09:00:00\.000Z/);
		assert.match(empty.out, /QA inbox: no items in that snapshot/);
	});

	it("ignores the old inboxItems field of status.json and reports an invalid sidecar", () => {
		const t = setup();
		passing(t);
		t.cache({ inboxItems: [{ id: "x", level: "red", text: "old shim item", url: "" }] });
		const old = t.run(MSG());
		assert.doesNotMatch(old.out, /old shim item/);
		assert.match(old.out, /QA inbox: no local snapshot/);
		for (const bad of [{ version: 2 }, { items: "x" }, { fetchedAt: "not a date" }]) {
			t.inbox(bad);
			const r = t.run(MSG());
			assert.equal(r.code, 0, r.out);
			assert.match(r.out, /QA inbox: local snapshot invalid/);
		}
	});

	it("reports an absent, stale or failed status cache as one unavailable line and still passes", () => {
		const t = setup();
		passing(t);
		const absent = t.run(MSG());
		assert.equal(absent.code, 0, absent.out);
		assert.match(absent.out, /main runs: unavailable \(no readable ci-watch cache: ENOENT\)/);
		t.cache({}, 181_000);
		assert.match(t.run(MSG()).out, /main runs: unavailable \(ci-watch cache stale or invalid\)/);
		t.cache({ error: "HTTP 502: bad gateway\nsecond line" });
		const failed = t.run(MSG());
		assert.equal(failed.code, 0, failed.out);
		assert.match(failed.out, /main runs: unavailable \(ci-watch fetch failed: HTTP 502: bad gateway\)/);
		assert.doesNotMatch(failed.out, /second line/);
	});

	it("shows a red main run from the cache as extra information, also on failure, and ignores other branches", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		t.cache({ runs: [redRun, { ...redRun, id: 6, head_branch: "task", html_url: "https://x/6" }] });
		const r = t.run("Task\n\nUnverified: none\n");
		assert.equal(r.code, 1);
		assert.match(r.out, /  main red \(cached\): tests failure https:\/\/github\.com\/o\/r\/actions\/runs\/5/);
		assert.doesNotMatch(r.out, /x\/6/);
	});

	it("does not substitute a green cached run for local tests", () => {
		const t = setup();
		const head = t.task({ "src/a.js": "1\n" });
		t.cache({ runs: [{ ...redRun, conclusion: "success", head_sha: head, head_branch: "task" }] });
		t.env.FAKE_NODE_MODE = "fail";
		const r = t.run(MSG());
		assert.equal(r.code, 1);
	});
});

describe("deliver-check proofreading exemption and combined review", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
	const doc = (t: ReturnType<typeof setup>) => {
		const log = join(t.tmp, "doc-check.log");
		writeFileSync(log, "doc check ok\n");
		return log;
	};
	const PROOF = (log: string) => `Fix typos\n\nChange-class: proofreading\nDoc-check: ${log}\nUnverified: none\n`;
	const withRelease = (t: ReturnType<typeof setup>, files: Record<string, string>) => {
		t.commit("release", files);
		t.git("push", "--quiet", "origin", "release");
	};

	it("accepts proofreading of passive documents with a Doc-check log and no review trailers", () => {
		const t = setup();
		withRelease(t, { "DECISIONS.md": "a\n", "notes/n.md": "n\n" });
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
		withRelease(t, { "PROCESS.md": block("1") });
		t.task({ "PROCESS.md": block("1").replace("outer prose", "outer proza") });
		const ok1 = t.run(PROOF(doc(t)));
		assert.equal(ok1.code, 0, ok1.out);

		const u = setup();
		withRelease(u, { "PROCESS.md": block("1") });
		u.task({ "PROCESS.md": block("2") });
		const bad = u.run(PROOF(doc(u)));
		assert.equal(bad.code, 1, bad.out);
		assert.match(bad.out, /PROCESS\.md coordinator-rules block changed or unreadable/);
	});

	it("rejects proofreading together with a QA line and keeps the owner quote gate", () => {
		const t = setup();
		withRelease(t, { "DECISIONS.md": "a\n" });
		t.task({ "DECISIONS.md": "Owner: \u00abinvented words\u00bb\n" });
		const quote = t.run(PROOF(doc(t)));
		assert.equal(quote.code, 1, quote.out);
		assert.match(quote.out, /FAIL DECISIONS\.md:1 quote is not verbatim/);
		const qa = t.run(PROOF(doc(t)) + "QA: #6\nTest-review: agent#8 CLEAN\n");
		assert.match(qa.out, /"QA: #N" is not proofreading/);
	});

	const EXT = "extensions/RQW-x";
	const lines = (n: number, tag = "n") => Array.from({ length: n }, (_, i) => `${tag}${i}\n`).join(""); // distinct lines, so a rewrite counts both sides
	const COMBINED = (extra = "") => `Task\n\nCombined-review: agent#7 CLEAN\n${extra}Unverified: none\n`;
	// Runs one combined-review change; `base` files are first committed to release.
	const combined = (files: Record<string, string | null>, base: Record<string, string> = {}, extra = "") => {
		const t = setup();
		if (Object.keys(base).length) { t.commit("release", base); t.git("push", "--quiet", "origin", "release"); }
		t.task(files);
		t.issues({ view: { "6": { labels: [{ name: "qa-inbox" }], state: "OPEN" } } });
		return t.run(COMBINED(extra));
	};

	it("accepts Combined-review in place of Review and Code-review inside one extension", () => {
		const r = combined({ [`${EXT}/a.js`]: "1\n", [`${EXT}/sub/b.js`]: "2\n" });
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /reviews: combined agent#7 \(result and code review\)/);
		const t = setup();
		t.task({ [`${EXT}/a.js`]: "1\n" });
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
		t.task({ "src/a.js": "1\n", [`${EXT}/b.js`]: "1\n" }); // outside one extension: combined is ineligible
		const r = t.run(MSG() + "Combined-review: agent#9 CLEAN\n");
		assert.equal(r.code, 0, r.out);
	});
});

describe("deliver-check test integrity", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
	const TRAILERS = "Test-change: the old assertion checked a timing that is not part of the contract\nTest-review: agent#8 CLEAN\n";
	const BASE_TEST = 'import assert from "node:assert/strict";\nit("a", () => {\n\tassert.equal(1, 1);\n\tassert.equal(2, 2);\n});\n';
	const withRelease = (t: ReturnType<typeof setup>, files: Record<string, string>) => {
		t.commit("release", files);
		t.git("push", "--quiet", "origin", "release");
	};

	it("fails an added skip without trailers and passes with both", () => {
		const t = setup();
		withRelease(t, { "test/a.test.ts": BASE_TEST });
		t.task({ "test/a.test.ts": BASE_TEST.replace('it("a"', 'it.skip("a"') });
		const bad = t.run(MSG());
		assert.equal(bad.code, 1, bad.out);
		assert.match(bad.out, /FAIL test integrity: test\/a\.test\.ts adds skip\/todo: missing trailer "Test-change: <text>" and "Test-review: agent#N CLEAN"/);
		const partial = t.run(MSG() + "Test-change: why\n");
		assert.match(partial.out, /FAIL test integrity: test\/a\.test\.ts adds skip\/todo: missing trailer "Test-review: agent#N CLEAN"/);
		assert.match(partial.out, /review with agent_type: "test-reviewer"/);
		const good = t.run(MSG() + TRAILERS);
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
			t.task({ [file]: text });
			const r = t.run(MSG());
			assert.equal(r.code, 1, `${file} ${rule}\n${r.out}`);
			assert.ok(r.out.includes(`FAIL test integrity: ${file} ${rule}`), r.out);
		}
	});

	it("ignores comments, continue-on-error false and non-test files", () => {
		const t = setup();
		t.task({ "test/c.test.ts": "// it.skip(\"later\")\nit(\"c\", () => {});\n",
			".github/workflows/x.yml": "# continue-on-error: true is forbidden\njobs:\n  a:\n    continue-on-error: false\n",
			"src/skip.js": "it.skip('x');\n" });
		const r = t.run(MSG());
		assert.equal(r.code, 0, r.out);
	});

	it("fails a raised timeout and passes a lowered or unchanged one", () => {
		const t = setup();
		const tests = readFileSync(join(ROOT, ".github", "workflows", "tests.yml"), "utf8");
		const key = /timeout-minutes: (\d+)/.exec(tests);
		assert.ok(key, "tests.yml has a timeout-minutes line");
		const raised = tests.replace(/timeout-minutes: \d+/, `timeout-minutes: ${Number(key[1]) + 20}`);
		t.task({ ".github/workflows/tests.yml": raised });
		const bad = t.run(MSG());
		assert.equal(bad.code, 1, bad.out);
		assert.match(bad.out, new RegExp(`FAIL test integrity: \\.github/workflows/tests\\.yml raises timeout-minutes ${key[1]} -> ${Number(key[1]) + 20}: missing trailer`));
		assert.equal(t.run(MSG() + TRAILERS).code, 0);

		const u = setup();
		const lowered = tests.replace(/timeout-minutes: \d+/, "timeout-minutes: 5");
		u.task({ ".github/workflows/tests.yml": lowered });
		assert.equal(u.run(MSG()).code, 0);
	});

	it("fails a raised timeout in a test file but not a moved or new one", () => {
		const t = setup();
		withRelease(t, { "test/d.test.ts": "it(\"d\", { timeout: 5000 }, () => {});\nconst timeoutMs = 100;\n" });
		t.task({ "test/d.test.ts": "const timeoutMs = 100;\nit(\"d\", { timeout: 60_000 }, () => {});\n" });
		const r = t.run(MSG());
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /FAIL test integrity: test\/d\.test\.ts raises timeout 5000 -> 60000/);
		assert.doesNotMatch(r.out, /timeoutMs/);

		const u = setup();
		withRelease(u, { "test/d.test.ts": "it(\"d\", { timeout: 5000 }, () => {});\nconst timeoutMs = 100;\n" });
		u.task({ "test/d.test.ts": "const timeoutMs = 100;\nit(\"d\", { timeout: 5000 }, () => {});\nit(\"e\", { timeout: 90000 }, () => {});\n" });
		assert.equal(u.run(MSG()).code, 0);
	});

	it("fails when a test file loses assertions and passes when the count holds", () => {
		const t = setup();
		withRelease(t, { "test/a.test.ts": BASE_TEST });
		t.task({ "test/a.test.ts": 'import assert from "node:assert/strict";\nit("a", () => {\n\tassert.equal(1, 1);\n});\n' });
		const bad = t.run(MSG());
		assert.equal(bad.code, 1, bad.out);
		assert.match(bad.out, /FAIL test integrity: test\/a\.test\.ts removes assertions \(removed 1, added 0\): missing trailer/);
		assert.equal(t.run(MSG() + TRAILERS).code, 0);

		const u = setup();
		withRelease(u, { "test/a.test.ts": BASE_TEST });
		u.task({ "test/a.test.ts": BASE_TEST.replace("assert.equal(2, 2)", "assert.deepEqual([2], [2])") });
		assert.equal(u.run(MSG()).code, 0);

		const d = setup();
		withRelease(d, { "test/a.test.ts": BASE_TEST });
		d.task({ "test/a.test.ts": null });
		assert.match(d.run(MSG()).out, /FAIL test integrity: test\/a\.test\.ts removes assertions \(removed 2, added 0\)/);
	});

	const inbox = { labels: [{ name: "qa-inbox" }], state: "OPEN" };

	it("QA: #N needs a qa-inbox issue", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		t.issues({ view: { "5": { labels: [{ name: "bug" }], state: "OPEN" }, "6": inbox } });
		const wrong = t.run(MSG() + "QA: #5\nTest-review: agent#8 CLEAN\n");
		assert.equal(wrong.code, 1, wrong.out);
		assert.match(wrong.out, /FAIL message: "QA: #5" is not a qa-inbox issue/);
		const missing = t.run(MSG() + "QA: #99\nTest-review: agent#8 CLEAN\n");
		assert.match(missing.out, /FAIL message: "QA: #99": gh issue view failed: GraphQL: Could not resolve to an Issue/);
		t.env.FAKE_GH_ISSUE_FAIL = "1";
		assert.match(t.run(MSG() + "QA: #6\nTest-review: agent#8 CLEAN\n").out, /FAIL message: "QA: #6": gh issue view failed: HTTP 502/);
	});

	it("QA: #N without weakening needs neither integrity trailer but still rejects malformed QA lines", () => {
		const t = setup();
		t.task({ "src/a.js": "1\n" });
		t.issues({ view: { "6": inbox } });
		const good = t.run(MSG() + "QA: #6\n");
		assert.equal(good.code, 0, good.out);
		assert.match(good.out, /QA: #6 \(qa-inbox issues\)/);
		assert.doesNotMatch(good.out, /Test-review present|test integrity:/);
		const malformed = t.run(MSG() + "QA: 6\n");
		assert.equal(malformed.code, 1, malformed.out);
		assert.match(malformed.out, /FAIL message: malformed line "QA: 6"/);
	});

	it("ordinary QA test or workflow changes need Test-change but not Test-review without weakening", () => {
		for (const files of [
			{ "test/new.test.ts": 'import assert from "node:assert/strict";\nit("n", () => assert.ok(true));\n' },
			{ ".github/workflows/extra.yml": "name: extra\non: workflow_dispatch\njobs: {}\n" },
		]) {
			const t = setup();
			t.task(files);
			t.issues({ view: { "6": inbox } });
			const msg = MSG() + "QA: #6\n";
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
		withRelease(t, { "test/a.test.ts": BASE_TEST });
		t.task({ "test/a.test.ts": BASE_TEST.replace('it("a"', 'it.skip("a"') });
		t.issues({ view: { "6": inbox } });
		for (const qa of ["", "QA: #6\n"]) {
			for (const trailer of ["", "Test-change: approved reason\n", "Test-review: agent#8 CLEAN\n"]) {
				const result = t.run(MSG() + qa + trailer);
				assert.equal(result.code, 1, result.out);
				assert.match(result.out, /FAIL test integrity: test\/a\.test\.ts adds skip\/todo: missing trailer/);
				if (!trailer.startsWith("Test-change:")) assert.ok(result.out.includes('"Test-change: <text>"'), result.out);
				if (!trailer.startsWith("Test-review:")) assert.ok(result.out.includes('"Test-review: agent#N CLEAN"'), result.out);
			}
			const good = t.run(MSG() + qa + TRAILERS);
			assert.equal(good.code, 0, good.out);
			assert.match(good.out, /test integrity: 1 weakening file\(s\) accepted/);
		}
	});
});
