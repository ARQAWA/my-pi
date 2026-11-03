import { UsageError, type SearchPlan } from "./types.ts";

const LEVELS = ["off", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export function mapCaller(callerModel: string, thinking: string): SearchPlan {
	let model = "gpt-6.1-terra";
	let minimum = 4;
	let step = 0;
	switch (callerModel) {
		case "openai-codex/gpt-6.1-sol":
		case "openai-codex/gpt-6-sol":
		case "anthropic/claude-opus-5-5":
			step = 1;
			break;
		case "openai-codex/gpt-6.1-terra":
		case "anthropic/claude-sonnet-5-5":
			break;
		case "openai-codex/gpt-6-luna":
			model = "gpt-6-luna";
			minimum = 3;
			break;
		case "openai-codex/gpt-5.6-luna":
		case "anthropic/claude-haiku-5-5":
			model = "gpt-5.6-luna";
			minimum = 3;
			break;
		default:
			return { model, effort: "medium" };
	}
	const level = LEVELS.indexOf(thinking);
	if (level < 0) throw new UsageError(`Unsupported thinking level "${thinking}".`);
	return { model, effort: LEVELS[Math.min(6, Math.max(minimum, level + step))] };
}
