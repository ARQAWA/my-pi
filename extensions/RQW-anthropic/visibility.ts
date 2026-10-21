import type { CredentialStore } from "@earendil-works/pi-ai";
import { AgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";

export const OVERLAY = Symbol.for("rqw-anthropic/overlay");
export const BIND_STORE = Symbol.for("rqw-anthropic/bind-store");
const PATCH = Symbol.for("rqw-anthropic/visibility");
const ALLOWED: Record<string, true | undefined> = { anthropic: true, "openai-codex": true };
const CONFLICT = "RQW-anthropic: another Anthropic extension is enabled. Disable pi-claude-auth or the other Anthropic adapter, keep auth.json, then reload.";
type Registration = { streamSimple?: { [OVERLAY]?: boolean; [BIND_STORE]?: (store: CredentialStore) => void } };
type RuntimeView = {
	credentials?: CredentialStore;
	getRegisteredProviderConfig(id: string): Registration | undefined;
	getRegisteredNativeProvider(id: string): unknown;
};
type Hook = (this: RuntimeView, ...args: unknown[]) => unknown;
type Original = [object, string, PropertyDescriptor];
type PatchState = { count: number; originals: Original[] };

// Pi 1.3.0 exposes the classes but no visibility policy. Never patch stores or credential contents.
export function installVisibility(Runtime = ModelRuntime, Session = AgentSession): () => void {
	// Symbol state belongs to Pi's class, so separate extension loader instances share the same owner.
	const owner = Runtime as unknown as { [PATCH]?: PatchState };
	let state = owner[PATCH];
	if (!state) {
		const runtime = Runtime.prototype;
		const session = Session.prototype;
		const methods = ["getProviders", "getModels", "getAvailableSnapshot", "getAvailable", "registerProvider", "registerNativeProvider"];
		const scoped = Object.getOwnPropertyDescriptor(session, "scopedModels");
		const descriptors = methods.map(name => Object.getOwnPropertyDescriptor(runtime, name));
		if (descriptors.some(d => typeof d?.value !== "function" || !d.configurable) || !scoped?.get || !scoped.configurable ||
			typeof runtime.getRegisteredProviderConfig !== "function" || typeof runtime.getRegisteredNativeProvider !== "function") {
			throw new Error("RQW-anthropic: incompatible Pi internals; requires Pi 1.3.0. Nothing was patched.");
		}
		const originals: Original[] = methods.map((name, i) => [runtime, name, descriptors[i]!]);
		const enabled = (instance: RuntimeView) => instance.getRegisteredProviderConfig("anthropic")?.streamSimple?.[OVERLAY] === true;
		for (const [target, name, descriptor] of originals) {
			// These private method shapes were checked above; wrappers pass arguments and receiver unchanged.
			const original = descriptor.value as Hook;
			let wrapped: Hook;
			if (name === "registerProvider" || name === "registerNativeProvider") {
				wrapped = function(idOrProvider, config) {
					const id = typeof idOrProvider === "string" ? idOrProvider :
						idOrProvider && typeof idOrProvider === "object" && "id" in idOrProvider ? idOrProvider.id : undefined;
					if (id === "anthropic") {
						const previous = this.getRegisteredProviderConfig(id) ?? this.getRegisteredNativeProvider(id);
						const own = config && typeof config === "object" && "streamSimple" in config &&
							(config.streamSimple as Registration["streamSimple"])?.[OVERLAY] === true;
						if (previous && (enabled(this) || own) && !(enabled(this) && own)) throw new Error(CONFLICT);
                        if (own) {
                            const bind = (config as Registration).streamSimple?.[BIND_STORE];
                            if (bind) {
                                const store = this.credentials;
                                if (!store || typeof store.read !== "function" || typeof store.modify !== "function") {
                                    throw new Error("RQW-anthropic: Pi 1.3.0 runtime credential bridge is unavailable; adapter not registered");
                                }
                                bind(store);
                            }
                        }
					}
					return original.call(this, idOrProvider, config);
				};
			} else {
				wrapped = function(...args) {
					const result = original.apply(this, args);
					if (!enabled(this)) return result;
					// Each checked accessor returns providers/models or a promise of that list.
					const filter = (items: readonly { provider?: string; id: string }[]) => items.filter(item => ALLOWED[item.provider ?? item.id]);
					return result instanceof Promise ? result.then(filter) : filter(result as Parameters<typeof filter>[0]);
				};
			}
			Object.defineProperty(target, name, { ...descriptor, value: wrapped });
		}
		const scopedGetter = scoped.get;
		Object.defineProperty(session, "scopedModels", { ...scoped, get(this: AgentSession) {
			const result: AgentSession["scopedModels"] = scopedGetter.call(this);
			return enabled(this.modelRuntime as unknown as RuntimeView) ? result.filter(entry => ALLOWED[entry.model.provider]) : result;
		} });
		state = { count: 0, originals: [...originals, [session, "scopedModels", scoped]] };
		owner[PATCH] = state;
	}
	state.count++;
	const installed = state;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--installed.count !== 0) return;
		for (const [target, name, descriptor] of installed.originals) Object.defineProperty(target, name, descriptor);
		delete owner[PATCH];
	};
}
