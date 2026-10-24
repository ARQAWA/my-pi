// Standard Pi compaction through the loaded Codex extension. All credentials and transport responses are fake.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { AgentSession, createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { installRuntimeAuth } from "../auth-runtime.ts";
import { createCodexExtension } from "../index.ts";
import { CODEX_PROVIDER } from "../profile.ts";
import { SocketError } from "../websocket.ts";

const SUMMARY = "STANDARD_PI_SUMMARY: preserve the original task and continue the work.";
const RESERVE = 10_000;
const METHODS = ["compact", "_runAutoCompaction", "_exceedsCompactionThreshold", "_checkCompaction", "_compactBeforeNextAssistantResponse", "getContextUsage"] as const;
type Session = Awaited<ReturnType<typeof createAgentSession>>["session"];
type Body = { input: Array<Record<string, any>>; [key: string]: any };
type Mode = "manual" | "threshold" | "overflow";
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function events(id: string, input: number, opaque: boolean) {
	const item = opaque
		? { type: "compaction", encrypted_content: "FAKE_OPAQUE_CHECKPOINT" }
		: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: SUMMARY, annotations: [] }] };
	return [
		{ type: "response.created", response: { id } },
		{ type: "response.output_item.done", output_index: 0, item },
		{ type: "response.completed", response: { id, status: "completed", usage: { input_tokens: input, output_tokens: 1, total_tokens: input + 1, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
	];
}

async function withSession(mode: Mode, run: (context: { session: Session; posts: Body[]; lifecycle: Array<Record<string, any>>; prototype: Map<string, PropertyDescriptor | undefined> }) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), "rqw-standard-compaction-"));
	const prototype = new Map(METHODS.map((name) => [name, Object.getOwnPropertyDescriptor(AgentSession.prototype, name)]));
	try {
		const store = new InMemoryCredentialStore();
		const exp = Math.floor(Date.now() / 1000) + 3600;
		await store.modify(CODEX_PROVIDER, async () => ({ type: "oauth", access: `${b64({ alg: "none" })}.${b64({ exp, "https://api.openai.com/auth": { chatgpt_account_id: "acct_fake_standard" } })}.sig`, refresh: "fake-refresh", expires: exp * 1000, accountId: "acct_fake_standard" }));
		const runtime = await ModelRuntime.create({ credentials: store, modelsPath: null, refreshOnCreate: false });
		const posts: Body[] = [];
		let window = 500_000;
		const postEvents = (options: any) => {
			const body = JSON.parse(zstdDecompressSync(Buffer.from(options.body)).toString("utf8")) as Body;
			posts.push(body);
			assert.ok(posts.length <= 6, "bounded fake backend requests");
			const id = `resp_standard_${posts.length}`;
			const opaque = body.input.at(-1)?.type === "compaction_trigger";
			const overflow = mode === "overflow" && posts.length === 1;
			const values = overflow ? [
				{ type: "response.created", response: { id } },
				{ type: "response.failed", response: { id, status: "failed", error: { type: "invalid_request_error", code: "context_length_exceeded", message: "Your input exceeds the context window of this model." } } },
			] : events(id, mode === "threshold" && posts.length === 1 ? window - RESERVE + 1 : 10, opaque);
			return (async function* () {
				options.onResponse({ status: 200, headers: {} });
				for (const value of values) yield { text: JSON.stringify(value), value };
			})();
		};
		const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: [createCodexExtension({ installationId: "11111111-2222-4333-8444-555555555555", agentDir: dir, dependencies: {
				connect: async () => { throw new SocketError(426, {}, "upgrade required", "upgrade-rejected"); },
				postEvents, fetch: async () => { throw new Error("real network forbidden"); }, sleep: async () => undefined,
			} })] });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert.equal(loader.getExtensions().extensions.length, 1, "the real Codex extension is loaded alone");
		const release = installRuntimeAuth(runtime);
		let session: Session | undefined;
		try {
			const model = runtime.getModels(CODEX_PROVIDER)[0]!;
			window = model.contextWindow;
			const manager = SessionManager.inMemory(dir);
			manager.appendMessage({ role: "user", content: "Original task to preserve.", timestamp: 1 });
			manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Earlier progress." }], api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: 2,
				usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
			({ session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model, thinkingLevel: "off", resourceLoader: loader, sessionManager: manager,
				settingsManager: SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: RESERVE, keepRecentTokens: 1 }, retry: { enabled: false }, transport: "sse" }) }));
			await session.bindExtensions({ mode: "tui" });
			await session.setModel(model);
			const lifecycle: Array<Record<string, any>> = [];
			const unsubscribe = session.subscribe((event) => lifecycle.push(event));
			try { await run({ session, posts, lifecycle, prototype }); }
			finally { unsubscribe(); }
		} finally {
			session?.dispose();
			release();
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function assertStandardContext(session: Session, posts: Body[]) {
	const compacted = session.sessionManager.getBranch().filter((entry) => entry.type === "compaction");
	assert.equal(compacted.length, 1, "first compaction must append one normal Pi compaction entry");
	assert.ok(compacted[0].summary.includes(SUMMARY), "Pi entry contains the generated text summary");
	const context = session.sessionManager.buildSessionContext();
	const summaries = context.messages.filter((message) => message.role === "compactionSummary");
	assert.equal(summaries.length, 1, "first compaction enters Pi's model-visible context");
	assert.ok(JSON.stringify(summaries[0]).includes(SUMMARY), "model-visible context contains the text summary");
	assert.equal(posts.some((body) => body.input.some((item) => item.type === "compaction_trigger")), false, "standard compaction never sends compaction_trigger");
	assert.equal(posts.some((body) => body.input.some((item) => item.type === "compaction")), false, "standard compaction never sends an opaque checkpoint");
}

describe("standard Pi compaction with the real loaded Codex extension", () => {
	for (const mode of ["manual", "threshold", "overflow"] as const) {
		it(`${mode}: first compaction writes a normal Pi entry and summary context without a backend trigger`, { timeout: 15_000 }, async () => {
			await withSession(mode, async ({ session, posts, lifecycle }) => {
				await session.prompt("Continue the original task.");
				if (mode === "manual") await session.compact();
				await session.waitForIdle();
				assertStandardContext(session, posts);
				assert.deepEqual(lifecycle.filter((event) => event.type === "compaction_start").map((event) => event.reason), [mode]);
				assert.deepEqual(lifecycle.filter((event) => event.type === "compaction_end").map((event) => [event.reason, event.aborted, event.willRetry]), [[mode, false, mode === "overflow"]]);
				await session.prompt("Continue after the summary.");
				assert.ok(JSON.stringify(posts.at(-1)!.input).includes(SUMMARY), "the next inference carries the standard text summary");
				assertStandardContext(session, posts);
			});
		});
	}

	it("leaves all six Pi compaction method descriptors and prototype functions untouched", async () => {
		await withSession("manual", async ({ session, prototype }) => {
			for (const name of METHODS) {
				assert.equal(Object.getOwnPropertyDescriptor(session, name), undefined, `${name} must stay inherited, not replaced on the session`);
				assert.deepEqual(Object.getOwnPropertyDescriptor(AgentSession.prototype, name), prototype.get(name), `${name} prototype descriptor must stay unchanged`);
				assert.equal(session[name], prototype.get(name)?.value, `${name} must remain Pi's original function`);
			}
		});
	});
});
