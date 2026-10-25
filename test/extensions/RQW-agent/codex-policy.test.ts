// The optional `rqw-codex:session-policy` request of RQW-agent, in real Pi sessions: this test loads only RQW-agent. A
// stand-in listener on the main session's `pi.events` plays the RQW-codex binder: it records each request, refuses it
// or sets `release`. Children run on the real anthropic provider with fake credentials; only the network is replaced.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
	createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const EXTENSION = join(import.meta.dirname, "../../../extensions/RQW-agent/index.ts");
const sse = (events: object[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const start = { type: "message_start", message: { id: "a", model: "claude", usage: { input_tokens: 5, output_tokens: 0 } } };
const end = [
	{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
	{ type: "message_stop" },
];
const answer = sse([
	start,
	{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
	{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
	{ type: "content_block_stop", index: 0 },
	...end,
]);
/** The child starts an ordinary agent: the nested child of the test. */
const callAgent = sse([
	start,
	{ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu1", name: "agent", input: {} } },
	{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"action":"start","system":"INNER","task":"nested","model":"anthropic/claude-opus-5-5","tools":[]}' } },
	{ type: "content_block_stop", index: 0 },
	{ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 2 } },
	{ type: "message_stop" },
]);

let root: string;
let counter = 0;
const wire: { url: string; body: Record<string, any> }[] = [];
const realFetch = globalThis.fetch;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-agent-policy-"));
	// Only a child whose prompt says NESTED calls agent, and only before the tool result comes back.
	globalThis.fetch = async (input, init) => {
		const body = JSON.parse(String(init?.body));
		wire.push({ url: String(input), body });
		const nested = JSON.stringify(body.system ?? "").includes("NESTED") && !JSON.stringify(body.messages).includes("tool_result");
		return new Response(nested ? callAgent : answer, { headers: { "content-type": "text/event-stream" } });
	};
});
after(async () => { globalThis.fetch = realFetch; await rm(root, { recursive: true, force: true }); });

/** The system text of a Anthropic request as the provider received it: one entry per system block. */
const systemOf = (body: Record<string, any>): string[] => (typeof body.system === "string" ? [body.system] : (body.system ?? []).map((b: { text: string }) => b.text));

const until = async (check: () => boolean, what: string) => {
	const deadline = Date.now() + 60_000;
	while (!check()) {
		assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
};

type Request = { session: AgentSession; parentThreadId: string; kind: string; installCompactionHooks?: (api: ExtensionAPI) => void; release?: () => void; error?: string };
type Seen = { request: Request; wireAtEmit: number; messagesAtEmit: number };
type Capture = { callerThreadId?: string; wireAtCapture: number };

/** A main session with RQW-agent loaded; the binder stand-in records requests and follows `policy`. */
async function open(binder: boolean) {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-api03-fake" } }));
	const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	await runtime.refresh({ allowNetwork: false });
	const main = fauxProvider({ provider: `policy-main-${counter}`, api: `policy-main-${counter}`, models: [{ id: "m", reasoning: true }] });
	main.setResponses(Array.from({ length: 20 }, () => () => fauxAssistantMessage("main ok")));
	runtime.registerNativeProvider(main.provider);
	const seen: Seen[] = [];
	const policy = { error: undefined as string | undefined, hookError: undefined as string | undefined, releases: 0 };
	const hookInstalls: Array<{ session: AgentSession; wireAtInstall: number }> = [];
	const hookContexts: string[] = [];
	const captures: Capture[] = [];
	const binderStandIn = (pi: ExtensionAPI) => {
		pi.events.on("rqw-codex:session-policy", (raw) => {
			const request = raw as Request;
			seen.push({ request, wireAtEmit: wire.length, messagesAtEmit: request.session.messages.length });
			if (policy.error !== undefined) request.error = policy.error;
			request.installCompactionHooks = (api: ExtensionAPI) => {
				if (policy.hookError) throw new Error(policy.hookError);
				hookInstalls.push({ session: request.session, wireAtInstall: wire.length });
				api.on("before_agent_start", (_event, ctx) => { hookContexts.push(ctx.sessionManager.getSessionId()); });
				api.on("session_before_compact", (event) => ({ compaction: { summary: "child portable summary", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore } }));
			};
			request.release = () => { policy.releases++; };
			request.captureRun = (callerThreadId) => { captures.push({ callerThreadId, wireAtCapture: wire.length }); };
		});
	};
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [EXTENSION],
		extensionFactories: binder ? [binderStandIn] : [], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: main.getModel("m"), thinkingLevel: "off",
		resourceLoader: loader, sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 0 }, retry: { enabled: false }, transport: "sse" }) });
	await session.bindExtensions({ mode: "tui" });
	const call = async (params: Record<string, unknown>) => {
		const result = await session.getToolDefinition("agent")!.execute("t", params as never, undefined, undefined, session.extensionRunner.createContext());
		return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
	};
	const child = (task = "go", system = "EXACT") => ({ action: "start", system, task, model: "anthropic/claude-opus-5-5", tools: [] });
	const close = async () => { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); };
	return { session, seen, policy, captures, hookInstalls, hookContexts, call, child, close, mainId: () => session.sessionManager.getSessionId() };
}

