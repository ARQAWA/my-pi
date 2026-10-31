import assert from "node:assert/strict";
import test from "node:test";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSession, createEventBus, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import rqwTools, { createTools } from "../../../extensions/RQW-tools/index.ts";

test("next request removes the old catalogue and adds its replacements", async () => {
	const cwd = process.cwd();
	const core = createFauxCore({ provider: "faux", models: [{ id: "m", contextWindow: 100000, maxTokens: 1000 }] });
	const model = core.getModel("m")!;
	let request: any;
	core.setResponses([(context: any) => { request = context; return fauxAssistantMessage("ok"); }]);
	const modelRuntime: any = {
		getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true,
		getAuth: async () => ({ apiKey: "test" }), checkAuth: async () => ({}), isUsingOAuth: () => false,
		getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [],
		streamSimple: (m: any, c: any, o: any) => core.streamSimple(m, c, o), getProviderHeaders: () => undefined,
	};
	const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } } as never);
	const events = createEventBus();
	const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager, eventBus: events,
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		systemPromptOverride: () => "system", extensionFactories: [rqwTools] } as never);
	await loader.reload();
	const manager = SessionManager.inMemory(cwd);
	const old = createTools(cwd, () => ({}), { legacy: true }).filter((tool) => ["read", "grep", "find"].includes(tool.name));
	manager.appendMessage({ role: "system", content: "system", timestamp: 1, toolsAdded: old.map(({ name, description, parameters }) => ({ name, description, parameters })) } as any);
	const { session } = await createAgentSession({ cwd, modelRuntime, model: model as never, resourceLoader: loader, settingsManager, sessionManager: manager });
	try {
		await session.bindExtensions({});
		await session.prompt("next");
		const transition = request.messages.filter((message: any) => message.role === "system" && message.toolsRemoved?.length).at(-1);
		assert.deepEqual(transition.toolsRemoved.map((tool: any) => tool.name).sort(), ["find", "grep", "read"]);
		assert.deepEqual(transition.toolsAdded.map((tool: any) => tool.name).filter((name: string) => name.startsWith("rqw_")).sort(), ["rqw_glob", "rqw_readfile", "rqw_rg"]);
	} finally {
		await (session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "shutdown" });
		session.dispose();
	}
});
