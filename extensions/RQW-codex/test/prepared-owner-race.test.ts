// Prepared-owner race of the session controller on a real Pi 1.4.0 AgentSession (file-backed manager) with the real
// CodexThreadTransport, a fake SSE POST and a fake saved login in an in-memory store. The saved slot is switched from account A
// to account B by store.modify while a prepared operation waits (workspace capture), or after the compaction candidate was
// received but before its checkpoint install. No network: the WebSocket upgrade is refused (426) and SSE is scripted.
// Same-account token rotations are controls that send and install normally.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import * as zlib from "node:zlib";
import * as pi from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Model } from "@earendil-works/pi-ai";

import { HISTORY_CUSTOM_TYPE } from "../history.ts";
import { createSessionController, type SessionController, type SessionTransport } from "../session.ts";
import { CodexThreadTransport } from "../transport.ts";
import { SocketError } from "../websocket.ts";

const root = mkdtempSync(join(tmpdir(), "rqw-codex-owner-race-"));
after(() => rmSync(root, { recursive: true, force: true }));

const MODEL = {
	id: "gpt-6-luna",
	name: "GPT-6-Luna",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 500000,
	maxTokens: 100000,
	thinkingLevelMap: {},
} as unknown as Model<Api>;

const ACCOUNT_A = "acct-owner-race-a";
const ACCOUNT_B = "acct-owner-race-b";
const INSTALLATION = "33333333-4444-4555-8666-999999999999";
// Either layer may refuse first: the controller guard (session.ts) or the transport owner check; both are local, secret-free refusals.
const REFUSAL = /saved (ChatGPT )?login changed while (this|the) request (was being|was) prepared/;
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const userMsg = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1_700_000_000_000 });
const completedEvent = (id: string) => ({
	type: "response.completed",
	response: { id, status: "completed", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } },
});
const textEvents = (id: string, text: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
	completedEvent(id),
];
const compactionEvents = (id: string, encrypted: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.done", output_index: 0, item: { type: "compaction", encrypted_content: encrypted } },
	completedEvent(id),
];

// One expiry for the whole file: tokenOf must return the same string for the same (account, tag) when an assertion
// recomputes it later, also after a wall-clock second boundary (CI 39963174961 crossed one inside a 137 ms case).
const TOKEN_EXP = Math.floor(Date.now() / 1000) + 3600;

/** Saved access token: a JWT whose auth claim names the account; `tag` makes each rotation a different token of the same account. */
function tokenOf(account: string, tag: string): string {
	return `${b64url({ alg: "none" })}.${b64url({ exp: TOKEN_EXP, tag, "https://api.openai.com/auth": { chatgpt_account_id: account } })}.sig`;
}

/**
 * Real serialized store with access hooks (the native lock of InMemoryCredentialStore is kept). `hook` arms one trigger at the next
 * store access: "race-residual" switches the slot to B right after the next plain read resolves, or queues the switch right before the
 * next lock entry when the first access is a lock. "hold" queues a holder that keeps the lock until `holdGate` opens, before the next
 * lock entry. `afterCommit` runs inside the next lock task right after its callback returned (the commit point has passed).
 */
