import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { Spacer, Text } from "@earendil-works/pi-tui";

// Pi's empty label hides thinking without changing its native spacing or Markdown cache.
export function installThinking(prototype: any = AssistantMessageComponent.prototype): () => void {
	if (typeof prototype.updateContent !== "function" || typeof prototype.setHiddenThinkingLabel !== "function" || typeof prototype.render !== "function") return () => {};
	const original = prototype.updateContent;
	const originalRender = prototype.render;
	const own = Object.getOwnPropertyDescriptor(prototype, "updateContent");
	const ownRender = Object.getOwnPropertyDescriptor(prototype, "render");
	const labels = new WeakMap<object, string>();
	const instances = new Set<WeakRef<any>>();
	const collected = new FinalizationRegistry<WeakRef<any>>(ref => instances.delete(ref));
	prototype.updateContent = function (message: any, ...args: unknown[]) {
		if (typeof this.hiddenThinkingLabel !== "string" || !Array.isArray(message?.content)) return original.call(this, message, ...args);
		if (!labels.has(this)) {
			labels.set(this, this.hiddenThinkingLabel);
			const ref = new WeakRef(this);
			instances.add(ref);
			collected.register(this, ref);
		}
		this.hiddenThinkingLabel = "";
		const result = original.call(this, message, ...args);
		try {
			const children = this.contentContainer?.children;
			const status = message.stopReason === "length" || (!this.hasToolCalls && (message.stopReason === "error" || message.stopReason === "aborted"));
			if (status && message.content.some((part: any) => part?.type === "thinking" && typeof part.thinking === "string" && part.thinking.trim())
				&& Array.isArray(children) && children.length === 2 && children[0] instanceof Spacer && children[1] instanceof Text
				&& typeof this.contentContainer.removeChild === "function") this.contentContainer.removeChild(children[0]);
		} catch { /* Unexpected Pi shape: keep stock rendering. */ }
		return result;
	};
	prototype.render = function (width: number) {
		if (!labels.has(this) && this.lastMessage) this.updateContent(this.lastMessage);
		return originalRender.call(this, width);
	};
	const patchedUpdate = prototype.updateContent;
	const patchedRender = prototype.render;
	return () => {
		if (prototype.updateContent === patchedUpdate) {
			if (own) Object.defineProperty(prototype, "updateContent", own); else delete prototype.updateContent;
		}
		if (prototype.render === patchedRender) {
			if (ownRender) Object.defineProperty(prototype, "render", ownRender); else delete prototype.render;
		}
		for (const ref of instances) {
			const instance = ref.deref();
			if (!instance) continue;
			instance.hiddenThinkingLabel = labels.get(instance);
			if (instance.lastMessage) original.call(instance, instance.lastMessage);
		}
	};
}
