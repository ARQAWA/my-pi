import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import {
	AgentSession,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	createBashToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { streamSimple as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { executeEdit } from "../edit.ts";
import factory, { createTools } from "../index.ts";
import { executeWrite } from "../write.ts";

type Fake = {
	tools: Record<string, any>;
	handlers: Record<string, any>;
	channels: Record<string, (data: unknown) => void>;
	active: string[];
	setCalls: string[][];
	ctx: { sessionManager: object };
};

const shutdowns: (() => void)[] = [];
afterEach(() => { for (const release of shutdowns.splice(0).reverse()) release(); });

function load(active: string[] = [], settings: Record<string, unknown> | "throws" = {}, registered: string[] = []): Fake {
	const fake: Fake = { tools: {}, handlers: {}, channels: {}, active, setCalls: [], ctx: { sessionManager: {} } };
	(factory as any)({
		events: {
			on: (channel: string, handler: (data: unknown) => void) => {
				fake.channels[channel] = handler;
				return () => {};
			},
		},
		registerTool: (def: any) => {
			fake.tools[def.name] = def;
		},
		on: (event: string, handler: any) => {
			fake.handlers[event] = handler;
		},
		getActiveTools: () => fake.active,
		// what the session knows: only the built-in tools named in `registered` (a built-in `codemode`, for one)
		getAllTools: () => registered.map((name) => ({ name, sourceInfo: { source: "builtin", path: `builtin:${name}` } })),
		getSettings: () => {
			if (settings === "throws") throw new Error("no settings");
			return settings;
		},
		setActiveTools: (names: string[]) => {
			fake.setCalls.push(names);
		},
	});
	shutdowns.push(fake.handlers.session_shutdown);
	// Minimal native bind target: the wrapper must capture intent before the mocked session_start.
	void AgentSession.prototype.bindExtensions.call({
		sessionManager: fake.ctx.sessionManager,
		_usesDefaultTools: true, _defaultToolModifiers: [], _excludedTools: undefined, _allowedTools: undefined,
		_applyExtensionBindings() {}, _extensionRunner: { async emit() {}, reportUnhandledMcpServers() {} },
		_sessionStartEvent: { reason: "startup" }, async extendResourcesFromExtensions() {},
	} as any, {});
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

	it("all six tools are not default-active", () => {
		const { tools } = load();
		for (const name of ["read", "bash", "edit", "write", "grep", "find"]) assert.equal(tools[name].defaultActive, false, name);
	});

	it("edit is not a strict (constrained-sampling) tool; read, bash and write keep the stock setting", async () => {
		const { tools } = load();
		const cwd = process.cwd();
		assert.ok(createEditToolDefinition(cwd).constrainedSampling, "stock edit asks for strict sampling");
		assert.equal(tools.edit.constrainedSampling, undefined);
		assert.deepEqual(tools.read.constrainedSampling, createReadToolDefinition(cwd).constrainedSampling);
		assert.deepEqual(tools.bash.constrainedSampling, createBashToolDefinition(cwd).constrainedSampling);
		assert.deepEqual(tools.write.constrainedSampling, createWriteToolDefinition(cwd).constrainedSampling);

		// The Anthropic request for a strict-capable model: edit goes without `strict`, write keeps it.
		const model: any = Object.values(ANTHROPIC_MODELS as any).find((m: any) => m.id === "claude-opus-5-5");
		assert.equal(model.compat.supportsStrictTools, true);
		// The fields Pi's wrapToolDefinition passes to the provider.
		const toolsAdded = ["edit", "write"].map((name) => {
			const { description, parameters, constrainedSampling } = tools[name];
			return { name, description, parameters, constrainedSampling };
		});
		let payload: any;
		const stream = streamAnthropic(model, {
			messages: [
				{ role: "system", content: "s", toolsAdded, timestamp: 0 },
				{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 },
			],
		} as any, {
			apiKey: "sk-ant-api03-test",
			maxRetries: 0,
			onPayload: (params: any) => { payload = params; },
			fetch: async () => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "stop" } }),
				{ status: 400, headers: { "content-type": "application/json" } }),
		} as any);
		for await (const _ of stream) { /* drain to the stub's error */ }
		const sent = Object.fromEntries(payload.tools.map((t: any) => [t.name, t]));
		assert.equal(sent.edit.strict, undefined);
		assert.deepEqual(sent.edit.input_schema.required, ["edits"], "edit keeps its own optional fields");
		assert.equal(sent.write.strict, true);
	});

	it("session_start adds grep and find on every reason but reload, only when the user made no tool selection", () => {
		for (const reason of ["startup", "new", "resume", "fork"]) {
			const fake = load(["read", "bash", "edit", "write"]);
			fake.handlers.session_start({ reason }, fake.ctx);
			assert.deepEqual(fake.setCalls, [["read", "bash", "edit", "write", "grep", "find"]], reason);
		}
		// Pi keeps the active set through a reload, tools the user switched off included
		const reloaded = load(["read", "bash", "edit", "write"]);
		reloaded.handlers.session_start({ reason: "reload" }, reloaded.ctx);
		assert.deepEqual(reloaded.setCalls, [], "reload");
		const full = load(["read", "grep", "find"]);
		full.handlers.session_start({ reason: "resume" }, full.ctx);
		assert.deepEqual(full.setCalls, []);
		const withSetting = load(["read", "bash"], { defaultTools: ["read", "bash"] });
		withSetting.handlers.session_start({ reason: "startup" }, withSetting.ctx);
		assert.deepEqual(withSetting.setCalls, [], "defaultTools set");
		const noSettings = load(["read"], "throws");
		noSettings.handlers.session_start({ reason: "startup" }, noSettings.ctx);
		assert.deepEqual(noSettings.setCalls, [], "no settings: stock set stays");
		const argv = process.argv;
		try {
			for (const flag of ["--tools", "-t", "--exclude-tools", "-xt", "--no-tools", "-nt", "--no-builtin-tools", "-nbt"]) {
				for (const args of [[flag, "read"], [`${flag}=read`]]) {
					process.argv = [...argv, ...args];
					const fake = load(["read"]);
					fake.handlers.session_start({ reason: "startup" }, fake.ctx);
					assert.deepEqual(fake.setCalls, [], args.join(" "));
				}
			}
		} finally {
			process.argv = argv;
		}
	});

	it("offers createTools on rqw-tools:subagent-tools; each call gives six fresh definitions", () => {
		const fake = load();
		let offered: unknown;
		fake.channels["rqw-tools:subagent-tools"]({ offer: (f: unknown) => (offered = f) });
		assert.equal(offered, createTools);
		const one = createTools(process.cwd(), () => ({}));
		const two = createTools(process.cwd(), () => ({}));
		assert.deepEqual(one.map((d) => d.name).sort(), ["bash", "edit", "find", "grep", "read", "write"]);
		for (const d of one) assert.notEqual(d, two.find((e) => e.name === d.name), d.name);
		assert.deepEqual(Object.keys((one.find((d) => d.name === "write") as any).parameters.properties).sort(), ["content", "files", "path"]);
		assert.doesNotThrow(() => fake.channels["rqw-tools:subagent-tools"](undefined), "a request without offer is ignored");
	});

	it("session_start replaces a registered built-in codemode on every reason, reload included, and nothing else", () => {
		for (const reason of ["startup", "new", "resume", "fork", "reload"]) {
			const fake = load(["read"], {}, ["codemode"]);
			fake.handlers.session_start({ reason }, fake.ctx);
			assert.equal(typeof fake.tools.codemode?.execute, "function", reason);
			assert.equal(fake.tools.codemode.name, "codemode");
		}
		for (const registered of [[], ["tool_search"]]) {
			const fake = load(["read"], {}, registered);
			fake.handlers.session_start({ reason: "startup" }, fake.ctx);
			assert.equal(fake.tools.codemode, undefined, `registered: ${registered.join(",") || "nothing"}`);
		}
	});

	it("write prepareArguments parses a JSON-string files and wraps a single object", () => {
		const { tools } = load();
		const entry = { path: "a.txt", content: "x" };
		const parsed = tools.write.prepareArguments({ files: JSON.stringify([entry, { path: "b.txt", content: "y" }]) });
		assert.deepEqual(parsed.files, [entry, { path: "b.txt", content: "y" }]);
		assert.deepEqual(tools.write.prepareArguments({ files: JSON.stringify(entry) }).files, [entry]);
		assert.deepEqual(tools.write.prepareArguments({ files: entry }).files, [entry]);
		const broken = { files: "not json" };
		assert.equal(tools.write.prepareArguments(broken).files, "not json");
		const normal = { files: [entry] };
		assert.equal(tools.write.prepareArguments(normal), normal);
		assert.equal(tools.write.prepareArguments(undefined), undefined);
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
		assert.deepEqual(result.details.files.map(({ details, ...file }) => file), [{ path: "a.txt", ok: true }, { path: "b.txt", ok: true }]);
		for (const file of result.details.files) {
			assert.equal(typeof file.details.diff, "string");
			assert.equal(typeof file.details.patch, "string");
			assert.equal(file.details.firstChangedLine, 1);
		}
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

	it("failure messages of a multi-file call cite the model's own entry indices", async () => {
		const { tools } = load();
		const dir = await freshDir();
		await writeFile(join(dir, "a.txt"), "one\n");
		await writeFile(join(dir, "b.txt"), "alpha\ngamma\n");
		const result = await run(
			tools.edit,
			{
				edits: [
					{ path: "a.txt", oldText: "one", newText: "1" },
					{ path: "b.txt", oldText: "alpha", newText: "A" },
					{ path: "b.txt", oldText: "gamma  zzz", newText: "G" },
				],
			},
			dir,
		);
		assert.equal(result.isError, true);
		const failed = text(result).split("\n").find((l) => l.startsWith("Failed: b.txt"))!;
		assert.match(failed, /Could not find edits\[2\] in b\.txt/);
		assert.doesNotMatch(failed, /edits\[1\]/);
		assert.match(text(result), /Nearest match at lines 2-2:\n2\|gamma/);
	});

	it("the hint reads the file a ~ path names", async () => {
		const { tools } = load();
		const dir = await freshDir();
		const name = `rqw-hint-${process.pid}.txt`;
		const home = (await import("node:os")).homedir();
		await writeFile(join(home, name), "hello world\nsecond line\n");
		try {
			await assert.rejects(
				run(tools.edit, { path: `~/${name}`, edits: [{ oldText: "hello  wurld", newText: "z" }] }, dir),
				/Nearest match at lines 1-1:\n1\|hello world/,
			);
		} finally {
			await rm(join(home, name), { force: true });
		}
	});

	it("the hint search is bounded in CPU time on a large long-line file", async () => {
		const { tools } = load();
		const dir = await freshDir();
		const line = (i: number) => `${i}:`.padEnd(200, String.fromCharCode(97 + (i % 26)));
		await writeFile(join(dir, "big.txt"), Array.from({ length: 1000 }, (_, i) => line(i)).join("\n"));
		const want = Array.from({ length: 50 }, (_, i) => `x${i}`.padEnd(200, String.fromCharCode(122 - (i % 26)))).join("\n");
		const started = performance.now();
		await assert.rejects(run(tools.edit, { path: "big.txt", edits: [{ oldText: want, newText: "" }] }, dir), /^Error: Could not find/);
		// Unbounded, this search is about 2e9 Levenshtein cells (many seconds); 1 s leaves room for slow CI runners.
		assert.ok(performance.now() - started < 1000, `took ${performance.now() - started} ms`);
	});

	it("read keys the file stock read opens (curly-quote spelling), so a later write is ordered after it", async () => {
		const { tools } = load();
		const dir = await freshDir();
		const real = "Capture d\u2019\u00e9cran.txt";
		for (let i = 0; i < 10; i++) {
			await writeFile(join(dir, real), "OLD\n");
			const [read] = await Promise.all([
				run(tools.read, { path: "Capture d'\u00e9cran.txt" }, dir),
				run(tools.write, { path: real, content: "NEW\n" }, dir),
			]);
			assert.match(text(read), /^OLD/, `run ${i}`);
		}
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
		await assert.rejects(run(tools.write, { files: [] }, dir), message);
		await assert.rejects(run(tools.write, { path: "", content: "", files: [] }, dir), message);
		await assert.rejects(readFile(join(dir, "a.txt")), /ENOENT/);
		await assert.rejects(readFile(join(dir, "b.txt")), /ENOENT/);
		// empty content is a valid file
		await run(tools.write, { path: "empty.txt", content: "" }, dir);
		assert.equal(await readFile(join(dir, "empty.txt"), "utf-8"), "");
	});

	it("strict-mode empty values mean the form is not used", async () => {
		const { tools } = load();
		const dir = await freshDir();
		await run(tools.write, { path: "", content: "", files: [{ path: "a.txt", content: "A" }, { path: "b.txt", content: "B" }] }, dir);
		assert.equal(await readFile(join(dir, "a.txt"), "utf-8"), "A");
		assert.equal(await readFile(join(dir, "b.txt"), "utf-8"), "B");
		await run(tools.write, { path: "c.txt", content: "C", files: [] }, dir);
		assert.equal(await readFile(join(dir, "c.txt"), "utf-8"), "C");
	});

	it("rejects a file and a path below it in one call, writing nothing", async () => {
		const { tools } = load();
		const dir = await freshDir();
		await assert.rejects(
			run(tools.write, { files: [{ path: "a", content: "file" }, { path: "a/b", content: "nested" }] }, dir),
			/files lists a and a\/b, one inside the other/,
		);
		await assert.rejects(
			run(tools.write, { files: [{ path: "d/e", content: "x" }, { path: "d", content: "y" }] }, dir),
			/files lists d and d\/e, one inside the other/,
		);
		await assert.rejects(readFile(join(dir, "a")), /ENOENT/);
		await assert.rejects(readFile(join(dir, "d", "e")), /ENOENT/);
		// a name prefix is not an ancestor
		await run(tools.write, { files: [{ path: "ab", content: "1" }, { path: "a/b", content: "2" }] }, dir);
		assert.equal(await readFile(join(dir, "ab"), "utf-8"), "1");
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

describe("groups of one multi-file call run in parallel", () => {
	// A stock execute that records when it starts and ends, and takes 50 ms.
	function slowStock() {
		const log: { path: string; type: "start" | "end"; at: number }[] = [];
		const execute = async (_id: string, params: any) => {
			log.push({ path: params.path, type: "start", at: performance.now() });
			await new Promise((r) => setTimeout(r, 50));
			log.push({ path: params.path, type: "end", at: performance.now() });
			return { content: [{ type: "text", text: "ok" }] };
		};
		return { log, execute };
	}
	const overlap = (log: { type: string; at: number }[], n: number) => {
		const starts = log.filter((e) => e.type === "start");
		const firstEnd = Math.min(...log.filter((e) => e.type === "end").map((e) => e.at));
		assert.equal(starts.length, n);
		assert.ok(starts.every((e) => e.at < firstEnd), "every start comes before the first end");
	};

	it("executeWrite starts all three files before the first ends", async () => {
		const { log, execute } = slowStock();
		const files = ["a", "b", "c"].map((n) => ({ path: `${n}.txt`, content: n }));
		const result = await executeWrite(execute, "id", { files }, undefined, undefined, {}, "/tmp");
		assert.equal(text(result), "Written: a.txt\nWritten: b.txt\nWritten: c.txt");
		overlap(log, 3);
	});

	it("executeEdit starts all three files before the first ends", async () => {
		const { log, execute } = slowStock();
		const edits = ["a", "b", "c"].map((n) => ({ path: `${n}.txt`, oldText: "o", newText: "n" }));
		const result = await executeEdit(execute, "id", { edits }, undefined, undefined, {}, "/tmp");
		assert.match(text(result), /Edited: a\.txt[^]*Edited: b\.txt[^]*Edited: c\.txt/);
		overlap(log, 3);
	});
});
