import { AgentSession, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { assertNoConflict } from "./visibility.ts";

const PATCH = Symbol.for("rqw-anthropic/lifecycle");
type Cleanup = () => void;
type PatchState = {
	count: number;
	callbacks: WeakMap<ModelRuntime, Set<Cleanup>>;
	originals: [string, PropertyDescriptor][];
};

/** Pi 1.3.0 SDK dispose has no shutdown hook. Clean only our resources, synchronously before invalidation. */
export function installLifecycle(Session = AgentSession) {
	const owner = Session as unknown as { [PATCH]?: PatchState };
	let state = owner[PATCH];
	if (!state) {
		const prototype = Session.prototype;
		const originals = ["dispose", "bindExtensions"].map(name => [name, Object.getOwnPropertyDescriptor(prototype, name)] as const);
		if (originals.some(([, descriptor]) => typeof descriptor?.value !== "function" || !descriptor.configurable)) {
			throw new Error("RQW-anthropic: incompatible Pi lifecycle; requires Pi 1.3.0. Nothing was patched.");
		}
		state = { count: 0, callbacks: new WeakMap(), originals: originals as PatchState["originals"] };
		const installed = state;
		for (const [name, descriptor] of installed.originals) {
			const original = descriptor.value;
			const wrapped = name === "dispose" ? function(this: AgentSession) {
				try {
					for (const cleanup of [...(installed.callbacks.get(this.modelRuntime) ?? [])]) cleanup();
				} finally { original.call(this); }
			} : async function(this: AgentSession, ...args: unknown[]) {
				// The runner swallows registration/event errors; do not start competing handlers.
				assertNoConflict(this.modelRuntime);
				return original.apply(this, args);
			};
			Object.defineProperty(prototype, name, { ...descriptor, value: wrapped });
		}
		owner[PATCH] = state;
	}
	state.count++;
	const installed = state;
	const bindings = new Map<ModelRuntime, Cleanup>();
	let released = false;
	return {
		bind(runtime: ModelRuntime, cleanup: Cleanup) {
			if (released) throw new Error("RQW-anthropic: disposed adapter cannot be rebound; reload the extension");
			const callbacks = installed.callbacks.get(runtime) ?? new Set<Cleanup>();
			callbacks.add(cleanup);
			installed.callbacks.set(runtime, callbacks);
			bindings.set(runtime, cleanup);
		},
		release() {
			if (released) return;
			released = true;
			for (const [runtime, cleanup] of bindings) {
				const callbacks = installed.callbacks.get(runtime);
				callbacks?.delete(cleanup);
				if (!callbacks?.size) installed.callbacks.delete(runtime);
			}
			bindings.clear();
			if (--installed.count !== 0) return;
			for (const [name, descriptor] of installed.originals) Object.defineProperty(Session.prototype, name, descriptor);
			delete owner[PATCH];
		},
	};
}
