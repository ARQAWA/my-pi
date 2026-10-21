import { AgentSession, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TOOL_FLAGS = ["--tools", "-t", "--exclude-tools", "-xt", "--no-tools", "-nt", "--no-builtin-tools", "-nbt"];
const HOOK = Symbol.for("rqw/tool-selection-intent/1.3.0");
type SessionClass = { prototype: object };
type IntentBinding = { session: WeakRef<object>; selected: boolean };
type HookState = {
	registrations: Set<WeakRef<object>>;
	sessions: WeakMap<object, boolean>;
	intents: WeakMap<object, IntentBinding>;
	descriptors: WeakMap<(...args: unknown[]) => unknown, PropertyDescriptor>;
};
type HookOwner = { [HOOK]?: HookState };

function unsupported(detail: string): never {
	throw new Error(`RQW tool selection requires Pi 1.3.0: ${detail}; defaults were not applied.`);
}

function dataField(session: object, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(session, name);
	if (!descriptor || !("value" in descriptor)) unsupported(`missing data field ${name}`);
	return descriptor.value;
}

/** SDK 1.3.0 retains intent, not just the resulting active set, in these constructor fields. */
function capture(session: object, state: HookState): void {
	const manager = dataField(session, "sessionManager");
	if (!manager || typeof manager !== "object") unsupported("invalid sessionManager");
	const previous = state.sessions.get(session);
	if (previous !== undefined) {
		state.intents.set(manager, { session: new WeakRef(session), selected: previous });
		return;
	}
	state.intents.delete(manager);
	const usesDefault = dataField(session, "_usesDefaultTools");
	const modifiers = dataField(session, "_defaultToolModifiers");
	const excluded = dataField(session, "_excludedTools");
	const allowed = dataField(session, "_allowedTools");
	if (typeof usesDefault !== "boolean") unsupported("invalid _usesDefaultTools");
	if (!Array.isArray(modifiers) || !modifiers.every((name) => typeof name === "string")) {
		unsupported("invalid _defaultToolModifiers");
	}
	if (excluded !== undefined && typeof excluded !== "function") unsupported("invalid _excludedTools");
	if (allowed !== undefined && typeof allowed !== "function") unsupported("invalid _allowedTools");
	// A manager can be reused by a new session; only the same session keeps its original intent on reload.
	const selected = !usesDefault || modifiers.length > 0 || excluded !== undefined || allowed !== undefined;
	state.sessions.set(session, selected);
	state.intents.set(manager, { session: new WeakRef(session), selected });
}

// SDK factory rejection has no lifecycle event; orphan registrations disappear after collection and this sweep.
function hasRegistrations(state: HookState): boolean {
	for (const reference of state.registrations) {
		if (!reference.deref()) state.registrations.delete(reference);
	}
	return state.registrations.size > 0;
}

function restoreIfIdle(owner: HookOwner, state: HookState): boolean {
	if (hasRegistrations(state)) return false;
	const current = Object.getOwnPropertyDescriptor(owner, "bindExtensions");
	const original = current && state.descriptors.get(current.value);
	// Never remove a foreign hook installed later; our dormant wrapper remains a stock passthrough.
	if (original) Object.defineProperty(owner, "bindExtensions", original);
	return true;
}

// Keep tokens outside the wrapper's closure scope so the prototype cannot retain them strongly.
function register(owner: HookOwner, state: HookState): () => void {
	const token = { released: false };
	const reference = new WeakRef(token);
	state.registrations.add(reference);
	return () => {
		if (token.released) return;
		token.released = true;
		state.registrations.delete(reference);
		restoreIfIdle(owner, state);
	};
}

/** Capture-only registrations are weak: a failed SDK factory has no shutdown event or strong lease to leak. */
export function installSelectionIntent(Session: SessionClass = AgentSession, version = VERSION): () => void {
	if (version !== "1.3.0") unsupported(`unsupported version ${version}`);
	const owner = Session.prototype as HookOwner;
	const descriptor = Object.getOwnPropertyDescriptor(owner, "bindExtensions");
	if (!descriptor || typeof descriptor.value !== "function" || !descriptor.configurable || !descriptor.writable) {
		unsupported("incompatible AgentSession.bindExtensions descriptor");
	}
	let state = Object.getOwnPropertyDescriptor(owner, HOOK)?.value as HookState | undefined;
	if (!state) {
		state = { registrations: new Set(), sessions: new WeakMap(), intents: new WeakMap(), descriptors: new WeakMap() };
		Object.defineProperty(owner, HOOK, { value: state });
	}
	if (!hasRegistrations(state)) {
		const installed = state;
		// Another lifecycle hook may have restored our dormant wrapper after its own shutdown.
		const originalDescriptor = state.descriptors.get(descriptor.value) ?? descriptor;
		const original = originalDescriptor.value;
		const wrapped = function bindExtensions(this: object, ...args: unknown[]) {
			if (!restoreIfIdle(owner, installed)) {
				try { capture(this, installed); }
				catch {
					// Metadata capture must not change native behavior, including when these modules are off.
					// A participating session rejects missing intent in noToolSelection before applying defaults.
				}
			}
			return original.apply(this, args);
		};
		state.descriptors.set(wrapped, originalDescriptor);
		Object.defineProperty(owner, "bindExtensions", { ...originalDescriptor, value: wrapped });
	}
	return register(owner, state);
}

/** CLI flags and defaultTools remain selections in addition to the captured SDK intent. */
export function noToolSelection(pi: ExtensionAPI, manager: object): boolean {
	const binding = manager && (AgentSession.prototype as HookOwner)[HOOK]?.intents.get(manager);
	if (!binding?.session.deref()) unsupported("session intent was not captured before session_start");
	if (binding.selected) return false;
	if (process.argv.some((arg) => TOOL_FLAGS.some((flag) => arg === flag || arg.startsWith(flag + "=")))) return false;
	try {
		const settings = pi.getSettings();
		return !!settings && settings.defaultTools === undefined;
	} catch {
		return false;
	}
}
