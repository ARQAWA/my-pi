// Host-channel idle prewarm on the real registered facade: createCodexExtension (registration -> lifecycle -> session controller ->
// CodexThreadTransport) on one real Pi 1.4.0 AgentSession. The host asks through PREWARM_HISTORY_CHANNEL on the factory's pi.events.
// The WebSocket is a fake peer (scripted, in-process); HTTP (postEvents) is refused and counted; workspace facts come from an
// injected collector. Temporary agent directory, fake OAuth JWT, no network, no real credentials.
// bindExtensions is deliberately NOT called: it emits session_start, which starts an unrelated startup warm in registration.ts.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { describe, it } from "node:test";
import { createAgentSession, createCodemodeExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installRuntimeAuth } from "../auth-runtime.ts";
import { createCodexExtension } from "../index.ts";
import { CODEX_PROVIDER } from "../profile.ts";
import { PREWARM_HISTORY_CHANNEL, SESSION_POLICY_CHANNEL, type PrewarmHistoryRequest, type SessionPolicyRequest } from "../registration.ts";
import { STARTUP_PROJECTION_CHANNEL } from "../session.ts";
import { SocketError } from "../websocket.ts";

const ACCOUNT = "acct_idle_host_runtime_1";
const INSTALLATION = "44444444-5555-4666-8777-999999999999";
const CASE_TIMEOUT_MS = 15_000;
const HISTORY_USER = "HISTORY-USER-1";
const HISTORY_ASSISTANT = "HISTORY-ASSISTANT-1";
const NEW_PROMPT = "NEW-PROMPT-1";
const ANSWER = "ANSWER-1";
const BUSY_PROMPT = "BUSY-PROMPT-1";
const FIRST_PROMPT = "FIRST-PROMPT-1";
const FIRST_ANSWER = "FIRST-ANSWER-1";
const NEXT_PROMPT = "NEXT-PROMPT-1";
const NEXT_ANSWER = "NEXT-ANSWER-1";
const LEADING_BASE_TEXT = "You are an expert coding assistant";
const FORCED_PROMPT = "FORCED-CHILD-BASE-1: the exact forced startup prompt of a child";
const CHILD_PROMPT_1 = "CHILD-PROMPT-1";
const CHILD_ANSWER_1 = "CHILD-ANSWER-1";
const CHILD_PROMPT_2 = "CHILD-PROMPT-2";
const CHILD_ANSWER_2 = "CHILD-ANSWER-2";
const CHILD_WARM_1 = "resp_child_warm_1";
const CHILD_TURN_1 = "resp_child_turn_1";
const CHILD_WARM_2 = "resp_child_warm_2";
const SOFT_CHILD_PROMPT = "SOFT-CHILD-BASE-1: a custom soft startup prompt of a child";
const PARENT_ONLY = "PARENT-ONLY-SECTION-1: a section only the parent projects";
const HIDDEN_BASE = ["read", "bash", "edit", "write"];
const CHILD_TURN_2 = "resp_child_turn_2";

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeAccess(): string {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return `${b64url({ alg: "none" })}.${b64url({ exp, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;
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

const COMPACT_RESPONSE = "resp_compact_idle_1";
const COMPACT_OPAQUE = "fakeOpaque-compaction-idle-1";
const COMPACT_ITEM = { type: "compaction", id: "cmp_idle_1", encrypted_content: COMPACT_OPAQUE };

/** Auto response of a compaction request (its input ends with compaction_trigger): one opaque item, then completed with that output. */
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
	/** Every request body the socket received, in order (WebSocket sends the JSON object itself). */
	sends: Array<Record<string, any>>;
	/** Closes the currently open socket from the peer side. */
	dropSocket(): void;
	connect: (options: unknown) => Promise<unknown>;
};
type Counts = { reads: number; connects: number; sends: number; collects: number; http: number };
type Host = {
	session: AgentSession;
	peer: Peer;
	agentDir: string;
	counts: () => Counts;
	emit: (request: PrewarmHistoryRequest) => void;
	createForeignSession: () => Promise<AgentSession>;
	/** A child session on the same runtime, with a test-only before_agent_start marker that forces `prompt` (Pi's forceSystemPrompt). */
	createForcedChild: (prompt: string) => Promise<AgentSession>;
	/** A child session on the same runtime with a custom SOFT startup prompt from its own loader (no before_agent_start force). */
	createSoftChild: () => Promise<AgentSession>;
	/** Emits the child's policy request on the owner's bus, as RQW-agent does for a spawned child. */
	emitPolicy: (request: SessionPolicyRequest) => void;
};

/** Scripted in-process WebSocket peer. A request beyond the script fails the send (recorded first, so it is counted). */
function fakePeer(scripts: Script[]): Peer {
	const peer = {
		connects: 0,
		sends: [] as Array<Record<string, any>>,
		dropSocket: () => undefined as void,
		connect: undefined as unknown as (options: unknown) => Promise<unknown>,
	};
	peer.connect = async () => {
		peer.connects++;
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

/** Declared tool names of one request body: Responses Lite additional_tools items, or stock top-level tools (namespaces flattened). */
const declaredNames = (body: Record<string, any>): string[] => [
	...(body.tools ?? []),
	...((body.input as Array<Record<string, any>>) ?? []).filter((item) => item.type === "additional_tools").flatMap((item) => item.tools ?? []),
].flatMap((tool: Record<string, any>) => (tool.type === "namespace" ? (tool.tools as Array<{ name: string }>).map((inner) => inner.name) : [tool.name]));

async function waitFor(condition: () => boolean, label: string, ms = 10_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/** Bounded drain of already-queued callbacks: the host setup has no timer, so a fixed number of turns of the loop is enough. */
async function drain(): Promise<void> {
	for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * One real registered facade on one real AgentSession. `scripts` are the socket responses in send order; `history` resumes the
 * session with provided messages. Everything the run created is aborted, disposed and removed in finally.
 */
async function withHost(options: { scripts: Script[]; history?: boolean; passthrough?: boolean; codemode?: boolean; parentOnly?: boolean; startup?: boolean; compactionOff?: boolean }, run: (host: Host) => Promise<void>) {
	// passthrough (test-only opt-in): a before_agent_start hook that returns the event's own prompt options. Off by default: the real SDK runs.
	const root = await mkdtemp(join(tmpdir(), "rqw-codex-idle-runtime-"));
	let session: AgentSession | undefined;
	let foreign: AgentSession | undefined;
	const children: AgentSession[] = [];
	let release: (() => void) | undefined;
	try {
		const agentDir = join(root, "agent");
		await mkdir(agentDir, { recursive: true });
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const authPath = join(agentDir, "auth.json");
		await writeFile(authPath, JSON.stringify({ [CODEX_PROVIDER]: { type: "oauth", access: fakeAccess(), refresh: "refresh-idle-host-1", expires: exp * 1000, accountId: ACCOUNT } }));
		const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });

		const counts: Counts = { reads: 0, connects: 0, sends: 0, collects: 0, http: 0 };
		// Credential reads of the owned store (the same object the facade passes to its controllers and transports).
		const credentials = (runtime as unknown as { credentials: { read: (...args: unknown[]) => Promise<unknown> } }).credentials;
		const readOriginal = credentials.read.bind(credentials);
		// Counted: reads of the Codex slot issued synchronously by this extension's source. Pi's own model catalog also reads the
		// Codex slot on its own availability refresh schedule; those reads come from pi-ai/pi-coding-agent frames and are not counted.
		credentials.read = (...args: unknown[]) => {
			const limit = Error.stackTraceLimit;
			Error.stackTraceLimit = 200;
			const origin = new Error().stack ?? "";
			Error.stackTraceLimit = limit;
			if (args[0] === CODEX_PROVIDER && /\/extensions\/RQW-codex\/(?!test\/)[\w-]+\.ts/.test(origin)) counts.reads++;
			return readOriginal(...args);
		};

		const peer = fakePeer(options.scripts);
		let piEvents: ExtensionAPI["events"] | undefined;
		// HTTP is refused: any SSE request is counted and fails the stream.
		const postEvents = () => {
			counts.http++;
			return (async function* () {
				throw new Error("HTTP refused by the idle host-channel proof");
			})();
		};
		const codex = createCodexExtension({
			installationId: INSTALLATION,
			dependencies: {
				connect: peer.connect as never,
				postEvents: postEvents as never,
				collectWorkspaceMetadata: (async () => {
					counts.collects++;
					return {};
				}) as never,
				sleep: async () => undefined,
				clock: { now: () => Date.now() },
			},
		});
		const factory = (pi: ExtensionAPI) => {
			codex(pi);
			piEvents = pi.events;
			// Test-only parent projector: a parent section the root's projection adds (what RQW-prompt/RQW-tools may do on the owner bus).
			if (options.parentOnly === true) {
				pi.events.on(STARTUP_PROJECTION_CHANNEL, (data) => {
					const request = data as { options: { sections: Record<string, string> } };
					request.options.sections = { ...request.options.sections, parent_only: PARENT_ONLY };
				});
			}
			if (options.passthrough === true) pi.on("before_agent_start", (event) => ({ systemPrompt: event.systemPrompt }) as never);
		};
		const loader = new DefaultResourceLoader({
			cwd: agentDir, agentDir, additionalExtensionPaths: [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: options.codemode === true ? [factory, createCodemodeExtension()] : [factory],
		});
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert.equal(loader.getExtensions().extensions.length, options.codemode === true ? 2 : 1, "the RQW-codex factory (and the built-in codemode when configured) is loaded");

		release = installRuntimeAuth(runtime);
		const model = runtime.getModels(CODEX_PROVIDER)[0]!;
		({ session } = await createAgentSession({
			cwd: agentDir, agentDir, modelRuntime: runtime, model, thinkingLevel: "off",
			resourceLoader: loader,
			sessionManager: options.history ? seededHistory(agentDir) : SessionManager.inMemory(agentDir),
			settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, transport: "websocket", ...(options.codemode === true ? { codemode: { mode: "only" } } : {}), ...(options.compactionOff === true ? { compaction: { enabled: false } } : {}) } as never),
		}));
		// Built-in codemode is registered inactive; `only` hides the active direct base functions from the declarations (still executable).
		if (options.codemode === true) session.setActiveToolsByName([...session.getActiveToolNames(), "codemode"]);
		// Real session_start: the root's lifecycle starts its controller (startup warm) through the registered facade.
		if (options.startup === true) await session.bindExtensions({ shutdownHandler: () => undefined });
		const bus = piEvents;
		if (!bus) throw new Error("the factory did not receive pi.events");

		const host: Host = {
			session,
			peer,
			agentDir,
			counts: () => ({ ...counts, connects: peer.connects, sends: peer.sends.length }),
			emit: (request) => bus.emit(PREWARM_HISTORY_CHANNEL, request),
			createForeignSession: async () => {
				// A plain session on its OWN runtime, without the RQW-codex factory: its thread id is foreign to the owner. (A session on the
				// same runtime is bound to the owner by the lifecycle lease, so it is not foreign.)
				const otherRuntime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
				const plain = new DefaultResourceLoader({ cwd: agentDir, agentDir, additionalExtensionPaths: [], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
				await plain.reload();
				({ session: foreign } = await createAgentSession({
					cwd: agentDir, agentDir, modelRuntime: otherRuntime, model, thinkingLevel: "off", resourceLoader: plain,
					sessionManager: SessionManager.inMemory(agentDir), settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
				}));
				return foreign;
			},
			createForcedChild: async (prompt) => {
				// Test-only marker: a before_agent_start that returns the forced prompt. No RQW extension is loaded in the child.
				const marker = new DefaultResourceLoader({
					cwd: agentDir, agentDir, additionalExtensionPaths: [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
					extensionFactories: [(pi: ExtensionAPI) => { pi.on("before_agent_start", () => ({ systemPrompt: prompt }) as never); }],
				});
				await marker.reload();
				const { session: child } = await createAgentSession({
					cwd: agentDir, agentDir, modelRuntime: runtime, model, thinkingLevel: "off", resourceLoader: marker,
					sessionManager: SessionManager.inMemory(agentDir), settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, transport: "websocket" }),
				});
				children.push(child);
				return child;
			},
			createSoftChild: async () => {
				// A child with its own custom prompt (the loader's systemPrompt) and no before_agent_start force: a soft startup prompt.
				const soft = new DefaultResourceLoader({
					cwd: agentDir, agentDir, additionalExtensionPaths: [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
					systemPrompt: SOFT_CHILD_PROMPT,
				});
				await soft.reload();
				const { session: child } = await createAgentSession({
					cwd: agentDir, agentDir, modelRuntime: runtime, model, thinkingLevel: "off", resourceLoader: soft,
					sessionManager: SessionManager.inMemory(agentDir), settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, transport: "websocket" }),
				});
				children.push(child);
				return child;
			},
			emitPolicy: (request) => bus.emit(SESSION_POLICY_CHANNEL, request),
		};
		await run(host);
	} finally {
		// Failure cleanup: a still-open socket request is aborted, then every session is disposed.
		for (const item of [session, foreign, ...children]) {
			if (!item) continue;
			if (item.isStreaming) await item.abort().catch(() => undefined);
			item.dispose();
		}
		release?.();
		await rm(root, { recursive: true, force: true });
	}
}

const PREWARM_1 = "resp_warm_1";
const TURN_1 = "resp_turn_1";
const PREWARM_2 = "resp_warm_2";
const TURN_3 = "resp_turn_3";

describe("idle host channel on the real registered facade (Pi 1.4.0 AgentSession, fake WebSocket peer)", () => {
	it("unknown or foreign thread: the request stays unaccepted, with no credential read, controller work, socket, HTTP or workspace capture", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [], history: true }, async (host) => {
			const foreign = await host.createForeignSession();
			const before = host.counts();
			for (const threadId of ["unknown-thread-idle-proof", foreign.sessionId]) {
				const request: PrewarmHistoryRequest = { threadId };
				host.emit(request);
				await drain();
				assert.equal(request.accepted, undefined, `thread ${threadId === foreign.sessionId ? "(foreign session)" : "(unknown)"} is not accepted`);
				assert.equal(request.error, undefined, "no error is written for an unowned thread");
			}
			assert.deepEqual(host.counts(), before, "zero additional credential reads, connects, socket requests, HTTP requests and workspace captures");
		});
	});

	it("idle host channel with resumed history: the warm is prepared with the current effective history before any normal generation, and no startup warm ran", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [{ events: warmEvents(PREWARM_1) }], history: true }, async (host) => {
			assert.equal(host.peer.sends.length, 0, "no socket request before the host asks (no startup warm)");
			assert.equal(host.peer.connects, 0, "no socket before the host asks");
			const request: PrewarmHistoryRequest = {};
			host.emit(request);
			assert.equal(request.accepted, true, "the owned root accepts the idle request");
			await waitFor(() => host.peer.sends.length === 1, "the prepared warm request");
			const warm = host.peer.sends[0]!;
			assert.equal(warm.generate, false, "the prewarm is generate:false");
			const json = JSON.stringify(warm.input);
			assert.ok(json.includes(HISTORY_USER), "the warm carries the provided user history");
			assert.ok(json.includes(HISTORY_ASSISTANT), "the warm carries the provided assistant history");
			assert.equal(host.peer.connects, 1, "one socket for the warm");
			assert.equal(host.counts().http, 0, "no HTTP request");
			assert.ok(host.counts().reads > 0, "the owner's credential read is observed by the counter (the probe can see owner reads)");
		});
	});

	it("next actual prompt reuses the prepared warm response and socket: previous_response_id is the warm response and only the new input is sent", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [{ events: warmEvents(PREWARM_1) }, { events: textEvents(TURN_1, ANSWER) }], history: true }, async (host) => {
			host.emit({});
			await waitFor(() => host.peer.sends.length === 1, "the prepared warm request");
			await host.session.prompt(NEW_PROMPT);
			assert.equal(host.peer.sends.length, 2, "exactly one normal request after the warm");
			assert.equal(host.peer.connects, 1, "the warm socket is reused for the normal turn");
			const turn = host.peer.sends[1]!;
			assert.notEqual(turn.generate, false, "the normal request generates");
			assert.equal(turn.previous_response_id, PREWARM_1, "previous_response_id is the warm response");
			const input = turn.input as Array<Record<string, any>>;
			assert.equal(input.length, 1, "only the new input is sent incrementally");
			const json = JSON.stringify(input);
			assert.ok(json.includes(NEW_PROMPT), "the new prompt is the incremental input");
			assert.equal(json.includes(HISTORY_USER), false, "no duplicate history user message");
			assert.equal(json.includes(HISTORY_ASSISTANT), false, "no duplicate history assistant message");
		});
	});

	it("after a successful normal turn on a healthy connection, a host channel request sends no second warm", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [{ events: warmEvents(PREWARM_1) }, { events: textEvents(TURN_1, ANSWER) }], history: true }, async (host) => {
			host.emit({});
			await waitFor(() => host.peer.sends.length === 1, "the prepared warm request");
			await host.session.prompt(NEW_PROMPT);
			assert.equal(host.peer.sends.length, 2);
			const before = host.counts();
			const request: PrewarmHistoryRequest = {};
			host.emit(request);
			assert.equal(request.accepted, true, "the owned root accepts the idle request");
			await drain();
			assert.equal(host.counts().sends, before.sends, "no additional socket request (no second warm)");
			assert.equal(host.peer.connects, before.connects, "the healthy connection is kept");
			assert.equal(host.counts().http, 0);
		});
	});

	it("forced peer close after a finished normal turn: the next idle host request reconnects and prepares again with the effective history", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [{ events: warmEvents(PREWARM_1) }, { events: textEvents(TURN_1, ANSWER) }, { events: warmEvents(PREWARM_2) }], history: true }, async (host) => {
			host.emit({});
			await waitFor(() => host.peer.sends.length === 1, "the first prepared warm");
			await host.session.prompt(NEW_PROMPT);
			assert.equal(host.peer.connects, 1);
			host.peer.dropSocket();
			const request: PrewarmHistoryRequest = {};
			host.emit(request);
			assert.equal(request.accepted, true);
			await waitFor(() => host.peer.sends.length === 3, "the warm after the reconnect");
			assert.equal(host.peer.connects, 2, "a new socket for the idle warm");
			const warm = host.peer.sends[2]!;
			assert.equal(warm.generate, false, "the reconnect warm is generate:false");
			assert.equal(warm.previous_response_id, undefined, "the new socket carries no previous response");
			const json = JSON.stringify(warm.input);
			for (const text of [HISTORY_USER, NEW_PROMPT, ANSWER]) assert.ok(json.includes(text), `the effective history carries ${text}`);
			assert.equal(json.split(ANSWER).length - 1, 1, "the answer appears once in the warm");
		});
	});

	it("busy actual prompt held before its terminal event: the idle host request does not prewarm", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [{ events: [created(TURN_1)], hold: true }], history: true }, async (host) => {
			const prompting = host.session.prompt(BUSY_PROMPT);
			await waitFor(() => host.peer.sends.length === 1, "the held normal request");
			assert.equal(host.session.isStreaming, true, "the prompt is busy");
			const before = host.counts();
			const request: PrewarmHistoryRequest = {};
			host.emit(request);
			await drain();
			assert.equal(host.counts().sends, before.sends, "no prewarm socket request while busy");
			assert.equal(host.peer.connects, before.connects, "no new socket while busy");
			assert.equal(host.counts().collects, before.collects, "no idle workspace capture while busy");
			await host.session.abort();
			await prompting.catch(() => undefined);
		});
	});

	it("default SDK prompt (no before_agent_start hook): the warm carries the pending section patch after the history, and the next normal turn reuses it", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [{ events: warmEvents(PREWARM_1) }, { events: textEvents(TURN_1, ANSWER) }], history: true }, async (host) => {
			host.emit({});
			await waitFor(() => host.peer.sends.length === 1, "the prepared warm request");
			await host.session.prompt(NEW_PROMPT);
			assert.equal(host.peer.sends.length, 2, "exactly one normal request after the warm");
			assert.equal(host.peer.connects, 1, "the warm socket is reused for the normal turn");
			const warm = host.peer.sends[0]!;
			const turn = host.peer.sends[1]!;
			// The warm input order: tools declaration, the provided history, then the pending section patch (Pi's _prepareRun order).
			const warmInput = warm.input as Array<Record<string, any>>;
			const text = (item: Record<string, any>) => JSON.stringify(item.content ?? "");
			const userAt = warmInput.findIndex((item) => item.type === "message" && item.role === "user" && text(item).includes(HISTORY_USER));
			const assistantAt = warmInput.findIndex((item) => item.type === "message" && item.role === "assistant" && text(item).includes(HISTORY_ASSISTANT));
			const patchAt = warmInput.findIndex((item) => item.type === "message" && item.role === "developer" && text(item).includes('Updated system prompt section \\"preamble\\"'));
			assert.ok(userAt >= 0 && assistantAt > userAt, "the warm carries the history user then the history assistant");
			assert.ok(patchAt > assistantAt, "the pending section patch follows the history in the warm");
			assert.equal(warmInput.filter((item) => item.type === "message" && item.role === "developer" && text(item).includes("Updated system prompt section")).length, 1, "the warm carries one section patch");
			assert.equal(turn.previous_response_id, PREWARM_1, "previous_response_id is the warm response");
			const input = turn.input as Array<Record<string, any>>;
			assert.equal(input.length, 1, "only the new input is sent incrementally");
			assert.ok(JSON.stringify(input).includes(NEW_PROMPT), "the new prompt is the incremental input");
			assert.equal(JSON.stringify(input).includes("Updated system prompt section"), false, "the section patch is not sent again on the normal turn");
		});
	});

	it("default SDK prompt with no history: the first warm carries the base prompt item as the first normal request does, and the next normal turn reuses it", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [{ events: warmEvents(PREWARM_1) }, { events: textEvents(TURN_1, ANSWER) }] }, async (host) => {
			host.emit({});
			await waitFor(() => host.peer.sends.length === 1, "the prepared warm request");
			await host.session.prompt(NEW_PROMPT);
			assert.equal(host.peer.sends.length, 2, "exactly one normal request after the warm");
			assert.equal(host.peer.connects, 1, "the warm socket is reused for the normal turn");
			const warm = host.peer.sends[0]!;
			const turn = host.peer.sends[1]!;
			const warmInput = warm.input as Array<Record<string, any>>;
			assert.equal(warmInput.filter((item) => item.type === "message" && (item.role === "user" || item.role === "assistant")).length, 0, "the warm carries no transcript item");
			assert.equal(warmInput.filter((item) => item.type === "message" && item.role === "developer" && JSON.stringify(item.content ?? "").includes("You are an expert coding assistant")).length, 1, "the warm carries the base section text");
			assert.equal(turn.previous_response_id, PREWARM_1, "previous_response_id is the warm response");
			const input = turn.input as Array<Record<string, any>>;
			assert.equal(input.length, 1, "only the new input is sent incrementally");
			assert.ok(JSON.stringify(input).includes(NEW_PROMPT), "the new prompt is the incremental input");
		});
	});

	it("fresh no-history host: the first actual prompt creates the leading system message, the idle warm after the peer close carries base, first user and first answer once, and the next actual prompt sends only the new delta", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [{ events: textEvents(TURN_1, FIRST_ANSWER) }, { events: warmEvents(PREWARM_2) }, { events: textEvents(TURN_3, NEXT_ANSWER) }] }, async (host) => {
			await host.session.prompt(FIRST_PROMPT);
			assert.equal(host.peer.sends.length, 1, "the first actual prompt is one normal request (no idle warm before it)");
			assert.equal(host.peer.connects, 1);
			const first = host.peer.sends[0]!;
			assert.notEqual(first.generate, false, "the first actual request generates");
			const firstInput = first.input as Array<Record<string, any>>;
			// Observed from the actual SDK projection: the leading system message is the first input item (developer role).
			const leadingAt = firstInput.findIndex((item) => item.type === "message" && item.role === "developer" && JSON.stringify(item.content ?? "").includes(LEADING_BASE_TEXT));
			assert.ok(leadingAt >= 0, "the first actual request carries the leading system message (developer role, base section text)");
			const firstMessageAt = firstInput.findIndex((item) => item.type === "message");
			assert.equal(leadingAt, firstMessageAt, "the leading system message is the first message item (after the tools declaration)");
			assert.equal(firstInput.filter((item) => item.type === "message" && item.role === "developer" && JSON.stringify(item.content ?? "").includes(LEADING_BASE_TEXT)).length, 1, "exactly one leading system message");

			host.peer.dropSocket();
			const request: PrewarmHistoryRequest = {};
			host.emit(request);
			assert.equal(request.accepted, true, "the owned root accepts the idle request after the peer close");
			await waitFor(() => host.peer.sends.length === 2, "the idle warm after the reconnect");
			assert.equal(host.peer.connects, 2, "a new socket for the idle warm");
			const warm = host.peer.sends[1]!;
			assert.equal(warm.generate, false, "the idle warm is generate:false");
			assert.equal(warm.previous_response_id, undefined, "the new socket carries no previous response");
			const warmJson = JSON.stringify(warm.input);
			assert.equal(warmJson.split(LEADING_BASE_TEXT).length - 1, 1, "the warm carries the leading base text once");
			assert.equal(warmJson.split(FIRST_PROMPT).length - 1, 1, "the warm carries the first user prompt once");
			assert.equal(warmJson.split(FIRST_ANSWER).length - 1, 1, "the warm carries the first answer once");
			assert.equal(warmJson.includes(NEXT_PROMPT), false, "the next prompt is not in the warm");
			const baseAt = warmJson.indexOf(LEADING_BASE_TEXT);
			const userAt = warmJson.indexOf(FIRST_PROMPT);
			const answerAt = warmJson.indexOf(FIRST_ANSWER);
			assert.ok(baseAt < userAt && userAt < answerAt, "the warm order is leading base, first user, first answer");

			await host.session.prompt(NEXT_PROMPT);
			assert.equal(host.peer.sends.length, 3, "exactly one normal request after the warm");
			assert.equal(host.peer.connects, 2, "the warm socket is reused for the next actual prompt");
			const turn = host.peer.sends[2]!;
			assert.notEqual(turn.generate, false, "the next actual request generates");
			assert.equal(turn.previous_response_id, PREWARM_2, "previous_response_id is the warm response");
			const input = turn.input as Array<Record<string, any>>;
			assert.equal(input.length, 1, "only the new user delta is sent incrementally");
			const json = JSON.stringify(input);
			assert.ok(json.includes(NEXT_PROMPT), "the next prompt is the incremental input");
			for (const text of [LEADING_BASE_TEXT, FIRST_PROMPT, FIRST_ANSWER]) assert.equal(json.includes(text), false, `no resend of ${text}`);
		});
	});

	it("real SDK forced child (collab_spawn policy, forced startup prompt): after the child's socket closes, the idle warm carries the forced text once, the child's transcript once, and no section patch; the next child prompt reuses that warm response and sends only its new input", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({
			scripts: [
				{ events: warmEvents(CHILD_WARM_1) },
				{ events: textEvents(CHILD_TURN_1, CHILD_ANSWER_1) },
				{ events: warmEvents(CHILD_WARM_2) },
				{ events: textEvents(CHILD_TURN_2, CHILD_ANSWER_2) },
			],
		}, async (host) => {
			const child = await host.createForcedChild(FORCED_PROMPT);
			const request: SessionPolicyRequest = { session: child, parentThreadId: host.session.sessionId, kind: "collab_spawn", startupSystemPrompt: FORCED_PROMPT, startupSystemPromptForced: true, childName: "collab_spawn#1" };
			host.emitPolicy(request);
			assert.equal(request.error, undefined, "the child is bound to the owned root (its parent is the actual root session)");
			await child.prompt(CHILD_PROMPT_1);
			assert.equal(host.peer.sends[0]!.generate, false, "the child's startup warm is generate:false");
			assert.equal(host.peer.sends[1]!.previous_response_id, CHILD_WARM_1, "the child's first normal turn reuses its startup warm");
			assert.equal(host.peer.sends.length, 2, "one startup warm and one normal request so far");

			host.peer.dropSocket();
			const idle: PrewarmHistoryRequest = { threadId: child.sessionId };
			host.emit(idle);
			assert.equal(idle.accepted, true, "the host idle channel accepts the child by its own thread id");
			await waitFor(() => host.peer.sends.length === 3, "the child's idle history warm");
			const warm = host.peer.sends[2]!;
			assert.equal(warm.generate, false, "the child's idle warm is generate:false");
			assert.equal(warm.previous_response_id, undefined, "the new socket carries no previous response");
			const warmJson = JSON.stringify(warm.input);
			const count = (text: string) => warmJson.split(JSON.stringify(text).slice(1, -1)).length - 1;
			assert.equal(count(FORCED_PROMPT), 1, "the warm carries the forced startup prompt exactly once");
			assert.equal(count(CHILD_PROMPT_1), 1, "the warm carries the child's first user prompt once");
			assert.equal(count(CHILD_ANSWER_1), 1, "the warm carries the child's first answer once");
			assert.equal(warmJson.includes("Updated system prompt section"), false, "no bogus section patch on a forced child");
			assert.equal(warmJson.includes("<cwd>"), false, "no cwd section on a forced child");
			assert.equal(warmJson.includes(CHILD_PROMPT_2), false, "the next child prompt is not in the warm");
			assert.equal(child.sessionManager.buildSessionProjection().messages.some((message) => message.role === "system" && (message as { content?: unknown }).content === FORCED_PROMPT), false, "the forced text is never written to the child's transcript");

			await child.prompt(CHILD_PROMPT_2);
			assert.equal(host.peer.sends.length, 4, "exactly one normal request after the warm");
			assert.equal(host.peer.connects, 2, "the idle warm socket is reused for the next child prompt");
			const turn = host.peer.sends[3]!;
			assert.notEqual(turn.generate, false, "the next child request generates");
			assert.equal(turn.previous_response_id, CHILD_WARM_2, "previous_response_id is the child's idle warm response");
			const input = turn.input as Array<Record<string, any>>;
			assert.equal(input.length, 1, "only the new user input is sent incrementally");
			assert.ok(JSON.stringify(input).includes(CHILD_PROMPT_2), "the new child prompt is the incremental input");
			assert.equal(host.counts().http, 0, "no HTTP request");
		});
	});

	it("real SDK tool removal after a finished first turn: setActiveToolsByName drops write, the idle warm declares the current remaining catalog in order without the removed tool, the physical projection is unchanged by the warm, and the next actual prompt reuses the warm response with only its new delta", { timeout: CASE_TIMEOUT_MS }, async () => {
		const REMOVED = "write";
		// Responses Lite declares the catalog as one additional_tools item in input (namespace "functions"); stock declares top-level tools.
		await withHost({ scripts: [{ events: textEvents(TURN_1, FIRST_ANSWER) }, { events: warmEvents(PREWARM_2) }, { events: textEvents(TURN_3, NEXT_ANSWER) }] }, async (host) => {
			assert.equal(host.session.getActiveToolNames().includes(REMOVED), true, "the stock initial catalog actively declares write");
			await host.session.prompt(FIRST_PROMPT);
			assert.equal(host.peer.sends.length, 1, "the first actual prompt is one normal request");
			const firstNames = declaredNames(host.peer.sends[0]!);
			assert.equal(firstNames.includes(REMOVED), true, "the first actual request declares write");

			host.session.setActiveToolsByName(host.session.getActiveToolNames().filter((name) => name !== REMOVED));
			assert.equal(host.session.getActiveToolNames().includes(REMOVED), false, "the public selection no longer lists write");
			const remainingNames = firstNames.filter((name) => name !== REMOVED);

			host.peer.dropSocket();
			const projectionBefore = JSON.stringify(host.session.sessionManager.buildSessionProjection().messages);
			const request: PrewarmHistoryRequest = {};
			host.emit(request);
			assert.equal(request.accepted, true, "the owned root accepts the idle request after the peer close");
			await waitFor(() => host.peer.sends.length === 2, "the idle warm after the reconnect");
			assert.equal(host.peer.connects, 2, "a new socket for the idle warm");

			const warm = host.peer.sends[1]!;
			assert.equal(warm.generate, false, "the idle warm is generate:false");
			assert.equal(warm.previous_response_id, undefined, "the new socket carries no previous response");
			const warmNames = declaredNames(warm);
			assert.deepEqual(warmNames, remainingNames, "the warm declares the current remaining catalog in the first prefix order");
			assert.equal(warmNames.includes(REMOVED), false, "no old write declaration is resurrected");
			assert.equal(JSON.stringify(host.session.sessionManager.buildSessionProjection().messages), projectionBefore, "the idle warm does not change the physical projection messages");

			await host.session.prompt(NEXT_PROMPT);
			assert.equal(host.peer.sends.length, 3, "exactly one normal request after the warm");
			assert.equal(host.peer.connects, 2, "the warm socket is reused for the next actual prompt");
			const turn = host.peer.sends[2]!;
			assert.notEqual(turn.generate, false, "the next actual request generates");
			assert.equal(turn.previous_response_id, PREWARM_2, "previous_response_id is the warm response");
			const input = turn.input as Array<Record<string, any>>;
			assert.equal(input.length, 1, "only the new user delta is sent incrementally");
			assert.ok(JSON.stringify(input).includes(NEXT_PROMPT), "the next prompt is the incremental input");
			assert.equal(host.counts().http, 0, "no HTTP request");
		});
	});

	it("hidden declarations (codemode only), cold idle with no history: the idle warm declares the current catalog without the hidden base functions, and the next normal prompt reuses the warm response with only its new input", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [{ events: warmEvents(PREWARM_1) }, { events: textEvents(TURN_1, ANSWER) }], codemode: true }, async (host) => {
			assert.deepEqual(HIDDEN_BASE.filter((name) => host.session.getActiveToolNames().includes(name)), HIDDEN_BASE, "the base functions are executable (active)");
			assert.equal(host.session.getActiveToolNames().includes("codemode"), true, "codemode is active");
			host.emit({});
			await waitFor(() => host.peer.sends.length === 1, "the prepared warm request");
			const warmNames = declaredNames(host.peer.sends[0]!);
			assert.equal(warmNames.includes("codemode"), true, "the warm declares codemode");
			for (const name of HIDDEN_BASE) assert.equal(warmNames.includes(name), false, `the warm does not declare the hidden base function ${name}`);
			await host.session.prompt(NEW_PROMPT);
			assert.equal(host.peer.sends.length, 2, "exactly one normal request after the warm");
			assert.equal(host.peer.connects, 1, "the warm socket is reused");
			const turn = host.peer.sends[1]!;
			assert.equal(turn.previous_response_id, PREWARM_1, "previous_response_id is the warm response");
			const input = turn.input as Array<Record<string, any>>;
			assert.equal(input.length, 1, "only the new user input is sent incrementally");
			assert.ok(JSON.stringify(input).includes(NEW_PROMPT), "the new prompt is the incremental input");
		});
	});

	it("hidden declarations (codemode only), resumed history without a leading system message: the actual request and the closed-peer idle warm never declare the hidden base functions; the next normal prompt sends only its new user input", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [{ events: textEvents(TURN_1, ANSWER) }, { events: warmEvents(PREWARM_2) }, { events: textEvents(TURN_3, NEXT_ANSWER) }], history: true, codemode: true }, async (host) => {
			assert.equal(host.peer.sends.length, 0, "no socket before the first actual request");
			await host.session.prompt(NEW_PROMPT);
			const firstNames = declaredNames(host.peer.sends[0]!);
			assert.equal(firstNames.includes("codemode"), true, "the actual request declares codemode");
			for (const name of HIDDEN_BASE) assert.equal(firstNames.includes(name), false, `the actual request does not declare the hidden base function ${name}`);
			host.peer.dropSocket();
			host.emit({});
			await waitFor(() => host.peer.sends.length === 2, "the idle warm after the reconnect");
			const warmNames = declaredNames(host.peer.sends[1]!);
			for (const name of HIDDEN_BASE) assert.equal(warmNames.includes(name), false, `the idle warm does not declare the hidden base function ${name}`);
			assert.equal(host.peer.sends[1]!.generate, false, "the idle warm is generate:false");
			await host.session.prompt(NEXT_PROMPT);
			const turn = host.peer.sends[2]!;
			assert.equal(turn.previous_response_id, PREWARM_2, "previous_response_id is the idle warm response");
			const input = turn.input as Array<Record<string, any>>;
			assert.equal(input.length, 1, "only the new user input is sent incrementally");
			assert.ok(JSON.stringify(input).includes(NEXT_PROMPT), "the next prompt is the incremental input");
		});
	});

	it("hidden declarations (codemode only), fresh leading system context: the closed-peer idle warm never declares the hidden base functions and the next normal prompt sends only its new user input", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [{ events: textEvents(TURN_1, FIRST_ANSWER) }, { events: warmEvents(PREWARM_2) }, { events: textEvents(TURN_3, NEXT_ANSWER) }], codemode: true }, async (host) => {
			await host.session.prompt(FIRST_PROMPT);
			const firstNames = declaredNames(host.peer.sends[0]!);
			for (const name of HIDDEN_BASE) assert.equal(firstNames.includes(name), false, `the first actual request does not declare the hidden base function ${name}`);
			host.peer.dropSocket();
			host.emit({});
			await waitFor(() => host.peer.sends.length === 2, "the idle warm after the reconnect");
			const warmNames = declaredNames(host.peer.sends[1]!);
			assert.equal(warmNames.includes("codemode"), true, "the warm declares codemode");
			for (const name of HIDDEN_BASE) assert.equal(warmNames.includes(name), false, `the idle warm does not declare the hidden base function ${name}`);
			await host.session.prompt(NEXT_PROMPT);
			const turn = host.peer.sends[2]!;
			assert.equal(turn.previous_response_id, PREWARM_2, "previous_response_id is the idle warm response");
			assert.equal((turn.input as unknown[]).length, 1, "only the new user input is sent incrementally");
		});
	});

	it("soft child with its own startup prompt (no force, no parent projector in the child): the child's idle warm after its socket closes carries no parent-only section and no section patch, and the next child prompt reuses that warm response", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({
			parentOnly: true,
			scripts: [
				{ events: warmEvents(CHILD_WARM_1) },
				{ events: textEvents(CHILD_TURN_1, CHILD_ANSWER_1) },
				{ events: warmEvents(CHILD_WARM_2) },
				{ events: textEvents(CHILD_TURN_2, CHILD_ANSWER_2) },
			],
		}, async (host) => {
			const child = await host.createSoftChild();
			const request: SessionPolicyRequest = { session: child, parentThreadId: host.session.sessionId, kind: "collab_spawn", startupSystemPrompt: child.systemPrompt, childName: "collab_spawn#2" };
			host.emitPolicy(request);
			assert.equal(request.error, undefined, "the soft child is bound to the owned root");
			await child.prompt(CHILD_PROMPT_1);
			assert.equal(host.peer.sends[1]!.previous_response_id, CHILD_WARM_1, "the child's first normal turn reuses its startup warm");
			host.peer.dropSocket();
			const idle: PrewarmHistoryRequest = { threadId: child.sessionId };
			host.emit(idle);
			assert.equal(idle.accepted, true, "the host idle channel accepts the soft child by its own thread id");
			await waitFor(() => host.peer.sends.length === 3, "the child's idle history warm");
			const warm = host.peer.sends[2]!;
			assert.equal(warm.generate, false, "the child's idle warm is generate:false");
			const warmJson = JSON.stringify(warm.input);
			assert.equal(warmJson.includes(PARENT_ONLY), false, "the parent-only section is not projected into the child's idle warm");
			assert.equal(warmJson.includes("Updated system prompt section"), false, "no section patch on the soft child's warm");
			await child.prompt(CHILD_PROMPT_2);
			const turn = host.peer.sends[3]!;
			assert.equal(turn.previous_response_id, CHILD_WARM_2, "previous_response_id is the child's idle warm response");
			const input = turn.input as Array<Record<string, any>>;
			assert.equal(input.length, 1, "only the new child input is sent incrementally");
			assert.equal(JSON.stringify(turn).includes(PARENT_ONLY), false, "the parent-only section is never sent to the child");
		});
	});

	it("startup on the real session_start (codemode only, empty history): the cold startup warm is generate:false with the codemode catalog only and the base prompt, and the first actual prompt reuses it with only the new user input", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [{ events: warmEvents(PREWARM_1) }, { events: textEvents(TURN_1, ANSWER) }], codemode: true, startup: true, compactionOff: true }, async (host) => {
			await waitFor(() => host.peer.sends.length === 1, "the startup warm");
			const warm = host.peer.sends[0]!;
			assert.equal(warm.generate, false, "the startup warm is generate:false");
			assert.equal(warm.previous_response_id, undefined, "the startup socket carries no previous response");
			assert.deepEqual(declaredNames(warm), ["codemode"], "the startup catalog is codemode only");
			for (const name of HIDDEN_BASE) assert.equal(declaredNames(warm).includes(name), false, `the startup warm does not declare the hidden base function ${name}`);
			const warmInput = warm.input as Array<Record<string, any>>;
			assert.equal(warmInput.filter((item) => item.type === "message" && (item.role === "user" || item.role === "assistant")).length, 0, "the cold startup warm carries no transcript item (empty history)");
			assert.equal(warmInput.filter((item) => item.type === "message" && item.role === "developer" && JSON.stringify(item.content ?? "").includes(LEADING_BASE_TEXT)).length, 1, "the startup warm carries the base prompt once");
			await host.session.prompt(NEW_PROMPT);
			assert.equal(host.peer.sends.length, 2, "exactly one normal request after the startup warm");
			assert.equal(host.peer.connects, 1, "the startup socket is reused for the first actual prompt");
			const turn = host.peer.sends[1]!;
			assert.notEqual(turn.generate, false, "the first actual request generates");
			assert.equal(turn.previous_response_id, PREWARM_1, "previous_response_id is the startup warm response");
			const input = turn.input as Array<Record<string, any>>;
			assert.equal(input.length, 1, "only the new user input is sent incrementally");
			assert.ok(JSON.stringify(input).includes(NEW_PROMPT), "the new prompt is the incremental input");
			assert.equal(host.counts().http, 0, "no HTTP request");
		});
	});

	it("manual compaction on legacy history without a leading system message (codemode only): the one compaction request declares the visible catalog only, ends with one compaction_trigger, and the accepted opaque item is installed with no text summary", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [], history: true, codemode: true, compactionOff: true }, async (host) => {
			const result = await host.session.compact();
			assert.equal(host.peer.sends.length, 1, "exactly one compaction request, no inference");
			const body = host.peer.sends[0]!;
			const input = body.input as Array<Record<string, any>>;
			assert.deepEqual(input.at(-1), { type: "compaction_trigger" }, "the request ends with the compaction trigger");
			assert.equal(JSON.stringify(input).split("compaction_trigger").length - 1, 1, "one trigger");
			assert.equal(JSON.stringify(input).split(HISTORY_USER).length - 1, 1, "the legacy history is sent once");
			const names = declaredNames(body);
			assert.equal(names.includes("codemode"), true, "the visible catalog declares codemode");
			for (const name of HIDDEN_BASE) assert.equal(names.includes(name), false, `no declaration of the hidden base function ${name} in any tool declaration`);
			assert.equal(result.details.window.number, 1, "the accepted compaction advances the window 0 to 1");
			assert.equal(host.session.messages.some((message) => (message as { role?: string }).role === "compactionSummary"), false, "no Pi text summary entry");
			assert.equal(host.session.sessionManager.getBranch().some((entry) => entry.type === "compaction"), false, "no Pi compaction entry");
			assert.equal(host.counts().http, 0, "no HTTP request");
		});
	});

	it("fresh leading codemode only: after the first actual prompt, a manual compaction's wire catalog never declares a hidden base function, whatever the physical projection retains", { timeout: CASE_TIMEOUT_MS }, async (context) => {
		await withHost({ scripts: [{ events: textEvents(TURN_1, FIRST_ANSWER) }], codemode: true, compactionOff: true }, async (host) => {
			await host.session.prompt(FIRST_PROMPT);
			const firstNames = declaredNames(host.peer.sends[0]!);
			assert.equal(firstNames.includes("codemode"), true, "the first actual request declares codemode");
			for (const name of HIDDEN_BASE) assert.equal(firstNames.includes(name), false, `the first actual request does not declare the hidden base function ${name}`);
			const physical = JSON.stringify(host.session.sessionManager.buildSessionProjection().messages);
			context.diagnostic(`physical projection mentions hidden names: ${HIDDEN_BASE.filter((name) => physical.includes(name)).join(",") || "none"}`);
			await host.session.compact();
			assert.equal(host.peer.sends.length, 2, "the first request and one compaction request");
			const body = host.peer.sends[1]!;
			const input = body.input as Array<Record<string, any>>;
			assert.deepEqual(input.at(-1), { type: "compaction_trigger" }, "the compaction request ends with the trigger");
			const names = declaredNames(body);
			assert.equal(names.includes("codemode"), true, "the compaction catalog declares codemode");
			for (const name of HIDDEN_BASE) assert.equal(names.includes(name), false, `the compaction wire never declares the hidden base function ${name}`);
			assert.equal(host.counts().http, 0, "no HTTP request");
		});
	});
});
