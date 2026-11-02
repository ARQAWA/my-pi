// A response cut by the provider's output limit (stopReason "length") continues by itself, in the main chat and in every child.
// Pi's own turn_end boundary appends a hidden note and asks for one more request in the same run, so no timer is needed.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const LENGTH_CONTINUE_TYPE = "rqw-length-continue";
/** Cuts in a row after which the run stops with the error. */
export const LENGTH_CONTINUE_LIMIT = 3;
const NOTE = "Your last response was cut off by the output limit. Continue from where it stopped.";

/** Cut responses the harness continued; their end is not an error. */
export const continuedCuts = new WeakSet<object>();

export function continueOnLength(pi: ExtensionAPI): void {
	let cuts = 0;
	// A new run is a new count; the continuation itself stays inside the same run.
	pi.on("agent_start", () => { cuts = 0; });
	pi.on("turn_end", event => {
		const message = event.message;
		if (message.role !== "assistant" || message.stopReason !== "length") { cuts = 0; return undefined; }
		if (++cuts >= LENGTH_CONTINUE_LIMIT) return undefined;
		continuedCuts.add(message);
		return { entries: [...event.entries, { type: "custom_message" as const, customType: LENGTH_CONTINUE_TYPE, content: NOTE, display: false }], continue: true };
	});
}
