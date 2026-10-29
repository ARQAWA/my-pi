import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";
import { acquire, lockDir, type Owner, release, topOwner } from "../../../extensions/RQW-tabs-link/ownership.ts";
import { listEntries, readEntry, writeEntry } from "../../../extensions/RQW-tabs-link/registry.ts";
import { startServer } from "../../../extensions/RQW-tabs-link/transport.ts";
import { fakeNet, openTab, tempDir } from "./harness.ts";

const writeLock = (dir: string, id: string, epoch: number, owner: Owner | string) => {
	mkdirSync(join(lockDir(dir, id), String(epoch)), { recursive: true });
	writeFileSync(join(lockDir(dir, id), String(epoch), "owner.json"), typeof owner === "string" ? owner : JSON.stringify(owner));
};

it("a visible chat registers, follows its title and is closed with metadata only on shutdown", async (t) => {
	const dir = tempDir(t);
	const tab = openTab({ dir }, "chat-a");
	await tab.fire("session_start", { reason: "startup" });
	assert.equal(readEntry(dir, "chat-a")?.state, "open");
	assert.equal(readEntry(dir, "chat-a")?.title, null);
	await tab.fire("session_info_changed", { name: "Plan" });
	assert.equal(readEntry(dir, "chat-a")?.title, "Plan");
	await tab.fire("session_shutdown", { reason: "quit" });
	const closed = readEntry(dir, "chat-a")!;
	assert.equal(closed.state, "closed");
	assert.equal(closed.title, "Plan");
	assert.equal(closed.pid, undefined);
	assert.equal(topOwner(dir, "chat-a"), undefined);
});

it("non-TUI modes (print, rpc, json) register nothing: no entry and no tools", async (t) => {
	const dir = tempDir(t);
	const tab = openTab({ dir }, "chat-a");
	for (const mode of ["print", "rpc", "json"]) await tab.fire("session_start", { reason: "startup" }, mode);
	assert.deepEqual(listEntries(dir), []);
	assert.deepEqual(tab.tools, []);
});

it("a second tab with the same chat stays off and warns; the owner keeps it", async (t) => {
	const dir = tempDir(t);
	const net = fakeNet();
	const first = openTab({ dir, net }, "chat-a", { pid: 100 });
	const second = openTab({ dir, net }, "chat-a", { pid: 200, newId: () => "instance-two" });
	await first.fire("session_start", { reason: "startup" });
	await second.fire("session_start", { reason: "startup" });
	assert.match(second.notices[0], /already open in another tab/);
	await second.fire("session_info_changed", { name: "Intruder" });
	await second.fire("session_shutdown", { reason: "quit" });
	assert.equal(readEntry(dir, "chat-a")?.state, "open");
	assert.equal(readEntry(dir, "chat-a")?.title, null);
	assert.equal((topOwner(dir, "chat-a") as Owner).instanceId, "instance-chat-a");
});

it("two tabs recovering one dead lock at the same time end with exactly one owner", async (t) => {
	const dir = tempDir(t);
	writeLock(dir, "chat-a", 1, { pid: 1, instanceId: "dead", generation: "g0", port: 1 });
	// The check yields, so both acquirers have judged the old lock dead before either replaces it.
	const check = async (owner: Owner) => { await new Promise(resolve => setImmediate(resolve)); return owner.instanceId === "dead" ? "dead" as const : "alive" as const; };
	const mine = (name: string): Owner => ({ pid: 2, instanceId: name, generation: `g-${name}`, port: 2 });
	const results = await Promise.all([acquire(dir, "chat-a", mine("a"), check), acquire(dir, "chat-a", mine("b"), check)]);
	assert.equal(results.filter(result => result.ok).length, 1);
	assert.deepEqual(results.find(result => !result.ok), { ok: false, reason: "duplicate", owner: results[0].ok ? mine("a") : mine("b") });
	assert.equal((topOwner(dir, "chat-a") as Owner).instanceId, results[0].ok ? "a" : "b");
});

