// Grammar (custom) tool calls through the real session controller: real Pi 1.4.0 AgentSession on a file-backed
// SessionManager, the real CodexThreadTransport with a fake SSE connector and a fake saved login. No network.
// Every generation's wire body is read back from the SSE request, so the assertions cover what is actually sent.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import * as zlib from "node:zlib";
import * as pi from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Api, type Context, type Model, type Tool } from "@earendil-works/pi-ai";

import { createSessionController } from "../../../extensions/RQW-codex/session.ts";
import type { TransportDependencies } from "../../../extensions/RQW-codex/transport.ts";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";
import { toolWireFlags, type WireItem } from "../../../extensions/RQW-codex/wire.ts";

const BASE_MODEL = {
	id: "gpt-6-luna",
	name: "GPT-6-Luna",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 500000,
	maxTokens: 100000,
	thinkingLevelMap: {},
} as unknown as Model<Api>;

// Explicit grammar support on the model record; BASE_MODEL carries none, so Pi's default (false) applies to it.
const GRAMMAR_MODEL = { ...BASE_MODEL, compat: { supportsOpenAIGrammarTools: true } } as unknown as Model<Api>;

const EXEC = {
	name: "exec",
	description: "Run code",
	parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
	constrainedSampling: { type: "grammar", variants: { openai_lark: "start: /.+/" } },
} as unknown as Tool;

const RAW = "echo héllo 😀\nprintf 'x' && ls -la";
const ACCOUNT = "acct-codex-1";
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function seededStore(): Promise<InMemoryCredentialStore> {
	const store = new InMemoryCredentialStore();
	const exp = Math.floor(Date.now() / 1000) + 3600;
	const access = `${b64url({ alg: "none" })}.${b64url({ exp, tag: "a", "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } })}.sig`;
	await store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "refresh-a", expires: exp * 1000, accountId: ACCOUNT }) as never);
	return store;
}

const userMsg = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });

const completedEvent = (id: string) => ({
	type: "response.completed",
	response: { id, status: "completed", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } },
});

/** One completed grammar call: created, the custom item done (raw input), completed. */
const customCallEvents = (id: string, callId: string, itemId: string, input: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.done", output_index: 0, item: { type: "custom_tool_call", id: itemId, call_id: callId, name: "exec", input } },
	completedEvent(id),
];

