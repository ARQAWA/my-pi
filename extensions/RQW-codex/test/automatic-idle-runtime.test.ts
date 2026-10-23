// Automatic idle warm on the real registered facade: createCodexExtension (registration -> lifecycle -> session controller ->
// CodexThreadTransport) on one real Pi 1.4.0 AgentSession. No host channel is used: the warm must come from the session's own
// public agent_settled / compaction_end events. The test's only lever is a PUBLIC session.subscribe listener that drops the fake
// socket. The WebSocket is a fake peer (scripted, in-process); HTTP (postEvents) is refused and counted; workspace facts come from an
// injected collector. Temporary agent directory, fake OAuth JWT, no network, no real credentials, no bearer token in any body.
// bindExtensions is deliberately NOT called (no session_start, no startup warm). The helpers are copied from idle-runtime.test.ts
// on purpose: importing that module would run its 18 host-channel cases.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installRuntimeAuth } from "../auth-runtime.ts";
import { createCodexExtension } from "../index.ts";
import { CODEX_PROVIDER } from "../profile.ts";
import { SocketError } from "../websocket.ts";

const ACCOUNT = "acct_idle_auto_runtime_1";
const ACCOUNT_B = "acct_idle_auto_runtime_b";
const INSTALLATION = "44444444-7777-4666-8777-000000000001";
const CASE_TIMEOUT_MS = 15_000;
const HISTORY_USER = "AUTO-HISTORY-USER-1";
const HISTORY_ASSISTANT = "AUTO-HISTORY-ASSISTANT-1";
const FIRST_PROMPT = "AUTO-FIRST-PROMPT-1";
const FIRST_ANSWER = "AUTO-FIRST-ANSWER-1";
const NEXT_PROMPT = "AUTO-NEXT-PROMPT-1";
const NEXT_ANSWER = "AUTO-NEXT-ANSWER-1";
const BUSY_PROMPT = "AUTO-BUSY-PROMPT-1";
const LEADING_BASE_TEXT = "You are an expert coding assistant";
const PREWARM_1 = "resp_auto_warm_1";
const PREWARM_2 = "resp_auto_warm_2";
const TURN_1 = "resp_auto_turn_1";
const TURN_2 = "resp_auto_turn_2";
const HELD_TURN = "resp_auto_held_1";
const COMPACT_RESPONSE = "resp_auto_compact_1";
const COMPACT_OPAQUE = "fakeOpaque-auto-compaction-1";
const COMPACT_ITEM = { type: "compaction", id: "cmp_auto_1", encrypted_content: COMPACT_OPAQUE };

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeAccess(): string {
	return tokenOf(ACCOUNT, "a-1");
}

// One expiry for the whole file: the generator must return the same string for the same inputs when an assertion
// recomputes the expected bearer, also after a wall-clock second boundary (CI 39963174961 and 39966713960).
const TOKEN_EXP = Math.floor(Date.now() / 1000) + 3600;

/** Saved access token of one account; `tag` makes each rotation a different token of the same account. */
function tokenOf(account: string, tag: string): string {
	return `${b64url({ alg: "none" })}.${b64url({ exp: TOKEN_EXP, tag, "https://api.openai.com/auth": { chatgpt_account_id: account } })}.sig`;
}

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const usageOf = (input: number) => ({ input_tokens: input, output_tokens: 1, total_tokens: input + 1, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } });
const created = (id: string) => ({ type: "response.created", response: { id } });
const completed = (id: string, input = 1) => ({ type: "response.completed", response: { id, status: "completed", usage: usageOf(input) } });

/** A complete assistant text generation (the normal turn). */
function textEvents(id: string, text: string) {
	const item = `msg_${id}`;
	return [
		created(id),
		{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: item, role: "assistant", content: [], status: "in_progress" } },
		{ type: "response.output_text.delta", item_id: item, output_index: 0, content_index: 0, delta: text },
		{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: item, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
		completed(id),
	];
}

/** A prepared warm response (generate:false): created and completed, no output item. */
const warmEvents = (id: string) => [created(id), completed(id)];

/** Response of a compaction request (its input ends with compaction_trigger): one opaque item, then completed with that output. */
const compactionScript = (): Script => ({
	events: [
		created(COMPACT_RESPONSE),
		{ type: "response.output_item.done", output_index: 0, item: COMPACT_ITEM },
		{ type: "response.completed", response: { id: COMPACT_RESPONSE, status: "completed", usage: usageOf(1), output: [COMPACT_ITEM] } },
	],
});

