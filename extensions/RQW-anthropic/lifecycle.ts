import { AgentSession, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { bindSessionCache } from "./cache.ts";

export const SESSION_BIND = "rqw-anthropic:session-bind";
const PATCH = Symbol.for("rqw-anthropic/lifecycle");
/** Shared method-lease contract `rqw:method-chain/v1` (self-contained copy, same shape as RQW-codex). */
const CHAIN = Symbol.for("rqw:method-chain/v1");
const INNER = Symbol.for("rqw:method-inner");
const OWNER = Symbol.for("rqw:method-owner");
const PATCHED_NAMES = ["dispose", "_bindExtensionCore"] as const;
type Cleanup = () => void;
type Fn = (this: unknown, ...args: unknown[]) => unknown;
type Link = Fn & Record<symbol, unknown>;
type Chain = { stock: PropertyDescriptor; owners: Set<object> };
type SessionSources = { registerSource(sessionId: string): void; release(sessionId: string): void };
type Lease = { streamSimple: unknown; restore?: Cleanup; sources?: SessionSources };
type CacheBinding = { release: Cleanup; sessionId: string };
type PatchState = {
	active: boolean;
	count: number;
	cacheBindings: Map<AgentSession, CacheBinding>;
	callbacks: WeakMap<object, Set<Cleanup>>;
	leases: WeakMap<ModelRuntime, Map<Cleanup, Lease>>;
};

export type Lifecycle = {
	bindSession(identity: object, session: object): void;
	bind(runtime: ModelRuntime, streamSimple: unknown, sources?: SessionSources): (restore: Cleanup) => void;
	isActive(identity: object, runtime: ModelRuntime): boolean;
	release(): void;
};

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

/** Pi 1.4.0 SDK dispose has no shutdown hook. Release only the disposing session's leases. */
export function installLifecycle(cleanup: Cleanup, Session = AgentSession): Lifecycle {
	const owner = Session as unknown as { [PATCH]?: PatchState };
	let state = owner[PATCH];
	if (!state) {
		const prototype = Session.prototype;
		const descriptors = PATCHED_NAMES.map(name => Object.getOwnPropertyDescriptor(prototype, name));
		if (descriptors.some(descriptor => !descriptor || typeof descriptor.value !== "function" || !descriptor.configurable)) {
			throw new Error("RQW-anthropic: incompatible Pi lifecycle; requires Pi 1.4.0. Nothing was patched.");
		}
		const installed: PatchState = { active: true, count: 0, cacheBindings: new Map(), callbacks: new WeakMap(), leases: new WeakMap() };
		state = installed;
		for (const name of PATCHED_NAMES) {
			const wrapped: Link = name === "dispose" ? function(this: AgentSession) {
				if (!installed.active) return (wrapped[INNER] as Fn).call(this);
				const binding = installed.cacheBindings.get(this);
				try {
					for (const lease of installed.leases.get(this.modelRuntime)?.values() ?? []) lease.sources?.release(binding?.sessionId ?? this.sessionId);
					for (const release of [...(installed.callbacks.get(this) ?? [])]) release();
				} finally {
					binding?.release();
					installed.cacheBindings.delete(this);
					(wrapped[INNER] as Fn).call(this);
				}
			} : function(this: AgentSession, ...args: unknown[]) {
				if (!installed.active) return (wrapped[INNER] as Fn).apply(this, args);
				let binding = installed.cacheBindings.get(this);
				if (!binding) {
					binding = { release: bindSessionCache(this), sessionId: this.sessionId };
					installed.cacheBindings.set(this, binding);
				}
				for (const lease of installed.leases.get(this.modelRuntime)?.values() ?? []) {
					if (binding.sessionId !== this.sessionId) lease.sources?.release(binding.sessionId);
					lease.sources?.registerSource(this.sessionId);
				}
				binding.sessionId = this.sessionId;
				// SDK callers may omit session_start. Bind the exact session before native registration.
				const ctx = this.extensionRunner.createContext();
				for (const extension of this.resourceLoader.getExtensions().extensions) {
					for (const handler of extension.handlers.get(SESSION_BIND) ?? []) handler({ type: SESSION_BIND, session: this }, ctx);
				}
				return (wrapped[INNER] as Fn).apply(this, args);
			};
			joinChain(prototype, name, installed, wrapped);
		}
		owner[PATCH] = state;
	}
	state.count++;
	const installed = state;
	const bindings = new Map<ModelRuntime, Lease>();
	let sessionManager: object | undefined;
	let boundSession: object | undefined;
	let released = false;
	return {
		bindSession(identity: object, session: object) {
			if (released) throw new Error("RQW-anthropic: disposed adapter cannot be rebound; reload the extension");
			if (boundSession && session !== boundSession) throw new Error("RQW-anthropic: extension instance already belongs to another session; load it separately");
			sessionManager = identity;
			boundSession = session;
			const callbacks = installed.callbacks.get(session) ?? new Set<Cleanup>();
			callbacks.add(cleanup);
			installed.callbacks.set(session, callbacks);
		},
		bind(runtime: ModelRuntime, streamSimple: unknown, sources?: SessionSources) {
			if (released) throw new Error("RQW-anthropic: disposed adapter cannot be rebound; reload the extension");
			const leases = installed.leases.get(runtime) ?? new Map<Cleanup, Lease>();
			const lease = bindings.get(runtime) ?? { streamSimple, sources };
			leases.set(cleanup, lease);
			installed.leases.set(runtime, leases);
			bindings.set(runtime, lease);
			for (const [session, binding] of installed.cacheBindings) {
				if (session.modelRuntime === runtime) sources?.registerSource(binding.sessionId);
			}
			return (restore: Cleanup) => { lease.restore = restore; };
		},
		isActive(identity: object, runtime: ModelRuntime) {
			if (released || identity !== sessionManager || !bindings.get(runtime)?.restore) return false;
			const current = runtime.getRegisteredProviderConfig("anthropic")?.streamSimple;
			return [...(installed.leases.get(runtime)?.values() ?? [])].some(lease => lease.restore && lease.streamSimple === current);
		},
		release() {
			if (released) return;
			released = true;
			const callbacks = boundSession && installed.callbacks.get(boundSession);
			callbacks?.delete(cleanup);
			if (boundSession && !callbacks?.size) installed.callbacks.delete(boundSession);
			try {
				for (const [runtime, lease] of bindings) {
					const leases = installed.leases.get(runtime)!;
					leases.delete(cleanup);
					if (!leases.size) installed.leases.delete(runtime);
					if (runtime.getRegisteredProviderConfig("anthropic")?.streamSimple === lease.streamSimple) {
						const remaining = [...leases.values()].reverse().find(candidate => candidate.restore);
						if (remaining) remaining.restore!();
						else runtime.unregisterProvider("anthropic");
					}
				}
			} finally {
				bindings.clear();
				if (--installed.count === 0) {
					for (const binding of installed.cacheBindings.values()) binding.release();
					installed.cacheBindings.clear();
					installed.active = false;
					// Rebase or remove only our own layers; a surviving competitor keeps its layer and its inner link.
					for (const name of PATCHED_NAMES) leaveChain(Session.prototype, name, installed);
					delete owner[PATCH];
				}
			}
		},
	};
}