it("a lock of a dead process is taken over; an unreadable one needs the user", async (t) => {
	const dir = tempDir(t);
	const dead = openTab({ dir }, "chat-a", { pid: 100 });
	await dead.fire("session_start", { reason: "startup" });
	const next = openTab({ dir, net: fakeNet() }, "chat-a", { pid: 200, newId: () => "instance-two", isAlive: pid => pid === 200 });
	await next.fire("session_start", { reason: "startup" });
	assert.deepEqual(next.notices, []);
	assert.equal(readEntry(dir, "chat-a")?.pid, 200);
	const broken = tempDir(t);
	writeLock(broken, "chat-b", 1, "{not json");
	const stuck = openTab({ dir: broken }, "chat-b", { isAlive: () => false });
	await stuck.fire("session_start", { reason: "startup" });
	assert.match(stuck.notices[0], /unreadable.*by hand/);
	assert.equal(readEntry(broken, "chat-b"), undefined);
});

it("a reused process id does not keep a lock: a refused connection or another identity ends it, silence does not", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const net = fakeNet();
	const stale = (port: number): Owner => ({ pid: 100, instanceId: "ghost", generation: "g", port });
	const stranger = await startServer(net, { secret: "s", generation: () => "g", instanceId: "someone-else" }, {});
	const quiet = await startServer(net, { secret: "s", generation: () => "g", instanceId: "ghost" }, {});
	net.silent.add(quiet.port);
	for (const [port, taken] of [[59999, true], [stranger.port, true], [quiet.port, false]] as const) {
		const dir = tempDir(t);
		writeLock(dir, "chat-a", 1, stale(port));
		const tab = openTab({ dir, net, isAlive: () => true }, "chat-a");
		const started = tab.fire("session_start", { reason: "startup" });
		await new Promise(resolve => setImmediate(resolve));
		t.mock.timers.tick(50);
		await started;
		assert.equal(readEntry(dir, "chat-a")?.state === "open", taken, `port ${port}`);
		if (!taken) assert.match(tab.notices[0], /could not be confirmed/);
	}
});

it("every session start gets a fresh generation token, never a counter that repeats after the extension is recreated", async (t) => {
	const dir = tempDir(t);
	const tokens = ["token-1", "token-2", "token-3"];
	const make = () => openTab({ dir }, "chat-a", { newGeneration: () => tokens.shift()! });
	const first = make();
	await first.fire("session_start", { reason: "startup" });
	assert.equal(readEntry(dir, "chat-a")?.generation, "token-1");
	await first.fire("session_shutdown", { reason: "new" });
	// Pi builds a new extension instance for the replacing session.
	const second = make();
	await second.fire("session_start", { reason: "new" });
	assert.equal(readEntry(dir, "chat-a")?.generation, "token-2");
	await second.fire("session_shutdown", { reason: "reload" });
	await second.fire("session_start", { reason: "reload" });
	assert.equal(readEntry(dir, "chat-a")?.generation, "token-3");
});

it("switching chats closes the old one, opens the new one and refuses a chat held by a live tab", async (t) => {
	const dir = tempDir(t);
	const net = fakeNet();
	const other = openTab({ dir, net }, "chat-b", { pid: 300 });
	await other.fire("session_start", { reason: "startup" });
	const tab = openTab({ dir, net }, "chat-a", { pid: 100, newId: () => "instance-main" });
	await tab.fire("session_start", { reason: "startup" });
	assert.deepEqual(await tab.fire("session_before_switch", { reason: "resume", targetSessionFile: "/sessions/chat-b.jsonl" }), { cancel: true });
	assert.equal(await tab.fire("session_before_switch", { reason: "resume", targetSessionFile: "/sessions/chat-c.jsonl" }), undefined);
	await tab.fire("session_shutdown", { reason: "resume" });
	tab.session.id = "chat-c";
	tab.session.file = "/sessions/chat-c.jsonl";
	await tab.fire("session_start", { reason: "resume" });
	assert.equal(readEntry(dir, "chat-a")?.state, "closed");
	assert.equal(readEntry(dir, "chat-c")?.state, "open");
	assert.notEqual(readEntry(dir, "chat-c")?.generation, undefined);
});

