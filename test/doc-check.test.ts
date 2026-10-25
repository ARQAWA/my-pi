import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { checkDocuments } from "../scripts/doc-check.mjs";

const temps: string[] = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

function check(before: Record<string, string>, after: Record<string, string | null>, dirty: Record<string, string> = {}) {
	const cwd = mkdtempSync(join(tmpdir(), "doc-check-"));
	temps.push(cwd);
	const git = (...args: string[]) => execFileSync("git", args, {
		cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
	}).trim();
	git("init", "--quiet");
	git("config", "user.name", "Doc Test");
	git("config", "user.email", "doc@example.test");
	git("config", "commit.gpgsign", "false");
	const write = (files: Record<string, string | null>) => {
		for (const [file, text] of Object.entries(files)) {
			if (text === null) { rmSync(join(cwd, file)); continue; }
			mkdirSync(dirname(join(cwd, file)), { recursive: true });
			writeFileSync(join(cwd, file), text);
		}
	};
	write(before);
	git("add", ".");
	git("commit", "--quiet", "--allow-empty", "-m", "base");
	const base = git("rev-parse", "HEAD");
	write(after);
	git("add", ".");
	git("commit", "--quiet", "--allow-empty", "-m", "head");
	const head = git("rev-parse", "HEAD");
	write(dirty);
	return checkDocuments({ git, base, head, files: git("diff", "--name-only", base, head).split("\n").filter(Boolean) });
}

