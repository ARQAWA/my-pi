import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { branchNames, readRefs, render } from "../scripts/tasks-view.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "tasks-view.mjs");
const temps: string[] = [];
after(() => { for (const p of temps) rmSync(p, { recursive: true, force: true }); });
const temp = () => { const p = mkdtempSync(join(tmpdir(), "tasks-view-test-")); temps.push(p); return p; };

const META = { sourcePath: "/x/BACKLOG.md", head: "abc123", gitState: "no changes", generatedAt: "2026-10-24T00:00:00.000Z" };
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const sourceOf = (html: string) => unescape(/<pre id="source">([\s\S]*?)<\/pre>/.exec(html)![1]);

const SRC = `# Title

Intro prose with a [link](https://example.com/a?x=1&y=2) and \`code\`.

## Open

| ID | Work | Status/branch | Source |
| --- | --- | --- | --- |
| <a id="t1"></a>T1 | First <b>work</b> | OPEN, branch \`b1\` | [DECISIONS](DECISIONS.md#x) |
| T2 | Evil <script>alert(1)</script> [js](javascript:alert(2)) ![pic](https://evil.example/p.png) | QUEUED | none |

## Odd section

Prose line that is not a task.

\`\`\`text
A
|- B
\`\`\`

<img src=x onerror=alert(3)>

</script><script>alert(4)</script>
`;

