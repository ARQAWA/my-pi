// Real Pi 1.4.0 owner races, with fake credentials and SSE only.
// Option P uses stock Pi's portable plaintext summary, not the removed guardedInstall/native opaque commit contract.
// Legacy checkpoints below are migrated-data fixtures only: active compaction must never create or send one.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import * as pi from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Model } from "@earendil-works/pi-ai";

import { HISTORY_CUSTOM_TYPE } from "../../../extensions/RQW-codex/history.ts";
import { createCodexExtension } from "../../../extensions/RQW-codex/index.ts";
import { codexModelCapabilities } from "../../../extensions/RQW-codex/profile.ts";
import { SessionWireState } from "../../../extensions/RQW-codex/session-history.ts";
import { createSessionController, type SessionController, type SessionTransport } from "../../../extensions/RQW-codex/session.ts";
import { CodexThreadTransport } from "../../../extensions/RQW-codex/transport.ts";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";

const root = mkdtempSync(join(tmpdir(), "rqw-codex-owner-race-"));
after(() => rmSync(root, { recursive: true, force: true }));
const MODEL = {
	id: "gpt-6-luna", name: "GPT-6-Luna", api: "openai-codex-responses", provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api", reasoning: true, input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 500000, maxTokens: 100000, thinkingLevelMap: {},
} as unknown as Model<Api>;
const PROVIDER = "openai-codex";
const ACCOUNT_A = "acct-owner-race-a";
const ACCOUNT_B = "acct-owner-race-b";
const INSTALLATION = "33333333-4444-4555-8666-999999999999";
const SUMMARY = "PORTABLE OWNER RACE SUMMARY: keep the original task and continue.";
const OPAQUE_A = "LEGACY_OPAQUE_ACCOUNT_A";
const REFUSAL = /saved (ChatGPT )?login changed while (this|the) request (was being|was) prepared/;
const TOKEN_EXP = Math.floor(Date.now() / 1000) + 3600;
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const userMsg = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1_700_000_000_000 });
const usage = { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistantMsg = (text: string) => ({ role: "assistant", content: [{ type: "text", text }], api: MODEL.api, provider: MODEL.provider, model: MODEL.id, stopReason: "stop", timestamp: 1_700_000_000_001, usage });
const textEvents = (id: string, text: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
	{ type: "response.completed", response: { id, status: "completed", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
];

function tokenOf(account: string, tag: string): string {
	return `${b64url({ alg: "none" })}.${b64url({ exp: TOKEN_EXP, tag, "https://api.openai.com/auth": { chatgpt_account_id: account } })}.sig`;
}
async function setSlot(store: InMemoryCredentialStore, account: string, tag: string): Promise<void> {
	await store.modify(PROVIDER, async () => ({ type: "oauth", access: tokenOf(account, tag), refresh: `refresh-${tag}`, expires: TOKEN_EXP * 1000, accountId: account }) as never);
}

/** Keeps the real serialized store. Hooks only script reads and lock waits, never replace runtime methods. */
class HookedStore extends InMemoryCredentialStore {
	hook: "race-residual" | "hold" | undefined;
	holdGate: Promise<void> | undefined;
	lockQueued = 0;
	switchDone: Promise<void> | undefined;
	override async read(providerId: string, options?: any) {
		if (providerId === PROVIDER && this.hook === "hold") {
			this.hook = undefined;
			void super.modify(providerId, async () => { await this.holdGate; return undefined; });
			this.lockQueued++;
			await super.modify(providerId, async () => undefined, options);
		}
		const value = await super.read(providerId, options);
		if (providerId === PROVIDER && this.hook === "race-residual") {
			this.hook = undefined;
			this.switchDone = setSlot(this, ACCOUNT_B, "b-1");
		}
		return value;
	}
	async settled(): Promise<void> {
		await super.modify(PROVIDER, async () => undefined);
	}
}

type Step = unknown[] | { events: unknown[]; onCleanup: () => Promise<void> };
function sseScript(steps: Step[]) {
	const calls: { body: Record<string, any>; headers: Record<string, string> }[] = [];
	const fn = (options: any) => {
		calls.push({ body: JSON.parse(zstdDecompressSync(Buffer.from(options.body)).toString("utf8")), headers: options.headers ?? {} });
		const step = steps.shift();
		if (!step) throw new Error("unexpected SSE request");
		const events = Array.isArray(step) ? step : step.events;
		const cleanup = Array.isArray(step) ? undefined : step.onCleanup;
		return (async function* () {
			options.onResponse({ status: 200, headers: {} });
			try { for (const value of events) yield { text: JSON.stringify(value), value }; }
			finally { await cleanup?.(); }
		})();
	};
	return { fn: fn as any, calls };
}
let connectAttempts = 0;
const upgradeRequired = async (): Promise<never> => {
	connectAttempts++;
	throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
};
const timing = { clock: { now: () => 1_000_000 }, random: () => 0.5, sleep: async () => {} };
function gate() {
	let open!: () => void;
	const promise = new Promise<void>((resolve) => { open = resolve; });
	return { promise, open };
}
async function waitFor(condition: () => boolean, label: string, ms = 5_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
		await new Promise((resolve) => setImmediate(resolve));
	}
}
const sourceContext = (session: pi.AgentSession) => ({ systemPrompt: "SYSTEM", messages: pi.convertToLlm(session.sessionManager.buildSessionProjection().messages), tools: [] });
const compactions = (session: pi.AgentSession) => session.sessionManager.getBranch().filter((entry) => entry.type === "compaction");
const customCount = (session: pi.AgentSession) => session.sessionManager.getBranch().filter((entry) => entry.type === "custom" && entry.customType === HISTORY_CUSTOM_TYPE).length;
const bearer = (race: { sse: ReturnType<typeof sseScript> }) => race.sse.calls.at(-1)?.headers.Authorization;
const slotAccount = async (store: HookedStore) => (await store.read(PROVIDER, {}) as any)?.accountId;

function seedMessages(manager: pi.SessionManager): void {
	manager.appendMessage(userMsg("ORIGINAL TASK") as never);
	manager.appendMessage(assistantMsg("Earlier progress to summarize.") as never);
	manager.appendMessage(userMsg("KEPT TAIL") as never);
}

/** Only migrated data uses this utility. A real source-projected turn must have created its trusted base first. */
function installLegacyCheckpoint(state: SessionWireState): void {
	assert.equal(state.history.load().mode, "native");
	assert.ok(state.history.load().items.length > 0, "actual built source projection primed the history");
	state.history.installCompaction({ responseId: "legacy-a", compaction: { type: "compaction", encrypted_content: OPAQUE_A }, retained: [], window: { number: 1, id: "legacy-window-a" }, sourceEntryIds: state.sourceEntryIds, sourceDigest: "migrated-fixture" });
	state.refresh();
	assert.equal(state.window.number, 1);
	assert.equal(state.history.load().items.at(-1)?.item.encrypted_content, OPAQUE_A);
}

type Race = {
	session: pi.AgentSession; controller: SessionController; store: HookedStore; sse: ReturnType<typeof sseScript>;
	events: string[]; prewarms: Record<string, any>[]; collects: () => number; holdWorkspaces: (hold: Promise<void> | undefined) => void;
};

/** Controller-level stream/prewarm guards retain their real workspace race and migrated A checkpoint. */
async function withRace(steps: Step[], run: (race: Race) => Promise<void>): Promise<void> {
	const dir = mkdtempSync(join(root, "controller-"));
	const resourceLoader = new pi.DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await resourceLoader.reload();
	const manager = pi.SessionManager.create(dir, dir);
	seedMessages(manager);
	const { session } = await pi.createAgentSession({ cwd: dir, agentDir: dir, resourceLoader, model: MODEL, sessionManager: manager, settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false } }) });
	const store = new HookedStore();
	await setSlot(store, ACCOUNT_A, "a-1");
	const sse = sseScript(steps);
	const events: string[] = [];
	const prewarms: Record<string, any>[] = [];
	let collects = 0;
	let hold: Promise<void> | undefined;
	const dependencies = {
		...timing, connect: upgradeRequired, postEvents: sse.fn,
		collectWorkspaceMetadata: (async () => { collects++; if (hold) await hold; return {}; }) as never,
		transportFactory: (identity: any, storeArg: any, history: any): SessionTransport => {
			const real = new CodexThreadTransport({ identity, store: storeArg, history, dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
			return {
				stream: (model, context, options) => { events.push("stream"); return real.stream(model, context, options); },
				prewarm(model, context, options) { events.push("prewarm"); prewarms.push({ ...options }); return real.prewarm(model, context, options); },
				beginTurn: (info) => real.beginTurn(info), endTurn: () => real.endTurn(),
				updateMetadata(update) { events.push("update"); real.updateMetadata(update); },
				dispose: () => real.dispose(),
			};
		},
	};
	const controller = createSessionController({ session, installationId: INSTALLATION, store, dependencies });
	try { await run({ session, controller, store, sse, events, prewarms, collects: () => collects, holdWorkspaces: (next) => (hold = next) }); }
	finally { controller.release(); session.dispose(); rmSync(dir, { recursive: true, force: true }); }
}
async function checkpointA(race: Race): Promise<void> {
	race.controller.policy.beginRun({ kind: "run" });
	for await (const _event of race.controller.stream(MODEL, sourceContext(race.session), {})) void _event;
	race.controller.policy.endRun({ aborted: false });
	installLegacyCheckpoint(race.controller.wireState!);
	// Synchronize migrated window metadata before the measured race, not during ensureReady inside it.
	await race.controller.prewarmWithHistory();
	race.events.length = 0;
	race.prewarms.length = 0;
}
function stateOf(race: Race) {
	const state = race.controller.wireState!;
	return { window: state.window.number, checkpoint: state.history.load().checkpointEntryId, custom: customCount(race.session) };
}

type Stock = { session: pi.AgentSession; store: HookedStore; sse: ReturnType<typeof sseScript>; legacy: SessionWireState };
/** Production factory/registration, including Pi's signal-bound stateless auxiliary summary route. */
async function withStock(steps: Step[], run: (race: Stock) => Promise<void>): Promise<void> {
	const dir = mkdtempSync(join(root, "stock-"));
	const store = new HookedStore();
	await setSlot(store, ACCOUNT_A, "a-1");
	const runtime = await pi.ModelRuntime.create({ credentials: store, modelsPath: null, refreshOnCreate: false });
	const sse = sseScript([textEvents("prime", "A progress"), ...steps]);
	const resourceLoader = new pi.DefaultResourceLoader({ cwd: dir, agentDir: dir, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		extensionFactories: [createCodexExtension({ installationId: INSTALLATION, agentDir: dir, dependencies: {
			...timing, connect: upgradeRequired, postEvents: sse.fn, collectWorkspaceMetadata: (async () => ({})) as never,
			fetch: async () => { throw new Error("real network forbidden"); },
		} })],
	});
	await resourceLoader.reload();
	assert.deepEqual(resourceLoader.getExtensions().errors, []);
	assert.equal(resourceLoader.getExtensions().extensions.length, 1);
	const manager = pi.SessionManager.create(dir, dir);
	seedMessages(manager);
	const model = runtime.getModels(PROVIDER).find((candidate) => candidate.id === MODEL.id)!;
	assert.ok(model);
	const { session } = await pi.createAgentSession({ cwd: dir, agentDir: dir, resourceLoader, modelRuntime: runtime, model, thinkingLevel: "off", sessionManager: manager,
		settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: true, keepRecentTokens: 1 }, transport: "sse" }) });
	try {
		await session.bindExtensions({ mode: "tui" });
		await session.setModel(model);
		await session.prompt("Continue under account A.");
		assert.equal(sse.calls.length, 1, "one actual source-projected A turn primes the fixture");
		const legacy = new SessionWireState({ session, ownerId: ACCOUNT_A, modelHash: codexModelCapabilities(model.id).compactionHash });
		installLegacyCheckpoint(legacy);
		// Two adjacent visible entries stop Pi from extending the cut backwards across migrated custom metadata.
		session.sessionManager.appendMessage(userMsg("Completed A turn; prepare the next task.") as never);
		session.sessionManager.appendMessage(userMsg("KEPT TAIL after the completed A turn") as never);
		session.refreshContext();
		await run({ session, store, sse, legacy });
	} finally { session.dispose(); rmSync(dir, { recursive: true, force: true }); }
}

