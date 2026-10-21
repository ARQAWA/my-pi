import { AgentSession, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { bindSessionCache } from "./cache.ts";

export const SESSION_BIND = "rqw-anthropic:session-bind";
const PATCH = Symbol.for("rqw-anthropic/lifecycle");
type Cleanup = () => void;
type Lease = { streamSimple: unknown; restore?: Cleanup };
type PatchState = {
	count: number;
	cacheBindings: Map<AgentSession, Cleanup>;
	callbacks: WeakMap<object, Set<Cleanup>>;
	leases: WeakMap<ModelRuntime, Map<Cleanup, Lease>>;
	originals: [string, PropertyDescriptor][];
};

export type Lifecycle = {
	bindSession(identity: object, session: object): void;
	bind(runtime: ModelRuntime, streamSimple: unknown): (restore: Cleanup) => void;
	isActive(identity: object, runtime: ModelRuntime): boolean;
	release(): void;
};

/** Pi 1.3.0 SDK dispose has no shutdown hook. Release only the disposing session's leases. */
export function installLifecycle(cleanup: Cleanup, Session = AgentSession): Lifecycle {
	const owner = Session as unknown as { [PATCH]?: PatchState };
	let state = owner[PATCH];
	if (!state) {
		const prototype = Session.prototype;
		const originals = ["dispose", "_bindExtensionCore"].map(name => [name, Object.getOwnPropertyDescriptor(prototype, name)] as const);
		if (originals.some(([, descriptor]) => typeof descriptor?.value !== "function" || !descriptor.configurable)) {
			throw new Error("RQW-anthropic: incompatible Pi lifecycle; requires Pi 1.3.0. Nothing was patched.");
		}
		state = { count: 0, cacheBindings: new Map(), callbacks: new WeakMap(), leases: new WeakMap(), originals: originals as PatchState["originals"] };
		const installed = state;
		for (const [name, descriptor] of installed.originals) {
			const original = descriptor.value;
			const wrapped = name === "dispose" ? function(this: AgentSession) {
				try {
					for (const release of [...(installed.callbacks.get(this) ?? [])]) release();
				} finally {
					installed.cacheBindings.get(this)?.();
					installed.cacheBindings.delete(this);
					original.call(this);
				}
			} : function(this: AgentSession, ...args: unknown[]) {
				if (!installed.cacheBindings.has(this)) installed.cacheBindings.set(this, bindSessionCache(this));
				// SDK callers may omit session_start. Bind the exact session before native registration.
				const ctx = this.extensionRunner.createContext();
				for (const extension of this.resourceLoader.getExtensions().extensions) {
					for (const handler of extension.handlers.get(SESSION_BIND) ?? []) handler({ type: SESSION_BIND, session: this }, ctx);
				}
				return original.apply(this, args);
			};
			Object.defineProperty(prototype, name, { ...descriptor, value: wrapped });
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
		bind(runtime: ModelRuntime, streamSimple: unknown) {
			if (released) throw new Error("RQW-anthropic: disposed adapter cannot be rebound; reload the extension");
			const leases = installed.leases.get(runtime) ?? new Map<Cleanup, Lease>();
			const lease = bindings.get(runtime) ?? { streamSimple };
			leases.set(cleanup, lease);
			installed.leases.set(runtime, leases);
			bindings.set(runtime, lease);
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
					for (const restore of installed.cacheBindings.values()) restore();
					installed.cacheBindings.clear();
					for (const [name, descriptor] of installed.originals) Object.defineProperty(Session.prototype, name, descriptor);
					delete owner[PATCH];
				}
			}
		},
	};
}
