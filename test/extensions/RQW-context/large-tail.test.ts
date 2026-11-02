import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import * as Pi from "@earendil-works/pi-coding-agent";
import { harness } from "./harness.ts";

const KEY = Symbol.for("rqw:safe-projection:v1");
const shared = globalThis as Record<symbol, any>;
const originalOffer = shared[KEY];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
	if (originalOffer === undefined) delete shared[KEY]; else shared[KEY] = originalOffer;
});

// The other extension's offer is external to RQW-context. Pi's entry conversion stays real.
function project(branch: any[]): any {
	const at = branch.findLastIndex(entry => entry.type === "compaction");
	const previous = branch[at];
	const kept = branch.findIndex(entry => entry.id === previous.firstKeptEntryId);
	const active = [previous, ...branch.slice(kept, at)];
	for (let i = at + 1; i < branch.length; i++) active.push(branch[i]);
	const entries = active.map(sourceEntry => ({ sourceEntry, messages: Pi.sessionEntryToContextMessages(sourceEntry) }));
	return { entries, messages: entries.flatMap(entry => entry.messages), thinkingLevel: "off", model: null };
}

async function huge(extension?: (pi: any) => void) {
	const h = await harness({}, extension);
	cleanups.push(async () => { await h.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" } as never); h.session.dispose(); });
	const manager = h.manager as any;
	const first = manager.appendMessage({ role: "user", content: "old ".repeat(300), timestamp: 1 });
	manager.appendCompaction("old summary", first, 100);
	for (let i = 0; i < 130_000; i++) {
		const entry = { type: "custom", customType: "rqw-agent-child", data: {}, id: `large-${i}`, parentId: manager.leafId, timestamp: "2026-01-01T00:00:00.000Z" };
		manager.fileEntries.push(entry);
		manager.byId.set(entry.id, entry);
		manager.leafId = entry.id;
	}
	manager.appendMessage({ role: "user", content: "middle ".repeat(300), timestamp: 2 });
	manager.appendMessage({ role: "user", content: "new ".repeat(300), timestamp: 3 });
	assert.throws(() => Pi.buildSessionProjection(manager.getBranch()), RangeError);
	shared[KEY] = project;
	manager.buildSessionProjection = () => project(manager.getBranch());
	return h;
}

describe("RQW-context huge-tail compaction bypass", () => {
	it("manual compaction saves a native entry and refreshes context through the normal session entry", async () => {
		const h = await huge();
		const result = await h.session.compact("keep the result");
		assert.match(result.summary, /SUMMARY/);
		assert.equal(h.compactions().length, 2);
		assert.equal(h.compacts.at(-1).reason, "manual");
		assert.equal(h.session.isCompacting, false);
		assert.ok(h.session.state.messages.some((message: any) => message.role === "compactionSummary" && /SUMMARY/.test(message.summary)));
	});

	for (const reason of ["threshold", "overflow"]) {
		it(`${reason} compaction stores the summary and preserves the retry decision`, async () => {
			const h = await huge();
			const retry = await (h.session as any)._runAutoCompaction(reason, reason === "overflow");
			assert.equal(retry, reason === "overflow");
			assert.equal(h.compactions().length, 2);
			assert.equal(h.compacts.at(-1).reason, reason);
			assert.equal(h.session.isCompacting, false);
		});
	}

	it("the pre-request threshold no longer returns an over-window unsummarized tail", async () => {
		const h = await huge();
		for (let i = 0; i < 12; i++) h.manager.appendMessage({ role: "user", content: "x".repeat(2_000), timestamp: 4 + i });
		const context = await (h.session as any)._compactBeforeNextAssistantResponse({ messages: [] });
		assert.equal(h.compactions().length, 2);
		assert.ok(context.messages.some((message: any) => message.role === "compactionSummary" && /SUMMARY/.test(message.summary)));
		assert.ok(context.messages.reduce((sum: number, message: any) => sum + Pi.estimateTokens(message), 0) < 4_000);
	});

	it("a cancelling hook prevents any summary or entry", async () => {
		const h = await huge(pi => pi.on("session_before_compact", () => ({ cancel: true })));
		await assert.rejects(h.session.compact(), /Compaction cancelled/);
		assert.equal(h.summaries.length, 0);
		assert.equal(h.compactions().length, 1);
		assert.equal(h.session.isCompacting, false);
	});

	it("a supplied hook result is stored without requesting a summary", async () => {
		const h = await huge(pi => pi.on("session_before_compact", (event: any) => ({ compaction: {
			summary: "HOOK", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore,
		} })));
		await h.session.compact();
		assert.equal(h.summaries.length, 0);
		assert.equal(h.compactions().at(-1).summary, "HOOK");
		assert.equal(h.compacts.at(-1).fromExtension, true);
	});

	for (const hold of [false, true]) {
		it(`threshold adopts the ${hold ? "running" : "ready"} background summary on a huge tail`, async () => {
			const h = await huge();
			h.control.hold = hold;
			await h.say(0.4);
			await h.summary(1);
			if (!hold) await h.quiet();
			const pending = (h.session as any)._runAutoCompaction("threshold", false);
			if (hold) h.release("BACKGROUND");
			await pending;
			assert.equal(h.summaries.length, 1);
			assert.equal(h.compactions().length, 2);
			assert.match(h.compactions().at(-1).summary, hold ? /BACKGROUND/ : /SUMMARY/);
		});
	}

	for (const missing of ["offer", "session method"]) {
		it(`falls back to native compaction without the ${missing}`, async () => {
			const h = await huge();
			const manager = h.manager as any;
			if (missing === "offer") delete shared[KEY];
			else manager.getEntry = undefined;
			try {
				await assert.rejects(h.session.compact(), RangeError);
				assert.equal(h.summaries.length, 0);
				assert.equal(h.compactions().length, 1);
			} finally { if (missing === "session method") delete manager.getEntry; }
		});
	}

	it("manual cancellation aborts the generator without saving a compaction", async () => {
		const h = await huge();
		h.control.hold = true;
		const pending = h.session.compact();
		await h.summary(1);
		h.session.abortCompaction();
		await assert.rejects(pending);
		assert.equal(h.summaries[0].aborted, true);
		assert.equal(h.compactions().length, 1);
		assert.equal(h.session.isCompacting, false);
	});

	it("summary failure is visible and leaves the branch un-compacted", async () => {
		const h = await huge();
		h.control.fail = true;
		const events: any[] = [];
		const unsubscribe = h.session.subscribe(event => events.push(event));
		try {
			assert.equal(await (h.session as any)._runAutoCompaction("threshold", false), false);
			assert.equal(h.compactions().length, 1);
			assert.match(events.at(-1).errorMessage, /Auto-compaction failed/);
			assert.equal(h.session.isCompacting, false);
		} finally { unsubscribe(); }
	});
});
