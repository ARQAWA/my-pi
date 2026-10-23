// Package-level interop: the actual RQW-models extension and the actual RQW-codex factory load together in one real Pi 1.4.0
// session. Only these two extensions are loaded here; each extension's own tests load it alone. Fake OAuth grant in a temporary
// agent directory, fake connect (refused upgrade) and fake postEvents (SSE), a fetch stub that throws. No external network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { after, it } from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

import modelsExtension, { isListed } from "../extensions/RQW-models/index.ts";
import { createCodexExtension } from "../extensions/RQW-codex/index.ts";
import { CODEX_AUTH_ORIGIN } from "../extensions/RQW-codex/auth-runtime.ts";
import { SocketError } from "../extensions/RQW-codex/websocket.ts";
import { CODEX_PROVIDER } from "../extensions/RQW-codex/profile.ts";

process.env.PI_OFFLINE = "1";

const ACCOUNT = "acct_codex_models_1";
const INSTALLATION = "11111111-2222-4333-8444-555555555555";
const GRANT_TOKEN = jwt({ exp: Math.floor(Date.now() / 1000) + 3600, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } });
const dirs: string[] = [];

after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwt(payload: Record<string, unknown>): string {
	return `${b64url({ alg: "none" })}.${b64url(payload)}.sig`;
}

const digest = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 16);

/** Refused WebSocket upgrade (426): the facade uses SSE only. */
const upgradeRefused = async (): Promise<never> => {
	throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
};

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

type Post = { url: string; headers: Record<string, unknown>; body: Record<string, unknown>; symbols: symbol[] };

it("RQW-models and RQW-codex together: the owned Codex turn succeeds with one body, an unchanged grant, and no provenance on the wire", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "rqw-codex-models-"));
	dirs.push(agentDir);
	const authPath = join(agentDir, "auth.json");
	writeFileSync(authPath, JSON.stringify({ [CODEX_PROVIDER]: { type: "oauth", access: GRANT_TOKEN, refresh: "refresh-models-1", expires: Date.now() + 3_600_000, accountId: ACCOUNT, last_refresh: Date.now() } }));
	const grantBefore = readFileSync(authPath, "utf8");
	const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
	const model = runtime.getModels(CODEX_PROVIDER).find((m) => isListed(m));
	assert.ok(model, "the offline catalogue has a listed Codex model");

	const posts: Post[] = [];
	const fetches: string[] = [];
	const fetchFake = async (input: string) => { fetches.push(String(input)); throw new Error("no network in this test"); };
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

	// The actual RQW-models entrypoint (Opus default, model guard, masks) and the actual RQW-codex factory.
	const factories: ExtensionFactory[] = [
		modelsExtension as unknown as ExtensionFactory,
		createCodexExtension({
			installationId: INSTALLATION,
			agentDir,
			dependencies: { connect: upgradeRefused as never, postEvents: postEvents as never, fetch: fetchFake as never },
		}),
	];
	const loader = new DefaultResourceLoader({
		cwd: agentDir, agentDir, additionalExtensionPaths: [], extensionFactories: factories,
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", transport: "sse" }),
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	assert.equal(loader.getExtensions().extensions.length, 2, "exactly RQW-models and RQW-codex are loaded");

	// Explicit Codex model intent: Opus startup does not take over (no Anthropic grant exists in this test).
	const argv = process.argv;
	process.argv = [...argv.slice(0, 2), "--model", `${CODEX_PROVIDER}/${model.id}`];
	const { session } = await createAgentSession({
		cwd: agentDir, agentDir, modelRuntime: runtime, model, thinkingLevel: "off", resourceLoader: loader,
		sessionManager: SessionManager.inMemory(agentDir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", transport: "sse" }),
	});
	const errors: string[] = [];
	try {
		await session.bindExtensions({ mode: "tui", onError: (error) => errors.push(error.error) });
		assert.deepEqual(errors, []);
		assert.equal(session.model?.id, model.id, "the explicit Codex model is kept; Opus does not take over");

		// The own prepareRequest may be RQW-codex's cooperative layer; the RQW-models mask is reached through its inner links.
		const top = Object.getOwnPropertyDescriptor(runtime, "prepareRequest")?.value as ((...args: unknown[]) => unknown) | undefined;
		assert.ok(top, "the session runtime has an own prepareRequest");
		const layers: Array<(...args: unknown[]) => unknown> = [];
		for (let fn: unknown = top; typeof fn === "function" && layers.length < 64; fn = (fn as Record<symbol, unknown>)[Symbol.for("rqw:method-inner")]) layers.push(fn as (...args: unknown[]) => unknown);
		const masked = layers.find(fn => /RQW-models refused the request/.test(Function.prototype.toString.call(fn)));
		assert.ok(masked, "RQW-models masks prepareRequest on the session runtime, below any cooperative owned layer");

		// Model guard still active: an unlisted model is refused before any auth or wire work.
		const unlisted = { ...model, id: "gpt-5.3-codex-spark" } as typeof model;
		await assert.rejects(runtime.prepareRequest(unlisted, {}), /RQW-models refused the request/);
		assert.equal(posts.length, 0);

		await session.prompt("hello");
		const last = session.messages[session.messages.length - 1] as { role: string; content: Array<{ type: string; text?: string }>; errorMessage?: string };
		assert.equal(last.role, "assistant");
		assert.equal(last.errorMessage, undefined, "no API key or other error");
		assert.equal(last.content.find((c) => c.type === "text")?.text, "Hi");

		assert.equal(posts.length, 1, "exactly one body reaches the wire");
		assert.equal(fetches.length, 0, "no fetch");
		assert.equal(posts[0]!.url.endsWith("/responses"), true);
		assert.equal(posts[0]!.body.model, model.id);
		assert.deepEqual(posts[0]!.symbols, [], "no symbol in the wire headers");
		assert.equal(JSON.stringify({ headers: posts[0]!.headers, body: posts[0]!.body }).includes(digest(GRANT_TOKEN)), false, "no provenance digest on the wire");
		assert.equal(JSON.stringify({ headers: posts[0]!.headers, body: posts[0]!.body }).includes(CODEX_AUTH_ORIGIN.description!), false, "no raw symbol name on the wire");
		assert.equal(JSON.stringify(posts[0]!.body).includes(GRANT_TOKEN), false, "the bearer is not in the body");
		assert.equal(readFileSync(authPath, "utf8"), grantBefore, "the saved grant is unchanged by the turn");
	} finally {
		process.argv = argv;
		session.dispose();
	}
});
