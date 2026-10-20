// Layer 3 of notes/analysis-races.md: the extension inside the real Pi pipeline, no model.
// Real AgentSession (agent loop, real tool execution, extension loaded from its file the way Pi loads a package
// extension) with the faux provider from pi-ai, which scripts assistant messages with several tool calls.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type ToolCall } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionEvent,
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const ORIGINAL_CWD = process.cwd();

type Call = [name: string, args: ToolCall["arguments"]];
// The part of a JSON schema these tests look at.
type Schema = { properties: Record<string, { items?: { properties: Record<string, unknown> } }> };
type Outcome = { id: string; name: string; text: string; isError: boolean };
type Run = {
	dir: string;
	outcomes: Outcome[];
	events: { type: string; id: string; name: string; at: number }[];
	modelTools: { name: string; parameters: Schema }[];
	activeTools: string[];
	finalText: string;
	finished: boolean;
};

let root: string;
let agentDir: string;
let counter = 0;
const faux = fauxProvider();
let modelRuntime: ModelRuntime;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-pipeline-"));
	agentDir = join(root, "agent");
	await mkdir(agentDir, { recursive: true });
	modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		refreshOnCreate: false,
	});
	modelRuntime.registerNativeProvider(faux.provider);
});

after(async () => {
	process.chdir(ORIGINAL_CWD);
	await rm(root, { recursive: true, force: true });
});

async function freshDir(): Promise<string> {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	return dir;
}

const textOf = (content: readonly { type: string; text?: string }[]) => content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

/**
 * One assistant message holding all `calls` (one batch), then a final text message.
 * `setup` may prepare files in the temp dir; `during` runs once the session started (used to abort).
 */
async function runBatch(
	calls: Call[],
	opts: {
		setup?: (dir: string) => Promise<void>;
		during?: (session: AgentSession) => void;
	} = {},
): Promise<Run> {
	const dir = await freshDir();
	if (opts.setup) await opts.setup(dir);
	// The extension takes process.cwd() when its factory runs, so the load happens in the temp dir.
	process.chdir(dir);

	const run: Run = { dir, outcomes: [], events: [], modelTools: [], activeTools: [], finalText: "", finished: false };
	faux.setResponses([
		(context) => {
			// The model request declares tools through system messages; replay them in order.
			const declared = new Map<string, Schema>();
			for (const message of context.messages) {
				if (message.role !== "system") continue;
				for (const tool of message.toolsAdded ?? []) declared.set(tool.name, tool.parameters as unknown as Schema);
				for (const ref of message.toolsRemoved ?? []) declared.delete(ref.name);
			}
			run.modelTools = [...declared].map(([name, parameters]) => ({ name, parameters }));
			return fauxAssistantMessage(
				calls.map(([name, args], i) => fauxToolCall(name, args, { id: `c${i}` })),
				{ stopReason: "toolUse" },
			);
		},
		fauxAssistantMessage(fauxText("done")),
	]);

	const resourceLoader = new DefaultResourceLoader({
		cwd: dir,
		agentDir,
		additionalExtensionPaths: [EXTENSION],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	const loaded = resourceLoader.getExtensions();
	assert.deepEqual(loaded.errors, [], "extension load errors");
	assert.equal(loaded.extensions.length, 1);

	const { session } = await createAgentSession({
		cwd: dir,
		agentDir,
		model: faux.getModel(),
		thinkingLevel: "off",
		modelRuntime,
		resourceLoader,
		sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
	});
	try {
		run.activeTools = session.getActiveToolNames();
		session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
				run.events.push({ type: event.type, id: event.toolCallId, name: event.toolName, at: performance.now() });
			}
			if (event.type === "tool_execution_end") {
				run.outcomes.push({
					id: event.toolCallId,
					name: event.toolName,
					text: textOf(event.result?.content ?? []),
					isError: !!event.isError,
				});
			}
			if (event.type === "message_end" && event.message.role === "assistant") {
				run.finalText = textOf(event.message.content);
			}
		});
		opts.during?.(session);
		await session.prompt("go");
		run.finished = true;
	} finally {
		session.dispose();
		process.chdir(ORIGINAL_CWD);
	}
	return run;
}

const byId = (run: Run, i: number) => {
	const o = run.outcomes.find((x) => x.id === `c${i}`);
	assert.ok(o, `no tool result for call c${i}`);
	return o;
};

const exists = (p: string) => stat(p).then(() => true, () => false);

