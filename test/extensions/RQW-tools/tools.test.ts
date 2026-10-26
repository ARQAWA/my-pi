import assert from "node:assert/strict";
import test from "node:test";
import { executeEdit } from "../../../extensions/RQW-tools/edit.ts";
import { createTools } from "../../../extensions/RQW-tools/index.ts";
import { executeWrite } from "../../../extensions/RQW-tools/write.ts";

const stock = async (_id: string, params: unknown) => ({ content: [{ type: "text", text: "ok" }], details: params });

test("multi-file write and edit return confirmed results", async () => {
	const written: any = await executeWrite(stock, "w", { files: [
		{ path: "a.txt", content: "alpha\n" }, { path: "nested/b.txt", content: "beta\n" },
	] }, undefined, undefined, {}, "/work");
	assert.equal(written.isError, undefined);
	assert.deepEqual(written.details.files, [
		{ path: "a.txt", ok: true, details: { path: "a.txt", content: "alpha\n" } },
		{ path: "nested/b.txt", ok: true, details: { path: "nested/b.txt", content: "beta\n" } },
	]);
	const edited: any = await executeEdit(stock, "e", { edits: [
		{ path: "a.txt", oldText: "alpha", newText: "one" }, { path: "nested/b.txt", oldText: "beta", newText: "two" },
	] }, undefined, undefined, {}, "/work");
	assert.equal(edited.isError, undefined);
	assert.deepEqual(edited.details.files, [
		{ path: "a.txt", ok: true, details: { path: "a.txt", edits: [{ oldText: "alpha", newText: "one" }] } },
		{ path: "nested/b.txt", ok: true, details: { path: "nested/b.txt", edits: [{ oldText: "beta", newText: "two" }] } },
	]);
});

test("read keeps the stock schema", () => {
	const tools = Object.fromEntries(createTools("/work", () => ({})).map(tool => [tool.name, tool as any]));
	assert.deepEqual(Object.keys(tools.read.parameters.properties).sort(), ["limit", "offset", "path"]);
});
