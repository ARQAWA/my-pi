// Cleanup proof of the automatic idle scheduler on the real owned registration: registerCodex with the same createSessionController
// callback as index.ts, one real AgentSession created through a real AgentSessionRuntime, a real ModelRuntime with a fake OAuth grant
// in a temporary agent directory, and a fake WebSocket peer as the transport. Nothing emits a private SDK event: the settled event is
// Pi's own (after the scripted normal turn). The teardown is exercised both ways: the real AgentSessionRuntime.dispose(), whose
// session_shutdown reaches the owner's release through the public pi.on handler (as in index.ts), and the direct session.dispose(). Only the controller's own public subscribe is counted: the
// session.subscribe wrapper is installed inside the createController callback and removed right after construction.
// Zero-delay timers are observed through a spy on the global setTimeout / clearTimeout, restored in finally. No network, no real credentials.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createAgentSession, createAgentSessionRuntime, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSessionRuntime, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installRuntimeAuth } from "../../../extensions/RQW-codex/auth-runtime.ts";
import { CODEX_PROVIDER } from "../../../extensions/RQW-codex/profile.ts";
import { registerCodex } from "../../../extensions/RQW-codex/registration.ts";
import { createSessionController, type SessionDependencies } from "../../../extensions/RQW-codex/session.ts";

const ACCOUNT = "acct_idle_auto_cleanup_1";
const INSTALLATION = "44444444-7777-4666-8777-000000000002";
const CASE_TIMEOUT_MS = 20_000;
const FIRST_PROMPT = "AUTO-CLEANUP-PROMPT-1";
const FIRST_ANSWER = "AUTO-CLEANUP-ANSWER-1";
const TURN_1 = "resp_auto_cleanup_turn_1";

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeAccess(): string {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return `${b64url({ alg: "none" })}.${b64url({ exp, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;
}

const usageOf = (input: number) => ({ input_tokens: input, output_tokens: 1, total_tokens: input + 1, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } });
const created = (id: string) => ({ type: "response.created", response: { id } });
const completed = (id: string, input = 1) => ({ type: "response.completed", response: { id, status: "completed", usage: usageOf(input) } });

/** A complete assistant text generation: the normal, successful turn of the real run. */
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

/** Scripted in-process WebSocket peer. Every request body is recorded before the script is consumed; an unscripted request fails the send. */
function fakePeer(scripts: Array<{ events: Array<Record<string, unknown>> }>) {
	const peer = {
		connects: 0,
		sends: [] as Array<Record<string, unknown>>,
		connect: undefined as unknown as (options: unknown) => Promise<unknown>,
	};
	peer.connect = async () => {
		peer.connects++;
		let open = true;
		let batch: { events: Array<Record<string, unknown>> } | undefined;
		return {
			get isOpen() {
				return open;
			},
			socketIdentity: `socket-${peer.connects}`,
			events() {
				return (async function* () {
					for (const value of batch?.events ?? []) yield { text: JSON.stringify(value), value };
				})();
			},
			async send(object: Record<string, unknown>) {
				peer.sends.push(object);
				const next = scripts.shift();
				if (next === undefined) throw new Error(`unscripted socket request #${peer.sends.length}`);
				batch = next;
			},
			async interrupt() {
				throw new Error("unexpected interrupt");
			},
			async close() {
				open = false;
			},
		};
	};
	return peer;
}