function assertStockSummary(race: Stock): void {
	const entries = compactions(race.session);
	assert.equal(entries.length, 1, "one normal Pi compaction record, never an opaque native install");
	assert.equal(entries[0].summary, SUMMARY);
	assert.equal(entries[0].fromHook, false, "Pi's own summarizer committed the record");
	assert.equal(race.legacy.history.load().checkpointEntryId, null, "stock boundary supersedes migrated A checkpoint");
	assert.equal(race.legacy.history.load().window.number, 0, "stock summary is not a native window advance");
	const summaries = race.session.sessionManager.buildSessionContext().messages.filter((message) => message.role === "compactionSummary");
	assert.equal(summaries.length, 1);
	assert.equal(summaries[0].summary, SUMMARY);
	for (const call of race.sse.calls.slice(1)) {
		assert.equal(call.body.input.some((item: any) => item.type === "compaction_trigger" || item.type === "compaction"), false, "active compaction never sends native opaque state");
		assert.equal(JSON.stringify(call.body).includes(OPAQUE_A), false);
	}
}

it("[owner race] public onPayload gate switches A to B before stock summary send: no request or Pi record", { timeout: 15000 }, async () => {
	await withStock([textEvents("summary", SUMMARY)], async (race) => {
		const hold = gate();
		let hooks = 0;
		const before = JSON.stringify(race.session.sessionManager.getBranch());
		race.session.agent.onPayload = async () => { hooks++; await hold.promise; };
		const pending = race.session.compact();
		await waitFor(() => hooks === 1, "public summary onPayload");
		await setSlot(race.store, ACCOUNT_B, "b-1");
		const saved = await race.store.read(PROVIDER);
		hold.open();
		await assert.rejects(pending, REFUSAL);
		assert.equal(hooks, 1);
		assert.equal(race.sse.calls.length, 1, "no summary request under either owner");
		assert.equal(compactions(race.session).length, 0);
		assert.equal(JSON.stringify(race.session.sessionManager.getBranch()), before, "refusal preserves source and wire history");
		assert.equal(await race.store.read(PROVIDER), saved, "refusal never rewrites B's credential");
	});
});

