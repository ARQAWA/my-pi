import { AgentSession, ModelRuntime, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Only these providers stay in login and model lists; credentials of the others stay saved.
export const ALLOWED = new Set(["anthropic", "openai-codex"]);
// Pi 1.4.0's native handler map carries this private key: the patched `_bindExtensionCore` tells each loaded
// instance which session (and so which runtime) it was bound to, before the session emits any event.
const BIND = "rqw-providers:session-bind";
const PATCH = Symbol.for("rqw-providers/patch");
const METHODS = ["getProviders", "getModels", "getAvailableSnapshot", "getAvailable"] as const;
type Hook = (this: ModelRuntime, ...args: unknown[]) => unknown;
type Live = () => boolean;
// Restoring checks that the slot still holds our own function; a later wrapper of another extension stays.
type Original = { target: object; name: string; descriptor: PropertyDescriptor; ours: unknown };
type PatchState = {
	count: number; originals: Original[]; owners: WeakMap<ModelRuntime, Set<Live>>;
	// Release functions of the instances bound to a session, run when that session is disposed.
	bound: WeakMap<object, Set<() => void>>;
};

const filter = <T extends { provider?: string; id: string }>(items: readonly T[]) => items.filter(item => ALLOWED.has(item.provider ?? item.id));

/** The policy applies to a runtime while one of its owners is live; the stale owner of a disposed or reloaded session is dropped. */
function enabled(state: PatchState, runtime: ModelRuntime | undefined): boolean {
	const owners = runtime && state.owners.get(runtime);
	if (!owners) return false;
	for (const live of [...owners]) {
		if (live()) return true;
		owners.delete(live);
	}
	return false;
}

export type Visibility = {
	/** The policy now applies to the runtime of this session, while `live()` holds. */
	own(session: AgentSession, live: Live): void;
	release(): void;
};

const INCOMPATIBLE = "RQW-providers: incompatible Pi internals; requires Pi 1.4.0. Nothing was patched.";
type SessionHook = (this: AgentSession, ...args: unknown[]) => unknown;
const SESSION_HOOKS = ["_bindExtensionCore", "dispose"] as const;

// Wrap one AgentSession method over whatever the slot holds now (Pi's own or another extension's wrapper).
function wrapSessionHook(state: PatchState, Session: typeof AgentSession, name: (typeof SESSION_HOOKS)[number]) {
	const prototype = Session.prototype;
	const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
	if (typeof descriptor?.value !== "function" || !descriptor.configurable) throw new Error(INCOMPATIBLE);
	const original = descriptor.value as SessionHook;
	const wrapped: SessionHook = name === "dispose" ? function(...args) {
		// Pi 1.4.0 SDK dispose has no shutdown hook: release this session's instances before Pi invalidates its API.
		for (const release of [...(state.bound.get(this) ?? [])]) release();
		return original.apply(this, args);
	} : function(...args) {
		// Own the runtime before Pi's native registration, whether or not the host emits session_start.
		for (const extension of this.resourceLoader.getExtensions().extensions) {
			for (const handler of extension.handlers.get(BIND) ?? []) (handler as (event: object) => void)({ type: BIND, session: this });
		}
		return original.apply(this, args);
	};
	Object.defineProperty(prototype, name, { ...descriptor, value: wrapped });
	state.originals = state.originals.filter(entry => !(entry.target === prototype && entry.name === name));
	state.originals.push({ target: prototype, name, descriptor, ours: wrapped });
}

/**
 * Hide every provider but `ALLOWED` in the lists of a runtime that has an owning session, and in that session's
 * scoped models. A checked, reference-counted, reversible patch of Pi's exported classes (Pi 1.4.0 has no
 * visibility policy); `release` restores Pi's own methods when the last instance releases. Never patches stores
 * or credentials. The patched `_bindExtensionCore` hands each loaded instance its session, which is what `own` takes;
 * the patched `dispose` releases the instances bound to the disposed session. Another extension may restore these two
 * slots to Pi's own methods (RQW-anthropic's lifecycle does), so every install checks that our wrapper is still in
 * the slot and wraps again when it is not.
 */
export function installVisibility(Runtime = ModelRuntime, Session = AgentSession): Visibility {
	const owner = Runtime as unknown as { [PATCH]?: PatchState };
	const session = Session.prototype;
	let state = owner[PATCH];
	if (!state) {
		const runtime = Runtime.prototype;
		const descriptors = METHODS.map(name => Object.getOwnPropertyDescriptor(runtime, name));
		const scoped = Object.getOwnPropertyDescriptor(session, "scopedModels");
		if (descriptors.some(d => typeof d?.value !== "function" || !d.configurable) || !scoped?.get || !scoped.configurable ||
			SESSION_HOOKS.some(name => { const d = Object.getOwnPropertyDescriptor(session, name); return typeof d?.value !== "function" || !d.configurable; })) {
			throw new Error(INCOMPATIBLE);
		}
		const created: PatchState = { count: 0, originals: [], owners: new WeakMap(), bound: new WeakMap() };
		METHODS.forEach((name, i) => {
			const descriptor = descriptors[i]!;
			const original = descriptor.value as Hook;
			const ours = function(this: ModelRuntime, ...args: unknown[]) {
				const result = original.apply(this, args);
				if (!enabled(created, this)) return result;
				return result instanceof Promise ? result.then(filter) : filter(result as Parameters<typeof filter>[0]);
			};
			Object.defineProperty(runtime, name, { ...descriptor, value: ours });
			created.originals.push({ target: runtime, name, descriptor, ours });
		});
		const scopedGetter = scoped.get;
		const ours = function(this: AgentSession) {
			const result: AgentSession["scopedModels"] = scopedGetter.call(this);
			return enabled(created, this.modelRuntime) ? result.filter(entry => ALLOWED.has(entry.model.provider)) : result;
		};
		Object.defineProperty(session, "scopedModels", { ...scoped, get: ours });
		created.originals.push({ target: session, name: "scopedModels", descriptor: scoped, ours });
		for (const name of SESSION_HOOKS) wrapSessionHook(created, Session, name);
		state = created;
		owner[PATCH] = state;
	} else {
		for (const name of SESSION_HOOKS) {
			const slot = Object.getOwnPropertyDescriptor(session, name);
			if (typeof slot?.value !== "function" || !slot.configurable) throw new Error(INCOMPATIBLE);
		}
		for (const name of SESSION_HOOKS) {
			const ours = state.originals.find(entry => entry.target === session && entry.name === name)?.ours;
			if (Object.getOwnPropertyDescriptor(session, name)?.value !== ours) wrapSessionHook(state, Session, name);
		}
	}
	state.count++;
	const installed = state;
	const lives = new Map<ModelRuntime, Live>();
	const bound = new Set<object>();
	let released = false;
	const visibility: Visibility = {
		own(boundSession, live) {
			if (released) return;
			const runtime = boundSession.modelRuntime;
			const owners = installed.owners.get(runtime) ?? new Set<Live>();
			installed.owners.set(runtime, owners);
			owners.add(live);
			lives.set(runtime, live);
			const releases = installed.bound.get(boundSession) ?? new Set<() => void>();
			installed.bound.set(boundSession, releases);
			releases.add(visibility.release);
			bound.add(boundSession);
		},
		release() {
			if (released) return;
			released = true;
			for (const [runtime, live] of lives) installed.owners.get(runtime)?.delete(live);
			lives.clear();
			for (const boundSession of bound) installed.bound.get(boundSession)?.delete(visibility.release);
			bound.clear();
			if (--installed.count !== 0) return;
			for (const { target, name, descriptor, ours } of installed.originals) {
				const current = Object.getOwnPropertyDescriptor(target, name);
				if ((current?.value ?? current?.get) === ours) Object.defineProperty(target, name, descriptor);
			}
			delete owner[PATCH];
		},
	};
	return visibility;
}

export default function providers(pi: ExtensionAPI) {
	if (VERSION !== "1.4.0") throw new Error("RQW-providers requires Pi 1.4.0; nothing was changed");
	let stopped = false;
	// Pi's extension API throws once its session was reloaded or disposed; `on` + unsubscribe probes that without effect.
	const live = () => {
		if (stopped) return false;
		try { (pi.on("rqw-providers:probe" as "session_start", () => {}) as unknown as (() => void) | undefined)?.(); return true; }
		catch { return false; }
	};
	const visibility = installVisibility();
	try {
		pi.on(BIND as "session_start", (event) => {
			if (!stopped) visibility.own((event as unknown as { session: AgentSession }).session, live);
		});
		pi.on("session_shutdown", () => { stopped = true; visibility.release(); });
	} catch (error) { visibility.release(); throw error; }
}
