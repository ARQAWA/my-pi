import { stripVTControlCharacters } from "node:util";
import { InteractiveMode, VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type Target = Record<string, any>;

/** The widget key of this extension's start (`ENTRY` in index.ts). */
const START_WIDGET = "rqw-send-now";

/** Remove only Pi's known key suffix, leaving the spinner, label and countdown intact. */
function withoutKey(line: string): string {
	const plain = stripVTControlCharacters(line);
	const match = /(?: \([^()]* to (?:interrupt|cancel)\)| · [^·]* to cancel)\s*$/.exec(plain);
	if (!match) return line;
	const width = visibleWidth(plain.slice(0, match.index));
	return truncateToWidth(line, width, "") + " ".repeat(Math.max(0, visibleWidth(line) - width));
}

/**
 * Hide Pi's old outside key hints only while this session's Esc hints have a consumer (`supported`). Also reports the
 * main editor when this extension's start widget is set, so a replaced editor is found.
 */
export function installHintUI(identity: object, editorChanged: (editor: unknown) => void, supported: () => boolean) {
	if (VERSION !== "1.4.0") return { release() {}, refresh() {} };
	const proto = InteractiveMode.prototype as unknown as Target;
	const undo: (() => void)[] = [];
	const hosts = new Set<Target>();
	const restored: (() => void)[] = [];
	const decorated = new WeakSet<object>();
	let active = true, suspended = false;
	const refresh = () => {
		if (!active) return;
		for (const host of hosts) {
			host.updatePendingMessagesDisplay?.();
		}
	};
	const owns = (host: Target) => active && host.sessionManager === identity;
	function decorate(component: Target, name: string, rows: boolean) {
		if (!component || typeof component[name] !== "function") return;
		const own = Object.getOwnPropertyDescriptor(component, name);
		const original = component[name];
		const wrapped = function(this: Target, ...args: any[]) {
			const result = original.apply(this, args);
			if (!active || suspended || !supported()) return result;
			return rows && Array.isArray(result) ? result.map(withoutKey) : typeof result === "string" ? withoutKey(result) : result;
		};
		component[name] = wrapped;
		restored.push(() => { if (component[name] === wrapped) { if (own) Object.defineProperty(component, name, own); else delete component[name]; } });
	}
	function wrap(name: string, make: (original: Function) => Function) {
		const descriptor = Object.getOwnPropertyDescriptor(proto, name);
		if (!descriptor || typeof descriptor.value !== "function" || !descriptor.configurable || !descriptor.writable) throw new Error("unsupported Pi UI");
		const replacement = make(descriptor.value);
		Object.defineProperty(proto, name, { ...descriptor, value: replacement });
		undo.push(() => { if (proto[name] === replacement) Object.defineProperty(proto, name, descriptor); });
	}
	try {
		wrap("setCustomEditorComponent", original => function(this: Target, ...args: any[]) {
			if (!owns(this)) return original.apply(this, args);
			suspended = true;
			try { return original.apply(this, args); }
			finally {
				suspended = false;
				editorChanged(this.editor);
				refresh();
			}
		});
		wrap("setExtensionWidget", original => function(this: Target, ...args: any[]) {
			const result = original.apply(this, args);
			if (owns(this)) {
				hosts.add(this);
				if (args[0] === START_WIDGET && typeof args[1] === "function") editorChanged(this.editor);
			}
			return result;
		});
		wrap("updatePendingMessagesDisplay", original => function(this: Target, ...args: any[]) {
			const result = original.apply(this, args);
			if (owns(this) && supported()) {
				const container = this.pendingMessagesContainer;
				const last = container?.children?.at(-1);
				if (typeof last?.text === "string" && /to edit all queued messages\s*$/.test(stripVTControlCharacters(last.text))) container.removeChild(last);
			}
			return result;
		});
		wrap("showStatusIndicator", original => function(this: Target, indicator: Target) {
			const result = original.call(this, indicator);
			if (owns(this) && ["working", "retry", "compaction"].includes(indicator?.kind) && !decorated.has(indicator)) {
				decorated.add(indicator);
				decorate(indicator, "render", true);
				decorate(indicator, "renderInBorder", false);
			}
			return result;
		});
	} catch {
		for (const restore of undo.reverse()) restore();
		return { release() {}, refresh() {} };
	}
	return { refresh, release() {
		active = false;
		for (const restore of restored.reverse()) restore();
		for (const restore of undo.reverse()) restore();
		for (const host of hosts) {
			host.updatePendingMessagesDisplay?.();
		}
	} };
}
