// Root integration: the nested-call display metadata RQW-tools writes for completed edit and bash calls of a codemode
// script, through the real Pi pipeline (faux provider, Pi's built-in codemode, RQW-tools loaded from its file, a
// persisted session saved and reopened by the public SessionManager), read by RQW-tool-ui's group builder. The
// stream (events held) and the reload must give the same groups; no output, diff or argument text is stored in the
// metadata. Root only: it is the one place that may import two extensions.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	createCodemodeExtension,
	createToolSearchExtension,
	DefaultResourceLoader,
	ModelRuntime,
	type SessionEntry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { classifyChange } from "../extensions/RQW-tool-ui/changes.ts";
import { classify } from "../extensions/RQW-tool-ui/classify.ts";
import { buildGroups, type LiveExecution, type Member } from "../extensions/RQW-tool-ui/groups.ts";
import { countSummary } from "../extensions/RQW-tool-ui/summary.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = join(HERE, "..", "extensions", "RQW-tools", "index.ts");
const ORIGINAL_CWD = process.cwd();

const faux = fauxProvider();
let root: string;
let agentDir: string;
let modelRuntime: ModelRuntime;
let counter = 0;
const live = new Set<AgentSession>();

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-nested-display-"));
	agentDir = join(root, "agent");
	await mkdir(agentDir, { recursive: true });
	modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(faux.provider);
});

after(async () => {
	process.chdir(ORIGINAL_CWD);
	await rm(root, { recursive: true, force: true });
});

const rec = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, any>) : {});

type Outcome = {
	dir: string;
	file: string;
	/** Events as the stream reported them. */
	executions: LiveExecution[];
	liveMessages: unknown[];
	/** The saved tool result message of the codemode call "c0". */
	parent: Record<string, any>;
	/** Branch entries after SessionManager.open of the saved file. */
	reloaded: SessionEntry[];
	/** Raw text of the saved session file. */
	raw: string;
};

/** One real persisted session with one codemode call "c0" running `code`; `abortWhen` aborts the turn on a nested start. */
async function runScript(code: string, o: { setup?: (dir: string) => Promise<void>; abortOn?: (toolName: string) => boolean } = {}): Promise<Outcome> {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	await o.setup?.(dir);
	const sessionDir = join(dir, ".sessions");
	process.chdir(dir); // RQW-tools takes process.cwd() when its factory runs
	const argv = process.argv;
	process.argv = [...argv, "--tools", "+codemode"];
	try {
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("codemode", { code }, { id: "c0" })], { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxText("done")),
		]);
		const resourceLoader = new DefaultResourceLoader({
			cwd: dir,
			agentDir,
			additionalExtensionPaths: [TOOLS],
			extensionFactories: [
				{ name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true as const },
				{ name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true as const },
			],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await resourceLoader.reload();
		assert.deepEqual(resourceLoader.getExtensions().errors, [], "extension load errors");
		const sessionManager = SessionManager.create(dir, sessionDir);
		const { session } = await createAgentSession({
			cwd: dir,
			agentDir,
			model: faux.getModel(),
			thinkingLevel: "off",
			modelRuntime,
			resourceLoader,
			sessionManager,
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
			tools: ["+codemode"],
		});
		const executions: LiveExecution[] = [];
		const liveMessages: unknown[] = [];
		live.add(session);
		let timer: NodeJS.Timeout | undefined;
		try {
			await session.bindExtensions({ onError: (e) => assert.fail(`${e.event}: ${e.error}`) });
			session.subscribe((event: any) => {
				if (event.type === "tool_execution_start") {
					executions.push({ toolCallId: event.toolCallId, toolName: event.toolName, args: event.args, ...(event.parentToolCallId ? { parentToolCallId: event.parentToolCallId } : {}) });
					if (event.parentToolCallId && o.abortOn?.(event.toolName)) setTimeout(() => void session.abort(), 150);
				} else if (event.type === "tool_execution_end") {
					const x = executions.find((e) => e.toolCallId === event.toolCallId);
					if (x) Object.assign(x, { ended: true, result: event.result, isError: event.isError === true });
				} else if (event.type === "message_end") liveMessages.push(event.message);
			});
			const watchdog = new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					for (const s of live) void s.abort();
					reject(new Error("no result after 8 s"));
				}, 8000);
			});
			await Promise.race([session.prompt("go"), watchdog]);
		} finally {
			clearTimeout(timer);
			live.delete(session);
			session.dispose();
		}
		const file = sessionManager.getSessionFile();
		assert.ok(file, "the session was not persisted");
		const reopened = SessionManager.open(file, sessionDir);
		const reloaded = reopened.buildContextEntries();
		const parent = liveMessages.find((m) => rec(m).role === "toolResult" && rec(m).toolCallId === "c0") as Record<string, any> | undefined;
		assert.ok(parent, "no codemode result");
		return { dir, file, executions, liveMessages, parent, reloaded, raw: await readFile(file, "utf-8") };
	} finally {
		process.argv = argv;
		process.chdir(ORIGINAL_CWD);
	}
}