async function waitFor(condition: () => boolean, label: string, ms = 10_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/** Zero-delay barrier: a 0 ms timer queued now runs after any pending automatic check (FIFO), then a few immediate turns settle awaits. */
async function quietWindow(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
	for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
}

/** The two direct teardown paths: AgentSessionRuntime.dispose (session_shutdown reaches the owner) and the session's own dispose (the lifecycle binding's instance wrapper). */
const TEARDOWNS = ["runtime", "session"] as const;
type Teardown = (typeof TEARDOWNS)[number];

async function teardown(runtime: AgentSessionRuntime, mode: Teardown): Promise<void> {
	if (mode === "session") await runtime.session.dispose();
	else await runtime.dispose();
}

type Track = {
	/** Calls of session.subscribe made by createSessionController (wrapper active only during its construction), in order:
	 * the portable-history listener, then the automatic listener (the last one, session.ts). */
	subscribes: number;
	/** Calls of each returned unsubscribe, by subscribe index. */
	unsubs: number[];
	/** Calls of the controller's release, observed by a wrapper installed at registration. */
	releases: number;
	/** Workspace collections (the real run's and any automatic capture). */
	collects: number;
	/** The next collection after a settled event is held until the test releases the gate. */
	holdNext: boolean;
	heldCapture: boolean;
	/** Every zero-delay timer created through the global setTimeout spy, in order, and every handle passed to clearTimeout. */
	zero: unknown[];
	cleared: unknown[];
	/** Index into `zero` taken by the first public settled listener: what the controller schedules after it is its own. */
	marks: number[];
	controller?: ReturnType<typeof createSessionController>;
	http: number;
};

/**
 * One real owned registration on one real AgentSession (created by a real AgentSessionRuntime), with the scripted normal turn.
 * `run` receives the session, the runtime (whose dispose is the public teardown), the peer and the track. Everything is restored in finally.
 */
async function withOwnedCleanup(options: { scripts: Array<{ events: Array<Record<string, unknown>> }>; hold: boolean }, run: (ctx: { runtime: AgentSessionRuntime; session: AgentSessionRuntime["session"]; peer: ReturnType<typeof fakePeer>; track: Track; gate: { release(): void } }) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "rqw-codex-auto-cleanup-"));
	const originalSet = globalThis.setTimeout;
	const originalClear = globalThis.clearTimeout;
	const track: Track = { subscribes: 0, unsubs: [], releases: 0, collects: 0, holdNext: false, heldCapture: false, zero: [], cleared: [], marks: [], http: 0 };
	const gates: Array<() => void> = [];
	let runtimeHandle: AgentSessionRuntime | undefined;
	let authRelease: (() => void) | undefined;
	try {
		const agentDir = join(root, "agent");
		await mkdir(agentDir, { recursive: true });
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const authPath = join(agentDir, "auth.json");
		await writeFile(authPath, JSON.stringify({ [CODEX_PROVIDER]: { type: "oauth", access: fakeAccess(), refresh: "refresh-auto-cleanup-2", expires: exp * 1000, accountId: ACCOUNT } }));
		const modelRuntime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
		const peer = fakePeer(options.scripts);
		const dependencies = {
			connect: peer.connect,
			// HTTP is refused and counted: any SSE request would be a network-path leak.
			postEvents: () => {
				track.http++;
				return (async function* () {
					throw new Error("HTTP refused by the automatic cleanup proof");
				})();
			},
			collectWorkspaceMetadata: (async () => {
				track.collects++;
				if (track.holdNext) {
					track.holdNext = false;
					track.heldCapture = true;
					await new Promise<void>((resolve) => gates.push(resolve));
				}
				return {};
			}) as never,
			sleep: async () => undefined,
			clock: { now: () => Date.now() },
		} as SessionDependencies;

		// The same owner wiring as createCodexExtension (index.ts): registerCodex with a createController that builds the
		// production session controller, and pi.on(session_shutdown) releasing the owner exactly as index.ts does.
		const extension = (pi: ExtensionAPI) => {
			const release = registerCodex(pi, {
				installationId: INSTALLATION,
				createController: (createdOptions) => {
					const session = createdOptions.session;
					// Test-only ordering marker, subscribed before the counted window: it runs before the controller's listener on each event.
					session.subscribe((event) => {
						const item = event as { type: string; aborted?: boolean };
						if (item.type === "agent_settled" && item.aborted !== true) track.marks.push(track.zero.length);
					});
					// Counted window: only the controller's own public subscribe happens inside createSessionController.
					const hadOwn = Object.prototype.hasOwnProperty.call(session, "subscribe");
					const originalSubscribe = session.subscribe;
					(session as { subscribe: unknown }).subscribe = (listener: Parameters<typeof originalSubscribe>[0]) => {
						const index = track.subscribes++;
						track.unsubs[index] = 0;
						const off = originalSubscribe.call(session, listener);
						return () => {
							track.unsubs[index]!++;
							off();
						};
					};
					let controller: ReturnType<typeof createSessionController>;
					try {
						controller = createSessionController({ ...createdOptions, dependencies });
					} finally {
						if (hadOwn) (session as { subscribe: unknown }).subscribe = originalSubscribe;
						else delete (session as { subscribe?: unknown }).subscribe;
					}
					// Observe the owner's release of this controller (registration only).
					const innerRelease = controller.release;
					controller.release = () => {
						track.releases++;
						innerRelease();
					};
					track.controller = controller;
					return controller;
				},
			});
			pi.on("session_shutdown", () => release());
		};

		const loaderFactory = async (factoryOptions: { cwd: string; agentDir: string; sessionManager: SessionManager }) => {
			const loader = new DefaultResourceLoader({
				cwd: factoryOptions.cwd, agentDir: factoryOptions.agentDir, additionalExtensionPaths: [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
				extensionFactories: [extension],
			});
			await loader.reload();
			assert.deepEqual(loader.getExtensions().errors, []);
			assert.equal(loader.getExtensions().extensions.length, 1, "the owned registration is loaded");
			authRelease = installRuntimeAuth(modelRuntime);
			const model = modelRuntime.getModels(CODEX_PROVIDER)[0]!;
			const { session } = await createAgentSession({
				cwd: factoryOptions.cwd, agentDir: factoryOptions.agentDir, modelRuntime, model, thinkingLevel: "off",
				resourceLoader: loader, sessionManager: factoryOptions.sessionManager,
				settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, transport: "websocket", compaction: { enabled: false } } as never),
			});
			// services is only read for cwd and agentDir by AgentSessionRuntime; dispose reads only the session.
			return { session, services: { cwd: factoryOptions.cwd, agentDir: factoryOptions.agentDir } as never, diagnostics: [] };
		};

		// Zero-delay timer spy over the whole run: records the handles the controller schedules, and the handles cleared.
		globalThis.setTimeout = ((handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
			const handle = originalSet(handler, delay, ...args);
			if (!delay) track.zero.push(handle);
			return handle;
		}) as unknown as typeof setTimeout;
		globalThis.clearTimeout = ((handle?: Parameters<typeof clearTimeout>[0]) => {
			track.cleared.push(handle);
			return originalClear(handle);
		}) as typeof clearTimeout;

		runtimeHandle = await createAgentSessionRuntime(loaderFactory, { cwd: agentDir, agentDir, sessionManager: SessionManager.inMemory(agentDir) });
		const session = runtimeHandle.session;
		assert.equal(track.subscribes, 2, "the controller made two public subscribes during construction: portable history, then the automatic listener");
		assert.deepEqual(track.unsubs, [0, 0], "no unsubscribe happened during construction");
		assert.equal(track.releases, 0, "the controller is live after construction");

		const gate = { release: () => gates.splice(0).forEach((resolve) => resolve()) };
		await run({ runtime: runtimeHandle, session, peer, track, gate });
	} finally {
		globalThis.setTimeout = originalSet;
		globalThis.clearTimeout = originalClear;
		for (const resolve of gates.splice(0)) resolve();
		if (runtimeHandle) await runtimeHandle.dispose().catch(() => undefined);
		authRelease?.();
		await rm(root, { recursive: true, force: true });
	}
}

