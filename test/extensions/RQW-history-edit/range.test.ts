import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, type TestContext } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import historyEdit from "../../../extensions/RQW-history-edit/index.ts";

type Fault = "write" | "rename" | "navigate" | "navigate-cancel" | "switch-cancel" | "switch-throw" | "loaded-switch-throw" | "restore-cancel" | "restore-throw" | "rollback-write";

function fixture(t: TestContext, fault?: Fault) {
	const dir = fs.mkdtempSync(join(tmpdir(), "history-range-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "session.jsonl");
	const timestamp = "2026-01-01T00:00:00Z";
	const header = { type: "session", version: 3, id: "session", timestamp, cwd: "/synthetic" };
	const image = { type: "image", data: "b2xk", mimeType: "image/png" };
	let entries: any[] = Array.from({ length: 12 }, (_, n) => ({ type: "message", id: `m${n}`, parentId: n ? `m${n - 1}` : null,
		timestamp, message: { role: "assistant", content: [{ type: "text", text: "x".repeat(128) }] } }));
	entries.push({ type: "custom", id: "child", parentId: "m11", timestamp, customType: "rqw-agent-child", data: { id: 1, state: "running" } },
		{ type: "message", id: "edit", parentId: "child", timestamp, message: { role: "user", content: [{ type: "text", text: "old" }, image] } },
		{ type: "custom", id: "latest", parentId: "edit", timestamp, customType: "rqw-agent-child", data: { id: 1, state: "completed" } },
		{ type: "message", id: "tail", parentId: "latest", timestamp, message: { role: "assistant", content: [{ type: "text", text: "answer" }] } });
	const initialEntries = structuredClone(entries);
	fs.writeFileSync(path, [header, ...entries].map(entry => `${JSON.stringify(entry)}\n`).join(""));
	const initialBytes = fs.readFileSync(path);
	const prefix = initialBytes.subarray(0, Buffer.byteLength([header, ...entries.slice(0, 12)].map(entry => `${JSON.stringify(entry)}\n`).join("")));
	let leaf = "tail";
	let editor = "draft";
	let sequence = 0;
	let failed = false;
	let navigationCount = 0;
	let queued = 0;
	let agents = 0;
	const sent: unknown[] = [];
	const normalCommands: string[] = [];
	const shellCommands: string[] = [];
	const notices: { text: string; level: string }[] = [];
	let handlers = new Map<string, any>();
	let command: any;
	let ctx: any;
	let terminalInput: any;
	const branch = () => {
		const result: any[] = [];
		let entry = entries.find(item => item.id === leaf);
		while (entry) { result.unshift(entry); entry = entries.find(item => item.id === entry.parentId); }
		return result;
	};
	const append = (value: any) => {
		const entry = { ...value, id: `added${sequence++}`, parentId: leaf, timestamp };
		entries.push(entry); leaf = entry.id;
		fs.appendFileSync(path, `${JSON.stringify(entry)}\n`);
	};
	const send = async (content: unknown) => { sent.push(content); append({ type: "message", message: { role: "user", content } }); };
	const load = () => { entries = fs.readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line)).slice(1); leaf = entries.at(-1).id; };
	const ui = { getEditorText: () => editor, setEditorText: (value: string) => { editor = value; },
		notify: (text: string, level: string) => notices.push({ text, level }), custom: async () => "edit",
		setWidget: (_key: string, factory: any) => factory?.({ getFocusedComponent: () => ({ actionHandlers: new Map() }) }), onTerminalInput: (handler: any) => { terminalInput = handler; return () => {}; } };
	const install = () => {
		let active = true;
		const check = () => { if (!active) throw new Error("This extension ctx is stale after session replacement"); };
		handlers = new Map();
		const manager = { getSessionFile: () => path, getEntries: () => entries.slice(), getBranch: branch, getLeafId: () => leaf,
			getLabel: (id: string) => id === "m0" ? "kept" : undefined, getSessionName: () => "Synthetic session", getHeader: () => header };
		const current = { mode: "tui", isIdle: () => { check(); return true; },
			get ui() { check(); return ui; }, get sessionManager() { check(); return manager; },
			navigateTree: async (id: string) => {
				check();
				navigationCount++;
				if (navigationCount > 1 && fault === "restore-cancel") return { cancelled: true };
				if (navigationCount > 1 && fault === "restore-throw") throw new Error("navigation unavailable");
				const target = entries.find(entry => entry.id === id);
				if (!target) throw new Error("unknown entry");
				leaf = target.type === "message" && target.message.role === "user" ? target.parentId : id;
				handlers.get("session_tree")?.({}, current);
				if (navigationCount === 1 && fault === "navigate") throw new Error("navigation failed after changing leaf");
				return { cancelled: navigationCount === 1 && fault === "navigate-cancel" };
			},
			switchSession: async (_path: string, options?: any) => {
				check();
				if (options && fault === "switch-cancel") return { cancelled: true };
				if (options && (fault === "switch-throw" || fault === "rollback-write")) throw new Error("switch failed");
				handlers.get("session_shutdown")?.({}, current);
				active = false;
				load();
				install();
				if (options && fault === "loaded-switch-throw" && !failed) { failed = true; throw new Error("switch failed after loading"); }
				await options?.withSession(Object.assign(Object.create(ctx), { sendUserMessage: send }));
				return { cancelled: false };
			},
		};
		ctx = current;
		const pi = {
			on: (name: string, handler: any) => { check(); handlers.set(name, handler); }, events: { on() {}, emit(_name: string, request: any) { request.reply({ version: 1, snapshot: () => ({ agents, reviews: 0 }) }); } },
			registerCommand: (_name: string, options: any) => { check(); command = options.handler; },
			sendUserMessage: (content: unknown) => { check(); if (content === "/edit-history") queued++; else void send(content); },
			appendEntry: (customType: string, data: unknown) => { check(); append({ type: "custom", customType, data }); },
			setLabel: (targetId: string, label: string) => { check(); append({ type: "label", targetId, label }); },
			setSessionName: (name: string) => { check(); append({ type: "session_info", name }); },
		};
		historyEdit(pi as unknown as ExtensionAPI);
		handlers.get("session_start")!({}, current);
	};
	install();
	const write = fs.writeFileSync;
	const rename = fs.renameSync;
	t.mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
		const [file, data] = args;
		if (typeof file === "number" || String(file).endsWith(".tmp")) {
			if (fault === "rollback-write" && Buffer.isBuffer(data)) throw new Error("backup restore unavailable");
			if (!failed && (fault === "write" || fault === "restore-cancel" || fault === "restore-throw")) { failed = true; throw new RangeError("Invalid string length"); }
			if (!Buffer.isBuffer(data) && Buffer.byteLength(String(data)) > 1024) throw new RangeError("write exceeds boundary capacity");
		}
		return write(...args);
	});
	t.mock.method(fs, "renameSync", (...args: Parameters<typeof fs.renameSync>) => {
		if (fault === "rollback-write" && String(args[0]).endsWith(".bak")) throw new Error("backup restore unavailable");
		if (!failed && fault === "rename") { failed = true; throw new Error("rename unavailable"); }
		return rename(...args);
	});
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	const flush = async () => {
		await Promise.resolve();
		while (queued) { queued--; await command("", ctx); await Promise.resolve(); }
	};
	const submit = async (text: string) => {
		editor = text;
		if (terminalInput("\r")?.consume) { await flush(); return; }
		// Pi handles built-in commands and shell input before the input hook.
		if (text === "/help") { normalCommands.push(text); return; }
		if (text.startsWith("!")) { shellCommands.push(text); return; }
		const result = handlers.get("input")!({ source: "interactive", text }, ctx);
		if (result?.action !== "handled") await send(text);
		await flush();
	};
	return { path, dir, prefix, image, initialEntries, initialBytes, branch, notices, load, sent, normalCommands, shellCommands,
		setAgents: (value: number) => { agents = value; },
		get editor() { return editor; }, clearFault: () => { fault = undefined; },
		switchSession: () => ctx.switchSession(path),
		open: () => command("", ctx), submit,
		escape: async () => { assert.deepEqual(terminalInput("\x1b"), { consume: true }); await Promise.resolve(); },
	};
}

