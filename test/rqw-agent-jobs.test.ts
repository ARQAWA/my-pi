import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import registerAgent from "../extensions/RQW-agent/index.ts";
import { createJobs, createJobTool } from "../extensions/RQW-tools/jobs.ts";

const until = async (done: () => boolean) => {
	for (let i = 0; i < 20000 && !done(); i++) await new Promise(resolve => setImmediate(resolve));
	assert.ok(done());
};

test("a child waits for a job of the real job registry without a request; the job's end wakes it once", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const cwd = await mkdtemp(join(tmpdir(), "rqw-child-jobs-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const parent = SessionManager.inMemory(cwd);
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const core = createFauxCore({ provider: "child-jobs-test", models: [{ id: "model" }] });
	const model = core.getModel();
	const requests: any[] = [];
	core.setResponses(Array.from({ length: 8 }, () => (context: any) => {
		requests.push(context);
		if (JSON.stringify(context.messages).includes("job answer")) return fauxAssistantMessage("job finished");
		if (context.messages.some((message: any) => message.role === "toolResult")) return fauxAssistantMessage("started the job, waiting");
		return fauxAssistantMessage([fauxToolCall("bash", {}, { id: "slow" })], { stopReason: "toolUse" });
	}));
	const modelRuntime = {
		getModel: () => model, getPhysicalModel: () => model,
		hasConfiguredAuth: () => true, getAuth: async () => ({ apiKey: "fake" }),
		checkAuth: async () => ({}), isUsingOAuth: () => false,
		getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [], streamSimple: core.streamSimple,
	};
	const hooks = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	const tools = new Map<string, any>();
	const ctx: any = {
		cwd, sessionManager: parent, model, modelRegistry: { runtime: modelRuntime, find: () => model, hasConfiguredAuth: () => true },
		isIdle: () => true, isProjectTrusted: () => true, getSystemPrompt: () => "parent prompt",
		signal: new AbortController().signal, mode: "tui", ui: { notify() {} },
	};
	const pi: any = {
		events: createEventBus(),
		on(name: string, hook: any) { hooks.set(name, [...hooks.get(name) ?? [], hook]); },
		registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand() {}, registerEntryRenderer() {},
		appendEntry: (name: string, data: any) => parent.appendCustomEntry(name, data),
		getSettings: () => ({ retry: { enabled: false }, compaction: { enabled: false } }),
		getThinkingLevel: () => "off", getActiveTools: () => [],
		sendMessage: (message: any) => parent.appendCustomMessageEntry(message.customType, message.content, message.display, message.details),
	};
	// The child's own registry is the real one of RQW-tools; only the slow work behind its `bash` call is controlled here.
	const registry = createJobs({ backgroundAfterMs: 12 });
	let started = false;
	let finish = () => {};
	pi.events.on("rqw-tools:subagent-tools", (request: any) => request.offer(() => [{
		name: "bash", label: "bash", description: "slow", parameters: { type: "object", properties: {} },
		execute: () => {
			started = true;
			return registry.run({ tool: "bash", command: "slow", process: false },
				() => new Promise(resolve => { finish = () => resolve({ content: [{ type: "text", text: "job answer" }] }); }));
		},
	}, createJobTool(registry, "job")]));
	registerAgent(pi);
	t.after(async () => { for (const hook of hooks.get("session_shutdown") ?? []) await hook({ reason: "shutdown" }, ctx); });
	const call = (id: string, params: any) => tools.get("agent").execute(id, params, ctx.signal, undefined, ctx);
	await call("start", { action: "start", task: "outer", tools: ["bash"] });
	await until(() => started);
	t.mock.timers.tick(12);
	let waited: any;
	void call("wait", { action: "wait", ids: ["agent#1"] }).then(result => { waited = result; });
	await until(() => requests.length === 2);
	for (let i = 0; i < 40; i++) await new Promise(resolve => setImmediate(resolve));
	assert.equal(waited, undefined, "a running job keeps the run open");
	assert.equal(requests.length, 2, "waiting for the job makes no model request");
	assert.equal((await call("status", { action: "status", ids: ["agent#1"] })).details.statuses[0].pending_jobs, 1);
	finish();
	await until(() => waited !== undefined);
	assert.equal(requests.length, 3);
	assert.match(waited.details.results[0].text, /^job finished/);
	assert.equal(registry.undelivered(), 0, "the result was delivered once, by the automatic source");
});
