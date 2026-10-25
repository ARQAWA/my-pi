// Feasibility regression: partial-tool recovery through the real Pi AgentSession and the owned facade (index -> session ->
// CodexThreadTransport -> LiveResponsesPump -> decidePartialHandoff). Only this extension is loaded. The Codex backend is a
// fake postEvents (SSE); every step is recorded, and a request beyond the scripted steps fails the test. Fake OAuth JWT,
// temporary agent directory, injected zero sleep, no network, no auth homes.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { describe, it } from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { installRuntimeAuth } from "../../../extensions/RQW-codex/auth-runtime.ts";
import { createCodexExtension } from "../../../extensions/RQW-codex/index.ts";
import { CODEX_PROVIDER } from "../../../extensions/RQW-codex/profile.ts";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";

const ACCOUNT = "acct_partial_session_1";
const INSTALLATION = "11111111-2222-4333-8444-555555555555";
const SCENARIO_TIMEOUT_MS = 30_000;

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeAccess(): string {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return `${b64url({ alg: "none" })}.${b64url({ exp, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;
}

/** Refused WebSocket upgrade (426): the facade then uses SSE only. */
const upgradeRefused = async (): Promise<never> => {
	throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
};

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
const created = (id: string) => ({ type: "response.created", response: { id } });
const completed = (id: string) => ({ type: "response.completed", response: { id, status: "completed", usage } });
const callAdded = (index: number, id: string, callId: string, name: string) => ({
	type: "response.output_item.added", output_index: index, item: { type: "function_call", id, call_id: callId, name, arguments: "", status: "in_progress" },
});
const callDone = (index: number, id: string, callId: string, name: string, args: string) => ({
	type: "response.output_item.done", output_index: index, item: { type: "function_call", id, call_id: callId, name, arguments: args, status: "completed" },
});
const argsDelta = (index: number, id: string, delta: string) => ({ type: "response.function_call_arguments.delta", item_id: id, output_index: index, delta });

function textEvents(id: string, text: string) {
	const item = `msg_${id}`;
	return [
		created(id),
		{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: item, role: "assistant", content: [], status: "in_progress" } },
		{ type: "response.output_text.delta", item_id: item, output_index: 0, content_index: 0, delta: text },
		{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: item, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
		completed(id),
	];
}

/** One scripted backend generation: events in order, then an optional stream error thrown after them. */
type Step = { events: Array<Record<string, unknown>>; fail?: Error };

type Post = { url: string; body: Record<string, any> };

async function withSession(steps: Step[], run: (ctx: { session: Awaited<ReturnType<typeof createAgentSession>>["session"]; posts: Post[]; toolRuns: number[]; events: Array<Record<string, any>>; authPath: string; agentDir: string }) => Promise<void>, websocket = false) {
	const root = await mkdtemp(join(tmpdir(), "rqw-codex-partial-session-"));
	try {
		const agentDir = join(root, "agent");
		await mkdir(agentDir, { recursive: true });
		const exp = Math.floor(Date.now() / 1000) + 3600;
		const credential = { type: "oauth", access: fakeAccess(), refresh: "refresh-partial-1", expires: exp * 1000, accountId: ACCOUNT };
		const authPath = join(agentDir, "auth.json");
		await writeFile(authPath, JSON.stringify({ [CODEX_PROVIDER]: credential }));
		const runtime = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });

		const posts: Post[] = [];
		const toolRuns: number[] = [];
		const events: Array<Record<string, any>> = [];
		// WebSocket attempts share the scripted steps and the request counter with the SSE posts (one step per backend request).
		const scriptedSocket = async () => {
			let open = true;
			let step: Step | undefined;
			return {
				get isOpen() {
					return open;
				},
				socketIdentity: `ws-${posts.length + 1}`,
				events() {
					return (async function* () {
						for (const value of step?.events ?? []) yield { text: JSON.stringify(value), value };
						if (step?.fail) throw step.fail;
					})();
				},
				async send(object: Record<string, any>) {
					const { type: _type, client_metadata: _meta, ...body } = object;
					// The startup prewarm (generate:false) is not a sampling request: refused, so it consumes no scripted step.
					if (body.generate === false) throw new Error("startup prewarm refused in this scenario");
					posts.push({ url: "websocket", body });
					step = steps[posts.length - 1];
					if (step === undefined) throw new Error(`unscripted backend request #${posts.length}`);
				},
				async interrupt() {
					throw new Error("unexpected interrupt");
				},
				async close() {
					open = false;
				},
			};
		};
		const postEvents = (options: { url: string; headers: Record<string, string>; body: Uint8Array; onResponse: (r: { status: number; headers: object }) => void }) => {
			const body = JSON.parse(zlib.zstdDecompressSync(Buffer.from(options.body)).toString("utf8")) as Record<string, any>;
			posts.push({ url: options.url, body });
			const step = steps[posts.length - 1];
			if (step === undefined) throw new Error(`unscripted backend request #${posts.length}`);
			return (async function* () {
				options.onResponse({ status: 200, headers: {} });
				for (const value of step.events) yield { text: JSON.stringify(value), value };
				if (step.fail) throw step.fail;
			})();
		};

		const count: ToolDefinition = {
			name: "count",
			label: "count",
			description: "Counts one item.",
			parameters: Type.Object({ n: Type.Number() }),
			async execute(_id, args) {
				toolRuns.push(args.n);
				return { content: [{ type: "text", text: `counted ${args.n}` }], details: {} };
			},
		} as unknown as ToolDefinition;

		const loader = new DefaultResourceLoader({
			cwd: agentDir, agentDir, additionalExtensionPaths: [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
			extensionFactories: [createCodexExtension({
				installationId: INSTALLATION,
				dependencies: { connect: (websocket ? scriptedSocket : upgradeRefused) as never, postEvents: postEvents as never, sleep: async () => undefined, clock: { now: () => Date.now() } },
			})],
		});
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert.equal(loader.getExtensions().extensions.length, 1, "exactly the RQW-codex extension is loaded");

		const release = installRuntimeAuth(runtime);
		try {
			const model = runtime.getModels(CODEX_PROVIDER)[0]!;
			const { session } = await createAgentSession({ cwd: agentDir, agentDir, modelRuntime: runtime, model, thinkingLevel: "off",
				resourceLoader: loader, customTools: [count], sessionManager: SessionManager.inMemory(agentDir),
				settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" }) });
			await session.bindExtensions({ mode: "tui" });
			const unsubscribe = session.subscribe((event) => { events.push(event as Record<string, any>); });
			try {
				await run({ session, posts, toolRuns, events, authPath, agentDir });
			} finally {
				unsubscribe();
				session.dispose();
			}
		} finally {
			release();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("partial-tool recovery through the real AgentSession", () => {
	it("completed call runs once, is paired before the resubmission, unfinished call never runs, final text is normal", { timeout: SCENARIO_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{
				events: [
					created("resp_real_1"),
					callAdded(0, "fc_1", "call_1", "count"),
					callDone(0, "fc_1", "call_1", "count", '{ "n": 1 }'),
					callAdded(1, "fc_2", "call_2", "never"),
					argsDelta(1, "fc_2", '{"n"'),
				],
				fail: new Error("stream dropped after the completed call"),
			},
			{ events: textEvents("resp_real_2", "Counted once.") },
		];
		await withSession(steps, async ({ session, posts, toolRuns, events }) => {
			await session.prompt("count the items");

			assert.deepEqual(toolRuns, [1], "count executed exactly once; the unfinished call never executed");
			assert.equal(posts.length, 2, "exactly one recovered backend request after the handoff, no retry");

			const input = posts[1]!.body.input as Array<Record<string, any>>;
			const call1 = input.filter((item) => item.call_id === "call_1").map((item) => item.type);
			assert.deepEqual(call1, ["function_call", "function_call_output"], "completed call is paired before the resubmission");
			const raw = input.find((item) => item.type === "function_call" && item.call_id === "call_1");
			assert.equal(raw?.id, "fc_1");
			assert.equal(raw?.arguments, '{ "n": 1 }', "raw completed arguments are replayed exactly");
			assert.equal(JSON.stringify(input).includes("call_2"), false, "unfinished call absent from the resubmission");

			const last = session.messages[session.messages.length - 1] as { role: string; stopReason?: string; content: Array<{ type: string; text?: string }> };
			assert.equal(last.role, "assistant");
			assert.equal(last.stopReason, "stop");
			assert.equal(last.content.find((c) => c.type === "text")?.text, "Counted once.");

			const samplings = events.filter((e) => e.type === "message_end" && e.message?.role === "assistant");
			assert.equal(samplings.length, 2, "one outer assistant end per sampling");
			const starts = events.filter((e) => e.type === "tool_execution_start" && e.toolName === "count");
			assert.equal(starts.length, 1, "one live tool execution event");
			assert.equal(events.some((e) => e.type === "auto_retry_start"), false, "no Pi retry overlaps the handoff");
		});
	});

	it("quota after a completed call: count runs once, the final error comes without a second backend query", { timeout: SCENARIO_TIMEOUT_MS }, async () => {
		const steps: Step[] = [
			{
				events: [
					created("resp_quota_1"),
					callAdded(0, "fc_1", "call_1", "count"),
					callDone(0, "fc_1", "call_1", "count", '{ "n": 1 }'),
					{ type: "response.failed", response: { id: "resp_quota_1", status: "failed", error: { type: "invalid_request_error", code: "insufficient_quota", message: "You exceeded your current quota." } } },
				],
			},
		];
		await withSession(steps, async ({ session, posts, toolRuns }) => {
			await session.prompt("count the items");

			assert.deepEqual(toolRuns, [1], "count executed exactly once");
			assert.equal(posts.length, 1, "no second backend query after the quota error");
			const last = session.messages[session.messages.length - 1] as { role: string; stopReason?: string; errorMessage?: string };
			assert.equal(last.role, "assistant");
			assert.equal(last.stopReason, "error");
			assert.match(last.errorMessage ?? "", /quota/i);
		});
	});

	it("WebSocket partial handoff, then started stream errors exhaust the native budget: 6 WebSocket + 6 SSE requests, no fresh budget", { timeout: SCENARIO_TIMEOUT_MS }, async () => {
		const streamError = (id: string) => [created(id), { type: "error", error: { type: "server_error", message: "upstream stream error" } }];
		const steps: Step[] = [
			{
				events: [
					created("resp_budget_1"),
					callAdded(0, "fc_1", "call_1", "count"),
					callDone(0, "fc_1", "call_1", "count", '{ "n": 1 }'),
					callAdded(1, "fc_2", "call_2", "never"),
					argsDelta(1, "fc_2", '{"n"'),
				],
				fail: new Error("stream dropped after the completed call"),
			},
			// Five WebSocket retries (native streamMaxRetries), each a started stream error.
			...Array.from({ length: 5 }, (_, i) => ({ events: streamError(`resp_budget_ws_${i + 2}`) })),
			// Sticky SSE fallback: initial request plus five retries, then the budget is spent.
			...Array.from({ length: 6 }, (_, i) => ({ events: streamError(`resp_budget_sse_${i + 1}`) })),
		];
		await withSession(steps, async ({ session, posts, toolRuns }) => {
			await session.prompt("count the items");

			assert.equal(posts.length, 12, "exactly 12 sampling requests: WebSocket initial + 5 retries, SSE initial + 5 retries");
			assert.equal(posts.filter((p) => p.url === "websocket").length, 6, "six WebSocket requests");
			assert.equal(posts.filter((p) => p.url !== "websocket").length, 6, "six SSE requests after the sticky fallback");
			assert.deepEqual(toolRuns, [1], "completed call executed exactly once; the unfinished call never executed");

			for (const post of posts.slice(1)) {
				const input = post.body.input as Array<Record<string, any>>;
				const paired = input.filter((item) => item.call_id === "call_1").map((item) => item.type);
				assert.deepEqual(paired, ["function_call", "function_call_output"], "completed call paired in every resubmission");
				assert.equal(JSON.stringify(input).includes("call_2"), false, "unfinished call absent from every resubmission");
			}

			// The partial handoff keeps the completed call and reports the open one as unfinished (never executed).
			const diagnostics = session.messages.flatMap((m) => (m as { diagnostics?: Array<{ type: string; details?: { completedCalls?: number } }> }).diagnostics ?? []);
			assert.equal(diagnostics.find((d) => d.type === "rqw_codex_partial_handoff")?.details?.completedCalls, 1);
			const last = session.messages[session.messages.length - 1] as { role: string; stopReason?: string; errorMessage?: string };
			assert.equal(last.role, "assistant");
			assert.equal(last.stopReason, "error", "budget exhausted: the last stream error is final");
			assert.match(last.errorMessage ?? "", /stream disconnected before completion/);
		}, true);
	});

});
