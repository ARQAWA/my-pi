import { codexModelCapabilities } from "../vendor/profile.ts";
import { UsageError, type SearchPlan } from "./types.ts";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;

const GPT_PROVIDER = "openai-codex";
const CLAUDE_PROVIDER = "anthropic";

/** Claude caller -> search model and the search effort for each supported caller thinking level. */
const CLAUDE: Record<string, { model: string; efforts: Record<string, string> }> = {
	"claude-opus-5-5": {
		model: "gpt-6.1-sol",
		efforts: { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high", ultra: "high" },
	},
	"claude-sonnet-5-5": {
		model: "gpt-6.1-terra",
		efforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh", ultra: "xhigh" },
	},
	"claude-haiku-5-5": {
		model: "gpt-5.6-luna",
		efforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh", ultra: "xhigh" },
	},
};
const CLAUDE_UNSUPPORTED = new Set(["off", "minimal"]);

function splitCaller(callerModel: string): { provider: string; id: string } {
	const slash = callerModel.indexOf("/");
	if (slash <= 0 || slash === callerModel.length - 1) return { provider: "", id: "" };
	return { provider: callerModel.slice(0, slash), id: callerModel.slice(slash + 1) };
}

function supportsEffort(model: string, effort: string): boolean {
	return codexModelCapabilities(model).supportedReasoningLevels.includes(effort as never);
}

function supportedEffort(model: string, effort: string): void {
	if (!supportsEffort(model, effort)) {
		throw new UsageError(`Search model ${model} does not support thinking level "${effort}".`);
	}
}

/** Known callers retain their mapping; missing or unknown callers use the fixed low-effort fallback. */
export function mapCaller(callerModel: string, thinking: string): SearchPlan {
	const { provider, id } = splitCaller(callerModel);
	if (provider === GPT_PROVIDER) {
		try {
			codexModelCapabilities(id);
		} catch {
			return { model: "gpt-6.1-sol", effort: "low" };
		}
		const effort = thinking === "off" && supportsEffort(id, "none") ? "none" : thinking;
		supportedEffort(id, effort);
		return { model: id, effort };
	}
	if (provider === CLAUDE_PROVIDER && Object.hasOwn(CLAUDE, id)) {
		const { model, efforts } = CLAUDE[id];
		if (CLAUDE_UNSUPPORTED.has(thinking) || !Object.hasOwn(efforts, thinking)) {
			throw new UsageError(`Unsupported: Claude thinking "${thinking}" has no search mapping. Use low or higher.`);
		}
		supportedEffort(model, efforts[thinking]);
		return { model, effort: efforts[thinking] };
	}
	return { model: "gpt-6.1-sol", effort: "low" };
}
