// Tests of the unchanged-read note, DECISIONS.md Tools `D-TOOLS-UNCHANGED-READ` (unchanged.ts, index.ts checkedFiles).
// Unit lane: tools from createTools() with a fake session branch. Pipeline lane: real AgentSession, faux provider.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	createCodemodeExtension,
	createToolSearchExtension,
	DefaultResourceLoader,
	estimateTokens,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createTools } from "../../../extensions/RQW-tools/index.ts";
import { createNestedBarrier } from "../../../extensions/RQW-tools/nested.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = join(HERE, "../../../extensions/RQW-tools/index.ts");
const ORIGINAL_CWD = process.cwd();
const NOTE = /^unchanged since your last read of this range; its text is earlier in this conversation\. To get the content again, call read with force: true\.$/;
// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let root: string;
let counter = 0;
before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-unchanged-"));
});
after(async () => {
	process.chdir(ORIGINAL_CWD);
	await rm(root, { recursive: true, force: true });
});
async function freshDir(): Promise<string> {
	const dir = join(root, `t${counter++}`);
	await mkdir(dir, { recursive: true });
	return dir;
}

const textOf = (result: any) => result.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
const toolSet = (dir: string) => Object.fromEntries(createTools(dir, () => ({}), createNestedBarrier()).map((t) => [t.name, t as any]));

// A fake session: the branch the tools see is this array; `call` adds the way Pi does (assistant message with the
// call, then the toolResult entry once the tool has returned).
type Branch = any[];
let seq = 0;
const assistant = (text = "ok") => ({ type: "message", message: { role: "assistant", content: [{ type: "text", text }] } });
const user = (text: string) => ({ type: "message", message: { role: "user", content: text } });
function session(dir: string, sessionId = "s1", branch: Branch = []) {
	const state = { sessionId };
	const ctx = { cwd: dir, sessionManager: { getSessionId: () => state.sessionId, getBranch: () => branch } };
	return { branch, state, ctx };
}
type Fake = ReturnType<typeof session>;
/** One model turn holding this call; `turn: false` adds no assistant message (a second call of the same turn). */
async function call(tools: any, s: Fake, name: string, params: any, id = `call${seq++}`) {
	s.branch.push(assistant());
	const result = await tools[name].execute(id, params, undefined, undefined, s.ctx);
	s.branch.push({ type: "message", id: `res-${id}`, message: { role: "toolResult", toolCallId: id, toolName: name, content: result.content } });
	return result;
}
const read = (tools: any, s: Fake, params: any, id?: string) => call(tools, s, "read", params, id);
/** Adds `n` assistant turns; the last of them stands for the model message that makes the next call. */
const turns = (s: Fake, n: number) => { for (let i = 0; i < n; i++) s.branch.push(assistant()); };
/** Runs a call whose own assistant message is already in the branch. */
const readNow = (tools: any, s: Fake, params: any, id = `call${seq++}`) => tools.read.execute(id, params, undefined, undefined, s.ctx);

async function setup() {
	const dir = await freshDir();
	await writeFile(join(dir, "f.txt"), "alpha\nbeta\ngamma\ndelta\n");
	await writeFile(join(dir, "g.txt"), "other file text\n");
	const tools = toolSet(dir);
	return { dir, tools, s: session(dir), file: join(dir, "f.txt") };
}

