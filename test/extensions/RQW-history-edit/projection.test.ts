import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import * as Pi from "@earendil-works/pi-coding-agent";
import {
	installSafeProjection,
	safeContextEntries,
	safeSessionProjection,
	SAFE_PROJECTION,
	uninstallSafeProjection,
} from "../../../extensions/RQW-history-edit/projection.ts";

type Entry = { id: string; parentId: string | null; type: string; [key: string]: any };

// Whatever a test or another file installed on the real prototype, Pi's own methods come back.
afterEach(() => uninstallSafeProjection(Pi.SessionManager.prototype as never));

// Pi's free functions with loose entry types.
const stockPi = Pi as unknown as { buildContextEntries(...args: any[]): any; buildSessionProjection(...args: any[]): any };

const STAMP = "2026-01-01T00:00:00.000Z";
const INSTALLED = Symbol.for("rqw-history-edit/safe-projection");
// Well above Pi's argument limit for push(...), which is about 120000 on Node.
const BIG_TAIL = 200_000;

const user = (id: string, parentId: string | null, text: string): Entry =>
	({ type: "message", id, parentId, timestamp: STAMP, message: { role: "user", content: text, timestamp: 1 } });
const assistant = (id: string, parentId: string, text: string): Entry => ({
	type: "message", id, parentId, timestamp: STAMP,
	message: { role: "assistant", content: [{ type: "text", text }], provider: "p", model: "m", timestamp: 1 },
});
const system = (id: string, parentId: string | null): Entry =>
	({ type: "message", id, parentId, timestamp: STAMP, message: { role: "system", content: "rules", timestamp: 1 } });
const compaction = (id: string, parentId: string, firstKeptEntryId: string): Entry =>
	({ type: "compaction", id, parentId, timestamp: STAMP, summary: `sum ${id}`, firstKeptEntryId, tokensBefore: 1 });
const edit = (id: string, parentId: string, targetId: string, replacement: unknown): Entry =>
	({ type: "context_edit", id, parentId, timestamp: STAMP, targetId, replacement });
const custom = (id: string, parentId: string): Entry => ({ type: "custom_message", id, parentId, timestamp: STAMP, customType: "x", content: "c", display: false });

/** One compaction followed by a long tail of custom messages, the shape of a session full of subagent records. */
let cachedBig: Entry[] | undefined;
function bigSession(): Entry[] {
	if (cachedBig) return cachedBig;
	const entries: Entry[] = [user("a", null, "one"), user("b", "a", "two"), compaction("c", "b", "b")];
	let parent = "c";
	for (let i = 0; i < BIG_TAIL; i++) {
		const id = `t${i}`;
		entries.push(custom(id, parent));
		parent = id;
	}
	return cachedBig = entries;
}

function restoreOffer(previous: unknown): void {
	if (previous === undefined) delete (globalThis as Record<symbol, unknown>)[SAFE_PROJECTION];
	else (globalThis as Record<symbol, unknown>)[SAFE_PROJECTION] = previous;
}

/** Pi's own free functions behind the three manager methods, as a stand-in prototype. */
function fakePrototype(counter?: { calls: number }): Record<string | symbol, any> {
	return {
		buildContextEntries(this: any) { if (counter) counter.calls++; return stockPi.buildContextEntries(this.getEntries(), this.leafId, this.byId); },
		buildSessionProjection(this: any) { if (counter) counter.calls++; return stockPi.buildSessionProjection(this.getEntries(), this.leafId, this.byId); },
	};
}

function managerOf(entries: Entry[], leafId: string | null | undefined = entries.at(-1)?.id) {
	return { getEntries: () => entries.slice(), leafId, byId: new Map(entries.map((entry) => [entry.id, entry])) };
}