it("[owner race] explicit idle history prewarm held in preparation, slot switched A to B: no prewarm, metadata update or socket attempt", { timeout: 15000 }, async () => {
	await withRace([textEvents("prime", "ok")], async (race) => {
		await checkpointA(race);
		const before = stateOf(race);
		const sendsBefore = race.sse.calls.length;
		const attemptsBefore = connectAttempts;
		const eventsBefore = race.events.length;
		const hold = gate();
		race.holdWorkspaces(hold.promise);
		const collectsBefore = race.collects();
		const pending = race.controller.prewarmWithHistory();
		await waitFor(() => race.collects() > collectsBefore, "held idle capture");
		await setSlot(race.store, ACCOUNT_B, "b-1");
		race.holdWorkspaces(undefined);
		hold.open();
		await pending;
		assert.equal(race.events.slice(eventsBefore).includes("prewarm"), false);
		assert.equal(race.events.slice(eventsBefore).includes("update"), false);
		assert.equal(race.prewarms.length, 0);
		assert.equal(connectAttempts, attemptsBefore, "no socket attempt under B");
		assert.equal(race.sse.calls.length, sendsBefore, "no request under any account");
		assert.deepEqual(stateOf(race), before);
		assert.equal(await slotAccount(race.store), ACCOUNT_B);
	});
});

