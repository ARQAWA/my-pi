// Stage 1 compatibility spikes for RQW-codex against stock Pi 1.4.0 (library and bundled CLI).
// Internal draft evidence only: no product code is loaded and nothing here reaches the network.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";

// ---- Temporary home, fake credentials, network guards (all restored in after()) ----------------
const envKeys = ["HOME", "USERPROFILE", "PI_CODING_AGENT_DIR", "PI_OFFLINE", "PI_SKIP_VERSION_CHECK", "NO_COLOR"] as const;
const savedEnv: Record<string, string | undefined> = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const savedSecretEnv = Object.entries(process.env).filter(([key]) => /(API_KEY|AUTH_TOKEN|OAUTH_TOKEN)$/.test(key) ||
	/^(OPENAI_|ANTHROPIC_|CHATGPT_|CODEX_)/.test(key));
const root = mkdtempSync(join(tmpdir(), "rqw-codex-stage1-"));
const agentDir = join(root, "agent");
mkdirSync(agentDir, { recursive: true });
for (const [key] of savedSecretEnv) delete process.env[key];
Object.assign(process.env, { HOME: root, USERPROFILE: root, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", NO_COLOR: "1" });

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
const originalNet = { request: http.request, get: http.get, httpsRequest: https.request, httpsGet: https.get, connect: net.connect, createConnection: net.createConnection };
let fakeFetch: ((input: unknown, init?: { body?: unknown }) => Promise<Response>) | undefined;
globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
	if (!fakeFetch) throw new Error(`AUDIT: external fetch forbidden: ${String(input)}`);
	return fakeFetch(input, init);
}) as typeof fetch;
(globalThis as { WebSocket?: unknown }).WebSocket = class {
	constructor() { throw new Error("AUDIT: WebSocket forbidden in stage-1 spikes"); }
};
const blocked = () => { throw new Error("AUDIT: external network forbidden"); };
http.request = http.get = https.request = https.get = blocked as typeof http.request;
net.connect = net.createConnection = blocked as typeof net.connect;
syncBuiltinESMExports();