it("edits a history larger than the writer capacity through the command", async t => {
	const f = fixture(t);
	await f.open();
	await f.submit("replacement");
	assert.deepEqual(f.sent, [[{ type: "text", text: "replacement" }, f.image]]);
	const bytes = fs.readFileSync(f.path);
	assert.deepEqual(bytes.subarray(0, f.prefix.length), f.prefix);
	const records = bytes.toString().trim().split("\n").map(line => JSON.parse(line));
	assert.ok(!records.some(entry => entry.id === "edit" || entry.id === "tail"));
	// The retained running entry precedes the complete replay of both child records.
	assert.deepEqual(records.filter(entry => entry.customType === "rqw-agent-child").map(entry => entry.data), [
		{ id: 1, state: "running" }, { id: 1, state: "running" }, { id: 1, state: "completed" },
	]);
	assert.ok(records.some(entry => entry.type === "label" && entry.targetId === "m0" && entry.label === "kept"));
	assert.ok(records.some(entry => entry.type === "session_info" && entry.name === "Synthetic session"));
	assert.equal(f.notices.some(notice => notice.level === "error"), false);
	assert.equal(fs.readdirSync(f.dir).some(name => /\.(tmp|bak)$/.test(name)), false);
});

for (const fault of ["write", "rename", "navigate", "navigate-cancel", "switch-cancel", "switch-throw", "loaded-switch-throw"] as const) {
	it(`restores the saved branch and draft after ${fault}`, async t => {
		const f = fixture(t, fault);
		await f.open();
		await f.submit("replacement");
		assert.deepEqual(f.sent, []);
		assert.equal(f.editor, "replacement");
		assert.ok(f.branch().some(entry => entry.id === "tail"));
		const bytes = fs.readFileSync(f.path);
		assert.deepEqual(bytes.subarray(0, f.initialBytes.length), f.initialBytes);
		f.load();
		assert.ok(f.branch().some(entry => entry.id === "tail"), "resume must retain the original continuation");
		for (const entry of f.initialEntries) assert.deepEqual(f.branch().find(item => item.id === entry.id), entry);
		assert.equal(fs.readdirSync(f.dir).some(name => /\.(tmp|bak)$/.test(name)), false);
		if (fault === "write" || fault === "rename" || fault === "loaded-switch-throw") {
			f.clearFault();
			await f.submit("retry");
			assert.deepEqual(f.sent, fault === "loaded-switch-throw" ? ["retry"] : [[{ type: "text", text: "retry" }, f.image]]);
		}
	});
}

