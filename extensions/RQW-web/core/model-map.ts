import { codexModelCapabilities } from "../vendor/profile.ts";
import { UsageError, type SearchPlan } from "./types.ts";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;

const GPT_PROVIDER = "openai-codex";
const CLAUDE_PROVIDER = "anthropic";
const same = (effort: string) => effort;
/** Opus: low stays low, medium goes to high, high to xhigh, and every level above high goes to max. */
function opusEffort(thinking: string): string {
	const steps: Record<string, string> = { low: "low", medium: "high", high: "xhigh" };
	return steps[thinking] ?? "max";
}

/** Claude caller -> search model. `effort` maps the caller's thinking to the search loop's effort. */
const CLAUDE: Record<string, { model: string; effort: (thinking: string) => string }> = {
	"claude-haiku-5-5": { model: "gpt-5.6-luna", effort: same },
	"claude-sonnet-5-5": { model: "gpt-6-sol", effort: same },
	"claude-opus-5-5": { model: "gpt-6.1-sol", effort: opusEffort },
};
const CLAUDE_UNSUPPORTED = new Set(["off", "minimal"]);

function splitCaller(callerModel: string): { provider: string; id: string } {
	const slash = callerModel.indexOf("/");
	if (slash <= 0 || slash === callerModel.length - 1) return { provider: "", id: "" };
	return { provider: callerModel.slice(0, slash), id: callerModel.slice(slash + 1) };
}

function supportedEffort(model: string, effort: string): void {
	if (!codexModelCapabilities(model).supportedReasoningLevels.includes(effort as never)) {
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
		supportedEffort(id, thinking);
		return { model: id, effort: thinking };
	}
	if (provider === CLAUDE_PROVIDER && Object.hasOwn(CLAUDE, id)) {
		if (CLAUDE_UNSUPPORTED.has(thinking) || !(THINKING_LEVELS as readonly string[]).includes(thinking)) {
			throw new UsageError(`Unsupported: Claude thinking "${thinking}" has no search mapping. Use low or higher.`);
		}
		const plan = { model: CLAUDE[id].model, effort: CLAUDE[id].effort(thinking) };
		supportedEffort(plan.model, plan.effort);
		return plan;
	}
	return { model: "gpt-6.1-sol", effort: "low" };
}
