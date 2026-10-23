// Deterministic checks of the RQW-codex durable wire history. Fake session tree, no network, no credentials.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HISTORY_CUSTOM_TYPE, WireHistory, type WireSession, type WireSessionEntry, scopeDigest } from "../history.ts";

/** Minimal SessionManager-like tree: entries form a parent chain; the leaf moves on append and on setLeaf. */
function fakeSession() {
	const entries: WireSessionEntry[] = [];
	let leaf: string | null = null;
	let counter = 0;
	const session: WireSession & { entries: WireSessionEntry[]; setLeaf(id: string | null): void; pushMessage(text: string): string } = {
		entries,
		appendCustomEntry(customType, data) {
			const id = `e${++counter}`;
			entries.push({ id, type: "custom", customType, data: structuredClone(data), parentId: leaf } as WireSessionEntry);
			leaf = id;
			return id;
		},
		pushMessage(text: string) {
			const id = `m${++counter}`;
			entries.push({ id, type: "message", data: { text }, parentId: leaf } as WireSessionEntry);
			leaf = id;
			return id;
		},
		getBranch(fromId?: string) {
			const byId = new Map(entries.map((e) => [e.id, e]));
			const path: WireSessionEntry[] = [];
			let cursor: string | null = fromId ?? leaf;
			while (cursor) {
				const entry = byId.get(cursor) as (WireSessionEntry & { parentId?: string | null }) | undefined;
				if (!entry) break;
				path.unshift(entry);
				cursor = entry.parentId ?? null;
			}
			return path;
		},
		getLeafId: () => leaf,
		setLeaf(id) {
			leaf = id;
		},
	};
	return session;
}

const scope = { runtimeId: "rt-1", threadId: "thread-1", ownerId: "acct-A" };
const MODEL = "hash-model-1";

function history(session: ReturnType<typeof fakeSession>, overrides: Partial<{ scope: typeof scope; modelHash: string }> = {}) {
	let n = 0;
	return new WireHistory({ session, scope: overrides.scope ?? scope, modelHash: overrides.modelHash ?? MODEL, newId: () => `att-${++n}` });
}

const msg = (text: string) => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });

describe("WireHistory raw fidelity and ancestry", () => {
	it("replays completed items exactly, including encrypted reasoning and raw argument strings", () => {
		const session = fakeSession();
		const wh = history(session);
		const attempt = wh.beginAttempt("a1");
		const rawArgs = '{"cmd":"ls \\"x\\"","n":1}  ';
		const reasoning = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "ENC==+/" };
		const call = { type: "function_call", call_id: "call_1", name: "bash", arguments: rawArgs, namespace: "functions" };
		const phased = { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "hi" }] };
		const unknown = { type: "future_native_item", payload: { keep: [1, "two"] } };
		attempt.addItem(reasoning);
		attempt.addItem(call);
		attempt.addItem(phased);
		attempt.addItem(unknown);
		attempt.complete("resp-1");
		const items = wh.projection().map((e) => e.item);
		assert.deepEqual(items, [reasoning, call, phased, unknown]);
		assert.equal((items[1] as { arguments: string }).arguments, rawArgs);
	});

	it("keeps response ids as provenance only, never as projection content", () => {
		const session = fakeSession();
		const wh = history(session);
		const attempt = wh.beginAttempt("a1");
		attempt.addItem({ type: "message", role: "assistant", content: [] });
		attempt.complete("resp-secret");
		const loaded = wh.load();
		assert.equal(loaded.mode, "native");
		assert.equal(JSON.stringify(loaded.items).includes("resp-secret"), false);
		assert.equal(loaded.checkpointResponseId, null);
	});

	it("fork and tree navigation follow branch ancestry, not the global latest entry", () => {
		const session = fakeSession();
		const wh = history(session);
		wh.beginAttempt("a1").addItem(msg("one"));
		const forkPoint = session.getLeafId();
		wh.beginAttempt("a2").addItem(msg("two"));
		assert.equal(wh.projection().length, 2);
		assert.equal(wh.projection(forkPoint).length, 1);
		session.setLeaf(forkPoint);
		wh.beginAttempt("a3").addItem(msg("three"));
		const texts = wh.projection().map((e) => (e.item.content as Array<{ text: string }>)[0].text);
		assert.deepEqual(texts, ["one", "three"]);
	});

	it("an entry removed from the branch no longer affects the projection; physical entries stay", () => {
		const session = fakeSession();
		const wh = history(session);
		session.pushMessage("pi user message");
		wh.beginAttempt("a1").addItem(msg("kept"));
		const removedAt = session.getLeafId();
		wh.beginAttempt("a2").addItem(msg("dropped"));
		const before = session.entries.length;
		session.setLeaf(removedAt);
		assert.equal(wh.projection().length, 1);
		assert.equal(session.entries.length, before, "original physical entries are never removed or rewritten");
	});

	it("drops nothing that was completed, and records only completed items", () => {
		const session = fakeSession();
		const wh = history(session);
		const attempt = wh.beginAttempt("a1");
		attempt.addItem(msg("completed before failure"));
		// An in-progress item never reaches addItem, so it cannot appear after a retry.
		const retry = wh.beginAttempt("a1-retry");
		assert.equal(wh.projection().length, 1);
		retry.addItem(msg("retry output"));
		assert.equal(wh.projection().length, 2);
	});
});

