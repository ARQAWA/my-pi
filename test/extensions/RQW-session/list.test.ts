import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, it } from "node:test";
import { SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import sessionCommands from "../../../extensions/RQW-session/index.ts";
import { installFastList } from "../../../extensions/RQW-session/list.ts";

const stock = { list: SessionManager.list, listAll: SessionManager.listAll };
let dir: string;
const cwd = join(tmpdir(), "rqw-list-project");

const handlers = new Map<string, () => void>();
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "rqw-list-"));
	sessionCommands({ on: (name: string, handler: () => void) => handlers.set(name, handler), registerCommand: () => undefined } as unknown as ExtensionAPI);
});
afterEach(async () => {
	Object.assign(SessionManager, stock);
	await rm(dir, { recursive: true, force: true });
});

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const header = (id: string) => line({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd });
const user = (text: string) => line({ type: "message", id: "m", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text }], timestamp: 1767225601000 } });
const named = (name: string) => line({ type: "session_info", id: "n", parentId: null, timestamp: "2026-01-01T00:00:02.000Z", name });
async function session(id: string, body: string, mtime = new Date("2026-03-04T05:06:07.000Z")) {
	const path = join(dir, `${id}.jsonl`);
	await writeFile(path, header(id) + body);
	await utimes(path, mtime, mtime);
	return path;
}
const only = async () => { const rows = await SessionManager.listAll(dir); assert.equal(rows.length, 1); return rows[0]!; };

it("takes the name from the last session_info, even far from the end, and the date from mtime", async () => {
	// 200 KB after the name forces the reverse scan across several windows.
	await session("a", named("old") + user("hello") + named("  final name ") + user("x".repeat(200_000)));
	const row = await only();
	assert.equal(row.name, "final name");
	assert.equal(row.modified.toISOString(), "2026-03-04T05:06:07.000Z");
	// Every call reads the file again, so a name appended later shows at once.
	await appendFile(join(dir, "a.jsonl"), named("newest"));
	assert.equal((await only()).name, "newest");
});

it("uses the first user message when there is no name", async () => {
	await session("a", line({ type: "message", id: "x", parentId: null, timestamp: "t", message: { role: "assistant", content: "hi" } }) + user("first question") + user("second"));
	const row = await only();
	assert.equal(row.name, undefined);
	assert.equal(row.firstMessage, "first question");
	assert.equal(row.modified.toISOString(), "2026-03-04T05:06:07.000Z");
});

it("shows the exact file size in the row, not the message count", async () => {
	// Blank lines pad each file to a known byte size.
	const sized = async (id: string, bytes: number) => {
		const body = named("n");
		const path = await session(id, body);
		const used = Buffer.byteLength(header(id) + body);
		await appendFile(path, " ".repeat(bytes - used - 1) + "\n");
	};
	await sized("a", 3000);
	await sized("b", 2_400_000);
	const rows = new Map((await SessionManager.listAll(dir)).map(r => [r.id, String(r.messageCount)]));
	assert.deepEqual([rows.get("a"), rows.get("b")], ["3 KB", "2.4 MB"]);
});

it("finds a session_info marker split by a 64 KB window border", async () => {
	// The last window starts 64 KB before the end; the marker's newline sits 10 bytes before that border.
	const prefix = header("a") + named("old");
	const last = named("split");
	const tail = 64 * 1024 + 9 - Buffer.byteLength(last);
	await session("a", named("old") + last + " ".repeat(tail - 1) + "\n");
	const path = join(dir, "a.jsonl");
	const size = (await stat(path)).size;
	assert.equal(size - 64 * 1024 - 10, Buffer.byteLength(prefix) - 1);
	assert.equal((await only()).name, "split");
});

it("skips a broken last session_info line and takes the one before it", async () => {
	await session("a", named("good") + user("x") + '{"type":"session_info","name":"bro');
	assert.equal((await only()).name, "good");
});

it("does not take a non-message final line without newline as the first message", async () => {
	await session("a", '{"type":"custom","message":{"role":"user","content":"bogus"}}');
	assert.equal((await only()).firstMessage, "(no messages)");
});

it("restores the stock functions on session shutdown", () => {
	assert.notEqual(SessionManager.list, stock.list);
	handlers.get("session_shutdown")!();
	assert.deepEqual([SessionManager.list, SessionManager.listAll], [stock.list, stock.listAll]);
});

it("leaves message text out of the search text", async () => {
	await session("a", named("n") + user("uniqueneedle"));
	assert.equal((await only()).allMessagesText, "");
});

it("list of a project folder gives the fast row and reports progress once", async () => {
	await session("a", named("old") + user("hi") + named("last") + user("uniqueneedle"));
	const calls: number[] = [];
	const rows = await SessionManager.list(cwd, dir, (loaded) => { calls.push(loaded); });
	assert.deepEqual(rows.map(r => [r.id, r.name, String(r.messageCount), r.allMessagesText]), [["a", "last", "1 KB", ""]]);
	assert.deepEqual(calls, [1]);
	assert.deepEqual(await SessionManager.list(join(tmpdir(), "other"), dir), []);
});

it("listAll with the default agent dir, as /resume calls it, scans every project folder", async () => {
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		await mkdir(join(dir, "sessions", "p1"), { recursive: true });
		await mkdir(join(dir, "sessions", "p2"));
		await writeFile(join(dir, "sessions", "p1", "a.jsonl"), header("a") + named("one"));
		await writeFile(join(dir, "sessions", "p2", "b.jsonl"), header("b") + user("second"));
		const calls: number[] = [];
		const rows = await SessionManager.listAll((loaded, total) => { calls.push(loaded, total); }, new AbortController().signal);
		assert.deepEqual(rows.map(r => [r.id, r.name, r.firstMessage, r.allMessagesText]).sort(), [["a", "one", "", ""], ["b", undefined, "second", ""]]);
		assert.deepEqual(calls, [2, 2]);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
	}
});

it("keeps the stock functions when their shape differs", async () => {
	const fake = { list: async () => [], listAll: async () => [] } as never as Parameters<typeof installFastList>[0];
	const before = [fake.list, fake.listAll];
	installFastList(fake);
	assert.deepEqual([fake.list, fake.listAll], before);
});
