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

it("avoids replaying the retained child prefix and preserves later state order", async () => {
	const dir = mkdtempSync(join(tmpdir(), "history-children-"));
	try {
		const path = join(dir, "session.jsonl");
		writeFileSync(path, "original\n");
		const root = { type: "message", id: "root", parentId: null, message: { role: "user", content: "root" } };
		const child = (id: string, parentId: string, state: string) => ({ type: "custom", id, parentId, customType: "rqw-agent-child", data: { version: 1, kind: "agent", id: 1, epoch: "epoch", runNumber: 1, fast: false, state } });
		const kept = child("kept", "root", "idle");
		const config = { system: "synthetic prompt", base: "synthetic base", model: { provider: "test", id: "model" }, thinking: "off", tools: [] };
		const abandoned = { ...child("abandoned", "root", "running"), data: { ...child("abandoned", "root", "running").data, config, task: "synthetic task" } };
		const latest = child("latest", "kept", "completed");
		const selected = { type: "message", id: "selected", parentId: "latest", message: { role: "user", content: "old" } };
		const after = child("after", "selected", "stopped");
		const entries: any[] = [root, kept, abandoned, latest, selected, after];
		let branch: any[] = [root, kept, latest, selected, after];
		const append = (entry: any) => {
			const next = { ...entry, id: `new-${entries.length}`, parentId: branch.at(-1)?.id ?? null };
			entries.push(next);
			branch.push(next);
			appendFileSync(path, `${JSON.stringify(next)}\n`);
		};
		const pi = { appendEntry: (customType: string, data: unknown) => append({ type: "custom", customType, data }) } as unknown as ExtensionAPI;
		const manager = { getSessionFile: () => path, getBranch: () => branch.slice(), getEntries: () => entries.slice(),
			getLeafId: () => branch.at(-1)?.id ?? null, getLabel: () => undefined, getSessionName: () => undefined,
			getHeader: () => ({ type: "session", id: "s" }) };
		const ctx = { isIdle: () => true, sessionManager: manager, ui: { notify: () => assert.fail("unexpected notice") },
			navigateTree: async () => { branch = [root, kept, latest]; return { cancelled: false }; },
			switchSession: async (_path: string, options: any) => { await options.withSession({ ui: { setEditorText() {} }, sendUserMessage: async () => {} }); return { cancelled: false }; } } as unknown as ExtensionCommandContext;
		assert.deepEqual(await commitEdit(pi, ctx, "selected", "edited"), { committed: true });
		const records = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
		const children = records.filter(entry => entry.customType === "rqw-agent-child").map(entry => entry.data);
		assert.deepEqual(children.map(data => data.state), ["idle", "completed", "running", "completed", "stopped"]);
		assert.deepEqual(children.findLast(data => data.config), abandoned.data);
		assert.deepEqual(children.at(-1), after.data);
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
		assert.deepEqual(await commitEdit(pi, ctx, "u", "new"), { committed: false });
		const appended = [
			{ type: "custom", id: "n2", parentId: "v", customType: "rqw-history-edit", data: { version: 1 } },
		];
		const restored = readFileSync(path);
		assert.deepEqual(restored.subarray(0, original.length), original);
		const records = restored.subarray(original.length).toString().trim().split("\n").map(line => JSON.parse(line));
		assert.deepEqual(records, appended);
		const last = records.at(-1);
		assert.ok(last);
		assert.equal(last.parentId, "v");
		assert.equal(last.id, manager.getLeafId());
		assert.deepEqual(notices, ["History edit cancelled."]);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

it("refuses editing without a session file", async () => {
	const notices: string[] = [];
	const ctx = { sessionManager: { getSessionFile: () => undefined }, ui: { notify: (message: string) => notices.push(message) } } as unknown as ExtensionCommandContext;
	assert.deepEqual(await commitEdit({} as ExtensionAPI, ctx, "u", "new"), { committed: false });
	assert.deepEqual(notices, ["No session file. Open a saved session first."]);
});

/** A session file holding `original` plus the anchor entry; `send` is what the reopened session does with the message. */
function sendHarness(dir: string, send: () => Promise<void>) {
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
	const navigated: string[] = [];
	const manager = { getSessionFile: () => path, getBranch: () => branch.slice(), getEntries: () => entries.slice(), getLeafId: () => branch.at(-1)?.id ?? null,
		getLabel: () => undefined, getSessionName: () => undefined, getHeader: () => ({ type: "session", id: "s" }) };
	const navigateTree = async (id: string) => { navigated.push(id); branch = id === "u" ? [] : entries.slice(0, 3); return { cancelled: false }; };
	// The reopened session starts at the cut leaf; accepting the message moves its leaf.
	const reopened = (): any => ({ ui: { setEditorText() {}, notify: (message: string) => notices.push(message) }, navigateTree,
		sessionManager: { getEntries: () => [], getBranch: () => branch.slice() },
		switchSession: async (_path: string, options: any) => { await options.withSession(reopened()); return { cancelled: false }; },
		sendUserMessage: send });
	const ctx = { isIdle: () => true, sessionManager: manager, ui: { notify: (message: string) => notices.push(message) }, navigateTree,
		// Pi appends a settings entry when it reopens a file that lacks one, so the leaf moves even if nothing is sent.
		switchSession: async (_path: string, options: any) => { branch = [...branch, { type: "thinking_level_change", id: "t" }]; await options.withSession(reopened()); return { cancelled: false }; } } as unknown as ExtensionCommandContext;
	return { path, original, pi, ctx, notices, navigated, accept: () => { branch = [...branch, { type: "message", id: "new", message: { role: "user" } }]; } };
}

it("keeps the old history when sending fails", async () => {
	const dir = mkdtempSync(join(tmpdir(), "history-send-"));
	try {
		const h = sendHarness(dir, async () => { throw new Error("no model"); });
		assert.deepEqual(await commitEdit(h.pi, h.ctx, "u", "draft"), { committed: false });
		assert.deepEqual(readFileSync(h.path).subarray(0, h.original.length), h.original);
		assert.deepEqual(h.navigated, ["u", "n2"]);
		assert.deepEqual(h.notices, ["History edit failed: the message was not sent (Error: no model)"]);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

it("keeps the cut when the run fails after the message was accepted", async () => {
	const dir = mkdtempSync(join(tmpdir(), "history-run-"));
	try {
		const h: ReturnType<typeof sendHarness> = sendHarness(dir, async () => { h.accept(); throw new Error("provider"); });
		assert.deepEqual(await commitEdit(h.pi, h.ctx, "u", "draft"), { committed: true });
		assert.deepEqual(h.navigated, ["u"]);
		assert.deepEqual(h.notices, ["The run failed after the message was sent: Error: provider"]);
		assert.ok(!readFileSync(h.path, "utf8").startsWith("original"));
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