describe("tool-call execution ledger", () => {
	it("reports calls without an executed record and never repeats an executed call", () => {
		const session = fakeSession();
		const wh = history(session);
		const attempt = wh.beginAttempt("a1");
		attempt.addItem({ type: "function_call", call_id: "c1", name: "bash", arguments: "{}" });
		attempt.addItem({ type: "custom_tool_call", call_id: "c2", name: "apply", input: "x" });
		attempt.markExecuted("c1");
		assert.deepEqual(
			wh.unexecutedCalls().map((i) => i.call_id),
			["c2"],
		);
		attempt.markExecuted("c2");
		assert.deepEqual(wh.unexecutedCalls(), []);
	});

	it("rejects an empty callId and a non-typed item", () => {
		const wh = history(fakeSession());
		const attempt = wh.beginAttempt("a1");
		assert.throws(() => attempt.markExecuted(""), TypeError);
		assert.throws(() => attempt.addItem({} as never), TypeError);
	});
});

describe("isolation, digests and model hash", () => {
	it("never replays state of another thread or owner", () => {
		const session = fakeSession();
		history(session).beginAttempt("a1").addItem(msg("owner A"));
		for (const other of [
			{ ...scope, ownerId: "acct-B" },
			{ ...scope, threadId: "thread-2" },
		]) {
			const loaded = history(session, { scope: other }).load();
			assert.equal(loaded.mode, "native");
			assert.deepEqual(loaded.items, []);
		}
	});

	it("a foreign-scope checkpoint on the branch forces source mode", () => {
		const session = fakeSession();
		const a = history(session, { scope: { ...scope, ownerId: "acct-B" } });
		a.installCompaction({
			responseId: "r",
			compaction: { type: "compaction", encrypted_content: "X" },
			retained: [],
			window: { number: 1, id: "w" },
			sourceEntryIds: [],
			sourceDigest: "d",
		});
		assert.equal(history(session).load().mode, "source");
	});

	it("tampered entry digests are rejected and force source mode", () => {
		const session = fakeSession();
		const wh = history(session);
		wh.beginAttempt("a1").addItem(msg("original"));
		const entry = session.entries.find((e) => e.customType === HISTORY_CUSTOM_TYPE) as WireSessionEntry;
		(entry.data as { item: unknown }).item = msg("forged");
		const loaded = wh.load();
		assert.equal(loaded.mode, "source");
		assert.equal(loaded.reason, "invalid-entry");
		assert.deepEqual(loaded.items, []);
	});

	it("a checkpoint is replayed under any model; the model hash guard runs only for an explicit expected hash", () => {
		const session = fakeSession();
		const wh = history(session);
		wh.installCompaction({
			responseId: "r",
			compaction: { type: "compaction", encrypted_content: "X" },
			retained: [],
			window: { number: 1, id: "w" },
			sourceEntryIds: ["m1"],
			sourceDigest: "d",
		});
		assert.equal(wh.load().mode, "native");
		const other = new WireHistory({ session, scope, modelHash: "hash-other" });
		assert.equal(other.load().mode, "native", "no default guard: native replays opaque history under another model");
		const loaded = wh.load(null, "hash-other");
		assert.equal(loaded.mode, "source");
		assert.equal(loaded.reason, "model-hash");
	});

	it("disabled adapter path: original Pi entries stay intact and readable without any wire entry", () => {
		const session = fakeSession();
		session.pushMessage("u1");
		history(session).beginAttempt("a1").addItem(msg("wire"));
		const piOnly = session.getBranch().filter((e) => e.type === "message");
		assert.equal(piOnly.length, 1);
		assert.deepEqual(piOnly[0].data, { text: "u1" });
	});
});

