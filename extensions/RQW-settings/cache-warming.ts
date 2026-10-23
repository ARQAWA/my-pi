import { AgentSession, VERSION, type ExtensionAPI, type SettingsManager } from "@earendil-works/pi-coding-agent";

const BIND = "rqw-settings:cache-default-bind";
const HOOK = Symbol.for("rqw-settings/cache-default/1.4.0");
/** Shared method-lease contract `rqw:method-chain/v1` (self-contained copy in each RQW extension that wraps a Pi prototype method). */
const CHAIN = Symbol.for("rqw:method-chain/v1");
/** Each wrapper layer links to the value it wraps; read at call time, so a rebase of the chain reaches the layer. */
const INNER = Symbol.for("rqw:method-inner");
/** Owner token of a layer; an owner removes only its own layers and never another owner's. */
const OWNER = Symbol.for("rqw:method-owner");
type Cleanup = () => void;
type Fn = (this: unknown, ...args: unknown[]) => unknown;
type Link = Fn & Record<symbol, unknown>;
type Chain = { stock: PropertyDescriptor; owners: Set<object> };
type State = {
	registrations: number;
	sessions: WeakMap<object, Set<Cleanup>>;
	managers?: WeakMap<object, ManagerOverride>;
};
// One override per SettingsManager, shared by every session that uses it, whatever the disposal order.
type ManagerOverride = { owners: number; own: PropertyDescriptor | undefined; wrapped: () => "off" };
type Owner = { [HOOK]?: State };
const METHODS = ["_bindExtensionCore", "dispose"];

function chainsOf(target: object, create: boolean): Map<string, Chain> | undefined {
	const registry = globalThis as unknown as Record<symbol, WeakMap<object, Map<string, Chain>> | undefined>;
	if (!registry[CHAIN]) {
		if (!create) return undefined;
		registry[CHAIN] = new WeakMap();
	}
	const all = registry[CHAIN]!;
	let chains = all.get(target);
	if (!chains && create) all.set(target, chains = new Map());
	return chains;
}

/** Puts `layer` on top of the current value. The layer's inner link is the value it replaces. */
function joinChain(target: object, name: string, owner: object, layer: Link): void {
	const current = Object.getOwnPropertyDescriptor(target, name)!;
	const chains = chainsOf(target, true)!;
	let chain = chains.get(name);
	if (!chain) chains.set(name, chain = { stock: current, owners: new Set() });
	chain.owners.add(owner);
	Object.defineProperty(layer, INNER, { value: current.value, writable: true, configurable: true });
	Object.defineProperty(layer, OWNER, { value: owner });
	Object.defineProperty(target, name, { ...current, value: layer });
}

/**
 * Removes this owner's layers that are reachable through cooperating links; a layer above another owner's layer
 * is rebased, not clobbered. The exact stock descriptor is restored only when no owner is left and the chain is stock.
 */
function leaveChain(target: object, name: string, owner: object): void {
	const chains = chainsOf(target, false);
	const chain = chains?.get(name);
	if (!chains || !chain) return;
	chain.owners.delete(owner);
	let parent: Link | undefined;
	let node = Object.getOwnPropertyDescriptor(target, name)?.value as unknown;
	for (let depth = 0; typeof node === "function" && depth < 64; depth++) {
		const link = node as Link;
		if (!(INNER in link)) break;
		if (link[OWNER] === owner) {
			const inner = link[INNER];
			if (parent) parent[INNER] = inner;
			else Object.defineProperty(target, name, { ...Object.getOwnPropertyDescriptor(target, name)!, value: inner });
			node = inner;
			continue;
		}
		parent = link;
		node = link[INNER];
	}
	if (chain.owners.size === 0 && Object.getOwnPropertyDescriptor(target, name)?.value === chain.stock.value) {
		Object.defineProperty(target, name, chain.stock);
		chains.delete(name);
	}
}

