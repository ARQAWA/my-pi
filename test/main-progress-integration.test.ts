// Cross-extension checks: real Pi registry/transports and native resumed/lazy entry rendering.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, InMemoryCredentialStore, InMemoryModelsStore, normalizeContext, type Context } from "@earendil-works/pi-ai";
import { convertToLlm, createEventBus, initTheme, ModelRegistry, ModelRuntime, SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import agent from "../extensions/RQW-agent/index.ts";
import anthropic from "../extensions/RQW-anthropic/index.ts";
import blocks from "../extensions/RQW-blocks/index.ts";
import { createCodexExtension } from "../extensions/RQW-codex/index.ts";
import { makeFullscreen, makeHost } from "./extensions/RQW-blocks/history-host.ts";

const CARD = "rqw-main-progress-v1";
const BODY = JSON.stringify({ paragraphs: [{ main: "проверил сохранение карточки.", details: ["продолжаю проверять историю."] }] });
const MAIN = "main answer";
const USAGE = { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };

async function driver(t: TestContext, realRegistry = false) {
	const root = mkdtempSync(join(tmpdir(), "rqw-main-progress-integration-"));
	const saved = { codex: process.env.CODEX_HOME, agent: process.env.PI_CODING_AGENT_DIR };
	process.env.CODEX_HOME = join(root, "codex");
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(join(cwd, ".git"), { recursive: true });
	t.after(() => {
		for (const [key, value] of [["CODEX_HOME", saved.codex], ["PI_CODING_AGENT_DIR", saved.agent]] as const) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
		rmSync(root, { recursive: true, force: true });
	});
	const manager = SessionManager.create(cwd, join(root, "sessions"));
	const credentials = new InMemoryCredentialStore();
	const runtime = realRegistry ? await ModelRuntime.create({ credentials, modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false }) : undefined;
	const core = createFauxCore({ provider: "card-test", models: [{ id: "model" }] });
	core.setResponses([fauxAssistantMessage(BODY, { timestamp: 0 })]);
	const registry = runtime ? new ModelRegistry(runtime) : { find: () => core.getModel("model"), streamSimple: (model: any, context: Context, options?: any) => core.streamSimple(model, normalizeContext(context), options) };
	const renderers = new Map<string, any>();
	const hooks = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	const cardSaved = Promise.withResolvers<void>();
	const pi: any = {
		events: createEventBus(), registerTool() {}, registerCommand() {}, getThinkingLevel: () => "low",
		on(name: string, hook: any) {
			hooks.set(name, [...hooks.get(name) ?? [], hook]);
			return () => hooks.set(name, (hooks.get(name) ?? []).filter(item => item !== hook));
		},
		registerProvider: (id: string, config: any) => runtime!.registerProvider(id, config),
		registerEntryRenderer: (type: string, renderer: any) => renderers.set(type, renderer),
		appendEntry: (type: string, data: any) => {
			const id = manager.appendCustomEntry(type, data);
			if (type === CARD) cardSaved.resolve();
			return id;
		},
		sendMessage: () => { throw new Error("progress cannot enter main model messages"); },
	};
	agent(pi as ExtensionAPI);
	const ctx: any = {
		cwd, mode: "tui", model: core.getModel("model"), modelRegistry: registry, sessionManager: manager,
		signal: new AbortController().signal, isIdle: () => true,
	};
	const emit = async (name: string, event: any = {}) => {
		for (const hook of [...hooks.get(name) ?? []]) await hook(event, ctx);
	};
	t.after(() => emit("session_shutdown"));
	await emit("session_start");
	const cards = () => manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === CARD);
	const steps = async () => {
		for (let n = 1; n <= 50; n++) {
			const message = { ...fauxAssistantMessage([fauxToolCall("read", { path: `file-${n}.ts` }, { id: `call-${n}` })], { timestamp: n }),
				provider: ctx.model.provider, model: ctx.model.id, thinkingLevel: "low" as const, stopReason: "toolUse" as const };
			await emit("message_end", { message });
			manager.appendMessage(message);
		}
		await cardSaved.promise;
		assert.equal(cards().length, 1, "the registered hook must save a validated summary card");
	};
	return { root, pi, ctx, manager, runtime, registry, credentials, renderers, emit, steps, cards };
}

