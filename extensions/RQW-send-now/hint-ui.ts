import { stripVTControlCharacters } from "node:util";
import { InteractiveMode, VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type Target = Record<string, any>;

/** Remove only Pi's known key suffix, leaving the spinner, label and countdown intact. */
function withoutKey(line: string): string {
	const plain = stripVTControlCharacters(line);
	const match = /(?: \([^()]* to (?:interrupt|cancel)\)| · [^·]* to cancel)\s*$/.exec(plain);
	if (!match) return line;
	const width = visibleWidth(plain.slice(0, match.index));
	return truncateToWidth(line, width, "") + " ".repeat(Math.max(0, visibleWidth(line) - width));
}

/** Hide the old outside key hints only while this session has the editor painter. */
export function installHintUI(identity: object, editorChanged: (editor: unknown) => void, supported: () => boolean) {
	if (VERSION !== "1.4.0") return { release() {}, refresh() {} };
	const proto = InteractiveMode.prototype as unknown as Target;
	const undo: (() => void)[] = [];
	const hosts = new Set<Target>();
	const restored: (() => void)[] = [];
	const decorated = new WeakSet<object>();
	const statuses = new Map<Target, string | undefined>();
	let originalStatus = (_host: Target, _text: string | undefined) => {};
	let active = true, suspended = false;
	const refresh = () => {
		for (const host of hosts) {
			host.updatePendingMessagesDisplay?.();
			if (statuses.has(host)) originalStatus(host, statuses.get(host));
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
	function widget(host: Target) {
		const component = host.extensionWidgetsAbove?.get("rqw-statusbar-activity");
		if (!component || decorated.has(component)) return;
		decorated.add(component);
		decorate(component, "render", true);
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
				hosts.add(this); widget(this);
				if (args[0] === "rqw-send-now-hint" && typeof args[1] === "function") editorChanged(this.editor);
			}
			return result;
		});
		wrap("setExtensionStatus", original => {
			originalStatus = (host, text) => { original.call(host, "rqw-followup-hold", supported() ? undefined : text); };
			return function(this: Target, key: string, text: string | undefined) {
				if (owns(this) && key === "rqw-followup-hold") { hosts.add(this); statuses.set(this, text); return originalStatus(this, text); }
				return original.call(this, key, text);
			};
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
			if (statuses.has(host)) host.setExtensionStatus("rqw-followup-hold", statuses.get(host));
			host.updatePendingMessagesDisplay?.();
		}
	} };
}
