// Real stock Pi compaction with native Pi retry enabled; every credential and response is fake.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage } from "@earendil-works/pi-ai";
import { AgentSession, createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createCodexExtension } from "../../../extensions/RQW-codex/index.ts";
import { CODEX_RETRY_OWNED_DIAGNOSTIC } from "../../../extensions/RQW-codex/retry.ts";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";

const SUMMARY = "Keep the original task and earlier progress.";
const SERVER_ERROR = "We're currently experiencing high demand, which may cause temporary errors.";
const USAGE = { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const DIAGNOSTIC = { type: CODEX_RETRY_OWNED_DIAGNOSTIC, timestamp: 0 };
type Session = Awaited<ReturnType<typeof createAgentSession>>["session"];

async function withSession(fail: boolean, split: boolean, run: (fixture: {
	session: Session; store: InMemoryCredentialStore; posts: Record<string, any>[];
	calls: { provider: number; payload: number; response: number; event: number }; events: any[];
}) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), "rqw-summary-retry-budget-"));
	let session: Session | undefined;
	try {
		const store = new InMemoryCredentialStore();
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
		await store.modify("openai-codex", async () => ({ type: "oauth", access: `${b64({ alg: "none" })}.${b64({ exp, "https://api.openai.com/auth": { chatgpt_account_id: "acct_fake_retry_budget" } })}.sig`, refresh: "fake-refresh", expires: exp * 1000, accountId: "acct_fake_retry_budget" }));
		const runtime = await ModelRuntime.create({ credentials: store, modelsPath: null, refreshOnCreate: false });
		const posts: Record<string, any>[] = [];
		const calls = { provider: 0, payload: 0, response: 0, event: 0 };
		const resources = new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: [createCodexExtension({ installationId: "11111111-2222-4333-8444-555555555555", agentDir: dir, dependencies: {
				connect: async () => { throw new SocketError(426, {}, "upgrade required", "upgrade-rejected"); },
				collectWorkspaceMetadata: async () => ({}), sleep: async () => {}, random: () => 0.5,
				fetch: async (_url, init) => {
					assert.equal(init.method, "POST");
					posts.push(JSON.parse(zstdDecompressSync(Buffer.from(init.body as Uint8Array)).toString("utf8")));
					assert.ok(posts.length <= 90, "fake backend must remain bounded even with the audited defect");
					if (fail) return new Response("", { status: 500 });
					const id = `resp_summary_${posts.length}`;
					const values = [
						{ type: "response.created", response: { id } },
						{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: SUMMARY, annotations: [] }] } },
						{ type: "response.completed", response: { id, status: "completed", usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } } },
					];
					return new Response(values.map(value => `data: ${JSON.stringify(value)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
				},
			} })] });
		await resources.reload();
		assert.deepEqual(resources.getExtensions().errors, []);
		assert.equal(resources.getExtensions().extensions.length, 1);
		const model = runtime.getModels("openai-codex")[0]!;
		const manager = SessionManager.inMemory(dir);
		manager.appendMessage({ role: "user", content: "Original task", timestamp: 1 });
		manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Earlier progress" }], api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: 2, usage: USAGE });
		if (!split) manager.appendMessage({ role: "user", content: "Keep this tail", timestamp: 3 });
		({ session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model, thinkingLevel: "off", resourceLoader: resources, sessionManager: manager,
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: 10_000, keepRecentTokens: 1 }, retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 }, transport: "sse", cacheWarming: "off" }) }));
		await session.bindExtensions({ mode: "tui" });
		const stream = session.agent.streamFunction;
		session.agent.streamFunction = (...args) => { calls.provider++; return stream(...args); };
		session.agent.onPayload = () => { calls.payload++; };
		session.agent.onResponse = () => { calls.response++; };
		session.agent.onProviderStreamEvent = () => { calls.event++; };
		const events: any[] = [];
		session.subscribe(event => events.push(event));
		await run({ session, store, posts, calls, events });
	} finally {
		session?.dispose();
		await rm(dir, { recursive: true, force: true });
	}
}

for (const split of [false, true]) {
	it(`stock ${split ? "turn prefix" : "history"} summary exhausts native HTTP/stream retries once, not Pi's outer budget`, async () => {
		await withSession(true, split, async ({ session, posts, calls, events }) => {
			const original = session.agent.streamFunction;
			const label = split ? "Turn prefix summarization" : "Summarization";
			await assert.rejects(session.compact(), error => {
				assert.equal((error as Error).message, `${label} failed: ${SERVER_ERROR}`);
				return true;
			});
			assert.equal(posts.length, 30, "six native stream attempts, each with five HTTP attempts");
			assert.deepEqual(calls, { provider: 1, payload: 1, response: 30, event: 0 });
			assert.equal(events.filter(event => event.type.startsWith("summarization_retry_")).length, 0);
			assert.equal(session.sessionManager.getBranch().filter(entry => entry.type === "compaction").length, 0);
			const end = events.filter(event => event.type === "compaction_end");
			assert.equal(end.length, 1);
			assert.equal(end[0].errorMessage, `Compaction failed: ${label} failed: ${SERVER_ERROR}`);
			assert.equal(end[0].aborted, false);
			assert.equal(session.agent.streamFunction, original, "failed compaction restores the caller's stream function");
		});
	});
}

it("successful stock compaction still writes Pi's summary with native Pi retry enabled", async () => {
	await withSession(false, false, async ({ session, posts, calls, events }) => {
		const original = session.agent.streamFunction;
		const compact = session.compact;
		const result = await session.compact();
		assert.ok(result.summary.includes(SUMMARY));
		assert.equal(posts.length, 1);
		assert.deepEqual(calls, { provider: 1, payload: 1, response: 1, event: 3 });
		assert.equal(session.sessionManager.getBranch().filter(entry => entry.type === "compaction").length, 1);
		assert.ok(JSON.stringify(session.sessionManager.buildSessionContext()).includes(SUMMARY));
		assert.equal(posts[0].input.some((item: any) => item.type === "compaction_trigger" || item.type === "compaction"), false);
		assert.equal(session.compact, compact);
		assert.equal(session.compact, AgentSession.prototype.compact);
		assert.equal(session.agent.streamFunction, original);
		assert.equal(events.filter(event => event.type.startsWith("summarization_retry_")).length, 0);
	});
});

for (const control of ["other provider", "unmarked Codex error", "other Codex API"] as const) {
	it(`stock compaction keeps Pi retries for ${control}`, async () => {
		await withSession(false, false, async ({ session, store, posts, events }) => {
			if (control === "other provider") {
				await store.modify("openai", async () => ({ type: "api_key", key: "fake-openai-key" }));
				await session.setModel(session.modelRuntime.getModels("openai")[0]!);
			} else if (control === "other Codex API") {
				await session.setModel({ ...session.model!, api: "openai-responses" });
			}
			let calls = 0;
			const fakeStream: typeof session.agent.streamFunction = (model) => {
				const failed = ++calls < 3;
				const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), usage: USAGE,
					content: failed ? [] : [{ type: "text", text: SUMMARY }], stopReason: failed ? "error" : "stop",
					...(failed ? { errorMessage: "HTTP 500", diagnostics: control === "unmarked Codex error" ? [] : [DIAGNOSTIC] } : {}) };
				const stream = createAssistantMessageEventStream();
				stream.push(failed ? { type: "error", reason: "error", error: message } : { type: "done", reason: "stop", message });
				stream.end();
				return stream;
			};
			session.agent.streamFunction = fakeStream;
			const result = await session.compact();
			assert.ok(result.summary.includes(SUMMARY));
			assert.equal(calls, 3);
			assert.equal(events.filter(event => event.type === "summarization_retry_scheduled").length, 2);
			assert.equal(events.filter(event => event.type === "summarization_retry_attempt_start").length, 2);
			assert.equal(events.filter(event => event.type === "summarization_retry_finished").length, 1);
			assert.equal(session.sessionManager.getBranch().filter(entry => entry.type === "compaction").length, 1);
			assert.equal(posts.length, 0, "the stock retry controls never use a network provider");
			assert.equal(session.agent.streamFunction, fakeStream);
		});
	});
}
