import { AgentSession, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TOOL_FLAGS = ["--tools", "-t", "--exclude-tools", "-xt", "--no-tools", "-nt", "--no-builtin-tools", "-nbt"];
const HOOK = Symbol.for("rqw/tool-selection-intent/1.3.0");
type SessionClass = { prototype: object };
type HookState = {
	count: number;
	intents: WeakMap<object, boolean>;
	descriptors: WeakMap<(...args: any[]) => any, PropertyDescriptor>;
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
function capture(session: object, intents: WeakMap<object, boolean>): void {
	const manager = dataField(session, "sessionManager");
	if (!manager || typeof manager !== "object") unsupported("invalid sessionManager");
	if (intents.has(manager)) return;
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
	// An empty excludeTools still creates a matcher. Empty tools and noTools disable usesDefaultTools.
	intents.set(manager, !usesDefault || modifiers.length > 0 || excluded !== undefined || allowed !== undefined);
}

/** Each isolated extension leases the same hook; session keys remain weak across the /reload lease gap. */
export function installSelectionIntent(Session: SessionClass = AgentSession, version = VERSION): () => void {
	if (version !== "1.3.0") unsupported(`unsupported version ${version}`);
	const owner = Session.prototype as HookOwner;
	const descriptor = Object.getOwnPropertyDescriptor(owner, "bindExtensions");
	if (!descriptor || typeof descriptor.value !== "function" || !descriptor.configurable || !descriptor.writable) {
		unsupported("incompatible AgentSession.bindExtensions descriptor");
	}
	let state = Object.getOwnPropertyDescriptor(owner, HOOK)?.value as HookState | undefined;
	if (!state) {
		state = { count: 0, intents: new WeakMap(), descriptors: new WeakMap() };
		Object.defineProperty(owner, HOOK, { value: state });
	}
	if (state.count === 0) {
		const installed = state;
		// Another lifecycle hook can restore our dormant wrapper after its own shutdown. Unwrap that lease.
		const originalDescriptor = state.descriptors.get(descriptor.value) ?? descriptor;
		const original = originalDescriptor.value;
		const wrapped = function bindExtensions(this: object, ...args: any[]) {
			if (installed.count > 0) capture(this, installed.intents);
			return original.apply(this, args);
		};
		state.descriptors.set(wrapped, originalDescriptor);
		Object.defineProperty(owner, "bindExtensions", { ...originalDescriptor, value: wrapped });
	}
	state.count++;
	const installed = state;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--installed.count !== 0) return;
		const current = Object.getOwnPropertyDescriptor(owner, "bindExtensions");
		const original = current && installed.descriptors.get(current.value);
		// Never remove a foreign hook installed later. Its reference to ours becomes a stock passthrough.
		if (original) Object.defineProperty(owner, "bindExtensions", original);
	};
}

/** CLI flags and defaultTools remain selections in addition to the captured SDK intent. */
export function noToolSelection(pi: ExtensionAPI, manager: object): boolean {
	const intents = (AgentSession.prototype as HookOwner)[HOOK]?.intents;
	if (!manager || !intents?.has(manager)) unsupported("session intent was not captured before session_start");
	if (intents.get(manager)) return false;
	if (process.argv.some((arg) => TOOL_FLAGS.some((flag) => arg === flag || arg.startsWith(flag + "=")))) return false;
	try {
		const settings = pi.getSettings();
		return !!settings && settings.defaultTools === undefined;
	} catch {
		return false;
	}
}