class HookedStore extends InMemoryCredentialStore {
	hook: "race-residual" | "hold" | undefined;
	lockQueued = 0;
	holdGate: Promise<void> | undefined;
	afterCommit: (() => void) | undefined;
	/** Window number read inside the B switch task (proves the install ran before B). */
	switchSawWindow: (() => number | undefined) | undefined;
	switchSeen: number | undefined;
	queueSwitch(): void {
		super.modify(PROVIDER, async () => {
			this.switchSeen = this.switchSawWindow?.();
			return { type: "oauth", access: tokenOf(ACCOUNT_B, "b-1"), refresh: "refresh-b-1", expires: (Math.floor(Date.now() / 1000) + 3600) * 1000, accountId: ACCOUNT_B } as never;
		});
	}
	override async read(providerId: string, options?: any) {
		const value = await super.read(providerId, options);
		if (this.hook === "race-residual") {
			this.hook = undefined;
			this.queueSwitch();
		}
		return value;
	}
	override modify(providerId: string, fn: any, options?: any) {
		if (providerId !== PROVIDER) return super.modify(providerId, fn, options);
		if (this.hook === "race-residual") {
			this.hook = undefined;
			this.queueSwitch();
		}
		if (this.hook === "hold") {
			this.hook = undefined;
			void super.modify(providerId, async () => {
				await this.holdGate;
				return undefined;
			});
		}
		this.lockQueued++;
		const commit = this.afterCommit;
		this.afterCommit = undefined;
		if (!commit) return super.modify(providerId, fn, options);
		return super.modify(providerId, async (current: unknown) => {
			const result = await fn(current);
			commit();
			return result;
		}, options);
	}
}
const PROVIDER = "openai-codex";

/** Writes the saved openai-codex slot: one account, one token. */
async function setSlot(store: InMemoryCredentialStore, account: string, tag: string): Promise<void> {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	await store.modify("openai-codex", async () => ({ type: "oauth", access: tokenOf(account, tag), refresh: `refresh-${tag}`, expires: exp * 1000, accountId: account }) as never);
}

/** A scripted SSE response: plain events, or events whose iterator cleanup runs `onCleanup` before the response ends. */
type Step = unknown[] | { events: unknown[]; onCleanup: () => Promise<void> };

/** Fake SSE POST: one step per request, in order; records the body and the headers (Authorization) of each request. */
function sseScript(steps: Step[]) {
	const calls: { body: Uint8Array; headers: Record<string, string> }[] = [];
	const fn = (options: any) => {
		calls.push({ body: options.body, headers: options.headers ?? {} });
		const step = steps.shift();
		if (!step) throw new Error("unexpected SSE request");
		const events = Array.isArray(step) ? step : step.events;
		const cleanup = Array.isArray(step) ? undefined : step.onCleanup;
		return (async function* () {
			options.onResponse({ status: 200, headers: {} });
			try {
				for (const value of events) yield { text: JSON.stringify(value), value };
			} finally {
				await cleanup?.();
			}
		})();
	};
	return { fn: fn as any, calls };
}

/** Every WebSocket attempt is refused with 426: prewarm and turns fall back to the scripted SSE; the refusal is counted. */
let connectAttempts = 0;
const upgradeRequired = async (): Promise<never> => {
	connectAttempts++;
	throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
};

const timing = { clock: { now: () => 1_000_000 }, random: () => 0.5, sleep: async () => {} };

/** Manual gate: `open` releases everything waiting on `promise`. */
function gate() {
	let open!: () => void;
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { promise, open };
}

async function waitFor(condition: () => boolean, label: string, ms = 5_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
		await new Promise((resolve) => setImmediate(resolve));
	}
}

type Race = {
	session: pi.AgentSession;
	controller: SessionController;
	store: HookedStore;
	sse: ReturnType<typeof sseScript>;
	/** Controller calls into the transport, in order: stream, prewarm, update, sendRaw. */
	events: string[];
	prewarms: Record<string, any>[];
	/** Workspace captures started so far (the hold point of the race). */
	collects: () => number;
	/** Holds the next workspace captures until the gate opens (undefined: no hold). */
	holdWorkspaces: (hold: Promise<void> | undefined) => void;
};

