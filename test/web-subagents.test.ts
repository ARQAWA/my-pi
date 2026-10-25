import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createWebExtension } from "../extensions/RQW-web/index.ts";
import type { TargetRun } from "../extensions/RQW-web/core/types.ts";

const AGENT = join(import.meta.dirname, "..", "extensions", "RQW-agent", "index.ts");
const call = (name: string, args: object) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const answer = (text: string) => () => fauxAssistantMessage(text);

async function fixture(web: boolean) {
	const dir = await mkdtemp(join(tmpdir(), "rqw-web-subagents-"));
	await writeFile(join(dir, "auth.json"), "{}");
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	await runtime.refresh({ allowNetwork: false });
	const main = fauxProvider({ provider: "openai-codex", api: "web-parent-faux", models: [{ id: "gpt-6.1-sol", reasoning: true }] });
	const child = fauxProvider({ provider: "anthropic", api: "web-child-faux", models: [{ id: "claude-sonnet-5-5", reasoning: true }] });
	const grand = fauxProvider({ provider: "web-unknown", api: "web-grand-faux", models: [{ id: "custom", reasoning: true }] });
	for (const provider of [main, child, grand]) {
		provider.provider.auth.apiKey = { name: "Faux", resolve: async () => ({ auth: { apiKey: "fake-only" } }) };
		runtime.registerNativeProvider(provider.provider);
	}
	const runs: TargetRun[] = [];
	const seen: { depth: string; web: boolean }[] = [];
	const first = (depth: string, query: string) => (context: any) => {
		const names = getCurrentTools(context.messages).map(tool => tool.name);
		seen.push({ depth, web: names.includes("web") });
		return web ? call("web", { queries: [query] }) : fauxAssistantMessage(`${depth} no web`);
	};
	main.setResponses([
		...(web ? [() => call("web", { queries: ["parent"] })] : []),
		() => call("agent", { action: "start", task: "child task", model: "anthropic/claude-sonnet-5-5", thinking: "high", fast_gpt: false }),
		() => call("agent", { action: "wait", ids: ["agent#1"], blocking: true, timeout_ms: 10000 }),
		answer("parent done"),
	]);
	child.setResponses([
		first("child", "child"),
		...(web ? [
			() => call("agent", { action: "start", task: "grand task", model: "web-unknown/custom", thinking: "medium", fast_gpt: false }),
			() => call("agent", { action: "wait", ids: ["agent#1"], blocking: true, timeout_ms: 10000 }),
			answer("child done"),
		] : []),
	]);
	grand.setResponses([first("grandchild", "grandchild"), answer("grand done")]);
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, additionalExtensionPaths: [AGENT],
		extensionFactories: web ? [createWebExtension({ runner: async run => {
			runs.push(run);
			return { target: run.target, model: run.model, effort: run.effort, mode: run.mode, responseLength: run.responseLength,
				status: "ok", summary: "[Docs](https://example.com/docs)", sources: [{ url: "https://example.com/docs" }], citations: [], actions: [], results: [] };
		} })] : [],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: main.getModel("gpt-6.1-sol"),
		thinkingLevel: "low", resourceLoader: loader, sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }) });
	await session.bindExtensions({ mode: "tui" });
	return { session, runs, seen, async close() {
		try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); }
		finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
			await rm(dir, { recursive: true, force: true });
		}
	} };
}

it("web reaches a real child and grandchild with each caller's model and thinking, without RQW-tools or RQW-codex", async () => {
	const h = await fixture(true);
	try {
		await h.session.prompt("Run the scripted searches");
		assert.deepEqual(h.seen, [{ depth: "child", web: true }, { depth: "grandchild", web: true }]);
		assert.deepEqual(h.runs.map(run => [run.target.value, run.model, run.effort]), [
			["parent", "gpt-6.1-sol", "low"], ["child", "gpt-6-sol", "high"], ["grandchild", "gpt-6.1-sol", "low"],
		]);
	} finally { await h.close(); }
});

it("with RQW-web absent neither the main session nor its child receives web", async () => {
	const h = await fixture(false);
	try {
		assert.equal(h.session.getToolDefinition("web"), undefined);
		await h.session.prompt("Run the scripted child");
		assert.deepEqual(h.seen, [{ depth: "child", web: false }]);
		assert.deepEqual(h.runs, []);
	} finally { await h.close(); }
});
