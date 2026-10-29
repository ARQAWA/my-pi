import assert from "node:assert/strict";
import { it } from "node:test";
import { InMemoryCredentialStore, type Api, type Model } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createSessionController } from "../../../extensions/RQW-codex/session.ts";

const MODEL = { id: "gpt-6-luna", provider: "openai-codex", api: "openai-codex-responses", input: ["text"] } as Model<Api>;

/** Fake session whose before-provider-request hook blocks until released; counts connects and sends. */
async function harness() {
	const entries: any[] = [];
	const manager = {
		getHeader: () => null,
		getEntries: () => entries,
		getBranch: () => entries,
		getLeafId: () => entries.at(-1)?.id ?? null,
		buildSessionProjection: () => ({ entries: [], messages: [] }),
		appendCustomEntry(customType: string, data: unknown) {
			const entry = { type: "custom", customType, data, id: `entry-${entries.length + 1}`, parentId: entries.at(-1)?.id ?? null, timestamp: 1 };
			entries.push(entry);
			return entry;
		},
	};
	let hookStarted!: () => void;
	const started = new Promise<void>((resolve) => { hookStarted = resolve; });
	let releaseHook!: () => void;
	const gate = new Promise<void>((resolve) => { releaseHook = resolve; });
	const session = {
		sessionId: "thread-prewarm",
		model: MODEL,
		isIdle: true,
		isStreaming: false,
		isCompacting: false,
		systemPrompt: "PROMPT",
		sessionManager: manager,
		agent: { state: { tools: [] } },
		_hiddenDeclarations: new Set(),
		extensionRunner: {
			hasHandlers: () => true,
			async emitBeforeProviderRequest(payload: unknown) {
				hookStarted();
				await gate;
				return payload;
			},
		},
		subscribe: () => () => undefined,
	} as unknown as AgentSession;
	const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const access = `${b64({ alg: "none" })}.${b64({ exp: 4_000_000_000, "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })}.sig`;
	const store = new InMemoryCredentialStore();
	await store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "refresh", expires: 4_000_000_000_000, accountId: "acct" }) as never);
	let connects = 0;
	let sends = 0;
	const controller = createSessionController({ session, installationId: "inst", store, dependencies: {
		clock: { now: () => 1_000_000 },
		collectWorkspaceMetadata: async () => ({}),
		connect: async () => {
			connects++;
			return {
				isOpen: true,
				socketIdentity: "socket",
				send: async () => { sends++; },
				events: async function* () { yield { text: "{}", value: { type: "response.completed", response: { id: "prewarm" } } }; },
				interrupt: async () => ({ acknowledged: true as const, completed: false }),
				close: async () => undefined,
			};
		},
	} });
	return {
		controller,
		started,
		releaseHook,
		counts: () => ({ connects, sends }),
		selectOtherModel: () => Object.assign(session, { model: { ...MODEL, id: "gpt-6.1-sol" } as Model<Api> }),
	};
}

it("regression: model change cancels stale startup prewarm", async () => {
	const h = await harness();
	const starting = h.controller.start();
	await h.started;
	h.selectOtherModel();
	const changing = h.controller.modelChange();
	h.releaseHook();
	await Promise.all([starting, changing]);
	assert.deepEqual(h.counts(), { connects: 0, sends: 0 });
	h.controller.release();
});

it("regression: model change cancels stale idle prewarm", async () => {
	const h = await harness();
	const warming = h.controller.prewarmWithHistory();
	await h.started;
	h.selectOtherModel();
	const changing = h.controller.modelChange();
	h.releaseHook();
	await Promise.all([warming, changing]);
	assert.deepEqual(h.counts(), { connects: 0, sends: 0 });
	h.controller.release();
});
