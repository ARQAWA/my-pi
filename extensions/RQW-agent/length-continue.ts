// A response cut by the provider's output limit (stopReason "length") continues by itself, in the main chat and in every child.
// Pi's own turn_end boundary appends a hidden note and asks for one more request in the same run, so no timer is needed.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const LENGTH_CONTINUE_TYPE = "rqw-length-continue";
/** Cuts in a row after which the run stops with the error. */
export const LENGTH_CONTINUE_LIMIT = 3;
const NOTE = "Your last response was cut off by the output limit. Continue from where it stopped.";

/** Field on a cut response the harness continues; their end is not an error. It is saved with the message, so a reopened chat keeps it. */
const CONTINUED = "rqwContinued";
export const isContinuedCut = (message: object): boolean => (message as { stopReason?: string }).stopReason === "length" && (message as Record<string, unknown>)[CONTINUED] === true;

const blank = (part: { type: string; text?: string }) => part.type === "text" && !part.text?.trim();

/** A signed reasoning block with nothing after it cannot be replayed to the provider; a blank text block is dropped by it, so it counts as nothing. */
function withoutTrailingThinking<T extends { type: string; text?: string }>(content: T[]): T[] {
	let end = content.length;
	let dropped = false;
	while (end > 0 && (content[end - 1].type === "thinking" || blank(content[end - 1]))) {
		dropped ||= content[end - 1].type === "thinking";
		end--;
	}
	return dropped ? content.slice(0, end) : content;
}

export function continueOnLength(pi: ExtensionAPI): void {
	let cuts = 0;
	// A new run is a new count; the continuation itself stays inside the same run.
	pi.on("agent_start", () => { cuts = 0; });
	// Pi tells extensions about a message before it tells the screen and the child's activity, and saves what they return.
	pi.on("message_end", event => {
		const message = event.message;
		if (message.role !== "assistant") return undefined;
		if (message.stopReason !== "length") { cuts = 0; return undefined; }
		const last = ++cuts >= LENGTH_CONTINUE_LIMIT;
		// The last cut ends the run: Pi would fail its truncated tool calls and ask again, so they are dropped.
		const kept = last ? message.content.filter(part => part.type !== "toolCall") : message.content;
		const content = withoutTrailingThinking(kept);
		if (last) return content.length === message.content.length ? undefined : { message: { ...message, content } };
		return { message: { ...message, content, [CONTINUED]: true } as typeof message };
	});
	pi.on("turn_end", event => {
		if (!isContinuedCut(event.message)) return undefined;
		return { entries: [...event.entries, { type: "custom_message" as const, customType: LENGTH_CONTINUE_TYPE, content: NOTE, display: false }], continue: true };
	});
}
