import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters as strip } from "node:util";
import { it } from "node:test";
import statusbar from "../../../extensions/RQW-statusbar/index.ts";

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

it("runs git after a write and the poll but not after a read, and shows the new state", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const root = await mkdtemp(join(tmpdir(), "rqw-statusbar-git-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, ".git"));
	// The git process is the boundary: a fake runner answers `status` and `symbolic-ref` and counts the runs.
	let porcelain = "";
	let gitRuns = 0;
	t.mock.method(childProcess, "execFile", (file: string, args: string[], _options: unknown, done: (error: Error | null, stdout: string) => void) => {
		assert.equal(file, "git");
		gitRuns++;
		setImmediate(() => done(null, args.includes("status") ? porcelain : "main\n"));
	});
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(done => setImmediate(done)); };

	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const pi = {
		events: { on: () => () => {}, emit() {} }, getSettings: () => ({}), getSessionName: () => undefined, getThinkingLevel: () => "off",
		registerCommand() {}, on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers.set(name, handler); },
	};
	let footer: ((tui: unknown, theme: unknown, data: unknown) => { render(width: number): string[] }) | undefined;
	const ctx = {
		mode: "tui", cwd: root, model: undefined, isIdle: () => false, getContextUsage: () => undefined,
		sessionManager: { getSessionId: () => "s", getLeafId: () => null, getEntryCount: () => 0, getEntries: () => [] },
		ui: { theme: { fg: (_role: string, text: string) => text }, getEditorComponent: () => ({}), setEditorComponent() {},
			setFooter: (factory: typeof footer) => { footer = factory; }, setWorkingIndicator() {}, setWidget() {} },
	};
	statusbar(pi as never);
	await handlers.get("session_start")!({}, ctx);
	const rows = footer!({ requestRender() {} }, ctx.ui.theme, { onBranchChange: () => () => {}, getExtensionStatuses: () => new Map() });
	const shown = () => rows.render(120).map(strip).join("\n");
	await settle();
	const afterStart = gitRuns;
	assert.ok(afterStart > 0);
	assert.doesNotMatch(shown(), /\*1/);

	// Files change on disk, but a read cannot have changed them: no git run, the shown state stays.
	porcelain = " M a.ts\0";
	for (const toolName of ["read", "grep", "find", "web", "tool_search"]) handlers.get("tool_execution_end")!({ toolCallId: "r", toolName }, ctx);
	await settle();
	assert.equal(gitRuns, afterStart);
	assert.doesNotMatch(shown(), /\*1/);

	// A write runs git and the new state is shown.
	handlers.get("tool_execution_end")!({ toolCallId: "w", toolName: "write" }, ctx);
	await settle();
	assert.ok(gitRuns > afterStart);
	assert.match(shown(), /\*1/);

	// The 10 s poll runs git too and picks up a later change.
	const afterWrite = gitRuns;
	porcelain = " M a.ts\0 M b.ts\0";
	t.mock.timers.tick(10_000);
	await settle();
	assert.ok(gitRuns > afterWrite);
	assert.match(shown(), /\*2/);
	await handlers.get("session_shutdown")!({}, ctx);
});
