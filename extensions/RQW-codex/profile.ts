// RQW-codex pinned profile (stage 1): constants and offline capability records derived from upstream
// Codex stable source. Nothing here touches the network, the credential store or Pi's runtime.
// Source evidence and digests: test/fixtures/oracle-source.json and test/fixtures/stable-models.json.

export const CODEX_PIN = {
	release: "rust-v0.163.0",
	version: "0.163.0",
	commit: "83086188ae0614bd882818ff1aa23f3194962012",
	commitDate: "2026-10-15T18:57:07Z",
} as const;

/** Pi provider identity kept from stock Pi 1.4.0 so saved credentials and models continue to work. */
export const CODEX_PROVIDER = "openai-codex";
export const CODEX_API = "openai-codex-responses";

/** Codex subscription inference endpoint (source: model-provider-info CHATGPT_CODEX_BASE_URL + /responses). */
export const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";

/** Owner decision: identity is codex_cli_rs 0.163.0 with truthful git and workspace metadata. */
export const CODEX_IDENTITY = {
	originator: "codex_cli_rs",
	clientVersion: CODEX_PIN.version,
	metadataPolicy: "truthful-git-workspace",
} as const;

/** Stable defaults. Each value is a source-verified default, see oracle-source.json feature.* assertions. */
export type CodexFeatures = {
	reasoningEffortOverride: boolean;
	incrementalTools: boolean;
	remoteCompactionV2: boolean;
};

export const CODEX_STABLE_FEATURES: Readonly<CodexFeatures> = Object.freeze({
	reasoningEffortOverride: false,
	incrementalTools: false,
	remoteCompactionV2: true,
});

/** Explicit profile: stable defaults with the given overrides applied. Defaults are never changed silently. */
export function codexFeatures(overrides: Partial<CodexFeatures> = {}): CodexFeatures {
	return deepFreeze({ ...CODEX_STABLE_FEATURES, ...overrides });
}

/** Freezes a value and everything reachable from it, so returned profile data cannot be mutated by callers. */
function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const item of Object.values(value)) deepFreeze(item);
	}
	return value;
}

export const CODEX_TIMEOUTS = {
	websocketConnectMs: 15_000,
	/** Per SSE event or WebSocket message idle limit, not a total response deadline. */
	streamIdleMs: 300_000,
} as const;

export const CODEX_RETRY = {
	/** HTTP request retries (loop 0..=4 gives up to 5 attempts); 5xx and transport only, not 429. */
	requestMaxRetries: 4,
	requestBaseDelayMs: 200,
	requestRetry429: false,
	requestRetry5xx: true,
	requestRetryTransport: true,
	/** Per sampling request stream retries before sticky SSE fallback. */
	streamMaxRetries: 5,
	/** Owner decision: connection-failed sampling retries without a bound, 5 s doubling to a 60 s cap. */
	connectionRetryInitialMs: 5_000,
	connectionRetryMaxMs: 60_000,
	unboundedConnectionRetries: true,
} as const;

/** Connection-retry wait before retry number `retryIndex` (0-based): 5 s, 10 s, 20 s, 40 s, then 60 s. */
export function connectionRetryDelayMs(retryIndex: number): number {
	if (!Number.isSafeInteger(retryIndex) || retryIndex < 0) throw new RangeError("retryIndex must be a non-negative integer");
	let delay = CODEX_RETRY.connectionRetryInitialMs;
	for (let i = 0; i < retryIndex && delay < CODEX_RETRY.connectionRetryMaxMs; i++) delay *= 2;
	return Math.min(delay, CODEX_RETRY.connectionRetryMaxMs);
}

/** Owner decision: startup prewarm once at startup and once after idle; no periodic keepalive. */
export const CODEX_PREWARM = {
	policy: "startup-and-idle-once",
	generateFalse: true,
} as const;

/** Backend V2 compaction: the trigger item is native; thresholds stay with RQW-context (W/R). */
export const CODEX_COMPACTION = {
	backendTrigger: "compaction_trigger",
	v2StreamRetries: 2,
	thresholdOwner: "RQW-context",
} as const;

export const CODEX_HEADERS = {
	openAiBetaWebsocket: "responses_websockets=2026-02-06",
	betaFeatures: "remote_compaction_v2",
	turnState: "x-codex-turn-state",
	windowId: "x-codex-window-id",
} as const;