it("[owner race] normal stream held in preparation, slot switched A to B: no request or A opaque state reaches B", { timeout: 15000 }, async () => {
	await withRace([textEvents("prime", "ok")], async (race) => {
		await checkpointA(race);
		const before = stateOf(race);
		const sendsBefore = race.sse.calls.length;
		const eventsBefore = race.events.length;
		const hold = gate();
		race.holdWorkspaces(hold.promise);
		const collectsBefore = race.collects();
		const stream = race.controller.stream(MODEL, sourceContext(race.session), {});
		const pending = stream.result();
		await waitFor(() => race.collects() > collectsBefore, "held stream capture");
		await setSlot(race.store, ACCOUNT_B, "b-1");
		race.holdWorkspaces(undefined);
		hold.open();
		const result = await pending;
		assert.equal(result.stopReason, "error");
		assert.match(result.errorMessage!, REFUSAL);
		assert.equal(race.events.slice(eventsBefore).includes("stream"), false);
		assert.equal(race.sse.calls.length, sendsBefore);
		assert.deepEqual(stateOf(race), before);
		assert.equal(await slotAccount(race.store), ACCOUNT_B);
	});
});

it("[owner race] summary received under A, cleanup switches to B: portable Pi summary commits and next B request has no A opaque", { timeout: 15000 }, async () => {
	let store!: HookedStore;
	await withStock([{ events: textEvents("summary", SUMMARY), onCleanup: () => setSlot(store, ACCOUNT_B, "b-1") }, textEvents("next-b", "B continues")], async (race) => {
		store = race.store;
		await race.session.compact();
		assert.equal(bearer(race), `Bearer ${tokenOf(ACCOUNT_A, "a-1")}`);
		assertStockSummary(race);
		assert.equal(await slotAccount(store), ACCOUNT_B);
		race.session.agent.onPayload = undefined;
		await race.session.prompt("Continue after the portable summary under B.");
		assert.equal(race.sse.calls.length, 3);
		assert.equal(bearer(race), `Bearer ${tokenOf(ACCOUNT_B, "b-1")}`);
		assert.ok(JSON.stringify(race.sse.calls.at(-1)!.body.input).includes(SUMMARY), "B receives the portable plaintext summary");
		assertStockSummary(race);
	});
});

