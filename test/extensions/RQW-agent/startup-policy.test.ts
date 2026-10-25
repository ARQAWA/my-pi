// The child's startup prompt on the `rqw-codex:session-policy` request, in real Pi sessions, against the prompt the provider
// actually receives. This test loads only RQW-agent. The main session's before_agent_start forces its prompt the way the
// real prompt extension does, so a child that inherits it must send exactly the same leading base.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { SUBAGENT_REMINDER } from "../../../extensions/RQW-agent/prompt.ts";

const EXTENSION = join(import.meta.dirname, "../../../extensions/RQW-agent/index.ts");
const MAIN_FORCED = "MAIN FORCED BASE: the whole main prompt as the provider first receives it";
const sse = (events: object[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const answer = sse([
	{ type: "message_start", message: { id: "a", model: "claude", usage: { input_tokens: 5, output_tokens: 0 } } },
	{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
	{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
	{ type: "content_block_stop", index: 0 },
	{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
	{ type: "message_stop" },
]);

let root: string;
let counter = 0;
const wire: { url: string; body: Record<string, any> }[] = [];
const realFetch = globalThis.fetch;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-agent-startup-"));
	globalThis.fetch = async (input, init) => {
		wire.push({ url: String(input), body: JSON.parse(String(init?.body)) });
		return new Response(answer, { headers: { "content-type": "text/event-stream" } });
	};
});
after(async () => { globalThis.fetch = realFetch; await rm(root, { recursive: true, force: true }); });

/** The system text of an Anthropic request as the provider received it, one entry per system block. */
const systemOf = (body: Record<string, any>): string[] => (typeof body.system === "string" ? [body.system] : (body.system ?? []).map((b: { text: string }) => b.text));

const until = async (check: () => boolean, what: string) => {
	const deadline = Date.now() + 60_000;
	while (!check()) {
		assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
};

type Request = { session: AgentSession; parentThreadId: string; kind: string; startupSystemPrompt?: string; startupSystemPromptForced?: boolean; childName?: string; release?: () => void };

/** A main session with RQW-agent loaded and a forced main prompt; the binder stand-in records each request on the main bus. */
async function open() {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-api03-fake" } }));
	const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	await runtime.refresh({ allowNetwork: false });
	const main = fauxProvider({ provider: `startup-main-${counter}`, api: `startup-main-${counter}`, models: [{ id: "m", reasoning: true }] });
	runtime.registerNativeProvider(main.provider);
	const seen: Request[] = [];
	const stand = (pi: ExtensionAPI) => {
		pi.on("before_agent_start", () => ({ systemPrompt: MAIN_FORCED }));
		pi.events.on("rqw-codex:session-policy", (raw) => {
			const request = raw as Request;
			seen.push(request);
			request.release = () => {};
		});
	};
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [EXTENSION],
		extensionFactories: [stand], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: main.getModel("m"), thinkingLevel: "off",
		resourceLoader: loader, sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" }) });
	await session.bindExtensions({ mode: "tui" });
	// The listed agent calls run in order inside one main run, so no background delivery run can overlap them.
	const call = async (...list: Record<string, unknown>[]): Promise<string[]> => {
		const texts: string[] = [];
		const waits: { index: number; id: string }[] = [];
		main.setResponses([
			...list.map(params => () => fauxAssistantMessage([fauxToolCall("agent", params)], { stopReason: "toolUse" })),
			...Array.from({ length: 20 }, () => () => fauxAssistantMessage("main ok")),
		]);
		await session.prompt("go");
		for (const result of session.messages.filter(m => m.role === "toolResult" && m.toolName === "agent")) {
			if (result.details?.reason === "waiting") waits.push({ index: texts.length, id: result.details.wait_id });
			texts.push(result.content.map(c => c.type === "text" ? c.text : "").join(""));
		}
		for (const wait of waits) {
			const notification = () => session.messages.find((m) => m.role === "custom" && m.customType === "child_wait" && m.details?.wait_id === wait.id);
			await until(() => !!notification(), "startup wait notification");
			texts[wait.index] = String(notification()!.content);
		}
		return texts;
	};
	const close = async () => { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); };
	return { session, seen, call, close, mainId: () => session.sessionManager.getSessionId() };
}

describe("RQW-agent: startup prompt of a child against the prompt the provider receives", () => {
	it("an inherited default child sends exactly the forced main base plus the reminder, one leading base, no cwd block", async () => {
		wire.length = 0;
		const f = await open();
		try {
			const [started, waited] = await f.call({ action: "start", task: "go", model: "anthropic/claude-opus-5-5", tools: [] }, { action: "wait", ids: ["agent#1"], timeout_ms: 60_000 });
			assert.equal(started, "agent#1 started");
			assert.match(waited, /ok/);
			assert.equal(wire.length, 1);
			const [request] = f.seen;
			assert.equal(request.kind, "collab_spawn");
			assert.equal(request.startupSystemPrompt, `${MAIN_FORCED}\n\n${SUBAGENT_REMINDER}`, "the startup prompt is the forced base and the reminder");
			assert.equal(request.startupSystemPromptForced, true, "the child's factory forces its prompt (before_agent_start returns config.system)");
			assert.deepEqual(systemOf(wire[0].body), [request.startupSystemPrompt], "the provider received exactly the startup prompt");
			assert.equal(systemOf(wire[0].body).join("").split(MAIN_FORCED).length - 1, 1, "the base appears once");
			assert.doesNotMatch(request.startupSystemPrompt!, /<cwd>/, "no SDK cwd block is appended");
			assert.equal(request.parentThreadId, f.mainId());
		} finally { await f.close(); }
	});

	it("an inherited child with a role sends the forced base, the reminder and the role, and the bound prompt equals the sent one", async () => {
		wire.length = 0;
		const f = await open();
		try {
			const [started, waited] = await f.call({ action: "start", task: "go", role: "You test.", model: "anthropic/claude-opus-5-5", tools: [] }, { action: "wait", ids: ["agent#1"], timeout_ms: 60_000 });
			assert.equal(started, "agent#1 started");
			assert.match(waited, /ok/);
			const expected = `${MAIN_FORCED}\n\n${SUBAGENT_REMINDER}\n\n<role>\nYou test.\n</role>`;
			assert.equal(f.seen[0].startupSystemPrompt, expected);
			assert.equal(f.seen[0].startupSystemPromptForced, true, "a role child is forced too");
			assert.deepEqual(systemOf(wire[0].body), [expected]);
		} finally { await f.close(); }
	});
});
