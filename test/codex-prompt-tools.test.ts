// Root integration: RQW-prompt, RQW-tools and the RQW-codex facade on one real Pi 1.4.0 AgentSession. The WebSocket is a fake
// in-process peer; HTTP is refused and counted; the agent directory and HOME are temporary; the OAuth token is a fake JWT.
// Nothing reads the owner's home or the real agent directory, and no network is used.
// Proves the Codex prewarm input (the wire the peer receives) carries the RQW prompt preamble and the RQW-tools sections the
// way the real sessions send them, and that the idle history warm never invents section removals.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import promptExtension from "../extensions/RQW-prompt/index.ts";
import toolsExtension from "../extensions/RQW-tools/index.ts";
import { installRuntimeAuth } from "../extensions/RQW-codex/auth-runtime.ts";
import { createCodexExtension } from "../extensions/RQW-codex/index.ts";
import { CODEX_PROVIDER } from "../extensions/RQW-codex/profile.ts";
import { PREWARM_HISTORY_CHANNEL, type PrewarmHistoryRequest } from "../extensions/RQW-codex/registration.ts";
import { SocketError } from "../extensions/RQW-codex/websocket.ts";

const ACCOUNT = "acct_codex_prompt_tools_1";
const INSTALLATION = "55555555-6666-4777-8888-aaaaaaaaaaaa";
const CASE_TIMEOUT_MS = 15_000;
// Actual strings of the RQW sources (SYSTEM.md first line; RQW-tools before_agent_start sections).
const PREAMBLE = "You operate in pi.";
const SEARCH = "- Search with the grep and find tools and read files with read, following the method in the grep description.";
const BARRIER = "- Bash and codemode calls run independently of other tool calls; one still running after 12 seconds continues in the background as a job.";
const SEARCH_SECTION = "search_method";
const BARRIER_SECTION = "rqw_tools_execution";
const HISTORY_USER = "HISTORY-USER-1";
const HISTORY_ASSISTANT = "HISTORY-ASSISTANT-1";
const FIRST_PROMPT = "FIRST-PROMPT-1";
const FIRST_ANSWER = "FIRST-ANSWER-1";
const NEW_PROMPT = "NEW-PROMPT-1";
const ANSWER = "ANSWER-1";
const NEXT_PROMPT = "NEXT-PROMPT-1";
const NEXT_ANSWER = "NEXT-ANSWER-1";
const PREWARM_1 = "resp_warm_1";
const PREWARM_2 = "resp_warm_2";
const PREWARM_3 = "resp_warm_3";
const TURN_1 = "resp_turn_1";
const TURN_2 = "resp_turn_2";
const TURN_4 = "resp_turn_4";

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