/** One scripted socket response, in the order the socket receives requests. `hold` keeps it open until the socket closes. */
type Script = { events: Array<Record<string, unknown>>; hold?: boolean };
type Peer = {
	connects: number;
	/** Options of every connect (the upgrade headers carry the bearer and account id of that moment). */
	connectOptions: Array<Record<string, any>>;
	/** Every request body the socket received, in order (WebSocket sends the JSON object itself). */
	sends: Array<Record<string, any>>;
	/** Closes the currently open socket from the peer side. */
	dropSocket(): void;
	connect: (options: unknown) => Promise<unknown>;
};
type Counts = { reads: number; connects: number; sends: number; collects: number; http: number };
type Host = {
	session: AgentSession;
	runtime: ModelRuntime;
	peer: Peer;
	counts: () => Counts;
	/** Arms the NEXT workspace capture to wait until the returned release is called (the automatic capture when armed in a settled listener). */
	holdNextCapture: () => () => void;
	/** Public listener helper: session.subscribe wrapper, returns the unsubscribe. */
	onEvent: (listener: (event: { type: string; aborted?: boolean }) => void) => () => void;
};

/** Scripted in-process WebSocket peer. A request beyond the script fails the send (recorded first, so it is counted). */
function fakePeer(scripts: Script[]): Peer {
	const peer = {
		connects: 0,
		connectOptions: [] as Array<Record<string, any>>,
		sends: [] as Array<Record<string, any>>,
		dropSocket: () => undefined as void,
		connect: undefined as unknown as (options: unknown) => Promise<unknown>,
	};
	peer.connect = async (options: unknown) => {
		peer.connects++;
		peer.connectOptions.push(options as Record<string, any>);
		let open = true;
		let batch: Script | undefined;
		let wake: (() => void) | undefined;
		const close = () => {
			open = false;
			wake?.();
		};
		peer.dropSocket = close;
		return {
			get isOpen() {
				return open;
			},
			socketIdentity: `socket-${peer.connects}`,
			events() {
				return (async function* () {
					for (const value of batch?.events ?? []) yield { text: JSON.stringify(value), value: value as Record<string, unknown> };
					if (batch?.hold) {
						await new Promise<void>((resolve) => {
							wake = resolve;
						});
						throw new SocketError(undefined, {}, "closed", "closed");
					}
				})();
			},
			async send(object: Record<string, any>) {
				peer.sends.push(object);
				const isCompaction = (Array.isArray(object.input) ? (object.input.at(-1) as { type?: unknown } | undefined)?.type : undefined) === "compaction_trigger";
				const next = isCompaction ? compactionScript() : scripts.shift();
				if (next === undefined) throw new Error(`unscripted socket request #${peer.sends.length}`);
				batch = next;
			},
			async interrupt() {
				throw new Error("unexpected interrupt");
			},
			async close() {
				close();
			},
		};
	};
	return peer;
}

/** Seeded native history of the session before any Codex request: a resumed session with provided messages. */
function seededHistory(agentDir: string): SessionManager {
	const manager = SessionManager.inMemory(agentDir);
	manager.appendMessage({ role: "user", content: HISTORY_USER, timestamp: 1 } as never);
	manager.appendMessage({ role: "assistant", content: [{ type: "text", text: HISTORY_ASSISTANT }], api: "openai-codex-responses", provider: CODEX_PROVIDER, model: "gpt-6-luna", usage, stopReason: "stop", timestamp: 2 } as never);
	return manager;
}

