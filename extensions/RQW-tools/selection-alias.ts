import { AgentSession, VERSION } from "@earendil-works/pi-coding-agent";

const aliases: Record<string, string> = { read: "rqw_readfile", grep: "rqw_rg", find: "rqw_glob" };
const reverse = Object.fromEntries(Object.entries(aliases).map(([old, name]) => [name, old]));
const currentName = (name: string) => aliases[name] ?? name;
const oldName = (name: string) => reverse[name] ?? name;
const HOOK = Symbol.for("rqw/tool-selection-aliases/1.4.0");

type Binding = { session: any; allowed: any; excluded: any; modifiers: string[] };
type State = {
	leases: Set<WeakRef<object>>;
	bindings: WeakMap<object, Binding>;
	managers: WeakMap<object, Binding>;
	fallbackManagers: WeakMap<object, any>;
	originalRefresh: PropertyDescriptor;
	originalSet: PropertyDescriptor;
	refresh: Function;
	set: Function;
};

function matcher(original: (name: string) => boolean) {
	return (name: string) => original(name) || original(oldName(name)) || original(currentName(name));
}

function participates(session: any): boolean {
	const registered = session._extensionRunner?.getAllRegisteredTools?.();
	if (!Array.isArray(registered)) return false;
	return Object.values(aliases).every((name) => registered.some((item: any) => item?.definition?.name === name));
}

function fallback(session: any, reason: string): void {
	const registered = session._extensionRunner?.getAllRegisteredTools?.() ?? [];
	for (const { definition } of registered) {
		if (aliases[definition.name]) definition.exposure = "direct";
		else if (reverse[definition.name]) {
			definition.exposure = "hidden";
			definition.rqwSelectionFallback?.();
		}
	}
	console.warn(`RQW-tools: incompatible Pi tool selection (${reason}); using stock file tools.`);
}

/** The implicit search defaults apply only when Pi uses its implicit default selection. */
export function defaultSearchSelection(manager: object, settings: any, legacy = false, captured?: object): string[] {
	const state = (AgentSession.prototype as any)[HOOK] as State | undefined;
	const session: any = (legacy ? state?.fallbackManagers.get(manager) : state?.managers.get(manager)?.session) ?? captured;
	if (!session?._usesDefaultTools || !settings || settings.defaultTools !== undefined) return [];
	const branch = session.sessionManager.getBranch?.();
	if (branch?.some((entry: any) => entry.type === "message" && entry.message?.role === "system" &&
		(entry.message.toolsAdded || entry.message.toolsRemoved))) return [];
	const names = new Set(["rqw_rg", "rqw_glob"]);
	for (const entry of Array.isArray(session._defaultToolModifiers) ? session._defaultToolModifiers : []) {
		if (typeof entry !== "string") continue;
		const name = currentName(entry.slice(1));
		if (entry.startsWith("-")) names.delete(name);
		else if (entry.startsWith("+") && (name === "rqw_rg" || name === "rqw_glob")) names.add(name);
	}
	return [...names].map((name) => legacy ? oldName(name) : name);
}