/** Grouping of c0 from the stream (saved entries not yet drawn, events held) and from the reloaded file. */
function groupsOf(r: Outcome) {
	const head = r.reloaded.filter((e) => !(e.type === "message" && rec(e.message).role === "toolResult"));
	const streamed = buildGroups(head as SessionEntry[], { messages: r.liveMessages.filter((m) => rec(m).role === "toolResult"), executions: r.executions.map((x) => ({ ...x })) }).get("c0")!;
	const reloaded = buildGroups(r.reloaded).get("c0")!;
	assert.ok(streamed && reloaded, "no group for c0");
	// Before the parent's message is saved, only the completed-call event marker supplies these facts.
	const beforeSave = buildGroups(head as SessionEntry[], { executions: r.executions }).get("c0")!;
	const withoutDuration = (members: Member[]) => members.map(({ durationMs: _duration, ...m }) => m);
	assert.deepEqual(withoutDuration(beforeSave.members), withoutDuration(reloaded.members), "completed live events disagree with saved history");
	return { streamed, reloaded };
}

/** The summary counts of members, classified the way the tool-ui wiring does. */
const summary = (members: Member[]) =>
	countSummary(members.map((m) => {
		const ctx = { toolCallId: m.id, isPartial: m.isPartial, isError: m.isError === true };
		return m.toolName === "edit" || m.toolName === "write" ? classifyChange(m.toolName, m.args, m.result, ctx, "linux") : classify(m.toolName, m.args, m.result, ctx, "linux");
	}));

/** The saved parent result as the reloaded file holds it. */
function savedParent(r: Outcome): Record<string, any> {
	const e = r.reloaded.find((x) => x.type === "message" && rec(x.message).role === "toolResult" && rec(x.message).toolCallId === "c0");
	assert.ok(e && e.type === "message");
	return e.message as unknown as Record<string, any>;
}

/** Metadata of one nested call on the saved parent. */
const markerOf = (parent: Record<string, any>, id: string) => rec(parent.details?.rqwToolsNested?.calls?.find((c: any) => c.id === id));

/** The saved parent and the live result carry the same nested metadata. */
function assertPersisted(r: Outcome) {
	assert.deepEqual(savedParent(r).details?.rqwToolsNested, r.parent.details?.rqwToolsNested, "reload lost or changed the metadata");
}

const SECRET = "SECRET-OUTPUT-XYZ";
const SECRET_NEW = "SECRET-NEW-TEXT";
const abc = (d: string) => Promise.all([writeFile(join(d, "a.txt"), "one\ntwo\nthree\n"), writeFile(join(d, "b.txt"), "alpha\nbeta\n")]);

