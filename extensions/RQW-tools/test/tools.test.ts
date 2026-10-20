import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	createBashToolDefinition,
} from "@earendil-works/pi-coding-agent";
import factory from "../index.ts";

type Fake = { tools: Record<string, any>; handlers: Record<string, any>; active: string[]; setCalls: string[][] };

function load(active: string[] = []): Fake {
	const fake: Fake = { tools: {}, handlers: {}, active, setCalls: [] };
	(factory as any)({
		registerTool: (def: any) => {
			fake.tools[def.name] = def;
		},
		on: (event: string, handler: any) => {
			fake.handlers[event] = handler;
		},
		getActiveTools: () => fake.active,
		setActiveTools: (names: string[]) => {
			fake.setCalls.push(names);
		},
	});
	return fake;
}

const text = (result: any) => result.content.map((c: any) => c.text).join("\n");
const run = (tool: any, params: any, cwd: string, signal?: AbortSignal) => tool.execute("id", params, signal, undefined, {
		cwd,
		// bash puts the session into the child environment
		sessionManager: { getSessionId: () => "test", getSessionFile: () => undefined },
	});

let root: string;
let counter = 0;
async function freshDir(): Promise<string> {
	const dir = join(root, `t${counter++}`);
	await mkdir(dir, { recursive: true });
	return dir;
}

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-tools-"));
});
after(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("registration", () => {
	it("registers the six tools with stock names and parameter names", () => {
		const { tools } = load();
		assert.deepEqual(Object.keys(tools).sort(), ["bash", "edit", "find", "grep", "read", "write"]);
		const cwd = process.cwd();
		const stock: Record<string, any> = {
			read: createReadToolDefinition(cwd),
			bash: createBashToolDefinition(cwd),
			edit: createEditToolDefinition(cwd),
			write: createWriteToolDefinition(cwd),
			grep: createGrepToolDefinition(cwd),
			find: createFindToolDefinition(cwd),
		};
		for (const name of ["read", "bash", "grep", "find"]) {
			assert.deepEqual(Object.keys(tools[name].parameters.properties), Object.keys(stock[name].parameters.properties), name);
			assert.deepEqual(tools[name].parameters.required, stock[name].parameters.required, name);
		}
		const edit = tools.edit.parameters;
		assert.deepEqual(Object.keys(edit.properties).sort(), ["edits", "path"]);
		assert.deepEqual(edit.required, ["edits"]);
		assert.deepEqual(Object.keys(edit.properties.edits.items.properties).sort(), ["newText", "oldText", "path"]);
		assert.deepEqual(edit.properties.edits.items.required.sort(), ["newText", "oldText"]);
		assert.deepEqual(Object.keys(tools.write.parameters.properties).sort(), ["content", "files", "path"]);
		assert.deepEqual(tools.write.parameters.required ?? [], []);
		for (const name of Object.keys(tools)) assert.ok(tools[name].description.length > 20, name);
		assert.equal(tools.grep.parameters.properties.limit.description.startsWith("Maximum number of matches (default: no cap"), true);
		assert.equal(tools.find.parameters.properties.limit.description.startsWith("Maximum number of results (default: no cap"), true);
	});

	it("session_start adds missing grep and find to the active tools", () => {
		const fake = load(["read", "bash", "edit", "write"]);
		fake.handlers.session_start({}, {});
		assert.deepEqual(fake.setCalls, [["read", "bash", "edit", "write", "grep", "find"]]);
		const full = load(["read", "grep", "find"]);
		full.handlers.session_start({}, {});
		assert.deepEqual(full.setCalls, []);
	});

	it("prepareArguments keeps a per-entry path", () => {
		const { tools } = load();
		const out = tools.edit.prepareArguments({ edits: JSON.stringify([{ path: "a.txt", oldText: "x", newText: "y" }]) });
		assert.equal(out.edits[0].path, "a.txt");
		const single = tools.edit.prepareArguments({ edits: { path: "b.txt", oldText: "x", newText: "y" } });
		assert.equal(single.edits[0].path, "b.txt");
		const nulled = tools.edit.prepareArguments({ path: "c.txt", edits: [{ path: null, oldText: "x", newText: "y" }] });
		assert.equal("path" in nulled.edits[0], false);
	});
});

describe("edit", () => {
	it("edits several files in one call", async () => {
		const { tools } = load();
		const dir = await freshDir();
		await writeFile(join(dir, "a.txt"), "one\ntwo\n");
		await writeFile(join(dir, "b.txt"), "alpha\nbeta\n");
		const result = await run(
			tools.edit,
			{
				edits: [
					{ path: "a.txt", oldText: "one", newText: "1" },
					{ path: "b.txt", oldText: "alpha", newText: "A" },
					{ path: "./a.txt", oldText: "two", newText: "2" },
				],
			},
			dir,
		);
		assert.equal(text(result), "Edited: a.txt (2 block(s))\nEdited: b.txt (1 block(s))");
		assert.equal(result.isError, undefined);
		assert.deepEqual(result.details, { files: [{ path: "a.txt", ok: true }, { path: "b.txt", ok: true }] });
		assert.equal(await readFile(join(dir, "a.txt"), "utf-8"), "1\n2\n");
		assert.equal(await readFile(join(dir, "b.txt"), "utf-8"), "A\nbeta\n");
	});

	it("uses the top-level path as default and errors on an entry without any path", async () => {
		const { tools } = load();
		const dir = await freshDir();
		await writeFile(join(dir, "a.txt"), "one\n");
		await writeFile(join(dir, "b.txt"), "x\n");
		const result = await run(
			tools.edit,
			{ path: "a.txt", edits: [{ oldText: "one", newText: "1" }, { path: "b.txt", oldText: "x", newText: "y" }] },
			dir,
		);
		assert.match(text(result), /Edited: a.txt/);
		await assert.rejects(
			run(tools.edit, { edits: [{ path: "a.txt", oldText: "1", newText: "2" }, { oldText: "x", newText: "y" }] }, dir),
			/edits\[1\] has no path and the call has no top-level path/,
		);
		assert.equal(await readFile(join(dir, "a.txt"), "utf-8"), "1\n");
	});

	it("one failing file does not stop the others and stays untouched", async () => {
		const { tools } = load();
		const dir = await freshDir();
		await writeFile(join(dir, "good.txt"), "keep\nchange me\n");
		await writeFile(join(dir, "bad.txt"), "first\nsecond\n");
		const result = await run(
			tools.edit,
			{
				edits: [
					{ path: "bad.txt", oldText: "first", newText: "1" },
					{ path: "bad.txt", oldText: "nothing like this xyz", newText: "2" },
					{ path: "good.txt", oldText: "change me", newText: "changed" },
				],
			},
			dir,
		);
		assert.equal(result.isError, true);
		const lines = text(result).split("\n");
		assert.equal(lines[0], "Edited: good.txt (1 block(s))");
		assert.match(lines[1], /^Failed: bad\.txt: Could not find edits\[1\] in bad\.txt/);
		assert.deepEqual(result.details.files.map((f: any) => f.ok), [false, true]);
		assert.equal(await readFile(join(dir, "good.txt"), "utf-8"), "keep\nchanged\n");
		assert.equal(await readFile(join(dir, "bad.txt"), "utf-8"), "first\nsecond\n");
	});

	it("adds the nearest match to a Could not find error, not to duplicates", async () => {
		const { tools } = load();
		const dir = await freshDir();
		const body = ["function a() {", "  const x = foo(bar);", "  return x;", "}", "", "function b() {", "  return 1;", "}", "function b() {"];
		await writeFile(join(dir, "f.ts"), body.join("\n"));
		await assert.rejects(
			run(tools.edit, { path: "f.ts", edits: [{ oldText: "  const x = foo(baz);\n  return  x;", newText: "" }] }, dir),
			(error: any) => {
				assert.match(error.message, /^Could not find the exact text in f\.ts/);
				assert.match(error.message, /Nearest match at lines 2-3:\n2\|  const x = foo\(bar\);\n3\|  return x;/);
				return true;
			},
		);
		await assert.rejects(
			run(tools.edit, { path: "f.ts", edits: [{ oldText: "function b() {", newText: "" }] }, dir),
			(error: any) => /^Found 2 occurrences/.test(error.message) && !/Nearest match/.test(error.message),
		);
		await assert.rejects(
			run(tools.edit, { path: "f.ts", edits: [{ oldText: "zzzzzzzzzzzzzzzzzzzzzzzz", newText: "" }] }, dir),
			(error: any) => /^Could not find/.test(error.message) && !/Nearest match/.test(error.message),
		);
	});

	it("nearest-match hint shows up in a failed line of a multi-file call", async () => {
		const { tools } = load();
		const dir = await freshDir();
		await writeFile(join(dir, "a.txt"), "x\n");
		await writeFile(join(dir, "b.txt"), "hello world\nsecond line\n");
		const result = await run(
			tools.edit,
			{ edits: [{ path: "a.txt", oldText: "x", newText: "y" }, { path: "b.txt", oldText: "hello  wurld", newText: "z" }] },
			dir,
		);
		assert.match(text(result), /Failed: b\.txt: Could not find[^\n]*\nNearest match at lines 1-1:\n1\|hello world/);
	});

	it("single-file results equal the stock results", async () => {
		const { tools } = load();
		const [ours, theirs] = [await freshDir(), await freshDir()];
		for (const dir of [ours, theirs]) await writeFile(join(dir, "f.txt"), "a\nb\nc\n");
		const stock: any = createEditToolDefinition(theirs);
		const params = { path: "f.txt", edits: [{ oldText: "b", newText: "B" }] };
		const mine = await run(tools.edit, params, ours);
		const reference = await stock.execute("id", params, undefined, undefined, { cwd: theirs });
		assert.deepEqual(mine, reference);
		// the same call through an entry path and no top-level path
		await writeFile(join(ours, "f.txt"), "a\nb\nc\n");
		const viaEntry = await run(tools.edit, { edits: [{ path: "f.txt", oldText: "b", newText: "B" }] }, ours);
		assert.deepEqual(viaEntry, reference);
		// the same error
		const bad = { path: "f.txt", edits: [{ oldText: "q q q q q q q q q q q", newText: "" }] };
		let stockMessage = "";
		await stock.execute("id", bad, undefined, undefined, { cwd: theirs }).catch((e: Error) => (stockMessage = e.message));
		await assert.rejects(run(tools.edit, bad, ours), (error: any) => error.message.startsWith(stockMessage));
	});

	it("does nothing when aborted before the start", async () => {
		const { tools } = load();
		const dir = await freshDir();
		await writeFile(join(dir, "a.txt"), "one\n");
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(run(tools.edit, { path: "a.txt", edits: [{ oldText: "one", newText: "two" }] }, dir, controller.signal), /Operation aborted/);
		await assert.rejects(run(tools.write, { path: "n.txt", content: "x" }, dir, controller.signal), /Operation aborted/);
		assert.equal(await readFile(join(dir, "a.txt"), "utf-8"), "one\n");
		await assert.rejects(readFile(join(dir, "n.txt")), /ENOENT/);
	});
});

describe("write", () => {
	it("writes several files and creates parent directories", async () => {
		const { tools } = load();
		const dir = await freshDir();
		const result = await run(tools.write, { files: [{ path: "x/a.txt", content: "A" }, { path: "b.txt", content: "B" }] }, dir);
		assert.equal(text(result), "Written: x/a.txt\nWritten: b.txt");
		assert.deepEqual(result.details, { files: [{ path: "x/a.txt", ok: true }, { path: "b.txt", ok: true }] });
		assert.equal(await readFile(join(dir, "x/a.txt"), "utf-8"), "A");
		assert.equal(await readFile(join(dir, "b.txt"), "utf-8"), "B");
	});

	it("rejects duplicate paths and writes nothing", async () => {
		const { tools } = load();
		const dir = await freshDir();
		await assert.rejects(
			run(tools.write, { files: [{ path: "a.txt", content: "1" }, { path: "./a.txt", content: "2" }] }, dir),
			/files lists \.\/a\.txt twice/,
		);
		await assert.rejects(readFile(join(dir, "a.txt")), /ENOENT/);
	});

	it("accepts exactly one form", async () => {
		const { tools } = load();
		const dir = await freshDir();
		const message = /Give path and content, or files, not both/;
		await assert.rejects(run(tools.write, { path: "a.txt", content: "x", files: [{ path: "b.txt", content: "y" }] }, dir), message);
		await assert.rejects(run(tools.write, { path: "a.txt" }, dir), message);
		await assert.rejects(run(tools.write, {}, dir), message);
		await assert.rejects(run(tools.write, { files: [] }, dir), /files is empty/);
		await assert.rejects(readFile(join(dir, "a.txt")), /ENOENT/);
		await assert.rejects(readFile(join(dir, "b.txt")), /ENOENT/);
		// empty content is a valid file
		await run(tools.write, { path: "empty.txt", content: "" }, dir);
		assert.equal(await readFile(join(dir, "empty.txt"), "utf-8"), "");
	});

	it("one failing file does not stop the others", async () => {
		const { tools } = load();
		const dir = await freshDir();
		await writeFile(join(dir, "blocker"), "i am a file");
		const result = await run(tools.write, { files: [{ path: "blocker/x.txt", content: "no" }, { path: "ok.txt", content: "yes" }] }, dir);
		assert.equal(result.isError, true);
		const lines = text(result).split("\n");
		assert.match(lines[0], /^Failed: blocker\/x\.txt: /);
		assert.equal(lines[1], "Written: ok.txt");
		assert.equal(await readFile(join(dir, "ok.txt"), "utf-8"), "yes");
	});

	it("single-file results equal the stock results, for both forms", async () => {
		const { tools } = load();
		const [ours, theirs] = [await freshDir(), await freshDir()];
		const stock: any = createWriteToolDefinition(theirs);
		const reference = await stock.execute("id", { path: "f.txt", content: "hi" }, undefined, undefined, { cwd: theirs });
		assert.deepEqual(await run(tools.write, { path: "f.txt", content: "hi" }, ours), reference);
		assert.deepEqual(await run(tools.write, { files: [{ path: "f.txt", content: "hi" }] }, ours), reference);
	});
});

describe("ordering inside one batch", () => {
	it("grep finds a file written earlier in the same tick", async () => {
		const { tools } = load();
		const dir = await freshDir();
		const written = run(tools.write, { path: "fresh.txt", content: "needle-123\n" }, dir);
		const searched = run(tools.grep, { pattern: "needle-123" }, dir);
		await written;
		assert.match(text(await searched), /fresh\.txt:1: needle-123/);
	});

	it("find sees a file written earlier in the same tick", async () => {
		const { tools } = load();
		const dir = await freshDir();
		const written = run(tools.write, { path: "sub/new.md", content: "x" }, dir);
		const found = run(tools.find, { pattern: "*.md" }, dir);
		await written;
		assert.match(text(await found), /new\.md/);
	});

	it("bash cat sees a 16 MB write started earlier in the same tick", async () => {
		const { tools } = load();
		const dir = await freshDir();
		const size = 16 * 1024 * 1024;
		const written = run(tools.write, { path: "big.txt", content: "x".repeat(size) }, dir);
		const counted = run(tools.bash, { command: "wc -c < big.txt" }, dir);
		await written;
		assert.equal(Number(text(await counted).trim().split(/\s+/)[0]), size);
	});

	it("read before write sees the old content", async () => {
		const { tools } = load();
		const dir = await freshDir();
		await writeFile(join(dir, "f.txt"), "old content\n");
		const before = run(tools.read, { path: "f.txt" }, dir);
		const written = run(tools.write, { path: "f.txt", content: "new content\n" }, dir);
		const after = run(tools.read, { path: "f.txt" }, dir);
		assert.match(text(await before), /old content/);
		await written;
		assert.match(text(await after), /new content/);
	});

	it("bash waits for an earlier edit", async () => {
		const { tools } = load();
		const dir = await freshDir();
		await writeFile(join(dir, "f.txt"), "before\n");
		const edited = run(tools.edit, { path: "f.txt", edits: [{ oldText: "before", newText: "after" }] }, dir);
		const shown = run(tools.bash, { command: "cat f.txt" }, dir);
		await edited;
		assert.match(text(await shown), /after/);
	});
});

describe("grep and find limits", () => {
	it("pass limit 100000 when unset and keep an explicit limit", async () => {
		const { tools } = load();
		const dir = await freshDir();
		await writeFile(join(dir, "a.txt"), Array.from({ length: 150 }, (_, i) => `hit ${i}`).join("\n"));
		const all = text(await run(tools.grep, { pattern: "hit" }, dir));
		assert.equal(all.split("\n").filter((l) => l.includes("hit")).length, 150);
		assert.doesNotMatch(all, /limit reached/);
		const some = text(await run(tools.grep, { pattern: "hit", limit: 5 }, dir));
		assert.match(some, /5 matches limit reached/);
	});
});
