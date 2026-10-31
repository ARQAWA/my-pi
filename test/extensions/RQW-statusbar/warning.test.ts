import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters as strip } from "node:util";
import { it } from "node:test";
import statusbar from "../../../extensions/RQW-statusbar/index.ts";
import { bindTestHost } from "./footer-host.ts";

it("shows a session warning whole before cmp, replaces it and clears it on timeout or switch", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	const root = mkdtempSync(join(tmpdir(), "status-warning-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(root, { recursive: true, force: true }); });
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
	let sessionReads = 0;
	let footer: ((tui: unknown, theme: unknown, data: unknown) => { render(width: number): string[] }) | undefined;
	const theme = { fg: (role: string, text: string) => role === "warning" ? `\x1b[33m${text}\x1b[39m` : text };
	const ctx = { mode: "tui", cwd: "/work/fixed-folder", model: undefined, isIdle: () => true, getContextUsage: () => undefined,
		sessionManager: { getSessionId: () => { sessionReads++; return id; }, getLeafId: () => null, getEntryCount: () => 0, getEntries: () => [] },
		ui: { theme, getEditorComponent: () => ({}), setEditorComponent() {}, setFooter: (fn: typeof footer) => { footer = fn; }, setWorkingIndicator() {}, setWidget() {} } };
	statusbar(pi as never);
	bindTestHost(t, command);
	await handlers.get("session_start")!({}, ctx);
	let redraws = 0;
	const view = footer!({ requestRender: () => redraws++ }, theme, { onBranchChange: () => () => {}, getExtensionStatuses: () => new Map() });
	const row = (width = 80) => view.render(width)[1];
	const emit = (sessionId: string, text: string) => pi.events.emit("rqw:background-warning:v1", { sessionId, text });
	emit("other", "not ours");
	assert.doesNotMatch(strip(row()), /not ours/);
	row();
	const beforeIdle = sessionReads;
	row();
	const idleReads = sessionReads - beforeIdle;
	emit("one", "anthropic: no retry");
	assert.match(row(), /\x1b\[33manthropic: no retry\x1b\[39m  cmp 0$/);
	const beforeWarning = sessionReads;
	row();
	assert.equal(sessionReads - beforeWarning, idleReads, "a warning adds no session lookup per render");
	assert.doesNotMatch(strip(row(30)), /anthropic|retry/);
	t.mock.timers.tick(2000);
	emit("one", "new warning");
	t.mock.timers.tick(1000);
	assert.match(strip(row()), /new warning  cmp 0$/);
	t.mock.timers.tick(2000);
	assert.doesNotMatch(strip(row()), /warning/);
	emit("one", "gone on switch");
	id = "two";
	emit("two", "new session");
	assert.match(strip(row()), /new session  cmp 0$/);
	id = "one";
	assert.doesNotMatch(strip(row()), /gone on switch|new session/);
	emit("one", "gone on shutdown");
	await handlers.get("session_shutdown")!({}, ctx);
	const before = redraws;
	t.mock.timers.tick(3000);
	assert.equal(redraws, before);
	assert.equal(listeners.get("rqw:background-warning:v1")?.size, 0);
});
