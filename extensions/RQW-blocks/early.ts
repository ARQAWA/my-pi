import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { AssistantMessageComponent, BashExecutionComponent, BranchSummaryMessageComponent, CompactionSummaryMessageComponent, InteractiveMode, VERSION, type Theme } from "@earendil-works/pi-coding-agent";
import { installHistory } from "./history.ts";
import { rebindWithHistory, startWithHistory } from "./startup.ts";

const ACTIVE = Symbol.for("rqw-blocks.early");
const normalize = (path: string) => {
	const result = resolve(path);
	return process.platform === "win32" ? result.toLowerCase() : result;
};
const ownPath = normalize(fileURLToPath(new URL("./index.ts", import.meta.url)));

type InstallStyles = (theme: () => Theme, supported: { compaction: boolean; branch: boolean; bash: boolean; thinking: boolean }) => () => void;
/** Everything the host hook runs that a newer module may change. */
type Parts = { installStyles: InstallStyles; installHistory: typeof installHistory; startWithHistory: typeof startWithHistory; rebindWithHistory: typeof rebindWithHistory };
type Binding = { shutdown: (event: any, ctx: any) => void; update?: (next: Parts) => void };

/**
 * One host hook survives extension reloads: a factory alone never changes the visible host, and a gap would draw stock
 * blocks. A reloaded module hands its styles, history and start code to the running binding, which swaps them in one
 * step, so /reload applies the new code. A binding of an earlier release has no `update` and stays until a restart.
 */
export function installEarly(installStyles: InstallStyles): Binding {
	let parts: Parts = { installStyles, installHistory, startWithHistory, rebindWithHistory };
	const existing = (globalThis as any)[ACTIVE] as Binding | undefined;
	if (existing) {
		existing.update?.(parts);
		return existing;
	}
	const proto = InteractiveMode.prototype as any;
	const names = ["init", "stop", "rebindCurrentSession", "renderSessionEntries", "renderInitialMessages", "rebuildChatFromMessages", "handleEvent"];
	const mutable = (target: any, name: string) => {
		const own = Object.getOwnPropertyDescriptor(target, name);
		let source = target;
		while (source && !Object.getOwnPropertyDescriptor(source, name)) source = Object.getPrototypeOf(source);
		const descriptor = source && Object.getOwnPropertyDescriptor(source, name);
		return !!descriptor && descriptor.writable === true && typeof descriptor.value === "function"
			&& (own ? own.configurable === true : Object.isExtensible(target));
	};
	const optional = (target: any, name: string) => typeof target[name] === "function" ? mutable(target, name) : !(name in target) && Object.isExtensible(target);
	const valid = (target: any, names: string[]) => names.every(name => mutable(target, name));
	if (VERSION !== "1.4.0" || !valid(proto, names)) return { shutdown() {} };
	const summary = (target: any) => valid(target, ["render", "invalidate", "setExpanded", "updateDisplay"]) && optional(target, "handleMouse");
	const supported = {
		compaction: summary(CompactionSummaryMessageComponent.prototype),
		branch: summary(BranchSummaryMessageComponent.prototype),
		bash: valid(BashExecutionComponent.prototype, ["render", "invalidate", "updateDisplay", "setExpanded", "appendOutput", "setComplete"]) && optional(BashExecutionComponent.prototype, "setOutputPad"),
		thinking: valid(AssistantMessageComponent.prototype, ["updateContent", "setHideThinkingBlock", "render"]),
	};

	let host: any;
	let session: any;
	let generation: any;
	let releaseStyles: (() => void) | undefined;
	let ui: { readonly theme: Theme } | undefined;
	const prepare = (next: any): boolean => {
		if (host && next !== host) return false;
		try {
			const current = next.session;
			const manager = next.sessionManager;
			const extensions = current?.resourceLoader?.getExtensions();
			if (!manager || !Array.isArray(extensions?.extensions) || !extensions.runtime || typeof next.createExtensionUIContext !== "function") throw new Error("unsupported host");
			const enabled = extensions.extensions.some((extension: any) => typeof extension.resolvedPath === "string" && normalize(extension.resolvedPath) === ownPath);
			if (next === host && current === session && extensions.runtime === generation) return enabled && !!releaseStyles;
			if (!enabled) {
				releaseStyles?.(); releaseStyles = undefined; ui = undefined;
				host = next; session = current; generation = extensions.runtime;
				return false;
			}
			const nextUi = next.createExtensionUIContext();
			if (typeof nextUi?.theme?.fg !== "function" || typeof nextUi.theme.getColorMode !== "function") throw new Error("unsupported theme");
			if (!releaseStyles) releaseStyles = parts.installStyles(() => ui!.theme, supported);
			ui = nextUi; host = next; session = current; generation = extensions.runtime;
			return true;
		} catch {
			releaseStyles?.(); releaseStyles = undefined; ui = undefined;
			session = undefined; generation = undefined;
			return false;
		}
	};
	let history = parts.installHistory(proto, prepare);
	const init = Object.getOwnPropertyDescriptor(proto, "init")!;
	const stop = Object.getOwnPropertyDescriptor(proto, "stop")!;
	const rebind = Object.getOwnPropertyDescriptor(proto, "rebindCurrentSession")!;
	const rebindWrapper = function (this: any, ...args: unknown[]) { return prepare(this) ? parts.rebindWithHistory(this, () => rebind.value.apply(this, args)) : rebind.value.apply(this, args); };
	const initWrapper = function (this: any, ...args: unknown[]) {
		return prepare(this) ? parts.startWithHistory(this, () => init.value.apply(this, args)) : init.value.apply(this, args);
	};
	const stopWrapper = function (this: any, ...args: unknown[]) {
		try { return stop.value.apply(this, args); }
		finally {
			if (this === host) {
				releaseStyles?.(); releaseStyles = undefined; ui = undefined;
				history();
				if (proto.init === initWrapper) Object.defineProperty(proto, "init", init);
				if (proto.stop === stopWrapper) Object.defineProperty(proto, "stop", stop);
				if (proto.rebindCurrentSession === rebindWrapper) Object.defineProperty(proto, "rebindCurrentSession", rebind);
				if ((globalThis as any)[ACTIVE] === binding) delete (globalThis as any)[ACTIVE];
				host = undefined; session = undefined; generation = undefined;
			}
		}
	};
	proto.init = initWrapper;
	proto.stop = stopWrapper;
	proto.rebindCurrentSession = rebindWrapper;
	const binding: Binding = {
		update(next) {
			parts = next;
			if (releaseStyles) {
				releaseStyles();
				try { releaseStyles = parts.installStyles(() => ui!.theme, supported); } catch { releaseStyles = undefined; }
			}
			// The new history hook restores the old one, then installs itself in the same step.
			history = parts.installHistory(proto, prepare);
		},
		shutdown(event, ctx) {
			if (event?.reason !== "quit" && host && ctx?.sessionManager === session?.sessionManager) history.reset?.(host);
		},
	};
	(globalThis as any)[ACTIVE] = binding;
	return binding;
}