async function waitFor(condition: () => boolean, label: string, ms = 10_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/**
 * Deferred-turn barrier: the automatic check is a zero-delay timer scheduled by a settled event, so a 0 ms timer queued now runs after it
 * (same delay, FIFO), and a few immediate turns let its awaits of the fake peer and collector finish. No fixed wall-clock wait.
 */
async function quietWindow(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
	for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * One real registered facade on one real AgentSession, with the automatic path only (no host channel). `scripts` are the socket
 * responses in send order (compaction requests are answered by the peer itself). `history` resumes the session with provided
 * messages. Everything the run created is aborted, disposed and released in finally.
 */
async function withAutoHost(options: { scripts: Script[]; history?: boolean; compactionOff?: boolean; anthropicKey?: boolean }, run: (host: Host) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "rqw-codex-auto-runtime-"));
	let session: AgentSession | undefined;
	const releases: Array<() => void> = [];
	let holdNext = false;
	let release: (() => void) | undefined;
	try {
		const agentDir = join(root, "agent");
		await mkdir(agentDir, { recursive: true });
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const authPath = join(agentDir, "auth.json");
		await writeFile(authPath, JSON.stringify({ [CODEX_PROVIDER]: { type: "oauth", access: fakeAccess(), refresh: "refresh-auto-host-1", expires: exp * 1000, accountId: ACCOUNT }, ...(options.anthropicKey === true ? { anthropic: { type: "api_key", key: "fake-anthropic-key-auto-1" } } : {}) }));
		const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });

		const counts: Counts = { reads: 0, connects: 0, sends: 0, collects: 0, http: 0 };
		// Credential reads of the owned store, counted only when issued synchronously by this extension's source (as in idle-runtime).
		const credentials = (runtime as unknown as { credentials: { read: (...args: unknown[]) => Promise<unknown> } }).credentials;
		const readOriginal = credentials.read.bind(credentials);
		credentials.read = (...args: unknown[]) => {
			const limit = Error.stackTraceLimit;
			Error.stackTraceLimit = 200;
			const origin = new Error().stack ?? "";
			Error.stackTraceLimit = limit;
			if (args[0] === CODEX_PROVIDER && /\/extensions\/RQW-codex\/(?!test\/)[\w-]+\.ts/.test(origin)) counts.reads++;
			return readOriginal(...args);
		};

		const peer = fakePeer(options.scripts);
		// HTTP is refused: any SSE request is counted and fails the stream.
		const postEvents = () => {
			counts.http++;
			return (async function* () {
				throw new Error("HTTP refused by the automatic idle proof");
			})();
		};
		const codex = createCodexExtension({
			installationId: INSTALLATION,
			dependencies: {
				connect: peer.connect as never,
				postEvents: postEvents as never,
				collectWorkspaceMetadata: (async () => {
					counts.collects++;
					if (holdNext) {
						// Test-only gate: this capture stays pending until the test releases it (a stale completion must never send).
						holdNext = false;
						await new Promise<void>((resolve) => releases.push(resolve));
					}
					return {};
				}) as never,
				sleep: async () => undefined,
				clock: { now: () => Date.now() },
			},
		});
		const factory = (pi: ExtensionAPI) => codex(pi);
		const loader = new DefaultResourceLoader({
			cwd: agentDir, agentDir, additionalExtensionPaths: [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: [factory],
		});
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert.equal(loader.getExtensions().extensions.length, 1, "the RQW-codex factory is loaded");

		release = installRuntimeAuth(runtime);
		const model = runtime.getModels(CODEX_PROVIDER)[0]!;
		({ session } = await createAgentSession({
			cwd: agentDir, agentDir, modelRuntime: runtime, model, thinkingLevel: "off",
			resourceLoader: loader,
			sessionManager: options.history ? seededHistory(agentDir) : SessionManager.inMemory(agentDir),
			settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, transport: "websocket", ...(options.compactionOff === true ? { compaction: { enabled: false } } : {}) } as never),
		}));

		const host: Host = {
			session,
			runtime,
			peer,
			counts: () => ({ ...counts, connects: peer.connects, sends: peer.sends.length }),
			holdNextCapture: () => {
				holdNext = true;
				return () => releases.splice(0).forEach((resolve) => resolve());
			},
			onEvent: (listener) => session!.subscribe((event) => listener(event as { type: string; aborted?: boolean })),
		};
		await run(host);
	} finally {
		// Failure cleanup: release every held capture, abort a still-open request, then dispose the session.
		releases.splice(0).forEach((resolve) => resolve());
		if (session) {
			if (session.isStreaming) await session.abort().catch(() => undefined);
			try {
				session.dispose();
			} catch {
				// Already disposed by the case itself (the dispose case disposes inside the settled listener).
			}
		}
		release?.();
		await rm(root, { recursive: true, force: true });
	}
}