describe("unchanged read (unit)", () => {
	// 1
	it("1: the identical repeat gives the one-line note naming force, with none of the file text", async () => {
		const { tools, s } = await setup();
		const first = await read(tools, s, { path: "f.txt" });
		assert.match(textOf(first), /alpha/);
		const second = await read(tools, s, { path: "f.txt" });
		const note = textOf(second);
		assert.match(note, NOTE);
		assert.equal(note.split("\n").length, 1);
		assert.doesNotMatch(note, /alpha|beta|gamma/);
		assert.match(note, /force/);
		assert.equal(second.content.length, 1);
	});

	it("1: absolute and relative spellings of the same file are the same range", async () => {
		const { tools, s, file } = await setup();
		await read(tools, s, { path: "f.txt" });
		assert.match(textOf(await read(tools, s, { path: file })), NOTE);
	});

	// 2
	it("2: a different offset, a different limit or a different file gives content", async () => {
		const { tools, s } = await setup();
		await read(tools, s, { path: "f.txt" });
		assert.match(textOf(await read(tools, s, { path: "f.txt", offset: 2 })), /beta/);
		assert.match(textOf(await read(tools, s, { path: "f.txt", limit: 2 })), /alpha/);
		assert.match(textOf(await read(tools, s, { path: "g.txt" })), /other file text/);
		// each of those was a full read of its own range: the repeats of them give notes, the original range still does
		assert.match(textOf(await read(tools, s, { path: "f.txt", offset: 2 })), NOTE);
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), NOTE);
	});

	// 3
	it("3: force gives the content even when the note would apply; afterwards a normal repeat gives the note", async () => {
		const { tools, s } = await setup();
		await read(tools, s, { path: "f.txt" });
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), NOTE);
		const forced = textOf(await read(tools, s, { path: "f.txt", force: true }));
		assert.match(forced, /alpha/);
		assert.doesNotMatch(forced, NOTE);
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), NOTE);
	});

	it("3: a forced read is a full read: it is remembered when nothing was before", async () => {
		const { tools, s } = await setup();
		assert.match(textOf(await read(tools, s, { path: "f.txt", force: true })), /alpha/);
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), NOTE);
	});

	// 4
	it("4: exactly 10 turns later still gives the note, 11 turns gives content", async () => {
		for (const [later, expectNote] of [[10, true], [11, false]] as const) {
			const { tools, s } = await setup();
			await read(tools, s, { path: "f.txt" });
			turns(s, later - 1); // the call below adds the last turn itself
			const result = textOf(await read(tools, s, { path: "f.txt" }));
			if (expectNote) assert.match(result, NOTE, `${later} turns`);
			else assert.match(result, /alpha/, `${later} turns`);
		}
	});

	it("4: at 30000 estimated tokens gives the note, at 30001 gives content", async () => {
		for (const [target, expectNote] of [[30000, true], [30001, false]] as const) {
			const { tools, s } = await setup();
			await read(tools, s, { path: "f.txt" });
			const after = s.branch.length;
			const current = assistant();
			const room = target - estimateTokens((current as any).message);
			s.branch.push(user("x".repeat(room * 4)));
			s.branch.push(current);
			const sum = s.branch.slice(after).reduce((n, e) => n + estimateTokens(e.message), 0);
			assert.equal(sum, target, "the fake entries add up to the target");
			const result = textOf(await readNow(tools, s, { path: "f.txt" }));
			if (expectNote) assert.match(result, NOTE, `${target} tokens`);
			else assert.match(result, /alpha/, `${target} tokens`);
		}
	});

	it("4: custom_message entries count towards the token limit", async () => {
		const { tools, s } = await setup();
		await read(tools, s, { path: "f.txt" });
		s.branch.push({ type: "custom_message", customType: "x", content: "y".repeat(30000 * 4 + 40), display: false });
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), /alpha/);
	});

	it("4: branch_summary entries count towards the token limit", async () => {
		const { tools, s } = await setup();
		await read(tools, s, { path: "f.txt" });
		s.branch.push({ type: "branch_summary", fromId: "x", summary: "y".repeat(30000 * 4 + 40) });
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), /alpha/);
		const small = await setup();
		await read(small.tools, small.s, { path: "f.txt" });
		small.s.branch.push({ type: "branch_summary", fromId: "x", summary: "short" });
		assert.match(textOf(await read(small.tools, small.s, { path: "f.txt" })), NOTE);
	});

	// 5
	it("5: a compaction entry after the read clears it, with everything else within limits", async () => {
		const { tools, s } = await setup();
		await read(tools, s, { path: "f.txt" });
		s.branch.push({ type: "compaction", summary: "s", firstKeptEntryId: "x", tokensBefore: 1 });
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), /alpha/);
		// the read after the compaction is a new full read
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), NOTE);
	});

	it("5: the last full read must still be in the branch", async () => {
		const { tools, s } = await setup();
		await read(tools, s, { path: "f.txt" });
		s.branch.length = 0; // e.g. the session moved to another branch
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), /alpha/);
	});

	it("5: a context_edit that removes or replaces the read result clears it; an edit of another entry does not", async () => {
		for (const replacement of [null, { content: [{ type: "text", text: "trimmed" }] }]) {
			const { tools, s } = await setup();
			await read(tools, s, { path: "f.txt" }, "r1");
			s.branch.push({ type: "context_edit", targetId: "res-r1", replacement });
			assert.match(textOf(await read(tools, s, { path: "f.txt" })), /alpha/, JSON.stringify(replacement));
		}
		const { tools, s } = await setup();
		await read(tools, s, { path: "f.txt" }, "r1");
		s.branch.push({ type: "context_edit", targetId: "some-other-entry", replacement: null });
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), NOTE);
	});

	it("4: a context_edit that replaces a later entry counts the replacement; the latest edit of an entry is the one that counts", async () => {
		const huge = "z".repeat(30000 * 4 + 40);
		const cases: [string, any[], boolean][] = [
			["a huge replacement of a short later message", [{ content: huge }], false],
			["an omitted later message (raw count stays)", [null], true],
			["a huge edit then a small one: the small one is the latest", [{ content: huge }, { content: "small" }], true],
			["a small edit then a huge one: the huge one is the latest", [{ content: "small" }, { content: huge }], false],
		];
		for (const [name, replacements, expectNote] of cases) {
			const { tools, s } = await setup();
			await read(tools, s, { path: "f.txt" });
			s.branch.push({ type: "message", id: "later", message: { role: "user", content: "short" } });
			for (const replacement of replacements) s.branch.push({ type: "context_edit", targetId: "later", replacement });
			const result = textOf(await read(tools, s, { path: "f.txt" }));
			if (expectNote) assert.match(result, NOTE, name);
			else assert.match(result, /alpha/, name);
		}
	});

	// 6
	it("6: a different mtime gives content", async () => {
		const { tools, s, file } = await setup();
		await read(tools, s, { path: "f.txt" });
		const st = await stat(file);
		await writeFile(file, "alpha\nbeta\ngamma\ndelta\n");
		await utimes(file, new Date(st.mtimeMs + 5000), new Date(st.mtimeMs + 5000));
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), /alpha/);
	});

	it("6: the same mtime but different content gives content (hash)", async () => {
		const { tools, s, file } = await setup();
		// a whole-second mtime, so that restoring it is exact
		const when = new Date(1_700_000_000_000);
		await utimes(file, when, when);
		await read(tools, s, { path: "f.txt" });
		await writeFile(file, "ALPHA\nbeta\ngamma\ndelta\n");
		await utimes(file, when, when);
		assert.equal((await stat(file)).mtimeMs, when.getTime(), "mtime restored");
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), /ALPHA/);
	});

	it("6: the session's own edit or write in between gives content", async () => {
		const { tools, s } = await setup();
		await read(tools, s, { path: "f.txt" });
		await call(tools, s, "edit", { path: "f.txt", edits: [{ oldText: "beta", newText: "BETA" }] });
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), /BETA/);
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), NOTE);
		await call(tools, s, "write", { path: "f.txt", content: "written\n" });
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), /written/);
	});

	// 7
	it("7: images never give the note and are never remembered", async () => {
		const { dir, tools, s } = await setup();
		await writeFile(join(dir, "p.png"), PNG);
		for (let i = 0; i < 2; i++) {
			const result = await read(tools, s, { path: "p.png" });
			assert.ok(result.content.some((c: any) => c.type === "image"), `read ${i} returns the image`);
			assert.doesNotMatch(textOf(result), /unchanged since/);
		}
	});

	it("7: an image the stock read could not process (text-only answer) is never remembered", async () => {
		const { dir, tools, s } = await setup();
		// A valid PNG header (the stock detector accepts it) with an undecodable body: the stock tool answers with text only
		// and no error
		await writeFile(join(dir, "bad.png"), Buffer.concat([PNG.subarray(0, 29), Buffer.from("not a png body")]));
		for (let i = 0; i < 2; i++) {
			const result = await read(tools, s, { path: "bad.png" });
			assert.equal(result.isError, undefined);
			assert.ok(!result.content.some((c: any) => c.type === "image"), "no image block");
			assert.match(textOf(result), /^Read image file \[image\/png\]/, `read ${i}`);
		}
	});

	it("7: errors throw every time and are not remembered", async () => {
		const { dir, tools, s } = await setup();
		for (let i = 0; i < 2; i++) await assert.rejects(read(tools, s, { path: "missing.txt" }));
		for (let i = 0; i < 2; i++) await assert.rejects(read(tools, s, { path: "f.txt", offset: 100 }), /beyond|offset/i);
		// the missing file appears later: a read gives its content, not a note
		await writeFile(join(dir, "missing.txt"), "now here\n");
		assert.match(textOf(await read(tools, s, { path: "missing.txt" })), /now here/);
	});

	it("7: a file over the stock limit is remembered like any text; offset=N is another range", async () => {
		const { dir, tools, s } = await setup();
		await writeFile(join(dir, "big.txt"), Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
		const first = textOf(await read(tools, s, { path: "big.txt" }));
		const next = /Use offset=(\d+) to continue/.exec(first);
		assert.ok(next, "truncated with a continue tail");
		assert.match(textOf(await read(tools, s, { path: "big.txt" })), NOTE);
		const rest = textOf(await read(tools, s, { path: "big.txt", offset: Number(next[1]) }));
		assert.match(rest, /line 3000/);
		assert.doesNotMatch(rest, NOTE);
	});

	// 8
	it("8: two tool sets (subagents) do not share memory, even with the same session id and branch", async () => {
		const { dir, tools, s } = await setup();
		const other = toolSet(dir);
		await read(tools, s, { path: "f.txt" });
		assert.match(textOf(await readNow(other, s, { path: "f.txt" })), /alpha/);
		const second = session(dir, "s2");
		assert.match(textOf(await read(other, second, { path: "f.txt" })), /alpha/);
		assert.match(textOf(await read(other, second, { path: "f.txt" })), NOTE, "the other set remembers its own read");
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), NOTE);
	});

	it("8: different session ids in one tool set do not share memory", async () => {
		const { tools, s } = await setup();
		await read(tools, s, { path: "f.txt" });
		s.state.sessionId = "s-other";
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), /alpha/);
	});

	// 9
	it("9: a call inside a codemode script (id with /) gives content, is not remembered, and a top-level read still gives content", async () => {
		const { tools, s } = await setup();
		for (const id of ["c0/1", "c0/2"]) {
			const inner = await read(tools, s, { path: "f.txt" }, id);
			assert.match(textOf(inner), /alpha/, id);
		}
		assert.match(textOf(await read(tools, s, { path: "f.txt" })), /alpha/);
	});

	it("9: a top-level read remembered before does not turn a script read into a note", async () => {
		const { tools, s } = await setup();
		await read(tools, s, { path: "f.txt" });
		assert.match(textOf(await read(tools, s, { path: "f.txt" }, "c5/1")), /alpha/);
	});

	// 11
	it("11: contexts without session entries never give the note", async () => {
		const { dir, tools } = await setup();
		const bare = { cwd: dir, sessionManager: { getSessionId: () => "s" } };
		const throwing = { cwd: dir, sessionManager: { getSessionId: () => "s", getBranch: () => { throw new Error("no branch"); } } };
		const none = { cwd: dir };
		for (const ctx of [bare, throwing, none]) {
			for (let i = 0; i < 2; i++) {
				const result = await tools.read.execute(`id${seq++}`, { path: "f.txt" }, undefined, undefined, ctx);
				assert.match(textOf(result), /alpha/);
			}
		}
	});

	// 12
	it("12: read parameters are path, offset, limit, force; only path is required; force is boolean; the description mentions force", async () => {
		const { tools } = await setup();
		const parameters = tools.read.parameters;
		assert.deepEqual(Object.keys(parameters.properties).sort(), ["force", "limit", "offset", "path"]);
		assert.deepEqual(parameters.required, ["path"]);
		assert.equal(parameters.properties.force.type, "boolean");
		assert.match(tools.read.description, /force/);
		assert.match(await readFile(join(HERE, "../../../extensions/RQW-tools/descriptions", "read.md"), "utf-8"), /force/);
	});

	it("12: force is not passed on to the stock read", async () => {
		const { tools, s } = await setup();
		const result = await read(tools, s, { path: "f.txt", force: true });
		assert.match(textOf(result), /alpha/);
	});

	// 13
	it("13: edit.md and write.md carry the no-reread rule", async () => {
		for (const name of ["edit", "write"]) {
			assert.ok((await readFile(join(HERE, "../../../extensions/RQW-tools/descriptions", `${name}.md`), "utf-8")).includes("never reread it just to verify your own change"), name);
		}
	});
});

