import {
	type AssistantMessage, type Context, contentText, getSupportedThinkingLevels, type Model,
} from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

/** Preferred first, then fallback; `provider/model-id`. */
export const NAMING_MODELS = ["anthropic/claude-haiku-5-5", "openai-codex/gpt-6-luna"] as const;
export const NAME_COUNT = 10;
export const MAX_NAME_WORDS = 4;
export const MAX_NAME_CODE_POINTS = 32;

export type NamingRegistry = Pick<ModelRegistry, "getAvailableOfType" | "streamSimple">;
export type NamingSelection = { model: Model<any>; reasoning: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined };

const SYSTEM = "You name chat sessions. Follow the reply format exactly.";

/** A candidate is usable only if it is short enough in both words and code points, and has no control characters. */
export function isValidSessionName(name: string): boolean {
	const trimmed = name.trim();
	if (trimmed.length === 0) return false;
	if (/\p{Cc}/u.test(trimmed)) return false;
	if (trimmed.split(/\s+/).length > MAX_NAME_WORDS) return false;
	return Array.from(trimmed).length <= MAX_NAME_CODE_POINTS;
}

/** Lowest supported level of the model; `off` means no reasoning parameter. */
export function lowestReasoning(model: Model<any>): NamingSelection["reasoning"] {
	const level = getSupportedThinkingLevels(model)[0];
	return level === undefined || level === "off" ? undefined : level;
}

/** First authenticated model from NAMING_MODELS, via the public registry only. */
export async function selectNamingModel(registry: NamingRegistry, signal: AbortSignal): Promise<NamingSelection> {
	for (const key of NAMING_MODELS) {
		const slash = key.indexOf("/");
		const provider = key.slice(0, slash);
		const id = key.slice(slash + 1);
		if (signal.aborted) throw new Error("Naming aborted");
		let models: readonly Model<any>[];
		try { models = await registry.getAvailableOfType("chat", provider, { signal }); }
		catch { continue; } // A broken provider must not disable the fallback.
		signal.throwIfAborted();
		const model = models.find((m) => m.id === id);
		if (model) return { model, reasoning: lowestReasoning(model) };
	}
	throw new Error("No authenticated naming model");
}

function generationPrompt(context: string): string {
	return [
		`Read the conversation and propose exactly ${NAME_COUNT} different short names for this session.`,
		`Reply with only a JSON array of exactly ${NAME_COUNT} strings.`,
		`Each name must have at most ${MAX_NAME_WORDS} words and at most ${MAX_NAME_CODE_POINTS} Unicode code points, with no line breaks or control characters.`,
		"",
		"<conversation>",
		context,
		"</conversation>",
	].join("\n");
}

function selectionPrompt(context: string, candidates: string[]): string {
	return [
		"Choose the candidate name whose meaning best describes what the conversation is about.",
		"Judge by meaning only; do not prefer any position in the list.",
		"Reply with only the JSON integer index (0-based) of your choice.",
		"",
		"Candidates:",
		...candidates.map((name, index) => `${index}: ${name}`),
		"",
		"<conversation>",
		context,
		"</conversation>",
	].join("\n");
}

async function complete(registry: NamingRegistry, selected: NamingSelection, prompt: string, signal: AbortSignal): Promise<string> {
	signal.throwIfAborted();
	const context: Context = { systemPrompt: SYSTEM, messages: [{ role: "user", content: prompt, timestamp: 0 }] };
	const message: AssistantMessage = await registry.streamSimple(selected.model, context, { reasoning: selected.reasoning, signal }).result();
	signal.throwIfAborted();
	if (message.stopReason === "error" || message.stopReason === "aborted") throw new Error("Naming model call failed");
	return contentText(message.content);
}

/** Parse the generated array strictly; non-string items and invalid names are dropped, nothing is truncated. */
export function parseCandidates(text: string): string[] {
	const parsed: unknown = JSON.parse(text.trim());
	if (!Array.isArray(parsed) || parsed.length !== NAME_COUNT) throw new Error("Naming reply must contain exactly ten candidates");
	return parsed.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(isValidSessionName);
}

export function parseIndex(text: string, count: number): number {
	const parsed: unknown = JSON.parse(text.trim());
	if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < 0 || parsed >= count) {
		throw new Error("Naming selection is not a valid index");
	}
	return parsed;
}

/** One attempt: generate ten candidates, then select one by meaning. Persists, notifies and retries nothing. */
export async function generateSessionName(input: { context: string; registry: NamingRegistry; signal: AbortSignal }): Promise<string> {
	const { context, registry, signal } = input;
	if (signal.aborted) throw new Error("Naming aborted");
	const selected = await selectNamingModel(registry, signal);
	const candidates = parseCandidates(await complete(registry, selected, generationPrompt(context), signal));
	if (candidates.length === 0) throw new Error("No valid session names");
	const index = parseIndex(await complete(registry, selected, selectionPrompt(context, candidates), signal), candidates.length);
	return candidates[index];
}
