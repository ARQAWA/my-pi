// GPT Fast in RQW-agent's children (`agent`, `code_writer`, `shell_runner`): real Pi sessions, the real openai-codex
// and anthropic providers, only the network (globalThis.fetch) replaced, so the assertions read the request bodies
// that would go on the wire. RQW-settings is not loaded (this test loads only RQW-agent); a stand-in answers on the
// parent's `pi.events` the query channel that RQW-settings answers in production (`state.fast` is the main chat's /fast-gpt state).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import zlib from "node:zlib";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
	createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const EXTENSION = join(import.meta.dirname, "..", "index.ts");
const jwt = ["e30", Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })).toString("base64url"), "sig"].join(".");
const sse = (events: object[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const message = { type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "ok", annotations: [] }] };
const codexAnswer = sse([
	{ type: "response.output_item.added", item: { ...message, status: "in_progress", content: [] } },
	{ type: "response.content_part.added", part: { type: "output_text", text: "", annotations: [] } },
	{ type: "response.output_text.delta", delta: "ok" },
	{ type: "response.output_item.done", item: message },
	{ type: "response.completed", response: { id: "r", status: "completed", output: [message], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
]);
/** A codex answer that calls code_writer once, for the nested-inheritance test. */
const call = { type: "function_call", id: "fc1", call_id: "call1", name: "code_writer", arguments: '{"task":"nested"}', status: "completed" };
const codexNested = sse([
	{ type: "response.output_item.added", item: { ...call, arguments: "", status: "in_progress" } },
	{ type: "response.function_call_arguments.delta", delta: call.arguments },
	{ type: "response.function_call_arguments.done", arguments: call.arguments },
	{ type: "response.output_item.done", item: call },
	{ type: "response.completed", response: { id: "r2", status: "completed", output: [call], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
]);
const claudeAnswer = sse([
	{ type: "message_start", message: { id: "a", model: "claude", usage: { input_tokens: 5, output_tokens: 0 } } },
	{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
	{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
	{ type: "content_block_stop", index: 0 },
	{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
	{ type: "message_stop" },
]);

/** A child whose system prompt is NESTED calls code_writer in its first request only (no continuation, no tool result yet). */
const codexReply = (body: Record<string, any>) =>
	body.instructions === "NESTED" && !body.previous_response_id && !JSON.stringify(body.input).includes("function_call_output") ? codexNested : codexAnswer;

let root: string;
let counter = 0;
const wire: { url: string; body: Record<string, any> }[] = [];
const realFetch = globalThis.fetch;
const realWebSocket = globalThis.WebSocket;
/**
 * Pi's openai-codex provider defaults to the "auto" transport, which tries a WebSocket first: this fake socket keeps
 * the test offline and records each frame (`{ type: "response.create", ...body }`, the body `onPayload` returned) as a
 * request on the wire, so the default transport is the one under test.
 */
const eventsOf = (text: string): object[] => text.split("\n\n").filter(Boolean).map((block) => JSON.parse(block.slice(block.indexOf("data: ") + 6)));
class FakeWebSocket extends EventTarget {
	readyState = 0;
	url: string;
	constructor(url: string, _options?: unknown) {
		super();
		this.url = url;
		queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
	}
	send(data: string) {
		const { type: _type, ...body } = JSON.parse(data);
		wire.push({ url: this.url, body });
		queueMicrotask(() => { for (const event of eventsOf(codexReply(body))) this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) })); });
	}
	close() { this.readyState = 3; }
}
before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-agent-fast-"));
	globalThis.WebSocket = FakeWebSocket as never;
	globalThis.fetch = async (input, init) => {
		const raw = new Headers(init?.headers).get("content-encoding") === "zstd"
			? zlib.zstdDecompressSync(init!.body as Uint8Array).toString() : String(init?.body);
		wire.push({ url: String(input), body: JSON.parse(raw) });
		const anthropic = String(input).includes("anthropic");
		return new Response(anthropic ? claudeAnswer : codexReply(wire.at(-1)!.body), { headers: { "content-type": "text/event-stream" } });
	};
});
after(async () => { globalThis.fetch = realFetch; globalThis.WebSocket = realWebSocket; await rm(root, { recursive: true, force: true }); });

const until = async (check: () => boolean, what: string) => {
	// Failure watchdog only; a loaded Windows runner needs far more than a second per child round trip.
	const end = Date.now() + 60_000;
	while (!check()) {
		assert.ok(Date.now() < end, `timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
};

/** A main session on a faux model; `providers` are the real providers with fake credentials the runtime holds. */
async function open(providers: ("openai-codex" | "anthropic")[]) {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	const auth: Record<string, unknown> = {};
	if (providers.includes("openai-codex")) auth["openai-codex"] = { type: "oauth", access: jwt, refresh: "r", expires: Date.now() + 3_600_000 };
	if (providers.includes("anthropic")) auth.anthropic = { type: "api_key", key: "sk-ant-api03-fake" };
	await writeFile(join(dir, "auth.json"), JSON.stringify(auth));
	const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	await runtime.refresh({ allowNetwork: false });
	const main = fauxProvider({ provider: `fast-main-${counter}`, api: `fast-main-${counter}`, models: [{ id: "m", reasoning: true }] });
	main.setResponses(Array.from({ length: 200 }, () => () => fauxAssistantMessage("main ok")));
	runtime.registerNativeProvider(main.provider);
	// The stand-in for RQW-settings' answer; `state.fast` is the /fast switch.
	const state = { fast: true as boolean | undefined };
	const standIn = (pi: ExtensionAPI) => {
		if (state.fast !== undefined) pi.events.on("rqw-settings:fast-gpt-query", (query) => { (query as { fastGpt?: boolean }).fastGpt = state.fast; });
	};
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [EXTENSION], extensionFactories: [standIn],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: main.getModel("m"), thinkingLevel: "low",
		resourceLoader: loader, sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" }) });
	await session.bindExtensions({ mode: "tui" });
	const call = async (tool: string, params: Record<string, unknown>) => {
		const result = await session.getToolDefinition(tool)!.execute("t", params as never, undefined, undefined, session.extensionRunner.createContext());
		return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
	};
	const delivered = () => session.messages.flatMap((m) => m.role === "custom" && typeof m.content === "string" && m.customType !== undefined ? [m.content] : []);
	const close = async () => { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); };
	return { session: session as AgentSession, state, call, delivered, close };
}
const tiers = () => wire.map(({ body }) => body.service_tier);
const model = "openai-codex/gpt-6.1-sol";
const PRIORITY = "priority";

describe("GPT Fast, RQW-agent children", () => {
	it("agent inherits the main chat's state at start: on gives priority, off gives none, anthropic never", async () => {
		wire.length = 0;
		const f = await open(["openai-codex", "anthropic"]);
		try {
			const start = (extra: Record<string, unknown> = {}, m = model) => f.call("agent", { action: "start", system: "EXACT", task: "go", model: m, tools: [], ...extra });
			assert.equal(await start(), "agent#1 started");
			await until(() => f.delivered().length === 1, "first answer");
			assert.deepEqual(wire.map(({ body }) => body.model), ["gpt-6.1-sol"]);
			assert.deepEqual(tiers(), [PRIORITY]);
			f.state.fast = false;
			await start();
			await until(() => f.delivered().length === 2, "second answer");
			assert.deepEqual(tiers(), [PRIORITY, undefined], "main chat off: the next child starts without");
			f.state.fast = true;
			wire.length = 0;
			await start({}, "anthropic/claude-opus-5-5");
			await until(() => f.delivered().length === 3, "anthropic answer");
			assert.match(wire[0].url, /anthropic/);
			assert.ok(!("service_tier" in wire[0].body), "Anthropic is never touched, whatever the state");
		} finally { await f.close(); }
	});

	it("a child keeps its start state for life: later /fast-gpt changes of the main chat do not reach it", async () => {
		wire.length = 0;
		const f = await open(["openai-codex"]);
		try {
			await f.call("agent", { action: "start", system: "EXACT", task: "go", model, tools: [] });
			await until(() => f.delivered().length === 1, "answer");
			f.state.fast = false;
			await f.call("agent", { action: "send", id: "agent#1", task: "again" });
			await until(() => f.delivered().length === 2, "send answer");
			await f.call("agent", { action: "restart", id: "agent#1", task: "fresh" });
			await until(() => f.delivered().length === 3, "restart answer");
			assert.deepEqual(tiers(), [PRIORITY, PRIORITY, PRIORITY], "send and restart keep the child's own state");
			// A child started without it stays without, although the main chat turns it on.
			await f.call("agent", { action: "start", system: "EXACT", task: "go", model, tools: [] });
			await until(() => f.delivered().length === 4, "off child answer");
			f.state.fast = true;
			await f.call("agent", { action: "send", id: "agent#2", task: "again" });
			await until(() => f.delivered().length === 5, "off child send answer");
			assert.deepEqual(tiers().slice(3), [undefined, undefined]);
		} finally { await f.close(); }
	});

	it("fast_gpt overrides inheritance at start, and send or restart may change it", async () => {
		wire.length = 0;
		const f = await open(["openai-codex"]);
		try {
			await f.call("agent", { action: "start", system: "EXACT", task: "go", model, tools: [], fast_gpt: false });
			await until(() => f.delivered().length === 1, "forbidden answer");
			assert.deepEqual(tiers(), [undefined], "main on, but the caller forbade it");
			await f.call("agent", { action: "send", id: "agent#1", task: "again", fast_gpt: true });
			await until(() => f.delivered().length === 2, "send answer");
			await f.call("agent", { action: "send", id: "agent#1", task: "and again" });
			await until(() => f.delivered().length === 3, "second send answer");
			assert.deepEqual(tiers(), [undefined, PRIORITY, PRIORITY], "a send override sticks");
			await f.call("agent", { action: "restart", id: "agent#1", task: "fresh", fast_gpt: false });
			await until(() => f.delivered().length === 4, "restart answer");
			assert.deepEqual(tiers().at(-1), undefined);
			f.state.fast = false;
			await f.call("agent", { action: "start", system: "EXACT", task: "go", model, tools: [], fast_gpt: true });
			await until(() => f.delivered().length === 5, "forced-on answer");
			assert.deepEqual(tiers().at(-1), PRIORITY, "main off, the caller asked for it");
			// strict-mode providers send null for omitted optional fields: that means inherit
			await f.call("agent", { action: "start", system: "EXACT", task: "go", model, tools: [], fast_gpt: null });
			await until(() => f.delivered().length === 6, "null answer");
			assert.deepEqual(tiers().at(-1), undefined, "null inherits the main chat's off");
		} finally { await f.close(); }
	});

	it("nested children inherit from their direct caller, not from the main chat", async () => {
		for (const [main, child, nested] of [[true, false, undefined], [false, true, PRIORITY]] as const) {
			wire.length = 0;
			const f = await open(["openai-codex"]);
			f.state.fast = main;
			try {
				await f.call("agent", { action: "start", system: "NESTED", task: "go", model, tools: [], fast_gpt: child });
				await until(() => f.delivered().length === 1, "nested chain answer");
				const bodies = wire.filter(({ body }) => body.instructions !== "NESTED");
				assert.equal(bodies.length, 1, "exactly one nested worker request");
				const own = wire.filter(({ body }) => body.instructions === "NESTED").map(({ body }) => body.service_tier);
				assert.ok(own.length >= 2, "the child called the worker and then answered");
				assert.ok(own.every((tier) => tier === (child ? PRIORITY : undefined)), "the child keeps its own state");
				assert.equal(bodies[0].body.service_tier, nested, `main ${main}, child ${child}`);
			} finally { await f.close(); }
		}
	});

	it("without an answer on the channel (RQW-settings not loaded) children stay on the standard tier", async () => {
		wire.length = 0;
		const f = await open(["openai-codex"]);
		f.state.fast = undefined;
		try {
			await f.call("agent", { action: "start", system: "EXACT", task: "go", model, tools: [] });
			await until(() => f.delivered().length === 1, "codex answer");
			assert.deepEqual(tiers(), [undefined]);
		} finally { await f.close(); }
	});

	for (const role of ["code_writer", "shell_runner"]) {
		it(`${role}: a GPT worker inherits (priority), fast_gpt false forbids it, a Claude worker never gets it`, async () => {
			wire.length = 0;
			const gpt = await open(["openai-codex"]);
			try {
				await gpt.call(role, { task: "do it" });
				await until(() => gpt.delivered().length === 1, "GPT worker answer");
				assert.deepEqual(wire.map(({ body }) => body.model), ["gpt-6-luna"]);
				assert.deepEqual(tiers(), [PRIORITY]);
				await gpt.call(role, { task: "do it", fast_gpt: false });
				await until(() => gpt.delivered().length === 2, "forbidden worker answer");
				assert.deepEqual(tiers(), [PRIORITY, undefined]);
				gpt.state.fast = false;
				await gpt.call(role, { task: "do it" });
				await until(() => gpt.delivered().length === 3, "main-off worker answer");
				assert.deepEqual(tiers(), [PRIORITY, undefined, undefined]);
				await gpt.call(role, { task: "do it", fast_gpt: true });
				await until(() => gpt.delivered().length === 4, "forced-on worker answer");
				assert.deepEqual(tiers().at(-1), PRIORITY);
			} finally { await gpt.close(); }
			wire.length = 0;
			const claude = await open(["anthropic"]);
			try {
				await claude.call(role, { task: "do it", fast_gpt: true });
				await until(() => claude.delivered().length === 1, "Claude worker answer");
				assert.deepEqual(wire.map(({ body }) => body.model), ["claude-haiku-5-5"]);
				assert.ok(!("service_tier" in wire[0].body));
			} finally { await claude.close(); }
		});
	}

	it("the three tools describe the inheritance and the fast_gpt switch in one sentence", async () => {
		const f = await open(["openai-codex"]);
		try {
			for (const tool of ["agent", "code_writer", "shell_runner"]) {
				const definition = f.session.getToolDefinition(tool)!;
				assert.match(definition.description, /By default children inherit GPT Fast; pass fast_gpt false when the user forbids Fast for subagents\./);
				assert.equal((definition.parameters as { properties: Record<string, { type: string }> }).properties.fast_gpt.type, "boolean");
			}
		} finally { await f.close(); }
	});
});
