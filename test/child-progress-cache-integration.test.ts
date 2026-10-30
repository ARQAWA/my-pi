import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import { createOverlay } from "../extensions/RQW-anthropic/transport.ts";
import { registerSessionRuntime } from "../extensions/RQW-agent/index.ts";

test("agent tool delivers a child's 50-step progress through the Anthropic fork", async t => {
	const root = await mkdtemp(join(tmpdir(), "rqw-child-cache-"));
	const saved = { agent: process.env.PI_CODING_AGENT_DIR, codex: process.env.CODEX_HOME };
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.CODEX_HOME = join(root, "codex");
	await mkdir(join(root, "project"), { recursive: true });
	t.after(async () => {
		if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = saved.agent;
		if (saved.codex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved.codex;
		await rm(root, { recursive: true, force: true });
	});
	const base = builtinProviders().find(provider => provider.id === "anthropic")!;
	const model = base.getModels()[0];
	const overlay = createOverlay(base, () => undefined, "device");
	const bodies: any[] = [];
	let turns = 0;
	const held = Promise.withResolvers<Response>();
	const progressResult = Promise.withResolvers<{ content?: unknown; error?: string }>();
	const fakeFetch: typeof fetch = async (_input, init) => {
		const body = JSON.parse(String(init?.body)); bodies.push(body);
		const blocks = [...(body.tools ?? []), ...(body.system ?? []), ...body.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : [])];
		if (blocks.filter((block: any) => block.cache_control).length > 4) {
			progressResult.resolve({ error: "too many cache_control blocks" });
			return Response.json({ type: "error", error: { type: "invalid_request_error", message: "too many cache_control blocks" } }, { status: 400 });
		}
		const progress = JSON.stringify(body.messages).includes("Summarize what you did in the most recent 50 assistant responses");
		if (!progress && ++turns > 50) return held.promise;
		const events: any[] = [
			{ type: "message_start", message: { id: "fake", model: body.model, usage: { input_tokens: 1, output_tokens: 0 } } },
		];
		if (progress) events.push(
			{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "progress report" } },
		);
		else events.push(
			{ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: `call-${turns}`, name: "read", input: {} } },
			{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":"fixed"}' } },
		);
		events.push({ type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: progress ? "end_turn" : "tool_use" }, usage: { output_tokens: 2 } }, { type: "message_stop" });
		return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
	};
	const runtime = {
		getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true,
		getAuth: async () => ({ apiKey: "sk-ant-oat01-fake" }), checkAuth: async () => ({}), isUsingOAuth: () => true,
		getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [],
		streamSimple: (selected: any, context: any, options: any) => overlay.streamSimple(selected, context, { ...options, apiKey: "sk-ant-oat01-fake", fetch: fakeFetch }),
	};
	const parent = SessionManager.create(root, join(root, "parent"));
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const events = createEventBus();
	const hooks = new Map<string, any[]>();
	let definition: any;
	const pi: any = {
		events, on: (name: string, hook: any) => hooks.set(name, [...hooks.get(name) ?? [], hook]),
		registerTool: (tool: any) => { definition = tool; }, appendEntry: (name: string, data: any) => parent.appendCustomEntry(name, data),
		getSettings: () => ({ retry: { enabled: false }, compaction: { enabled: false } }), getThinkingLevel: () => "off", getActiveTools: () => [],
		sendMessage: (message: any) => { if (message.customType === "agent_progress") progressResult.resolve(message); },
	};
	const ctx: any = { cwd: join(root, "project"), sessionManager: parent, model,
		modelRegistry: { runtime, find: () => model, hasConfiguredAuth: () => true }, isIdle: () => true,
		isProjectTrusted: () => true, getSystemPrompt: () => "original prompt", signal: new AbortController().signal,
		mode: "tui", ui: { notify() {} } };
	const handle = registerSessionRuntime(pi, events, false, undefined, undefined, undefined, undefined, undefined, "", undefined);
	events.on("rqw-codex:session-policy", (request: any) => overlay.forks.registerSource(request.session.sessionId));
	events.on("rqw:context-fork:v1", (request: any) => overlay.forks.offer(request));
	events.on("rqw-tools:subagent-tools", (request: any) => request.offer(() => [{
		name: "read", label: "Read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
		execute: async () => ({ content: [{ type: "text", text: "fixed" }], details: {} }),
	}]));
	const execute = (params: any) => definition.execute("call", params, new AbortController().signal, undefined, ctx);
	try {
		await execute({ action: "start", task: "work", tools: ["read"] });
		const notice = await progressResult.promise;
		assert.equal(turns >= 50, true);
		assert.match(String(notice.content ?? notice.error ?? ""), /progress report/);
		assert.equal(bodies.filter(body => JSON.stringify(body.messages).includes("Summarize what you did in the most recent 50 assistant responses")).length, 1);
	} finally {
		held.resolve(new Response("", { status: 500 }));
		await execute({ action: "stop", id: "agent#1" });
		handle.close();
	}
});