describe("pipeline: real agent loop, real tools, no model", () => {
	it("S1 [write f, read f] -> read sees the new content", async () => {
		const run = await runBatch(
			[["write", { path: "f.txt", content: "new" }], ["read", { path: "f.txt" }]],
			{ setup: (d) => writeFile(join(d, "f.txt"), "old") },
		);
		assert.equal(run.finalText, "done");
		assert.equal(byId(run, 0).isError, false);
		assert.equal(byId(run, 1).isError, false);
		assert.match(byId(run, 1).text, /^new$/m);
		assert.doesNotMatch(byId(run, 1).text, /old/);
		assert.equal(await readFile(join(run.dir, "f.txt"), "utf-8"), "new");
	});

	it("S2 [bash creates g, read g] -> read sees g", async () => {
		const run = await runBatch([
			["bash", { command: "sleep 0.1; echo GEN > g.txt" }],
			["read", { path: "g.txt" }],
		]);
		assert.equal(byId(run, 1).isError, false);
		assert.match(byId(run, 1).text, /GEN/);
	});

	it("S3 [write New.txt, write new.txt] -> second wins on case-insensitive volumes, both exist on linux", async () => {
		const run = await runBatch([
			["write", { path: "New.txt", content: "first" }],
			["write", { path: "new.txt", content: "second" }],
		]);
		assert.equal(byId(run, 0).isError, false);
		assert.equal(byId(run, 1).isError, false);
		if (process.platform === "darwin" || process.platform === "win32") {
			assert.equal(await readFile(join(run.dir, "New.txt"), "utf-8"), "second");
			assert.equal(await readFile(join(run.dir, "new.txt"), "utf-8"), "second");
		} else {
			assert.equal(await readFile(join(run.dir, "New.txt"), "utf-8"), "first");
			assert.equal(await readFile(join(run.dir, "new.txt"), "utf-8"), "second");
		}
	});

	it("S4 [write big f (16 MB), bash wc -c f] -> bash sees the full size", async () => {
		const size = 16 * 1024 * 1024;
		const run = await runBatch([
			["write", { path: "big.txt", content: "x".repeat(size) }],
			["bash", { command: "wc -c < big.txt" }],
		]);
		assert.equal(byId(run, 0).isError, false);
		assert.equal(byId(run, 1).isError, false);
		assert.equal(byId(run, 1).text.trim(), String(size));
	});

	it("S5 [read a, read b, grep, find] independent -> all succeed and overlap", async () => {
		const run = await runBatch(
			[
				["read", { path: "a.txt" }],
				["read", { path: "b.txt" }],
				["grep", { pattern: "needle", path: "." }],
				["find", { pattern: "*.txt", path: "." }],
			],
			{
				setup: async (d) => {
					await writeFile(join(d, "a.txt"), "alpha needle\n");
					await writeFile(join(d, "b.txt"), "beta\n");
				},
			},
		);
		for (let i = 0; i < 4; i++) assert.equal(byId(run, i).isError, false, `c${i}: ${byId(run, i).text}`);
		assert.match(byId(run, 0).text, /alpha needle/);
		assert.match(byId(run, 1).text, /beta/);
		assert.match(byId(run, 2).text, /a\.txt/);
		assert.match(byId(run, 3).text, /a\.txt/);
		assert.match(byId(run, 3).text, /b\.txt/);
		// Overlap: every call has started before the first one has finished.
		const starts = run.events.filter((e) => e.type === "tool_execution_start");
		const ends = run.events.filter((e) => e.type === "tool_execution_end");
		assert.equal(starts.length, 4);
		assert.ok(
			Math.max(...starts.map((e) => e.at)) < Math.min(...ends.map((e) => e.at)),
			`calls did not overlap: ${JSON.stringify(run.events.map((e) => [e.type, e.id, Math.round(e.at)]))}`,
		);
	});

	it("S6 multi-file edit of 3 files, then a read of each in the same batch sees the new content", async () => {
		const run = await runBatch(
			[
				[
					"edit",
					{
						edits: [
							{ path: "a.txt", oldText: "one", newText: "ONE" },
							{ path: "b.txt", oldText: "two", newText: "TWO" },
							{ path: "c.txt", oldText: "three", newText: "THREE" },
						],
					},
				],
				["read", { path: "a.txt" }],
				["read", { path: "b.txt" }],
				["read", { path: "c.txt" }],
			],
			{
				setup: async (d) => {
					await writeFile(join(d, "a.txt"), "one\n");
					await writeFile(join(d, "b.txt"), "two\n");
					await writeFile(join(d, "c.txt"), "three\n");
				},
			},
		);
		assert.equal(byId(run, 0).isError, false, byId(run, 0).text);
		assert.match(byId(run, 1).text, /ONE/);
		assert.match(byId(run, 2).text, /TWO/);
		assert.match(byId(run, 3).text, /THREE/);
	});

	it("S7 write with files[] of 3, then grep in the same batch finds all three", async () => {
		const run = await runBatch([
			[
				"write",
				{
					files: [
						{ path: "d/x.txt", content: "MARK x\n" },
						{ path: "d/y.txt", content: "MARK y\n" },
						{ path: "d/z.txt", content: "MARK z\n" },
					],
				},
			],
			["grep", { pattern: "MARK", path: "d" }],
		]);
		assert.equal(byId(run, 0).isError, false, byId(run, 0).text);
		const out = byId(run, 1).text;
		assert.equal(byId(run, 1).isError, false, out);
		for (const f of ["x.txt", "y.txt", "z.txt"]) assert.match(out, new RegExp(f.replace(".", "\\.")));
	});

	it("S8 edit where one of two files fails: the other is edited, result is an error, later read sees it", async () => {
		const run = await runBatch(
			[
				[
					"edit",
					{
						edits: [
							{ path: "a.txt", oldText: "one", newText: "ONE" },
							{ path: "b.txt", oldText: "does not occur", newText: "X" },
						],
					},
				],
				["read", { path: "a.txt" }],
				["read", { path: "b.txt" }],
			],
			{
				setup: async (d) => {
					await writeFile(join(d, "a.txt"), "one\n");
					await writeFile(join(d, "b.txt"), "two\n");
				},
			},
		);
		assert.equal(byId(run, 0).isError, true);
		assert.match(byId(run, 0).text, /a\.txt/);
		assert.match(byId(run, 0).text, /b\.txt/);
		assert.equal(await readFile(join(run.dir, "a.txt"), "utf-8"), "ONE\n");
		assert.equal(await readFile(join(run.dir, "b.txt"), "utf-8"), "two\n");
		assert.match(byId(run, 1).text, /ONE/);
		assert.match(byId(run, 2).text, /two/);
	});

	it("S9 the model sees exactly read, bash, edit, write, grep, find with stock parameter names", async () => {
		const run = await runBatch([["read", { path: "a.txt" }]], {
			setup: (d) => writeFile(join(d, "a.txt"), "x\n"),
		});
		const expected = ["bash", "edit", "find", "grep", "read", "write"];
		assert.deepEqual(run.activeTools.slice().sort(), expected, "session active tools");
		assert.deepEqual(run.modelTools.map((t) => t.name).sort(), expected, "tools in the model request");

		const props = (name: string) => run.modelTools.find((t) => t.name === name)!.parameters.properties;
		assert.deepEqual(Object.keys(props("read")).sort(), ["limit", "offset", "path"]);
		assert.deepEqual(Object.keys(props("bash")).sort(), ["command", "timeout"]);
		assert.deepEqual(Object.keys(props("grep")).sort(), ["context", "glob", "ignoreCase", "limit", "literal", "path", "pattern"]);
		assert.deepEqual(Object.keys(props("find")).sort(), ["limit", "path", "pattern"]);
		const edit = run.modelTools.find((t) => t.name === "edit")!.parameters;
		const editItems = edit.properties.edits.items!;
		assert.deepEqual(Object.keys(edit.properties).sort(), ["edits", "path"]);
		assert.deepEqual(Object.keys(editItems.properties).sort(), ["newText", "oldText", "path"]);
		assert.deepEqual(Object.keys(props("write")).sort(), ["content", "files", "path"]);
		assert.ok(props("write").files);
	});

	it("S10 abort during a long bash: queued later calls do not execute", async () => {
		const started = Date.now();
		const run = await runBatch(
			[
				["bash", { command: "sleep 5", timeout: 10 }],
				["write", { path: "later.txt", content: "should not exist" }],
				["edit", { path: "e.txt", edits: [{ oldText: "a", newText: "b" }] }],
			],
			{
				setup: (d) => writeFile(join(d, "e.txt"), "a\n"),
				during: (session) => {
					session.subscribe((event) => {
						if (event.type === "tool_execution_start" && event.toolName === "bash") {
							setTimeout(() => void session.abort(), 150);
						}
					});
				},
			},
		);
		assert.ok(Date.now() - started < 4500, "abort must cut the sleep short");
		assert.equal(await exists(join(run.dir, "later.txt")), false, "later write must not run");
		assert.equal(await readFile(join(run.dir, "e.txt"), "utf-8"), "a\n", "later edit must not run");
		assert.equal(run.finished, true);
	});
});