const SMALL_BRANCHES: Array<[string, Entry[], string | null | undefined]> = [
	["a plain branch", [user("a", null, "one"), assistant("b", "a", "two")], "b"],
	["no leaf given", [user("a", null, "one"), assistant("b", "a", "two")], undefined],
	["an empty branch", [user("a", null, "one")], null],
	["a compaction that keeps older entries", [user("a", null, "one"), system("s", "a"), user("b", "s", "two"), compaction("c", "b", "b"), user("d", "c", "three")], "d"],
	["two compactions", [user("a", null, "one"), compaction("c1", "a", "a"), user("b", "c1", "two"), compaction("c2", "b", "a"), user("d", "c2", "three")], "d"],
	["a side branch", [user("a", null, "one"), user("x", "a", "side"), user("b", "a", "two")], "b"],
	["edits of both kinds", [user("a", null, "one"), assistant("b", "a", "two"), edit("e1", "b", "a", { content: "new" }), edit("e2", "e1", "b", { content: "plain" }), edit("e3", "e2", "a", null)], "e3"],
	["settings entries", [
		{ type: "model_change", id: "m", parentId: null, timestamp: STAMP, provider: "p", modelId: "x" },
		{ type: "thinking_level_change", id: "t", parentId: "m", timestamp: STAMP, thinkingLevel: "high" },
		user("a", "t", "one"), assistant("b", "a", "two")], "b"],
];

for (const [name, entries, leaf] of SMALL_BRANCHES) {
	it(`the safe projection equals Pi's for ${name}`, () => {
		const manager = managerOf(entries, leaf);
		assert.deepEqual(safeContextEntries(manager.getEntries(), manager.leafId, manager.byId), stockPi.buildContextEntries(manager.getEntries(), manager.leafId, manager.byId));
		assert.deepEqual(safeSessionProjection(manager.getEntries(), manager.leafId, manager.byId), stockPi.buildSessionProjection(manager.getEntries(), manager.leafId, manager.byId));
		// Without the entry index, as the direct callers use it.
		assert.deepEqual(safeSessionProjection(manager.getEntries(), manager.leafId), stockPi.buildSessionProjection(manager.getEntries(), manager.leafId));
	});
}

it("a long tail after a compaction overflows Pi and projects with the installed patch", () => {
	const entries = bigSession();
	const manager = managerOf(entries);
	assert.throws(() => stockPi.buildContextEntries(entries, manager.leafId, manager.byId), RangeError);
	const proto = fakePrototype();
	const previous = (globalThis as Record<symbol, unknown>)[SAFE_PROJECTION];
	try {
		assert.equal(installSafeProjection(proto), true);
		const context = proto.buildContextEntries.call(manager) as Entry[];
		assert.equal(context.length, BIG_TAIL + 2);
		assert.equal(context[0]!.id, "c");
		assert.equal(context[1]!.id, "b");
		assert.equal(context.at(-1)!.id, `t${BIG_TAIL - 1}`);
		const projection = proto.buildSessionProjection.call(manager);
		assert.equal(projection.entries.length, context.length);
		assert.equal(projection.messages.length, BIG_TAIL + 2);
		assert.equal(projection.messages[0].role, "compactionSummary");
	} finally { restoreOffer(previous); }
});

it("the real SessionManager projects a long tail while the patch is installed, and the prototype is restored", () => {
	const proto = Pi.SessionManager.prototype as unknown as Record<string | symbol, any>;
	uninstallSafeProjection(proto);
	const stock = { context: proto.buildContextEntries, projection: proto.buildSessionProjection };
	try {
		assert.throws(() => Pi.SessionManager.inMemory("/tmp", undefined, bigSession() as never).buildContextEntries(), RangeError);
		assert.equal(installSafeProjection(proto), true);
		const manager = Pi.SessionManager.inMemory("/tmp", undefined, bigSession() as never);
		assert.equal(manager.buildContextEntries().length, BIG_TAIL + 2);
		assert.equal(manager.buildSessionProjection().messages.length, BIG_TAIL + 2);
		assert.equal(manager.buildSessionContext().messages.length, BIG_TAIL + 2);
		manager.appendCustomMessageEntry("x", "later", false);
		assert.equal(manager.buildContextEntries().length, BIG_TAIL + 3);
	} finally {
		uninstallSafeProjection(proto);
	}
	assert.equal(proto.buildContextEntries, stock.context);
	assert.equal(proto.buildSessionProjection, stock.projection);
	assert.equal(INSTALLED in proto, false);
	assert.equal((globalThis as Record<symbol, unknown>)[SAFE_PROJECTION], undefined);
});