for (const fault of ["restore-cancel", "restore-throw", "rollback-write"] as const) {
	it(`retries ${fault} before submitting and stays blocked until recovery succeeds`, async t => {
		const f = fixture(t, fault);
		await f.open();
		await f.submit("replacement");
		assert.deepEqual(f.sent, []);
		assert.equal(f.editor, "replacement");
		assert.ok(f.notices.some(notice => notice.level === "error" && /Recovery failed:/.test(notice.text)));
		await f.submit("still blocked");
		assert.deepEqual(f.sent, []);
		assert.equal(f.editor, "still blocked");
		assert.match(f.notices.at(-1)!.text, /Recovery failed:/);
		assert.ok(f.notices.every(notice => !notice.text.includes("/tree")));
		f.clearFault();
		await f.submit("recovered");
		assert.deepEqual(f.sent, []);
		assert.equal(f.editor, "recovered");
		assert.deepEqual(f.notices.at(-1), { text: "Previous branch restored.", level: "info" });
		await f.submit(f.editor);
		assert.deepEqual(f.sent, ["recovered"]);
		f.load();
		assert.equal(f.branch().at(-1).message.content, "recovered");
	});

	it(`a session switch clears the ${fault} recovery block and allows sending`, async t => {
		const f = fixture(t, fault);
		await f.open();
		await f.submit("replacement");
		assert.deepEqual(f.sent, []);
		await f.switchSession();
		await f.submit("new session message");
		assert.deepEqual(f.sent, ["new session message"]);
		assert.equal(f.branch().at(-1).message.content, "new session message");
	});
}