describe("tasks viewer rendering", () => {
	const html = render(SRC, META);

	it("preserves the whole source, escaped", () => {
		assert.equal(sourceOf(html), SRC);
	});

	it("renders tasks, prose and code blocks from the source", () => {
		assert.equal((html.match(/<details class="task"/g) ?? []).length, 2);
		assert.match(html, /<strong>T1<\/strong>/);
		assert.doesNotMatch(html.split('<details id="full-source">')[0], /&lt;a id=/);
		assert.match(html, /<dt>Status\/branch<\/dt><dd>OPEN, branch <code>b1<\/code><\/dd>/);
		assert.match(html, /Prose line that is not a task\./);
		assert.match(html, /<code class="language-text">A\n\|- B\n<\/code>/);
		assert.match(html, /<a href="https:\/\/example\.com\/a\?x=1&amp;y=2" rel="noreferrer noopener">link<\/a>/);
		assert.match(html, /DECISIONS <code>\(DECISIONS\.md#x\)<\/code>/);
	});

	it("exposes grouping, filter and mobile metadata", () => {
		assert.match(html, /<option value="1">Open<\/option>/);
		assert.match(html, /<option value="2">Odd section<\/option>/);
		assert.equal((html.match(/data-section="1"/g) ?? []).length, 3); // heading + two tasks
		assert.match(html, /<a href="#sec-1">Open<\/a>: 2 tasks, 0 other blocks/);
		assert.match(html, /<a href="#sec-2">Odd section<\/a>: 0 tasks, 4 other blocks/);
		assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
		assert.match(html, /color-scheme:dark/);
		assert.match(html, /font:18px\/1\.5/);
		assert.match(html, /min-height:44px/);
		assert.match(html, /Repository HEAD: <code>abc123<\/code>/);
		assert.match(html, /does not reflect live agent or session state/);
	});

	it("neutralises raw HTML, unsafe links, images and script breakouts", () => {
		const page = html.split('<details id="full-source">')[0];
		assert.equal((html.match(/<script/g) ?? []).length, 1);
		assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
		assert.doesNotMatch(page, /<img|<b>|<a [^>]*javascript:|https:\/\/evil\.example/);
		assert.doesNotMatch(html, /<img|<b>/);
		assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
		assert.match(page, /js <code>\(javascript:alert\(2\)\)<\/code>/);
		assert.match(page, /pic/);
		assert.match(page, /&lt;img src=x onerror=alert\(3\)&gt;/);
		const script = /<script>([\s\S]*)<\/script>/.exec(html)![1];
		const hash = createHash("sha256").update(script).digest("base64");
		assert.ok(html.includes(`script-src 'sha256-${hash}'`));
		assert.match(html, /default-src 'none'/);
	});

	it("escapes raw-tag regions and keeps reference links in cells and headings", () => {
		const src = "# Head [spec][s]\n\n| ID | Work |\n| --- | --- |\n| <a id=\"r1\"></a>R1 | See [spec][s] and [other][s] |\n\nIntro <script><img/src=https://evil.example/x onerror=alert(1)></script> <pre><i/onclick=1></pre> <kbd><svg/onload=1></kbd> a & b\n\n[s]: https://example.com/spec\n";
		const page = render(src, META).split('<details id="full-source">')[0];
		assert.doesNotMatch(page, /<img|<i\/|<svg|onerror=alert\(1\)>/);
		assert.match(page, /&lt;img\/src=<a href="https:\/\/evil\.example\/x"[^>]*>https:\/\/evil\.example\/x<\/a> onerror=alert\(1\)&gt;/);
		assert.match(page, /a &amp; b/);
		assert.equal((page.match(/<a href="https:\/\/example\.com\/spec" rel="noreferrer noopener">/g) ?? []).length, 3);
		assert.match(page, /<strong>R1<\/strong>/);
	});

	it("escapes interpolated metadata", () => {
		const evil = render("# H", { ...META, sourcePath: '"><script>x</script>', head: "<h>" });
		assert.equal((evil.match(/<script/g) ?? []).length, 1);
		assert.match(evil, /&quot;&gt;&lt;script&gt;x&lt;\/script&gt;/);
	});
});

describe("tasks viewer CLI", { skip: process.platform !== "darwin" }, () => {
	function setup() {
		const dir = temp();
		const bin = join(dir, "bin");
		mkdirSync(bin);
		const log = join(dir, "open.log");
		writeFileSync(join(bin, "open"), `#!/bin/sh\necho "$@" >> "${log}"\n`);
		chmodSync(join(bin, "open"), 0o755);
		const tmp = join(dir, "out");
		const home = join(dir, "home");
		mkdirSync(home);
		const env = { ...process.env, HOME: home, PATH: `${bin}${delimiter}${process.env.PATH}` };
		return { dir, log, tmp, home, env };
	}
	const run = (args: string[], env: NodeJS.ProcessEnv) => spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: "utf8" });

	it("--no-open writes unique task-report files under --out-dir and opens nothing", () => {
		const { dir, log, tmp, env } = setup();
		const source = join(dir, "src.md");
		writeFileSync(source, SRC);
		const a = run(["--no-open", "--source", source, "--out-dir", tmp], env);
		const b = run(["--no-open", "--source", source, "--out-dir", tmp], env);
		assert.equal(a.status, 0, a.stderr);
		const [pa, pb] = [a.stdout.trim(), b.stdout.trim()];
		assert.notEqual(pa, pb);
		for (const p of [pa, pb]) {
			assert.equal(dirname(p), tmp);
			assert.match(p, /task-report-\d{8}T\d{9}Z\.html$/);
			assert.ok(existsSync(p));
		}
		assert.equal(sourceOf(readFileSync(pa, "utf8")), SRC);
		assert.equal(existsSync(log), false);
	});

	it("defaults to <home>/Downloads and opens the generated file exactly once", () => {
		const { dir, log, home, env } = setup();
		const source = join(dir, "src.md");
		writeFileSync(source, "# H\n");
		const r = run(["--source", source], env);
		assert.equal(r.status, 0, r.stderr);
		const file = r.stdout.trim();
		assert.equal(dirname(file), join(home, "Downloads"));
		assert.equal(readFileSync(log, "utf8").trim(), file);
	});

	it("rejects unknown arguments and missing sources", () => {
		const { env } = setup();
		assert.equal(run(["--bogus"], env).status, 2);
		assert.equal(run(["--no-open", "--source", "/nonexistent/x.md"], env).status, 2);
	});

	it("generates the actual repository backlog without losing a byte of it", () => {
		const { tmp, env } = setup();
		const r = run(["--no-open", "--out-dir", tmp], env);
		assert.equal(r.status, 0, r.stderr);
		const html = readFileSync(r.stdout.trim(), "utf8");
		assert.equal(sourceOf(html), readFileSync(join(ROOT, "BACKLOG.md"), "utf8"));
		assert.match(html, /<strong>U13<\/strong>/);
		assert.match(html, /Repository HEAD: <code>[0-9a-f]{40}<\/code>/);
		assert.match(html, /Branches \(git refs snapshot\)/);
		assert.match(html, /Explicit branch names: \d+, found: \d+, not found: \d+\. Tasks with no branch recorded: \d+\./);
	});
});