it("a small session keeps Pi's own result and a manager that overflowed once skips the stock call", () => {
	const counter = { calls: 0 };
	const proto = fakePrototype(counter);
	const previous = (globalThis as Record<symbol, unknown>)[SAFE_PROJECTION];
	try {
		const probeCalls = () => { const before = counter.calls; installSafeProjection(proto); return counter.calls - before; };
		assert.ok(probeCalls() >= 2, "the install probe compares Pi's two methods");
		counter.calls = 0;
		const small = managerOf(SMALL_BRANCHES[3]![1], "d");
		assert.deepEqual(proto.buildContextEntries.call(small), stockPi.buildContextEntries(small.getEntries(), "d", small.byId));
		assert.equal(counter.calls, 1);
		counter.calls = 0;
		const big = managerOf(bigSession());
		proto.buildContextEntries.call(big);
		assert.equal(counter.calls, 1, "the first call tries the stock method");
		proto.buildSessionProjection.call(big);
		proto.buildContextEntries.call(big);
		assert.equal(counter.calls, 1, "later calls skip it");
	} finally { restoreOffer(previous); }
});

it("an error that is not a stack overflow is thrown unchanged", () => {
	const proto = fakePrototype();
	const previous = (globalThis as Record<symbol, unknown>)[SAFE_PROJECTION];
	try {
		installSafeProjection(proto);
		const broken = { getEntries: () => { throw new TypeError("broken"); }, leafId: "a", byId: new Map() };
		assert.throws(() => proto.buildSessionProjection.call(broken), TypeError);
	} finally { restoreOffer(previous); }
});

it("the offer projects an entry list directly, with Pi's own result when Pi does not overflow", () => {
	const proto = fakePrototype();
	const previous = (globalThis as Record<symbol, unknown>)[SAFE_PROJECTION];
	try {
		installSafeProjection(proto);
		const offered = (globalThis as Record<symbol, any>)[SAFE_PROJECTION];
		const small = SMALL_BRANCHES[3]![1];
		assert.deepEqual(offered(small, "d"), stockPi.buildSessionProjection(small as never, "d"));
		const big = bigSession();
		assert.equal(offered(big).messages.length, BIG_TAIL + 2);
		assert.equal(offered(big, `t${BIG_TAIL - 1}`).entries.length, BIG_TAIL + 2);
	} finally { restoreOffer(previous); }
});

it("append-only steps project only the appended entries and preserve earlier results", () => {
	installSafeProjection(Pi.SessionManager.prototype as never);
	const manager = Pi.SessionManager.inMemory("/tmp");
	const first = manager.appendMessage(user("unused", null, "one").message);
	manager.appendCustomEntry("state", {});
	const before = manager.buildSessionProjection();
	const context = manager.buildContextEntries();
	let reads = 0;
	const entry = manager.getEntry(first)!;
	Object.defineProperty(entry, "type", { get() { reads++; return "message"; }, configurable: true });
	let walks = 0;
	Object.defineProperty(entry, "parentId", { get() { walks++; return null; }, configurable: true });
	let copies = 0;
	const getEntries = manager.getEntries.bind(manager);
	manager.getEntries = () => { copies++; return getEntries(); };
	manager.appendCustomEntry("state", {});
	manager.appendMessage({ role: "user", content: "two", timestamp: 2 });
	const after = manager.buildSessionProjection();
	const nextContext = manager.buildContextEntries();
	assert.equal(reads, 0, "old entries are not reprojected or rescanned");
	assert.equal(walks, 0, "the manager does not walk the old parent chain");
	assert.equal(copies, 0, "the manager does not copy its whole history");
	assert.equal(before.entries.length, 2);
	assert.equal(before.messages.length, 1);
	assert.equal(context.length, 2);
	assert.equal(after.messages.at(-1)!.content, "two");
	assert.equal(nextContext.length, 4);
	assert.deepEqual(after, stockPi.buildSessionProjection(getEntries(), manager.getLeafId()));
	assert.ok(walks > 0, "the parent counter catches the original full branch walk");
});

