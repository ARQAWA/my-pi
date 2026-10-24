// Activity text, counts consumption, action phrases and the original-branch number: pure, fixed inputs, no clock.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionPhrase, CountsWatch, countParts, COUNTS_OFFER, COUNTS_REQUEST, statusText } from "../activity.ts";
import { branchNumber, type TreeNodeLike } from "../branch.ts";

type Listener = (counts: { agents: number; reviews: number } | null) => void;

/** A minimal bus with the events semantics the counts contract needs: handlers run on emit, unsubscribe removes them. */
function bus() {
	const handlers = new Map<string, Set<(data: unknown) => void>>();
	return {
		on(channel: string, handler: (data: unknown) => void) {
			const set = handlers.get(channel) ?? new Set();
			set.add(handler);
			handlers.set(channel, set);
			return () => { set.delete(handler); };
		},
		emit(channel: string, data: unknown) { for (const handler of [...(handlers.get(channel) ?? [])]) handler(data); },
	};
}

/** A producer's source over mutable counts; `end` ends it as the contract's `dispose` does. */
function source(start: { agents: number; reviews: number }, version = 1) {
	let current = { ...start };
	let ended = false;
	const listeners = new Set<Listener>();
	const value = {
		version,
		snapshot: () => (ended ? { agents: 0, reviews: 0 } : { ...current }),
		subscribe(listener: Listener) {
			if (ended) { listener(null); return () => {}; }
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
	};
	return {
		value,
		set(next: { agents: number; reviews: number }) {
			current = { ...next };
			for (const listener of listeners) listener(current);
		},
		end() {
			ended = true;
			for (const listener of [...listeners]) listener(null);
			listeners.clear();
		},
	};
}

describe("status text", () => {
	it("is absent when fully idle: no label and no reserved gap", () => {
		assert.equal(statusText({ compacting: false, running: false, counts: { agents: 0, reviews: 0 } }), undefined);
	});

	it("main planning and tool actions, with the counts by kind after the main answer", () => {
		const none = { agents: 0, reviews: 0 };
		assert.deepEqual(statusText({ compacting: false, running: true, counts: none }), { text: "Planning next moves", compacting: false });
		assert.deepEqual(statusText({ compacting: false, running: true, action: "Running npm test", counts: none }),
			{ text: "Running npm test", compacting: false });
		assert.equal(statusText({ compacting: false, running: true, counts: { agents: 2, reviews: 0 } })?.text,
			"Planning next moves · 2 agents");
		assert.equal(statusText({ compacting: false, running: false, counts: { agents: 2, reviews: 1 } })?.text,
			"Waiting for 2 agents, 1 review");
	});

	it("compaction is its own gold status, whatever runs", () => {
		assert.deepEqual(statusText({ compacting: true, running: true, action: "Running npm test",
			counts: { agents: 1, reviews: 0 } }), { text: "Compacting context", compacting: true });
	});

	it("counts are spelled by kind with correct plurals and zero kinds omitted", () => {
		assert.deepEqual(countParts({ agents: 1, reviews: 2 }), ["1 agent", "2 reviews"]);
		assert.deepEqual(countParts({ agents: 0, reviews: 1 }), ["1 review"]);
	});
});

describe("action phrases", () => {
	it("names the running tool by its action, keeping the end of a path", () => {
		assert.equal(actionPhrase("bash", { command: "npm test" }), "Running npm test");
		assert.equal(actionPhrase("edit", { path: "src/app.ts" }), "Editing app.ts");
		assert.equal(actionPhrase("write", { edits: [{ path: "C:\\work\\notes.md" }] }), "Writing notes.md");
		assert.equal(actionPhrase("read", {}), "Reading file");
		assert.equal(actionPhrase("grep", { pattern: "x" }), "Searching files");
		assert.equal(actionPhrase("agent", {}), "Running agent");
	});
});

describe("counts consumption", () => {
	it("requests existing producers, sums live sources by kind, drops ended ones and clears on stop", () => {
		const events = bus();
		const changes: number[] = [];
		const watch = new CountsWatch(events as never, () => changes.push(1));
		const one = source({ agents: 1, reviews: 0 });
		const two = source({ agents: 2, reviews: 1 });
		// A live producer that replies to the request (its load order may be either way round).
		events.on(COUNTS_REQUEST, (request) => (request as { reply(s: unknown): void }).reply(one.value));
		watch.start();
		events.emit(COUNTS_OFFER, { version: 1, source: two.value });
		assert.deepEqual(watch.get(), { agents: 3, reviews: 1 });
		one.set({ agents: 3, reviews: 0 });
		assert.deepEqual(watch.get(), { agents: 5, reviews: 1 });
		two.end();
		assert.deepEqual(watch.get(), { agents: 3, reviews: 0 });
		assert.ok(changes.length >= 3);
		watch.stop();
		assert.deepEqual(watch.get(), { agents: 0, reviews: 0 });
		one.set({ agents: 9, reviews: 0 });
		assert.deepEqual(watch.get(), { agents: 0, reviews: 0 }, "no subscription survives stop");
	});

	it("a source that has already ended is never kept", () => {
		const events = bus();
		const watch = new CountsWatch(events as never, () => undefined);
		watch.start();
		const ended = source({ agents: 4, reviews: 0 });
		ended.end();
		events.emit(COUNTS_OFFER, { version: 1, source: ended.value });
		assert.deepEqual(watch.get(), { agents: 0, reviews: 0 });
	});

	it("only version 1 is adopted, both on the offer and on the source; a source is counted once", () => {
		const events = bus();
		const watch = new CountsWatch(events as never, () => undefined);
		watch.start();
		const future = source({ agents: 5, reviews: 0 }, 2);
		events.emit(COUNTS_OFFER, { version: 1, source: future.value });
		events.emit(COUNTS_OFFER, { version: 2, source: source({ agents: 7, reviews: 0 }).value });
		assert.deepEqual(watch.get(), { agents: 0, reviews: 0 }, "wrong source or offer versions are ignored");
		const one = source({ agents: 1, reviews: 0 });
		events.emit(COUNTS_OFFER, { version: 1, source: one.value });
		events.emit(COUNTS_OFFER, { version: 1, source: one.value });
		assert.deepEqual(watch.get(), { agents: 1, reviews: 0 }, "the same source object is deduplicated");
	});

	it("either load order works: a source offered before the consumer starts is found by the request", () => {
		const events = bus();
		const early = source({ agents: 2, reviews: 0 });
		events.on(COUNTS_REQUEST, (request) => (request as { reply(s: unknown): void }).reply(early.value));
		const watch = new CountsWatch(events as never, () => undefined);
		watch.start();
		assert.deepEqual(watch.get(), { agents: 2, reviews: 0 });
		watch.start();
		assert.deepEqual(watch.get(), { agents: 2, reviews: 0 }, "a second start is idempotent");
	});

	it("without any producer the consumer stays at zero, and stop then start again works", () => {
		const events = bus();
		const watch = new CountsWatch(events as never, () => undefined);
		watch.start();
		watch.stop();
		watch.stop();
		assert.deepEqual(watch.get(), { agents: 0, reviews: 0 });
		const late = source({ agents: 1, reviews: 0 });
		events.on(COUNTS_REQUEST, (request) => (request as { reply(s: unknown): void }).reply(late.value));
		watch.start();
		assert.deepEqual(watch.get(), { agents: 1, reviews: 0 });
	});
});

// A tree: r is the root; a1 is the first user message on the earliest chain r-a1-a2, which forks into a3 (earliest) and c3;
// r forks again into b1 (second child of r).
const node = (id: string, children: TreeNodeLike[] = [], user = false): TreeNodeLike => ({
	entry: user ? { id, type: "message", message: { role: "user" } } : { id, type: "message", message: { role: "assistant" } },
	children,
});
const tree = (): TreeNodeLike[] => [node("r", [
	node("a1", [node("a2", [node("a3"), node("c3")])], true),
	node("b1", [node("b2")], true),
])];

describe("original branch and sibling number", () => {
	it("is the path to the first user message, then the earliest children: no mark on it or on its ancestors", () => {
		assert.equal(branchNumber(tree(), "a3"), undefined);
		assert.equal(branchNumber(tree(), "a2"), undefined);
		assert.equal(branchNumber(tree(), "a1"), undefined, "an ancestor of the original leaf is on the original branch");
		assert.equal(branchNumber(tree(), "r"), undefined);
	});

	it("numbers the sibling branch where the leaf leaves the original branch, 1-based by creation order", () => {
		assert.equal(branchNumber(tree(), "c3"), 2, "c3 is the second child of a2, after the original a3");
		assert.equal(branchNumber(tree(), "b2"), 2, "b1 is the second child of the root");
	});

	it("a fork with three children numbers each off-original child by its creation position", () => {
		const t = tree();
		t[0].children[0].children[0].children.push(node("d3"));
		assert.equal(branchNumber(t, "d3"), 3);
		assert.equal(branchNumber(t, "c3"), 2);
	});

	it("nested: a branch inside a branch is numbered at its outermost divergence from the original", () => {
		const t = tree();
		const c3 = t[0].children[0].children[0].children[1];
		c3.children.push(node("c4"), node("c5"));
		assert.equal(branchNumber(t, "c5"), 2);
		assert.equal(branchNumber(t, "c4"), 2);
	});

	it("back: returning to an original ancestor removes the mark again", () => {
		const t = tree();
		assert.equal(branchNumber(t, "c3"), 2);
		assert.equal(branchNumber(t, "a2"), undefined);
	});

	it("new fork: a user message appended under an original ancestor is a new numbered branch", () => {
		const t = tree();
		const a1 = t[0].children[0];
		a1.children.push(node("x1", [], true));
		assert.equal(branchNumber(t, "x1"), 2, "a1 has the original a2 first and the new branch second");
	});

	it("resume: a tree rebuilt from the same entries gives the same number; the leaf alone decides", () => {
		assert.equal(branchNumber(tree(), "c3"), branchNumber(tree(), "c3"));
		assert.equal(branchNumber(tree(), "b2"), 2);
	});

	it("without a user message the original is the earliest chain from the root", () => {
		const plain: TreeNodeLike[] = [node("r", [node("x", [node("y")]), node("z")])];
		assert.equal(branchNumber(plain, "y"), undefined);
		assert.equal(branchNumber(plain, "z"), 2);
	});

	it("a branch that starts before the first user message is numbered at its fork", () => {
		const early: TreeNodeLike[] = [node("r", [node("p", [node("p2")]), node("q", [], true)])];
		assert.equal(branchNumber(early, "p2"), 1, "the first user message q is the original; p is off it at the fork");
	});

	it("treats replacement roots as siblings of a virtual session root in creation order", () => {
		const order = ["original", "answer", "replacement", "reply"];
		const build = () => [node("replacement", [node("reply")], true), node("original", [node("answer")], true)];
		assert.equal(branchNumber(build(), "answer", order), undefined);
		assert.equal(branchNumber(build(), "replacement", order), 2);
		assert.equal(branchNumber(build(), "reply", order), 2, "reconstructed tree retains the root divergence");
		assert.equal(branchNumber(build(), "answer", order), undefined, "return hides the mark");
		assert.equal(branchNumber([...build()].reverse(), "reply"), 2, "tree order is the fallback without ranks");
	});

	it("is undefined without a leaf or a tree", () => {
		assert.equal(branchNumber([], "a1"), undefined);
		assert.equal(branchNumber(tree(), null), undefined);
		assert.equal(branchNumber(tree(), "missing"), undefined);
	});

	it("the first user message is the earliest created one, even when a metadata branch created earlier gets a later user", () => {
		// Creation order: r, metadata child a, user b, then a's user ua (created after b). The tree lists a before b.
		const order = ["r", "a", "b", "ua"];
		const build = (childOrder: "a-first" | "b-first"): TreeNodeLike[] => {
			const meta = node("a", [node("ua", [], true)]);
			const userB = node("b", [], true);
			return [node("r", childOrder === "a-first" ? [meta, userB] : [userB, meta])];
		};
		for (const childOrder of ["a-first", "b-first"] as const) {
			const t = build(childOrder);
			assert.equal(branchNumber(t, "b", order), undefined, `${childOrder}: b is the original first user`);
			assert.equal(branchNumber(t, "ua", order), 1, `${childOrder}: a is the sibling 1 by creation order`);
			assert.equal(branchNumber(t, "a", order), 1, `${childOrder}: the metadata branch is off the original too`);
		}
		// Without an order the tree's own child order decides, as before: a is met first and becomes the original.
		assert.equal(branchNumber(build("a-first"), "ua"), undefined);
		assert.equal(branchNumber(build("a-first"), "b"), 2);
	});
});
