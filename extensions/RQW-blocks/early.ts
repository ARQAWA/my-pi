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

type Binding = { shutdown: (event: any, ctx: any) => void };

/** One host hook survives extension reloads. A factory alone never changes the visible host. */
export function installEarly(installStyles: (theme: () => Theme, supported: { compaction: boolean; branch: boolean; bash: boolean; thinking: boolean }) => () => void): Binding {
	const existing = (globalThis as any)[ACTIVE] as Binding | undefined;
	if (existing) return existing;
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
			if (!releaseStyles) releaseStyles = installStyles(() => ui!.theme, supported);
			ui = nextUi; host = next; session = current; generation = extensions.runtime;
			return true;
		} catch {
			releaseStyles?.(); releaseStyles = undefined; ui = undefined;
			session = undefined; generation = undefined;
			return false;
		}
	};
	const history = installHistory(proto, prepare);
	const init = Object.getOwnPropertyDescriptor(proto, "init")!;
	const stop = Object.getOwnPropertyDescriptor(proto, "stop")!;
	const rebind = Object.getOwnPropertyDescriptor(proto, "rebindCurrentSession")!;
	const rebindWrapper = function (this: any, ...args: unknown[]) { return prepare(this) ? rebindWithHistory(this, () => rebind.value.apply(this, args)) : rebind.value.apply(this, args); };
	const initWrapper = function (this: any, ...args: unknown[]) {
		return prepare(this) ? startWithHistory(this, () => init.value.apply(this, args)) : init.value.apply(this, args);
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
		shutdown(event, ctx) {
			if (event?.reason !== "quit" && host && ctx?.sessionManager === session?.sessionManager) history.reset?.(host);
		},
	};
	(globalThis as any)[ACTIVE] = binding;
	return binding;
}
