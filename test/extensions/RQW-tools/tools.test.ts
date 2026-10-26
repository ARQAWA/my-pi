import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTools } from "../../../extensions/RQW-tools/index.ts";

test("multi-file write and edit return confirmed results", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "rqw-tools-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const tools = Object.fromEntries(createTools(cwd, () => ({})).map((tool) => [tool.name, tool as any]));
	const ctx = { cwd };
	const written = await tools.write.execute("w", { files: [{ path: "a.txt", content: "alpha\n" }, { path: "nested/b.txt", content: "beta\n" }] }, undefined, undefined, ctx);
	assert.equal(written.isError, undefined);
	const edited = await tools.edit.execute("e", { edits: [{ path: "a.txt", oldText: "alpha", newText: "one" }, { path: "nested/b.txt", oldText: "beta", newText: "two" }] }, undefined, undefined, ctx);
	assert.equal(edited.isError, undefined);
	assert.equal(await readFile(join(cwd, "a.txt"), "utf8"), "one\n");
	assert.equal(await readFile(join(cwd, "nested/b.txt"), "utf8"), "two\n");
	const found = await tools.grep.execute("g", { pattern: "two", path: null }, undefined, undefined, ctx);
	assert.match(found.content[0].text, /two/);
});

test("read keeps the stock schema and repeats return content", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "rqw-tools-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const tools = Object.fromEntries(createTools(cwd, () => ({})).map((tool) => [tool.name, tool as any]));
	assert.deepEqual(Object.keys(tools.read.parameters.properties).sort(), ["limit", "offset", "path"]);
	await tools.write.execute("w", { path: "a.txt", content: "alpha\n" }, undefined, undefined, { cwd });
	for (let i = 0; i < 2; i++) {
		const result = await tools.read.execute(`r${i}`, { path: "a.txt" }, undefined, undefined, { cwd });
		assert.match(result.content[0].text, /alpha/);
	}
});