it("appends to the cached branch without walking older parents and returns independent lists", () => {
	installSafeProjection(Pi.SessionManager.prototype as never);
	const manager = Pi.SessionManager.inMemory("/tmp");
	const first = manager.appendMessage({ role: "user", content: "one", timestamp: 1 });
	const state = manager.appendCustomEntry("state", {});
	const before = manager.getBranch();
	let walks = 0;
	Object.defineProperty(manager.getEntry(first), "parentId", { get() { walks++; return null; }, configurable: true });
	const tail = manager.appendCustomEntry("state", {});
	const after = manager.getBranch();
	assert.equal(walks, 0, "a new step does not traverse the old branch");
	assert.deepEqual(before.map(entry => entry.id), [first, state]);
	assert.deepEqual(after.map(entry => entry.id), [first, state, tail]);
	after.pop();
	assert.equal(manager.getBranch().length, 3);
	assert.deepEqual(manager.getBranch(first).map(entry => entry.id), [first]);
	assert.ok(walks > 0, "an explicit historical branch uses native traversal");
	manager.branch(first);
	assert.deepEqual(manager.getBranch().map(entry => entry.id), [first]);
	const side = manager.appendCustomEntry("side", {});
	assert.deepEqual(manager.getBranch().map(entry => entry.id), [first, side]);
	manager.resetLeaf();
	assert.deepEqual(manager.getBranch(), []);
	const fresh = manager.appendCustomEntry("fresh", {});
	assert.deepEqual(manager.getBranch().map(entry => entry.id), [fresh]);
	manager.newSession();
	assert.deepEqual(manager.getBranch(), []);
});

it("keeps the cached projection separate from mutable runtime message arrays", () => {
	installSafeProjection(Pi.SessionManager.prototype as never);
	const manager = Pi.SessionManager.inMemory("/tmp");
	manager.appendMessage({ role: "user", content: "one", timestamp: 1 });
	const runtime = manager.buildSessionProjection();
	// Pi assigns projection.messages to agent.state.messages, then pushes message_end events into it.
	runtime.messages.push({ role: "user", content: "not persisted", timestamp: 2 });
	runtime.entries.pop();
	manager.buildContextEntries().pop();
	const expected = () => stockPi.buildSessionProjection(manager.getEntries(), manager.getLeafId());
	assert.deepEqual(manager.buildSessionProjection(), expected());
	manager.appendMessage({ role: "user", content: "two", timestamp: 3 });
	assert.deepEqual(manager.buildSessionProjection(), expected());
	assert.equal(manager.buildContextEntries().length, 2);
});

it("incremental projection rebuilds on edits, compaction, branch changes and session replacement", () => {
	installSafeProjection(Pi.SessionManager.prototype as never);
	const manager = Pi.SessionManager.inMemory("/tmp");
	const first = manager.appendMessage(user("unused", null, "one").message);
	const check = () => {
		assert.deepEqual(manager.buildSessionProjection(), stockPi.buildSessionProjection(manager.getEntries(), manager.getLeafId()));
		assert.deepEqual(manager.buildContextEntries(), stockPi.buildContextEntries(manager.getEntries(), manager.getLeafId()));
	};
	check();
	manager.appendModelChange("p", "new"); check();
	manager.appendThinkingLevelChange("high"); check();
	manager.appendMessage(assistant("unused", first, "reply").message); check();
	manager.appendContextEdit(first, { content: "edited" }); check();
	manager.appendCompaction("sum", first, 1); check();
	manager.appendMessage(user("unused", null, "tail").message); check();
	manager.branch(first); check();
	manager.appendMessage(user("unused", null, "side").message); check();
	manager.resetLeaf(); check();
	manager.newSession(); check();
	manager.appendMessage(user("unused", null, "fresh").message); check();
});

it("a changed Pi shape leaves the stock methods and offers nothing", () => {
	const previous = (globalThis as Record<symbol, unknown>)[SAFE_PROJECTION];
	try {
		delete (globalThis as Record<symbol, unknown>)[SAFE_PROJECTION];
		const missing = { buildContextEntries: fakePrototype().buildContextEntries };
		assert.equal(installSafeProjection(missing), false);
		const frozen = fakePrototype();
		Object.defineProperty(frozen, "buildSessionProjection", { value: frozen.buildSessionProjection, writable: false, configurable: true });
		assert.equal(installSafeProjection(frozen), false);
		const diverging = fakePrototype();
		const stock = diverging.buildContextEntries;
		const divergent = function (this: unknown) { return (stock.call(this) as unknown[]).slice(1); };
		diverging.buildContextEntries = divergent;
		assert.equal(installSafeProjection(diverging), false);
		assert.equal(diverging.buildContextEntries, divergent);
		const renamed = { buildContextEntries() { throw new TypeError("new shape"); }, buildSessionProjection: fakePrototype().buildSessionProjection };
		assert.equal(installSafeProjection(renamed), false);
		assert.equal((globalThis as Record<symbol, unknown>)[SAFE_PROJECTION], undefined);
	} finally { restoreOffer(previous); }
});
