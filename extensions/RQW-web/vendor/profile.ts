// Adapted from extensions/RQW-codex/profile.ts at git commit a85b810e924010f35387045fc0cbbd9a1e7173cc.
// Narrowed extraction: subscription endpoint, bounded HTTP retries and web-only offline model capabilities.
export const CODEX_PROVIDER = "openai-codex";
export const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
export const CODEX_RETRY = { requestMaxRetries: 4, requestBaseDelayMs: 200 } as const;

export type CodexModelCapabilities = {
	slug: string;
	useResponsesLite: boolean;
	defaultReasoningLevel: string;
	supportedReasoningLevels: readonly string[];
	supportsReasoningSummaryParameter: boolean;
	defaultReasoningSummary: "none";
	supportVerbosity: boolean;
	defaultVerbosity: "low";
};

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const item of Object.values(value)) deepFreeze(item);
	}
	return value;
}

const LEVELS_6 = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
const LEVELS_5 = ["low", "medium", "high", "xhigh", "max"] as const;

const MODELS: Readonly<Record<string, CodexModelCapabilities>> = deepFreeze({
	"gpt-6.1-sol": {
		slug: "gpt-6.1-sol",
		useResponsesLite: true,
		defaultReasoningLevel: "low",
		supportedReasoningLevels: LEVELS_6,
		supportsReasoningSummaryParameter: true,
		defaultReasoningSummary: "none",
		supportVerbosity: true,
		defaultVerbosity: "low",
	},
	"gpt-6.1-terra": {
		slug: "gpt-6.1-terra",
		useResponsesLite: true,
		defaultReasoningLevel: "low",
		supportedReasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"],
		supportsReasoningSummaryParameter: true,
		defaultReasoningSummary: "none",
		supportVerbosity: true,
		defaultVerbosity: "low",
	},
	"gpt-6-sol": {
		slug: "gpt-6-sol",
		useResponsesLite: true,
		defaultReasoningLevel: "medium",
		supportedReasoningLevels: LEVELS_6,
		supportsReasoningSummaryParameter: true,
		defaultReasoningSummary: "none",
		supportVerbosity: true,
		defaultVerbosity: "low",
	},
	"gpt-6-luna": {
		slug: "gpt-6-luna",
		useResponsesLite: true,
		defaultReasoningLevel: "medium",
		supportedReasoningLevels: LEVELS_5,
		supportsReasoningSummaryParameter: true,
		defaultReasoningSummary: "none",
		supportVerbosity: true,
		defaultVerbosity: "low",
	},
	"gpt-5.6-luna": {
		slug: "gpt-5.6-luna",
		useResponsesLite: true,
		defaultReasoningLevel: "medium",
		supportedReasoningLevels: LEVELS_5,
		supportsReasoningSummaryParameter: true,
		defaultReasoningSummary: "none",
		supportVerbosity: true,
		defaultVerbosity: "low",
	},
});

export const CODEX_MODEL_SLUGS: readonly string[] = Object.freeze(Object.keys(MODELS));

/** Exact-slug lookup, offline. Unknown slugs fail without model discovery or alias guessing. */
export function codexModelCapabilities(slug: string): CodexModelCapabilities {
	if (!Object.hasOwn(MODELS, slug)) {
		throw new Error(`RQW-web: no pinned Codex 0.163.0 capability record for model "${slug}". Known: ${CODEX_MODEL_SLUGS.join(", ")}.`);
	}
	return MODELS[slug];
}
