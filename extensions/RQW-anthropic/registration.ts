import type { CredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { assertAnthropicAuthBoundary } from "./auth-boundary.ts";

export const OVERLAY = Symbol.for("rqw-anthropic/overlay");
export const BIND_STORE = Symbol.for("rqw-anthropic/bind-store");
const PATCH = Symbol.for("rqw-anthropic/registration");
const CONFLICT = "RQW-anthropic: another Anthropic extension is enabled. Disable pi-claude-auth or the other Anthropic adapter in personal/project settings and explicit -e arguments, keep auth.json, then restart Pi.";
type Registration = { streamSimple?: { [OVERLAY]?: boolean; [BIND_STORE]?: (store: CredentialStore, runtime: ModelRuntime) => (restore: () => void) => void } };
type RuntimeView = {
	credentials?: CredentialStore;
	getRegisteredProviderConfig(id: string): Registration | undefined;
	getRegisteredNativeProvider(id: string): unknown;
};
type Hook = (this: RuntimeView, ...args: unknown[]) => unknown;
type Original = [object, string, PropertyDescriptor];
type PatchState = { count: number; originals: Original[] };

// Pi 1.4.0 has no hook for the Anthropic transport's registration and request boundary. Never patch stores or credential contents.
// Provider visibility is not here: it belongs to RQW-providers.
export function installRegistrationGuard(Runtime = ModelRuntime): () => void {
	const owner = Runtime as unknown as { [PATCH]?: PatchState };
	let state = owner[PATCH];
	if (!state) {
		const runtime = Runtime.prototype;
		const methods = ["prepareRequest", "registerProvider", "registerNativeProvider"];
		const descriptors = methods.map(name => Object.getOwnPropertyDescriptor(runtime, name));
		if (descriptors.some(d => typeof d?.value !== "function" || !d.configurable) ||
			typeof runtime.getRegisteredProviderConfig !== "function" || typeof runtime.getRegisteredNativeProvider !== "function") {
			throw new Error("RQW-anthropic: incompatible Pi internals; requires Pi 1.4.0. Nothing was patched.");
		}
		const originals: Original[] = methods.map((name, i) => [runtime, name, descriptors[i]!]);
		const enabled = (instance: RuntimeView) => instance.getRegisteredProviderConfig("anthropic")?.streamSimple?.[OVERLAY] === true;
		for (const [target, name, descriptor] of originals) {
			const original = descriptor.value as Hook;
			let wrapped: Hook;
			if (name === "registerProvider" || name === "registerNativeProvider") {
				wrapped = function(idOrProvider, config) {
					const id = typeof idOrProvider === "string" ? idOrProvider :
						idOrProvider && typeof idOrProvider === "object" && "id" in idOrProvider ? idOrProvider.id : undefined;
					let registered: ((restore: () => void) => void) | undefined;
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
									throw new Error("RQW-anthropic: Pi 1.4.0 runtime credential bridge is unavailable; adapter not registered");
								}
								registered = bind(store, this as unknown as ModelRuntime);
							}
						}
					}
					const result = original.call(this, idOrProvider, config);
					registered?.(() => { original.call(this, idOrProvider, config); });
					return result;
				};
			} else {
				wrapped = async function(...args) {
					const prepared = await original.apply(this, args) as {
						model: Parameters<typeof assertAnthropicAuthBoundary>[0];
						options: Parameters<typeof assertAnthropicAuthBoundary>[1];
					};
					if (enabled(this)) assertAnthropicAuthBoundary(prepared.model, prepared.options, process.env.ANTHROPIC_CUSTOM_HEADERS);
					return prepared;
				};
			}
			Object.defineProperty(target, name, { ...descriptor, value: wrapped });
		}
		state = { count: 0, originals };
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
