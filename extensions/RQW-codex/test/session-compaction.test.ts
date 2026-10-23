// Session compaction hook tests: real Pi 1.4.0 AgentSession (temporary dir, no extensions) with a Codex-shaped model,
// seeded wire history built by WireHistory, the real compactBackend and a fake send callback. No network, no credentials.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as pi from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

import { CODEX_ENDPOINT } from "../profile.ts";
import type { CompactOptions, CompactRequest } from "../compaction.ts";
import { WireHistory } from "../history.ts";
import { installSessionCompaction } from "../session-compaction.ts";

const CODEX_MODEL = {
	id: "gpt-6.1-sol",
	name: "GPT-6.1-Sol",
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

const OTHER_MODEL = { ...CODEX_MODEL, id: "other", provider: "other-provider", api: "openai-responses" } as unknown as Model<Api>;

const SCOPE = { runtimeId: "rt", threadId: "thread", ownerId: "acct" };
const MODEL_HASH = "hash-primary";

const REQUEST: CompactRequest = {
	model: "gpt-6.1-sol",
	useResponsesLite: false,
	inputModalities: ["text", "image"],
	contextWindow: null,
	tools: [{ type: "function", name: "bash" }],
};

const userMsg = (text: string) => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });
const COMPACTION = { type: "compaction", encrypted_content: "ENC+/==raw" };

type Event = { type: string; [key: string]: unknown };

