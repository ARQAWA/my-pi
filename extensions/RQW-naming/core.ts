import {
	type AssistantMessage, type Context, contentText, type Model, type TextContent,
} from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

const NAMING_MODELS: Record<string, string> = {
	anthropic: "claude-haiku-5-5",
	"openai-codex": "gpt-5.6-luna",
};
export const NAMING_REASONING = "low" as const;
export const NAME_COUNT = 10;
export const MAX_NAME_WORDS = 4;
export const MAX_NAME_CODE_POINTS = 32;

export type NamingMessage = { role: "user" | "assistant"; content: string };
export type NamingRegistry = Pick<ModelRegistry, "getAvailableOfType" | "streamSimple">;
export type NamingSelection = { model: Model<any>; reasoning: typeof NAMING_REASONING };

const SYSTEM = "You name chat sessions. Follow the reply format exactly.";

/** A candidate is usable only if it is short enough in both words and code points. */
export function isValidSessionName(name: string): boolean {
	const trimmed = name.trim();
	if (trimmed.length === 0) return false;
	if (trimmed.split(/\s+/).length > MAX_NAME_WORDS) return false;
	return Array.from(trimmed).length <= MAX_NAME_CODE_POINTS;
}

/** Resolve only the selected model through the public registry; there is no fallback. */
export async function selectNamingModel(registry: NamingRegistry, signal: AbortSignal, provider: string | undefined): Promise<NamingSelection> {
	signal.throwIfAborted();
	const id = provider && NAMING_MODELS[provider];
	if (!provider || !id) throw new Error("No naming model for the session provider");
	const models = await registry.getAvailableOfType("chat", provider, { signal });
	signal.throwIfAborted();
	const model = models.find((m) => m.id === id);
	if (!model) throw new Error("No authenticated naming model");
	return { model, reasoning: NAMING_REASONING };
}

function generationPrompt(messages: NamingMessage[]): TextContent[] {
	const intro: TextContent = { type: "text", text: [
		`Read the conversation and propose 1 to ${NAME_COUNT} different short names for this session.`,
		"Rank them by how well their meaning describes the conversation, best first.",
		"Reply with only a JSON array of strings.",
		`Each name must have at most ${MAX_NAME_WORDS} words and at most ${MAX_NAME_CODE_POINTS} Unicode code points.`,
		"<conversation>",
	].join("\n") };
	// Pi estimates 3.5 characters per token; bytes are conservative for non-ASCII text.
	let budget = 50000 * 3.5;
	const recent: TextContent[] = [];
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		let text = JSON.stringify(message);
		let cost = Buffer.byteLength(text);
		if (cost > budget) {
			const bytes = Buffer.from(message.content);
			let low = Math.max(0, bytes.length - budget);
			let high = bytes.length;
			while (low < high) {
				const middle = Math.floor((low + high) / 2);
				text = JSON.stringify({ role: message.role, content: bytes.subarray(middle).toString("utf8") });
				if (Buffer.byteLength(text) <= budget) high = middle;
				else low = middle + 1;
			}
			while (low < bytes.length && (bytes[low] & 0xc0) === 0x80) low++;
			text = JSON.stringify({ role: message.role, content: bytes.subarray(low).toString("utf8") });
			if (low < bytes.length && Buffer.byteLength(text) <= budget) recent.push({ type: "text", text });
			break;
		}
		recent.push({ type: "text", text });
		budget -= cost;
	}
	return [intro, ...recent.reverse(), { type: "text", text: "</conversation>" }];
}

async function complete(registry: NamingRegistry, selected: NamingSelection, prompt: TextContent[], signal: AbortSignal): Promise<string> {
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
	if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > NAME_COUNT) throw new Error("Naming reply must contain one to ten candidates");
	return parsed.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(isValidSessionName);
}

/** One request generates and ranks candidates; use the best valid name. */
export async function generateSessionName(input: { context: NamingMessage[]; registry: NamingRegistry; signal: AbortSignal; provider: string | undefined }): Promise<string> {
	const { context, registry, signal, provider } = input;
	if (signal.aborted) throw new Error("Naming aborted");
	const selected = await selectNamingModel(registry, signal, provider);
	const candidates = parseCandidates(await complete(registry, selected, generationPrompt(context), signal));
	if (candidates.length === 0) throw new Error("No valid session names");
	return candidates[0];
}