for (const mode of TEARDOWNS) describe(`automatic idle cleanup on the owned registration, teardown=${mode} (real AgentSessionRuntime, fake WebSocket peer, public seams only)`, () => {
	it("a real settled event schedules one zero-delay automatic check; dispose before it fires clears that timer, unsubscribes the controller's listener once, and sends nothing", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withOwnedCleanup({ scripts: [{ events: textEvents(TURN_1, FIRST_ANSWER) }], hold: false }, async ({ runtime, session, peer, track }) => {
			let settledCount = 0;
			let collectsAtSettled = -1;
			let controllerTimers: unknown[] = [];
			let settledSeen!: () => void;
			const settled = new Promise<void>((resolve) => {
				settledSeen = resolve;
			});
			// Separate public settled listener, subscribed after the controller: it runs after the controller has scheduled.
			session.subscribe((event) => {
				const item = event as { type: string; aborted?: boolean };
				if (item.type !== "agent_settled" || item.aborted === true) return;
				settledCount++;
				collectsAtSettled = track.collects;
				controllerTimers = track.zero.slice(track.marks[0] ?? 0);
				settledSeen();
			});

			await session.prompt(FIRST_PROMPT);
			await settled;
			assert.equal(settledCount, 1, "the real settled event was seen once");
			assert.equal(peer.sends.length, 1, "before the teardown: only the actual request");
			assert.equal(controllerTimers.length, 1, "the controller scheduled exactly one zero-delay automatic check at the settled event");
			const pendingHandle = controllerTimers[0];

			// Public teardown: session_shutdown reaches the owner's release; the pending check must be cleared before it fires.
			await teardown(runtime, mode);
			assert.equal(track.releases, 1, "the controller was released once");
			assert.ok(track.cleared.includes(pendingHandle), "the one pending automatic timer was cleared");
			assert.equal(track.unsubs[1], 1, "the owned unsubscribe of the automatic listener ran exactly once");
			assert.equal(track.unsubs[0], 1, "the portable-history listener the controller added was unsubscribed once too");

			await quietWindow();
			assert.equal(peer.sends.length, 1, "no automatic warm after the teardown");
			assert.equal(peer.connects, 1, "no new socket after the teardown");
			assert.equal(track.collects, collectsAtSettled, "no workspace capture after the teardown");
			assert.equal(track.http, 0, "no HTTP request");

			// Repeated release and dispose are idempotent: no second unsubscribe, no sends.
			track.controller?.release();
			await teardown(runtime, mode).catch(() => undefined);
			await quietWindow();
			assert.deepEqual(track.unsubs, [1, 1], "a repeated release does not unsubscribe again");
			assert.equal(peer.sends.length, 1, "a repeated release or dispose sends nothing");
		});
	});

	it("an automatic workspace capture held after a real settled event: the held capture is cancelled by dispose, the released late capture never prewarms, and the automatic listener unsubscribes once", { timeout: CASE_TIMEOUT_MS }, async () => {
		await withOwnedCleanup({ scripts: [{ events: textEvents(TURN_1, FIRST_ANSWER) }], hold: true }, async ({ runtime, session, peer, track, gate }) => {
			let settledCount = 0;
			let collectsAtSettled = -1;
			let controllerTimers: unknown[] = [];
			let settledSeen!: () => void;
			const settled = new Promise<void>((resolve) => {
				settledSeen = resolve;
			});
			session.subscribe((event) => {
				const item = event as { type: string; aborted?: boolean };
				if (item.type !== "agent_settled" || item.aborted === true) return;
				settledCount++;
				collectsAtSettled = track.collects;
				controllerTimers = track.zero.slice(track.marks[0] ?? 0);
				// The next workspace collection is the automatic capture of this idle: hold it.
				track.holdNext = true;
				settledSeen();
			});

			await session.prompt(FIRST_PROMPT);
			await settled;
			assert.equal(settledCount, 1, "the real settled event was seen once");
			assert.equal(controllerTimers.length, 1, "the controller scheduled exactly one zero-delay automatic check");
			await waitFor(() => track.heldCapture, "the automatic workspace capture to start and hold");
			assert.equal(track.collects, collectsAtSettled + 1, "exactly one automatic capture started after the settled event");
			assert.equal(peer.sends.length, 1, "the held capture has not sent anything");

			// Dispose while the capture is held: the one automatic listener unsubscribes, the controller is released.
			await teardown(runtime, mode);
			assert.equal(track.releases, 1, "the controller was released once");
			assert.equal(track.unsubs[1], 1, "the one automatic listener unsubscribed exactly once");

			// Release the late gate: the stale capture completes after the owner is gone.
			gate.release();
			await quietWindow();
			assert.equal(peer.sends.length, 1, "the late capture never prewarms: no request after release");
			assert.equal(peer.connects, 1, "the late capture opens no socket");
			assert.equal(track.collects, collectsAtSettled + 1, "no further workspace capture after the release");
			assert.equal(track.http, 0, "no HTTP request");
			assert.equal(track.unsubs[1], 1, "the automatic unsubscribe still ran exactly once");
		});
	});
});
