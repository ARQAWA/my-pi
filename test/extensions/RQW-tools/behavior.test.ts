import assert from "node:assert/strict";
import fs, { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeEdit } from "../../../extensions/RQW-tools/edit.ts";
import { executeWrite } from "../../../extensions/RQW-tools/write.ts";

test("edits of the same path remain one atomic group when the file appears", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "rqw-edit-race-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const target = join(cwd, "target");
	const original = fs.stat;
	let calls = 0;
	let release!: () => void;
	const created = new Promise<void>((resolve) => { release = resolve; });
	fs.stat = (async (input: any, options?: any) => {
		if (input === target && ++calls === 1) {
			await writeFile(target, "before");
			release();
			throw Object.assign(new Error("missing"), { code: "ENOENT" });
		}
		if (input === target && calls === 2) await created;
		return original(input, options);
	}) as typeof fs.stat;
	t.after(() => { fs.stat = original; });
	const stock = async (_id: string, args: any) => {
		const text = await readFile(target, "utf8");
		for (const edit of args.edits) {
			if (!text.includes(edit.oldText)) throw new Error("missing text");
		}
		await writeFile(target, "changed");
		return { content: [] };
	};
	await assert.rejects(executeEdit(stock, "e", { edits: [
		{ path: target, oldText: "before", newText: "after" },
		{ path: target, oldText: "absent", newText: "x" },
	] }, undefined, undefined, { cwd }, cwd), /missing text/);
	assert.equal(await readFile(target, "utf8"), "before");
});

test("edits with different casing stay atomic when the file appears", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "rqw-edit-case-race-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const lower = join(cwd, "target");
	const upper = join(cwd, "TARGET");
	const originalStat = fs.stat;
	const originalRealpath = fs.realpath;
	let exists = false;
	let release!: () => void;
	const created = new Promise<void>((resolve) => { release = resolve; });
	fs.stat = (async (input: any, options?: any) => {
		if (input === lower && !exists) throw Object.assign(new Error("missing"), { code: "ENOENT" });
		if (input === upper && !exists) await created;
		return originalStat(input === lower && exists ? upper : input, options);
	}) as typeof fs.stat;
	fs.realpath = (async (input: any, options?: any) => {
		const result = await originalRealpath(input === lower && exists ? upper : input, options);
		if (input === cwd && !exists) {
			await writeFile(upper, "before");
			exists = true;
			release();
		}
		return result;
	}) as typeof fs.realpath;
	t.after(() => { fs.stat = originalStat; fs.realpath = originalRealpath; });
	const stock = async (_id: string, args: any) => {
		const text = await readFile(upper, "utf8");
		for (const edit of args.edits) {
			if (!text.includes(edit.oldText)) throw new Error("missing text");
		}
		await writeFile(upper, "changed");
		return { content: [] };
	};
	await assert.rejects(executeEdit(stock, "e", { edits: [
		{ path: lower, oldText: "before", newText: "after" },
		{ path: upper, oldText: "absent", newText: "x" },
	] }, undefined, undefined, { cwd }, cwd), /missing text/);
	assert.equal(await readFile(upper, "utf8"), "before");
});

test("cancellation before lookup starts does not start filesystem work", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "rqw-cancel-before-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const original = fs.realpath;
	let lookups = 0;
	fs.realpath = (async (...args: Parameters<typeof fs.realpath>) => {
		lookups++;
		return original(...args);
	}) as typeof fs.realpath;
	t.after(() => { fs.realpath = original; });
	const controller = new AbortController();
	const call = executeWrite(async () => ({ content: [] }), "w", { path: "file", content: "x" },
		controller.signal, undefined, { cwd }, cwd);
	controller.abort();
	await assert.rejects(call, /Operation aborted/);
	await Promise.resolve();
	assert.equal(lookups, 0);
});

test("cancellation stops waiting for filesystem validation", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "rqw-cancel-lookup-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const original = fs.realpath;
	let release!: () => void;
	let entered!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const ready = new Promise<void>((resolve) => { entered = resolve; });
	fs.realpath = (async (...args: Parameters<typeof fs.realpath>) => {
		entered();
		await gate;
		return original(...args);
	}) as typeof fs.realpath;
	t.after(() => { fs.realpath = original; });
	const controller = new AbortController();
	let writes = 0;
	const call = executeWrite(async () => { writes++; return { content: [] }; }, "w", { path: "file", content: "x" },
		controller.signal, undefined, { cwd }, cwd);
	await ready;
	const rejected = assert.rejects(call, /Operation aborted/);
	controller.abort();
	try { await rejected; assert.equal(writes, 0); } finally { release(); }
});

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