/** Real session on a file-backed manager with one user message, the controller over the real transport, and the scripted SSE. */
async function withRace(steps: Step[], run: (race: Race) => Promise<void>): Promise<void> {
	const dir = mkdtempSync(join(root, "case-"));
	const resourceLoader = new pi.DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await resourceLoader.reload();
	const manager = pi.SessionManager.create(dir, dir);
	manager.appendMessage(userMsg("hello") as never);
	const { session } = await pi.createAgentSession({
		cwd: dir,
		agentDir: dir,
		resourceLoader,
		model: MODEL,
		sessionManager: manager,
		settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false } }),
	});
	const store = new HookedStore();
	await setSlot(store, ACCOUNT_A, "a-1");
	const sse = sseScript(steps);
	const events: string[] = [];
	const prewarms: Record<string, any>[] = [];
	let collects = 0;
	let hold: Promise<void> | undefined;
	const dependencies = {
		...timing,
		connect: upgradeRequired,
		postEvents: sse.fn,
		collectWorkspaceMetadata: (async () => {
			collects++;
			if (hold) await hold;
			return {};
		}) as never,
		transportFactory: (identity: any, storeArg: any, history: any): SessionTransport => {
			const real = new CodexThreadTransport({ identity, store: storeArg, history, dependencies: { ...timing, connect: upgradeRequired, postEvents: sse.fn } });
			return {
				stream: (model, context, options) => {
					events.push("stream");
					return real.stream(model, context, options);
				},
				prewarm(model, context, options) {
					events.push("prewarm");
					prewarms.push({ ...options });
					return real.prewarm(model, context, options);
				},
				beginTurn: (info) => real.beginTurn(info),
				endTurn: () => real.endTurn(),
				updateMetadata(update) {
					events.push("update");
					real.updateMetadata(update);
				},
				sendRaw: (args) => {
					events.push("sendRaw");
					return real.sendRaw(args);
				},
				dispose: () => real.dispose(),
			};
		},
	};
	const controller = createSessionController({ session, installationId: INSTALLATION, store: store as never, dependencies: dependencies as never });
	store.switchSawWindow = () => controller.wireState?.window.number;
	try {
		await run({ session, controller, store, sse, events, prewarms, collects: () => collects, holdWorkspaces: (next) => (hold = next) });
	} finally {
		controller.release();
		session.dispose();
		rmSync(dir, { recursive: true, force: true });
	}
}

/** One real turn first: its refused socket makes the thread sticky SSE, which later requests use. */
async function primeTurn(race: Race): Promise<void> {
	race.controller.policy.beginRun({ kind: "run" });
	for await (const _event of race.controller.stream(MODEL, { systemPrompt: "SYSTEM", messages: [userMsg("hello") as never], tools: [] }, {})) void _event;
	race.controller.policy.endRun({ aborted: false });
}

/** The first checkpoint, from account A, before any race: window 0 to 1 and one wire history entry. */
async function checkpointA(race: Race): Promise<void> {
	await primeTurn(race);
	await race.session.compact();
	assert.equal(race.controller.wireState?.window.number, 1, "A checkpoint is installed before the race");
}

const customCount = (session: pi.AgentSession) => session.sessionManager.getBranch().filter((e) => e.type === "custom" && e.customType === HISTORY_CUSTOM_TYPE).length;

/** Everything a refused install must leave unchanged: window, checkpoint and custom wire entries (sends are counted separately). */
function stateOf(race: Race) {
	const state = race.controller.wireState!;
	return { window: state.window.number, checkpoint: state.history.load().checkpointEntryId, custom: customCount(race.session) };
}

/** Bearer tokens (Authorization) of the scripted SSE requests, in order. */
const bearers = (race: Race): string[] => race.sse.calls.map((call) => call.headers.Authorization ?? "");

// ---- preparation await: switch while a prepared operation waits for its workspace capture -------------------------------

