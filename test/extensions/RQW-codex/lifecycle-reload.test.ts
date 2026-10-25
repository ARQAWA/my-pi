// Real Pi 1.4.0 reload of a session that carries the Codex lifecycle binder: reload, then dispose.
// Temporary directories only; no network, no models.json. The Codex controllers run here, while the session's model is a faux non-Codex model with an empty temporary grant, so no inference is made and nothing reaches a real transport. The extension is the real `createCodexExtension` from ../index.ts.
// Child sessions mirror the production child pattern: each one gets a fresh no-extension DefaultResourceLoader on the same ModelRuntime, as RQW-agent and RQW-review do.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
	AgentSession, createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";

import { createCodexExtension } from "../../../extensions/RQW-codex/index.ts";

const PROTOTYPE = AgentSession.prototype as unknown as Record<string, unknown>;
const describeOwn = (name: string) => Object.getOwnPropertyDescriptor(PROTOTYPE, name);
const INNER = Symbol.for("rqw:method-inner");

let root: string;
let counter = 0;
const opened: Array<{ dispose(): void }> = [];
before(async () => { root = await mkdtemp(join(tmpdir(), "rqw-codex-reload-")); });
after(async () => {
	for (const item of opened.splice(0).reverse()) item.dispose();
	await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function openReloadable() {
	const dir = join(root, `r${counter++}`);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "auth.json"), "{}");
	const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	const main = fauxProvider({ provider: `reload-main-${counter}`, api: `reload-main-${counter}`, models: [{ id: "m", reasoning: true }] });
	main.setResponses(Array.from({ length: 2 }, () => () => fauxAssistantMessage("ok")));
	runtime.registerNativeProvider(main.provider);
	// The production entrypoint: owns its session_shutdown release, exactly as the installed extension does.
	const factory = createCodexExtension({ installationId: "00000000-0000-4000-8000-000000000000", agentDir: dir });
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [], extensionFactories: [factory],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: main.getModel("m"), thinkingLevel: "off",
		resourceLoader: loader, sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" }) });
	await session.bindExtensions({ mode: "tui" });
	// Same runtime and faux model, but a fresh loader with no extensions and an in-memory session of its own.
	const child = async () => {
		const childLoader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, noSkills: true, noPromptTemplates: true,
			noThemes: true, noContextFiles: true });
		await childLoader.reload();
		return (await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: main.getModel("m"), thinkingLevel: "off",
			resourceLoader: childLoader, sessionManager: SessionManager.inMemory(dir),
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" }) })).session;
	};
	const handle = { session, runtime, child, dispose: () => session.dispose() };
	opened.push(handle);
	return handle;
}

describe("RQW-codex lifecycle across a real Pi reload", () => {
	it("reload then dispose restores the exact stock binder and leaves no layer behind", async () => {
		const stock = describeOwn("_bindExtensionCore");
		const stockDispose = describeOwn("dispose");
		const h = await openReloadable();
		assert.notDeepEqual(describeOwn("_bindExtensionCore"), stock);
		await h.session.reload();
		assert.notDeepEqual(describeOwn("_bindExtensionCore"), stock, "the reloaded owner is still bound");
		h.dispose();
		assert.deepEqual(describeOwn("_bindExtensionCore"), stock);
		assert.deepEqual(describeOwn("dispose"), stockDispose);
		assert.equal((describeOwn("_bindExtensionCore")?.value as Record<symbol, unknown>)[INNER], undefined);
	});

	it("two reloads, then a same-runtime child, then main and child disposed: stock binder restored", async () => {
		const stock = describeOwn("_bindExtensionCore");
		const h = await openReloadable();
		await h.session.reload();
		await h.session.reload();
		const child = await h.child();
		try {
			h.dispose();
			child.dispose();
			assert.deepEqual(describeOwn("_bindExtensionCore"), stock);
		} finally {
			child.dispose();
			h.dispose();
		}
	});

	it("fresh-loader child disposed first keeps the parent's Codex registration and binder; then the parent restores stock", async () => {
		const stock = describeOwn("_bindExtensionCore");
		const stockDispose = describeOwn("dispose");
		const h = await openReloadable();
		const bound = describeOwn("_bindExtensionCore");
		assert.notDeepEqual(bound, stock);
		const codexRegistration = h.runtime.getRegisteredProviderConfig("openai-codex");
		assert.notEqual(codexRegistration, undefined, "the Codex registration is present before the child");
		const child = await h.child();
		try {
			child.dispose();
			assert.deepEqual(describeOwn("_bindExtensionCore"), bound, "the parent's binder stays active after the child is disposed");
			assert.notDeepEqual(describeOwn("_bindExtensionCore"), stock);
			assert.equal(h.runtime.getRegisteredProviderConfig("openai-codex"), codexRegistration, "the owned provider is still registered on the parent runtime");
			h.dispose();
			assert.deepEqual(describeOwn("_bindExtensionCore"), stock);
			assert.deepEqual(describeOwn("dispose"), stockDispose);
			assert.equal((describeOwn("_bindExtensionCore")?.value as Record<symbol, unknown>)[INNER], undefined);
		} finally {
			child.dispose();
			h.dispose();
		}
	});
});