const textEvents = (id: string, text: string) => [
	{ type: "response.created", response: { id } },
	{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
	completedEvent(id),
];

/** Fake SSE POST: one script per request, in order; records the bodies. */
function sseScript(steps: unknown[][]) {
	const calls: { body: Uint8Array }[] = [];
	const fn = (options: { body: Uint8Array; onResponse(head: { status: number; headers: Record<string, string> }): void }) => {
		calls.push({ body: options.body });
		const events = steps.shift();
		if (!events) throw new Error("unexpected SSE request");
		return (async function* () {
			options.onResponse({ status: 200, headers: {} });
			for (const value of events) yield { text: JSON.stringify(value), value };
		})();
	};
	return { fn, calls };
}

/** Every WebSocket attempt is refused with 426: the native sticky SSE fallback. */
const upgradeRequired = async (): Promise<never> => {
	throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
};

const timing = { clock: { now: () => 1_000_000 }, random: () => 0.5, sleep: async () => {} };

const bodyOf = (bytes: Uint8Array): Record<string, unknown> => JSON.parse(zlib.zstdDecompressSync(Buffer.from(bytes)).toString("utf8"));

const inputOf = (sse: { calls: { body: Uint8Array }[] }, index: number): WireItem[] => bodyOf(sse.calls[index].body).input as WireItem[];

const ofType = (items: WireItem[], type: string) => items.filter((item) => item.type === type);

type Terminal = { type: string; message?: { content: { type: string; id?: string; name?: string; arguments?: Record<string, unknown> }[] } };

/** One generation through the controller, inside one run. The final message is persisted as Pi persists it. */
async function generate(controller: ReturnType<typeof createSessionController>, model: Model<Api>, session: pi.AgentSession, tools: Tool[] = [EXEC]): Promise<Terminal> {
	const context: Context = {
		systemPrompt: "SYSTEM",
		messages: session.sessionManager.buildSessionContext().messages as Context["messages"],
		tools,
	};
	let last: Terminal = { type: "none" };
	controller.policy.beginRun({ kind: "run" });
	try {
		for await (const event of controller.stream(model, context, {})) last = event as Terminal;
	} finally {
		controller.policy.endRun({ aborted: false });
	}
	if (last.type === "done" && last.message) session.sessionManager.appendMessage(last.message as never);
	return last;
}

/** The tool's one execution: records the input it received and persists its result, as Pi's agent loop does. */
function runExec(session: pi.AgentSession, message: Terminal["message"], runs: string[]): void {
	const call = message?.content.find((block) => block.type === "toolCall");
	if (!call || call.name !== "exec") throw new Error("expected one exec call");
	const code = String(call.arguments?.code);
	runs.push(code);
	session.sessionManager.appendMessage({
		role: "toolResult",
		toolCallId: call.id as string,
		toolName: "exec",
		content: [{ type: "text", text: `ran: ${code}` }],
		isError: false,
		timestamp: Date.now(),
	} as never);
}

/** Real session on a file-backed SessionManager holding one user message. */
async function withSession(run: (dir: string, create: (manager: pi.SessionManager) => Promise<pi.AgentSession>) => Promise<void>) {
	const dir = mkdtempSync(join(tmpdir(), "rqw-codex-grammar-"));
	const sessions: pi.AgentSession[] = [];
	const create = async (manager: pi.SessionManager) => {
		const resourceLoader = new pi.DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true,
			noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await resourceLoader.reload();
		const { session } = await pi.createAgentSession({ cwd: dir, agentDir: dir, resourceLoader, model: GRAMMAR_MODEL,
			sessionManager: manager, settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false } }) });
		sessions.push(session);
		return session;
	};
	try { await run(dir, create); }
	finally {
		for (const session of sessions) session.dispose();
		rmSync(dir, { recursive: true, force: true });
	}
}

const deps = (sse: ReturnType<typeof sseScript>) => ({ ...timing, connect: upgradeRequired, postEvents: sse.fn as unknown as TransportDependencies["postEvents"] });