export const CODEX_ZSTD_LEVEL = 3;

export const CODEX_DEVICE_LOGIN = {
	userCodePath: "/deviceauth/usercode",
	pollPath: "/deviceauth/token",
	verificationPath: "/codex/device",
} as const;

export const MODELS_JSON_SHA256 = "943ca7fe1d19ed019054158303f0dbbd80b3bef43b3aa425a71aa7cb3fb52c2b";

export type CodexModelCapabilities = {
	slug: string;
	displayName: string;
	/** use_responses_lite: Lite request shape (additional_tools prefix). Native Lite sends parallel_tool_calls false; RQW-codex always sends true ([D-CODEX-PARALLEL]). */
	useResponsesLite: boolean;
	defaultReasoningLevel: string;
	supportedReasoningLevels: readonly string[];
	supportsReasoningSummaryParameter: boolean;
	supportsReasoningSummaries: boolean;
	defaultReasoningSummary: string;
	supportVerbosity: boolean;
	defaultVerbosity: string;
	/** Absent in source means false (serde default). */
	supportsReasoningEffortUpdates: boolean;
	defaultServiceTier: string | null;
	serviceTiers: readonly string[];
	additionalSpeedTiers: readonly string[];
	/** Native compaction hash, source comp_hash (informational, not a RQW threshold). */
	compactionHash: string;
	/** Source supports_parallel_tool_calls. */
	supportsParallelToolCalls: boolean;
	/** Source input_modalities. */
	inputModalities: readonly string[];
	/**
	 * Source context_window. Informational/native preparation only: it does NOT replace the Pi/RQW-context
	 * physical limit (RQW-context owns W = min(contextWindow, 500000) and the R reserve).
	 */
	contextWindow: number;
	/** sha256 of JSON.stringify of the full source record in models.json. */
	sourceRecordSha256: string;
};

const LEVELS_6 = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
const LEVELS_5 = ["low", "medium", "high", "xhigh", "max"] as const;

