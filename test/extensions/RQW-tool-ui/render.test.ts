import assert from "node:assert/strict";
import v8 from "node:v8";
import vm from "node:vm";
import { it } from "node:test";
import { initTheme, InteractiveMode, SessionManager, type SessionEntry, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences } from "@earendil-works/pi-tui";
import toolUi from "../../../extensions/RQW-tool-ui/index.ts";
import { classifyChange } from "../../../extensions/RQW-tool-ui/changes.ts";
import { classify } from "../../../extensions/RQW-tool-ui/classify.ts";
import { buildGroups } from "../../../extensions/RQW-tool-ui/groups.ts";
import { renderLive } from "../../../extensions/RQW-tool-ui/live.ts";
import { collapsedRows, ToolUi } from "../../../extensions/RQW-tool-ui/render.ts";
import { renderSummary } from "../../../extensions/RQW-tool-ui/summary.ts";

const theme = { fg: (_role: string, text: string) => text, bg: (_role: string, text: string) => text } as Theme;
const ok = (text = "", extra: object = {}) => ({ content: [{ type: "text", text }], ...extra });
const call = (id: string, name = "read", args: object = { path: "a.ts" }) => ({ type: "toolCall", id, name, arguments: args });
const assistant = (content: unknown[], stopReason = "toolUse") => ({ role: "assistant", content, stopReason, timestamp: 1 });
const result = (id: string, name = "read", extra: object = {}) => ({
	role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text: "out" }], isError: false, timestamp: 2, ...extra,
});
const entries = (...messages: unknown[]) => messages.map((message, i) => ({
	type: "message", id: `e${i}`, parentId: i ? `e${i - 1}` : null, timestamp: "t", message,
})) as SessionEntry[];

it("classifies calls and nonzero exits", () => {
	assert.equal(classify("read", { path: "a.ts", offset: 3, limit: 2 }, ok(), { toolCallId: "r" }).target, "a.ts L3-4");
	const failed = classify("bash", { command: "false" }, ok("no", { details: { exitCode: 2 } }), { toolCallId: "b" });
	assert.deepEqual([failed.kind, failed.status, failed.exitCode], ["run", "error", 2]);
});

it("classifies confirmed edit and write counts", () => {
	const edit = classifyChange("edit", { path: "a.ts" }, ok("done", { details: { diff: "-1 old\n+1 new\n+2 next" } }));
	assert.deepEqual(edit.files, [{ path: "a.ts", status: "done", countKey: "a.ts", added: 2, removed: 1 }]);
	const write = classifyChange("write", { path: "b.ts", content: "one\ntwo\n" }, ok());
	assert.equal(write.files[0].added, 2);
});

it("renders a summary and the last four live output rows", () => {
	const edit = classifyChange("edit", { path: "a.ts" }, ok("done", { details: { diff: "-1 old\n+1 new" } }));
	const read = classify("read", { path: "b.ts" }, ok(), { toolCallId: "r" });
	assert.equal(renderSummary([edit, read], 80, theme), "Edited 1 file +1 -1 · read 1 file");
	const running = classify("bash", { command: "npm test" }, ok("1\n2\n3\n4\n5\n6"), { toolCallId: "b", isPartial: true });
	assert.deepEqual(renderLive({ ...running, toolName: "bash" }, 80, theme).map((row) => row.trim()),
		["$ npm test", "3", "4", "5", "6", "running"]);
});

it("renders cleaned tail rows", () => {
	const draw = (text: string) => renderLive({ ...classify("bash", { command: "x" }, ok(text), { toolCallId: "b" }), toolName: "bash" }, 80, theme).map((row) => row.trim());
	const rows = draw("old-marker\n\u001b[31mone\u001b[0m\ntwo\rover\nthree\tend\nfour\n \n\u001b[0m\n");
	assert.deepEqual(rows.slice(1, -1), ["one", "over", "three   end", "four"]);
	assert.ok(!rows.some((row) => row.includes("old-marker")));
	assert.deepEqual(draw(" \n\u001b[0m\n").slice(1, -1), []);
});