/** Selection aliases are applied before Pi filters the registry, never to executable tool names. */
export function installSelectionAliases(Session: any = AgentSession, version = VERSION): (manager?: object, reload?: boolean) => void {
	if (version !== "1.4.0") throw new Error(`unsupported Pi version ${version}`);
	const owner = Session.prototype as any;
	let refreshDescriptor = Object.getOwnPropertyDescriptor(owner, "_refreshToolRegistry");
	let setDescriptor = Object.getOwnPropertyDescriptor(owner, "_setActiveTools");
	let state: State = owner[HOOK];
	if (state) {
		for (const lease of state.leases) if (!lease.deref()) state.leases.delete(lease);
		if (!state.leases.size) {
			if (refreshDescriptor?.value === state.refresh) Object.defineProperty(owner, "_refreshToolRegistry", state.originalRefresh);
			if (setDescriptor?.value === state.set) Object.defineProperty(owner, "_setActiveTools", state.originalSet);
			refreshDescriptor = Object.getOwnPropertyDescriptor(owner, "_refreshToolRegistry");
			setDescriptor = Object.getOwnPropertyDescriptor(owner, "_setActiveTools");
		}
	}
	if (!refreshDescriptor?.configurable || !refreshDescriptor.writable || typeof refreshDescriptor.value !== "function" ||
		!setDescriptor?.configurable || !setDescriptor.writable || typeof setDescriptor.value !== "function") {
		throw new Error("incompatible AgentSession tool selection methods");
	}
	if (!state) {
		state = {
			leases: new Set(), bindings: new WeakMap(), managers: new WeakMap(), fallbackManagers: new WeakMap(),
			originalRefresh: refreshDescriptor, originalSet: setDescriptor, refresh: () => {}, set: () => {},
		};
		Object.defineProperty(owner, HOOK, { value: state });
	}
	if (!state.leases.size) {
		state.originalRefresh = refreshDescriptor;
		state.originalSet = setDescriptor;
		const shared = state;
		const originalRefresh = refreshDescriptor.value;
		const originalSet = setDescriptor.value;
		state.refresh = function (this: any, options: any) {
			for (const lease of shared.leases) if (!lease.deref()) shared.leases.delete(lease);
			if (!shared.leases.size) {
				if (owner._refreshToolRegistry === shared.refresh) Object.defineProperty(owner, "_refreshToolRegistry", shared.originalRefresh);
				if (owner._setActiveTools === shared.set) Object.defineProperty(owner, "_setActiveTools", shared.originalSet);
				return originalRefresh.call(this, options);
			}
			if (participates(this) && !shared.bindings.has(this)) {
				const allowed = this._allowedTools;
				const excluded = this._excludedTools;
				if (!this.sessionManager || typeof this.sessionManager !== "object" ||
					!["_allowedTools", "_excludedTools", "_usesDefaultTools", "_defaultToolModifiers"].every((name) => Object.hasOwn(this, name)) ||
					typeof this._usesDefaultTools !== "boolean" || !Array.isArray(this._defaultToolModifiers) ||
					!this._defaultToolModifiers.every((name: unknown) => typeof name === "string") ||
					(allowed !== undefined && typeof allowed !== "function") ||
					(excluded !== undefined && typeof excluded !== "function") ||
					!(this._pendingToolNames instanceof Set) || !Array.isArray(this.agent?.state?.tools)) {
					if (this.sessionManager && typeof this.sessionManager === "object") shared.fallbackManagers.set(this.sessionManager, this);
					fallback(this, "unexpected session fields");
				} else {
					const modifiers = this._defaultToolModifiers;
					const binding = { session: this, allowed, excluded, modifiers };
					this._defaultToolModifiers = modifiers.flatMap((entry: string) => {
						const sign = entry[0];
						const name = entry.slice(1);
						if (sign !== "+" && sign !== "-") return [entry];
						const old = oldName(name);
						const current = currentName(name);
						return old === current ? [entry] : [`${sign}${old}`, `${sign}${current}`];
					});
					shared.bindings.set(this, binding);
					shared.managers.set(this.sessionManager, binding);
					if (allowed) this._allowedTools = matcher(allowed);
					if (excluded) this._excludedTools = matcher(excluded);
				}
			}
			if (shared.bindings.has(this) && options?.activeToolNames) {
				options = { ...options, activeToolNames: options.activeToolNames.map(currentName) };
			}
			return originalRefresh.call(this, options);
		};
		state.set = function (this: any, names: string[]) {
			return originalSet.call(this, shared.bindings.has(this) ? names.map(currentName) : names);
		};
		Object.defineProperty(owner, "_refreshToolRegistry", { ...refreshDescriptor, value: state.refresh });
		Object.defineProperty(owner, "_setActiveTools", { ...setDescriptor, value: state.set });
	}
	const lease = { released: false };
	const reference = new WeakRef(lease);
	state.leases.add(reference);
	return (manager?: object, reload = false) => {
		if (lease.released) return;
		lease.released = true;
		state.leases.delete(reference);
		if (manager) state.fallbackManagers.delete(manager);
		const binding = manager && state.managers.get(manager);
		if (binding) {
			const { session, allowed, excluded, modifiers } = binding;
			session._allowedTools = allowed;
			session._excludedTools = excluded;
			session._defaultToolModifiers = modifiers;
			if (reload) {
				session.agent.state.tools = session.agent.state.tools.map((tool: any) => ({ ...tool, name: oldName(tool.name) }));
				session._pendingToolNames = new Set([...session._pendingToolNames].map(oldName));
			}
			state.bindings.delete(session);
			state.managers.delete(manager!);
		}
		if (!state.leases.size) {
			if (owner._refreshToolRegistry === state.refresh) Object.defineProperty(owner, "_refreshToolRegistry", state.originalRefresh);
			if (owner._setActiveTools === state.set) Object.defineProperty(owner, "_setActiveTools", state.originalSet);
		}
	};
}
