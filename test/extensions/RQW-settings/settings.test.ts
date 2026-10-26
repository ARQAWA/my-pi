import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { fauxProvider } from "@earendil-works/pi-ai";
import { createAgentSession, createCodemodeExtension, createToolSearchExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

it("enables codemode and tool_search alongside the stock tools", async () => {
	const root = await mkdtemp(join(tmpdir(), "rqw-settings-"));
	try {
		const runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
		const faux = fauxProvider();
		runtime.registerNativeProvider(faux.provider);
		const loader = new DefaultResourceLoader({ cwd: root, agentDir: root,
			additionalExtensionPaths: [join(import.meta.dirname, "../../../extensions/RQW-settings/index.ts")],
			extensionFactories: [
				{ name: "codemode", factory: createCodemodeExtension(), replaceable: true, builtin: true },
				{ name: "tool-search", factory: createToolSearchExtension(), replaceable: true, builtin: true },
			], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const { session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime, model: faux.getModel(),
			resourceLoader: loader, sessionManager: SessionManager.inMemory(root), settingsManager: SettingsManager.inMemory({}) });
		try {
			await session.bindExtensions({});
			assert.deepEqual(session.getActiveToolNames().sort(), ["bash", "codemode", "edit", "read", "tool_search", "write"]);
		} finally {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			session.dispose();
		}
	} finally { await rm(root, { recursive: true, force: true }); }
});