it("paints live agent cards purple by state and leaves normal tools on theme backgrounds", () => {
	const tagged = { fg: (_role: string, text: string) => text, bg: (role: string, text: string) => `<${role}>${text}` } as Theme;
	const liveRows = (name: string, args: object, res: object | undefined, isError = false, isPartial = false) =>
		renderLive({ ...classify(name, args, res, { toolCallId: "x", isError, isPartial }), toolName: name, durationMs: 300 }, 40, tagged);
	const live = (name: string, args: object, res: object | undefined, isError = false) =>
		liveRows(name, args, res, isError)[0];
	const start = { action: "start" };
	// The purple background covers the whole card: header, output rows and status, in every state.
	const wholeCard = (rows: string[], color: RegExp) => {
		assert.equal(rows.length, 4, "header, two output rows and status");
		// Indent, then the background, then the visible text, then the only reset at the very end.
		rows.forEach((row, i) => {
			const parts = row.match(/^( *)(\x1b\[48;2;[\d;]+m)(.*)(\x1b\[49m)$/);
			assert.ok(parts, `row ${i}: background does not wrap the row text`);
			assert.match(parts[2], color, `row ${i} lacks the card background`);
			assert.ok(parts[3].trim() !== "", `row ${i}: no visible text inside the background`);
			assert.doesNotMatch(parts[3], /\x1b\[(?:49|0)?m/, `row ${i}: background reset before the end of the text`);
		});
		rows.forEach((row, i) => assert.doesNotMatch(row, /<tool/, `row ${i} has a tool background`));
	};
	wholeCard(liveRows("agent", start, ok("o1\no2"), false, true), /\x1b\[48;2;40;32;43m/);
	wholeCard(liveRows("agent", start, ok("o1\no2")), /\x1b\[48;2;33;13;43m/);
	wholeCard(liveRows("agent", { action: "wait", ids: ["agent#1"] }, ok("o1\no2"), true), /\x1b\[48;2;53;28;52m/);
	assert.match(live("agent", start, undefined), /\x1b\[48;2;40;32;43m/);
	assert.match(live("agent", start, ok("agent#1 started")), /\x1b\[48;2;33;13;43m/);
	assert.match(live("agent", { action: "wait", ids: ["agent#1"] }, ok("failed"), true), /\x1b\[48;2;53;28;52m/);
	assert.doesNotMatch(live("agent", start, undefined), /<tool/);
	assert.match(live("read", { path: "a.ts" }, ok("x")), /<toolSuccessBg>/);
});

it("groups calls between answers and folds the live card", () => {
	const log = entries(assistant([call("r")]), result("r", "read", { durationMs: 1000 }));
	const active = buildGroups(log).get("r")!;
	assert.equal(active.active, true);
	assert.deepEqual(collapsedRows(active, 80, theme, "/w").map((row) => row.trim()),
		["Read 1 file", "read a.ts", "out", "✓ 1.0s"]);
	const answered = buildGroups(entries(assistant([call("r")]), result("r"), assistant([{ type: "text", text: "Done" }], "stop"))).get("r")!;
	assert.deepEqual(collapsedRows(answered, 80, theme, "/w"), ["Read 1 file"]);
});

it("shows a tool update after a cached frame", () => {
	const ui = new ToolUi();
	ui.start({ getBranch: () => [], getCwd: () => "/w" } as never);
	ui.messageStart(assistant([call("b", "bash", { command: "echo" })]));
	ui.toolStart({ toolCallId: "b", toolName: "bash", args: { command: "echo" } });
	const renderer = ui.resolve("bash", () => undefined);
	const context = { state: {}, toolCallId: "b", outputPad: 0, invalidate() {}, expanded: false } as never;
	const row = renderer.renderCall!({ command: "echo" } as never, theme, context);
	row.render(80);
	ui.toolUpdate({ toolCallId: "b", partialResult: ok("new output") });
	assert.ok(row.render(80).some((line) => line.includes("new output")));
	ui.shutdown();
});

it("keeps earlier groups and updates the open one after entries are saved", () => {
	const saved = entries(assistant([call("r")]), result("r"), assistant([{ type: "text", text: "Done" }], "stop"));
	let log = saved;
	const ui = new ToolUi();
	ui.start({ getBranch: () => log, getCwd: () => "/w" } as never);
	const draw = (name: string, id: string, args: object, expanded = false) => {
		const context = { state: {}, toolCallId: id, outputPad: 0, invalidate() {}, expanded } as never;
		return ui.resolve(name, () => undefined).renderCall!(args as never, theme, context);
	};
	const first = draw("read", "r", { path: "a.ts" });
	const bash = { command: "echo" };
	const message = { ...assistant([call("b", "bash", bash)]), timestamp: 3 };
	ui.messageStart(message);
	ui.toolStart({ toolCallId: "b", toolName: "bash", args: bash });
	const second = draw("bash", "b", bash);
	assert.deepEqual(first.render(80).map((row) => row.trim()), ["Read 1 file"]);
	assert.ok(second.render(80).some((row) => row.includes("echo")));
	// The call is saved while it runs; its update still shows, and the earlier group stays as it was.
	log = [...saved, ...entries(message).map((e, i) => ({ ...e, id: `s${i}`, parentId: "e2" }))] as SessionEntry[];
	ui.messageEnd(message);
	ui.toolUpdate({ toolCallId: "b", partialResult: ok("new output") });
	assert.ok(second.render(80).some((row) => row.includes("new output")));
	assert.deepEqual(first.render(80).map((row) => row.trim()), ["Read 1 file"]);
	// The result is saved and the answer ends the run: the group folds to its summary.
	const done = result("b", "bash", { timestamp: 4 });
	const answer = { ...assistant([{ type: "text", text: "Ok" }], "stop"), timestamp: 5 };
	log = [...log, ...entries(done, answer).map((e, i) => ({ ...e, id: `t${i}`, parentId: "s0" }))] as SessionEntry[];
	ui.toolEnd({ toolCallId: "b", result: ok("out") });
	ui.messageEnd(done);
	ui.messageEnd(answer);
	ui.agentEnd();
	assert.deepEqual(second.render(80).map((row) => row.trim()), ["Ran 1 command"]);
	assert.deepEqual(first.render(80).map((row) => row.trim()), ["Read 1 file"]);
	ui.shutdown();
});

it("renders an aborted call without inventing a result", () => {
	// Regression for 75ecea60e6851a2ca126cc9afe39c8ab47b088e1.
	const group = buildGroups(entries(assistant([call("b", "bash", { command: "make" })], "aborted"))).get("b")!;
	assert.equal(group.members[0].result, undefined);
	assert.equal(group.members[0].isPartial, false);
	assert.deepEqual(collapsedRows(group, 80, theme, "/w").map((row) => row.trim()), ["Ran 1 command", "$ make", "aborted"]);
});

it("keeps a failed codemode parent visible beside a nested success", () => {
	// Regression for 1633d508ea19ffbd1f500559b9b55894f1cb364a.
	const final = result("p", "codemode", {
		content: [{ type: "text", text: "Error: SCRIPT_BROKE" }], isError: true, durationMs: 1200,
		nestedCalls: { complete: true, calls: [{ id: "p/1", name: "read", arguments: { path: "a.ts" }, status: "ok" }] },
	});
	const group = buildGroups(entries(assistant([call("p", "codemode", { code: "throw" })]), final)).get("p")!;
	assert.deepEqual(collapsedRows(group, 80, theme, "/w").map((row) => row.trim()),
		["Read 1 file · 1 failed", "codemode throw", "Error: SCRIPT_BROKE", "✗ error · 1.2s"]);
});

function renderSession(manager: SessionManager, wholeBranch: boolean): string[] {
	initTheme();
	const handlers = new Map<string, (...args: any[]) => void>();
	let resolveToolRenderers: any;
	toolUi({
		registerToolRenderer: (resolver: unknown) => { resolveToolRenderers = resolver; },
		on: (name: string, handler: (...args: any[]) => void) => handlers.set(name, handler),
	} as never);
	const host: any = Object.create(InteractiveMode.prototype);
	try {
		Object.assign(host, {
			chatContainer: new Container(), pendingTools: new Map(), outputPad: 1,
			toolOutputExpanded: false, hideThinkingBlock: false, hiddenThinkingLabel: "Thinking...",
			ui: { requestRender() {} },
			runtimeHost: { session: {
				resourceLoader: { getExtensions: () => ({ runtime: manager, extensions: [{ toolRenderers: [resolveToolRenderers] }] }) },
				sessionManager: manager,
				settingsManager: { getShowCacheMissNotices: () => false, getShowImages: () => false, getImageWidthCells: () => 60, getCodeBlockIndent: () => "  " },
				modelRuntime: {}, retryAttempt: 0,
				extensionRunner: { getMessageRenderer: () => undefined, getMarkdownTransformers: () => [], resolveToolRenderers },
				getToolDefinition: () => undefined,
			} },
		});
		host.renderSessionEntries(wholeBranch ? manager.getBranch() : manager.buildContextEntries());
		return host.chatContainer.render(80).map(stripTerminalSequences).map((line: string) => line.trim());
	} finally { handlers.get("session_shutdown")!(); try { host.stop("none"); } catch {} }
}

it("keeps the compact view for calls before a compaction", () => {
	const manager = SessionManager.inMemory("/w");
	const first = manager.appendMessage({ role: "user", content: "go", timestamp: 1 } as never);
	manager.appendMessage(assistant([call("old")]) as never);
	manager.appendMessage(result("old") as never);
	manager.appendMessage(assistant([{ type: "text", text: "Done" }], "stop") as never);
	const kept = manager.appendMessage({ role: "user", content: "more", timestamp: 3 } as never);
	manager.appendMessage(assistant([call("new")]) as never);
	manager.appendMessage(result("new") as never);
	manager.appendCompaction("summary", kept, 1000);
	assert.ok(first && manager.buildContextEntries().every((e) => e.id !== first));
	const lines = renderSession(manager, true);
	const oldPrompt = lines.indexOf("go");
	const answer = lines.indexOf("Done");
	assert.ok(oldPrompt >= 0 && answer > oldPrompt);
	assert.deepEqual(lines.slice(oldPrompt + 1, answer).filter(Boolean), ["Read 1 file"]);
});

it("counts only visible calls when compaction keeps part of a tool run", () => {
	const manager = SessionManager.inMemory("/w");
	manager.appendMessage({ role: "user", content: "go", timestamp: 0 } as never);
	manager.appendMessage({ ...assistant([call("hidden")]), timestamp: 1 } as never);
	manager.appendMessage(result("hidden", "read", { isError: true, timestamp: 2 }) as never);
	const kept = manager.appendMessage({ ...assistant([call("kept", "read", { path: "visible.ts" })]), timestamp: 3 } as never);
	manager.appendMessage(result("kept", "read", { timestamp: 4 }) as never);
	manager.appendMessage({ ...assistant([{ type: "text", text: "Done" }], "stop"), timestamp: 5 } as never);
	manager.appendCompaction("summary", kept, 1000);
	const lines = renderSession(manager, false).filter(Boolean);
	assert.ok(lines.includes("Read 1 file"));
	assert.ok(!lines.some((line) => /failed|Read 2 files/.test(line)));
});

it("does not join a tool run across an older compaction's kept-range start", () => {
	const manager = SessionManager.inMemory("/w");
	manager.appendMessage({ role: "user", content: "go", timestamp: 0 } as never);
	manager.appendMessage({ ...assistant([call("a", "read", { path: "a.ts" })]), timestamp: 1 } as never);
	manager.appendMessage(result("a", "read", { timestamp: 2 }) as never);
	const cut = manager.appendMessage({ ...assistant([call("b", "read", { path: "b.ts" })]), timestamp: 3 } as never);
	manager.appendMessage(result("b", "read", { timestamp: 4 }) as never);
	manager.appendMessage({ ...assistant([{ type: "text", text: "Done" }], "stop"), timestamp: 5 } as never);
	manager.appendCompaction("first", cut, 1000);
	const next = manager.appendMessage({ role: "user", content: "next", timestamp: 6 } as never);
	manager.appendMessage({ ...assistant([{ type: "text", text: "Ok" }], "stop"), timestamp: 7 } as never);
	manager.appendCompaction("second", next, 2000);
	const lines = renderSession(manager, true).filter(Boolean);
	assert.equal(lines.filter((line) => line === "Read 1 file").length, 2);
	assert.ok(!lines.includes("Read 2 files"));
});

it("lets a tool component that Pi no longer draws be collected", async () => {
	initTheme();
	const manager = SessionManager.inMemory("/w");
	manager.appendMessage({ role: "user", content: "go", timestamp: 0 } as never);
	manager.appendMessage({ ...assistant([call("a", "read", { path: "a.ts" })]), timestamp: 1 } as never);
	manager.appendMessage(result("a", "read", { timestamp: 2 }) as never);
	manager.appendMessage({ ...assistant([{ type: "text", text: "Done" }], "stop"), timestamp: 3 } as never);
	const handlers = new Map<string, (...args: any[]) => void>();
	let resolveToolRenderers: any;
	toolUi({
		registerToolRenderer: (resolver: unknown) => { resolveToolRenderers = resolver; },
		on: (name: string, handler: (...args: any[]) => void) => handlers.set(name, handler),
	} as never);
	const host: any = Object.create(InteractiveMode.prototype);
	try {
		Object.assign(host, {
			chatContainer: new Container(), pendingTools: new Map(), outputPad: 1,
			toolOutputExpanded: false, hideThinkingBlock: false, hiddenThinkingLabel: "Thinking...",
			ui: { requestRender() {} },
			runtimeHost: { session: {
				resourceLoader: { getExtensions: () => ({ runtime: manager, extensions: [{ toolRenderers: [resolveToolRenderers] }] }) },
				sessionManager: manager,
				settingsManager: { getShowCacheMissNotices: () => false, getShowImages: () => false, getImageWidthCells: () => 60, getCodeBlockIndent: () => "  " },
				modelRuntime: {}, retryAttempt: 0,
				extensionRunner: { getMessageRenderer: () => undefined, getMarkdownTransformers: () => [], resolveToolRenderers },
				getToolDefinition: () => undefined,
			} },
		});
		// A WeakRef keeps its target to the end of the current job, so it is made in a helper and read after a later turn.
		const drawn = () => {
			host.renderSessionEntries(manager.getBranch());
			host.chatContainer.render(80);
			const component = host.chatContainer.children.find((child: object) => child.constructor.name === "ToolExecutionComponent");
			assert.ok(component, "the tool call is drawn");
			// What Pi's own removal of unloaded history leaves: no child, no cached layout.
			host.chatContainer.children.splice(0);
			host.chatContainer.mouseLayout = undefined;
			return new WeakRef(component as object);
		};
		const ref = drawn();
		await new Promise((resolve) => setImmediate(resolve));
		v8.setFlagsFromString("--expose-gc");
		(vm.runInNewContext("gc") as () => void)();
		assert.equal(ref.deref(), undefined);
	} finally { handlers.get("session_shutdown")!(); try { host.stop("none"); } catch {} }
});

it("still redraws a visible row after a collection, with the callback Pi gave the result", async () => {
	initTheme();
	const manager = SessionManager.inMemory("/w");
	manager.appendMessage({ role: "user", content: "go", timestamp: 0 } as never);
	manager.appendMessage({ ...assistant([call("a", "read", { path: "a.ts" })]), timestamp: 1 } as never);
	manager.appendMessage(result("a", "read", { timestamp: 2 }) as never);
	const ui = new ToolUi();
	ui.start(manager);
	try {
		const real = (globalThis as Record<symbol, unknown>)[Symbol.for("@earendil-works/pi-coding-agent:theme")] as Theme;
		const renderers = ui.resolve("read", () => undefined);
		// What a component keeps for its row: the shared state. Pi gives renderCall and renderResult different callbacks.
		const state = {};
		let redrawn = 0;
		const context = (invalidate: () => void) => ({ toolCallId: "a", state, invalidate, expanded: false, executionStarted: true, argsComplete: true, isPartial: false, cwd: "/w", args: { path: "a.ts" } }) as never;
		renderers.renderCall!({ path: "a.ts" }, real, context(() => { throw new Error("the call's callback is not the live one"); }));
		renderers.renderResult!({ content: [{ type: "text", text: "out" }] } as never, { expanded: false, isPartial: false } as never, real, context(() => { redrawn++; }));
		await new Promise((resolve) => setImmediate(resolve));
		v8.setFlagsFromString("--expose-gc");
		(vm.runInNewContext("gc") as () => void)();
		// A second consecutive call changes the first row's summary: the row must be asked to redraw.
		manager.appendMessage({ ...assistant([call("b", "read", { path: "b.ts" })]), timestamp: 3 } as never);
		manager.appendMessage(result("b", "read", { timestamp: 4 }) as never);
		ui.entriesChanged();
		assert.equal(redrawn > 0, true, "the live row was redrawn");
		assert.ok(state, "the component's state stays alive up to here");
	} finally { ui.shutdown(); }
});
