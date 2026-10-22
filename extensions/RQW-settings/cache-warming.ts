import { AgentSession, VERSION, type ExtensionAPI, type SettingsManager } from "@earendil-works/pi-coding-agent";

const BIND = "rqw-settings:cache-default-bind";
const HOOK = Symbol.for("rqw-settings/cache-default/1.4.0");
type Cleanup = () => void;
type State = {
	registrations: number;
	sessions: WeakMap<object, Set<Cleanup>>;
	descriptors: WeakMap<(...args: unknown[]) => unknown, PropertyDescriptor>;
	managers?: WeakMap<object, ManagerOverride>;
};
// One override per SettingsManager, shared by every session that uses it, whatever the disposal order.
type ManagerOverride = { owners: number; own: PropertyDescriptor | undefined; wrapped: () => "off" };
type Owner = { [HOOK]?: State };
const METHODS = ["_bindExtensionCore", "dispose"];

function restoreIfIdle(owner: Owner, state: State): boolean {
	if (state.registrations > 0) return false;
	for (const name of METHODS) {
		const current = Object.getOwnPropertyDescriptor(owner, name);
		const original = current && state.descriptors.get(current.value);
		// A foreign wrapper may restore ours later. Keep its identity in the persistent weak registry.
		if (original) Object.defineProperty(owner, name, original);
	}
	return true;
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
		state = { registrations: 0, sessions: new WeakMap(), descriptors: new WeakMap(), managers: new WeakMap() };
		Object.defineProperty(owner, HOOK, { value: state });
	}
	if (state.registrations === 0) {
		const installed = state;
		for (const [name, descriptor] of current as [string, PropertyDescriptor][]) {
			// RQW-anthropic can restore our dormant wrapper after our shutdown handler ran.
			// Unwrap that known identity instead of adding another settings layer on every reload.
			const originalDescriptor = installed.descriptors.get(descriptor.value) ?? descriptor;
			const original = originalDescriptor.value;
			const wrapped = name === "dispose" ? function(this: AgentSession) {
				if (!restoreIfIdle(owner, installed)) {
					for (const release of [...(installed.sessions.get(this) ?? [])]) release();
				}
				return original.call(this);
			} : function(this: AgentSession, ...args: unknown[]) {
				// The loader owns the marker. Unowned sessions and dormant wrappers are stock passthroughs.
				if (!restoreIfIdle(owner, installed)) {
					for (const extension of this.resourceLoader.getExtensions().extensions) {
						for (const handler of extension.handlers.get(BIND) ?? []) handler({ session: this });
					}
				}
				return original.apply(this, args);
			};
			installed.descriptors.set(wrapped, originalDescriptor);
			Object.defineProperty(owner, name, { ...originalDescriptor, value: wrapped });
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
		restoreIfIdle(owner, installed);
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