const MODELS: Readonly<Record<string, CodexModelCapabilities>> = deepFreeze({
	"gpt-6.1-sol": {
		slug: "gpt-6.1-sol",
		displayName: "GPT-6.1-Sol",
		useResponsesLite: true,
		defaultReasoningLevel: "low",
		supportedReasoningLevels: LEVELS_6,
		supportsReasoningSummaryParameter: true,
		supportsReasoningSummaries: true,
		defaultReasoningSummary: "none",
		supportVerbosity: true,
		defaultVerbosity: "low",
		supportsReasoningEffortUpdates: true,
		defaultServiceTier: null,
		serviceTiers: ["priority"],
		additionalSpeedTiers: ["fast"],
		compactionHash: "3000",
		supportsParallelToolCalls: true,
		inputModalities: ["text", "image"],
		contextWindow: 272000,
		sourceRecordSha256: "9e7f6bcc65c0cf9e86cc97290447922e3b3834e54f4036a5ab916a4d5e2f9117",
	},
	"gpt-6.1-terra": {
		slug: "gpt-6.1-terra",
		displayName: "GPT-6.1-Terra",
		useResponsesLite: true,
		defaultReasoningLevel: "low",
		supportedReasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"],
		supportsReasoningSummaryParameter: true,
		supportsReasoningSummaries: true,
		defaultReasoningSummary: "none",
		supportVerbosity: true,
		defaultVerbosity: "low",
		supportsReasoningEffortUpdates: true,
		defaultServiceTier: null,
		serviceTiers: ["priority"],
		additionalSpeedTiers: ["fast"],
		compactionHash: "3000",
		supportsParallelToolCalls: true,
		inputModalities: ["text", "image"],
		contextWindow: 1050000,
		sourceRecordSha256: "9e7f6bcc65c0cf9e86cc97290447922e3b3834e54f4036a5ab916a4d5e2f9117",
	},
	"gpt-6-sol": {
		slug: "gpt-6-sol",
		displayName: "GPT-6-Sol",
		useResponsesLite: true,
		defaultReasoningLevel: "medium",
		supportedReasoningLevels: LEVELS_6,
		supportsReasoningSummaryParameter: true,
		supportsReasoningSummaries: true,
		defaultReasoningSummary: "none",
		supportVerbosity: true,
		defaultVerbosity: "low",
		supportsReasoningEffortUpdates: false,
		defaultServiceTier: "priority",
		serviceTiers: ["priority"],
		additionalSpeedTiers: ["fast"],
		compactionHash: "3000",
		supportsParallelToolCalls: true,
		inputModalities: ["text", "image"],
		contextWindow: 272000,
		sourceRecordSha256: "2a90be92a7ccf529b5ab0aa45fa818d3bfa22eba39a35b82b849a45b12c8dfc6",
	},
	"gpt-6-luna": {
		slug: "gpt-6-luna",
		displayName: "GPT-6-Luna",
		useResponsesLite: true,
		defaultReasoningLevel: "medium",
		supportedReasoningLevels: LEVELS_5,
		supportsReasoningSummaryParameter: true,
		supportsReasoningSummaries: true,
		defaultReasoningSummary: "none",
		supportVerbosity: true,
		defaultVerbosity: "low",
		supportsReasoningEffortUpdates: false,
		defaultServiceTier: "priority",
		serviceTiers: ["priority"],
		additionalSpeedTiers: ["fast"],
		compactionHash: "3000",
		supportsParallelToolCalls: true,
		inputModalities: ["text", "image"],
		contextWindow: 272000,
		sourceRecordSha256: "ef6741ee667bd7f34a9019f4a9aff3bbce2b50e654f3e75399b785692b44b405",
	},
	"gpt-5.6-luna": {
		slug: "gpt-5.6-luna",
		displayName: "GPT-5.6-Luna",
		useResponsesLite: true,
		defaultReasoningLevel: "medium",
		supportedReasoningLevels: LEVELS_5,
		supportsReasoningSummaryParameter: true,
		supportsReasoningSummaries: true,
		defaultReasoningSummary: "none",
		supportVerbosity: true,
		defaultVerbosity: "low",
		supportsReasoningEffortUpdates: false,
		defaultServiceTier: null,
		serviceTiers: ["priority"],
		additionalSpeedTiers: ["fast"],
		compactionHash: "3000",
		supportsParallelToolCalls: true,
		inputModalities: ["text", "image"],
		contextWindow: 272000,
		sourceRecordSha256: "b59c5856eed538d5127c5c115c78921c37e931303a7590f1ab3b8b436e3f72a6",
	},
});

/** The GPT slugs of the RQW models list (RQW-models FAMILIES, GPT entries). Every one has a pinned record. */
export const CODEX_MODEL_SLUGS: readonly string[] = Object.freeze(Object.keys(MODELS));

/** Exact-slug lookup, offline. Unknown slugs fail; there is no prefix, alias or case guessing. */
export function codexModelCapabilities(slug: string): CodexModelCapabilities {
	if (!Object.hasOwn(MODELS, slug)) {
		throw new Error(
			`RQW-codex: no pinned Codex ${CODEX_PIN.version} capability record for model "${slug}". ` +
				`Lookup is by exact slug (no prefix guessing, no /models discovery). Known: ${CODEX_MODEL_SLUGS.join(", ")}.`,
		);
	}
	return MODELS[slug];
}

/** Effort updates are used only when the feature is explicitly enabled AND the model's source record allows them. */
export function effortUpdatesActive(slug: string, features: CodexFeatures = CODEX_STABLE_FEATURES): boolean {
	return features.reasoningEffortOverride && codexModelCapabilities(slug).supportsReasoningEffortUpdates;
}

export const CODEX_SNAPSHOT_ID = `${CODEX_PIN.commit}:${MODELS_JSON_SHA256}`;

/** Identity of the pinned offline profile: same pin, same models.json digest, same records. */
export function codexProfileSnapshot() {
	return deepFreeze({
		id: CODEX_SNAPSHOT_ID,
		pin: { ...CODEX_PIN },
		modelsJsonSha256: MODELS_JSON_SHA256,
		endpoint: CODEX_ENDPOINT,
		models: CODEX_MODEL_SLUGS,
	});
}

/** [D-CODEX-LUNA-FAST] Luna models always run on the Fast (priority) tier; no setting or hook turns it off. */
export const ALWAYS_FAST_MODELS: ReadonlySet<string> = new Set(["gpt-6-luna", "gpt-5.6-luna"]);
