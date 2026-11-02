// Hides Pi's "Operation aborted" status under a reply that a force-send interrupted. The reply stays an aborted
// message in the session; only its status row (a Spacer and a Text after the content) is not drawn.
import { AssistantMessageComponent, VERSION } from "@earendil-works/pi-coding-agent";
import { Spacer, Text } from "@earendil-works/pi-tui";

/** Wraps `updateContent` of the assistant message; returns the undo. Incompatible shapes leave Pi's drawing alone. */
export function installQuiet(isQuiet: (message: { timestamp?: number }) => boolean, prototype: any = AssistantMessageComponent.prototype, version = VERSION): () => void {
	if (version !== "1.5.0" || typeof prototype.updateContent !== "function") return () => {};
	const original = prototype.updateContent;
	const own = Object.getOwnPropertyDescriptor(prototype, "updateContent");
	const wrapper = function (this: any, message: any, ...args: unknown[]) {
		const result = original.call(this, message, ...args);
		try {
			if (message?.stopReason !== "aborted" || !Array.isArray(message.content) || message.content.some((part: any) => part?.type === "toolCall") || !isQuiet(message)) return result;
			const container = this.contentContainer;
			const children = container?.children;
			if (!Array.isArray(children) || typeof container.removeChild !== "function" || children.length < 2) return result;
			const status = children[children.length - 1], gap = children[children.length - 2];
			if (status instanceof Text && gap instanceof Spacer) { container.removeChild(status); container.removeChild(gap); }
		} catch { /* Drawing must not break. */ }
		return result;
	};
	prototype.updateContent = wrapper;
	return () => {
		if (prototype.updateContent !== wrapper) return;
		if (own) Object.defineProperty(prototype, "updateContent", own);
		else delete prototype.updateContent;
	};
}