it("[owner race control] same-account rotation in public onPayload: stock summary sends rotated bearer and installs once", { timeout: 15000 }, async () => {
	await withStock([textEvents("summary", SUMMARY)], async (race) => {
		const hold = gate();
		let hooks = 0;
		race.session.agent.onPayload = async () => { hooks++; await hold.promise; };
		const pending = race.session.compact();
		await waitFor(() => hooks === 1, "public summary payload");
		await setSlot(race.store, ACCOUNT_A, "a-2");
		const saved = await race.store.read(PROVIDER);
		hold.open();
		await pending;
		assert.equal(hooks, 1);
		assert.equal(race.sse.calls.length, 2);
		assert.equal(bearer(race), `Bearer ${tokenOf(ACCOUNT_A, "a-2")}`);
		assert.equal(await race.store.read(PROVIDER), saved);
		assertStockSummary(race);
	});
});

it("[owner race control] same-account rotation during summary cleanup: Pi commits without rewriting the intended rotation", { timeout: 15000 }, async () => {
	let store!: HookedStore;
	let rotated: unknown;
	await withStock([{ events: textEvents("summary", SUMMARY), onCleanup: async () => { await setSlot(store, ACCOUNT_A, "a-3"); rotated = await store.read(PROVIDER); } }], async (race) => {
		store = race.store;
		await race.session.compact();
		assert.equal(race.sse.calls.length, 2);
		assert.equal(bearer(race), `Bearer ${tokenOf(ACCOUNT_A, "a-1")}`);
		assert.equal(await race.store.read(PROVIDER), rotated);
		assert.equal((rotated as any).access, tokenOf(ACCOUNT_A, "a-3"));
		assertStockSummary(race);
	});
});