describe("RQW-agent: optional rqw-codex:session-policy request", () => {
	it("installs offered public compaction hooks on the actual child's API before its first prompt", async () => {
		wire.length = 0;
		const f = await open(true);
		try {
			await f.call(f.child());
			await f.call({ action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 60_000 });
			assert.equal(f.hookInstalls.length, 1);
			const child = f.seen[0].request.session;
			assert.equal(f.hookInstalls[0].session, child);
			assert.equal(f.hookInstalls[0].wireAtInstall, 0);
			assert.deepEqual(f.hookContexts, [child.sessionId], "the registered callback belongs to the child, not its parent");
			const requestsBefore = wire.length;
			const result = await child.compact();
			assert.equal(result.summary, "child portable summary");
			assert.equal(child.sessionManager.buildContextEntries()[0]?.type, "compaction");
			assert.equal(wire.length, requestsBefore, "the offered callback supplied the summary without provider fallback");
			await f.call({ action: "stop", id: "agent#1" });
			assert.equal(f.policy.releases, 1);
		} finally { await f.close(); }
	});

	it("releases the policy and refuses the child before prompting if hook installation throws", async () => {
		wire.length = 0;
		const f = await open(true);
		try {
			f.policy.hookError = "hook installation failed";
			await assert.rejects(f.call(f.child()), /Session policy refused: hook installation failed/);
			assert.equal(f.policy.releases, 1);
			assert.equal(wire.length, 0);
		} finally { await f.close(); }
	});
	it("is emitted after the child exists and before its first prompt, with the caller's session id and kind collab_spawn", async () => {
		wire.length = 0;
		const f = await open(true);
		try {
			assert.equal(await f.call(f.child()), "agent#1 started");
			assert.equal(f.seen.length, 1);
			const [{ request, wireAtEmit, messagesAtEmit }] = f.seen;
			assert.equal(request.kind, "collab_spawn");
			assert.equal(request.startupSystemPrompt, "EXACT", "the caller's whole system prompt is the child's startup prompt");
			assert.equal(request.parentThreadId, f.mainId(), "parent is the main session's id");
			assert.notEqual(request.session, f.session, "the request carries the child, not the main session");
			assert.equal(wireAtEmit, 0, "no request reached the provider when the binder saw it");
			assert.equal(messagesAtEmit, 0, "no child prompt had been recorded");
			assert.match(await f.call({ action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 60_000 }), /ok/);
			assert.equal(wire.length, 1);
			assert.deepEqual(systemOf(wire[0].body), ["EXACT"], "the request carries exactly the caller's prompt");
			assert.equal(f.policy.releases, 0, "a live child is not released before stop");
		} finally { await f.close(); }
	});

	it("a nested child emits its own request to the same binder, whose parent is the direct caller", async () => {
		wire.length = 0;
		const f = await open(true);
		try {
			await f.call(f.child("go", "NESTED parent"));
			await until(() => f.seen.length === 2, "the nested child's request");
			const [outer, inner] = f.seen.map((s) => s.request);
			assert.equal(outer.parentThreadId, f.mainId());
			assert.equal(inner.kind, "collab_spawn");
			assert.equal(inner.parentThreadId, outer.session.sessionManager.getSessionId(), "the nested child's parent is the child");
			assert.equal(outer.childName, "agent#1");
			assert.equal(inner.childName, "agent#1", "Codex gets only the local kind#id, not the tools' parent path");
			assert.notEqual(inner.session, outer.session);
			await f.call({ action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 60_000 });
			await outer.session.getToolDefinition("agent")!.execute("nested-wait", {
				action: "wait", ids: ["agent#1"], blocking: true, timeout_ms: 60_000,
			} as never, undefined, undefined, outer.session.extensionRunner.createContext());
			await outer.session.getToolDefinition("agent")!.execute("nested-restart", {
				action: "restart", id: "agent#1", task: "fresh nested run",
			} as never, undefined, undefined, outer.session.extensionRunner.createContext());
			assert.equal(f.seen.length, 3);
			assert.equal(f.seen[2].request.childName, "agent#1", "restart also keeps Codex's name local");
		} finally { await f.close(); }
	});

	it("without a listener the child starts and answers exactly as before", async () => {
		wire.length = 0;
		const f = await open(false);
		try {
			assert.equal(await f.call(f.child()), "agent#1 started");
			assert.match(await f.call({ action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 60_000 }), /ok/);
			assert.equal(wire.length, 1);
		} finally { await f.close(); }
	});

	it("a refused request fails the start before any prompt, disposes and releases the child", async () => {
		wire.length = 0;
		const f = await open(true);
		try {
			f.policy.error = "codex refused\nsecond line";
			await assert.rejects(f.call(f.child()), /Session policy refused: codex refused$/);
			assert.equal(wire.length, 0, "no prompt reached the provider");
			assert.equal(f.policy.releases, 1);
			await assert.rejects(f.call({ action: "send", id: "agent#1", task: "again" }), /Unknown agent id/, "the refused child is not registered");
		} finally { await f.close(); }
	});

	it("release runs once on restart and stop, and on shutdown for a live child", async () => {
		wire.length = 0;
		const f = await open(true);
		try {
			await f.call(f.child());
			await until(() => wire.length === 1, "first answer");
			await f.call({ action: "restart", id: "agent#1", task: "fresh" });
			await until(() => wire.length === 2, "restarted child answer");
			assert.equal(f.policy.releases, 1, "restart releases the old child");
			assert.equal(f.seen.length, 2);
			await f.call({ action: "stop", id: "agent#1" });
			assert.equal(f.policy.releases, 2, "stop releases the restarted child");
			await assert.rejects(f.call({ action: "stop", id: "agent#1" }), /Unknown agent id/);
			assert.equal(f.policy.releases, 2, "a second stop releases nothing");
			await f.call(f.child("again"));
			await f.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			assert.equal(f.policy.releases, 3, "shutdown releases the live child");
			f.session.dispose();
		} catch (error) {
			await f.close().catch(() => {});
			throw error;
		}
	});

	it("a start cancelled before its child exists emits nothing", async () => {
		wire.length = 0;
		const f = await open(true);
		try {
			const controller = new AbortController();
			controller.abort(new Error("cancelled"));
			const result = f.session.getToolDefinition("agent")!.execute("t", f.child() as never, controller.signal, undefined, f.session.extensionRunner.createContext());
			await assert.rejects(result);
			assert.equal(f.seen.length, 0);
			assert.equal(wire.length, 0);
		} finally { await f.close(); }
	});

	it("labels the child with its actual kind#id and captures its run origin from the caller once per start, send and restart, before the provider sees the prompt", async () => {
		wire.length = 0;
		const f = await open(true);
		try {
			assert.equal(await f.call(f.child()), "agent#1 started");
			assert.equal(f.seen[0].request.childName, "agent#1");
			assert.deepEqual(f.captures.map((c) => c.callerThreadId), [f.mainId()]);
			assert.equal(f.captures[0].wireAtCapture, 0, "the capture precedes the first request");
			await f.call({ action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 60_000 });
			const before = wire.length;
			await f.call({ action: "send", id: "agent#1", task: "next" });
			assert.equal(f.captures.length, 2);
			assert.equal(f.captures[1].callerThreadId, f.mainId());
			assert.equal(f.captures[1].wireAtCapture, before, "the send's capture precedes its prompt");
			await until(() => wire.length === before + 1, "the sent answer");
			await f.call({ action: "restart", id: "agent#1", task: "fresh" });
			assert.equal(f.seen[1].request.childName, "agent#1");
			assert.equal(f.captures.length, 3);
			assert.equal(f.captures[2].callerThreadId, f.mainId());
		} finally { await f.close(); }
	});

	it("a refused child is never captured, and a stopped child drops its capture closure", async () => {
		wire.length = 0;
		const f = await open(true);
		try {
			f.policy.error = "codex refused";
			await assert.rejects(f.call(f.child()), /Session policy refused/);
			assert.equal(f.captures.length, 0);
			f.policy.error = undefined;
			assert.equal(await f.call(f.child()), "agent#2 started");
			assert.equal(f.captures.length, 1);
			assert.equal(f.seen[1].request.childName, "agent#2");
			await f.call({ action: "stop", id: "agent#2" });
			assert.equal(f.seen[1].request.captureRun, undefined, "stop drops the capture with the release");
			assert.equal(f.policy.releases, 2, "the refused attempt released once, the stopped child once");
		} finally { await f.close(); }
	});
});
