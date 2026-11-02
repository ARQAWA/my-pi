import assert from "node:assert/strict";
import { it } from "node:test";
import * as Pi from "@earendil-works/pi-coding-agent";
import { prepareSnapshot } from "../../../extensions/RQW-context/background.ts";
import { guardedProjection } from "../../../extensions/RQW-context/projection.ts";

it("keeps Pi's result and uses an equivalent projection on overflow", () => {
	const manager = Pi.SessionManager.inMemory("/");
	const first = manager.appendMessage({ role: "user", content: "old", timestamp: 1 });
	manager.appendModelChange("provider", "model");
	manager.appendCompaction("summary", first, 100);
	const last = manager.appendMessage({ role: "user", content: "new", timestamp: 2 });
	manager.appendContextEdit(last, { content: "edited" } as never);
	const branch = manager.getBranch() as any[];
	const expected = Pi.buildSessionProjection(branch);
	const marker = { ...expected };
	const ordinary = guardedProjection(() => marker as never);
	assert.equal(ordinary(branch), marker);
	const overflow = guardedProjection((entries, leaf, index) => {
		if (entries === branch) throw new RangeError("overflow");
		return Pi.buildSessionProjection(entries as never, leaf, index as never) as never;
	});
	assert.deepEqual(overflow(branch), expected);
});

it("leaves an unsupported shape on the stock path", () => {
	const branch: any[] = [];
	const error = new RangeError("overflow");
	const projection = guardedProjection(entries => {
		if (entries === branch) throw error;
		return {} as never;
	});
	assert.throws(() => projection(branch), value => value === error);
});

it("prepares a large branch without another extension's projection", () => {
	const key = Symbol.for("rqw:safe-projection:v1");
	const shared = globalThis as Record<symbol, unknown>;
	const original = shared[key];
	const timestamp = "2026-01-01T00:00:00.000Z";
	const branch: any[] = [
		{ type: "message", id: "a", parentId: null, timestamp, message: { role: "user", content: "old", timestamp: 1 } },
		{ type: "compaction", id: "c", parentId: "a", timestamp, summary: "old summary", firstKeptEntryId: "a", tokensBefore: 1 },
	];
	for (let i = 0; i < 130_000; i++) {
		branch.push({ type: "custom", id: `t${i}`, parentId: i ? `t${i - 1}` : "c", timestamp, customType: "hidden", data: {} });
	}
	branch.push({ type: "message", id: "b", parentId: "t129999", timestamp, message: { role: "user", content: "middle", timestamp: 2 } });
	branch.push({ type: "message", id: "d", parentId: "b", timestamp, message: { role: "user", content: "new", timestamp: 3 } });
	try {
		delete shared[key];
		const snapshot = prepareSnapshot(branch, { enabled: true, reserveTokens: 10, keepRecentTokens: 1 }, 20);
		assert.ok(snapshot);
		assert.equal(snapshot.preparation.previousSummary, "old summary");
		assert.deepEqual(snapshot.preparation.messagesToSummarize.map(message => ({ role: message.role, content: message.content })), [
			{ role: "user", content: "old" },
			{ role: "user", content: "middle" },
		]);
		assert.equal(snapshot.preparation.firstKeptEntryId, "d");
	} finally {
		if (original === undefined) delete shared[key]; else shared[key] = original;
	}
});