describe("effort pins and checkpoints", () => {
	it("records effort at its position and keeps it in the projection", () => {
		const session = fakeSession();
		const wh = history(session);
		wh.beginAttempt("a1").addItem(msg("before"));
		wh.recordEffort("high");
		wh.beginAttempt("a2").addItem(msg("after"));
		const items = wh.projection().map((e) => e.item);
		assert.deepEqual(items[1], { type: "configuration_update", reasoning: { effort: "high" } });
		assert.equal(wh.load().effort, "high");
	});

	it("installing a compaction resets the effort pin and window; the original entries remain", () => {
		const session = fakeSession();
		const wh = history(session);
		wh.recordEffort("high");
		wh.beginAttempt("a1").addItem(msg("payload"));
		const before = session.entries.length;
		wh.installCompaction({
			responseId: "resp-c",
			compaction: { type: "compaction", encrypted_content: "ENC" },
			retained: [{ item: msg("kept"), clientAuthored: false }],
			window: { number: 1, id: "0190f2c4-0000-7000-8000-000000000000" },
			sourceEntryIds: ["m0"],
			sourceDigest: "digest",
		});
		assert.equal(session.entries.length, before + 1, "exactly one appended entry");
		const loaded = wh.load();
		assert.equal(loaded.effort, null);
		assert.deepEqual(loaded.window, { number: 1, id: "0190f2c4-0000-7000-8000-000000000000" });
		assert.deepEqual(
			loaded.items.map((e) => e.item.type),
			["message", "compaction"],
		);
		assert.equal(loaded.checkpointResponseId, "resp-c");
	});

	it("rejects an installation without a compaction item carrying encrypted_content", () => {
		const wh = history(fakeSession());
		assert.throws(
			() =>
				wh.installCompaction({
					responseId: "r",
					compaction: { type: "message" },
					retained: [],
					window: { number: 1, id: null },
					sourceEntryIds: [],
					sourceDigest: "d",
				}),
			TypeError,
		);
	});

	it("items after a checkpoint replay on top of it; items before it are compacted away", () => {
		const session = fakeSession();
		const wh = history(session);
		wh.beginAttempt("a1").addItem(msg("old"));
		wh.installCompaction({
			responseId: "r",
			compaction: { type: "compaction", encrypted_content: "ENC" },
			retained: [],
			window: { number: 1, id: "w" },
			sourceEntryIds: [],
			sourceDigest: "d",
		});
		wh.beginAttempt("a2").addItem(msg("new"));
		assert.deepEqual(
			wh.projection().map((e) => e.item.type),
			["compaction", "message"],
		);
	});
});

/** Copies a branch into a new session with new entry ids, as a Pi fork does (same content, same order). */
function forkCopy(source: ReturnType<typeof fakeSession>, mutate?: (entries: WireSessionEntry[]) => WireSessionEntry[]) {
	const target = fakeSession();
	const copied = source.getBranch().map((e, i) => ({ ...structuredClone(e), id: `f${i + 1}`, parentId: i === 0 ? null : `f${i}` }) as WireSessionEntry);
	const entries = mutate ? mutate(copied) : copied;
	target.entries.push(...entries);
	target.setLeaf(entries.at(-1)?.id ?? null);
	return target;
}

const checkpointInput = {
	responseId: "resp-ck",
	compaction: { type: "compaction", encrypted_content: "ENC" },
	retained: [],
	window: { number: 1, id: "w" },
	sourceEntryIds: [],
	sourceDigest: "d",
};

describe("durability: runtime lease versus persisted owner/thread scope", () => {
	it("a restarted process (new runtime lease) replays the same saved thread and account", () => {
		const session = fakeSession();
		history(session).beginAttempt("a1").addItem(msg("before restart"));
		const restarted = new WireHistory({ session, scope: { ...scope, runtimeId: "rt-after-restart" }, modelHash: MODEL });
		const loaded = restarted.load();
		assert.equal(loaded.mode, "native");
		assert.deepEqual(loaded.items.map((e) => e.item), [msg("before restart")]);
		assert.equal(restarted.leaseId, "rt-after-restart");
	});

	it("the runtime lease is provenance on the entry, not part of the match key", () => {
		const session = fakeSession();
		history(session).beginAttempt("a1").addItem(msg("x"));
		const entry = session.entries.find((e) => e.customType === HISTORY_CUSTOM_TYPE) as WireSessionEntry;
		assert.equal((entry.data as { lease: string }).lease, "rt-1");
		assert.equal(scopeDigest({ ...scope, runtimeId: "other" }), scopeDigest(scope));
		assert.notEqual(scopeDigest({ ...scope, ownerId: "acct-B" }), scopeDigest(scope));
	});
});