it("[owner race control] same-account rotation during idle preparation: real idle history prewarm proceeds for A", { timeout: 15000 }, async () => {
	await withRace([textEvents("prime", "ok")], async (race) => {
		await checkpointA(race);
		const before = stateOf(race);
		const eventsBefore = race.events.length;
		const hold = gate();
		race.holdWorkspaces(hold.promise);
		const collectsBefore = race.collects();
		const pending = race.controller.prewarmWithHistory();
		await waitFor(() => race.collects() > collectsBefore, "held idle capture");
		await setSlot(race.store, ACCOUNT_A, "a-4");
		race.holdWorkspaces(undefined);
		hold.open();
		await pending;
		assert.equal(race.events.slice(eventsBefore).filter((event) => event === "prewarm").length, 1);
		assert.equal(race.prewarms.at(-1)?.prewarmInput, "history");
		assert.equal(race.prewarms.at(-1)?.preparedOwner, ACCOUNT_A);
		assert.ok(JSON.stringify(race.prewarms.at(-1)?.nativeInput).includes(OPAQUE_A), "only A's own checkpoint is prepared");
		assert.equal((await race.store.read(PROVIDER) as any).access, tokenOf(ACCOUNT_A, "a-4"));
		assert.deepEqual(stateOf(race), before, "prewarm never installs a new checkpoint");
	});
});

it("[owner race control] same-account rotation during a held normal stream: stream sends rotated A bearer", { timeout: 15000 }, async () => {
	await withRace([textEvents("prime", "ok"), textEvents("next", "next")], async (race) => {
		await checkpointA(race);
		const eventsBefore = race.events.length;
		const hold = gate();
		race.holdWorkspaces(hold.promise);
		const collectsBefore = race.collects();
		const pending = race.controller.stream(MODEL, sourceContext(race.session), {}).result();
		await waitFor(() => race.collects() > collectsBefore, "held stream capture");
		await setSlot(race.store, ACCOUNT_A, "a-5");
		race.holdWorkspaces(undefined);
		hold.open();
		assert.equal((await pending).stopReason, "stop");
		assert.equal(race.events.slice(eventsBefore).filter((event) => event === "stream").length, 1);
		assert.equal(bearer(race), `Bearer ${tokenOf(ACCOUNT_A, "a-5")}`);
		assert.ok(JSON.stringify(race.sse.calls.at(-1)!.body.input).includes(OPAQUE_A), "same owner retains its migrated checkpoint");
	});
});

it("[owner race] residual request-owner check: B queued after authorization read refuses summary before send or Pi record", { timeout: 15000 }, async () => {
	await withStock([textEvents("summary", SUMMARY)], async (race) => {
		const before = JSON.stringify(race.session.sessionManager.getBranch());
		const off = race.session.subscribe((event) => { if (event.type === "compaction_start") race.store.hook = "race-residual"; });
		try {
			await assert.rejects(race.session.compact(), /saved subscription login|saved (ChatGPT )?login changed/);
			assert.ok(race.store.switchDone, "B switch was queued immediately after the captured authorization read");
			await race.store.switchDone;
			assert.equal(await slotAccount(race.store), ACCOUNT_B);
			assert.equal(race.sse.calls.length, 1, "no wrong-owner summary request");
			assert.equal(compactions(race.session).length, 0);
			assert.equal(JSON.stringify(race.session.sessionManager.getBranch()), before);
		} finally { off(); }
	});
});