describe("branch linkage", { skip: process.platform !== "darwin" }, () => {
	it("extracts only explicitly named branches", () => {
		assert.deepEqual(branchNames("IN PROGRESS, branch `tasks-view`; leave the `qa-claim` branch; Branch `a/b.c` head `62bb752`"), ["tasks-view", "a/b.c", "qa-claim"]);
		assert.deepEqual(branchNames("no branch; after `reviewer-codex-port` is delivered; snapshot at `30952e6`"), []);
	});

	it("matches named branches against a temp git fixture without touching the repository", () => {
		const repo = temp();
		const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).trim();
		git("init", "--quiet", "-b", "main");
		git("-c", "user.name=t", "-c", "user.email=t@e", "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "one");
		const first = git("rev-parse", "HEAD");
		git("-c", "user.name=t", "-c", "user.email=t@e", "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "two");
		const second = git("rev-parse", "HEAD");
		git("branch", "feat-local", first);
		git("branch", "feat-both", first);
		git("update-ref", "refs/remotes/origin/feat-both", second);
		git("update-ref", "refs/remotes/origin/feat-remote", second);
		git("update-ref", "refs/remotes/origin/HEAD", second);

		const refs = readRefs(repo);
		assert.deepEqual({ ...refs["feat-local"] }, { local: first });
		assert.deepEqual({ ...refs["feat-both"] }, { local: first, origin: second });
		assert.deepEqual({ ...refs["feat-remote"] }, { origin: second });
		assert.equal(refs.HEAD, undefined);

		const src = "## Open\n\n| ID | Work | Status/branch |\n| --- | --- | --- |\n| A | a | OPEN, branch `feat-local` |\n| B | b | branch `feat-both` and branch `feat-remote` |\n| C | c | branch `gone-branch` |\n| D | d | no branch assigned; mentions `feat-local` without saying branch |\n";
		const html = render(src, { ...META, refs });
		const card = (id: string) => new RegExp(`<strong>${id}</strong>[\\s\\S]*?</details>`).exec(html)![0];
		assert.match(card("A"), new RegExp(`<code>feat-local</code>: local <code>${first.slice(0, 9)}</code></li>`));
		assert.match(card("B"), /feat-both<\/code>: local <code>\w+<\/code>, origin <code>\w+<\/code> \(local and origin point to different commits\)/);
		assert.match(card("B"), new RegExp(`feat-remote</code>: origin <code>${second.slice(0, 9)}</code></li>`));
		assert.match(card("C"), /<code>gone-branch<\/code>: not found in local or origin refs/);
		assert.match(card("D"), /<dt>Branches \(git refs snapshot\)<\/dt><dd>not recorded<\/dd>/);
		assert.match(html, /Explicit branch names: 4, found: 3, not found: 1\. Tasks with no branch recorded: 1\./);
		assert.match(html, /No fetch was done/);
		assert.equal(git("for-each-ref", "--format=%(refname)").split("\n").length, 6);
	});
});