describe("fork adoption and sibling branches", () => {
	it("a forked copy with new entry ids adopts the checkpoint when the covered Pi entries match", () => {
		const session = fakeSession();
		session.pushMessage("u1");
		session.pushMessage("a1");
		history(session).installCompaction(checkpointInput);
		const fork = forkCopy(session);
		const loaded = history(fork).load();
		assert.equal(loaded.mode, "native");
		assert.deepEqual(loaded.items.map((e) => e.item.type), ["compaction"]);
		assert.equal(loaded.checkpointResponseId, "resp-ck");
	});

	it("an edited covered entry on a copied branch does not reuse the checkpoint", () => {
		const session = fakeSession();
		session.pushMessage("u1");
		history(session).installCompaction(checkpointInput);
		const fork = forkCopy(session, (entries) => entries.map((e) => (e.type === "message" ? { ...e, data: { text: "edited" } } : e)));
		const loaded = history(fork).load();
		assert.equal(loaded.mode, "source");
		assert.equal(loaded.reason, "checkpoint-sources");
	});

	it("a removed covered entry on a copied branch does not reuse the checkpoint", () => {
		const session = fakeSession();
		session.pushMessage("u1");
		session.pushMessage("a1");
		history(session).installCompaction(checkpointInput);
		const fork = forkCopy(session, (entries) => entries.filter((e) => !(e.type === "message" && (e.data as { text: string }).text === "a1")));
		assert.equal(history(fork).load().reason, "checkpoint-sources");
	});

	it("a sibling branch that never contained the checkpoint does not see it", () => {
		const session = fakeSession();
		session.pushMessage("u1");
		const siblingPoint = session.getBranch().at(-1)?.id ?? null;
		history(session).installCompaction(checkpointInput);
		session.setLeaf(siblingPoint);
		const sibling = history(session).load();
		assert.equal(sibling.checkpointEntryId, null);
		assert.deepEqual(sibling.items, []);
	});
});

describe("built-request seed for transcripts without native history", () => {
	it("a Pi transcript with no native items is native but empty until its built request is seeded", () => {
		const session = fakeSession();
		session.pushMessage("legacy user");
		const wh = history(session);
		assert.equal(wh.load().mode, "native");
		assert.deepEqual(wh.load().items, []);
	});

	it("seeds the exact built items once; a second seed or a seed over a checkpoint is refused", () => {
		const session = fakeSession();
		session.pushMessage("legacy user");
		const wh = history(session);
		const built = [msg("system-built user"), { type: "function_call", call_id: "c9", name: "bash", arguments: "{}" }];
		wh.seedBuiltRequest(built);
		assert.deepEqual(wh.projection().map((e) => e.item), built);
		assert.throws(() => wh.seedBuiltRequest([msg("again")]), /already exists/);

		const other = fakeSession();
		other.pushMessage("u");
		const ow = history(other);
		ow.installCompaction(checkpointInput);
		assert.throws(() => ow.seedBuiltRequest([msg("late")]), /already exists/);
	});

	it("refuses seeded items that carry socket continuation tokens", () => {
		const wh = history(fakeSession());
		assert.throws(() => wh.seedBuiltRequest([{ type: "message", role: "user", previous_response_id: "r" } as never]), /continuation/);
	});
});

describe("model hash after a previous-model fallback", () => {
	it("a fallback checkpoint is loaded under the primary hash and under its own installed hash", () => {
		const session = fakeSession();
		session.pushMessage("u");
		history(session).installCompaction({ ...checkpointInput, modelHash: "hash-fallback", primaryModelHash: MODEL });
		assert.equal(history(session, { scope }).load().mode, "native");
		const fallbackView = new WireHistory({ session, scope, modelHash: "hash-fallback" });
		assert.equal(fallbackView.load().mode, "native");
		assert.equal(new WireHistory({ session, scope, modelHash: "hash-unrelated" }).load().mode, "native");
		assert.equal(history(session).load(null, "hash-unrelated").reason, "model-hash");
	});
});

describe("continuation tokens and source entries", () => {
	it("refuses to persist a socket continuation or sticky token on an item or entry", () => {
		const wh = history(fakeSession());
		const attempt = wh.beginAttempt("a1");
		assert.throws(() => attempt.addItem({ type: "message", role: "user", turn_state: "t" } as never), /continuation/);
		assert.throws(() => wh.appendEntry({ kind: "item", sticky_token: "s" }), /continuation/);
	});

	it("never mutates Pi entries: only one appended custom entry per call", () => {
		const session = fakeSession();
		session.pushMessage("u1");
		const before = structuredClone(session.entries);
		const wh = history(session);
		wh.beginAttempt("a1").addItem(msg("w"));
		wh.recordEffort("low");
		assert.equal(session.entries.length, before.length + 2);
		assert.deepEqual(session.entries.slice(0, before.length), before);
	});
});