it("[owner race] manual compaction held in preparation, slot switched A to B before release: no request, no checkpoint, no window change", { timeout: 15000 }, async () => {
	await withRace([textEvents("resp_1", "ok"), compactionEvents("resp_a", "ENC-A")], async (race) => {
		await checkpointA(race);
		const before = stateOf(race);
		const sendsBefore = race.sse.calls.length;
		const eventsBefore = race.events.length;
		const hold = gate();
		race.holdWorkspaces(hold.promise);
		const collectsBefore = race.collects();
		const pending = race.session.compact();
		await waitFor(() => race.collects() > collectsBefore, "held workspace capture");
		await setSlot(race.store, ACCOUNT_B, "b-1");
		race.holdWorkspaces(undefined);
		hold.open();
		await assert.rejects(pending, REFUSAL);
		assert.deepEqual(stateOf(race), before, "window, checkpoint and wire entries unchanged");
		assert.equal(race.events.slice(eventsBefore).includes("sendRaw"), false, "nothing reached the transport send");
		assert.equal(race.sse.calls.length, sendsBefore, "no request was sent after the race");
	});
});

it("[owner race] explicit idle history prewarm held in preparation, slot switched A to B: no prewarm, no metadata update, no socket attempt under B", { timeout: 15000 }, async () => {
	await withRace([textEvents("resp_1", "ok"), compactionEvents("resp_a", "ENC-A")], async (race) => {
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
		assert.equal(race.events.slice(eventsBefore).includes("prewarm"), false, "no history prewarm reached the transport");
		assert.equal(race.events.slice(eventsBefore).includes("update"), false, "no metadata update");
		assert.equal(race.prewarms.length, 0);
		assert.equal(connectAttempts, attemptsBefore, "no socket attempt under B");
		assert.equal(race.sse.calls.length, sendsBefore, "no request under any account");
		assert.deepEqual(stateOf(race), before);
	});
});

it("[owner race] normal turn stream held in preparation, slot switched A to B: no request is sent and no A opaque state reaches B", { timeout: 15000 }, async () => {
	await withRace([textEvents("resp_1", "ok"), compactionEvents("resp_a", "ENC-A")], async (race) => {
		await checkpointA(race);
		const before = stateOf(race);
		const sendsBefore = race.sse.calls.length;
		const eventsBefore = race.events.length;
		const hold = gate();
		race.holdWorkspaces(hold.promise);
		const collectsBefore = race.collects();
		const consumed = (async () => {
			for await (const _event of race.controller.stream(MODEL, { systemPrompt: "SYSTEM", messages: [userMsg("next") as never], tools: [] }, {})) void _event;
		})().then(() => "ended", () => "failed");
		await waitFor(() => race.collects() > collectsBefore, "held stream capture");
		await setSlot(race.store, ACCOUNT_B, "b-1");
		race.holdWorkspaces(undefined);
		hold.open();
		await consumed;
		assert.equal(race.events.slice(eventsBefore).includes("stream"), false, "the transport never received the stream");
		assert.equal(race.sse.calls.length, sendsBefore, "no request under any account");
		assert.deepEqual(stateOf(race), before);
	});
});

// ---- late, before install: candidate received, switch during iterator cleanup, install must refuse ------------------------

it("[owner race] compaction candidate received, slot switched to B during iterator cleanup before install: candidate rejected, checkpoint, window and custom entries unchanged", { timeout: 15000 }, async () => {
	// The candidate's response is finished (completed received) when the iterator cleanup switches the saved slot to B.
	let store!: HookedStore;
	await withRace([textEvents("resp_1", "ok"), compactionEvents("resp_a", "ENC-A"), { events: compactionEvents("resp_late", "ENC-LATE"), onCleanup: () => setSlot(store, ACCOUNT_B, "b-1") }], async (race) => {
		store = race.store;
		await checkpointA(race);
		const before = stateOf(race);
		const sendsBefore = race.sse.calls.length;
		await assert.rejects(race.session.compact(), REFUSAL);
		assert.equal(race.sse.calls.length, sendsBefore + 1, "the candidate was requested once, under A");
		assert.equal(bearers(race).at(-1), `Bearer ${tokenOf(ACCOUNT_A, "a-1")}`, "the candidate request carried A's token");
		assert.deepEqual(stateOf(race), before, "no checkpoint, no window advance, no custom entry");
	});
});

