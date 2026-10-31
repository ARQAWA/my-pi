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

test("bash keeps the stock schema shape with the design's parameter descriptions", () => {
	const tools = Object.fromEntries(createTools("/work", () => ({})).map(tool => [tool.name, tool as any]));
	const properties = tools.bash.parameters.properties;
	assert.deepEqual(Object.keys(properties).sort(), ["command", "timeout"]);
	assert.equal(properties.command.description, "The command to execute");
	assert.equal(properties.timeout.description, "Timeout in seconds; kills the command and its child processes. Without it there is no command deadline.");
});

test("bash description starts its bullets with the dedicated-tool warning", () => {
	const tools = Object.fromEntries(createTools("/work", () => ({})).map(tool => [tool.name, tool as any]));
	const bullets = tools.bash.description.split(/\r?\n/).filter((line: string) => line.startsWith("- "));
	assert.equal(bullets[0], "- IMPORTANT: Avoid using this tool to run `rg`, `fd`, `grep`, `find`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user.");
	assert.equal(bullets[1], "- Search file contents with rqw_rg, not grep or rg. Find or list files with rqw_glob, not find, fd or ls. Read files with rqw_readfile, not cat, head or tail.");
});
