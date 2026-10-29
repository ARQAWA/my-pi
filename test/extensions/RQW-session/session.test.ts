import assert from "node:assert/strict";
import { existsSync, unlinkSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import { registerSessionCommands } from "../../../extensions/RQW-session/index.ts";

it("copy-session passes the exact public session id to the clipboard", async () => {
	const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
	const copied: string[] = [];
	const notes: string[] = [];
	registerSessionCommands({ on: () => undefined, registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => commands.set(name, command) } as unknown as ExtensionAPI,
		async (id) => { copied.push(id); });
	const ctx = { sessionManager: { getSessionId: () => "session-1" }, ui: { notify: (text: string) => notes.push(text) } } as unknown as ExtensionCommandContext;
	await commands.get("copy-session")!.handler("", ctx);
	assert.deepEqual(copied, ["session-1"]);
	assert.deepEqual(notes, ["Session ID copied: session-1"]);
});

it("remove switches to a fresh session, then deletes only the JSONL like stock /resume", async () => {
	const root = await mkdtemp(join(tmpdir(), "rqw-session-"));
	try {
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		let trashWorks = true;
		const spawn = (_cmd: string, args: string[]) => {
			if (!trashWorks) return { status: 1, stderr: "no trash" };
			unlinkSync(args[0]!);
			return { status: 0 };
		};
		registerSessionCommands({ on: () => undefined, registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => commands.set(name, command) } as unknown as ExtensionAPI,
			async () => {}, spawn as never);
		const run = async (file: string, switched: boolean) => {
			const notes: string[] = [];
			const levels: string[] = [];
			const ctx = {
				hasUI: true,
				sessionManager: { getSessionFile: () => file },
				ui: { select: async () => "2. Yes", notify: (text: string) => notes.push(text) },
				newSession: async (options: { withSession: (fresh: unknown) => Promise<void> }) => {
					if (switched) await options.withSession({ ui: { notify: (text: string, level?: string) => { notes.push(text); levels.push(level ?? ""); } } });
					return { cancelled: !switched };
				},
			} as unknown as ExtensionCommandContext;
			await commands.get("remove")!.handler("", ctx);
			return { notes, levels };
		};
		const one = join(root, "one.jsonl");
		const two = join(root, "two.jsonl");
		await writeFile(one, "{}\n");
		await writeFile(two, "{}\n");
		await mkdir(join(root, "one.jsonl.children"));
		await mkdir(join(root, "two.jsonl.children"));
		assert.equal((await run(one, false)).notes.length, 0);
		assert.equal(existsSync(one), true);
		const trashed = await run(one, true);
		assert.deepEqual(trashed.levels, ["info"]);
		assert.match(trashed.notes[0]!, /trash/i);
		assert.equal(existsSync(one), false);
		trashWorks = false;
		const deleted = await run(two, true);
		assert.deepEqual(deleted.levels, ["info"]);
		assert.doesNotMatch(deleted.notes[0]!, /trash/i);
		assert.equal(existsSync(two), false);
		assert.equal(existsSync(join(root, "one.jsonl.children")) && existsSync(join(root, "two.jsonl.children")), true);
	} finally { await rm(root, { recursive: true, force: true }); }
});

it("cleanup removes only orphaned child trees and reports the count", async () => {
	const root = await mkdtemp(join(tmpdir(), "rqw-session-"));
	try {
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const agent = join(root, "agent");
		const a = join(agent, "sessions", "a");
		const b = join(agent, "sessions", "b");
		const outside = join(root, "outside");
		await mkdir(join(a, "orphan.jsonl.children", "nested"), { recursive: true });
		await mkdir(join(a, "live.jsonl.children"), { recursive: true });
		await mkdir(join(a, "current.jsonl.children"), { recursive: true });
		await mkdir(join(b, "orphan2.jsonl.children"), { recursive: true });
		await mkdir(outside);
		await writeFile(join(a, "live.jsonl"), "{}\n");
		await writeFile(join(a, "file.jsonl.children"), "not a directory");
		await writeFile(join(outside, "keep.txt"), "x");
		await symlink(outside, join(a, "link.jsonl.children"));
		await writeFile(join(a, "orphan.jsonl.children", "nested", "child.jsonl"), "{}\n");
		// Real RQW-agent layout: <parent>.jsonl.children/agent-N/<child>.jsonl with <child>.jsonl.children beside it.
		const kid = join(a, "live.jsonl.children", "agent-1");
		await mkdir(kid, { recursive: true });
		await writeFile(join(kid, "child.jsonl"), "{}\n");
		await mkdir(join(kid, "child.jsonl.children", "agent-1", "grand.jsonl.children"), { recursive: true });
		await writeFile(join(kid, "child.jsonl.children", "agent-1", "grand.jsonl"), "{}\n");
		await mkdir(join(kid, "child.jsonl.children", "agent-2", "deep.jsonl.children"), { recursive: true });
		await mkdir(join(a, "live.jsonl.children", "agent-2", "gone.jsonl.children"), { recursive: true });
		await mkdir(join(a, "Cased.jsonl.children"), { recursive: true });
		await writeFile(join(a, "cased.jsonl"), "{}\n");
		await mkdir(join(a, "current.jsonl.children", "agent-1", "gone.jsonl.children"), { recursive: true });
		registerSessionCommands({ on: () => undefined, registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => commands.set(name, command) } as unknown as ExtensionAPI,
			async () => {}, undefined, agent);
		const notes: string[] = [];
		const ctx = { sessionManager: { getSessionFile: () => join(a, "CURRENT.jsonl") }, ui: { notify: (text: string) => notes.push(text) } } as unknown as ExtensionCommandContext;
		await commands.get("cleanup")!.handler("", ctx);
		assert.equal(existsSync(join(a, "orphan.jsonl.children")), false);
		assert.equal(existsSync(join(b, "orphan2.jsonl.children")), false);
		assert.equal(existsSync(join(a, "live.jsonl.children", "agent-2", "gone.jsonl.children")), false);
		assert.equal(existsSync(join(kid, "child.jsonl.children", "agent-2", "deep.jsonl.children")), false);
		assert.equal(existsSync(join(a, "current.jsonl.children", "agent-1", "gone.jsonl.children")), false);
		assert.equal(existsSync(join(kid, "child.jsonl.children", "agent-1", "grand.jsonl.children")), true);
		assert.equal(existsSync(join(a, "Cased.jsonl.children")), true);
		for (const kept of [join(a, "live.jsonl.children"), join(a, "current.jsonl.children"), join(a, "file.jsonl.children"), join(a, "link.jsonl.children"), join(outside, "keep.txt")]) assert.equal(existsSync(kept), true);
		assert.match(notes[0]!, /\b5\b/);
		await commands.get("cleanup")!.handler("", ctx);
		assert.doesNotMatch(notes[1]!, /\b[1-9]\b/);
		// An unreadable (non-ENOENT) sessions path is a failure, not "nothing to clean"; a missing one is clean.
		const notAgent = join(root, "not-a-dir");
		await mkdir(notAgent);
		await writeFile(join(notAgent, "sessions"), "x");
		const failing = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		registerSessionCommands({ on: () => undefined, registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => failing.set(name, command) } as unknown as ExtensionAPI,
			async () => {}, undefined, notAgent);
		const failNotes: string[] = [];
		await failing.get("cleanup")!.handler("", { sessionManager: { getSessionFile: () => undefined }, ui: { notify: (text: string, level?: string) => failNotes.push(`${level}:${text}`) } } as unknown as ExtensionCommandContext);
		assert.match(failNotes[0]!, /^warning:/);
		const none = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		registerSessionCommands({ on: () => undefined, registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => none.set(name, command) } as unknown as ExtensionAPI,
			async () => {}, undefined, join(root, "absent"));
		const noneNotes: string[] = [];
		await none.get("cleanup")!.handler("", { sessionManager: { getSessionFile: () => undefined }, ui: { notify: (text: string, level?: string) => noneNotes.push(`${level}:${text}`) } } as unknown as ExtensionCommandContext);
		assert.match(noneNotes[0]!, /^info:/);
	} finally { await rm(root, { recursive: true, force: true }); }
});

it("cleanup keeps the current tree behind a symlinked path and keeps trees it cannot check", async () => {
	const root = await mkdtemp(join(tmpdir(), "rqw-session-"));
	try {
		const agent = join(root, "agent");
		const real = join(agent, "sessions", "a");
		const alias = join(root, "alias");
		await mkdir(join(real, "cur.jsonl.children", "agent-1", "gone.jsonl.children"), { recursive: true });
		await symlink(real, alias);
		const run = async (file: string) => {
			const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
			registerSessionCommands({ on: () => undefined, registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => commands.set(name, command) } as unknown as ExtensionAPI,
				async () => {}, undefined, agent);
			const notes: string[] = [];
			await commands.get("cleanup")!.handler("", { sessionManager: { getSessionFile: () => file }, ui: { notify: (text: string, level?: string) => notes.push(`${level}:${text}`) } } as unknown as ExtensionCommandContext);
			return notes[0]!;
		};
		// The session file is spelled through the alias; its own tree has no JSONL but must stay.
		await run(join(alias, "cur.jsonl"));
		assert.equal(existsSync(join(real, "cur.jsonl.children")), true);
		assert.equal(existsSync(join(real, "cur.jsonl.children", "agent-1", "gone.jsonl.children")), false);
		// The current session is nested in an orphaned ancestor tree (no parent JSONL): the ancestor must stay too.
		await mkdir(join(real, "parent.jsonl.children", "agent-1"), { recursive: true });
		await run(join(alias, "parent.jsonl.children", "agent-1", "cur2.jsonl"));
		assert.equal(existsSync(join(real, "parent.jsonl.children")), true);
		// The current file is a symlink into an orphaned tree: that tree contains its target and must stay.
		await mkdir(join(real, "target.jsonl.children", "agent-1"), { recursive: true });
		await writeFile(join(real, "target.jsonl.children", "agent-1", "cur3.jsonl"), "{}\n");
		await symlink(join(real, "target.jsonl.children", "agent-1", "cur3.jsonl"), join(real, "cur3link.jsonl"));
		await run(join(real, "cur3link.jsonl"));
		assert.equal(existsSync(join(real, "target.jsonl.children")), true);
		if (process.platform === "win32" || process.getuid?.() === 0) return;
		// Listable but not searchable: the sibling check fails with EACCES, so the tree stays and a warning is shown.
		const locked = join(agent, "sessions", "b");
		await mkdir(join(locked, "orphan.jsonl.children"), { recursive: true });
		await chmod(locked, 0o600);
		try { assert.match(await run(join(real, "cur.jsonl")), /^warning:/); }
		finally { await chmod(locked, 0o700); }
		assert.equal(existsSync(join(locked, "orphan.jsonl.children")), true);
	} finally { await rm(root, { recursive: true, force: true }); }
});

it("a message typed after the open session file was deleted is kept in the editor and a new session opens", async () => {
	const root = await mkdtemp(join(tmpdir(), "rqw-session-"));
	try {
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const pi = {
			registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => commands.set(name, command),
			on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers.set(name, handler); },
			// Pi dispatches the extension command text to the command with a command context.
			sendUserMessage: (text: string) => { void commands.get(text.slice(1))!.handler("", ctx as unknown as ExtensionCommandContext); },
		};
		const notes: string[] = [];
		const levels: string[] = [];
		const order: string[] = [];
		let editor = "";
		let opened = 0;
		const fresh = { ui: { setEditorText: (text: string) => { editor = text; }, notify: (text: string, level?: string) => { order.push("notify"); notes.push(text); levels.push(level ?? ""); } } };
		const file = join(root, "open.jsonl");
		const header = '{"type":"session","version":3,"id":"abc"}\n';
		let entries: unknown[] = [];
		let refuse = false;
		const ctx = {
			sessionManager: { getSessionFile: () => file, getEntries: () => entries },
			ui: fresh.ui,
			newSession: async (options: { withSession: (fresh: unknown) => Promise<void> }) => {
				if (refuse) return { cancelled: true };
				opened++;
				order.push("newSession");
				await options.withSession(fresh);
				return { cancelled: false };
			},
		};
		registerSessionCommands(pi as unknown as ExtensionAPI, async () => {}, undefined, root);
		const submit = () => handlers.get("input")!({ type: "input", text: "my text", source: "interactive" }, ctx);
		// A new session with no entries and no seen file is normal.
		assert.deepEqual(await submit(), { action: "continue" });
		// Pi emits message_end before it writes the file, so the file may be deleted during the first answer before any
		// observation: the conversation entries alone make the file expected.
		entries = [{ type: "message", message: { role: "user" } }];
		assert.deepEqual(await submit(), { action: "handled" });
		await new Promise(done => setImmediate(done));
		await new Promise(done => setImmediate(done));
		order.length = 0;
		notes.length = 0;
		levels.length = 0;
		opened = 0;
		editor = "";
		entries = [];
		// A fresh window, as after a session switch.
		registerSessionCommands(pi as unknown as ExtensionAPI, async () => {}, undefined, root);
		// Pi's appendFileSync recreates the deleted file without its header: still deleted. A normal file is untouched.
		entries = [{ type: "message", message: { role: "user" } }];
		await writeFile(file, '{"type":"message"}\n');
		assert.deepEqual(await submit(), { action: "handled" });
		await new Promise(done => setImmediate(done));
		await new Promise(done => setImmediate(done));
		assert.equal(opened, 1);
		opened = 0;
		order.length = 0;
		notes.length = 0;
		levels.length = 0;
		editor = "";
		await writeFile(file, header);
		assert.deepEqual(await submit(), { action: "continue" });
		// Other key order and whitespace are still a valid header.
		await writeFile(file, '{ "id": "abc",  "version": 3, "type" : "session" }\n{"type":"message"}\n');
		assert.deepEqual(await submit(), { action: "continue" });
		// Pi skips blank and malformed lines before the header.
		await writeFile(file, `\n{broken\nnull\n${header}`);
		assert.deepEqual(await submit(), { action: "continue" });
		// A headerless first line longer than any small read window is still detected.
		await writeFile(file, `${JSON.stringify({ type: "message", text: "x".repeat(70000) })}\n`);
		assert.deepEqual(await submit(), { action: "handled" });
		await new Promise(done => setImmediate(done));
		await new Promise(done => setImmediate(done));
		opened = 0;
		order.length = 0;
		notes.length = 0;
		levels.length = 0;
		editor = "";
		await unlink(file);
		entries = [];
		// A previously written but empty session is seen at session start; deleting it is detected.
		await writeFile(file, header);
		await handlers.get("session_start")!({ type: "session_start" }, ctx);
		assert.deepEqual(await submit(), { action: "continue" });
		await unlink(file);
		assert.deepEqual(await submit(), { action: "handled" });
		await new Promise(done => setImmediate(done));
		await new Promise(done => setImmediate(done));
		assert.equal(opened, 1);
		assert.equal(editor, "my text");
		// The deletion error comes before the switch; the text arrives with the switch.
		assert.deepEqual(order, ["notify", "newSession"]);
		assert.deepEqual(levels, ["error"]);
		assert.match(notes[0]!, /deleted/i);
		// A refused switch keeps the text and still shows an error that says the new session was not opened.
		refuse = true;
		editor = "";
		assert.deepEqual(await submit(), { action: "handled" });
		await new Promise(done => setImmediate(done));
		await new Promise(done => setImmediate(done));
		assert.equal(editor, "my text");
		assert.deepEqual(levels, ["error", "error", "error"]);
		assert.match(notes[2]!, /could not/i);
	} finally { await rm(root, { recursive: true, force: true }); }
});