// ---- same-account rotation controls: send and install normally -------------------------------------------------------------

it("[owner race control] same-account token rotation during preparation: compaction is sent with the rotated token and installed", { timeout: 15000 }, async () => {
	await withRace([textEvents("resp_1", "ok"), compactionEvents("resp_a", "ENC-A"), compactionEvents("resp_b", "ENC-B")], async (race) => {
		await checkpointA(race);
		const hold = gate();
		race.holdWorkspaces(hold.promise);
		const collectsBefore = race.collects();
		const pending = race.session.compact();
		await waitFor(() => race.collects() > collectsBefore, "held workspace capture");
		await setSlot(race.store, ACCOUNT_A, "a-2");
		race.holdWorkspaces(undefined);
		hold.open();
		await pending;
		assert.equal(race.controller.wireState?.window.number, 2, "rotated compaction installed: window 1 to 2");
		assert.equal(bearers(race).at(-1), `Bearer ${tokenOf(ACCOUNT_A, "a-2")}`, "sent with the rotated token of the same account");
	});
});

it("[owner race control] same-account token rotation during iterator cleanup: the candidate is installed", { timeout: 15000 }, async () => {
	let store!: HookedStore;
	await withRace([textEvents("resp_1", "ok"), compactionEvents("resp_a", "ENC-A"), { events: compactionEvents("resp_b", "ENC-B"), onCleanup: () => setSlot(store, ACCOUNT_A, "a-3") }], async (race) => {
		store = race.store;
		await checkpointA(race);
		const custom = customCount(race.session);
		await race.session.compact();
		assert.equal(race.controller.wireState?.window.number, 2, "installed: window 1 to 2");
		assert.equal(customCount(race.session), custom + 1, "exactly one checkpoint entry added");
	});
});

it("[owner race control] same-account token rotation during idle preparation: the idle history prewarm proceeds with the rotated token", { timeout: 15000 }, async () => {
	await withRace([textEvents("resp_1", "ok"), compactionEvents("resp_a", "ENC-A")], async (race) => {
		await checkpointA(race);
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
		const sentDuring = race.events.slice(eventsBefore);
		assert.equal(sentDuring.filter((e) => e === "prewarm").length, 1, "one history prewarm");
		assert.equal(race.prewarms.at(-1)?.prewarmInput, "history");
	});
});

it("[owner race control] same-account token rotation during a held normal stream: the stream proceeds", { timeout: 15000 }, async () => {
	await withRace([textEvents("resp_1", "ok"), compactionEvents("resp_a", "ENC-A"), textEvents("resp_2", "next")], async (race) => {
		await checkpointA(race);
		const hold = gate();
		race.holdWorkspaces(hold.promise);
		const collectsBefore = race.collects();
		const consumed = (async () => {
			for await (const _event of race.controller.stream(MODEL, { systemPrompt: "SYSTEM", messages: [userMsg("next") as never], tools: [] }, {})) void _event;
		})();
		await waitFor(() => race.collects() > collectsBefore, "held stream capture");
		await setSlot(race.store, ACCOUNT_A, "a-5");
		race.holdWorkspaces(undefined);
		hold.open();
		await consumed;
		assert.equal(race.events.includes("stream"), true, "the stream reached the transport");
		assert.equal(bearers(race).at(-1), `Bearer ${tokenOf(ACCOUNT_A, "a-5")}`, "sent with the rotated token");
	});
});

// ---- atomic install under the store lock: the decision and the synchronous install share one lock entry -------------------

const slotAccount = async (store: HookedStore): Promise<string | undefined> => {
	const stored = await store.read(PROVIDER, {});
	return stored?.type === "oauth" ? stored.accountId : undefined;
};

