import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters as strip } from "node:util";
import { it } from "node:test";
import statusbar from "../../../extensions/RQW-statusbar/index.ts";
import { bindTestHost } from "./footer-host.ts";

it("shows prediction activity beside background compaction and restores it on enable", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
	let clock = 0;
	t.mock.method(performance, "now", () => clock);
	const root = await mkdtemp(join(tmpdir(), "status-prediction-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const listeners = new Map<string, Set<(event: any) => void>>();
	let command: any;
	const pi = {
		events: { on: (name: string, fn: (event: any) => void) => { const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set); return () => set.delete(fn); },
			emit: (name: string, event: any) => { for (const fn of listeners.get(name) ?? []) fn(event); } },
		getSettings: () => ({}), getSessionName: () => undefined, getThinkingLevel: () => "off",
		registerCommand(_name: string, value: unknown) { command = value; }, on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, fn),
	};
	let id = "one";
	let footer: ((tui: unknown, theme: unknown, data: unknown) => { render(width: number): string[] }) | undefined;
	const theme = { fg: (_role: string, text: string) => text, colors: { toolErrorBg: "#351c22" }, style: (text: string, _style: unknown) => `\x1b[38;2;53;28;34m${text}\x1b[39m` };
	const ctx = { mode: "tui", cwd: "/work/fixed-folder", model: undefined, isIdle: () => true, getContextUsage: () => undefined,
		sessionManager: { getSessionId: () => id, getLeafId: () => null, getEntryCount: () => 0, getEntries: () => [] },
		ui: { theme, getEditorComponent: () => ({}), setEditorComponent() {}, setFooter: (fn: typeof footer) => { footer = fn; }, setWorkingIndicator() {}, setWidget() {} } };
	statusbar(pi as never);
	bindTestHost(t, command);
	let current: { sessionId: string; state: string; abortedUntil?: number } = { sessionId: "one", state: "brewing" };
	pi.events.on("rqw-predictions:activity-query", (query) => query.offer(current));
	await handlers.get("session_start")!({}, ctx);
	let redraws = 0;
	const makeView = () => footer!({ requestRender: () => redraws++ }, theme, { onBranchChange: () => () => {}, getExtensionStatuses: () => new Map() });
	let view = makeView();
	const row = (width = 100) => view.render(width).at(-1)!;
	assert.match(strip(row()), /fixed-folder  prediction/);
	const first = row();
	clock = 400; t.mock.timers.tick(400);
	assert.ok(redraws > 0);
	assert.notEqual(row(), first);
	pi.events.emit("rqw-context:background-compaction", { sessionId: "one", active: true });
	assert.match(strip(row()), /fixed-folder  bg compaction  prediction/);
	const brewing = view.render(20).find((line) => strip(line).includes("prediction"));
	assert.ok(brewing);
	clock += 400; t.mock.timers.tick(400);
	const nextBrewing = view.render(20).find((line) => strip(line).includes("prediction"));
	assert.ok(nextBrewing);
	assert.notEqual(nextBrewing, brewing);
	current = { sessionId: "one", state: "aborted", abortedUntil: clock + 2000 };
	pi.events.emit("rqw-predictions:activity", current);
	assert.match(strip(row()), /bg compaction  prediction aborted/);
	assert.match(row(), /\x1b\[38;2;53;28;34mprediction aborted/);
	const narrow = view.render(39).map(strip);
	assert.match(narrow.at(-1)!, /bg compaction  prediction aborted/);
	const tiny = view.render(20);
	assert.ok(tiny.some((line) => strip(line).includes("bg compaction")));
	assert.ok(tiny.some((line) => strip(line).includes("prediction aborted") && line.includes("\x1b[38;2;53;28;34m")));
	assert.ok(tiny.every((line) => strip(line).length <= 20));
	clock += 1999; t.mock.timers.tick(1999);
	assert.match(strip(row()), /prediction aborted/);
	current = { sessionId: "one", state: "idle" };
	clock++; t.mock.timers.tick(1);
	assert.doesNotMatch(strip(row()), /prediction/);
	pi.events.emit("rqw-predictions:activity", current);
	assert.doesNotMatch(strip(row()), /prediction/);
	pi.events.emit("rqw-predictions:activity", { sessionId: "other", state: "brewing" });
	assert.doesNotMatch(strip(row()), /prediction/);
	current = { sessionId: "one", state: "brewing" };
	await command.handler("off", ctx);
	await command.handler("on", ctx);
	view = makeView();
	assert.match(strip(row()), /prediction/);
	id = "two";
	assert.doesNotMatch(strip(row()), /prediction/);
	await handlers.get("session_shutdown")!({}, ctx);
	assert.equal(listeners.get("rqw-predictions:activity")?.size, 0);
});
