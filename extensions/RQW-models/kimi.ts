import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerKimiModels(pi: ExtensionAPI): void {
	// Exact K3.1 records: ~/.pi/agent/models-store.json, kimi-coding.models[2..3].
	// Official Kimi model docs confirm context, inputs and low/high/max reasoning.
	const models = [
		{ id: "k3.1-pro", name: "Kimi K3.1 Pro", cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 } },
		{ id: "k3.1-pro-highspeed", name: "Kimi K3.1 Pro Highspeed", cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0 } },
	].map((model) => ({
		...model,
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		contextWindow: 1048576,
		maxTokens: 131072,
		thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" },
		compat: {
			supportsStrictMode: false, supportsStore: false, supportsDeveloperRole: false,
			supportsReasoningEffort: true, maxTokensField: "max_tokens" as const, thinkingFormat: "openai" as const,
			requiresReasoningContentOnAssistantMessages: true,
			supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true,
		},
		inputLimits: { images: { resize: { maxWidth: 2000, maxHeight: 2000, maxBytes: 4718592, jpegQuality: 80 } } },
	}));
	// Pi keeps its built-in OAuth flow; only the catalog is extended through the public API.
	pi.registerProvider("kimi-coding", {
		api: "openai-completions",
		baseUrl: "https://api.kimi.com/coding/v1",
		models: [...getBuiltinModels("kimi-coding"), ...models],
	});
}
