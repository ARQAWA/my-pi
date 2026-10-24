import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { render } from "../scripts/tasks-view.mjs";

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
		const tmp = join(dir, "tmp");
		mkdirSync(tmp);
		const env = { ...process.env, TMPDIR: tmp, PATH: `${bin}${delimiter}${process.env.PATH}` };
		return { dir, log, tmp, env };
	}
	const run = (args: string[], env: NodeJS.ProcessEnv) => spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: "utf8" });

	it("--no-open writes a unique HTML under the OS temp dir and opens nothing", () => {
		const { dir, log, tmp, env } = setup();
		const source = join(dir, "src.md");
		writeFileSync(source, SRC);
		const a = run(["--no-open", "--source", source], env);
		const b = run(["--no-open", "--source", source], env);
		assert.equal(a.status, 0, a.stderr);
		const [pa, pb] = [a.stdout.trim(), b.stdout.trim()];
		assert.notEqual(pa, pb);
		for (const p of [pa, pb]) {
			assert.ok(p.startsWith(tmp) || p.startsWith(join("/private", tmp)), p);
			assert.ok(existsSync(p));
		}
		assert.equal(sourceOf(readFileSync(pa, "utf8")), SRC);
		assert.equal(existsSync(log), false);
	});

	it("opens the generated file exactly once without --no-open", () => {
		const { dir, log, env } = setup();
		const source = join(dir, "src.md");
		writeFileSync(source, "# H\n");
		const r = run(["--source", source], env);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(readFileSync(log, "utf8").trim(), r.stdout.trim());
	});

	it("rejects unknown arguments and missing sources", () => {
		const { env } = setup();
		assert.equal(run(["--bogus"], env).status, 2);
		assert.equal(run(["--no-open", "--source", "/nonexistent/x.md"], env).status, 2);
	});

	it("generates the actual repository backlog without losing a byte of it", () => {
		const { tmp, env } = setup();
		const r = run(["--no-open"], env);
		assert.equal(r.status, 0, r.stderr);
		const html = readFileSync(r.stdout.trim(), "utf8");
		assert.equal(sourceOf(html), readFileSync(join(ROOT, "BACKLOG.md"), "utf8"));
		assert.match(html, /<strong>U13<\/strong>/);
		assert.match(html, /Repository HEAD: <code>[0-9a-f]{40}<\/code>/);
		assert.ok(tmp);
	});
});