after(() => {
	globalThis.fetch = originalFetch;
	(globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
	http.request = originalNet.request; http.get = originalNet.get;
	https.request = originalNet.httpsRequest; https.get = originalNet.httpsGet;
	net.connect = originalNet.connect; net.createConnection = originalNet.createConnection;
	syncBuiltinESMExports();
	for (const key of envKeys) {
		if (savedEnv[key] === undefined) delete process.env[key];
		else process.env[key] = savedEnv[key];
	}
	for (const [key, value] of savedSecretEnv) process.env[key] = value;
	rmSync(root, { recursive: true, force: true });
});

// ---- Pi entrypoints: the npm library export and the CLI bundle's own export ---------------------
const library = await import("@earendil-works/pi-coding-agent");
type Pi = typeof library;
const bundle = await import(new URL("./bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href) as unknown as Pi;
const entries: [string, Pi][] = [["library", library], ["CLI bundle", bundle]];

// ---- Fake fixtures only ----------------------------------------------------------------------------
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const ACCESS = `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600, "https://api.openai.com/auth": { chatgpt_account_id: "acct_fake_stage1" } })}.fake`;
const CODEX_CRED: Credential = { type: "oauth", access: ACCESS, refresh: "fake-refresh-codex", expires: Date.now() + 3_600_000 };
const ANTHROPIC_CRED: Credential = { type: "oauth", access: "sk-ant-oat01-fake-stage1", refresh: "fake-refresh-anthropic", expires: Date.now() + 3_600_000 };
const MARK = "rqw_codex_terminal_failure";
const context = { systemPrompt: "BASE-SYSTEM", messages: [{ role: "user" as const, content: "hi", timestamp: 1 }], tools: [] };

function memoryStore(initial: Record<string, Credential>): CredentialStore {
	const map = new Map(Object.entries(initial));
	return {
		async read(id) { return map.get(id); },
		async list() { return [...map.keys()].map(providerId => ({ providerId, type: map.get(providerId)!.type })); },
		async modify(id, fn) { const next = await fn(map.get(id)); if (next !== undefined) map.set(id, next); return map.get(id); },
		async delete(id) { map.delete(id); },
	};
}
async function runtimeFor(entry: Pi, credentials: Record<string, Credential> = { "openai-codex": CODEX_CRED, anthropic: ANTHROPIC_CRED }) {
	const runtime = await entry.ModelRuntime.create({ credentials: memoryStore(credentials), modelsPath: null, refreshOnCreate: false });
	await runtime.refresh({ allowNetwork: false });
	return runtime;
}
async function sessionFor(entry: Pi, runtime: InstanceType<Pi["ModelRuntime"]>, options: {
	settings?: Record<string, unknown>; extensionFactories?: unknown[]; sessionManager?: unknown; model?: unknown;
} = {}) {
	const loader = new entry.DefaultResourceLoader({ cwd: agentDir, agentDir, noExtensions: true, noSkills: true, noPromptTemplates: true,
		noThemes: true, noContextFiles: true, extensionFactories: options.extensionFactories as never });
	await loader.reload();
	const model = options.model ?? runtime.getModels("openai-codex")[0];
	const { session } = await entry.createAgentSession({ cwd: agentDir, agentDir, modelRuntime: runtime, model: model as never,
		resourceLoader: loader, sessionManager: (options.sessionManager ?? entry.SessionManager.inMemory(agentDir)) as never,
		settingsManager: entry.SettingsManager.inMemory({ transport: "sse", cacheWarming: "off", compaction: { enabled: false }, ...options.settings } as never) });
	await session.bindExtensions({});
	return session;
}
const codexSse = (events: object[]) => events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
const completedSse = () => codexSse([
	{ type: "response.output_item.done", item: { type: "message", role: "assistant", id: "msg_fake_1", status: "completed", content: [{ type: "output_text", text: "OK", annotations: [] }] } },
	{ type: "response.completed", response: { id: "resp_fake_1", status: "completed", output: [], usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 } } },
]);
/** Stock Pi zstd-compresses the SSE JSON body; decode it so assertions see the exact JSON text. */
function decodeBody(body: unknown): string {
	if (body instanceof Uint8Array) return Buffer.from(zstdDecompressSync(body)).toString("utf8");
	return String(body);
}
function okFetch(bodies: string[]) {
	return async (input: unknown, init?: { body?: unknown }) => {
		assert.equal(String(input), "https://chatgpt.com/backend-api/codex/responses");
		bodies.push(decodeBody(init?.body));
		return new Response(completedSse(), { headers: { "content-type": "text/event-stream" } });
	};
}
async function withFetch<T>(handler: NonNullable<typeof fakeFetch>, body: () => Promise<T>): Promise<T> {
	const previous = fakeFetch;
	fakeFetch = handler;
	try { return await body(); } finally { fakeFetch = previous; }
}
/** Replace one method descriptor; `restore` puts back the exact original descriptor. */
function patch(proto: object, name: string, make: (original: (...args: unknown[]) => unknown) => unknown) {
	const descriptor = Object.getOwnPropertyDescriptor(proto, name);
	assert.ok(descriptor && typeof descriptor.value === "function" && descriptor.configurable, `${name} is not a configurable method`);
	const original = descriptor.value as (...args: unknown[]) => unknown;
	const wrapped = make(original);
	Object.defineProperty(proto, name, { ...descriptor, value: wrapped });
	return { wrapped, restore: () => Object.defineProperty(proto, name, descriptor) };
}
/** The adapter's stream observer attaches the marker to Codex terminal failures only. */
function markCodexFailures(stream: { push: (event: { type: string; error?: { provider?: string; stopReason?: string; diagnostics?: unknown[] } }) => void }) {
	const push = stream.push.bind(stream);
	stream.push = event => {
		const message = event.type === "error" ? event.error : undefined;
		if (message?.provider === "openai-codex" && message.stopReason === "error") {
			message.diagnostics = [...(message.diagnostics ?? []), { type: MARK, timestamp: Date.now() }];
		}
		push(event);
	};
	return stream;
}
const hasMark = (message: { diagnostics?: { type: string }[] } | undefined) => message?.diagnostics?.some(item => item.type === MARK) === true;

for (const [label, entry] of entries) {
	describe(label, () => {
		it("Pi VERSION is the exact pinned guard value", () => {
			const guard = (version: string) => version === "1.4.0";
			assert.equal(entry.VERSION, "1.4.0");
			assert.equal(guard(entry.VERSION), true);
			for (const wrong of ["1.4", "1.4.0 ", "1.4.0-rc.1", "1.4.1", "v1.4.0"]) assert.equal(guard(wrong), false, wrong);
		});

		it("method seams are configurable, interceptable and restore the exact original descriptor", async () => {
			const runtime = await runtimeFor(entry);
			const runtimeProto = entry.ModelRuntime.prototype as unknown as object;
			const sessionProto = entry.AgentSession.prototype as unknown as object;
			const seams: [object, string[]][] = [
				[runtimeProto, ["prepareRequest", "getAuth", "stream", "streamSimple"]],
				[sessionProto, ["_bindExtensionCore", "dispose", "_isRetryableError", "_checkCompaction", "_runDefaultCompaction"]],
			];
			for (const [proto, names] of seams) {
				for (const name of names) {
					const before = Object.getOwnPropertyDescriptor(proto, name)!;
					const { wrapped, restore } = patch(proto, name, () => function() { throw new Error("never invoked"); });
					try {
						assert.equal(Object.getOwnPropertyDescriptor(proto, name)!.value, wrapped);
					} finally { restore(); }
					assert.deepEqual(Object.getOwnPropertyDescriptor(proto, name), before, `${name} descriptor restored`);
				}
			}
			let getAuthCalls = 0;
			const restoreAuth = patch(runtimeProto, "getAuth", original => function(this: unknown, ...args: unknown[]) { getAuthCalls++; return original.apply(this, args); }).restore;
			try { await runtime.getAuth("openai-codex"); } finally { restoreAuth(); }
			assert.equal(getAuthCalls, 1);
			let disposeCalls = 0;
			const session = await sessionFor(entry, runtime);
			const restoreDispose = patch(sessionProto, "dispose", original => function(this: unknown, ...args: unknown[]) { disposeCalls++; return original.apply(this, args); }).restore;
			try { session.dispose(); } finally { restoreDispose(); }
			assert.equal(disposeCalls, 1);
		});

		it("_bindExtensionCore runs during construction and is restorable after a thrown wrapper", async () => {
			const runtime = await runtimeFor(entry);
			const proto = entry.AgentSession.prototype as unknown as object;
			const before = Object.getOwnPropertyDescriptor(proto, "_bindExtensionCore")!;
			let bindCalls = 0;
			const { restore } = patch(proto, "_bindExtensionCore", original => function(this: unknown, ...args: unknown[]) {
				bindCalls++;
				return original.apply(this, args);
			});
			try {
				const session = await sessionFor(entry, runtime);
				session.dispose();
			} finally { restore(); }
			assert.equal(bindCalls, 1);
			assert.deepEqual(Object.getOwnPropertyDescriptor(proto, "_bindExtensionCore"), before);
			const { restore: restoreThrowing } = patch(proto, "_bindExtensionCore", () => () => { throw new Error("spike"); });
			try {
				assert.throws(() => (proto as { _bindExtensionCore: () => void })._bindExtensionCore.call({}), /spike/);
			} finally { restoreThrowing(); }
			assert.deepEqual(Object.getOwnPropertyDescriptor(proto, "_bindExtensionCore"), before);
		});

		it("stock registerProvider without models keeps the built-in openai-codex catalog", async () => {
			const runtime = await runtimeFor(entry);
			const before = runtime.getModels("openai-codex").map(model => model.id).sort();
			assert.ok(before.length > 0, "openai-codex catalog is non-empty");
			const streamSimple = () => { throw new Error("not called in this spike"); };
			runtime.registerProvider("openai-codex", { api: "openai-codex-responses", streamSimple } as never);
			try {
				assert.equal(runtime.getRegisteredProviderConfig("openai-codex")?.streamSimple, streamSimple);
				assert.deepEqual(runtime.getModels("openai-codex").map(model => model.id).sort(), before);
			} finally {
				runtime.unregisterProvider("openai-codex");
			}
			assert.equal(runtime.getRegisteredProviderConfig("openai-codex"), undefined);
			assert.deepEqual(runtime.getModels("openai-codex").map(model => model.id).sort(), before);
		});

		it("onPayload replacement is awaited exactly once and reaches the wire for stream and streamSimple", async () => {
			const runtime = await runtimeFor(entry);
			const model = runtime.getModels("openai-codex")[0];
			const bodies: string[] = [];
			let nativeCalls = 0;
			let simpleCalls = 0;
			await withFetch(okFetch(bodies), async () => {
				await runtime.stream(model, context, { transport: "sse", reasoningEffort: "low", onPayload: async (body: unknown) => {
					nativeCalls++;
					await new Promise(resolve => setTimeout(resolve, 5));
					return { ...(body as object), rqw_marker: "replaced-native" };
				} } as never).result();
				await runtime.streamSimple(model, context, { transport: "sse", reasoning: "low", onPayload: async (body: unknown) => {
					simpleCalls++;
					await new Promise(resolve => setTimeout(resolve, 5));
					return { ...(body as object), rqw_marker: "replaced-simple" };
				} } as never).result();
			});
			assert.equal(nativeCalls, 1);
			assert.equal(simpleCalls, 1);
			assert.equal(bodies.length, 2);
			assert.equal(JSON.parse(bodies[0]).rqw_marker, "replaced-native");
			assert.equal(JSON.parse(bodies[1]).rqw_marker, "replaced-simple");
		});

		it("shared option contract: streamSimple maps reasoning and drops service tier, stream keeps both", async () => {
			const runtime = await runtimeFor(entry);
			const model = runtime.getModels("openai-codex")[0];
			const bodies: Record<string, Record<string, unknown>> = {};
			await withFetch(okFetch([]), async () => {
				await runtime.stream(model, context, { transport: "sse", reasoningEffort: "low", serviceTier: "priority", onPayload: (body: unknown) => { bodies.native = body as never; } } as never).result();
				await runtime.streamSimple(model, context, { transport: "sse", reasoning: "low", serviceTier: "priority", onPayload: (body: unknown) => { bodies.simple = body as never; } } as never).result();
			});
			assert.equal(bodies.native.service_tier, "priority", "stream carries serviceTier");
			assert.equal(bodies.simple.service_tier, undefined, "streamSimple drops serviceTier (stock buildBaseOptions)");
			assert.deepEqual(bodies.simple.reasoning, bodies.native.reasoning, "reasoning maps identically");
		});

		it("diagnostics marker + scoped classifier suppresses Pi retry for Codex and leaves Anthropic untouched", async () => {
			const runtime = await runtimeFor(entry);
			const sessionProto = entry.AgentSession.prototype as unknown as object;
			const streamProto = entry.ModelRuntime.prototype as unknown as object;
			const retry = { enabled: true, maxRetries: 2, baseDelayMs: 1 };
			const serverError = async () => new Response("internal error", { status: 500 });
			const classifier = (original: (...args: unknown[]) => unknown) => function(this: unknown, message: { provider?: string; diagnostics?: { type: string }[] }) {
				if (message?.provider === "openai-codex" && hasMark(message)) return false;
				return original.call(this, message);
			};
			// Codex with classifier + marker: one request, no Pi retry, settings untouched.
			const restoreMark = patch(streamProto, "streamSimple", original => function(this: unknown, ...args: unknown[]) {
				return markCodexFailures(original.apply(this, args) as never);
			}).restore;
			const session = await sessionFor(entry, runtime, { settings: { retry } });
			const settingsBefore = JSON.stringify(session.settingsManager.getRetrySettings());
			let fetchCalls = 0;
			const { restore: restoreClassifier } = patch(sessionProto, "_isRetryableError", original => classifier(original));
			try {
				await withFetch(async (input, init) => { fetchCalls++; return serverError(); }, async () => { await session.prompt("hello"); });
				const last = session.messages.at(-1) as { stopReason?: string; errorMessage?: string; diagnostics?: { type: string }[] };
				assert.equal(last.stopReason, "error", last.errorMessage);
				assert.equal(hasMark(last), true, "Codex terminal failure carries the marker");
				assert.equal(fetchCalls, 1, "classifier suppressed Pi retry: exactly one request");
				assert.equal(JSON.stringify(session.settingsManager.getRetrySettings()), settingsBefore, "no settings mutation");
				assert.equal(session.autoRetryEnabled, true);
			} finally {
				restoreClassifier();
				restoreMark();
				session.dispose();
			}
			// Baseline with the same marker but no classifier: stock Pi retries (1 + maxRetries 2 = 3 requests).
			const restoreMarkBaseline = patch(streamProto, "streamSimple", original => function(this: unknown, ...args: unknown[]) {
				return markCodexFailures(original.apply(this, args) as never);
			}).restore;
			const baseline = await sessionFor(entry, runtime, { settings: { retry } });
			let baselineFetches = 0;
			try {
				await withFetch(async () => { baselineFetches++; return serverError(); }, async () => { await baseline.prompt("hello"); });
				assert.equal(baselineFetches, 3, "stock Pi retries a 500 twice without the classifier");
			} finally {
				restoreMarkBaseline();
				baseline.dispose();
			}
			// Anthropic-shaped retryable message carrying the same marker stays retryable through the same classifier.
			const anthropicSession = await sessionFor(entry, runtime);
			const { restore: restoreAnthropic } = patch(sessionProto, "_isRetryableError", original => classifier(original));
			try {
				const anthropic = { role: "assistant", api: "anthropic-messages", provider: "anthropic", model: "claude-opus-5-5", usage: {}, content: [],
					stopReason: "error", errorMessage: "500 internal error", timestamp: Date.now(), diagnostics: [{ type: MARK }] };
				assert.equal((anthropicSession as unknown as { _isRetryableError(m: unknown): boolean })._isRetryableError(anthropic), true);
			} finally {
				restoreAnthropic();
				anthropicSession.dispose();
			}
		});

		it("threshold path: stale pre-compaction usage cannot re-trigger; post-V2 usage above threshold must be projected below it", async () => {
			const runtime = await runtimeFor(entry);
			const model = runtime.getModels("openai-codex")[0] as unknown as { id: string; contextWindow: number };
			const settings = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 };
			const sessionProto = entry.AgentSession.prototype as unknown as object;
			const session = await sessionFor(entry, runtime, { settings: { compaction: settings } });
			const manager = session.sessionManager as unknown as { appendMessage(m: object): string; appendCompaction(...args: unknown[]): string; getBranch(): { type: string; timestamp?: string }[] };
			const threshold = model.contextWindow - settings.reserveTokens;
			const usage = (total: number) => ({ input: total, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: total, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
			const assistant = (total: number, timestamp: number) => ({ role: "assistant", api: "openai-codex-responses", provider: "openai-codex", model: model.id,
				content: [{ type: "text", text: "A" }], usage: usage(total), stopReason: "stop", timestamp });
			const check = (message: unknown) => (session as unknown as { _checkCompaction(m: unknown): Promise<boolean> })._checkCompaction(message);
			const reasons: string[] = [];
			const { restore } = patch(sessionProto, "_runAutoCompaction", () => async (reason: string) => { reasons.push(reason); return false; });
			try {
				const userId = manager.appendMessage({ role: "user", content: "old", timestamp: 1 });
				manager.appendMessage(assistant(threshold + 1000, Date.now() - 10_000));
				manager.appendCompaction("summary", userId, threshold + 1000, { fake: true }, false);
				const compaction = manager.getBranch().find(item => item.type === "compaction")!;
				const compactedAt = new Date(compaction.timestamp!).getTime();
				assert.equal(await check(assistant(threshold + 1000, compactedAt - 1000)), false, "stale usage ignored");
				assert.deepEqual(reasons, []);
				await check(assistant(threshold + 1000, compactedAt + 1000));
				assert.deepEqual(reasons, ["threshold"], "a fresh message above W-R repeats compaction");
				reasons.length = 0;
				await check(assistant(threshold - 1000, compactedAt + 2000));
				assert.deepEqual(reasons, [], "adapter must project post-V2 usage at or below W-R");
			} finally {
				restore();
				session.dispose();
			}
		});

		it("custom raw wire items and pre-compaction originals survive save, reload and fork without a destructive checkpoint", () => {
			const tag = label.replace(/\W+/g, "-");
			const dir = join(root, `sessions-${tag}`);
			const forkDir = join(root, `forks-${tag}`);
			const manager = entry.SessionManager.create(agentDir, dir);
			const rawItems = [
				{ type: "reasoning", id: "rs_fake", encrypted_content: "enc-fake-opaque", summary: [] },
				{ type: "custom_tool_call", call_id: "call_1", name: "apply", input: "*** raw ***" },
				{ type: "future_item_kind", nested: [1, "é", null, { deep: true }] },
			];
			const m = manager as unknown as { appendMessage(m: object): string; appendCustomEntry(t: string, d: unknown): string; appendCompaction(...a: unknown[]): string; getEntries(): { type: string }[]; getEntry(id: string): { data?: unknown } | undefined };
			const assistantId = m.appendMessage({ role: "user", content: "first", timestamp: 1 });
			const replyId = m.appendMessage({ role: "assistant", content: [{ type: "text", text: "reply" }], timestamp: 2 });
			const wireData = { version: 1, items: rawItems, parentEntryId: replyId };
			const wireId = m.appendCustomEntry("rqw-codex/wire", wireData);
			const fileBefore = readFileSync(manager.getSessionFile()!, "utf8");
			const entriesBefore = m.getEntries();
			m.appendCompaction("stage1 summary", replyId, 999, { rqwCodex: { items: rawItems } }, false);
			const fileAfter = readFileSync(manager.getSessionFile()!, "utf8");
			assert.ok(fileAfter.startsWith(fileBefore), "compaction appends; earlier bytes are untouched");
			assert.equal(m.getEntries().length, entriesBefore.length + 1, "no entry removed by compaction");
			const sourcePath = manager.getSessionFile()!;
			// JSON persistence drops undefined fields, so compare against the JSON-normalised in-memory entries.
			const normalised = JSON.parse(JSON.stringify(m.getEntries())) as { type: string }[];
			const reloaded = entry.SessionManager.open(sourcePath, dir) as unknown as { getEntries(): { type: string }[]; getEntry(id: string): { data?: unknown } | undefined };
			assert.deepEqual(reloaded.getEntries(), normalised, "reload keeps every entry, including originals");
			assert.deepEqual(reloaded.getEntry(wireId)?.data, wireData, "custom wire items are opaque and exact");
			const forkPath = entry.SessionManager.forkFrom(sourcePath, agentDir, forkDir).getSessionFile()!;
			const fork = entry.SessionManager.open(forkPath, forkDir) as unknown as { getEntries(): { type: string }[]; getEntry(id: string): { data?: unknown } | undefined };
			assert.deepEqual(fork.getEntries().filter(item => item.type !== "session"), normalised.filter(item => item.type !== "session"),
				"fork keeps the same ids and pre-compaction originals");
			assert.deepEqual(fork.getEntry(wireId)?.data, wireData);
			assert.equal(readFileSync(sourcePath, "utf8"), fileAfter, "fork does not rewrite the source");
			assert.notEqual(assistantId, replyId);
		});

		it("early _bindExtensionCore cannot see the final configured prompt (GAP, spike outcome FAILED)", async () => {
			const runtime = await runtimeFor(entry);
			const sessionProto = entry.AgentSession.prototype as unknown as object;
			const MARKER = "FINAL-RQW-PROMPT-MARK";
			let atBind: { systemPrompt?: string; systemPromptError?: string; tools?: string[]; toolsError?: string } | undefined;
			const { restore } = patch(sessionProto, "_bindExtensionCore", original => function(this: { systemPrompt: string; getActiveToolNames(): string[] }, ...args: unknown[]) {
				if (!atBind) {
					atBind = {};
					try { atBind.systemPrompt = this.systemPrompt; } catch (error) { atBind.systemPromptError = (error as Error).message; }
					try { atBind.tools = this.getActiveToolNames(); } catch (error) { atBind.toolsError = (error as Error).message; }
				}
				return original.apply(this, args);
			});
			const bodies: string[] = [];
			const finalExtension = (pi: { on(event: string, handler: (event: { systemPromptOptions: { customPrompt?: string } }) => void): void }) => {
				pi.on("before_agent_start", event => { event.systemPromptOptions.customPrompt = MARKER; });
			};
			let session: Awaited<ReturnType<typeof sessionFor>> | undefined;
			try {
				session = await sessionFor(entry, runtime, { extensionFactories: [finalExtension] });
				await withFetch(okFetch(bodies), async () => { await session!.prompt("hi"); });
			} finally {
				restore();
				session?.dispose();
			}
			assert.ok(atBind, "bind observed");
			// Observed gap: the system prompt getter throws during construction (base options not built yet),
			// so no final configured prompt exists at bind time. The marker only reaches the wire at run time.
			assert.match(atBind.systemPromptError ?? "", /forceSystemPrompt/, "bind-time systemPrompt is not available (GAP)");
			assert.equal(atBind.systemPrompt, undefined);
			assert.equal(bodies.length, 1);
			assert.equal(bodies[0].includes(MARKER), true, "final marker is only present at run time");
		});
	});
}