// ---- real Pi pipeline -----------------------------------------------------------------------------------------------

const faux = fauxProvider();
let modelRuntime: ModelRuntime;
let agentDir: string;
const live = new Set<AgentSession>();

describe("unchanged read (real pipeline)", () => {
	before(async () => {
		agentDir = join(root, "agent");
		await mkdir(agentDir, { recursive: true });
		modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
		modelRuntime.registerNativeProvider(faux.provider);
	});
	afterEach(() => { for (const s of live) void s.abort(); });

	type Step = { calls: [name: string, args: Record<string, unknown>][]; before?: (session: AgentSession) => void };
	/** Each step is one assistant message of tool calls (ids `s<step>c<i>`), then a final text. Returns the results by id. */
	async function scenario(steps: Step[]): Promise<{ text: Map<string, string>; dir: string }> {
		const dir = await freshDir();
		await writeFile(join(dir, "f.txt"), "alpha\nbeta\ngamma\n");
		await writeFile(join(dir, "o.txt"), "other\n");
		process.chdir(dir); // RQW-tools takes process.cwd() when its factory runs
		const argv = process.argv;
		process.argv = [...argv, "--tools", "+codemode"];
		const text = new Map<string, string>();
		try {
			const resourceLoader = new DefaultResourceLoader({
				cwd: dir,
				agentDir,
				additionalExtensionPaths: [TOOLS],
				extensionFactories: [
					{ name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true as const },
					{ name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true as const },
				],
				noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			});
			await resourceLoader.reload();
			assert.deepEqual(resourceLoader.getExtensions().errors, [], "extension load errors");
			const { session } = await createAgentSession({
				cwd: dir, agentDir, model: faux.getModel(), thinkingLevel: "off", modelRuntime, resourceLoader,
				sessionManager: SessionManager.inMemory(dir),
				settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
				tools: ["+codemode"],
			});
			live.add(session);
			try {
				await session.bindExtensions({});
				const responses: any[] = steps.map((step, n) => () => {
					step.before?.(session);
					return fauxAssistantMessage(step.calls.map(([name, args], i) => fauxToolCall(name, args as any, { id: `s${n}c${i}` })), { stopReason: "toolUse" });
				});
				responses.push(fauxAssistantMessage(fauxText("done")));
				faux.setResponses(responses);
				session.subscribe((event) => {
					if (event.type === "tool_execution_end") {
						assert.equal(!!event.isError, false, JSON.stringify(event.result));
						text.set(event.toolCallId, (event.result?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n"));
					}
				});
				await Promise.race([
					session.prompt("go"),
					new Promise((_, reject) => setTimeout(() => reject(new Error("no result after 20 s")), 20000).unref()),
				]);
			} finally {
				live.delete(session);
				session.dispose();
			}
		} finally {
			process.argv = argv;
			process.chdir(ORIGINAL_CWD);
		}
		return { text, dir };
	}
	const READ: [string, Record<string, unknown>] = ["read", { path: "f.txt" }];

	it("10: the first read gives content, the repeat in the next turn gives the note", async () => {
		const { text } = await scenario([{ calls: [READ] }, { calls: [READ] }]);
		assert.match(text.get("s0c0")!, /alpha/);
		assert.match(text.get("s1c0")!, NOTE);
	});

	it("10: the turn limit holds in the real branch: 10 turns later a note, 11 turns content", async () => {
		for (const [later, expectNote] of [[10, true], [11, false]] as const) {
			const filler: Step[] = Array.from({ length: later - 1 }, () => ({ calls: [["read", { path: "o.txt" }] as [string, any]] }));
			const { text } = await scenario([{ calls: [READ] }, ...filler, { calls: [READ] }]);
			const last = text.get(`s${later}c0`)!;
			if (expectNote) assert.match(last, NOTE, `${later} turns`);
			else assert.match(last, /alpha/, `${later} turns`);
		}
	});

	it("10: force true gives the content through the real pipeline, and the next normal repeat gives the note", async () => {
		const { text } = await scenario([
			{ calls: [READ] },
			{ calls: [["read", { path: "f.txt", force: true }]] },
			{ calls: [READ] },
		]);
		assert.match(text.get("s1c0")!, /alpha/);
		assert.match(text.get("s2c0")!, NOTE);
	});

	it("10: a real compaction entry after the read makes the next identical read give content", async () => {
		const { text } = await scenario([
			{ calls: [READ] },
			{
				calls: [READ],
				before: (session) => {
					const first = session.sessionManager.getBranch()[0];
					session.sessionManager.appendCompaction("summary", first.id, 1000);
				},
			},
			{ calls: [READ] },
		]);
		assert.match(text.get("s1c0")!, /alpha/);
		assert.match(text.get("s2c0")!, NOTE, "the read after the compaction is remembered again");
	});

	it("10: a real context_edit that removes the read result makes the next identical read give content", async () => {
		const { text } = await scenario([
			{ calls: [READ] },
			{
				calls: [READ],
				before: (session) => {
					const result = session.sessionManager.getBranch().find((e: any) => e.type === "message" && e.message.role === "toolResult" && e.message.toolCallId === "s0c0");
					session.sessionManager.appendContextEdit(result!.id, null);
				},
			},
			{ calls: [READ] },
		]);
		assert.match(text.get("s1c0")!, /alpha/);
		assert.match(text.get("s2c0")!, NOTE, "the read after the edit is remembered again");
	});

	it("10: two reads of the same file in one codemode script give the content both times, and a later top-level read too", async () => {
		const script = `const a = await tools.read({ path: "f.txt" });\nconst b = await tools.read({ path: "f.txt" });\nreturn [a, b];`;
		const { text } = await scenario([{ calls: [["codemode", { code: script }]] }, { calls: [READ] }]);
		const out = text.get("s0c0")!;
		assert.equal(out.split("alpha").length - 1, 2, out);
		assert.doesNotMatch(out, /unchanged since/);
		assert.match(text.get("s1c0")!, /alpha/);
		assert.doesNotMatch(text.get("s1c0")!, /unchanged since/);
	});
});