it("[owner race] OLD residual: slot switched to B right after the last plain read, before the install: the lock-time credential decides, candidate refused, nothing installed", { timeout: 15000 }, async () => {
	// The switch is queued at the first store access after the candidate: a plain read (the old preflight) or the install's lock entry.
	let store!: HookedStore;
	await withRace([textEvents("resp_1", "ok"), compactionEvents("resp_a", "ENC-A"), { events: compactionEvents("resp_late", "ENC-LATE"), onCleanup: async () => { store.hook = "race-residual"; } }], async (race) => {
		store = race.store;
		await checkpointA(race);
		const before = stateOf(race);
		await assert.rejects(race.session.compact(), REFUSAL);
		assert.equal(store.switchSeen, 1, "B was queued before the install's lock entry (window still 1)");
		assert.equal(await slotAccount(store), ACCOUNT_B, "the saved slot is B; the refusal did not rewrite it");
		assert.deepEqual(stateOf(race), before, "no checkpoint, no window advance, no custom entry");
	});
});

it("[owner race] install runs synchronously inside the lock: B queued after the commit waits and sees the installed window", { timeout: 15000 }, async () => {
	let store!: HookedStore;
	let sawAtCommit: number | undefined;
	await withRace([textEvents("resp_1", "ok"), compactionEvents("resp_a", "ENC-A"), compactionEvents("resp_b", "ENC-B")], async (race) => {
		store = race.store;
		await checkpointA(race);
		store.afterCommit = () => {
			sawAtCommit = race.controller.wireState?.window.number;
			store.queueSwitch();
		};
		await race.session.compact();
		assert.equal(sawAtCommit, 2, "the checkpoint was installed when the lock callback returned (inside the lock)");
		assert.equal(race.controller.wireState?.window.number, 2, "window 1 to 2");
		await waitFor(() => store.switchSeen !== undefined, "B switch task");
		assert.equal(store.switchSeen, 2, "B's switch ran only after the commit, never between check and install");
		assert.equal(await slotAccount(store), ACCOUNT_B);
	});
});

it("[owner race control] successful commit does not rewrite the saved credential", { timeout: 15000 }, async () => {
	await withRace([textEvents("resp_1", "ok"), compactionEvents("resp_a", "ENC-A"), compactionEvents("resp_b", "ENC-B")], async (race) => {
		await checkpointA(race);
		const saved = race.store.credentials.get(PROVIDER);
		await race.session.compact();
		assert.equal(race.controller.wireState?.window.number, 2);
		assert.equal(race.store.credentials.get(PROVIDER), saved, "same stored object: modify returned undefined, no write");
	});
});

it("[owner race] abort while waiting for the store lock: nothing installed, no late commit after the lock is released", { timeout: 15000 }, async () => {
	await withRace([textEvents("resp_1", "ok"), compactionEvents("resp_a", "ENC-A"), compactionEvents("resp_b", "ENC-B")], async (race) => {
		await checkpointA(race);
		const before = stateOf(race);
		const hold = gate();
		race.store.holdGate = hold.promise;
		const queued = race.store.lockQueued;
		race.store.hook = "hold";
		const pending = race.session.compact();
		await waitFor(() => race.store.lockQueued > queued, "install waiting for the lock");
		race.session.abortCompaction();
		await assert.rejects(pending);
		hold.open();
		for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(stateOf(race), before, "no install after the abort");
		assert.equal(await slotAccount(race.store), ACCOUNT_A, "slot unchanged");
	});
});

it("[owner race] abort after the synchronous commit: the installed checkpoint is not undone and the compaction resolves", { timeout: 15000 }, async () => {
	await withRace([textEvents("resp_1", "ok"), compactionEvents("resp_a", "ENC-A"), compactionEvents("resp_b", "ENC-B")], async (race) => {
		await checkpointA(race);
		race.store.afterCommit = () => race.session.abortCompaction();
		const result = await race.session.compact();
		assert.ok(result, "compaction resolved");
		assert.equal(race.controller.wireState?.window.number, 2, "window 1 to 2: the commit stands");
		assert.equal(await slotAccount(race.store), ACCOUNT_A, "no credential write");
	});
});
