// GPT Fast in RQW-settings (the main chat): the real Pi pipeline, the real openai-codex and anthropic providers, only the network
// (globalThis.fetch) replaced, so the assertions read the request body Pi would put on the wire.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import {
	AgentSession, createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";

const SETTINGS = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const STATE = Symbol.for("rqw-settings/fast-gpt");
const jwt = ["e30", Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })).toString("base64url"), "sig"].join(".");
const completed = JSON.stringify({ type: "response.completed", response: { id: "r", status: "completed", output: [],
	usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });

let root: string;
let runtime: ModelRuntime;
const bodies: Record<string, any>[] = [];
const realFetch = globalThis.fetch;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-fast-"));
	await writeFile(join(root, "auth.json"), JSON.stringify({
		"openai-codex": { type: "oauth", access: jwt, refresh: "r", expires: Date.now() + 3_600_000 },
		anthropic: { type: "api_key", key: "sk-ant-api03-fake" },
	}));
	runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
	await runtime.refresh({ allowNetwork: false });
	globalThis.fetch = async (input, init) => {
		const headers = new Headers(init?.headers);
		const raw = headers.get("content-encoding") === "zstd" ? zlib.zstdDecompressSync(init!.body as Uint8Array).toString() : String(init?.body);
		bodies.push(JSON.parse(raw));
		return String(input).includes("anthropic")
			? Response.json({ type: "error", error: { type: "invalid_request_error", message: "stop" } }, { status: 400 })
			: new Response(`data: ${completed}\n\n`, { headers: { "content-type": "text/event-stream" } });
	};
});
after(async () => { globalThis.fetch = realFetch; await rm(root, { recursive: true, force: true }); });

/**
 * A WebSocket that records every frame sent and answers it with a completed response. Pi's openai-codex provider
 * takes `globalThis.WebSocket` at connect time; its frame is `{ type: "response.create", ...body }`, where `body` is what
 * `onPayload` (`before_provider_request`) returned (pi-ai dist/api/openai-codex-responses.js, lines 175-178, 1211).
 */
const frames: Record<string, any>[] = [];
class FakeWebSocket extends EventTarget {
	readyState = 0;
	url: string;
	constructor(url: string, _options?: unknown) {
		super();
		this.url = url;
		queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
	}
	send(data: string) {
		frames.push(JSON.parse(data));
		queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: completed })));
	}
	close() { this.readyState = 3; }
}

const codex = () => runtime.getModels("openai-codex").find((m) => m.id === "gpt-6.1-sol")!;
const claude = () => runtime.getModels("anthropic").find((m) => m.id === "claude-opus-5-5")!;

let bus: { emit(channel: string, data: unknown): void; on(channel: string, handler: (data: unknown) => void): () => void };
async function open(model = codex(), transport: "sse" | "websocket" = "sse"): Promise<AgentSession> {
	const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, additionalExtensionPaths: [SETTINGS],
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	bus = (loader as unknown as { eventBus: typeof bus }).eventBus;
	const { session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime, model, resourceLoader: loader,
		sessionManager: SessionManager.inMemory(root), settingsManager: SettingsManager.inMemory({ transport, retry: { enabled: false } }) });
	await session.bindExtensions({});
	return session;
}

/** The request body of one main-session turn. */
async function body(session: AgentSession): Promise<Record<string, any>> {
	bodies.length = 0;
	await session.prompt("hi");
	assert.equal(bodies.length, 1);
	return bodies[0];
}

const command = (session: AgentSession, args: string, notes: string[] = []) =>
	session.extensionRunner.getCommand("fast-gpt")!.handler(args, { ...session.extensionRunner.createCommandContext(),
		ui: { notify: (text: string) => notes.push(text) } } as never);
describe("GPT Fast, main chat", () => {
	it("the WebSocket transport sends the same top-level service_tier and bare model id", async () => {
		delete (globalThis as any)[STATE];
		const realWebSocket = globalThis.WebSocket;
		globalThis.WebSocket = FakeWebSocket as never;
		const session = await open(codex(), "websocket");
		try {
			await command(session, "on");
			bodies.length = 0; frames.length = 0;
			await session.prompt("hi");
			assert.equal(frames.length, 1, "one frame on the socket");
			assert.deepEqual(bodies, [], "nothing went over HTTP");
			assert.equal(frames[0].type, "response.create");
			assert.equal(frames[0].model, "gpt-6.1-sol", "the bare model id, not a wrapper");
			assert.equal(frames[0].service_tier, "priority");
			await command(session, "off");
			frames.length = 0;
			await session.prompt("again");
			assert.equal(frames.length, 1);
			assert.ok(!("service_tier" in frames[0]), "off: no tier on the socket either");
		} finally { globalThis.WebSocket = realWebSocket; session.dispose(); delete (globalThis as any)[STATE]; }
	});

	it("default off: openai-codex gets no tier; after /fast-gpt on it gets priority, anthropic gets none", async () => {
		delete (globalThis as any)[STATE];
		const session = await open();
		try {
			assert.ok(!("service_tier" in await body(session)), "default off");
			await command(session, "on");
			assert.equal((await body(session)).service_tier, "priority");
			await session.setModel(claude());
			const sent = await body(session);
			assert.ok(!("service_tier" in sent), JSON.stringify(Object.keys(sent)));
			assert.equal(sent.model, "claude-opus-5-5");
		} finally { session.dispose(); }
	});

	it("/fast-gpt toggles, takes on and off, reaches the next request and survives a new session; usage on bad input", async () => {
		delete (globalThis as any)[STATE];
		const session = await open();
		const notes: string[] = [];
		try {
			await command(session, "", notes);
			assert.equal((await body(session)).service_tier, "priority", "no argument toggles off to on");
			await command(session, "on", notes);
			assert.equal((await body(session)).service_tier, "priority");
			await command(session, "off", notes);
			const second = await open();
			try { assert.ok(!("service_tier" in await body(second)), "off holds for a new session of the process"); } finally { second.dispose(); }
			await command(session, "maybe", notes);
			assert.ok(!("service_tier" in await body(session)), "bad input changes nothing");
			assert.deepEqual(notes, ["GPT Fast on (main chat, GPT only)", "GPT Fast on (main chat, GPT only)",
				"GPT Fast off (main chat, GPT only)", "Usage: /fast-gpt [on|off]"]);
		} finally { session.dispose(); delete (globalThis as any)[STATE]; }
	});

	it("answers the query channel the children and the status bar use, and announces changes", async () => {
		delete (globalThis as any)[STATE];
		const session = await open();
		const announced: unknown[] = [];
		const stop = bus.on("rqw-settings:fast-gpt", (change) => announced.push(change));
		const ask = () => { const query: { fastGpt?: boolean } = {}; bus.emit("rqw-settings:fast-gpt-query", query); return query.fastGpt; };
		try {
			assert.equal(ask(), false, "default off (FAST_GPT_DEFAULT)");
			await command(session, "on");
			assert.equal(ask(), true);
			await command(session, "off");
			assert.equal(ask(), false);
			assert.deepEqual(announced, [{ on: true }, { on: false }]);
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			assert.equal(ask(), undefined, "a shut-down extension no longer answers");
		} finally { stop(); session.dispose(); delete (globalThis as any)[STATE]; }
	});
});
