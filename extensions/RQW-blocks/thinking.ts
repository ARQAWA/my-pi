import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { Markdown, MouseRegion, Spacer, Text } from "@earendil-works/pi-tui";

// Work after Pi rebuilds its children, never during render. Keep the original run indices and mouse handlers.
export function installThinking(prototype: any = AssistantMessageComponent.prototype): () => void {
	if (typeof prototype.updateContent !== "function" || typeof prototype.setHideThinkingBlock !== "function" || typeof prototype.render !== "function") return () => {};
	const original = prototype.updateContent;
	const originalRender = prototype.render;
	const own = Object.getOwnPropertyDescriptor(prototype, "updateContent");
	const ownRender = Object.getOwnPropertyDescriptor(prototype, "render");
	const seen = new WeakSet<object>();
	const instances: WeakRef<any>[] = [];
	prototype.updateContent = function (message: any, ...args: unknown[]) {
		const result = original.call(this, message, ...args);
		if (!seen.has(this)) { seen.add(this); instances.push(new WeakRef(this)); }
		try {
			const container = this.contentContainer;
			if (!Array.isArray(message?.content) || !Array.isArray(container?.children) || typeof container.removeChild !== "function" || typeof this.hideThinkingBlock !== "boolean" || !(this.thinkingVisibilityOverrides instanceof Map)) return result;
			const blocks: { kind: "text" | "thinking"; hidden: boolean }[] = [];
			let run = 0;
			for (let i = 0; i < message.content.length; i++) {
				const part = message.content[i];
				if (part?.type === "text") {
					if (typeof part.text !== "string") return result;
					if (part.text.trim()) blocks.push({ kind: "text", hidden: false });
				} else if (part?.type === "thinking") {
					let nonempty = false;
					while (i < message.content.length && message.content[i]?.type === "thinking") {
						if (typeof message.content[i].thinking !== "string") return result;
						nonempty ||= !!message.content[i].thinking.trim();
						i++;
					}
					i--;
					if (nonempty) blocks.push({ kind: "thinking", hidden: this.thinkingVisibilityOverrides.get(run++) ?? this.hideThinkingBlock });
				}
			}
			if (!blocks.some(block => block.hidden)) return result;
			const children = container.children;
			let pos = 0;
			const remove: any[] = [];
			if (blocks.length) {
				if (!(children[pos] instanceof Spacer)) return result;
				if (blocks.every(block => block.hidden)) remove.push(children[pos]);
				pos++;
			}
			for (let i = 0; i < blocks.length; i++) {
				const block = blocks[i];
				const child = children[pos++];
				if (block.kind === "text") { if (!(child instanceof Markdown)) return result; continue; }
				if (!(child instanceof MouseRegion) || !((child as unknown as { child: unknown }).child instanceof (block.hidden ? Text : Markdown))) return result;
				if (block.hidden) remove.push(child);
				if (i + 1 < blocks.length) {
					const spacer = children[pos++];
					if (!(spacer instanceof Spacer)) return result;
					if (block.hidden || !blocks.slice(i + 1).some(next => !next.hidden)) remove.push(spacer);
				}
			}
			const status = message.stopReason === "length" || (!this.hasToolCalls && (message.stopReason === "error" || message.stopReason === "aborted"));
			if (blocks.every(block => block.hidden) && status) {
				if (!(children[pos] instanceof Spacer) || !(children[pos + 1] instanceof Text) || children.length !== pos + 2) return result;
				remove.push(children[pos]);
			}
			for (const child of remove) container.removeChild(child);
		} catch { /* Unexpected Pi shape: keep stock rendering. */ }
		return result;
	};
	prototype.render = function (width: number) {
		if (!seen.has(this) && this.lastMessage) this.updateContent(this.lastMessage);
		return originalRender.call(this, width);
	};
	return () => {
		if (own) Object.defineProperty(prototype, "updateContent", own); else delete prototype.updateContent;
		if (ownRender) Object.defineProperty(prototype, "render", ownRender); else delete prototype.render;
		for (const ref of instances) {
			const instance = ref.deref();
			if (instance?.lastMessage) original.call(instance, instance.lastMessage);
		}
	};
}