describe("automatic idle warm on the real registered facade (Pi 1.4.0 AgentSession, fake WebSocket peer, no host channel)", () => {
	it("actual prompt completes, the public settled listener drops the socket before the auto timer: the automatic warm arrives without a host event, is generate:false with the full visible history once, and nothing else changes", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withAutoHost({ scripts: [{ events: textEvents(TURN_1, FIRST_ANSWER) }, { events: warmEvents(PREWARM_1) }, { events: textEvents(TURN_2, NEXT_ANSWER) }], history: true }, async (host) => {
			let settledCount = 0;
			host.onEvent((event) => {
				if (event.type !== "agent_settled") return;
				settledCount++;
				if (event.aborted !== true && settledCount === 1) host.peer.dropSocket();
			});
			await host.session.prompt(FIRST_PROMPT);
			assert.equal(host.peer.sends.length, 1, "before the automatic warm: only the actual request");
			const messagesBefore = JSON.stringify(host.session.messages);
			const projectionBefore = JSON.stringify(host.session.sessionManager.buildSessionProjection().messages);
			await waitFor(() => host.peer.sends.length === 2, "the automatic warm after the settled peer close");
			assert.equal(settledCount, 1, "the settled event was seen once");
			assert.equal(host.peer.connects, 2, "one new socket for the automatic warm");
			const warm = host.peer.sends[1]!;
			assert.equal(warm.generate, false, "the automatic warm is generate:false");
			assert.equal(warm.previous_response_id, undefined, "the new socket carries no previous response");
			const json = JSON.stringify(warm.input);
			for (const text of [HISTORY_USER, HISTORY_ASSISTANT, FIRST_PROMPT, FIRST_ANSWER]) assert.equal(json.split(text).length - 1, 1, `the warm carries ${text} exactly once`);
			assert.equal(json.includes(NEXT_PROMPT), false, "no prompt that did not happen is in the warm");
			assert.equal(JSON.stringify(host.session.messages), messagesBefore, "the automatic warm does not mutate the session messages");
			assert.equal(JSON.stringify(host.session.sessionManager.buildSessionProjection().messages), projectionBefore, "the automatic warm does not mutate the transcript projection");
			await quietWindow();
			assert.equal(host.peer.sends.length, 2, "a further quiet window sends no extra warm");
			// Baseline above: the actual request and the automatic warm only. Now the next actual prompt on the same socket.
			await host.session.prompt(NEXT_PROMPT);
			assert.equal(host.peer.sends.length, 3, "the next actual prompt sends exactly one request");
			assert.equal(host.peer.connects, 2, "the next actual prompt reuses the automatic warm's socket");
			const next = host.peer.sends[2]!;
			assert.notEqual(next.generate, false, "the next actual request generates");
			assert.equal(next.previous_response_id, PREWARM_1, "the next actual request continues the automatic warm response");
			const nextInput = next.input as Array<Record<string, any>>;
			assert.equal(nextInput.length, 1, "the next actual request carries only the new user delta");
			assert.equal(nextInput[0]!.role, "user", "the delta is the new user item");
			const nextJson = JSON.stringify(nextInput);
			assert.equal(nextJson.split(NEXT_PROMPT).length - 1, 1, "the new prompt appears once");
			for (const text of [HISTORY_USER, HISTORY_ASSISTANT, FIRST_PROMPT, FIRST_ANSWER]) assert.equal(nextJson.includes(text), false, `the next request does not resend ${text}`);
			await quietWindow();
			assert.equal(host.peer.sends.length, 3, "a healthy settled next prompt sends no additional warm");
			assert.equal(host.counts().http, 0, "no HTTP request");
		});
	});

	it("healthy normal connection at the settled point: the automatic path sends no generate:false warm and no extra response", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withAutoHost({ scripts: [{ events: textEvents(TURN_1, FIRST_ANSWER) }], history: true }, async (host) => {
			let settled = 0;
			host.onEvent((event) => {
				if (event.type === "agent_settled") settled++;
			});
			await host.session.prompt(FIRST_PROMPT);
			await quietWindow();
			assert.equal(settled, 1, "the settled event was seen");
			assert.equal(host.peer.sends.length, 1, "only the actual request: no automatic warm on a healthy connection");
			assert.equal(host.peer.connects, 1, "the healthy socket is kept");
			assert.equal(host.counts().http, 0, "no HTTP request");
		});
	});

	it("abort of a held actual prompt: the public settled event reports aborted true and the automatic warm is skipped", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withAutoHost({ scripts: [{ events: [created(HELD_TURN)], hold: true }], history: true }, async (host) => {
			const aborted: boolean[] = [];
			host.onEvent((event) => {
				if (event.type === "agent_settled") aborted.push(event.aborted === true);
			});
			const prompting = host.session.prompt(BUSY_PROMPT);
			await waitFor(() => host.peer.sends.length === 1, "the held actual request");
			// The actual run collects its own workspaces at its start (before the held request); the baseline is taken after that.
			const collectsBefore = host.counts().collects;
			await host.session.abort();
			await prompting.catch(() => undefined);
			assert.deepEqual(aborted, [true], "the public settled event reports aborted true");
			await quietWindow();
			assert.equal(host.peer.sends.length, 1, "no automatic warm after an abort");
			assert.equal(host.peer.connects, 1, "no new socket after an abort");
			assert.equal(host.counts().collects, collectsBefore, "no automatic workspace capture after an abort");
		});
	});

	it("dispose inside the same public settled callback while the automatic workspace capture is held: the late capture resolves, and nothing is sent or captured after dispose", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withAutoHost({ scripts: [{ events: textEvents(TURN_1, FIRST_ANSWER) }, { events: warmEvents(PREWARM_1) }], history: true }, async (host) => {
			let releaseCapture: (() => void) | undefined;
			let disposed = false;
			host.onEvent((event) => {
				if (event.type !== "agent_settled" || event.aborted === true || disposed) return;
				host.peer.dropSocket();
				releaseCapture = host.holdNextCapture();
				disposed = true;
				host.session.dispose();
			});
			await host.session.prompt(FIRST_PROMPT);
			assert.equal(disposed, true, "the settled callback disposed the session");
			const before = host.counts();
			releaseCapture?.();
			await quietWindow();
			assert.equal(host.counts().sends, before.sends, "no warm after dispose");
			assert.equal(host.counts().connects, before.connects, "no socket after dispose");
			assert.equal(host.counts().http, 0, "no HTTP request");
		});
	});

	it("new run starts while the automatic capture is held: the automatic path is cancelled, the next actual prompt finishes without waiting for the held capture, and the stale completion never sends", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withAutoHost({ scripts: [{ events: textEvents(TURN_1, FIRST_ANSWER) }, { events: textEvents(TURN_2, NEXT_ANSWER) }, { events: warmEvents(PREWARM_2) }], history: true }, async (host) => {
			let releaseFirst: (() => void) | undefined;
			let armed = false;
			host.onEvent((event) => {
				if (event.type !== "agent_settled" || event.aborted === true) return;
				host.peer.dropSocket();
				if (!armed) {
					armed = true;
					releaseFirst = host.holdNextCapture();
				}
			});
			await host.session.prompt(FIRST_PROMPT);
			assert.equal(host.peer.sends.length, 1, "the first actual request is the only request before the new run");
			// Collections so far: the first run's own start capture (1) and the automatic capture (2), which is now held.
			await waitFor(() => host.counts().collects === 2 && releaseFirst !== undefined, "the automatic capture to be held");
			// The first automatic capture is pending now; a new actual run starts and must not wait for it.
			await host.session.prompt(NEXT_PROMPT);
			assert.equal(host.peer.sends.length, 2, "the next actual request was sent while the capture was held");
			assert.notEqual(host.peer.sends[1]!.generate, false, "the next actual request generates");
			assert.ok(JSON.stringify(host.peer.sends[1]!.input).includes(NEXT_PROMPT), "the next actual request carries the new prompt");
			// The post-run automatic warm of the new run (its own settled) is the only warm allowed.
			await waitFor(() => host.peer.sends.length === 3, "the post-run automatic warm of the new run");
			releaseFirst?.();
			await quietWindow();
			assert.equal(host.peer.sends.length, 3, "the stale automatic completion never sends");
			const warm = host.peer.sends[2]!;
			assert.equal(warm.generate, false, "the only automatic warm is generate:false");
			assert.ok(JSON.stringify(warm.input).includes(NEXT_PROMPT), "the only automatic warm is the new run's, carrying its prompt");
			assert.equal(host.counts().http, 0, "no HTTP request");
		});
	});

	it("manual compaction with a fake peer: the compaction request sends exactly one opaque item, then the public compaction_end drops the socket, and the automatic warm carries the accepted opaque checkpoint once with no compaction trigger and no old ordinary assistant or duplicate originals", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withAutoHost({ scripts: [{ events: warmEvents(PREWARM_1) }, { events: textEvents(TURN_2, NEXT_ANSWER) }], history: true, compactionOff: true }, async (host) => {
			let compactionEnds = 0;
			host.onEvent((event) => {
				if (event.type !== "compaction_end") return;
				compactionEnds++;
				host.peer.dropSocket();
			});
			const result = await host.session.compact();
			assert.equal(compactionEnds, 1, "the public compaction_end was seen once");
			assert.equal(result.details.window.number, 1, "the accepted compaction advances the window 0 to 1");
			await waitFor(() => host.peer.sends.length === 2, "the automatic warm after the compaction");
			const compaction = host.peer.sends[0]!;
			assert.deepEqual((compaction.input as Array<Record<string, any>>).at(-1), { type: "compaction_trigger" }, "the manual request ends with the trigger");
			const warm = host.peer.sends[1]!;
			assert.equal(warm.generate, false, "the automatic warm is generate:false");
			assert.equal(warm.previous_response_id, undefined, "the new socket carries no previous response");
			const input = warm.input as Array<Record<string, any>>;
			// Accepted projection: the next actual request after this compaction carries the retained user text, the opaque checkpoint,
			// the transient developer item and the new prompt. Native V2 retention keeps recent USER text; old assistant text is excluded.
			assert.equal(JSON.stringify(input).split(COMPACT_OPAQUE).length - 1, 1, "the accepted opaque checkpoint appears once");
			assert.ok(JSON.stringify(input).split(HISTORY_USER).length - 1 <= 1, "the retained user text appears at most once");
			assert.equal(input.some((item) => item.type === "compaction_trigger"), false, "no compaction trigger in the automatic warm");
			assert.equal(JSON.stringify(input).includes(HISTORY_ASSISTANT), false, "no old ordinary assistant text after the native compaction");
			assert.equal(host.session.messages.some((message) => (message as { role?: string }).role === "compactionSummary"), false, "no Pi text summary entry");
			await quietWindow();
			assert.equal(host.peer.sends.length, 2, "a further quiet window sends no duplicate warm");
			// Baseline above: the compaction request and the automatic warm only. Now the next actual prompt on the warm's socket.
			await host.session.prompt(NEXT_PROMPT);
			assert.equal(host.peer.sends.length, 3, "the next actual prompt sends exactly one request");
			assert.equal(host.peer.connects, 2, "the next actual prompt reuses the automatic warm's socket");
			const next = host.peer.sends[2]!;
			assert.notEqual(next.generate, false, "the next actual request generates");
			assert.equal(next.previous_response_id, PREWARM_1, "the next actual request continues the automatic warm response");
			const nextInput = next.input as Array<Record<string, any>>;
			assert.equal(nextInput.length, 1, "the next actual request carries only the new user delta");
			assert.equal(nextInput[0]!.role, "user", "the delta is the new user item");
			const nextJson = JSON.stringify(nextInput);
			assert.equal(nextJson.split(NEXT_PROMPT).length - 1, 1, "the new prompt appears once");
			for (const text of [COMPACT_OPAQUE, HISTORY_USER, HISTORY_ASSISTANT]) assert.equal(nextJson.includes(text), false, `the next request does not resend ${text}`);
			await quietWindow();
			assert.equal(host.peer.sends.length, 3, "a healthy settled next prompt sends no additional warm");
			assert.equal(host.counts().http, 0, "no HTTP request");
		});
	});

	for (const target of ["other Codex slug", "foreign provider (Anthropic)"] as const) {
		it(`model switch to ${target} while the automatic capture is held: the public setModel is the only change, and the released setup sends no warm for the old model`, { timeout: CASE_TIMEOUT_MS }, async () => {
			await withAutoHost({ scripts: [{ events: textEvents(TURN_1, FIRST_ANSWER) }], history: true, anthropicKey: target !== "other Codex slug" }, async (host) => {
				const before = host.session.model!;
				const next = target === "other Codex slug"
					? host.runtime.getModels(CODEX_PROVIDER).find((model) => model.id !== before.id)!
					: host.runtime.getModels("anthropic")[0]!;
				assert.ok(next, "a different model exists");
				let releaseCapture: (() => void) | undefined;
				host.onEvent((event) => {
					if (event.type !== "agent_settled" || event.aborted === true || releaseCapture !== undefined) return;
					host.peer.dropSocket();
					releaseCapture = host.holdNextCapture();
				});
				await host.session.prompt(FIRST_PROMPT);
				// The actual run captured once at its start; the automatic capture (second collection) is now held.
				await waitFor(() => host.counts().collects === 2 && releaseCapture !== undefined, "the automatic capture to be held");
				await host.session.setModel(next);
				assert.equal(host.session.model?.id, next.id, "the public setModel selected the new model");
				releaseCapture?.();
				await quietWindow();
				assert.equal(host.peer.sends.length, 1, "the released setup sends nothing: no warm for the old model");
				assert.equal(host.peer.connects, 1, "no new socket for the old model");
				assert.equal(host.counts().http, 0, "no HTTP request");
			});
		});
	}

	it("manual V2 compaction, then the saved slot becomes account B while the automatic capture is held after its ensureReady: the released setup sends nothing under B, the next prompt under B carries no A opaque item and the B header", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withAutoHost({ scripts: [{ events: textEvents(TURN_2, NEXT_ANSWER) }], history: true, compactionOff: true }, async (host) => {
			let compactionEnds = 0;
			let collectsAtEnd = -1;
			let releaseCapture: (() => void) | undefined;
			host.onEvent((event) => {
				if (event.type !== "compaction_end") return;
				compactionEnds++;
				// The manual compaction's own capture is already done here; the next capture is the automatic one, which is held.
				collectsAtEnd = host.counts().collects;
				host.peer.dropSocket();
				releaseCapture = host.holdNextCapture();
			});
			const result = await host.session.compact();
			assert.equal(compactionEnds, 1, "the public compaction_end was seen once");
			assert.equal(result.details.window.number, 1, "the accepted compaction advances the window 0 to 1");
			assert.equal(host.peer.sends.length, 1, "the manual compaction sent exactly one request");
			await waitFor(() => host.counts().collects === collectsAtEnd + 1 && releaseCapture !== undefined, "the automatic capture to park after its ensureReady");
			assert.equal(host.peer.sends.length, 1, "nothing is sent while the automatic capture is parked");
			const acceptedEntries = JSON.stringify(host.session.sessionManager.getEntries());
			const acceptedCustom = host.session.sessionManager.getEntries().filter((entry) => entry.type === "custom").length;
			await host.runtime.credentials.modify(CODEX_PROVIDER, async () => ({ type: "oauth", access: tokenOf(ACCOUNT_B, "b-1"), refresh: "refresh-b-1", expires: (Math.floor(Date.now() / 1000) + 3600) * 1000, accountId: ACCOUNT_B }) as never);
			releaseCapture!();
			await quietWindow();
			assert.equal(host.peer.sends.length, 1, "the released setup sends nothing: no A opaque, no automatic warm under B");
			assert.equal(host.peer.connects, 1, "no socket is opened under B by the automatic setup");
			assert.equal(JSON.stringify(host.session.sessionManager.getEntries()), acceptedEntries, "the accepted A checkpoint, window and entries are unchanged");
			assert.equal(host.session.sessionManager.getEntries().filter((entry) => entry.type === "custom").length, acceptedCustom, "the custom entry count is unchanged");
			await host.session.prompt(NEXT_PROMPT);
			assert.equal(host.peer.sends.length, 2, "the next normal prompt under B sends exactly one request");
			assert.equal(host.peer.connects, 2, "the next prompt under B uses a new socket");
			const headers = host.peer.connectOptions[1]!.headers as Record<string, string>;
			assert.equal(headers["ChatGPT-Account-ID"], ACCOUNT_B, "the upgrade carries the B account");
			assert.equal(headers.Authorization, `Bearer ${tokenOf(ACCOUNT_B, "b-1")}`, "the upgrade carries the B token");
			const next = host.peer.sends[1]!;
			assert.notEqual(next.generate, false, "the next request generates");
			assert.equal(next.previous_response_id, undefined, "the B request has no A previous response");
			const json = JSON.stringify(next.input);
			assert.equal(json.includes(COMPACT_OPAQUE), false, "no A opaque checkpoint under B");
			assert.equal(json.includes("encrypted_content"), false, "no raw encrypted item under B");
			assert.equal(json.split(NEXT_PROMPT).length - 1, 1, "the new prompt appears once");
			assert.equal(json.split(HISTORY_USER).length - 1, 1, "the portable original user text is retained once");
			assert.equal(json.split(HISTORY_ASSISTANT).length - 1, 1, "the portable original assistant text is retained once");
			await quietWindow();
			assert.equal(host.peer.sends.length, 2, "a healthy settled prompt under B sends no extra warm");
			assert.equal(host.counts().http, 0, "no HTTP request");
		});
	});

	it("manual V2 compaction, then a same-account token rotation while the automatic capture is held: the automatic generate:false warm carries the A checkpoint once with the rotated token, and the next prompt reuses its response and socket", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withAutoHost({ scripts: [{ events: warmEvents(PREWARM_1) }, { events: textEvents(TURN_2, NEXT_ANSWER) }], history: true, compactionOff: true }, async (host) => {
			let collectsAtEnd = -1;
			let releaseCapture: (() => void) | undefined;
			host.onEvent((event) => {
				if (event.type !== "compaction_end") return;
				collectsAtEnd = host.counts().collects;
				host.peer.dropSocket();
				releaseCapture = host.holdNextCapture();
			});
			await host.session.compact();
			assert.equal(host.peer.sends.length, 1, "the manual compaction sent exactly one request");
			await waitFor(() => host.counts().collects === collectsAtEnd + 1 && releaseCapture !== undefined, "the automatic capture to park after its ensureReady");
			assert.equal(host.peer.sends.length, 1, "nothing is sent while the automatic capture is parked");
			const rotated = tokenOf(ACCOUNT, "a-2");
			await host.runtime.credentials.modify(CODEX_PROVIDER, async () => ({ type: "oauth", access: rotated, refresh: "refresh-a-2", expires: (Math.floor(Date.now() / 1000) + 3600) * 1000, accountId: ACCOUNT }) as never);
			releaseCapture!();
			await waitFor(() => host.peer.sends.length === 2, "the automatic warm after the rotation");
			const warm = host.peer.sends[1]!;
			assert.equal(warm.generate, false, "the automatic warm is generate:false");
			assert.equal(warm.previous_response_id, undefined, "the new socket carries no previous response");
			const warmJson = JSON.stringify(warm.input);
			assert.equal(warmJson.split(COMPACT_OPAQUE).length - 1, 1, "the A accepted checkpoint appears once in the warm");
			assert.equal((warm.input as Array<Record<string, unknown>>).some((item) => item.type === "compaction_trigger"), false, "no compaction trigger in the warm");
			assert.equal(host.peer.connects, 2, "one new socket for the warm");
			const headers = host.peer.connectOptions[1]!.headers as Record<string, string>;
			assert.equal(headers.Authorization, `Bearer ${rotated}`, "the warm socket carries the rotated token");
			assert.equal(headers["ChatGPT-Account-ID"], ACCOUNT, "the warm socket carries the same account");
			await quietWindow();
			assert.equal(host.peer.sends.length, 2, "a further quiet window sends no duplicate warm");
			await host.session.prompt(NEXT_PROMPT);
			assert.equal(host.peer.sends.length, 3, "the next prompt sends exactly one request");
			assert.equal(host.peer.connects, 2, "the next prompt reuses the warm's socket");
			const next = host.peer.sends[2]!;
			assert.notEqual(next.generate, false, "the next request generates");
			assert.equal(next.previous_response_id, PREWARM_1, "the next request continues the warm response");
			const nextInput = next.input as Array<Record<string, any>>;
			assert.equal(nextInput.length, 1, "the next request carries only the new user delta");
			assert.equal(nextInput[0]!.role, "user", "the delta is the new user item");
			assert.equal(JSON.stringify(nextInput).includes(COMPACT_OPAQUE), false, "the next request does not resend the checkpoint");
			await quietWindow();
			assert.equal(host.peer.sends.length, 3, "a healthy settled next prompt sends no additional warm");
			assert.equal(host.counts().http, 0, "no HTTP request");
		});
	});
});