function codexEvents(id: string, text: string) {
	return [
		{ type: "response.created", response: { id } },
		{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", content: [], status: "in_progress" } },
		{ type: "response.output_text.delta", item_id: `msg_${id}`, output_index: 0, content_index: 0, delta: text },
		{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
		{ type: "response.completed", response: { id, status: "completed", usage: USAGE } },
	];
}

// The same network-only WebSocket boundary as RQW-codex's transport/background-summary tests.
function sockets() {
	const sent: { connection: number; frame: any; responseId: string }[] = [];
	let connections = 0;
	const connect = async (options: any) => {
		const connection = ++connections;
		options.onResponse?.({ status: 101, headers: {} });
		let open = true;
		let queue: unknown[] = [];
		let sequence = 0;
		return {
			get isOpen() { return open; }, socketIdentity: `socket-${connection}`,
			events: () => (async function* () {
				while (queue.length) { const value = queue.shift(); yield { text: JSON.stringify(value), value }; }
			})(),
			async send(frame: any) {
				const responseId = `resp_${connection}_${++sequence}`;
				sent.push({ connection, frame, responseId });
				queue = codexEvents(responseId, JSON.stringify(frame).includes("Summarize only") ? BODY : MAIN);
			},
			async interrupt() { return { acknowledged: true as const, completed: false }; },
			async close() { open = false; },
		};
	};
	return { connect, sent };
}

const mainContext: Context = { systemPrompt: "original main prompt", messages: [{ role: "user", content: "main question", timestamp: 0 }] };

test("registered main summaries traverse RQW-codex without replacing the main continuation", async t => {
	const d = await driver(t, true);
	const network = sockets();
	const access = `e30.${Buffer.from(JSON.stringify({ exp: 4_000_000_000, "https://api.openai.com/auth": { chatgpt_account_id: "acct_test" } })).toString("base64url")}.sig`;
	await d.credentials.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "fake", expires: 4_000_000_000_000, accountId: "acct_test" }) as never);
	createCodexExtension({ installationId: "11111111-2222-4333-8444-555555555555", dependencies: {
		connect: network.connect as any, clock: { now: () => 1_000_000 }, random: () => 0.5, sleep: async () => {},
		postEvents: () => { throw new Error("unexpected SSE fallback"); },
	} })(d.pi);
	d.ctx.model = d.runtime!.getModels("openai-codex")[0];
	assert.ok(d.ctx.model);
	const session = {
		sessionId: d.manager.getSessionId(), sessionManager: d.manager, modelRuntime: d.runtime, model: d.ctx.model,
		agent: { state: { tools: [] } }, _hiddenDeclarations: new Set(),
		subscribe: () => () => {}, dispose() {}, _isRetryableError: () => false,
	};
	await d.emit("rqw-codex:session-bind", { session });
	d.manager.appendMessage(mainContext.messages[0]);
	const first = await d.registry.streamSimple(d.ctx.model, mainContext, { sessionId: session.sessionId }).result();
	assert.equal(first.stopReason, "stop");
	assert.equal(first.content[0].type === "text" && first.content[0].text, MAIN);
	d.manager.appendMessage(first);
	await d.steps();
	d.manager.appendMessage({ role: "user", content: "next main question", timestamp: 100 });
	const next: Context = { ...mainContext, messages: convertToLlm(d.manager.buildSessionContext().messages) };
	const second = await d.registry.streamSimple(d.ctx.model, next, { sessionId: session.sessionId }).result();
	assert.equal(second.stopReason, "stop");
	assert.equal(network.sent.length, 3);
	const [before, summary, after] = network.sent;
	assert.equal(before.connection, after.connection, "the main session keeps its socket");
	assert.notEqual(summary.connection, before.connection, "the summary owns a request-local transport");
	assert.equal(after.frame.previous_response_id, before.responseId, "the main response, not the summary, remains the continuation parent");
	assert.ok(JSON.stringify(after.frame).includes("next main question"));
	assert.ok(!JSON.stringify(after.frame).includes("Summarize only"));
	assert.ok(!JSON.stringify(after.frame).includes("проверил сохранение карточки"));
	assert.equal(summary.frame.previous_response_id, undefined);
});

