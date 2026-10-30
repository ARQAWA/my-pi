import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters as strip } from "node:util";
import { it } from "node:test";
import statusbar from "../../../extensions/RQW-statusbar/index.ts";
import { bindTestHost } from "./footer-host.ts";

it("shows only the current session's background summary with gold animation", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	let clock = 0;
	t.mock.method(performance, "now", () => clock);
	const root = await mkdtemp(join(tmpdir(), "status-bg-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const listeners = new Map<string, Set<(event: unknown) => void>>();
	let command: unknown;
	const pi = {
		events: { on: (name: string, fn: (event: unknown) => void) => { const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set); return () => set.delete(fn); },
			emit: (name: string, event: unknown) => { for (const fn of listeners.get(name) ?? []) fn(event); } },
		getSettings: () => ({}), getSessionName: () => undefined, getThinkingLevel: () => "off",
		registerCommand(_name: string, value: unknown) { command = value; }, on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, fn),
	};
	let id = "one";
	let footer: ((tui: unknown, theme: unknown, data: unknown) => { render(width: number): string[] }) | undefined;
	const ctx = { mode: "tui", cwd: "/work/fixed-folder", model: undefined, isIdle: () => true, getContextUsage: () => undefined,
		sessionManager: { getSessionId: () => id, getLeafId: () => null, getEntryCount: () => 0, getEntries: () => [] },
		ui: { theme: { fg: (_role: string, text: string) => text }, getEditorComponent: () => ({}), setEditorComponent() {},
			setFooter: (fn: typeof footer) => { footer = fn; }, setWorkingIndicator() {}, setWidget() {} } };
	statusbar(pi as never);
	bindTestHost(t, command);
	const emit = (sessionId: string, active: boolean) => pi.events.emit("rqw-context:background-compaction", { sessionId, active });
	emit("one", true);
	await handlers.get("session_start")!({}, ctx);
	let redraws = 0;
	const view = footer!({ requestRender: () => redraws++ }, ctx.ui.theme, { onBranchChange: () => () => {}, getExtensionStatuses: () => new Map() });
	const row = () => view.render(100).at(-1)!;
	assert.match(strip(row()), /fixed-folder  bg compaction/);
	emit("one", false);
	assert.doesNotMatch(strip(row()), /bg compaction/);
	emit("other", true);
	assert.doesNotMatch(strip(row()), /bg compaction/);
	emit("one", true);
	const first = row();
	assert.match(strip(first), /fixed-folder  bg compaction/);
	assert.match(first, /\x1b\[(?:1;)?38;2;255;244;194m/);
	const before = redraws;
	clock = 400; t.mock.timers.tick(400);
	assert.ok(redraws > before);
	assert.notEqual(row(), first);
	emit("one", false);
	assert.doesNotMatch(strip(row()), /bg compaction/);
	const stopped = redraws;
	clock = 1400; t.mock.timers.tick(1000);
	assert.equal(redraws, stopped);
	emit("one", true);
	id = "two";
	assert.doesNotMatch(strip(row()), /bg compaction/);
	id = "one";
	assert.doesNotMatch(strip(row()), /bg compaction/);
	id = "two";
	await handlers.get("session_start")!({}, ctx);
	const second = footer!({ requestRender: () => {} }, ctx.ui.theme, { onBranchChange: () => () => {}, getExtensionStatuses: () => new Map() });
	emit("two", true);
	assert.match(strip(second.render(100).at(-1)!), /bg compaction/);
	await handlers.get("session_shutdown")!({}, ctx);
	assert.equal(listeners.get("rqw-context:background-compaction")?.size, 0);
});
