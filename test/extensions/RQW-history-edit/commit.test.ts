import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { commitEdit } from "../../../extensions/RQW-history-edit/commit.ts";

it("cuts a leaf and sends the edited message after reopening", async () => {
	const dir = mkdtempSync(join(tmpdir(), "history-commit-"));
	try {
		const path = join(dir, "session.jsonl");
		writeFileSync(path, "old\n");
		let branch: any[] = [
			{ type: "message", id: "first", parentId: null, message: { role: "user", content: "first" } },
			{ type: "message", id: "u", parentId: "first", message: { role: "user", content: "old" } },
			{ type: "message", id: "later", parentId: "u", message: { role: "user", content: "later" } },
		];
		const entries = branch.slice();
		const append = (entry: any) => { const next = { ...entry, id: `n${entries.length}`, parentId: branch.at(-1)?.id ?? null }; entries.push(next); branch.push(next); };
		const pi = { appendEntry: (customType: string, data: unknown) => append({ type: "custom", customType, data }) } as unknown as ExtensionAPI;
		let sent: unknown;
		const manager = { getSessionFile: () => path, getBranch: () => branch.slice(), getEntries: () => entries.slice(),
			getLeafId: () => branch.at(-1)?.id ?? null, getLabel: () => undefined, getSessionName: () => undefined,
			getHeader: () => ({ type: "session", id: "s" }) };
		const ctx = { isIdle: () => true, sessionManager: manager, ui: { notify: () => assert.fail("unexpected notice") },
			navigateTree: async (id: string) => { branch = branch.slice(0, branch.findIndex(entry => entry.id === id)); return { cancelled: false }; },
			switchSession: async (selected: string, options: any) => { assert.equal(selected, path); await options.withSession({ ui: { setEditorText() {} }, sendUserMessage: async (text: unknown) => { sent = text; } }); return { cancelled: false }; } } as unknown as ExtensionCommandContext;
		await commitEdit(pi, ctx, "u", "/text");
		assert.equal(sent, "/text");
		const file = readFileSync(path, "utf8");
		assert.ok(file.includes('"id":"first"'));
		assert.ok(!file.includes('"id":"u"'));
		assert.ok(!file.includes('"id":"later"'));
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

it("restores the original file when switching is cancelled", async () => {
	const dir = mkdtempSync(join(tmpdir(), "history-cancel-"));
	try {
		const path = join(dir, "session.jsonl");
		const original = Buffer.from("original\n\u0000bytes\n");
		writeFileSync(path, original);
		let branch: any[] = [
			{ type: "message", id: "u", parentId: null, message: { role: "user", content: "old" } },
			{ type: "message", id: "v", parentId: "u", message: { role: "user", content: "later" } },
		];
		const entries = branch.slice();
		const append = (customType: string, data: unknown) => { const entry = { type: "custom", id: `n${entries.length}`, parentId: branch.at(-1)?.id ?? null, customType, data }; entries.push(entry); branch.push(entry); appendFileSync(path, `${JSON.stringify(entry)}\n`); };
		const pi = { appendEntry: append } as unknown as ExtensionAPI;
		const notices: string[] = [];
		const manager = { getSessionFile: () => path, getBranch: () => branch.slice(), getEntries: () => entries.slice(), getLeafId: () => branch.at(-1)?.id ?? null,
			getLabel: () => undefined, getSessionName: () => undefined, getHeader: () => ({ type: "session", id: "s" }) };
		const ctx = { isIdle: () => true, sessionManager: manager, ui: { notify: (message: string) => notices.push(message) },
			navigateTree: async (id: string) => { if (id === "u") { branch = []; append("navigation", { value: 1 }); } else { branch = entries.slice(0, 3); } return { cancelled: false }; },
			switchSession: async () => ({ cancelled: true }) } as unknown as ExtensionCommandContext;
		assert.equal(await commitEdit(pi, ctx, "u", "new"), false);
		const appended = [
			{ type: "custom", id: "n2", parentId: "v", customType: "rqw-history-edit", data: { version: 1 } },
			{ type: "custom", id: "n3", parentId: null, customType: "navigation", data: { value: 1 } },
			{ type: "custom", id: "n4", parentId: "n3", customType: "rqw-history-edit", data: { version: 1 } },
		];
		const expected = Buffer.concat([original, Buffer.from(appended.map(entry => `${JSON.stringify(entry)}\n`).join(""))]);
		assert.deepEqual(readFileSync(path), expected);
		assert.equal(manager.getLeafId(), "n2");
		assert.deepEqual(notices, ["правка истории отменена"]);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

it("refuses editing without a session file", async () => {
	const notices: string[] = [];
	const ctx = { sessionManager: { getSessionFile: () => undefined }, ui: { notify: (message: string) => notices.push(message) } } as unknown as ExtensionCommandContext;
	assert.equal(await commitEdit({} as ExtensionAPI, ctx, "u", "new"), false);
	assert.deepEqual(notices, ["нет файла сессии. открой сохранённую сессию"]);
});

it("keeps edited text in the reopened session when sending fails", async () => {
	const dir = mkdtempSync(join(tmpdir(), "history-send-"));
	try {
		const path = join(dir, "session.jsonl");
		writeFileSync(path, "old\n");
		let branch: any[] = [{ type: "message", id: "u", parentId: null, message: { role: "user", content: "old" } }];
		const entries = branch.slice();
		const pi = { appendEntry: (customType: string, data: unknown) => { const entry = { type: "custom", id: `n${entries.length}`, parentId: branch.at(-1)?.id ?? null, customType, data }; entries.push(entry); branch.push(entry); } } as unknown as ExtensionAPI;
		let editor = "";
		let notice = "";
		const manager = { getSessionFile: () => path, getBranch: () => branch.slice(), getEntries: () => entries.slice(), getLeafId: () => branch.at(-1)?.id ?? null,
			getLabel: () => undefined, getSessionName: () => undefined, getHeader: () => ({ type: "session", id: "s" }) };
		const ctx = { isIdle: () => true, sessionManager: manager, ui: { notify: () => assert.fail("old context used") },
			navigateTree: async () => { branch = []; return { cancelled: false }; },
			switchSession: async (_path: string, options: any) => { await options.withSession({ ui: { setEditorText: (value: string) => { editor = value; }, notify: (value: string) => { notice = value; } }, sendUserMessage: async () => { throw new Error("failed"); } }); return { cancelled: false }; } } as unknown as ExtensionCommandContext;
		await commitEdit(pi, ctx, "u", "draft");
		assert.equal(editor, "draft");
		assert.match(notice, /failed/);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