/** The JSON-escaped form of a text, as it appears inside a JSON.stringify of the request input. */
const esc = (text: string) => JSON.stringify(text).slice(1, -1);
const count = (json: string, text: string) => json.split(esc(text)).length - 1;

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
type Host = {
	session: AgentSession;
	peer: Peer;
	/** Section names of `systemPromptOptions.sections` seen by each actual before_agent_start (observed, never changed). */
	hookSections: string[][];
	/** Gate of the RQW-tools factory: set false before a reload to unload RQW-tools. */
	gate: { tools: boolean };
	bind: () => Promise<void>;
	reload: () => Promise<void>;
	counts: () => { connects: number; sends: number; http: number; collects: number };
	emit: (request: PrewarmHistoryRequest) => void;
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
				const next = scripts.shift();
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

/** Bounded drain of already-queued callbacks: the host channel has no timer, so a fixed number of turns of the loop is enough. */
async function drain(): Promise<void> {
	for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * One real AgentSession with the three factories: RQW-prompt, RQW-tools (gated by `gate.tools`, so a reload can unload it) and
 * the RQW-codex facade. `scripts` are the socket responses in send order. `history` resumes the session with provided messages.
 * Everything the run created is aborted, disposed and removed in finally; HOME and the agent directory are restored.
 */
async function withHost(options: { scripts: Script[]; history?: boolean }, run: (host: Host) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "rqw-codex-prompt-tools-"));
	const savedHome = process.env.HOME;
	const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
	let session: AgentSession | undefined;
	let release: (() => void) | undefined;
	try {
		// Fake environment before anything else: a temporary HOME and agent directory.
		process.env.HOME = root;
		const agentDir = join(root, "agent");
		process.env.PI_CODING_AGENT_DIR = agentDir;
		await mkdir(agentDir, { recursive: true });
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const authPath = join(agentDir, "auth.json");
		await writeFile(authPath, JSON.stringify({ [CODEX_PROVIDER]: { type: "oauth", access: fakeAccess(), refresh: "refresh-codex-prompt-tools-1", expires: exp * 1000, accountId: ACCOUNT } }));
		const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });

		const counts = { http: 0, collects: 0 };
		const peer = fakePeer(options.scripts);
		// HTTP is refused: any SSE request is counted and fails the stream.
		const postEvents = () => {
			counts.http++;
			return (async function* () {
				throw new Error("HTTP refused by the root prompt-tools proof");
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

		const gate = { tools: true };
		const hookSections: string[][] = [];
		let bus: ExtensionAPI["events"] | undefined;
		// Passive observer: records the section names of each actual before_agent_start; it changes nothing.
		const observer = (pi: ExtensionAPI) => {
			bus = pi.events;
			pi.on("before_agent_start", (event) => {
				hookSections.push(Object.keys(event.systemPromptOptions.sections));
			});
		};
		const loader = new DefaultResourceLoader({
			cwd: root, agentDir, additionalExtensionPaths: [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: [
				promptExtension,
				(pi: ExtensionAPI) => { if (gate.tools) toolsExtension(pi); },
				observer,
				codex,
			],
		});
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert.equal(loader.getExtensions().extensions.length, 4, "the RQW-prompt, RQW-tools, observer and RQW-codex factories are loaded");

		release = installRuntimeAuth(runtime);
		const model = runtime.getModels(CODEX_PROVIDER)[0]!;
		({ session } = await createAgentSession({
			cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: "off",
			resourceLoader: loader,
			sessionManager: options.history ? seededHistory(agentDir) : SessionManager.inMemory(root),
			settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, transport: "websocket" }),
		}));
		if (!bus) throw new Error("the observer factory did not receive pi.events");

		const host: Host = {
			session,
			peer,
			hookSections,
			gate,
			// The real session_start path: Pi's bindExtensions emits session_start for the loaded factories.
			// Bound as the interactive host binds it: Pi emits session_start on reload only when a binding exists.
			bind: async () => { await session!.bindExtensions({ shutdownHandler: () => undefined }); },
			reload: async () => {
				await session!.reload();
				assert.deepEqual(loader.getExtensions().errors, []);
			},
			counts: () => ({ connects: peer.connects, sends: peer.sends.length, http: counts.http, collects: counts.collects }),
			// `bus` is re-read on each emit: a reload re-runs the factories and gives the new instances their own pi.events.
			emit: (request) => bus!.emit(PREWARM_HISTORY_CHANNEL, request),
		};
		await run(host);
	} finally {
		if (session) {
			if (session.isStreaming) await session.abort().catch(() => undefined);
			session.dispose();
		}
		release?.();
		if (savedHome === undefined) delete process.env.HOME;
		else process.env.HOME = savedHome;
		if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
		await rm(root, { recursive: true, force: true });
	}
}

