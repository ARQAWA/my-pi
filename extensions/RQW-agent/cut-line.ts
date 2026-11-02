// Hides Pi's red "Response was truncated before completion." under a cut the harness continues (length-continue.ts).
// The message stays a `length` message in the session; it is drawn as a finished one. The last cut, which stops the run, keeps the line.
import { AssistantMessageComponent, VERSION } from "@earendil-works/pi-coding-agent";

/** Wraps `updateContent` of the assistant message; returns the undo. Incompatible shapes leave Pi's drawing alone. */
export function installCutLine(isContinued: (message: object) => boolean, prototype: any = AssistantMessageComponent.prototype, version = VERSION): () => void {
	if (version !== "1.4.0" || typeof prototype.updateContent !== "function") return () => {};
	const original = prototype.updateContent;
	const own = Object.getOwnPropertyDescriptor(prototype, "updateContent");
	const wrapper = function (this: any, message: any, ...args: unknown[]) {
		if (message?.stopReason !== "length" || !isContinued(message)) return original.call(this, message, ...args);
		const result = original.call(this, { ...message, stopReason: "stop" }, ...args);
		// Pi keeps the message for later redraws; it must stay the session's own object.
		this.lastMessage = message;
		return result;
	};
	prototype.updateContent = wrapper;
	return () => {
		if (prototype.updateContent !== wrapper) return;
		if (own) Object.defineProperty(prototype, "updateContent", own);
		else delete prototype.updateContent;
	};
}