describe("nested codemode display metadata: real Pi pipeline, saved and reopened session", () => {
	it("successful edit: confirmed +A -R on the nested call, same after reload, nothing else stored", async () => {
		const r = await runScript(
			`await tools.edit({ edits: [{ path: "a.txt", oldText: "two", newText: "${SECRET_NEW}\\n${SECRET_NEW}" }] });\nreturn "ok";`,
			{ setup: abc },
		);
		assert.equal(await readFile(join(r.dir, "a.txt"), "utf-8"), `one\n${SECRET_NEW}\n${SECRET_NEW}\nthree\n`);
		const endEvent = r.executions.find((x) => x.toolName === "edit");
		assert.ok(endEvent?.ended && endEvent.isError !== true);
		const live = rec(endEvent.result).details?.rqwToolsNestedCall;
		assert.equal(live.version, 1);
		assert.equal(live.tool, "edit");
		assert.equal(live.files.length, 1);
		assert.equal(live.files[0].path, "a.txt");
		assert.equal(live.files[0].ok, true);
		assert.equal(live.files[0].added, 2);
		assert.equal(live.files[0].removed, 1);
		assert.deepEqual(Object.keys(live.files[0]).sort(), ["added", "ok", "path", "removed"]);

		assertPersisted(r);
		const metadata = savedParent(r).details.rqwToolsNested;
		assert.equal(metadata.version, 1);
		assert.deepEqual(metadata.calls, [{ id: "c0/1", ...live }]);
		// No requested text, diff or output in the metadata, nor anywhere in the saved file besides Pi's own records.
		assert.doesNotMatch(JSON.stringify(metadata), new RegExp(`${SECRET_NEW}|patch|diff|content|output|oldText|newText`));

		const { streamed, reloaded } = groupsOf(r);
		assert.deepEqual(streamed.members, reloaded.members);
		const [m] = reloaded.members;
		assert.equal(m.toolName, "edit");
		assert.equal(m.parentId, "c0");
		assert.deepEqual(rec(m.result).details.files[0].details, { rqwToolsNestedCounts: { added: live.files[0].added, removed: live.files[0].removed } });
		assert.deepEqual(summary(streamed.members), summary(reloaded.members));
		assert.equal(summary(reloaded.members).added, live.files[0].added);
		assert.equal(summary(reloaded.members).removed, live.files[0].removed);
		assert.equal(summary(reloaded.members).failed, 0);
	});

	it("mixed files: the failed file has no counts, the successful one keeps its own", async () => {
		const r = await runScript(
			`const r = await tools.edit({ edits: [{ path: "a.txt", oldText: "two", newText: "2" }, { path: "b.txt", oldText: "${SECRET}", newText: "x" }] });\nreturn "after";`,
			{ setup: abc },
		);
		// Pi's executeTool reports the failure as an error result of the nested call or a thrown error; either way the file edit happened.
		assert.equal(await readFile(join(r.dir, "a.txt"), "utf-8"), "one\n2\nthree\n");
		assert.equal(await readFile(join(r.dir, "b.txt"), "utf-8"), "alpha\nbeta\n");
		const { streamed, reloaded } = groupsOf(r);
		assert.deepEqual(streamed.members, reloaded.members);
		const edit = reloaded.members.find((m) => m.toolName === "edit");
		assert.ok(edit, "no nested edit member");
		assert.equal(edit.isError, true);
		const marker = markerOf(savedParent(r), "c0/1");
		{
			assert.equal(marker.tool, "edit");
			const byPath = Object.fromEntries(marker.files.map((f: any) => [f.path, f]));
			assert.equal(byPath["a.txt"].ok, true);
			assert.ok(byPath["a.txt"].added >= 1 && byPath["a.txt"].removed >= 1);
			assert.equal(byPath["b.txt"].ok, false);
			assert.equal(byPath["b.txt"].added, undefined);
			assert.equal(byPath["b.txt"].removed, undefined);
			assert.doesNotMatch(JSON.stringify(marker), new RegExp(`${SECRET}|error|Could not find`));
			assert.equal(byPath["a.txt"].added, 1);
			assert.equal(byPath["a.txt"].removed, 1);
		}
		const counted = summary(reloaded.members);
		assert.equal(counted.failed, 1);
		assert.equal(counted.added, 1, "only the confirmed file counts");
		assert.equal(counted.removed, 1);
		assert.deepEqual(summary(streamed.members), summary(reloaded.members));
		assertPersisted(r);
	});

	it("noop edit (identical text): Pi's stock edit fails it, so no counts are invented", async () => {
		const r = await runScript(`return await tools.edit({ edits: [{ path: "a.txt", oldText: "two", newText: "two" }] });`, { setup: abc });
		const x = r.executions.find((e) => e.toolName === "edit");
		assert.ok(x?.ended);
		assert.equal(x.isError, true, "the stock result for a no-change edit is an error");
		assert.equal(rec(x.result).details?.rqwToolsNestedCall, undefined);
		const { streamed, reloaded } = groupsOf(r);
		assert.deepEqual(streamed.members, reloaded.members);
		assert.deepEqual(markerOf(savedParent(r), "c0/1"), {});
		assert.equal(savedParent(r).details?.rqwToolsNested, undefined);
		const counted = summary(reloaded.members);
		assert.equal(counted.failed, 1);
		assert.equal(counted.added, undefined);
		assert.equal(counted.removed, undefined);
		assert.deepEqual(summary(streamed.members), counted);
		assertPersisted(r);
	});

	it("bash exit 0 and a nonzero exit: the actual exit code, same after reload, no output stored", async () => {
		const r = await runScript(
			`const ok = await tools.bash({ command: "echo ${SECRET}" });\n` +
				`let bad; try { bad = await tools.bash({ command: "echo ${SECRET}; exit 3" }); } catch (e) { bad = { thrown: String(e) }; }\n` +
				`return JSON.stringify([ok.exit_code, bad.exit_code]);`,
		);
		const ends = r.executions.filter((x) => x.toolName === "bash");
		assert.equal(ends.length, 2);
		const exitOf = (x: LiveExecution) => rec(x.result).structuredContent?.exit_code;
		assert.equal(exitOf(ends[0]), 0);
		assert.equal(exitOf(ends[1]), 3);
		for (const x of ends) {
			assert.deepEqual(rec(x.result).details?.rqwToolsNestedCall, { version: 1, tool: "bash", exitCode: exitOf(x) });
		}
		assertPersisted(r);
		const metadata = savedParent(r).details.rqwToolsNested;
		assert.deepEqual(metadata.calls, [
			{ id: ends[0].toolCallId, version: 1, tool: "bash", exitCode: 0 },
			{ id: ends[1].toolCallId, version: 1, tool: "bash", exitCode: 3 },
		]);
		assert.doesNotMatch(JSON.stringify(metadata), new RegExp(`${SECRET}|echo|output|command`));
		const { streamed, reloaded } = groupsOf(r);
		assert.deepEqual(streamed.members, reloaded.members);
		assert.deepEqual(reloaded.members.map((m) => rec(m.result).structuredContent), [{ exit_code: 0 }, { exit_code: 3 }]);
		assert.deepEqual(summary(streamed.members), summary(reloaded.members));
		assert.equal(summary(reloaded.members).ran, 2);
	});

	it("script failure after a nested edit: confirmed nested call keeps its counts, the failure adds none", async () => {
		const r = await runScript(`await tools.edit({ edits: [{ path: "a.txt", oldText: "two", newText: "2" }] });\nthrow new Error("script broke");`, { setup: abc });
		assert.equal(r.parent.isError, true);
		assert.equal(await readFile(join(r.dir, "a.txt"), "utf-8"), "one\n2\nthree\n");
		assertPersisted(r);
		const { streamed, reloaded } = groupsOf(r);
		assert.deepEqual(streamed.members, reloaded.members);
		const edits = reloaded.members.filter((m) => m.toolName === "edit");
		assert.equal(edits.length, 1);
		assert.deepEqual(summary(streamed.members), summary(reloaded.members));
		assert.equal(summary(reloaded.members).added, 1);
		assert.equal(summary(reloaded.members).removed, 1);
	});

	it("script that fails before any nested call: no metadata, no invented members", async () => {
		const r = await runScript(`throw new Error("early");`);
		assert.equal(r.parent.isError, true);
		assert.equal(rec(savedParent(r).details).rqwToolsNested, undefined);
		const { streamed, reloaded } = groupsOf(r);
		assert.deepEqual(streamed.members, reloaded.members);
		assert.deepEqual(reloaded.members.map((m) => m.id), ["c0"]);
	});

	it("abort during a nested bash: the aborted call gets no exit code, no marker and no counts", async () => {
		const r = await runScript(`await tools.bash({ command: "sleep 30" });\nreturn "never";`, { abortOn: (name) => name === "bash" });
		const saved = savedParent(r);
		assert.equal(saved.isError, true);
		// Pi's own record decides status; our metadata exists only for calls that returned a final result.
		const recorded = rec(saved.nestedCalls).calls as any[];
		assert.equal(recorded.length, 1);
		assert.equal(recorded[0].name, "bash");
		assert.notEqual(recorded[0].status, "ok");
		assert.equal(saved.details?.rqwToolsNested, undefined);
		assertPersisted(r);
		const { streamed, reloaded } = groupsOf(r);
		assert.deepEqual(streamed.members, reloaded.members);
		const [m] = reloaded.members;
		assert.equal(m.toolName, "bash");
		assert.equal(rec(m.result).structuredContent, undefined, "an exit code was invented");
		if (m.unconfirmed) assert.equal(m.result, undefined);
		else assert.equal(m.isError, true);
		assert.deepEqual(summary(streamed.members), summary(reloaded.members));
	});

	it("persisted file holds no nested output, diff or request text beyond Pi's own record", async () => {
		const r = await runScript(
			`await tools.edit({ edits: [{ path: "a.txt", oldText: "two", newText: "${SECRET_NEW}" }] });\nawait tools.bash({ command: "echo ${SECRET}" });\nreturn "ok";`,
			{ setup: abc },
		);
		const lines = r.raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
		const parent = lines.find((l) => l.type === "message" && l.message?.toolCallId === "c0").message;
		const metadata = JSON.stringify(parent.details.rqwToolsNested);
		assert.doesNotMatch(metadata, new RegExp(`${SECRET}|${SECRET_NEW}`));
		// The nested calls' own results are not saved at all: only the parent's text and Pi's bounded record.
		const nestedResults = lines.filter((l) => l.type === "message" && l.message?.role === "toolResult" && l.message.toolCallId !== "c0");
		assert.deepEqual(nestedResults, []);
	});
});
