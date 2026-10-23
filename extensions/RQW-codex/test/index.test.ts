// Stage 3 entrypoint tests: installation id file (temp dirs only) and the owned facade through the real Pi 1.4.0
// session. The codex extension is loaded alone through createCodexExtension; the real CodexThreadTransport runs with
// injected connect (refused, so no WebSocket) and postEvents (fake SSE). Fake OAuth JWT in a temporary agent dir.
// No network, no ~/.pi access: every agent directory is a temporary directory and the installation id is injected.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { after, before, describe, it } from "node:test";
import { ModelRuntime, createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

import { SocketError } from "../websocket.ts";
import { assertSupportedPi, createCodexExtension, resolveInstallationId, INSTALLATION_ID_FILE } from "../index.ts";
import { CODEX_PROVIDER } from "../profile.ts";
import { newInstallationId } from "../metadata.ts";

const ACCOUNT = "acct_index_test_1";
const INSTALLATION = "11111111-2222-4333-8444-555555555555";

let root: string;
before(async () => { root = await mkdtemp(join(tmpdir(), "rqw-codex-index-")); });
after(async () => { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

describe("Pi version guard", () => {
	it("an unsupported Pi version is refused before the installation id file is written", () => {
		const dir = join(root, "unsupported-pi");
		assert.throws(() => createCodexExtension({ piVersion: "1.3.0", agentDir: dir })({} as never), /requires Pi 1.4.0/);
		assert.equal(existsSync(dir), false, "no agent directory and no id file were created");
		assert.throws(() => assertSupportedPi("1.4.1"), /Nothing was written or registered/);
		assert.doesNotThrow(() => assertSupportedPi("1.4.0"));
	});
});

describe("installation id file", () => {
	it("creates a UUIDv4 with mode 0600 and returns the same id on the next call", async () => {
		const dir = join(root, "fresh");
		const first = resolveInstallationId(dir);
		assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.equal(resolveInstallationId(dir), first);
		// POSIX mode bits only: Windows Node fs cannot report or set them.
		if (process.platform !== "win32") assert.equal((await stat(join(dir, INSTALLATION_ID_FILE))).mode & 0o777, 0o600);
		assert.equal(await readFile(join(dir, INSTALLATION_ID_FILE), "utf8"), first);
	});

	it("preserves a stored valid id", async () => {
		const dir = join(root, "valid");
		await mkdir(dir, { recursive: true });
		const stored = newInstallationId();
		await writeFile(join(dir, INSTALLATION_ID_FILE), `${stored}\n`);
		assert.equal(resolveInstallationId(dir), stored);
		assert.equal(await readFile(join(dir, INSTALLATION_ID_FILE), "utf8"), `${stored}\n`);
	});

	it("fails on an invalid stored id without overwriting it", async () => {
		const dir = join(root, "invalid");
		await mkdir(dir, { recursive: true });
		for (const bad of ["not-a-uuid", "11111111-2222-1333-8444-555555555555"]) {
			await writeFile(join(dir, INSTALLATION_ID_FILE), bad);
			assert.throws(() => resolveInstallationId(dir), /does not hold a valid UUIDv4\. It was not overwritten/);
			assert.equal(await readFile(join(dir, INSTALLATION_ID_FILE), "utf8"), bad);
		}
	});
});

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeAccess(): string {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return `${b64url({ alg: "none" })}.${b64url({ exp, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;
}

/** Refused WebSocket upgrade (426): the facade then uses SSE only, and prewarm never posts. */
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

type Post = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

/** The turn metadata blob: header on SSE, or inside client_metadata. */
function turnBlob(post: Post): Record<string, unknown> | undefined {
	const meta = post.body.client_metadata as Record<string, string> | undefined;
	const raw = post.headers["x-codex-turn-metadata"] ?? meta?.["x-codex-turn-metadata"];
	return raw === undefined ? undefined : JSON.parse(raw);
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("owned facade through the real session", () => {
	it("loads only RQW-codex, sends no startup request, and the first turn goes through the native facade", async () => {
		const agentDir = join(root, "facade");
		await mkdir(agentDir, { recursive: true });
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const credential = { type: "oauth", access: fakeAccess(), refresh: "refresh-index-1", expires: exp * 1000, accountId: ACCOUNT };
		await writeFile(join(agentDir, "auth.json"), JSON.stringify({ [CODEX_PROVIDER]: credential }));
		const grantBefore = await readFile(join(agentDir, "auth.json"), "utf8");
		const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });

		const posts: Post[] = [];
		const fetches: string[] = [];
		const fetchFake = async (input: string) => {
			fetches.push(String(input));
			throw new Error("no network in this test");
		};
		const postEvents = (options: { url: string; headers: Record<string, string>; body: Uint8Array; onResponse: (r: { status: number; headers: object }) => void }) => {
			posts.push({ url: options.url, headers: options.headers, body: JSON.parse(zlib.zstdDecompressSync(Buffer.from(options.body)).toString("utf8")) });
			const step = { events: textEvents(`resp_${posts.length}`, "Hi") };
			return (async function* () {
				options.onResponse({ status: 200, headers: {} });
				for (const value of step.events) yield { text: JSON.stringify(value), value };
			})();
		};

		const loader = new DefaultResourceLoader({
			cwd: agentDir, agentDir, additionalExtensionPaths: [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: [createCodexExtension({
				installationId: INSTALLATION,
				dependencies: { connect: upgradeRefused as never, postEvents: postEvents as never, fetch: fetchFake as never },
			})],
		});
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert.equal(loader.getExtensions().extensions.length, 1, "exactly the RQW-codex extension is loaded");

		const model = runtime.getModels(CODEX_PROVIDER)[0]!;
		const { session } = await createAgentSession({ cwd: agentDir, agentDir, modelRuntime: runtime, model, thinkingLevel: "off",
			resourceLoader: loader, sessionManager: SessionManager.inMemory(agentDir),
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" }) });
		await session.bindExtensions({ mode: "tui" });
		try {
			await new Promise((resolve) => setTimeout(resolve, 20));
			assert.equal(posts.length, 0, "no startup request: the first turn is the first POST");
			assert.equal(fetches.length, 0, "no /models or other fetch");

			await session.prompt("hello");
			const last = session.messages[session.messages.length - 1] as { role: string; content: Array<{ type: string; text?: string }> };
			assert.equal(last.role, "assistant");
			assert.equal(last.content.find((c) => c.type === "text")?.text, "Hi");
			assert.equal(posts.length, 1);
			assert.equal(posts[0]!.url.endsWith("/responses"), true);
			assert.equal(posts[0]!.body.model, model.id);
			assert.notEqual(posts[0]!.body.generate, false, "the turn is a real generation");
			assert.ok(JSON.stringify({ headers: posts[0]!.headers, body: posts[0]!.body }).includes(INSTALLATION), "the stored installation id reaches the native metadata");
			assert.equal(await readFile(join(agentDir, "auth.json"), "utf8"), grantBefore, "a valid grant is untouched by a turn");

			// A request without a session id is served by its own request-local transport; the session's turn is unaffected.
			await runtime.streamSimple(model, { messages: [{ role: "user", content: "direct", timestamp: Date.now() }] } as never, {} as never).result();
			assert.equal(posts.length, 2, "the sessionless request is one more POST, on its own transport");
			assert.equal(await readFile(join(agentDir, "auth.json"), "utf8"), grantBefore);

			// Native window shape: header and blob window_id are `${thread}:0`; the context window id is a separate UUIDv7.
			const direct = posts[1]!;
			const directThread = direct.headers["thread-id"];
			assert.match(directThread ?? "", UUID_V7);
			assert.equal(direct.headers["x-codex-window-id"], `${directThread}:0`, "header window id is thread:0");
			const directBlob = turnBlob(direct);
			assert.ok(directBlob, "the direct request carries the turn metadata blob");
			assert.equal(directBlob.window_id, `${directThread}:0`);
			assert.equal(directBlob.window_number, 0);
			assert.match(String(directBlob.context_window_id), UUID_V7, "context window id is a bare UUIDv7");
			assert.notEqual(directBlob.context_window_id, directThread, "context window id is not the thread id");

			await runtime.streamSimple(model, { messages: [{ role: "user", content: "direct again", timestamp: Date.now() }] } as never, {} as never).result();
			const again = posts[2]!;
			assert.notEqual(again.headers["thread-id"], directThread, "each sessionless request is its own thread");
			assert.notEqual(turnBlob(again)?.context_window_id, directBlob.context_window_id, "each sessionless request has a distinct context window id");

			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" } as never);
			assert.equal(runtime.getRegisteredProviderConfig(CODEX_PROVIDER), undefined, "session_shutdown releases the owner and its provider");
			assert.equal(await readFile(join(agentDir, "auth.json"), "utf8"), grantBefore, "the grant survives the release");
		} finally {
			session.dispose();
		}
	});
});
