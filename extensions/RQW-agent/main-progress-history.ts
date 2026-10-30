import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const COUNTER_ENTRY = "rqw-main-progress-counter-v1";
export const WINDOW_STEPS = 65;
export type Counter = { stepOrdinal: number; silentCount: number; sourceToolCallId: string };
type Manager = ExtensionContext["sessionManager"];
export type Step = { message: AssistantMessage; results: Map<string, ToolResultMessage> };

export function hasText(message: AssistantMessage): boolean {
	return message.content.some(part => part.type === "text" && part.text.trim() !== "");
}

export function isStep(message: AssistantMessage): boolean {
	return message.stopReason === "toolUse" && message.content.some(part => part.type === "toolCall");
}

export function sourceId(message: AssistantMessage): string {
	return message.content.find(part => part.type === "toolCall")?.id ?? "";
}

function counter(value: unknown): value is Counter {
	if (!value || typeof value !== "object") return false;
	const c = value as Counter;
	return Number.isSafeInteger(c.stepOrdinal) && c.stepOrdinal > 0
		&& Number.isSafeInteger(c.silentCount) && c.silentCount >= 0 && c.silentCount <= c.stepOrdinal
		&& typeof c.sourceToolCallId === "string";
}

/** One walk per threshold/resume, never per frame. Entry count is uncapped: sparse branches can reach the root. */
export function collect(manager: Manager, current?: AssistantMessage): { steps: Step[]; counter: Omit<Counter, "sourceToolCallId"> } {
	const steps: Step[] = [];
	const results = new Map<string, ToolResultMessage>();
	const seen = new Map<string, { newerSteps: number; silentTail: number; reset: boolean }>();
	let silentTail = 0;
	let reset = false;
	let restored: Omit<Counter, "sourceToolCallId"> | undefined;
	const visit = (message: AssistantMessage) => {
		const id = sourceId(message);
		if (id && seen.has(id)) return;
		if (isStep(message)) {
			// A checkpoint is written in message_end, before this source response is persisted.
			// These values describe only records newer than the source, so it is never applied twice.
			seen.set(id, { newerSteps: steps.length, silentTail, reset });
			const matched = new Map<string, ToolResultMessage>();
			for (const part of message.content) if (part.type === "toolCall") {
				const result = results.get(part.id);
				if (result) { matched.set(part.id, result); results.delete(part.id); }
			}
			steps.push({ message, results: matched });
		}
		if (hasText(message)) reset = true;
		else if (!reset && isStep(message)) silentTail++;
	};
	if (current) visit(current);
	let entry = manager.getLeafEntry();
	while (entry && steps.length < WINDOW_STEPS) {
		if (entry.type === "message") {
			if (entry.message.role === "assistant") visit(entry.message);
			else if (entry.message.role === "toolResult") results.set(entry.message.toolCallId, entry.message);
		} else if (!restored && entry.type === "custom" && entry.customType === COUNTER_ENTRY && counter(entry.data)) {
			const source = seen.get(entry.data.sourceToolCallId);
			if (source) restored = {
				stepOrdinal: entry.data.stepOrdinal + source.newerSteps,
				silentCount: source.reset ? source.silentTail : entry.data.silentCount + source.silentTail,
			};
		}
		if (steps.length >= WINDOW_STEPS) break;
		entry = entry.parentId ? manager.getEntry(entry.parentId) : undefined;
	}
	return { steps: steps.reverse(), counter: restored ?? { stepOrdinal: steps.length, silentCount: silentTail } };
}

function clipped(text: string, limit: number): string {
	return text.length <= limit ? text : text.slice(0, limit) + "...";
}

/** Bound fields before JSON.stringify; never serialize an arbitrary full argument or tool output. */
function preview(value: unknown, limit: number, depth = 0): unknown {
	if (typeof value === "string") return clipped(value, limit);
	if (value === null || typeof value === "number" || typeof value === "boolean") return value;
	if (!value || typeof value !== "object") return String(value);
	if (depth >= 2) return "[omitted]";
	if (Array.isArray(value)) return value.slice(0, 4).map(item => preview(item, Math.floor(limit / 4), depth + 1));
	const out: Record<string, unknown> = Object.create(null);
	let count = 0;
	for (const key in value) {
		if (!Object.hasOwn(value, key)) continue;
		if (count++ >= 4) break;
		out[clipped(key, 40)] = preview((value as Record<string, unknown>)[key], Math.floor(limit / 4), depth + 1);
	}
	return out;
}

function resultStatus(result: ToolResultMessage | undefined): string {
	if (!result) return "running";
	const details = result.details as { job?: { state?: string }; reason?: string } | undefined;
	if (details?.job?.state === "running" || details?.reason === "waiting") return "running";
	return result.isError ? "error" : "success";
}

export function snapshot(steps: Step[], lastStep: number, budget: number): string | undefined {
	for (let limit = 128; limit >= 0; limit = limit > 0 ? Math.floor(limit / 2) : -1) {
		const records = steps.map((step, index) => {
			const calls = step.message.content.filter(part => part.type === "toolCall");
			const kept = calls.slice(0, limit === 0 ? 0 : 4);
			return {
				step: lastStep - steps.length + index + 1,
				calls: kept.map(call => {
					const result = step.results.get(call.id);
					return { name: clipped(call.name, 64), status: resultStatus(result),
						argsPreview: preview(call.arguments, limit),
						resultPreview: result ? result.content.slice(0, 2).map(part => part.type === "text" ? clipped(part.text, limit) : `[${part.type}]`) : [],
					};
				}),
				omittedCalls: calls.length - kept.length,
				truncated: true,
			};
		});
		const text = JSON.stringify(records);
		if (Buffer.byteLength(text) <= budget) return text;
	}
	return undefined;
}