describe("committed document checks", { skip: process.platform !== "darwin" ? "repository development tooling targets the owner's macOS laptop" : false }, () => {
	it("checks added relative paths, images and anchors against head, not disk", () => {
		const issues = check({ "README.md": "Old\n", "target.md": "# Before\n" }, {
			"README.md": "[ok](target.md#after)\n[bad](target.md#before)\n![missing](gone.png)\n",
			"target.md": "# After\n",
		}, { "target.md": "# Before\n", "gone.png": "present only on disk\n" });
		assert.equal(issues.length, 2);
		assert.match(issues[0], /README.md:2: missing Markdown anchor: target.md#before/);
		assert.match(issues[1], /README.md:3: missing local target: gone.png/);
	});

	it("accepts GFM duplicate, formatted, setext, Unicode and explicit HTML anchors", () => {
		assert.deepEqual(check({ "README.md": "Old\n", "target.md": "# Same\n# Same\n# Same-1\n# Hello *world*!\nTitle\n=====\n# Привет мир\n<a id=\"custom\"></a>\n<a name='legacy'></a>\n" }, {
			"README.md": "[a](target.md#same-1) [b](target.md#same-1-1) [c](target.md#hello-world)\n[d](target.md#title) [e](target.md#%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82-%D0%BC%D0%B8%D1%80)\n[f](target.md#custom) [g](target.md#legacy)\n",
		}), []);
	});

	it("leaves untouched historical links alone, even within the same paragraph", () => {
		assert.deepEqual(check({ "DECISIONS-ARCHIVE.md": "[dead](gone.md)\nold prose\n" }, {
			"DECISIONS-ARCHIVE.md": "[dead](gone.md)\nnew prose\n",
		}), []);
		const issues = check({ "DECISIONS-ARCHIVE.md": "[dead](gone.md)\n" }, {
			"DECISIONS-ARCHIVE.md": "[dead edited](gone.md)\n",
		});
		assert.equal(issues.length, 1);
		assert.match(issues[0], /missing local target/);
	});

	it("detects an untouched same-document link broken by an edited heading", () => {
		const issues = check({ "README.md": "# Old\n\n[jump](#old)\n" }, {
			"README.md": "# New\n\n[jump](#old)\n",
		});
		assert.equal(issues.length, 1);
		assert.match(issues[0], /README.md:3: missing Markdown anchor: #old/);
	});

	it("detects changed target headings from touched sources while ignoring shifted historical failures", () => {
		const issues = check({
			"README.md": "Intro\n\n[jump](target.md#old)\n[historical](target.md#never-existed)\n[dead](gone.md)\n",
			"target.md": "# Old\n",
		}, {
			"README.md": "Intro\n\nAdded prose.\n\n[jump](target.md#old)\n[historical](target.md#never-existed)\n[dead](gone.md)\n",
			"target.md": "# New\n",
		});
		assert.equal(issues.length, 1);
		assert.match(issues[0], /README.md:5: missing Markdown anchor: target.md#old/);
	});

	it("detects deleted targets linked from touched documents", () => {
		const issues = check({ "README.md": "Intro\n\n[jump](target.md)\n", "target.md": "# Old\n" }, {
			"README.md": "New intro\n\n[jump](target.md)\n", "target.md": null,
		});
		assert.equal(issues.length, 1);
		assert.match(issues[0], /README.md:3: missing local target: target.md/);
	});

	it("does not scan untouched source documents for broken links", () => {
		assert.deepEqual(check({ "README.md": "[jump](target.md#old)\n", "target.md": "# Old\n" }, {
			"target.md": "# New\n",
		}), []);
	});

	it("still rejects edited malformed links even when the same href was already invalid", () => {
		const issues = check({ "README.md": "[old](https://)\n" }, { "README.md": "[edited](https://)\n" });
		assert.equal(issues.length, 1);
		assert.match(issues[0], /README.md:1: malformed external URL: https:\/\//);
	});

	it("checks full, collapsed, shortcut and image reference links and changed definitions", () => {
		const issues = check({ "README.md": "[first][ref]\n\n[ref]: good.md\n", "good.md": "# Good\n" }, {
			"README.md": "[first][ref]\n\n[ref]: missing.md\n\n[ref][]\n\n[ref]\n\n![picture][pic]\n\n[pic]: missing.png\n",
		});
		assert.equal(issues.length, 6);
		assert.match(issues[0], /README.md:1: missing local target: missing.md/);
		assert.ok(issues.every((issue: string) => issue.includes("missing local target")));
	});

	it("validates external URL syntax without contacting hosts", () => {
		assert.deepEqual(check({ "README.md": "Old\n" }, {
			"README.md": "[web](https://nonexistent.example/path?q=a#x) [mail](mailto:owner@example.test) [relative](//example.test/a)\n",
		}), []);
		const issues = check({ "README.md": "Old\n" }, {
			"README.md": "[bad](https://)\n[port](https://example.test:abc/)\n[escape](https://example.test/%zz)\n",
		});
		assert.equal(issues.length, 3);
		assert.ok(issues.every((issue: string) => issue.includes("malformed external URL")));
	});

	it("ignores inline, fenced and indented code examples", () => {
		assert.deepEqual(check({ "README.md": "Intro\n" }, {
			"README.md": "Intro\n\n`[inline](missing.md)`\n\n~~~md\n[example](missing.md)\n~~~\n\n    [indented](missing.md)\n\n> ```md\n> [quote](missing.md)\n> ```\n",
		}), []);
	});

	it("preserves leading indentation and blank lines despite the caller's trimming git helper", () => {
		assert.deepEqual(check({ "README.md": "Old\n" }, { "README.md": "    [example](missing.md)\n" }), []);
		const issues = check({ "README.md": "\n\n[old](historical.md)\nold prose\n" }, {
			"README.md": "\n\n[old](historical.md)\n[new](missing.md)\n",
		});
		assert.equal(issues.length, 1);
		assert.match(issues[0], /README.md:4: missing local target: missing.md/);
	});

	it("checks links inside quote, list and table containers with exact changed lines", () => {
		const issues = check({ "README.md": "> [old](historical.md)\n> prose\n" }, {
			"README.md": "> [old](historical.md)\n> [new](new.md)\n\n- [list](list.md)\n\n| Col |\n| --- |\n| [table](table.md) |\n",
		});
		assert.equal(issues.length, 3);
		assert.match(issues[0], /README.md:2:/);
		assert.match(issues[1], /README.md:4:/);
		assert.match(issues[2], /README.md:8:/);
	});

	it("rejects unclosed fences, including a longer opening and nested containers", () => {
		for (const text of ["```js\nexample\n", "````md\n```\n", "> ~~~md\n> example\n", "- ```md\n  example\n"]) {
			const issues = check({ "README.md": "Intro\n" }, { "README.md": `Intro\n\n${text}` });
			assert.equal(issues.length, 1);
			assert.match(issues[0], /unclosed Markdown fence/);
		}
	});

	it("preserves valid legacy Markdown rather than imposing style", () => {
		assert.deepEqual(check({ "README.md": "Old\n" }, {
			"README.md": "Title\n=====\n\n### Odd heading ###\n\ntext\\\nline break\n\n````md\n```\n````\n\n~~~\nexample\n~~~~\n",
		}), []);
	});

	it("uses git diff --check for whitespace in all changed file types", () => {
		const issues = check({ "README.md": "Old\n", "plain.txt": "Old\n" }, {
			"README.md": "New\n", "plain.txt": "new \t\n",
		});
		assert.equal(issues.length, 1);
		assert.match(issues[0], /document format: plain.txt:1: trailing whitespace/);
	});
});