it("[owner race] public compaction_end sees one committed Pi record before the queued B switch", { timeout: 15000 }, async () => {
	await withStock([textEvents("summary", SUMMARY)], async (race) => {
		let ends = 0;
		let atEnd: unknown;
		let switched: Promise<void> | undefined;
		const off = race.session.subscribe((event) => {
			if (event.type !== "compaction_end" || !event.result) return;
			ends++;
			atEnd = compactions(race.session).map((entry) => entry.summary);
			switched = setSlot(race.store, ACCOUNT_B, "b-1");
		});
		try {
			await race.session.compact();
			assert.equal(ends, 1);
			assert.deepEqual(atEnd, [SUMMARY], "stock commit precedes the public end event, not a private store callback");
			await switched;
			assert.equal(await slotAccount(race.store), ACCOUNT_B);
			assertStockSummary(race);
		} finally { off(); }
	});
});

it("[owner race control] successful stock summary never rewrites saved credentials", { timeout: 15000 }, async () => {
	await withStock([textEvents("summary", SUMMARY)], async (race) => {
		const saved = await race.store.read(PROVIDER);
		const customs = customCount(race.session);
		await race.session.compact();
		assert.equal(await race.store.read(PROVIDER), saved, "same object, no credential rewrite");
		assert.equal(race.sse.calls.length, 2);
		assert.equal(bearer(race), `Bearer ${tokenOf(ACCOUNT_A, "a-1")}`);
		const added = race.session.sessionManager.getBranch().filter((entry) => entry.type === "custom" && entry.customType === HISTORY_CUSTOM_TYPE).slice(customs);
		assert.deepEqual(added.map((entry) => (entry.data as any).kind), ["window"], "boundary creates only fresh window metadata, no native checkpoint or summary raw ledger");
		assert.equal((added[0].data as any).window.number, 0);
		assertStockSummary(race);
	});
});

it("[owner race] abort while authorization waits for store lock: no Pi record or late request after release", { timeout: 15000 }, async () => {
	await withStock([textEvents("summary", SUMMARY)], async (race) => {
		const before = JSON.stringify(race.session.sessionManager.getBranch());
		const saved = await race.store.read(PROVIDER);
		const hold = gate();
		race.store.holdGate = hold.promise;
		const off = race.session.subscribe((event) => { if (event.type === "compaction_start") race.store.hook = "hold"; });
		try {
			const pending = race.session.compact();
			await waitFor(() => race.store.lockQueued === 1, "authorization queued behind store lock");
			race.session.abortCompaction();
			await assert.rejects(pending);
			assert.equal(race.sse.calls.length, 1);
			assert.equal(compactions(race.session).length, 0);
			hold.open();
			await race.store.settled();
			assert.equal(race.sse.calls.length, 1, "aborted authorization never sends after lock release");
			assert.equal(JSON.stringify(race.session.sessionManager.getBranch()), before, "abort preserves physical and wire source");
			assert.equal(await race.store.read(PROVIDER), saved);
		} finally { hold.open(); off(); }
	});
});

it("[owner race] abort at public compaction_end after Pi commit cannot undo the summary", { timeout: 15000 }, async () => {
	await withStock([textEvents("summary", SUMMARY)], async (race) => {
		const saved = await race.store.read(PROVIDER);
		let atEnd = 0;
		const off = race.session.subscribe((event) => {
			if (event.type === "compaction_end" && event.result) { atEnd = compactions(race.session).length; race.session.abortCompaction(); }
		});
		try {
			const result = await race.session.compact();
			assert.equal(result.summary, SUMMARY);
			assert.equal(atEnd, 1, "record already committed at abort callback");
			assert.equal(await race.store.read(PROVIDER), saved);
			assert.equal(race.sse.calls.length, 2);
			assertStockSummary(race);
		} finally { off(); }
	});
});
