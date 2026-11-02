import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeEdit } from "../../../extensions/RQW-tools/edit.ts";
import { withFileLock } from "../../../extensions/RQW-tools/lock.ts";
import { lockPathKey } from "../../../extensions/RQW-tools/keys.ts";
import { executeWrite } from "../../../extensions/RQW-tools/write.ts";

test("edit and write serialize aliases, including a missing file under a symlink", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "rqw-lock-alias-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const alias = join(cwd, "alias");
	symlinkSync(cwd, alias, process.platform === "win32" ? "junction" : "dir");
	let release!: () => void;
	let entered!: () => void;
	const ready = new Promise<void>((resolve) => { entered = resolve; });
	const gate = new Promise<void>((resolve) => { release = resolve; });
	let secondEntered = false;
	const first = executeWrite(async () => { entered(); await gate; return { content: [] }; }, "w",
		{ path: join(cwd, "missing"), content: "one" }, undefined, undefined, { cwd }, cwd);
	await ready;
	const controller = new AbortController();
	const addListener = controller.signal.addEventListener.bind(controller.signal);
	let queued!: () => void;
	let listeners = 0;
	const queueReady = new Promise<void>((resolve) => { queued = resolve; });
	controller.signal.addEventListener = ((...args: Parameters<typeof controller.signal.addEventListener>) => {
		addListener(...args);
		if (args[0] === "abort" && ++listeners === 3) queued();
	}) as typeof controller.signal.addEventListener;
	const second = executeEdit(async () => { secondEntered = true; return { content: [] }; }, "e",
		{ path: join(alias, "missing"), edits: [{ oldText: "a", newText: "b" }] }, controller.signal, undefined, { cwd }, cwd);
	const other = executeWrite(async () => ({ content: [] }), "other",
		{ path: join(cwd, "other"), content: "other" }, undefined, undefined, { cwd }, cwd);
	try {
		await other;
		await queueReady;
		await Promise.resolve();
		await Promise.resolve();
		assert.equal(secondEntered, false);
	} finally {
		release();
		await Promise.all([first, second]);
	}
	assert.equal(secondEntered, true);
});

test("a file created under the lock is still locked through a file symlink and a waiter can abort", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "rqw-lock-created-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const target = join(cwd, "target");
	const alias = join(cwd, "alias");
	let release!: () => void;
	let entered!: () => void;
	const ready = new Promise<void>((resolve) => { entered = resolve; });
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const first = executeWrite(async () => {
		writeFileSync(target, "created");
		entered();
		await gate;
		return { content: [] };
	}, "w", { path: target, content: "created" }, undefined, undefined, { cwd }, cwd);
	await ready;
	if (process.platform === "win32") {
		const originalRealpath = fs.realpath;
		const originalStat = fs.stat;
		fs.realpath = ((input: any, options?: any) => originalRealpath(input === alias ? target : input, options)) as typeof fs.realpath;
		fs.stat = ((input: any, options?: any) => originalStat(input === alias ? target : input, options)) as typeof fs.stat;
		t.after(() => { fs.realpath = originalRealpath; fs.stat = originalStat; });
	} else {
		symlinkSync(target, alias, "file");
	}
	const controller = new AbortController();
	const addListener = controller.signal.addEventListener.bind(controller.signal);
	let queued!: () => void;
	let listeners = 0;
	const queueReady = new Promise<void>((resolve) => { queued = resolve; });
	controller.signal.addEventListener = ((...args: Parameters<typeof controller.signal.addEventListener>) => {
		addListener(...args);
		if (args[0] === "abort" && ++listeners === 3) queued();
	}) as typeof controller.signal.addEventListener;
	let secondEntered = false;
	const second = executeEdit(async () => { secondEntered = true; return { content: [] }; }, "e",
		{ path: alias, edits: [{ oldText: "created", newText: "changed" }] }, controller.signal, undefined, { cwd }, cwd);
	const rejected = assert.rejects(second, /Operation aborted/);
	try {
		await queueReady;
		await Promise.resolve();
		await Promise.resolve();
		assert.equal(secondEntered, false);
		controller.abort();
		await rejected;
		assert.equal(readFileSync(target, "utf8"), "created");
	} finally {
		release();
		await first;
	}
});

test("duplicate batch targets are rejected even when the file appears during validation", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "rqw-duplicate-race-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const target = join(cwd, "target");
	const original = fs.realpath;
	let count = 0;
	let release!: () => void;
	const created = new Promise<void>((resolve) => { release = resolve; });
	fs.realpath = (async (...args: Parameters<typeof fs.realpath>) => {
		if (args[0] === target && ++count === 2) await created;
		const result = await original(...args);
		if (args[0] === cwd && count >= 2) {
			writeFileSync(target, "created");
			release();
		}
		return result;
	}) as typeof fs.realpath;
	t.after(() => { fs.realpath = original; });
	let writes = 0;
	await assert.rejects(executeWrite(async () => { writes++; return { content: [] }; }, "w", {
		files: [{ path: target, content: "one" }, { path: target, content: "two" }],
	}, undefined, undefined, { cwd }, cwd), /twice/);
	assert.equal(writes, 0);
});

