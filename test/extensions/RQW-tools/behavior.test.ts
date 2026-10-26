import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeEdit } from "../../../extensions/RQW-tools/edit.ts";
import { executeWrite } from "../../../extensions/RQW-tools/write.ts";

test("regression: cancellation after a stock edit commits is possibly changed", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "rqw-edit-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const stock = async (_id: string, params: any) => {
		await writeFile(join(cwd, params.path), params.edits[0].newText);
		if (params.path === "b.txt") throw Object.assign(new Error("Operation aborted"), { name: "AbortError" });
		return { content: [{ type: "text", text: "ok" }] };
	};
	const result: any = await executeEdit(stock, "e", { edits: [
		{ path: "a.txt", oldText: "a", newText: "A" },
		{ path: "b.txt", oldText: "b", newText: "B" },
	] }, undefined, undefined, { cwd }, cwd);
	assert.equal(result.isError, true);
	assert.equal(result.details.files[1].outcome, "possibly_changed");
	assert.equal(await readFile(join(cwd, "b.txt"), "utf8"), "B");
});

test("regression: cancellation after a stock write commits is possibly changed", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "rqw-write-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const stock = async (_id: string, params: any) => {
		await writeFile(join(cwd, params.path), params.content);
		if (params.path === "b.txt") throw Object.assign(new Error("Operation aborted"), { name: "AbortError" });
		return { content: [{ type: "text", text: "ok" }] };
	};
	const result: any = await executeWrite(stock, "w", { files: [{ path: "a.txt", content: "a" }, { path: "b.txt", content: "b" }] }, undefined, undefined, { cwd }, cwd);
	assert.equal(result.isError, true);
	assert.equal(result.details.files[1].outcome, "possibly_changed");
	assert.equal(await readFile(join(cwd, "b.txt"), "utf8"), "b");
});
