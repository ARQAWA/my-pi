import assert from "node:assert/strict";
import { it } from "node:test";
import { readEntry } from "../../../extensions/RQW-tabs-link/registry.ts";
import { request } from "../../../extensions/RQW-tabs-link/transport.ts";
import { pairOfTabs } from "./harness.ts";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const message = (id: string, role: string, stopReason?: string) => ({
	id, parentId: null, timestamp: "2026-01-01T00:00:00Z", type: "message",
	message: { role, stopReason, content: [{ type: "text", text: id }] },
});

it("returns the next saved final, including the first answer of an empty branch", async t => {
	const { recv, dir, net } = await pairOfTabs(t);
	const entry = readEntry(dir, "recv")!;
	const target = { port: entry.port!, secret: entry.secret!, generation: entry.generation! };
	recv.world.entries.push(message("u", "user"), message("tools", "assistant", "toolUse"), message("a", "assistant", "stop"));
	const result = await request(net, target, "wait_answer", { afterEntryId: "u", timeoutMs: 500 }, 1000);
	assert.equal(result.ok && (result.result as any).entry.id, "a");
	const first = await request(net, target, "wait_answer", { afterEntryId: null, timeoutMs: 500 }, 1000);
	assert.equal(first.ok && (first.result as any).entry.id, "a");
	const missing = await request(net, target, "wait_answer", { afterEntryId: "gone", timeoutMs: 500 }, 1000);
	assert.deepEqual(missing, { ok: true, result: { reason: "target_changed" } });
});

it("respects deleted and replaced history when returning an answer", async t => {
	const { recv, dir, net } = await pairOfTabs(t);
	const entry = readEntry(dir, "recv")!;
	const target = { port: entry.port!, secret: entry.secret!, generation: entry.generation! };
	recv.world.entries.push(message("u", "user"), message("deleted", "assistant", "stop"), message("edited", "assistant", "stop"),
		{ id: "e1", type: "context_edit", targetId: "deleted", replacement: null },
		{ id: "e2", type: "context_edit", targetId: "edited", replacement: { content: [{ type: "text", text: "replacement" }] } });
	const result = await request(net, target, "wait_answer", { afterEntryId: "u", timeoutMs: 500 }, 1000);
	assert.ok(result.ok);
	assert.equal((result.result as any).entry.id, "edited");
	assert.deepEqual((result.result as any).entry.message.content, [{ type: "text", text: "replacement" }]);
});

it("rechecks after subscribing and wakes only for a saved final", async t => {
	const { recv, dir, net } = await pairOfTabs(t);
	const entry = readEntry(dir, "recv")!;
	const target = { port: entry.port!, secret: entry.secret!, generation: entry.generation! };
	recv.world.entries.push(message("u", "user"));
	let reads = 0;
	recv.world.branchReads = () => { if (++reads === 2) recv.world.entries.push(message("race", "assistant", "stop")); };
	const race = await request(net, target, "wait_answer", { afterEntryId: "u", timeoutMs: 500 }, 1000);
	assert.equal(race.ok && (race.result as any).entry.id, "race");
	recv.world.branchReads = undefined;
	const pending = request(net, target, "wait_answer", { afterEntryId: "race", timeoutMs: 500 }, 1000);
	await tick();
	await recv.fire("message_end", { message: message("partial", "assistant", "stop").message });
	recv.world.entries.push(message("tool", "assistant", "toolUse"));
	await recv.fire("turn_end");
	recv.world.entries.push(message("final", "assistant", "stop"));
	await recv.fire("turn_end");
	const result = await pending;
	assert.equal(result.ok && (result.result as any).entry.id, "final");
});

it("removes the subscription when the caller disconnects", async t => {
	const { recv, dir, net } = await pairOfTabs(t);
	const entry = readEntry(dir, "recv")!;
	const target = { port: entry.port!, secret: entry.secret!, generation: entry.generation! };
	let reads = 0;
	recv.world.branchReads = () => { reads++; };
	const controller = new AbortController();
	const pending = request(net, target, "wait_answer", { afterEntryId: null, timeoutMs: 500 }, 1000, controller.signal);
	await tick();
	assert.equal(reads, 2);
	controller.abort();
	assert.deepEqual(await pending, { ok: false, code: "aborted" });
	await tick();
	await recv.fire("turn_end");
	assert.equal(reads, 2);
});

it("times out and unsubscribes without network polling", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { recv, dir, net } = await pairOfTabs(t);
	const entry = readEntry(dir, "recv")!;
	const target = { port: entry.port!, secret: entry.secret!, generation: entry.generation! };
	let reads = 0;
	recv.world.branchReads = () => { reads++; };
	const pending = request(net, target, "wait_answer", { afterEntryId: null, timeoutMs: 25 }, 1000);
	await tick();
	assert.equal(reads, 2);
	t.mock.timers.tick(25);
	assert.deepEqual(await pending, { ok: true, result: { reason: "timeout" } });
	await recv.fire("turn_end");
	assert.equal(reads, 2);
});

it("reports a branch change even when the anchor remains", async t => {
	const { recv, dir, net } = await pairOfTabs(t);
	const entry = readEntry(dir, "recv")!;
	const target = { port: entry.port!, secret: entry.secret!, generation: entry.generation! };
	recv.world.entries.push(message("u", "user"));
	const pending = request(net, target, "wait_answer", { afterEntryId: "u", timeoutMs: 500 }, 1000);
	await tick();
	await recv.fire("session_tree");
	assert.deepEqual(await pending, { ok: true, result: { reason: "target_changed" } });
});
