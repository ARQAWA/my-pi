import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme, SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import historyEdit from "../../../extensions/RQW-history-edit/index.ts";
import { uninstallSafeProjection } from "../../../extensions/RQW-history-edit/projection.ts";

// The extension patches SessionManager.prototype when it loads; every test puts Pi's methods back.
afterEach(() => uninstallSafeProjection(SessionManager.prototype as never));

it("refuses history editing while a child runs", async () => {
	const handlers = new Map<string, any>();
	let command: any;
	const notices: string[] = [];
	historyEdit({
		on: (name: string, handler: any) => handlers.set(name, handler),
		events: { on() {}, emit(_name: string, request: any) { request.reply({ version: 1, snapshot: () => ({ agents: 1, reviews: 0 }) }); } },
		registerCommand(_name: string, options: any) { command = options.handler; },
	} as unknown as ExtensionAPI);
	handlers.get("session_start")!({}, { mode: "print" });
	await command("", { ui: { notify: (message: string) => notices.push(message) } });
	assert.deepEqual(notices, ["Wait for subagents to finish."]);
});

it("double escape opens the current branch selector", async () => {
	const handlers = new Map<string, any>();
	let command: any;
	let input: any;
	let requested = "";
	let opened = false;
	const previousNow = Date.now;
	let now = 1000;
	Date.now = () => now;
	try {
		historyEdit({ on: (name: string, handler: any) => handlers.set(name, handler),
			events: { on() {}, emit() {} }, registerCommand(_name: string, options: any) { command = options.handler; },
			sendUserMessage: (text: string) => { requested = text; } } as unknown as ExtensionAPI);
		const ctx = { mode: "tui", isIdle: () => true, sessionManager: { getSessionFile: () => import.meta.filename, getBranch: () => [{ type: "message", id: "a", message: { role: "user", content: "hello" } }] },
			ui: { setWidget: (_key: string, factory: any) => factory?.({ getFocusedComponent: () => ({ actionHandlers: new Map() }) }),
				onTerminalInput: (handler: any) => { input = handler; return () => {}; }, getEditorText: () => "",
				custom: async () => { opened = true; return undefined; } } };
		handlers.get("session_start")!({}, ctx);
		assert.equal(input("\x1b"), undefined);
		now += 100;
		assert.deepEqual(input("\x1b"), { consume: true });
		assert.equal(requested, "/edit-history");
		await command("", ctx);
		assert.equal(opened, true);
		now += 100;
		assert.deepEqual(input("\x1b"), { consume: true });
		assert.equal(requested, "/edit-history");
	} finally { Date.now = previousNow; }
});

it("escape restores the draft, and enter intercepts slash text", async () => {
	const handlers = new Map<string, any>();
	let command: any;
	let input: any;
	let text = "draft";
	let selected = true;
	const sent: string[] = [];
	historyEdit({ on: (name: string, handler: any) => handlers.set(name, handler),
		events: { on() {}, emit() {} }, registerCommand(_name: string, options: any) { command = options.handler; },
		sendUserMessage: (message: string) => sent.push(message) } as unknown as ExtensionAPI);
	const ctx = { mode: "tui", isIdle: () => true, sessionManager: { getSessionFile: () => import.meta.filename, getBranch: () => [{ type: "message", id: "a", message: { role: "user", content: "old" } }] },
		ui: { setWidget: (_key: string, factory: any) => factory?.({ getFocusedComponent: () => ({ actionHandlers: new Map() }) }),
			onTerminalInput: (handler: any) => { input = handler; return () => {}; }, getEditorText: () => text,
			setEditorText: (value: string) => { text = value; }, notify() {},
			custom: async () => selected ? "a" : undefined } };
	handlers.get("session_start")!({}, ctx);
	await command("", ctx);
	assert.equal(text, "old");
	selected = false;
	assert.deepEqual(input("\x1b"), { consume: true });
	await Promise.resolve();
	assert.equal(text, "draft");
	selected = true;
	await command("", ctx);
	text = "/text";
	assert.deepEqual(input("\r"), { consume: true });
	await Promise.resolve();
	assert.deepEqual(sent, ["/edit-history"]);
});