for (const text of ["/help", "!echo hello", "ordinary message"] as const) {
	it(`restoration consumes ${text} and the next Enter follows Pi's normal path`, async t => {
		const f = fixture(t, "restore-throw");
		await f.open();
		await f.submit("replacement");
		f.clearFault();
		if (text === "ordinary message") f.setAgents(1);
		await f.submit(text);
		assert.deepEqual(f.sent, []);
		assert.deepEqual(f.normalCommands, []);
		assert.deepEqual(f.shellCommands, []);
		assert.equal(f.editor, text);
		assert.deepEqual(f.notices.at(-1), { text: "Previous branch restored.", level: "info" });
		await f.submit(f.editor);
		assert.deepEqual(f.normalCommands, text === "/help" ? [text] : []);
		assert.deepEqual(f.shellCommands, text.startsWith("!") ? [text] : []);
		assert.deepEqual(f.sent, text === "ordinary message" ? [text] : []);
		assert.ok(f.branch().some(entry => entry.id === "tail"));
	});
}

it("keeps recovery blocking after Escape leaves edit mode", async t => {
	const f = fixture(t, "restore-throw");
	await f.open();
	await f.submit("replacement");
	await f.escape();
	const beforeSubmit = f.notices.length;
	await f.submit("outside edit mode");
	assert.deepEqual(f.sent, []);
	assert.equal(f.editor, "outside edit mode");
	assert.equal(f.notices.length, beforeSubmit + 1);
	assert.match(f.notices.at(-1)!.text, /Recovery failed: Error: navigation unavailable/);
	const beforeCommand = f.notices.length;
	await f.open();
	assert.equal(f.notices.length, beforeCommand + 1);
	assert.match(f.notices.at(-1)!.text, /Recovery failed: Error: navigation unavailable/);
	assert.deepEqual(f.sent, []);
	f.clearFault();
	await f.submit("restored message");
	assert.deepEqual(f.sent, []);
	assert.equal(f.editor, "restored message");
	assert.deepEqual(f.notices.at(-1), { text: "Previous branch restored.", level: "info" });
	await f.submit(f.editor);
	assert.deepEqual(f.sent, ["restored message"]);
	assert.ok(f.branch().some(entry => entry.id === "tail"));
});

it("keeps all original bytes on disk when replacement and backup restoration both fail", async t => {
	const f = fixture(t, "rollback-write");
	await f.open();
	await f.submit("replacement");
	const backups = fs.readdirSync(f.dir).filter(name => name.endsWith(".bak"));
	assert.equal(backups.length, 1);
	const original = fs.readFileSync(join(f.dir, backups[0]));
	assert.deepEqual(original.subarray(0, f.initialBytes.length), f.initialBytes);
	assert.ok(original.toString().trim().split("\n").map(line => JSON.parse(line)).some(entry => entry.id === "tail"));
	assert.ok(f.notices.some(notice => notice.text.includes(join(f.dir, backups[0]))));
	assert.deepEqual(f.sent, []);
	f.clearFault();
	await f.submit("retry");
	assert.deepEqual(f.sent, []);
	assert.equal(f.editor, "retry");
	assert.deepEqual(f.notices.at(-1), { text: "Previous branch restored.", level: "info" });
	await f.submit(f.editor);
	assert.deepEqual(f.sent, ["retry"]);
	assert.equal(fs.readdirSync(f.dir).some(name => name.endsWith(".bak")), false);
});
