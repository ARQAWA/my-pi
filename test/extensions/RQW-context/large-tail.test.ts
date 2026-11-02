import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createFauxCore } from "@earendil-works/pi-ai";
import * as Pi from "@earendil-works/pi-coding-agent";
import { harness } from "./harness.ts";
import { saveContextHooks } from "./hooks-cleanup.ts";
import { compactSafeTail, installManagerProjection } from "../../../extensions/RQW-context/large-tail.ts";
import context from "../../../extensions/RQW-context/index.ts";

const KEY = Symbol.for("rqw:safe-projection:v1");
const shared = globalThis as Record<symbol, any>;
let originalOffer: unknown;
const cleanups: Array<() => Promise<void>> = [];
const hookKey = Symbol.for("rqw-context/live-hooks");
const names = ["buildSessionProjection", "buildContextEntries"] as const;
let restoreHooks: () => void;
beforeEach(() => {
	originalOffer = shared[KEY];
	restoreHooks = saveContextHooks();
});
afterEach(async () => {
	try {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	} finally {
		restoreHooks();
		if (originalOffer === undefined) delete shared[KEY]; else shared[KEY] = originalOffer;
	}
});

function addHugeTail(manager: any) {
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
}

async function huge(extension?: (pi: any) => void) {
	const h = await harness({}, extension);
	cleanups.push(async () => { await h.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" } as never); h.session.dispose(); });
	addHugeTail(h.manager);
	delete shared[KEY];
	return h;
}

describe("RQW-context huge-tail compaction bypass", () => {
	it("keeps stock compaction for an unsupported manager shape", () => {
		let branchReads = 0;
		class UnsupportedManager {
			getEntries() { return []; }
			getLeafId() { return null; }
			getBranch() { branchReads++; return []; }
			getEntry() {}
			appendCompaction() {}
			buildContextEntries() { return []; }
			buildSessionProjection() { return { unexpected: true }; }
		}
		const manager = new UnsupportedManager();
		const original = UnsupportedManager.prototype.buildSessionProjection;
		installManagerProjection(manager, () => true);
		assert.equal(UnsupportedManager.prototype.buildSessionProjection, original);
		const session = { sessionManager: manager, agent: { hasQueuedMessages() { return false; } },
			abort() {}, getContextUsage() {}, refreshContext() {}, _emit() {}, _emitSessionCompactFailed() {},
			_resolveIdleWaitIfIdle() {}, _runDefaultCompaction() {} };
		assert.equal(compactSafeTail(session, () => "stock", "manual", false), "stock");
		assert.equal(branchReads, 0);
	});

	it("leaves both methods stock when the context-entry shape is unsupported", () => {
		class UnsupportedEntries {
			getEntries() { return []; }
			getLeafId() { return null; }
			buildSessionProjection() { return Pi.SessionManager.prototype.buildSessionProjection.call(this as never); }
			buildContextEntries() { return []; }
		}
		const projection = UnsupportedEntries.prototype.buildSessionProjection;
		const entries = UnsupportedEntries.prototype.buildContextEntries;
		installManagerProjection(new UnsupportedEntries(), () => true);
		assert.equal(UnsupportedEntries.prototype.buildSessionProjection, projection);
		assert.equal(UnsupportedEntries.prototype.buildContextEntries, entries);
	});

	it("returns to stock projection when context is disabled", () => {
		const manager = Pi.SessionManager.inMemory(process.cwd());
		addHugeTail(manager);
		let enabled = true;
		installManagerProjection(manager, () => enabled);
		assert.equal(manager.buildContextEntries().at(-1)?.id, manager.getLeafId());
		assert.ok(manager.buildSessionProjection().messages.length > 0);
		enabled = false;
		assert.throws(() => manager.buildContextEntries(), RangeError);
		assert.throws(() => manager.buildSessionProjection(), RangeError);
	});

	it("guards the bundled manager's projection and reload entries", async () => {
		const bundled = await import(new URL("bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
		const manager = bundled.SessionManager.inMemory(process.cwd());
		const proto = Object.getPrototypeOf(manager);
		const slots = (shared[hookKey] as WeakMap<object, Map<string, any>> | undefined)?.get(proto);
		const original = names.map(name => ({ name, descriptor: Object.getOwnPropertyDescriptor(proto, name)!, slot: slots?.get(name), run: slots?.get(name)?.run }));
		try {
			addHugeTail(manager);
			installManagerProjection(manager, () => true);
			assert.equal(manager.buildContextEntries().at(-1)?.id, manager.getLeafId());
			assert.ok(manager.buildSessionContext().messages.some((message: any) => message.role === "user" && String(message.content).includes("new")));
		} finally {
			const current = (shared[hookKey] as WeakMap<object, Map<string, any>> | undefined)?.get(proto);
			for (const { name, descriptor, slot, run } of original) {
				Object.defineProperty(proto, name, descriptor);
				if (slot) { slot.run = run; current?.set(name, slot); }
				else current?.delete(name);
			}
			if (!slots) (shared[hookKey] as WeakMap<object, Map<string, any>> | undefined)?.delete(proto);
		}
	});

	it("resumes a large branch through the SDK before session_start", async () => {
		const manager = Pi.SessionManager.inMemory(process.cwd());
		addHugeTail(manager);
		delete shared[KEY];
		const core = createFauxCore({ provider: "faux", models: [{ id: "m", contextWindow: 4000, maxTokens: 1000 }] });
		const model = core.getModel("m")!;
		const settingsManager = Pi.SettingsManager.inMemory();
		const resourceLoader = new Pi.DefaultResourceLoader({ cwd: process.cwd(), agentDir: process.cwd(), settingsManager,
			noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: [context] } as never);
		await resourceLoader.reload();
		const modelRuntime: any = { getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true,
			getAuth: async () => ({ apiKey: "k" }), checkAuth: async () => ({}), isUsingOAuth: () => false,
			getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [], streamSimple: core.streamSimple, getProviderHeaders: () => undefined };
		const { session } = await Pi.createAgentSession({ cwd: process.cwd(), resourceLoader, settingsManager, modelRuntime,
			sessionManager: manager, model: model as never, tools: [] });
		cleanups.push(async () => { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" } as never); session.dispose(); });
		assert.ok(session.state.messages.some((message: any) => message.role === "user" && String(message.content).includes("new")));
	});

	it("reload restores a large branch before session_start and still compacts it", async () => {
		const h = await huge();
		await h.session.bindExtensions({ onError: () => {} });
		let restored = false;
		await h.session.reload({ beforeSessionStart: () => {
			const entries = h.manager.buildContextEntries();
			assert.equal(entries.at(-1)?.id, h.manager.getLeafId());
			restored = true;
		} });
		assert.ok(restored);
		const result = await h.session.compact();
		assert.match(result.summary, /SUMMARY/);
		assert.equal(h.compactions().length, 2);
	});

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

	it("falls back to native compaction without a required session method", async () => {
		const h = await huge();
		const manager = h.manager as any;
		manager.getEntry = undefined;
		try {
			await assert.rejects(h.session.compact(), RangeError);
			assert.equal(h.summaries.length, 0);
			assert.equal(h.compactions().length, 1);
		} finally { delete manager.getEntry; }
	});

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