async function withSession(run: (session: pi.AgentSession, dir: string) => Promise<void>, compaction?: Record<string, unknown>) {
	const dir = mkdtempSync(join(tmpdir(), "rqw-codex-compaction-hook-"));
	const resourceLoader = new pi.DefaultResourceLoader({
		cwd: dir,
		agentDir: dir,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({
		cwd: dir,
		agentDir: dir,
		resourceLoader,
		sessionManager: pi.SessionManager.inMemory(dir),
		settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false }, ...(compaction ? { compaction } : {}) }),
	});
	try {
		await run(session, dir);
	} finally {
		session.dispose();
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Seeds the built request as native history on the real session manager. */
function seededHistory(session: pi.AgentSession): WireHistory {
	const history = new WireHistory({ session: session.sessionManager as never, scope: SCOPE, modelHash: MODEL_HASH });
	history.seedBuiltRequest([userMsg("hello"), userMsg("world")] as never);
	return history;
}

/** Fake send: records bodies and yields the scripted events. */
function fakeSend(events: Array<Record<string, unknown>>) {
	const bodies: Record<string, unknown>[] = [];
	const send = async (call: { body: Record<string, unknown> }) => {
		bodies.push(call.body);
		return {
			async *[Symbol.asyncIterator]() {
				for (const e of events) yield e as never;
			},
		};
	};
	return { bodies, send };
}

const OK_EVENTS = [
	{ type: "output_item_done", item: COMPACTION },
	{ type: "completed", responseId: "resp-c", usage: { input_tokens: 9 } },
];

function hookFor(session: pi.AgentSession, history: WireHistory, send: CompactOptions["send"], onInstalled?: () => void, projection?: () => number | undefined) {
	const events: Event[] = [];
	const originalEmit = (session as unknown as { _emit(e: Event): void })._emit.bind(session);
	(session as unknown as { _emit(e: Event): void })._emit = (e: Event) => {
		events.push(e);
		originalEmit(e);
	};
	const release = installSessionCompaction(session, {
		prepare: async ({ signal }) => ({ request: REQUEST, history, send, modelHash: MODEL_HASH, window: { number: 0, id: null }, signal }),
		projectTokens: () => (projection ? projection() : history.load().checkpointEntryId ? 1000 : undefined),
		onInstalled: onInstalled ? () => onInstalled() : undefined,
	});
	return { events, release };
}

describe("session compaction hook", () => {
	it("manual compact on a Codex session installs a native checkpoint without a Pi compaction entry", async () => {
		await withSession(async (session) => {
			session.agent.state.model = CODEX_MODEL;
			const history = seededHistory(session);
			const before = JSON.stringify(session.sessionManager.getBranch().filter((e) => e.type !== "custom"));
			const { bodies, send } = fakeSend(OK_EVENTS);
			let installed = 0;
			const { events, release } = hookFor(session, history, send, () => installed++);
			try {
				const result = await session.compact();
				assert.equal(bodies.length, 1);
				const input = bodies[0].input as Array<{ type: string }>;
				assert.deepEqual(input[input.length - 1], { type: "compaction_trigger" });
				assert.equal(CODEX_ENDPOINT.endsWith("/codex/responses"), true);
				assert.equal(installed, 1);
				assert.equal(result.details && (result.details as { native?: boolean }).native, true);
				assert.deepEqual(events.map((e) => e.type), ["compaction_start", "compaction_end"]);
				assert.equal(session.sessionManager.getBranch().some((e) => e.type === "compaction"), false);
				const after = session.sessionManager.getBranch();
				assert.equal(after.some((e) => e.type === "custom" && e.customType === "rqw-codex/wire-history"), true);
				assert.equal(JSON.stringify(after.filter((e) => e.type !== "custom")), before);
				assert.equal(history.load().mode, "native");
				assert.notEqual(history.load().checkpointEntryId, null);
			} finally {
				release();
			}
		});
	});

	it("failed compaction emits failure end, throws for manual, and writes nothing", async () => {
		await withSession(async (session) => {
			session.agent.state.model = CODEX_MODEL;
			const history = seededHistory(session);
			const { send } = fakeSend([{ type: "failed", message: "boom", retryable: false }]);
			const { events, release } = hookFor(session, history, send);
			try {
				await assert.rejects(session.compact());
				assert.deepEqual(events.map((e) => e.type), ["compaction_start", "compaction_end"]);
				assert.equal(events[1].aborted, false);
				assert.equal(typeof events[1].errorMessage, "string");
				assert.equal(history.load().checkpointEntryId, null);
			} finally {
				release();
			}
		});
	});

	it("threshold uses wire tokens and honours explicit compaction.enabled false", async () => {
		await withSession(async (session) => {
			session.agent.state.model = CODEX_MODEL;
			const history = seededHistory(session);
			const { release } = hookFor(session, history, fakeSend(OK_EVENTS).send, undefined, () => 1000);
			try {
				const exceeds = (session as unknown as { _exceedsCompactionThreshold(m: Model<Api>, p: unknown): boolean })._exceedsCompactionThreshold.bind(session);
				assert.equal(exceeds(CODEX_MODEL, {}), false);
				const big = { ...CODEX_MODEL, contextWindow: 1100 } as unknown as Model<Api>;
				assert.equal(exceeds(big, {}), true);
			} finally {
				release();
			}
		});
	});

	it("an explicit compaction.reserveTokens replaces the default reserve in the wire threshold", async () => {
		await withSession(async (session) => {
			session.agent.state.model = CODEX_MODEL;
			const history = seededHistory(session);
			const { release } = hookFor(session, history, fakeSend(OK_EVENTS).send, undefined, () => 1000);
			try {
				const exceeds = (session as unknown as { _exceedsCompactionThreshold(m: Model<Api>, p: unknown): boolean })._exceedsCompactionThreshold.bind(session);
				const small = { ...CODEX_MODEL, contextWindow: 1100 } as unknown as Model<Api>;
				// reserve 50: trigger is 1050, the wire estimate 1000 stays below it.
				assert.equal(exceeds(small, {}), false);
			} finally {
				release();
			}
		}, { reserveTokens: 50 });
	});

	it("a foreign provider with a foreign API keeps the original threshold and usage methods", async () => {
		await withSession(async (session) => {
			session.agent.state.model = OTHER_MODEL;
			const history = seededHistory(session);
			const exceeds = (session as unknown as { _exceedsCompactionThreshold(m: Model<Api>, p: unknown): boolean })._exceedsCompactionThreshold.bind(session);
			const usage = session.getContextUsage();
			const projection = session.sessionManager.buildSessionProjection();
			const before = exceeds(OTHER_MODEL, projection);
			const { release } = hookFor(session, history, fakeSend(OK_EVENTS).send, undefined, () => 123);
			try {
				assert.equal(exceeds(OTHER_MODEL, projection), before);
				assert.deepEqual(session.getContextUsage(), usage);
				assert.equal(history.load().checkpointEntryId, null, "no checkpoint is read or written for a foreign model");
			} finally {
				release();
			}
		});
	});

	it("non-Codex models and release keep the original methods", async () => {
		await withSession(async (session) => {
			session.agent.state.model = OTHER_MODEL;
			const original = session.getContextUsage;
			const history = seededHistory(session);
			const { release } = hookFor(session, history, fakeSend(OK_EVENTS).send, undefined, () => 123);
			assert.deepEqual(session.getContextUsage(), original.call(session));
			assert.equal(Object.prototype.hasOwnProperty.call(session, "compact"), true);
			release();
			assert.equal(Object.prototype.hasOwnProperty.call(session, "compact"), false);
			assert.equal(session.getContextUsage, original);
		});
	});
});

describe("session compaction hook phases", () => {
	it("supplies the native phase: manual standalone; threshold before the turn pre; post-sampling check and overflow mid", async () => {
		await withSession(async (session) => {
			session.agent.state.model = { ...CODEX_MODEL, contextWindow: 1100 } as unknown as Model<Api>;
			const history = seededHistory(session);
			const phases: Array<{ reason: string; phase?: string }> = [];
			const { send } = fakeSend(OK_EVENTS);
			const release = installSessionCompaction(session, {
				prepare: async ({ reason, phase, signal }) => {
					phases.push({ reason, phase });
					return { request: REQUEST, history, send, modelHash: MODEL_HASH, window: { number: 0, id: null }, signal };
				},
				projectTokens: () => 1000,
			});
			const internals = session as unknown as {
				_runAutoCompaction(reason: "threshold" | "overflow", willRetry: boolean): Promise<boolean>;
				_checkCompaction(message: { stopReason?: string }, skipAbortedCheck?: boolean): Promise<boolean>;
			};
			try {
				await session.compact();
				await internals._runAutoCompaction("threshold", false);
				await internals._checkCompaction({ stopReason: "stop" });
				await internals._checkCompaction({ stopReason: "stop" }, false);
				await internals._runAutoCompaction("overflow", false);
				assert.deepEqual(phases, [
					{ reason: "manual", phase: "standalone_turn" },
					{ reason: "threshold", phase: "pre_turn" },
					{ reason: "threshold", phase: "mid_turn" },
					{ reason: "threshold", phase: "pre_turn" },
					{ reason: "overflow", phase: "mid_turn" },
				]);
			} finally {
				release();
			}
		});
	});
});
