import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function fauxModels(pi: ExtensionAPI) {
	globalThis.fetch = async () => { throw new Error("Network is forbidden in RQW-models faux CLI tests"); };
	for (const [provider, ids] of [
		["anthropic", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]],
		["openai-codex", ["gpt-6.1-sol", "gpt-6-sol", "gpt-5.6-luna", "gpt-6-luna", "gpt-5.3-codex-spark"]],
	] as const) {
		const faux = fauxProvider({ provider, models: ids.map((id) => ({ id, reasoning: true })) });
		for (const model of faux.models) model.thinkingLevelMap = { xhigh: "xhigh", max: "max" };
		faux.provider.auth.apiKey = provider === "anthropic" && process.env.RQW_TEST_NO_ANTHROPIC
			? undefined
			: { name: "Faux", resolve: async () => ({ auth: { apiKey: "faux-only" } }) };
		faux.setResponses([(_context, _options, _state, model) => fauxAssistantMessage(JSON.stringify({
			provider: model.provider, model: model.id, thinking: pi.getThinkingLevel(),
		}))]);
		pi.registerProvider(faux.provider);
	}
}
