import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import historyEdit from "../../../extensions/RQW-history-edit/index.ts";

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
	assert.deepEqual(notices, ["дождись сабагентов"]);
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
		const ctx = { mode: "tui", isIdle: () => true, sessionManager: { getBranch: () => [{ type: "message", id: "a", message: { role: "user", content: "hello" } }] },
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
	const ctx = { mode: "tui", isIdle: () => true, sessionManager: { getBranch: () => [{ type: "message", id: "a", message: { role: "user", content: "old" } }] },
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
