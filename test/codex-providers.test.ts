// Package-level coexistence after the provider split: RQW-providers (extension 14) and RQW-codex (extension 15) together in one
// real Pi 1.4.0 session, in both load orders. Fake Codex grant in a temporary agent directory, fake connect (426 refused
// upgrade) and fake postEvents (SSE), a fetch stub that throws. Each extension's own tests load it alone. No external network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as zlib from "node:zlib";
import { after, before, describe, it } from "node:test";
import { AgentSession, createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

import providers from "../extensions/RQW-providers/index.ts";
import { createCodexExtension } from "../extensions/RQW-codex/index.ts";
import { SocketError } from "../extensions/RQW-codex/websocket.ts";
import { CODEX_PROVIDER } from "../extensions/RQW-codex/profile.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEPT = ["anthropic", "kimi-coding", "openai-codex"];
const INSTALLATION = "11111111-2222-4333-8444-555555555555";
const ACCOUNT = "acct_codex_providers_1";
const GRANT_TOKEN = jwt({ exp: Math.floor(Date.now() / 1000) + 3600, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } });
const anthropicCredential = { type: "oauth", access: "sk-ant-oat01-fake-pair", refresh: "fake-refresh", expires: Date.now() + 3_600_000 };
const otherCredential = { type: "api_key", key: "fake-other" };

// Pi's own methods, captured before any extension of this file loads.
const SLOTS = ["dispose", "_bindExtensionCore", "scopedModels"];
const native = SLOTS.map(name => Object.getOwnPropertyDescriptor(AgentSession.prototype, name));
const slots = () => SLOTS.map(name => Object.getOwnPropertyDescriptor(AgentSession.prototype, name));

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwt(payload: Record<string, unknown>): string {
	return `${b64url({ alg: "none" })}.${b64url(payload)}.sig`;
}

const digest = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 16);

const completed = (id: string) => ({
	type: "response.completed",
	response: { id, status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } },
});

function textEvents(id: string, text: string) {
	const item = `msg_${id}`;
	return [
		{ type: "response.created", response: { id } },
		{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: item, role: "assistant", content: [], status: "in_progress" } },
		{ type: "response.output_text.delta", item_id: item, output_index: 0, content_index: 0, delta: text },
		{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: item, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
		completed(id),
	];
}

type Post = { url: string; headers: Record<string, unknown>; body: Record<string, any>; symbols: symbol[] };

let root: string;
const posts: Post[] = [];
const fetches: string[] = [];
const savedFetch = globalThis.fetch;
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
const savedOffline = process.env.PI_OFFLINE;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-codex-providers-"));
	process.env.PI_CODING_AGENT_DIR = root;
	process.env.PI_OFFLINE = "1";
	const grant = { [CODEX_PROVIDER]: { type: "oauth", access: GRANT_TOKEN, refresh: "refresh-providers-1", expires: Date.now() + 3_600_000, accountId: ACCOUNT, last_refresh: Date.now() } };
	writeFileSync(join(root, "auth.json"), JSON.stringify({ anthropic: anthropicCredential, ...grant, openrouter: otherCredential }));
	globalThis.fetch = async (input: string | URL | Request) => { fetches.push(String(input)); throw new Error("Unexpected external network request in offline test"); };
});