it("stops at both ends of the message list", async () => {
	initTheme();
	let command: any;
	let editor = "";
	let keys: string[] = [];
	historyEdit({ on() {}, events: { on() {}, emit() {} },
		registerCommand: (_name: string, options: any) => { command = options.handler; } } as unknown as ExtensionAPI);
	const ctx = { mode: "tui", sessionManager: { getSessionFile: () => import.meta.filename, getBranch: () => ["first", "middle", "last"].map(id =>
		({ type: "message", id, message: { role: "user", content: id } })) },
		ui: { getEditorText: () => editor, setEditorText: (value: string) => { editor = value; }, notify() {},
			custom: async (factory: any) => {
				let result: string | undefined;
				const bindings = { matches: (key: string, action: string) => key === ({ "tui.select.up": "\x1b[A", "tui.select.down": "\x1b[B" } as Record<string, string>)[action] };
				const list = factory({}, {}, bindings, (id: string) => { result = id; });
				for (const key of keys) list.handleInput(key);
				list.handleInput("\r");
				return result;
			} } };
	keys = Array(5).fill("\x1b[B");
	await command("", ctx);
	assert.equal(editor, "last");
	keys = Array(5).fill("\x1b[A");
	await command("", ctx);
	assert.equal(editor, "first");
});

it("sends plain text and the selected and new images", async () => {
	const dir = mkdtempSync(join(tmpdir(), "history-input-"));
	try {
		const path = join(dir, "session.jsonl");
		writeFileSync(path, "old\n");
		const original = { type: "image", data: "b2xk", mimeType: "image/png" };
		const added = { type: "image", data: "bmV3", mimeType: "image/png" };
		let branch: any[] = [{ type: "message", id: "a", parentId: null, message: { role: "user", content: [{ type: "text", text: "old" }, original] } }];
		const entries = branch.slice();
		const handlers = new Map<string, any>();
		let command: any;
		let sent: unknown;
		let editor = "";
		const pi = { on: (name: string, handler: any) => handlers.set(name, handler), events: { on() {}, emit() {} },
			registerCommand: (_name: string, options: any) => { command = options.handler; }, sendUserMessage() {},
			appendEntry: (customType: string, data: unknown) => { const entry = { type: "custom", id: `n${entries.length}`, parentId: branch.at(-1)?.id ?? null, customType, data }; entries.push(entry); branch.push(entry); } } as unknown as ExtensionAPI;
		historyEdit(pi);
		const manager = { getSessionFile: () => path, getBranch: () => branch.slice(), getEntries: () => entries.slice(), getLeafId: () => branch.at(-1)?.id ?? null,
			getLabel: () => undefined, getSessionName: () => undefined, getHeader: () => ({ type: "session", id: "s" }) };
		const ui = { getEditorText: () => editor, setEditorText: (value: string) => { editor = value; }, notify() {}, custom: async () => "a",
			setWidget: (_key: string, factory: any) => factory?.({ getFocusedComponent: () => ({ actionHandlers: new Map() }) }), onTerminalInput: () => () => {} };
		const ctx = { mode: "tui", isIdle: () => true, sessionManager: manager, ui,
			navigateTree: async () => { branch = []; return { cancelled: false }; },
			switchSession: async (_path: string, options: any) => { await options.withSession({ ui, sendUserMessage: async (value: unknown) => { sent = value; } }); return { cancelled: false }; } };
		handlers.get("session_start")!({}, ctx);
		await command("", ctx);
		assert.deepEqual(handlers.get("input")!({ source: "interactive", text: "edited", images: [added] }), { action: "handled" });
		await command("", ctx);
		assert.deepEqual(sent, [{ type: "text", text: "edited" }, original, added]);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

/** RQW-tools offers background processes on the counts channel without a `reviews` field. */
function withBackground(snapshot: { agents?: number; backgroundProcesses?: number }) {
	const handlers = new Map<string, any>();
	let command: any;
	let input: any;
	let requested = "";
	const notices: string[] = [];
	historyEdit({ on: (name: string, handler: any) => handlers.set(name, handler),
		events: { on() {}, emit(_name: string, request: any) { request.reply({ version: 1, snapshot: () => snapshot }); } },
		registerCommand(_name: string, options: any) { command = options.handler; },
		sendUserMessage: (text: string) => { requested = text; } } as unknown as ExtensionAPI);
	const ctx = { mode: "tui", isIdle: () => true, sessionManager: { getBranch: () => [] },
		ui: { setWidget: (_key: string, factory: any) => factory?.({ getFocusedComponent: () => ({ actionHandlers: new Map() }) }),
			onTerminalInput: (handler: any) => { input = handler; return () => {}; }, getEditorText: () => "", setEditorText() {},
			notify: (message: string) => notices.push(message) } };
	handlers.get("session_start")!({}, ctx);
	return { press: () => input("\x1b"), command: () => command("", ctx), requested: () => requested, notices };
}

it("double escape does not open the history while a background process runs", async () => {
	const previousNow = Date.now;
	let now = 1000;
	Date.now = () => now;
	try {
		const h = withBackground({ agents: 0, backgroundProcesses: 1 });
		assert.equal(h.press(), undefined);
		now += 100;
		assert.equal(h.press(), undefined);
		assert.equal(h.requested(), "");
		await h.command();
		assert.deepEqual(h.notices, ["Wait for background processes to finish."]);
	} finally { Date.now = previousNow; }
});

it("blocks both entrances during this session's background compaction", async () => {
	const handlers = new Map<string, any>();
	const events = new Map<string, any>();
	let command: any;
	let input: any;
	let requested = "";
	const notices: string[] = [];
	let opened = 0;
	let editor = "";
	const previousNow = Date.now;
	let now = 1000;
	Date.now = () => now;
	try {
		historyEdit({ on: (name: string, handler: any) => handlers.set(name, handler),
			events: { on: (name: string, handler: any) => events.set(name, handler), emit() {} },
			registerCommand: (_name: string, options: any) => { command = options.handler; },
			sendUserMessage: (text: string) => { requested = text; } } as unknown as ExtensionAPI);
		const ctx = { mode: "tui", isIdle: () => true, sessionManager: { getSessionFile: () => import.meta.filename, getSessionId: () => "one", getBranch: () => [
			{ type: "message", id: "a", message: { role: "user", content: "hello" } },
		] }, ui: { setWidget: (_key: string, factory: any) => factory?.({ getFocusedComponent: () => ({ actionHandlers: new Map() }) }),
			onTerminalInput: (handler: any) => { input = handler; return () => {}; }, getEditorText: () => editor,
			setEditorText: (text: string) => { editor = text; },
			notify: (message: string) => notices.push(message), custom: async () => { opened++; return "a"; } } };
		handlers.get("session_start")!({}, ctx);
		const activity = events.get("rqw-context:background-compaction")!;
		activity({ sessionId: "one", active: true });
		input("\x1b"); now += 100; input("\x1b");
		assert.equal(requested, "");
		await command("", ctx);
		assert.deepEqual(notices, ["Wait for background processes to finish."]);
		activity({ sessionId: "other", active: false });
		await command("", ctx);
		assert.equal(opened, 0);
		activity({ sessionId: "one", active: false });
		await command("", ctx);
		assert.equal(opened, 1);
		activity({ sessionId: "one", active: true });
		input("\x1b");
		assert.equal(opened, 1);
		assert.equal(editor, "");
		const next = { ...ctx, sessionManager: { ...ctx.sessionManager, getSessionId: () => "two" } };
		handlers.get("session_start")!({}, next);
		await command("", next);
		assert.equal(opened, 2);
	} finally { Date.now = previousNow; }
});

it("double escape still opens the history when the counts are all zero", () => {
	const previousNow = Date.now;
	let now = 1000;
	Date.now = () => now;
	try {
		const h = withBackground({ agents: 0, backgroundProcesses: 0 });
		assert.equal(h.press(), undefined);
		now += 100;
		assert.deepEqual(h.press(), { consume: true });
		assert.equal(h.requested(), "/edit-history");
	} finally { Date.now = previousNow; }
});

it("refuses both entrances without a session file and keeps the draft", async () => {
	const previousNow = Date.now;
	let now = 1000;
	Date.now = () => now;
	try {
		for (const file of [undefined, join(tmpdir(), "history-edit-missing-session.jsonl")]) {
			const handlers = new Map<string, any>();
			let command: any;
			let input: any;
			let requested = "";
			let editor = "draft";
			let opened = 0;
			const notices: string[] = [];
			historyEdit({ on: (name: string, handler: any) => handlers.set(name, handler), events: { on() {}, emit() {} },
				registerCommand: (_name: string, options: any) => { command = options.handler; },
				sendUserMessage: (text: string) => { requested = text; } } as unknown as ExtensionAPI);
			const ctx = { mode: "tui", isIdle: () => true, sessionManager: { getSessionFile: () => file, getBranch: () => [{ type: "message", id: "a", message: { role: "user", content: "old" } }] },
				ui: { setWidget: (_key: string, factory: any) => factory?.({ getFocusedComponent: () => ({ actionHandlers: new Map() }) }),
					onTerminalInput: (handler: any) => { input = handler; return () => {}; },
					getEditorText: () => editor, setEditorText: (value: string) => { editor = value; },
					notify: (message: string) => notices.push(message), custom: async () => { opened++; return "a"; } } };
			handlers.get("session_start")!({}, ctx);
			// The gesture requests the command, which Pi then runs; the typed command is the second entrance.
			editor = "";
			input("\x1b");
			now += 100;
			input("\x1b");
			assert.equal(requested, "/edit-history");
			await command("", ctx);
			editor = "draft";
			await command("", ctx);
			assert.deepEqual(notices, Array(2).fill("No session file. Open a saved session first."));
			assert.equal(opened, 0);
			assert.equal(editor, "draft");
			now += 1000;
		}
	} finally { Date.now = previousNow; }
});

it("keeps the old file and the draft in the editor when sending the edit fails", async () => {
	const dir = mkdtempSync(join(tmpdir(), "history-draft-"));
	try {
		const path = join(dir, "session.jsonl");
		writeFileSync(path, "old\n");
		let branch: any[] = [{ type: "message", id: "a", parentId: null, message: { role: "user", content: "old" } }];
		const entries = branch.slice();
		const handlers = new Map<string, any>();
		let command: any;
		let editor = "";
		const pi = { on: (name: string, handler: any) => handlers.set(name, handler), events: { on() {}, emit() {} },
			registerCommand: (_name: string, options: any) => { command = options.handler; }, sendUserMessage() {},
			appendEntry: (customType: string, data: unknown) => { const entry = { type: "custom", id: `n${entries.length}`, parentId: branch.at(-1)?.id ?? null, customType, data }; entries.push(entry); branch.push(entry); } } as unknown as ExtensionAPI;
		historyEdit(pi);
		const manager = { getSessionFile: () => path, getBranch: () => branch.slice(), getEntries: () => entries.slice(), getLeafId: () => branch.at(-1)?.id ?? null,
			getLabel: () => undefined, getSessionName: () => undefined, getHeader: () => ({ type: "session", id: "s" }) };
		const ui = { getEditorText: () => editor, setEditorText: (value: string) => { editor = value; }, notify() {}, custom: async () => "a",
			setWidget: (_key: string, factory: any) => factory?.({ getFocusedComponent: () => ({ actionHandlers: new Map() }) }), onTerminalInput: () => () => {} };
		const navigateTree = async (id: string) => { branch = id === "a" ? [] : entries.slice(); return { cancelled: false }; };
		const reopened: any = { ui, navigateTree, sessionManager: { getEntries: () => [], getBranch: () => branch.slice() },
			switchSession: async (_path: string, options: any) => { await options.withSession(reopened); return { cancelled: false }; },
			sendUserMessage: async () => { throw new Error("no model"); } };
		const ctx = { mode: "tui", isIdle: () => true, sessionManager: manager, ui, navigateTree,
			switchSession: async (_path: string, options: any) => { await options.withSession(reopened); return { cancelled: false }; } };
		handlers.get("session_start")!({}, ctx);
		await command("", ctx);
		assert.equal(editor, "old");
		assert.deepEqual(handlers.get("input")!({ source: "interactive", text: "edited" }), { action: "handled" });
		await command("", ctx);
		assert.equal(readFileSync(path, "utf8"), "old\n");
		assert.equal(editor, "edited");
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
