import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { selectTargetedTests } from "../scripts/targeted-tests.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(contents: Record<string, string>) {
	const root = mkdtempSync(join(tmpdir(), "targeted-tests-"));
	roots.push(root);
	for (const [path, text] of Object.entries(contents)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
	return (changed: string[]) => selectTargetedTests({ root, changed });
}

describe("targeted test selection", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
it("selects every owned test in both extension layouts plus isolation, sorted and unique", () => {
	const select = fixture({
		"extensions/one/index.ts": "",
		"extensions/one/test/z.test.ts": "",
		"extensions/one/test/nested/a.test.js": "",
		"test/extensions/one/b.test.mjs": "",
		"test/extensions/two/only.test.ts": "",
		"extensions/two/test/only.test.ts": "",
		"test/isolation.test.ts": "",
		"test/unrelated.test.ts": "",
	});
	const expected = ["extensions/one/test/nested/a.test.js", "extensions/one/test/z.test.ts", "test/extensions/one/b.test.mjs", "test/isolation.test.ts"];
	assert.deepEqual(select(["extensions/one/index.ts", "extensions/one/README.md"]), expected);
	assert.deepEqual(select(["test/extensions/one/b.test.mjs"]), expected);
	assert.deepEqual(select(["test/extensions/one/deleted.test.ts"]), expected);
	assert.deepEqual(select(["extensions/one/deleted.ts"]), expected);
	assert.deepEqual(select(["README.md"]), []);
});

it("includes changed existing tests and excludes deleted tests and fixtures", () => {
	const select = fixture({ "test/new.test.ts": "", "test/existing.test.js": "", "test/helper.ts": "", "node_modules/vendor.test.ts": "" });
	assert.deepEqual(select(["test/new.test.ts", "test/new.test.ts", "test/gone.test.mjs", "test/helper.ts"]), ["test/new.test.ts"]);
	assert.deepEqual(select(["test/existing.test.js"]), ["test/existing.test.js"]);
});

it("follows transitive static imports, exports and cycles without selecting unrelated root tests", () => {
	const select = fixture({
		"test/root.test.ts": 'import "./helper.ts";',
		"test/helper.ts": 'export { value } from "../scripts/shared.mjs";',
		"scripts/shared.mjs": 'import "../test/helper.ts"; import "./leaf.ts";',
		"scripts/leaf.ts": "export const value = 1;",
		"test/unrelated.test.ts": 'import "../scripts/other.mjs";',
		"scripts/other.mjs": "",
		"test/isolation.test.ts": "",
	});
	assert.deepEqual(select(["scripts/leaf.ts"]), ["test/root.test.ts"]);
	assert.deepEqual(select(["scripts/shared.mjs"]), ["test/root.test.ts"]);
	assert.deepEqual(select(["scripts/unknown.mjs"]), []);
});

it("resolves literal reads, root joins, dirname aliases and file URLs transitively", () => {
	const select = fixture({
		"test/join.test.ts": 'const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");\nconst SCRIPT = join(ROOT, "scripts", "reader.mjs");\nreadFileSync(SCRIPT);',
		"scripts/reader.mjs": 'const DIR = dirname(fileURLToPath(import.meta.url));\nreadFileSync(join(DIR, "../data/runtime.md"));',
		"test/url.test.ts": 'readFileSync(fileURLToPath(new URL("../data/runtime.md", import.meta.url)));',
		"test/literal.test.ts": 'readFileSync("data/runtime.md");',
		"test/relative.test.ts": 'readFileSync("../data/runtime.md");',
		"test/unrelated.test.ts": 'const ROOT = join(import.meta.dirname, "..");\nreadFileSync(join(ROOT, "scripts", "other.mjs"));',
		"scripts/other.mjs": "",
		"data/runtime.md": "runtime text",
	});
	const expected = ["test/join.test.ts", "test/literal.test.ts", "test/relative.test.ts", "test/url.test.ts"];
	assert.deepEqual(select(["data/runtime.md"]), expected);
	assert.deepEqual(select(["scripts/reader.mjs"]), ["test/join.test.ts"]);
});

it("matches deleted literal targets and directory prefixes without a wildcard fallback", () => {
	const select = fixture({
		"test/deleted.test.ts": 'import "../scripts/gone.mjs";',
		"test/directory.test.ts": 'const ROOT = join(import.meta.dirname, "..");\nconst DIR = join(ROOT, "assets", "prompts");\nreaddirSync(DIR);',
		"test/unrelated.test.ts": 'readFileSync("assets/other.md");',
		"assets/other.md": "",
	});
	assert.deepEqual(select(["scripts/gone.mjs"]), ["test/deleted.test.ts"]);
	assert.deepEqual(select(["assets/prompts/removed.md"]), ["test/directory.test.ts"]);
	assert.deepEqual(select(["assets/prompts-other/removed.md"]), []);
	assert.deepEqual(select(["package-lock.json"]), []);
});

it("treats bare repository-relative string literals as references", () => {
	const select = fixture({
		"test/relevant.test.ts": 'const source = "src/a.js"; const document = "README.md";',
		"test/unrelated.test.ts": 'const source = "src/b.js";',
		"test/isolation.test.ts": "",
		"src/a.js": "",
		"src/b.js": "",
		"README.md": "",
	});
	assert.deepEqual(select(["src/a.js"]), ["test/relevant.test.ts"]);
	assert.deepEqual(select(["README.md"]), ["test/relevant.test.ts"]);
});

it("traces runtime prompt document reads through an imported extension", () => {
	const select = fixture({
		"test/integration.test.ts": 'import prompt from "../extensions/prompt/index.ts";',
		"extensions/prompt/index.ts": 'const SYSTEM = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "SYSTEM.md"), "utf8");',
		"extensions/prompt/SYSTEM.md": "runtime prompt",
		"extensions/prompt/test/prompt.test.ts": "",
		"test/isolation.test.ts": "",
		"test/unrelated.test.ts": 'import "../extensions/other/index.ts";',
		"extensions/other/index.ts": "",
	});
	assert.deepEqual(select(["extensions/prompt/SYSTEM.md"]), ["extensions/prompt/test/prompt.test.ts", "test/integration.test.ts", "test/isolation.test.ts"]);
});
});