after(async () => {
	globalThis.fetch = savedFetch;
	if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
	if (savedOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = savedOffline;
	await rm(root, { recursive: true, force: true });
});

/** Refused WebSocket upgrade (426): the Codex facade uses SSE only. */
const upgradeRefused = async (): Promise<never> => {
	throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
};

const postEvents = (options: { url: string; headers: Record<string, unknown>; body: Uint8Array; onResponse: (r: { status: number; headers: object }) => void }) => {
	posts.push({
		url: options.url,
		headers: options.headers,
		body: JSON.parse(zlib.zstdDecompressSync(Buffer.from(options.body)).toString("utf8")),
		symbols: Object.getOwnPropertySymbols(options.headers),
	});
	const events = textEvents(`resp_${posts.length}`, "Hi");
	return (async function* () {
		options.onResponse({ status: 200, headers: {} });
		for (const value of events) yield { text: JSON.stringify(value), value };
	})();
};

const fetchFake = async (input: string) => { fetches.push(String(input)); throw new Error("no network in this test"); };

const codexExtension = createCodexExtension({
	installationId: INSTALLATION,
	dependencies: { connect: upgradeRefused as never, postEvents: postEvents as never, fetch: fetchFake as never },
});

type Order = "providers-first" | "codex-first";
type Gate = { providers: boolean; codex: boolean };

/**
 * One real AgentSession with both extensions as factories. `gate` is read at every (re)load, so `session.reload()` after
 * flipping it loads exactly the enabled ones. Each session has its own ModelRuntime, same as Pi's SDK hosts.
 */
async function open(order: Order, gate: Gate = { providers: true, codex: true }) {
	const dir = await mkdtemp(join(root, "session-"));
	const runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
	await runtime.refresh({ allowNetwork: false });
	const providersFactory = ((pi: Parameters<typeof providers>[0]) => { if (gate.providers) providers(pi); }) as unknown as ExtensionFactory;
	const codexFactory = ((pi: Parameters<typeof codexExtension>[0]) => { if (gate.codex) codexExtension(pi); }) as unknown as ExtensionFactory;
	const factories = order === "providers-first" ? [providersFactory, codexFactory] : [codexFactory, providersFactory];
	const settings = () => SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", transport: "sse" });
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir: root, additionalExtensionPaths: [], extensionFactories: factories,
		settingsManager: settings(), noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	assert.equal(loader.getExtensions().extensions.length, 2, "exactly RQW-providers and RQW-codex are loaded");
	const model = runtime.getModels(CODEX_PROVIDER).find(m => m.id === "gpt-6.1-sol");
	assert.ok(model, "the offline catalogue has gpt-6.1-sol");
	const { session } = await createAgentSession({ cwd: dir, agentDir: root, modelRuntime: runtime, model, thinkingLevel: "off",
		resourceLoader: loader, sessionManager: SessionManager.inMemory(dir), settingsManager: settings() });
	const errors: string[] = [];
	await session.bindExtensions({ mode: "tui", onError: error => errors.push(error.error) });
	assert.deepEqual(errors, []);
	return { session, runtime, gate };
}

const ids = (runtime: ModelRuntime) => runtime.getProviders().map(provider => provider.id).sort();

/** One owned Codex turn through the fake connector: exactly one body, no top-level instructions, native credit flag. */
async function turn(session: AgentSession) {
	const before = posts.length;
	await session.prompt("hello");
	const last = session.messages[session.messages.length - 1] as { role: string; content: Array<{ type: string; text?: string }>; errorMessage?: string };
	assert.equal(last.role, "assistant");
	assert.equal(last.errorMessage, undefined, "no API key or other error");
	assert.equal(last.content.find(c => c.type === "text")?.text, "Hi");
	assert.equal(posts.length, before + 1, "exactly one body reaches the wire for this turn");
	const post = posts.at(-1)!;
	assert.equal(post.url.endsWith("/responses"), true);
	assert.equal(Object.hasOwn(post.body, "instructions"), false, "no top-level instructions");
	assert.equal(post.body.client_metadata?.guardian_credits_requested, "true", "native subscription credit flag");
	assert.deepEqual(post.symbols, [], "no symbol in the wire headers");
	assert.equal(JSON.stringify({ headers: post.headers, body: post.body }).includes(digest(GRANT_TOKEN)), false, "no provenance digest on the wire");
	assert.equal(JSON.stringify(post.body).includes(GRANT_TOKEN), false, "the bearer is not in the body");
	return post;
}

describe("RQW-providers with RQW-codex", () => {
	it("package manifest loads RQW-providers right before RQW-codex", () => {
		const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { pi: { extensions: string[] } };
		const at = manifest.pi.extensions.indexOf("./extensions/RQW-providers/index.ts");
		assert.ok(at >= 0, "RQW-providers is registered");
		assert.deepEqual(manifest.pi.extensions.slice(at, at + 2), ["./extensions/RQW-providers/index.ts", "./extensions/RQW-codex/index.ts"]);
	});

	for (const order of ["providers-first", "codex-first"] as const) {
		it(`${order}: only anthropic and openai-codex are listed, the owned Codex turn is one body, the saved grant is unchanged`, async () => {
			const grantBefore = readFileSync(join(root, "auth.json"), "utf8");
			const { session, runtime } = await open(order);
			try {
				assert.deepEqual(ids(runtime), KEPT);
				assert.equal(session.scopedModels.length, 0);
				await turn(session);
				assert.equal(fetches.length, 0, "no fetch");
				assert.equal(readFileSync(join(root, "auth.json"), "utf8"), grantBefore, "the saved grant is unchanged by the turn");
			} finally { session.dispose(); }
			assert.deepEqual(slots(), native, `${order}: Pi's own methods are back after dispose`);
		});

		it(`${order}: disabling RQW-codex and reloading keeps the hiding; disabling RQW-providers and reloading keeps the Codex transport and shows stock providers`, async () => {
			const { session, runtime, gate } = await open(order);
			try {
				await turn(session);
				// RQW-codex off, RQW-providers on: no Codex registration and no request is made; hiding stays active.
				gate.codex = false;
				await session.reload();
				assert.deepEqual(ids(runtime), KEPT, "the hiding still applies after Codex is disabled");
				assert.equal(runtime.getRegisteredProviderConfig(CODEX_PROVIDER), undefined, "no Codex-owned registration remains while Codex is off");
				const offPosts = posts.length;
				gate.codex = true;
				gate.providers = false;
				await session.reload();
				// Re-enabled Codex with the fake connector: the owned transport answers again, one body per turn.
				await turn(session);
				assert.equal(posts.length, offPosts + 1);
				// RQW-providers off: other stock providers are visible again, Codex still owns its transport.
				const visible = ids(runtime);
				assert.ok(visible.includes("openrouter"), "a stock provider is visible with RQW-providers off");
				assert.ok(visible.length > KEPT.length, "the full stock list is visible with RQW-providers off");
				assert.ok(visible.includes(CODEX_PROVIDER));
			} finally { session.dispose(); }
			assert.deepEqual(slots(), native, `${order}: Pi's own methods are back after dispose`);
		});

		it(`${order}: disposing one session keeps the other owned: its hiding and Codex turn survive`, async () => {
			const first = await open(order);
			const second = await open(order);
			try {
				await turn(second.session);
				first.session.dispose();
				assert.deepEqual(ids(second.runtime), KEPT, "the surviving owner keeps the hiding");
				assert.notEqual(slots()[1].value, native[1].value, "the surviving session keeps a wrapper in the binder slot");
				await turn(second.session);
			} finally { second.session.dispose(); }
			assert.deepEqual(slots(), native, `${order}: Pi's own methods are back after the last owner`);
		});
	}
});