test("batch ancestor targets are rejected when the directory appears during validation", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "rqw-ancestor-race-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const parent = join(cwd, "new-dir");
	const child = join(parent, "child");
	const original = fs.realpath;
	let release!: () => void;
	const created = new Promise<void>((resolve) => { release = resolve; });
	fs.realpath = (async (...args: Parameters<typeof fs.realpath>) => {
		if (args[0] === child) await created;
		const result = await original(...args);
		if (args[0] === cwd) {
			mkdirSync(parent, { recursive: true });
			release();
		}
		return result;
	}) as typeof fs.realpath;
	t.after(() => { fs.realpath = original; });
	let writes = 0;
	await assert.rejects(executeWrite(async () => { writes++; return { content: [] }; }, "w", {
		files: [{ path: parent, content: "one" }, { path: child, content: "two" }],
	}, undefined, undefined, { cwd }, cwd), /one inside the other/);
	assert.equal(writes, 0);
	fs.realpath = original;
	const result = await executeWrite(async () => ({ content: [] }), "w", {
		files: [{ path: parent, content: "one" }, { path: `${parent}-other`, content: "two" }],
	}, undefined, undefined, { cwd }, cwd);
	assert.deepEqual(result.details.files, [
		{ path: parent, ok: true },
		{ path: `${parent}-other`, ok: true },
	]);
});

test("filesystem identity lookup does not block unrelated work", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "rqw-lock-async-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const original = fs.realpath;
	let release!: () => void;
	let entered!: () => void;
	const ready = new Promise<void>((resolve) => { entered = resolve; });
	const gate = new Promise<void>((resolve) => { release = resolve; });
	let lookedUp = false;
	fs.realpath = (async (...args: Parameters<typeof fs.realpath>) => {
		lookedUp = true;
		entered();
		await gate;
		return original(...args);
	}) as typeof fs.realpath;
	t.after(() => { fs.realpath = original; });
	const call = executeWrite(async () => ({ content: [] }), "w", { path: "target", content: "x" },
		undefined, undefined, { cwd }, cwd);
	await Promise.resolve();
	try {
		assert.equal(lookedUp, true);
		await ready;
		let ran = false;
		await Promise.resolve().then(() => { ran = true; });
		assert.equal(ran, true);
	} finally {
		release();
		await call;
	}
});

for (const name of ["write", "edit"] as const) {
	test(`${name} tool respects the file lock`, async (t) => {
		const cwd = mkdtempSync(join(tmpdir(), "rqw-lock-"));
		t.after(() => rmSync(cwd, { recursive: true, force: true }));
		const path = join(cwd, "target.txt");
		writeFileSync(path, "before");
		let release!: () => void;
		let entered!: () => void;
		const ready = new Promise<void>((resolve) => { entered = resolve; });
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const held = withFileLock(await lockPathKey(path, cwd), async () => { entered(); await gate; });
		await ready;
		// Fake only Pi's stock executor; keep its filesystem effect synchronous.
		const stock = async (_id: string, args: any) => {
			const content = name === "write" ? args.content
				: readFileSync(args.path, "utf8").replace(args.edits[0].oldText, args.edits[0].newText);
			writeFileSync(args.path, content);
			return { content: [] };
		};
		const params = name === "write" ? { path, content: "after" }
			: { path, edits: [{ oldText: "before", newText: "after" }] };
		const run = name === "write" ? executeWrite : executeEdit;
		const controller = new AbortController();
		const addListener = controller.signal.addEventListener.bind(controller.signal);
		let listeners = 0;
		let queued!: () => void;
		const queueReady = new Promise<void>((resolve) => { queued = resolve; });
		controller.signal.addEventListener = ((...args: Parameters<typeof controller.signal.addEventListener>) => {
			addListener(...args);
			if (args[0] === "abort" && ++listeners === 3) queued();
		}) as typeof controller.signal.addEventListener;
		const call = run(stock, name, params, controller.signal, undefined, { cwd }, cwd);
		try {
			await queueReady;
			await Promise.resolve();
			await Promise.resolve();
			assert.equal(readFileSync(path, "utf8"), "before");
		} finally {
			release();
			await held;
			await call;
		}
		assert.equal(readFileSync(path, "utf8"), "after");
	});
}