function leaveAll(owner: Owner, state: State): void {
	for (const name of METHODS) leaveChain(owner, name, state);
}

/** Session-owned policy, not a persisted setting or a process-wide SettingsManager default. */
export function installCacheDefault(pi: ExtensionAPI): Cleanup {
	if (VERSION !== "1.4.0") throw new Error("RQW-settings cache default requires Pi 1.4.0");
	const owner = AgentSession.prototype as Owner;
	const current = METHODS.map(name => [name, Object.getOwnPropertyDescriptor(owner, name)] as const);
	if (current.some(([, d]) => typeof d?.value !== "function" || !d.configurable)) {
		throw new Error("RQW-settings: incompatible Pi session lifecycle; cache defaults were not applied");
	}
	let state = owner[HOOK];
	if (!state) {
		state = { registrations: 0, sessions: new WeakMap(), managers: new WeakMap() };
		Object.defineProperty(owner, HOOK, { value: state });
	}
	if (state.registrations === 0) {
		const installed = state;
		// Drop this owner's layers left by an earlier load; other owners' layers stay in place.
		leaveAll(owner, installed);
		for (const name of METHODS) {
			const wrapper: Link = name === "dispose" ? function(this: AgentSession) {
				if (installed.registrations === 0) leaveAll(owner, installed);
				else for (const release of [...(installed.sessions.get(this) ?? [])]) release();
				return (wrapper[INNER] as Fn).call(this);
			} : function(this: AgentSession, ...args: unknown[]) {
				// The loader owns the marker. Unowned sessions and dormant wrappers are stock passthroughs.
				if (installed.registrations === 0) leaveAll(owner, installed);
				else {
					for (const extension of this.resourceLoader.getExtensions().extensions) {
						for (const handler of extension.handlers.get(BIND) ?? []) handler({ session: this });
					}
				}
				return (wrapper[INNER] as Fn).apply(this, args);
			};
			joinChain(owner, name, installed, wrapper);
		}
	}
	state.registrations++;
	const installed = state;
	installed.managers ??= new WeakMap();
	const managers = installed.managers;
	let released = false;
	let session: AgentSession | undefined;
	let restore: Cleanup | undefined;
	const release = () => {
		if (released) return;
		released = true;
		restore?.();
		if (session) installed.sessions.get(session)?.delete(release);
		installed.registrations--;
		if (installed.registrations === 0) leaveAll(owner, installed);
	};
	// Pi accepts extension-local lifecycle markers at runtime, as used by its other session shims.
	pi.on(BIND as never, ((event: { session: AgentSession }) => {
		if (released || session === event.session) return;
		if (session) throw new Error("RQW-settings: cache default already belongs to another session");
		session = event.session;
		const manager: SettingsManager = session.settingsManager;
		let override = managers.get(manager);
		if (override && manager.getCacheWarmingMode !== override.wrapped) override = undefined;
		if (override) override.owners++;
		else {
			const wrapped = () => "off" as const;
			override = { owners: 1, own: Object.getOwnPropertyDescriptor(manager, "getCacheWarmingMode"), wrapped };
			managers.set(manager, override);
			Object.defineProperty(manager, "getCacheWarmingMode", { configurable: true, writable: true, value: wrapped });
		}
		const shared = override;
		restore = () => {
			// The last owner restores the original descriptor, so the first wrapper cannot outlive both sessions.
			if (--shared.owners > 0) return;
			if (managers.get(manager) === shared) managers.delete(manager);
			if (manager.getCacheWarmingMode !== shared.wrapped) return;
			if (shared.own) Object.defineProperty(manager, "getCacheWarmingMode", shared.own);
			else delete (manager as unknown as Record<string, unknown>).getCacheWarmingMode;
		};
		const callbacks = installed.sessions.get(session) ?? new Set<Cleanup>();
		callbacks.add(release);
		installed.sessions.set(session, callbacks);
	}) as never);
	return release;
}
