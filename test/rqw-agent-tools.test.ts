import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import registerAgent from "../extensions/RQW-agent/index.ts";
import { installRqwTools } from "../extensions/RQW-tools/index.ts";

test("real RQW-tools definitions reach default and nested children", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const cwd = await mkdtemp(join(tmpdir(), "rqw-child-tools-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	await writeFile(join(cwd, "sample.txt"), "actual factory result\n");
	const parent = SessionManager.inMemory(cwd);
	parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
	const core = createFauxCore({ provider: "child-tools-test", models: [{ id: "model" }] });
	const model = core.getModel();
	const requests: any[] = [];
	core.setResponses(Array.from({ length: 12 }, () => (context: any) => {
		requests.push(context);
		const task = context.messages.find((message: any) => message.role === "user")?.content?.[0]?.text;
		const results = context.messages.filter((message: any) => message.role === "toolResult");
		if (!results.some((result: any) => result.toolName === "bash"))
			return fauxAssistantMessage([fauxToolCall("bash", { command: "git grep foo" }, { id: `${task}-bash` })], { stopReason: "toolUse" });
		if (!results.some((result: any) => result.toolName === "rqw_readfile"))
			return fauxAssistantMessage([fauxToolCall("rqw_readfile", { path: "sample.txt" }, { id: `${task}-read` })], { stopReason: "toolUse" });
		if (task === "outer" && !results.some((result: any) => result.toolName === "agent"))
			return fauxAssistantMessage([fauxToolCall("agent", { action: "start", task: "nested" }, { id: "nested-start" })], { stopReason: "toolUse" });
		return fauxAssistantMessage("done");
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
		getSettings: () => ({ shellPath: "/nonexistent/rqw-guard-shell", retry: { enabled: false }, compaction: { enabled: false } }),
		getThinkingLevel: () => "off", getActiveTools: () => [],
		sendMessage: (message: any) => parent.appendCustomMessageEntry(message.customType, message.content, message.display, message.details),
	};
	installRqwTools(pi);
	registerAgent(pi);
	t.after(async () => { for (const hook of hooks.get("session_shutdown") ?? []) await hook({ reason: "shutdown" }, ctx); });
	const call = (id: string, params: any) => tools.get("agent").execute(id, params, ctx.signal, undefined, ctx);
	await call("start", { action: "start", task: "outer" });
	await call("outer/wait", { action: "wait", ids: ["agent#1"] });
	for (const task of ["outer", "nested"]) {
		const request = requests.find((item: any) => item.messages.some((message: any) => message.role === "user" && message.content?.[0]?.text === task)
			&& item.messages.some((message: any) => message.role === "toolResult" && message.toolCallId === `${task}-read`));
		assert.ok(request, `${task} read a file`);
		const definitions = getCurrentTools(request.messages.filter((message: any) => message.role === "system"));
		assert.deepEqual(definitions.map((tool: any) => tool.name).sort(), ["agent", "bash", "edit", "job", "rqw_glob", "rqw_readfile", "rqw_rg", "write"].sort());
		for (const [name, field] of [["rqw_rg", "pattern"], ["rqw_glob", "glob_pattern"], ["rqw_readfile", "path"]]) {
			const definition: any = definitions.find((tool: any) => tool.name === name);
			assert.ok(definition.parameters.properties[field], `${task} has ${name}'s real schema`);
		}
		const bashResult = request.messages.find((message: any) => message.role === "toolResult" && message.toolCallId === `${task}-bash`);
		assert.equal(bashResult?.isError, true);
		assert.match(JSON.stringify(bashResult.content), /Blocked: bash does not search, list or read files.*Use rqw_rg to search file contents/);
		const result = request.messages.find((message: any) => message.role === "toolResult" && message.toolCallId === `${task}-read`);
		assert.equal(result.isError, false);
		assert.match(JSON.stringify(result.content), /actual factory result/);
	}
});
