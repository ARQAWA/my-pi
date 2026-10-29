import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it, type TestContext } from "node:test";
import { type Entry, nodeSessionFs, resolveChat, type SessionFs, writeEntry } from "../../../extensions/RQW-tabs-link/registry.ts";
import { request, startServer } from "../../../extensions/RQW-tabs-link/transport.ts";
import { fakeNet, openTab, tempDir } from "./harness.ts";

const closed = (id: string, title: string | null, updatedAt: number, extra: Partial<Entry> = {}): Entry =>
	({ id, title, cwd: "/work", updatedAt, state: "closed", ...extra });

async function listOf(tab: ReturnType<typeof openTab>, params: object) {
	const result = await tab.tools[0].execute("call", params as never, undefined, undefined, undefined as never);
	return result.details as { chats: { id: string; status: string }[]; nextCursor: string | null; untrustedDataNotice: string };
}

it("list_chats filters by substring, orders newest first, pages with a cursor and repeats exactly", async (t) => {
	const dir = tempDir(t);
	const net = fakeNet();
	writeEntry(dir, closed("b-chat", "Plan B", 10));
	writeEntry(dir, closed("a-chat", "Plan A", 10));
	writeEntry(dir, closed("c-chat", "PLAN C", 30));
	writeEntry(dir, closed("d-chat", "Other", 40));
	const tab = openTab({ dir, net }, "e-chat");
	await tab.fire("session_start", { reason: "startup" });
	const first = await listOf(tab, { query: "plan", limit: 2 });
	assert.deepEqual(first.chats.map(chat => chat.id), ["c-chat", "a-chat"]);
	assert.notEqual(first.nextCursor, null);
	const second = await listOf(tab, { query: "plan", limit: 2, cursor: first.nextCursor! });
	assert.deepEqual(second.chats.map(chat => chat.id), ["b-chat"]);
	assert.equal(second.nextCursor, null);
	assert.deepEqual(await listOf(tab, { query: "plan", limit: 2 }), first);
	assert.deepEqual(Object.keys(first).sort(), ["chats", "nextCursor", "untrustedDataNotice"]);
	const all = await listOf(tab, {});
	assert.equal(all.chats.find(chat => chat.id === "e-chat")?.status, "open");
	assert.equal(all.chats.find(chat => chat.id === "d-chat")?.status, "closed");
	assert.equal((await listOf(tab, { query: "E-CHAT" })).chats.length, 1);
	await assert.rejects(listOf(tab, { cursor: "garbage" }), /cursor_invalid/);
});

it("list_chats marks a dead owner closed and a silent live owner unknown, never closed", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const dir = tempDir(t);
	const net = fakeNet();
	const alive = new Set([100, 200]);
	const tab = openTab({ dir, net, isAlive: pid => alive.has(pid) }, "live-chat");
	await tab.fire("session_start", { reason: "startup" });
	const owner = { state: "open" as const, pid: 200, instanceId: "x", generation: "g1", secret: "s" };
	const silentServer = await startServer(net, { secret: "s", generation: () => "g1", instanceId: "x" }, {});
	net.silent.add(silentServer.port);
	const stranger = await startServer(net, { secret: "s", generation: () => "g1", instanceId: "someone-else" }, {});
	writeEntry(dir, closed("silent-chat", null, 5, { ...owner, port: silentServer.port }));
	writeEntry(dir, closed("dead-chat", null, 4, { ...owner, pid: 300, port: silentServer.port }));
	// The process id is alive but was reused: nothing listens, or someone else answers.
	writeEntry(dir, closed("reused-refused", null, 3, { ...owner, port: 59999 }));
	writeEntry(dir, closed("reused-other", null, 2, { ...owner, port: stranger.port }));
	const pending = listOf(tab, {});
	await new Promise(resolve => setImmediate(resolve));
	t.mock.timers.tick(50);
	const statuses = Object.fromEntries((await pending).chats.map(chat => [chat.id, chat.status]));
	assert.deepEqual(statuses, {
		"live-chat": "open", "silent-chat": "unknown", "dead-chat": "closed", "reused-refused": "closed", "reused-other": "closed",
	});
});