describe("root prompt and tools on the real RQW-codex facade (Pi 1.4.0 AgentSession, fake WebSocket peer)", () => {
	it("real bindExtensions startup: the cold warm (generate:false, no previous response) carries the RQW prompt preamble and the RQW-tools sections; the first actual prompt reuses that response and sends only the new input", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [{ events: warmEvents(PREWARM_1) }, { events: textEvents(TURN_1, ANSWER) }] }, async (host) => {
			assert.equal(host.peer.sends.length, 0, "no socket request before bindExtensions");
			await host.bind();
			await waitFor(() => host.peer.sends.length === 1, "the startup warm");
			const warm = host.peer.sends[0]!;
			assert.equal(warm.generate, false, "the startup warm is generate:false");
			assert.equal(warm.previous_response_id, undefined, "the cold warm carries no previous response");
			const warmJson = JSON.stringify(warm.input);
			assert.equal(count(warmJson, PREAMBLE), 1, "the cold warm carries the RQW prompt preamble once");
			assert.equal(count(warmJson, SEARCH), 1, "the cold warm carries the RQW-tools search_method section once");
			assert.equal(count(warmJson, BARRIER), 1, "the cold warm carries the RQW-tools rqw_tools_execution section once");

			await host.session.prompt(NEW_PROMPT);
			assert.equal(host.peer.sends.length, 2, "exactly one normal request after the warm");
			assert.equal(host.peer.connects, 1, "the warm socket is reused for the normal turn");
			// Captured actual hook options of the normal turn: Tools' sections are present before the request is built.
			assert.ok(host.hookSections.length >= 1, "the actual before_agent_start ran");
			assert.ok(host.hookSections[0]!.includes(SEARCH_SECTION), "the hook options carry search_method");
			assert.ok(host.hookSections[0]!.includes(BARRIER_SECTION), "the hook options carry rqw_tools_execution");
			const turn = host.peer.sends[1]!;
			assert.notEqual(turn.generate, false, "the normal request generates");
			assert.equal(turn.previous_response_id, PREWARM_1, "previous_response_id is the warm response");
			const input = turn.input as Array<Record<string, any>>;
			assert.equal(input.length, 1, "only the new input is sent incrementally");
			assert.ok(JSON.stringify(input).includes(NEW_PROMPT), "the new prompt is the incremental input");
			assert.equal(JSON.stringify(input).includes("Updated system prompt section"), false, "the section patch is not sent again on the normal turn");
			assert.equal(host.counts().http, 0, "no HTTP request");
		});
	});

	it("after a finished normal turn and a peer close, the explicit history warm carries the base once, the user and the answer once, and no invented section removal; the next actual prompt reuses its response", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({ scripts: [{ events: textEvents(TURN_1, FIRST_ANSWER) }, { events: warmEvents(PREWARM_2) }, { events: textEvents(TURN_2, NEXT_ANSWER) }] }, async (host) => {
			// This case never binds (no startup warm), so grep and find, which the bound default selection gets at session_start, are set here.
			host.session.setActiveToolsByName(["read", "bash", "edit", "write", "grep", "find"]);
			await host.session.prompt(FIRST_PROMPT);
			assert.equal(host.peer.sends.length, 1, "the first actual prompt is one normal request (no warm before it)");
			const first = host.peer.sends[0]!;
			assert.notEqual(first.generate, false, "the first actual request generates");
			assert.equal(count(JSON.stringify(first.input), PREAMBLE), 1, "the first actual request carries the preamble once");
			assert.ok(host.hookSections[0]!.includes(SEARCH_SECTION), "the hook options carry search_method on the first turn");

			host.peer.dropSocket();
			const request: PrewarmHistoryRequest = {};
			host.emit(request);
			assert.equal(request.accepted, true, "the owned root accepts the idle request after the peer close");
			await waitFor(() => host.peer.sends.length === 2, "the explicit history warm");
			assert.equal(host.peer.connects, 2, "a new socket for the history warm");
			const warm = host.peer.sends[1]!;
			assert.equal(warm.generate, false, "the history warm is generate:false");
			assert.equal(warm.previous_response_id, undefined, "the new socket carries no previous response");
			const warmJson = JSON.stringify(warm.input);
			assert.equal(count(warmJson, PREAMBLE), 1, "the warm carries the base once");
			assert.equal(count(warmJson, FIRST_PROMPT), 1, "the warm carries the first user prompt once");
			assert.equal(count(warmJson, FIRST_ANSWER), 1, "the warm carries the first answer once");
			assert.equal(warmJson.includes(esc('Removed system prompt section "' + SEARCH_SECTION + '".')), false, "no removal of search_method");
			assert.equal(warmJson.includes(esc('Removed system prompt section "' + BARRIER_SECTION + '".')), false, "no removal of rqw_tools_execution");
			assert.equal(warmJson.includes(NEXT_PROMPT), false, "the next prompt is not in the warm");

			await host.session.prompt(NEXT_PROMPT);
			assert.equal(host.peer.sends.length, 3, "exactly one normal request after the warm");
			assert.equal(host.peer.connects, 2, "the warm socket is reused for the next actual prompt");
			const turn = host.peer.sends[2]!;
			assert.notEqual(turn.generate, false, "the next actual request generates");
			assert.equal(turn.previous_response_id, PREWARM_2, "previous_response_id is the warm response");
			const input = turn.input as Array<Record<string, any>>;
			assert.equal(input.length, 1, "only the new user input is sent incrementally");
			assert.ok(JSON.stringify(input).includes(NEXT_PROMPT), "the next prompt is the incremental input");
			for (const text of [PREAMBLE, FIRST_PROMPT, FIRST_ANSWER]) assert.equal(JSON.stringify(input).includes(text), false, `no resend of ${text}`);
		});
	});

	it("RQW-tools unloaded by a gated reload: the startup warm after the reload keeps the RQW prompt, the explicit history warm carries the legitimate section removals after the persisted history, the next actual prompt reuses its response", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withHost({
			scripts: [
				{ events: warmEvents(PREWARM_1) },
				{ events: textEvents(TURN_1, ANSWER) },
				{ events: warmEvents(PREWARM_2) },
				{ events: warmEvents(PREWARM_3) },
				{ events: textEvents(TURN_4, NEXT_ANSWER) },
			],
		}, async (host) => {
			await host.bind();
			await waitFor(() => host.peer.sends.length === 1, "the startup warm");
			assert.ok(JSON.stringify(host.peer.sends[0]!.input).includes(esc(SEARCH)), "the startup warm carries search_method while RQW-tools is loaded");
			await host.session.prompt(NEW_PROMPT);
			assert.equal(host.peer.sends.length, 2, "exactly one normal request after the warm");
			assert.equal(host.peer.sends[1]!.previous_response_id, PREWARM_1, "the first normal turn reuses the startup warm");
			assert.ok(host.hookSections[0]!.includes(SEARCH_SECTION), "the hook options carry search_method before the unload");

			// Finish and close: the socket closes, RQW-tools is unloaded by the gate, and the session reloads.
			host.peer.dropSocket();
			host.gate.tools = false;
			await host.reload();
			await waitFor(() => host.peer.sends.length === 3, "the fresh startup warm after the reload");
			const fresh = host.peer.sends[2]!;
			assert.equal(fresh.generate, false, "the fresh startup warm is generate:false");
			assert.equal(count(JSON.stringify(fresh.input), PREAMBLE), 1, "the fresh startup warm keeps the RQW prompt preamble once");

			// The next actual prompt after the reload shows RQW-tools' sections gone in the hook options.
			host.peer.dropSocket();
			const request: PrewarmHistoryRequest = {};
			host.emit(request);
			assert.equal(request.accepted, true, "the owned root accepts the idle request after the reload");
			await waitFor(() => host.peer.sends.length === 4, "the explicit history warm");
			const warm = host.peer.sends[3]!;
			assert.equal(warm.generate, false, "the history warm is generate:false");
			assert.equal(warm.previous_response_id, undefined, "the new socket carries no previous response");
			const warmJson = JSON.stringify(warm.input);
			assert.equal(count(warmJson, PREAMBLE), 1, "the history warm carries the base once");
			assert.equal(count(warmJson, NEW_PROMPT), 1, "the history warm carries the persisted user prompt once");
			assert.equal(count(warmJson, ANSWER), 1, "the history warm carries the persisted answer once");
			// Legitimate: the transcript replays both sections, and the current options no longer have them.
			assert.equal(count(warmJson, 'Removed system prompt section "' + SEARCH_SECTION + '".'), 1, "one legitimate removal of search_method");
			assert.equal(count(warmJson, 'Removed system prompt section "' + BARRIER_SECTION + '".'), 1, "one legitimate removal of rqw_tools_execution");

			await host.session.prompt(NEXT_PROMPT);
			assert.equal(host.peer.sends.length, 5, "exactly one normal request after the history warm");
			assert.equal(host.peer.connects, 3, "the history warm socket (the third) is reused for the next actual prompt");
			const turn = host.peer.sends[4]!;
			assert.notEqual(turn.generate, false, "the next actual request generates");
			assert.equal(turn.previous_response_id, PREWARM_3, "previous_response_id is the history warm response");
			const input = turn.input as Array<Record<string, any>>;
			assert.equal(input.length, 1, "only the new user input is sent incrementally");
			assert.ok(JSON.stringify(input).includes(NEXT_PROMPT), "the next prompt is the incremental input");
			assert.equal(host.hookSections.at(-1)!.includes(SEARCH_SECTION), false, "RQW-tools' search_method is absent from the hook options while unloaded");
			assert.equal(host.counts().http, 0, "no HTTP request");
		});
	});
});