it("a reload releases the chat and the new instance takes it again", async (t) => {
	const dir = tempDir(t);
	const before = openTab({ dir }, "chat-a", { newId: () => "instance-old" });
	await before.fire("session_start", { reason: "startup" });
	await before.fire("session_shutdown", { reason: "reload" });
	const after = openTab({ dir }, "chat-a", { newId: () => "instance-new" });
	await after.fire("session_start", { reason: "reload" });
	assert.deepEqual(after.notices, []);
	assert.equal(readEntry(dir, "chat-a")?.instanceId, "instance-new");
});

for (const verdict of ["alive", "dead"] as const) {
	it(`a delayed step never removes a replacement lock that reuses its epoch number (verdict ${verdict})`, async (t) => {
		const dir = tempDir(t);
		writeLock(dir, "chat-a", 1, { pid: 1, instanceId: "dead", generation: "g0", port: 1 });
		const a: Owner = { pid: 2, instanceId: "a", generation: "ga", port: 2 };
		const q: Owner = { pid: 3, instanceId: "q", generation: "gq", port: 3 };
		let calls = 0;
		const check = async (owner: Owner) => {
			calls++;
			if (calls === 1) return "dead" as const;
			if (calls === 2) {
				// While a verifies the old lock: a's lock is released and another tab takes the very same epoch number.
				release(dir, "chat-a", a);
				writeLock(dir, "chat-a", 2, q);
				return verdict;
			}
			return owner.instanceId === "q" ? "alive" as const : "dead" as const;
		};
		const result = await acquire(dir, "chat-a", a, check);
		assert.equal(result.ok, false);
		assert.equal((topOwner(dir, "chat-a") as Owner).instanceId, "q");
	});
}

it("a successor that takes the chat while the old tab shuts down keeps its open entry and its lock", async (t) => {
	const dir = tempDir(t);
	const net = fakeNet();
	const tab = openTab({ dir, net }, "chat-a");
	await tab.fire("session_start", { reason: "startup" });
	const successor: Owner = { pid: 9, instanceId: "next", generation: "gn", port: 9 };
	// The moment the old channel stops answering, the successor sees a refused connection and takes the chat.
	net.onServerClose = () => {
		writeLock(dir, "chat-a", 2, successor);
		writeEntry(dir, { id: "chat-a", title: "Successor", cwd: "/work", updatedAt: 99, state: "open", ...successor });
	};
	await tab.fire("session_shutdown", { reason: "quit" });
	assert.deepEqual([readEntry(dir, "chat-a")?.state, readEntry(dir, "chat-a")?.instanceId], ["open", "next"]);
	assert.equal((topOwner(dir, "chat-a") as Owner).instanceId, "next");
});

it("a tab that lost its lock never overwrites the successor's entry", async (t) => {
	const dir = tempDir(t);
	const tab = openTab({ dir }, "chat-a");
	await tab.fire("session_start", { reason: "startup" });
	// A successor took the chat and registered itself.
	const successor: Owner = { pid: 9, instanceId: "next", generation: "gn", port: 9 };
	writeLock(dir, "chat-a", 2, successor);
	writeEntry(dir, { id: "chat-a", title: "Successor", cwd: "/work", updatedAt: 99, state: "open", ...successor });
	await tab.fire("session_info_changed", { name: "Old tab rename" });
	await tab.fire("session_shutdown", { reason: "quit" });
	assert.deepEqual([readEntry(dir, "chat-a")?.state, readEntry(dir, "chat-a")?.title, readEntry(dir, "chat-a")?.instanceId], ["open", "Successor", "next"]);
	assert.equal((topOwner(dir, "chat-a") as Owner).instanceId, "next");
});