it("the channel needs the secret and the generation and rebuilds a large answer from bounded frames", async () => {
	const net = fakeNet();
	let generation = "g1";
	const big = "ж\u0001\"x".repeat(60_000);
	const server = await startServer(net, { secret: "s3", generation: () => generation, instanceId: "me" }, { big: () => ({ big }) });
	const target = { port: server.port, secret: "s3", generation: "g1" };
	assert.deepEqual(await request(net, { ...target, secret: "nope" }, "big", undefined, 50), { ok: false, code: "unauthorized" });
	assert.deepEqual(await request(net, target, "missing", undefined, 50), { ok: false, code: "unknown_op" });
	assert.deepEqual(await request(net, target, "big", undefined, 50), { ok: true, result: { big } });
	assert.ok(net.written.length > 3);
	assert.ok(net.written.every(frame => frame.length <= 64 * 1024));
	generation = "g2";
	assert.deepEqual(await request(net, target, "big", undefined, 50), { ok: false, code: "stale_generation" });
	// Identity is public: it needs neither secret nor generation.
	assert.deepEqual(await request(net, { port: server.port, secret: "", generation: "" }, "who", undefined, 50), { ok: true, result: { instanceId: "me", generation: "g2" } });
	server.close();
	assert.deepEqual(await request(net, target, "big", undefined, 50), { ok: false, code: "refused" });
});

it("a requested page of any size arrives complete; there is no extra size limit", async () => {
	const net = fakeNet();
	const page = "x".repeat(9 * 1024 * 1024);
	const server = await startServer(net, { secret: "s", generation: () => "g", instanceId: "me" }, { page: () => page });
	assert.deepEqual(await request(net, { port: server.port, secret: "s", generation: "g" }, "page", undefined, 5000), { ok: true, result: page });
});

function sessions(t: TestContext) {
	const root = tempDir(t);
	const file = (dir: string, id: string) => {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, `2026_${id}.jsonl`), `${JSON.stringify({ type: "session", id })}\n{"type":"message"}\n`);
	};
	return { root, file };
}

it("an unregistered session file is closed with an open hint; only a complete empty search is not_found", async (t) => {
	const { root, file } = sessions(t);
	const dir = tempDir(t);
	const live = { check: async () => "unknown" as const };
	const env = { dir, live, fs: nodeSessionFs, defaultRoot: join(root, "default"), extraRoots: [] as string[] };
	file(join(root, "default", "--work--"), "chat-z");
	const found = await resolveChat("chat-z", env);
	assert.equal(found.kind, "closed");
	assert.match((found as { openHint: string }).openHint, /\/resume.*pi --session chat-z$/);
	file(join(root, "custom"), "chat-y");
	const custom = await resolveChat("chat-y", { ...env, extraRoots: [join(root, "custom")] });
	assert.match((custom as { openHint: string }).openHint, /pi --session chat-y --session-dir/);
	assert.deepEqual(await resolveChat("chat-none", env), { kind: "not_found" });
	const broken: SessionFs = { ...nodeSessionFs, list: () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); } };
	assert.deepEqual(await resolveChat("chat-none", { ...env, fs: broken }), { kind: "unknown" });
});

it("an open registered chat resolves by its owner's answer; a silent owner is unknown", async (t) => {
	const dir = tempDir(t);
	const { root } = sessions(t);
	writeEntry(dir, closed("chat-o", null, 1, { state: "open", pid: 5, instanceId: "i", port: 1, secret: "s", generation: "g" }));
	const env = (verdict: "alive" | "unknown") => ({
		dir, live: { check: async () => verdict }, fs: nodeSessionFs, defaultRoot: root, extraRoots: [],
	});
	assert.equal((await resolveChat("chat-o", env("alive"))).kind, "open");
	assert.deepEqual(await resolveChat("chat-o", env("unknown")), { kind: "unknown" });
});