it("[real facade] grammar custom call: mapped raw input, one execute, paired output, raw items once through resume and a compat flip", { timeout: 15_000 }, async () => {
	assert.equal(toolWireFlags(BASE_MODEL).supportsOpenAIGrammarTools, false, "Pi default is off");
	assert.equal(toolWireFlags(GRAMMAR_MODEL).supportsOpenAIGrammarTools, true, "explicit on the model record");
	await withSession(async (dir, create) => {
		const manager = pi.SessionManager.create(dir, dir);
		manager.appendMessage(userMsg("run the exec tool") as never);
		const file = manager.getSessionFile() as string;
		const sse = sseScript([
			customCallEvents("resp_g1", "call_g1", "ctc_g1", RAW),
			textEvents("resp_g2", "done"),
			textEvents("resp_g3", "again"),
			textEvents("resp_g4", "flip"),
		]);
		const runs: string[] = [];
		const session = await create(manager);
		const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: deps(sse) });

		// Generation 1: the grammar call arrives as a custom item and its raw input is mapped to the `code` argument.
		const first = await generate(controller, GRAMMAR_MODEL, session);
		assert.equal(first.type, "done");
		const call = first.message?.content.find((block) => block.type === "toolCall");
		assert.deepEqual(call?.arguments, { code: RAW }, "raw custom input lands in the code property, code and Unicode intact");
		runExec(session, first.message, runs);

		// Generation 2: the completed call is replayed once as its raw custom item, its output once as custom_tool_call_output.
		const second = await generate(controller, GRAMMAR_MODEL, session);
		assert.equal(second.type, "done");
		const input2 = inputOf(sse, 1);
		assert.deepEqual(ofType(input2, "custom_tool_call"), [{ type: "custom_tool_call", id: "ctc_g1", call_id: "call_g1", name: "exec", input: RAW }]);
		assert.deepEqual(ofType(input2, "custom_tool_call_output"), [{ type: "custom_tool_call_output", call_id: "call_g1", output: `ran: ${RAW}` }]);
		assert.equal(input2.some((item) => (item.type === "function_call" || item.type === "function_call_output") && String(item.call_id).startsWith("call_g1")), false);
		// gpt-6-luna is Responses Lite: the declaration is the functions namespace of the additional_tools item, no top-level tools.
		assert.equal(bodyOf(sse.calls[1].body).tools, undefined);
		assert.deepEqual(ofType(input2, "additional_tools")[0].tools, [{ type: "namespace", name: "functions", description: "", tools: [{ type: "custom", name: "exec", description: "Run code", format: { type: "grammar", syntax: "lark", definition: "start: /.+/" } }] }]);
		assert.equal(runs.length, 1, "exactly one execute");
		const durable = controller.wireState?.history.load().items.map((entry) => entry.item.type) ?? [];
		assert.equal(durable.filter((type) => type === "custom_tool_call").length, 1);
		assert.equal(durable.filter((type) => type === "custom_tool_call_output").length, 1);

		// Resume: a new session and controller on the same file send the same raw items, once each.
		const reopened = pi.SessionManager.open(file, dir);
		const resumed = await create(reopened);
		const controller2 = createSessionController({ session: resumed, installationId: "inst-1", store: await seededStore(), dependencies: deps(sse) });
		await generate(controller2, GRAMMAR_MODEL, resumed);
		const input3 = inputOf(sse, 2);
		assert.equal(ofType(input3, "custom_tool_call").length, 1, "resume: raw custom call once");
		assert.equal(ofType(input3, "custom_tool_call_output").length, 1, "resume: output once");
		assert.deepEqual(ofType(input3, "custom_tool_call")[0], { type: "custom_tool_call", id: "ctc_g1", call_id: "call_g1", name: "exec", input: RAW });

		// Model compat flip (grammar support off): the replayed raw items are unchanged; only the declared tool becomes a function.
		await generate(controller2, BASE_MODEL, resumed);
		const input4 = inputOf(sse, 3);
		assert.equal(ofType(input4, "custom_tool_call").length, 1, "compat flip: raw custom call once");
		assert.deepEqual(ofType(input4, "custom_tool_call_output"), [{ type: "custom_tool_call_output", call_id: "call_g1", output: `ran: ${RAW}` }]);
		assert.deepEqual(ofType(input4, "additional_tools")[0].tools, [{ type: "namespace", name: "functions", description: "", tools: [{ type: "function", name: "exec", description: "Run code", strict: false, parameters: EXEC.parameters }] }]);
		assert.equal(runs.length, 1, "still exactly one execute");
		controller.release();
		controller2.release();
	});
});

it("[real facade] an unfinished grammar call is never executed nor persisted", { timeout: 15_000 }, async () => {
	await withSession(async (dir, create) => {
		const manager = pi.SessionManager.create(dir, dir);
		manager.appendMessage(userMsg("run the exec tool") as never);
		// The custom item is only added, never done, and the response ends without its completed event.
		const sse = sseScript([[
			{ type: "response.created", response: { id: "resp_u1" } },
			{ type: "response.output_item.added", output_index: 0, item: { type: "custom_tool_call", id: "ctc_u1", call_id: "call_u1", name: "exec", input: "" } },
		]]);
		const runs: string[] = [];
		const session = await create(manager);
		const controller = createSessionController({ session, installationId: "inst-1", store: await seededStore(), dependencies: deps(sse) });
		const result = await generate(controller, GRAMMAR_MODEL, session);
		assert.equal(result.type, "error", "the stream ends with an error, not a done message");
		assert.equal(runs.length, 0, "nothing executed");
		const types = controller.wireState?.history.load().items.map((entry) => entry.item.type) ?? [];
		assert.equal(types.includes("custom_tool_call"), false, "unfinished call not persisted");
		assert.equal(types.includes("custom_tool_call_output"), false);
		controller.release();
	});
});