it("once the file has been seen, input outcomes do not need the session history and the text survives deletion", async () => {
	const root = await mkdtemp(join(tmpdir(), "rqw-session-"));
	try {
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const pi = {
			registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => commands.set(name, command),
			on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers.set(name, handler); },
			sendUserMessage: (text: string) => { void commands.get(text.slice(1))!.handler("", ctx as unknown as ExtensionCommandContext); },
		};
		const file = join(root, "open.jsonl");
		await writeFile(file, '{"type":"session","version":3,"id":"abc"}\n');
		let editor = "";
		let historyAvailable = true;
		const fresh = { ui: { setEditorText: (text: string) => { editor = text; }, notify() {} } };
		const ctx = {
			sessionManager: {
				getSessionFile: () => file,
				getEntries: () => {
					if (!historyAvailable) throw new Error("session history unavailable");
					return [];
				},
			},
			ui: fresh.ui,
			newSession: async (options: { withSession: (fresh: unknown) => Promise<void> }) => {
				await options.withSession(fresh);
				return { cancelled: false };
			},
		};
		registerSessionCommands(pi as unknown as ExtensionAPI, async () => {}, undefined, root);
		const submit = () => handlers.get("input")!({ type: "input", text: "my text", source: "interactive" }, ctx);
		// The first input sees the file; from then on the history is not needed.
		assert.deepEqual(await submit(), { action: "continue" });
		historyAvailable = false;
		assert.deepEqual(await submit(), { action: "continue" });
		await unlink(file);
		assert.deepEqual(await submit(), { action: "handled" });
		await new Promise(done => setImmediate(done));
		await new Promise(done => setImmediate(done));
		assert.equal(editor, "my text");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
