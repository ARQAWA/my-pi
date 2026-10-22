// GPT Fast in RQW-review's reviewer sessions (they inherit the main chat's state when they start): real Pi sessions, the real openai-codex
// and anthropic providers, only the network (globalThis.fetch) replaced, so the assertions read the request bodies
// that would go on the wire. RQW-settings is not loaded (this test loads only RQW-review); a stand-in answers on the
// parent's `pi.events` the query channel that RQW-settings answers in production.
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
const message = { type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "CLEAN", annotations: [] }] };
const codexAnswer = sse([
	{ type: "response.output_item.added", item: { ...message, status: "in_progress", content: [] } },
	{ type: "response.content_part.added", part: { type: "output_text", text: "", annotations: [] } },
	{ type: "response.output_text.delta", delta: "CLEAN" },
	{ type: "response.output_item.done", item: message },
	{ type: "response.completed", response: { id: "r", status: "completed", output: [message], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
]);
const claudeAnswer = sse([
	{ type: "message_start", message: { id: "a", model: "claude", usage: { input_tokens: 5, output_tokens: 0 } } },
	{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
	{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "CLEAN" } },
	{ type: "content_block_stop", index: 0 },
	{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
	{ type: "message_stop" },
]);

const codexReply = (_body: Record<string, any>) => codexAnswer;

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
	root = await mkdtemp(join(tmpdir(), "rqw-review-fast-"));
	globalThis.WebSocket = FakeWebSocket as never;
	globalThis.fetch = async (input, init) => {
		const raw = new Headers(init?.headers).get("content-encoding") === "zstd"
			? zlib.zstdDecompressSync(init!.body as Uint8Array).toString() : String(init?.body);
		wire.push({ url: String(input), body: JSON.parse(raw) });
		const anthropic = String(input).includes("anthropic");
		return new Response(anthropic ? claudeAnswer : codexAnswer, { headers: { "content-type": "text/event-stream" } });
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

/** A main session on a faux model of the given family; the reviewer is the family's real provider with fake credentials. */
async function open(family: "gpt" | "claude") {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "auth.json"), JSON.stringify(family === "gpt"
		? { "openai-codex": { type: "oauth", access: jwt, refresh: "r", expires: Date.now() + 3_600_000 } }
		: { anthropic: { type: "api_key", key: "sk-ant-api03-fake" } }));
	const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	await runtime.refresh({ allowNetwork: false });
	const main = fauxProvider({ provider: `fast-main-${counter}`, api: `fast-main-${counter}`, models: [{ id: `${family}-main`, reasoning: true }] });
	main.setResponses(Array.from({ length: 50 }, () => () => fauxAssistantMessage("main ok")));
	runtime.registerNativeProvider(main.provider);
	// The stand-in for RQW-settings' answer; `state.fast` is the main chat's /fast-gpt state.
	const state = { fast: true as boolean | undefined };
	const standIn = (pi: ExtensionAPI) => {
		if (state.fast !== undefined) pi.events.on("rqw-settings:fast-gpt-query", (query) => { (query as { fastGpt?: boolean }).fastGpt = state.fast; });
	};
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [EXTENSION], extensionFactories: [standIn],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: main.getModel(`${family}-main`), thinkingLevel: "off",
		resourceLoader: loader, sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" }) });
	await session.bindExtensions({ mode: "tui" });
	const review = async (extra: Record<string, unknown> = {}) => {
		const result = await session.getToolDefinition("review")!.execute("t", { level: "blind", object: "a.ts", criterion: "c", ...extra } as never,
			undefined, undefined, session.extensionRunner.createContext());
		return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
	};
	const verdicts = () => session.messages.filter((m) => m.role === "custom" && m.customType === "review").length;
	const close = async () => { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); };
	return { state, review, verdicts, close, tool: () => session.getToolDefinition("review")! };
}

describe("GPT Fast, RQW-review reviewers", () => {
	it("a GPT reviewer inherits the main chat state at its start (priority on, none off); a Claude reviewer never", async () => {
		wire.length = 0;
		const f = await open("gpt");
		try {
			await f.review();
			await until(() => f.verdicts() === 1, "first verdict");
			assert.deepEqual(wire.map(({ body }) => body.model), ["gpt-5.6-luna"]);
			assert.deepEqual(wire.map(({ body }) => body.service_tier), ["priority"]);
			f.state.fast = false;
			await f.review();
			await until(() => f.verdicts() === 2, "second verdict");
			assert.deepEqual(wire.map(({ body }) => body.service_tier), ["priority", undefined]);
		} finally { await f.close(); }
		wire.length = 0;
		const claude = await open("claude");
		try {
			await claude.review();
			await until(() => claude.verdicts() === 1, "Claude verdict");
			assert.deepEqual(wire.map(({ body }) => body.model), ["claude-haiku-5-5"]);
			assert.ok(!("service_tier" in wire[0].body));
		} finally { await claude.close(); }
	});

	it("fast_gpt of the review tool overrides the inherited state for that reviewer; null inherits", async () => {
		wire.length = 0;
		const f = await open("gpt");
		try {
			let n = 0;
			const run = async (extra: Record<string, unknown>) => { const want = ++n; await f.review(extra); await until(() => f.verdicts() === want, `verdict ${want}`); };
			await run({ fast_gpt: false });
			await run({ fast_gpt: null });
			f.state.fast = false;
			await run({ fast_gpt: true });
			await run({ fast_gpt: null });
			await run({});
			assert.deepEqual(wire.map(({ body }) => body.service_tier), [undefined, "priority", "priority", undefined, undefined],
				"main on: forbidden none, null inherits; main off: forced priority, null and omitted inherit none");
		} finally { await f.close(); }
	});

	it("the review tool describes the inheritance and takes an optional boolean fast_gpt", async () => {
		const f = await open("gpt");
		try {
			const tool = f.tool();
			assert.match(tool.description, /By default a reviewer inherits GPT Fast; pass fast_gpt false when the user forbids Fast for subagents\.$/);
			assert.equal((tool.parameters as { properties: Record<string, { type: string }> }).properties.fast_gpt.type, "boolean");
			assert.ok(!((tool.parameters as { required?: string[] }).required ?? []).includes("fast_gpt"));
		} finally { await f.close(); }
	});

	it("without an answer on the channel (RQW-settings not loaded) the reviewer stays on the standard tier", async () => {
		wire.length = 0;
		const f = await open("gpt");
		f.state.fast = undefined;
		try {
			await f.review();
			await until(() => f.verdicts() === 1, "verdict");
			assert.deepEqual(wire.map(({ body }) => body.service_tier), [undefined]);
		} finally { await f.close(); }
	});
});