// SSE network fake reused in shape from RQW-anthropic/adapter.test.ts; the SDK and subscription overlay stay real.
function anthropicResponse(model: string, text: string) {
	const events = [
		{ type: "message_start", message: { id: "fake", model, usage: { input_tokens: 1, output_tokens: 0 } } },
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
		{ type: "message_stop" },
	];
	return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

test("registered main summaries traverse RQW-anthropic without changing the main payload", async t => {
	const d = await driver(t, true);
	await d.credentials.modify("anthropic", async () => ({ type: "oauth", access: "sk-ant-oat01-fake", refresh: "fake", expires: 4_102_444_800_000 }));
	const payloads: { body: any; headers: Headers }[] = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const request = new Request(input, init);
		assert.equal(new URL(request.url).origin, "https://api.anthropic.com");
		const body = JSON.parse(await request.text());
		payloads.push({ body, headers: request.headers });
		return anthropicResponse(body.model, JSON.stringify(body).includes("Summarize only") ? BODY : MAIN);
	};
	t.after(() => { globalThis.fetch = originalFetch; });
	anthropic(d.pi);
	d.ctx.model = d.runtime!.getModels("anthropic").find(model => model.id === "claude-sonnet-5-5") ?? d.runtime!.getModels("anthropic")[0];
	await d.emit("rqw-anthropic:session-bind", { session: { sessionId: d.manager.getSessionId() } });
	const options = { sessionId: d.manager.getSessionId(), reasoning: "low" as const };
	assert.equal((await d.registry.streamSimple(d.ctx.model, mainContext, options).result()).stopReason, "stop");
	await d.steps();
	assert.equal((await d.registry.streamSimple(d.ctx.model, mainContext, options).result()).stopReason, "stop");
	assert.equal(payloads.length, 3);
	assert.deepEqual(payloads[2].body, payloads[0].body, "the identical main request stays identical across a detached summary");
	assert.equal(payloads[0].headers.get("x-claude-code-session-id"), options.sessionId);
	assert.notEqual(payloads[1].headers.get("x-claude-code-session-id"), options.sessionId);
	assert.ok(JSON.stringify(payloads[1].body).includes("Summarize only"));
	assert.ok(payloads.every(payload => payload.headers.get("user-agent")?.startsWith("claude-cli/")));
});

test("Pi resumes saved progress cards and RQW-blocks loads their older interval lazily", async t => {
	initTheme();
	const d = await driver(t);
	d.manager.appendMessage({ role: "user", content: "old main prompt", timestamp: 0 });
	await d.steps();
	const file = d.manager.getSessionFile()!;
	blocks(d.pi as ExtensionAPI); // History is installed at extension registration, before the resumed transcript draws.
	const wireRenderers = (host: ReturnType<typeof makeHost>) => {
		(host.runtimeHost.session as any).extensionRunner.getEntryRenderer = (type: string) => d.renderers.get(type);
	};
	const resumed = SessionManager.open(file);
	const inline = makeHost(resumed);
	wireRenderers(inline);
	inline.renderInitialMessages();
	const rows = (host: ReturnType<typeof makeHost>) => host.chatContainer.render(80).map(stripTerminalSequences).join("\n");
	assert.ok(rows(inline).includes("Progress update"));
	assert.ok(rows(inline).includes("steps 1–50"));
	assert.ok(rows(inline).includes("проверил сохранение карточки."));
	const kept = d.manager.appendMessage({ role: "user", content: "latest main prompt", timestamp: 100 });
	d.manager.appendMessage(fauxAssistantMessage("latest answer", { timestamp: 101 }));
	d.manager.appendCompaction("older work summary", kept, 1000);
	const before = readFileSync(file, "utf8");
	const fx = makeFullscreen(SessionManager.open(file), { columns: 80, rows: 24 });
	t.after(() => fx.stop());
	wireRenderers(fx.host);
	fx.host.renderInitialMessages(); fx.frame();
	assert.ok(rows(fx.host).includes("latest main prompt"));
	assert.ok(!rows(fx.host).includes("Progress update"), "the old interval starts unloaded");
	fx.view.scrollTo(0); fx.frame(); fx.wheel(-1);
	assert.ok(rows(fx.host).includes("Progress update"));
	assert.ok(rows(fx.host).includes("steps 1–50"));
	assert.ok(rows(fx.host).includes("проверил сохранение карточки."));
	assert.equal(readFileSync(file, "utf8"), before, "history replay neither regenerates nor rewrites cards");
});
