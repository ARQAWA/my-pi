import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

it("cache warming stays off without changing the saved setting", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "rqw-cache-"));
	try {
		const runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
		const faux = fauxProvider();
		runtime.registerNativeProvider(faux.provider);
		faux.setResponses([fauxAssistantMessage("ok")]);
		const settings = SettingsManager.inMemory({ cacheWarming: "idle" });
		const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager: settings,
			additionalExtensionPaths: [join(import.meta.dirname, "../../../extensions/RQW-settings/index.ts")],
			noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const { session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime, model: faux.getModel(),
			resourceLoader: loader, sessionManager: SessionManager.inMemory(root), settingsManager: settings });
		t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
		try {
			assert.equal(settings.getCacheWarmingMode(), "off");
			assert.equal(settings.getSettings().cacheWarming, "idle");
			const stream = await session.agent.streamFunction(session.model!, { messages: [{ role: "user", content: "hi", timestamp: 0 }] }, { sessionId: session.sessionId });
			await stream.result();
			assert.deepEqual(session.cacheWarmingStatus, { state: "inactive", reason: "cache warming disabled" });
			t.mock.timers.tick(3_600_000);
			assert.equal(faux.getPendingResponseCount(), 0);
		} finally {
			session.dispose();
			t.mock.timers.reset();
		}
	} finally { await rm(root, { recursive: true, force: true }); }
});
