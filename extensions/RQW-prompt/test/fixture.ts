import "./guard.mjs";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText, getCurrentSystemMessage, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export const ROOT = resolve(import.meta.dirname, "../../..");
export const PROMPT = join(ROOT, "extensions/RQW-prompt/index.ts");
export const faux = fauxProvider({ provider: "prompt-regression-faux", models: [{ id: "one" }, { id: "two" }] });

export async function start({ systemPrompt, systemPromptOverride, extraFactory, tools, enabled = true }: {
	systemPrompt?: string; systemPromptOverride?: (base: string | undefined) => string | undefined;
	extraFactory?: ExtensionFactory; tools?: string[]; enabled?: boolean;
} = {}) {
	const dir = await mkdtemp(join(tmpdir(), "rqw-prompt-sdk-"));
	const cwd = join(dir, "work");
	const agentDir = join(dir, "agent");
	const skillDir = join(dir, "skill");
	await Promise.all([mkdir(cwd), mkdir(agentDir), mkdir(skillDir)]);
	await writeFile(join(cwd, "AGENTS.md"), "PROJECT_CONTEXT_SENTINEL");
	await writeFile(join(agentDir, "AGENTS.md"), "GLOBAL_CONTEXT_SENTINEL");
	await writeFile(join(skillDir, "SKILL.md"), "---\nname: prompt-regression\ndescription: SKILL_DESCRIPTION_SENTINEL\n---\nSKILL_BODY_NOT_AUTOLOADED\n");
	const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	runtime.registerNativeProvider(faux.provider);
	const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const loader = new DefaultResourceLoader({
		cwd, agentDir, settingsManager: settings, noExtensions: true,
		additionalExtensionPaths: enabled ? [PROMPT] : [],
		noSkills: true, additionalSkillPaths: [skillDir], noThemes: true, noPromptTemplates: true,
		systemPrompt, systemPromptOverride, appendSystemPrompt: ["APPEND_A_SENTINEL", "APPEND_B_SENTINEL"],
		extensionFactories: extraFactory ? [extraFactory] : [],
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({
		cwd, agentDir, model: faux.getModel(), thinkingLevel: "off", modelRuntime: runtime,
		resourceLoader: loader, settingsManager: settings, sessionManager: SessionManager.inMemory(cwd),
		...(tools ? { tools } : {}),
	});
	const errors: unknown[] = [];
	await session.bindExtensions({ onError: error => errors.push(error) });
	// Populate the configured-auth snapshot after binding; pi.setModel checks it synchronously.
	await runtime.setRuntimeApiKey(faux.provider.id, "faux-only");
	assert.equal(runtime.hasConfiguredAuth(faux.provider.id), true);
	async function capture() {
		let snapshot: { prompt: string; tools: string[]; model: string; sections: Record<string, string | null> | undefined } | undefined;
		faux.setResponses([(context, _options, _state, model) => {
			snapshot = {
				prompt: getCurrentSystemPrompt(context.messages),
				tools: getCurrentTools(context.messages).map(tool => tool.name),
				model: `${model.provider}/${model.id}`,
				sections: getCurrentSystemMessage(context.messages)?.sections,
			};
			return fauxAssistantMessage(fauxText("done"));
		}]);
		await session.prompt("go");
		assert.deepEqual(errors, []);
		assert.ok(snapshot);
		return snapshot;
	}
	return { session, loader, cwd, capture, async close() { session.dispose(); await rm(dir, { recursive: true, force: true }); } };
}

export function once(text: string, needle: string) {
	assert.equal(text.split(needle).length - 1, 1, needle);
}
