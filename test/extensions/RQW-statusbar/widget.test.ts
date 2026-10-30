import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters as strip } from "node:util";
import { it } from "node:test";
import statusbar from "../../../extensions/RQW-statusbar/index.ts";
import { bindTestHost } from "./footer-host.ts";

it("shows the current activity in the widget after a cached frame", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	t.mock.method(performance, "now", () => 0);
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const pi = {
		events: { on: () => () => {}, emit() {} }, getSettings: () => ({}), getSessionName: () => undefined, getThinkingLevel: () => "off",
		registerCommand() {}, on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers.set(name, handler); },
	};
	let widget: (() => { render(width: number): string[] }) | undefined;
	const ctx = {
		mode: "tui", cwd: tmpdir(), model: undefined, isIdle: () => false,
		ui: { theme: { fg: (_role: string, text: string) => text }, getEditorComponent: () => ({}), setEditorComponent() {}, setFooter() {}, setWorkingIndicator() {},
			setWidget: (_key: string, factory: typeof widget) => { widget = factory; } },
	};
	statusbar(pi as never);
	await handlers.get("session_start")!({}, ctx);
	handlers.get("agent_start")!({}, ctx);
	const rows = widget!();
	assert.equal(strip(rows.render(80)[0]).trim(), "Planning next moves");
	rows.render(80);
	handlers.get("tool_execution_start")!({ toolCallId: "t", toolName: "bash", args: { command: "npm test" } }, ctx);
	assert.equal(strip(rows.render(80)[0]).trim(), "Running npm test");
	await handlers.get("session_shutdown")!({}, ctx);
});

// One refresh asks git for the file counts and for the branch.
const GIT_RUNS_PER_REFRESH = 2;

it("runs git after a write and the poll but not after a read, and shows the new state", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const root = await mkdtemp(join(tmpdir(), "rqw-statusbar-git-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, ".git"));
	// The git process is the boundary: a fake runner answers `status` and `symbolic-ref` and counts the runs.
	let porcelain = "";
	let gitRuns = 0;
	const dotGit = join(root, ".git");
	const dotGitStat = await fs.stat(dotGit);
	const stat = fs.stat;
	let sequence = 0;
	const calls: { kind: string; sequence: number }[] = [];
	t.mock.method(fs, "stat", (...args: Parameters<typeof stat>) => {
		assert.equal(args[0], dotGit);
		calls.push({ kind: "stat", sequence: ++sequence });
		return Promise.resolve(dotGitStat);
	});
	t.mock.method(childProcess, "execFile", (file: string, args: string[], _options: unknown, done: (error: Error | null, stdout: string) => void) => {
		assert.equal(file, "git");
		gitRuns++;
		calls.push({ kind: "git", sequence: ++sequence });
		done(null, args.includes("status") ? porcelain : "main\n");
	});
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	// No stored credentials: the quota consumer neither reads the real account nor renders later.
	const agentDir = join(root, "agent");
	await mkdir(agentDir);
	const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	t.after(() => { if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = savedAgentDir; });
	// A git refresh ends with exactly one asynchronous render request. Renders asked while the test itself
	// drives a handler or the clock are synchronous and do not count, so waiting never depends on timing.
	let driving = false;
	let wake: (() => void) | undefined;
	const drive = <T>(run: () => T): T => { driving = true; try { return run(); } finally { driving = false; } };
	const refreshed = () => new Promise<void>(done => { wake = done; });
	const requestRender = () => { if (!driving) wake?.(); };

	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	let command: unknown;
	const pi = {
		events: { on: () => () => {}, emit() {} }, getSettings: () => ({}), getSessionName: () => undefined, getThinkingLevel: () => "off",
		registerCommand(_name: string, value: unknown) { command = value; }, on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers.set(name, handler); },
	};
	let footer: ((tui: unknown, theme: unknown, data: unknown) => { render(width: number): string[] }) | undefined;
	const ctx = {
		mode: "tui", cwd: root, model: undefined, isIdle: () => false, getContextUsage: () => undefined,
		sessionManager: { getSessionId: () => "s", getLeafId: () => null, getEntryCount: () => 0, getEntries: () => [] },
		ui: { theme: { fg: (_role: string, text: string) => text }, getEditorComponent: () => ({}), setEditorComponent() {},
			setFooter: (factory: typeof footer) => { footer = factory; }, setWorkingIndicator() {}, setWidget() {} },
	};
	statusbar(pi as never);
	bindTestHost(t, command);
	await handlers.get("session_start")!({}, ctx);
	const started = refreshed();
	const rows = drive(() => footer!({ requestRender }, ctx.ui.theme, { onBranchChange: () => () => {}, getExtensionStatuses: () => new Map() }));
	const shown = () => rows.render(120).map(strip).join("\n");
	await started;
	const afterStart = gitRuns;
	assert.ok(afterStart > 0);
	assert.doesNotMatch(shown(), /\*1/);

	// Files change on disk, but a read cannot have changed them: no git run, the shown state stays.
	porcelain = " M a.ts\0";
	const beforeRead = calls.length;
	drive(() => {
		for (const toolName of ["read", "grep", "find", "web", "tool_search"]) handlers.get("tool_execution_end")!({ toolCallId: "r", toolName }, ctx);
	});
	assert.doesNotMatch(shown(), /\*1/);

	const written = refreshed();
	const writeStarted = ++sequence;
	drive(() => handlers.get("tool_execution_end")!({ toolCallId: "w", toolName: "write" }, ctx));
	assert.ok(calls.some(call => call.kind === "stat" && call.sequence > writeStarted));
	await written;
	const readAndWriteCalls = calls.slice(beforeRead);
	assert.ok(readAndWriteCalls.every(call => call.sequence > writeStarted));
	assert.deepEqual(readAndWriteCalls.map(call => call.kind), ["stat", "git", "git"]);
	assert.equal(gitRuns, afterStart + GIT_RUNS_PER_REFRESH);
	assert.match(shown(), /\*1/);

	// The 10 s poll runs git too and picks up a later change.
	const afterWrite = gitRuns;
	porcelain = " M a.ts\0 M b.ts\0";
	const polled = refreshed();
	const beforePoll = calls.length;
	drive(() => t.mock.timers.tick(10_000));
	assert.equal(calls[beforePoll]?.kind, "stat");
	await polled;
	assert.equal(gitRuns, afterWrite + GIT_RUNS_PER_REFRESH);
	assert.match(shown(), /\*2/);
	await handlers.get("session_shutdown")!({}, ctx);
});
