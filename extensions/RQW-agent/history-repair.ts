import type { AssistantMessage, ToolCall, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";

/**
 * Repairs the tool-call pairing of a message array for one provider request.
 * Pure: it returns a copy and never touches the saved history. A turn is one assistant message
 * with the tool results that directly follow it; only that turn's results answer its calls.
 * Results without a call and repeated results are dropped. A call without a result is cut out of its
 * message, the other blocks stay, and a message left with nothing to say is dropped. Messages that
 * needed no repair are returned as the same objects, so a changed object marks a repaired one.
 * System messages are transparent, as in Pi's own request building: one inside a turn moves behind its results.
 */
export function repairHistory<T extends { role: string }>(messages: readonly T[]): T[] {
	const repaired: T[] = [];
	let index = 0;
	while (index < messages.length) {
		const message = messages[index++];
		// Results are consumed with their assistant message, so a result met here has no call before it.
		if (isToolResult(message)) continue;
		if (!isAssistant(message)) {
			repaired.push(message);
			continue;
		}
		const results: (T & ToolResultMessage)[] = [];
		const system: T[] = [];
		while (index < messages.length && (isToolResult(messages[index]) || messages[index].role === "system")) {
			const next = messages[index++];
			if (isToolResult(next)) results.push(next);
			else system.push(next);
		}
		const answered = answers(message, results);
		const kept = withoutUnanswered(message, new Set(answered.map(result => result.toolCallId)));
		repaired.push(...(kept ? [kept] : []), ...answered, ...system);
	}
	return repaired;
}

/** Request-only user line for a history that ends with an assistant message after a call was cut out; never saved. */
export const CONTINUE_NOTE = "continue; the removed call was not repeated";

export function continueNote(): UserMessage {
	return { role: "user", content: [{ type: "text", text: CONTINUE_NOTE }], timestamp: Date.now() };
}

/**
 * `repairHistory` for a request. Pi cannot continue after an assistant message, so when the repair
 * leaves an assistant message last because it cut a call at the end, `note` (the continue line) is appended.
 * That is the case when that message was cut down, or when an assistant message after it was dropped whole.
 * A finished assistant message is not touched.
 */
export function repairRequest<T extends { role: string }>(messages: readonly T[], note: T): T[] {
	const repaired = repairHistory(messages);
	const tail = repaired.at(-1);
	if (tail?.role !== "assistant") return repaired;
	const position = messages.lastIndexOf(tail);
	const tailWasCut = position === -1;
	const assistantDropped = !tailWasCut && messages.slice(position + 1).some(message => message.role === "assistant");
	if (tailWasCut || assistantDropped) repaired.push(note);
	return repaired;
}

/** The results that answer a call of the message, each call at most once, in their saved order. */
function answers<T extends ToolResultMessage>(message: AssistantMessage, results: T[]): T[] {
	const open = new Set<string>();
	for (const call of callsOf(message)) {
		if (open.has(call.id)) throw new Error(`Ambiguous history: tool call id ${call.id} appears twice in one assistant message`);
		open.add(call.id);
	}
	return results.filter(result => open.delete(result.toolCallId));
}

/** The message without its unanswered calls, or nothing when no text or call is left. */
function withoutUnanswered<T extends AssistantMessage>(message: T, answered: Set<string>): T | undefined {
	const content = message.content.filter(part => part.type !== "toolCall" || answered.has(part.id));
	if (content.length === message.content.length) return message;
	return content.some(isSubstantial) ? { ...message, content } : undefined;
}

/** Thinking alone is not a reply: a thinking block without its answer is invalid in a request. */
function isSubstantial(part: AssistantMessage["content"][number]): boolean {
	return part.type === "toolCall" || (part.type === "text" && part.text.trim() !== "");
}

function callsOf(message: AssistantMessage): ToolCall[] {
	return message.content.filter(part => part.type === "toolCall");
}

function isAssistant<T extends { role: string }>(message: T): message is T & AssistantMessage {
	return message.role === "assistant";
}

function isToolResult<T extends { role: string }>(message: T): message is T & ToolResultMessage {
	return message.role === "toolResult";
}
