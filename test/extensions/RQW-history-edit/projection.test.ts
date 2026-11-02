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
