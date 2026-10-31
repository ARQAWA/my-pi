// Frees Ctrl+E and Ctrl+R from Pi's own actions in memory, so one key press is one action.
// A light wrapper on the live keybindings manager: no settings file, no user binding and no Pi file is written.
import { getKeybindings, matchesKey, type KeyId } from "@earendil-works/pi-tui";

const LINE_END = "tui.editor.cursorLineEnd";
const RENAME = "app.session.rename";
const FREED = new Set(["ctrl+e", "ctrl+r"]);

type Bindings = Record<string, string | string[]>;
type Manager = {
	matches(data: string, id: string): boolean;
	getKeys(id: string): string[];
	getResolvedBindings(): Bindings;
	getDefinition(id: string): unknown;
};
type Method = "matches" | "getKeys" | "getResolvedBindings";
const METHODS: Method[] = ["matches", "getKeys", "getResolvedBindings"];

const isFreed = (key: string) => FREED.has(key.toLowerCase());
const isKeyList = (value: unknown): value is string[] => Array.isArray(value) && value.every(key => typeof key === "string");

/** The manager has the methods, both actions and the result shapes this wrapper relies on. */
function compatible(value: unknown): value is Manager {
	try {
		const manager = value as Partial<Manager> | null;
		if (typeof manager !== "object" || manager === null) return false;
		if (!(["matches", "getKeys", "getResolvedBindings", "getDefinition"] as const).every(name => typeof manager[name] === "function")) return false;
		if (!manager.getDefinition!(LINE_END) || !manager.getDefinition!(RENAME)) return false;
		if (!isKeyList(manager.getKeys!(LINE_END)) || !isKeyList(manager.getKeys!(RENAME))) return false;
		const resolved = manager.getResolvedBindings!();
		return typeof resolved === "object" && resolved !== null;
	} catch {
		return false;
	}
}

/** The keys of one action without the freed ones; the line end keeps End when Ctrl+E was its key. */
function freeKeys(id: string, keys: string[]): string[] {
	const kept = keys.filter(key => !isFreed(key));
	if (kept.length !== keys.length && id === LINE_END && !kept.some(key => key.toLowerCase() === "end")) kept.push("end");
	return kept;
}

/** Wraps the manager instance; undefined, with nothing changed, when any wrapper cannot be put in place. */
function wrap(manager: Manager): (() => void) | undefined {
	const target = manager as unknown as Record<Method, unknown>;
	const base = { matches: manager.matches, getKeys: manager.getKeys, getResolvedBindings: manager.getResolvedBindings };
	const own = new Map(METHODS.map(name => [name, Object.getOwnPropertyDescriptor(manager, name)]));
	let active = true;
	const wrappers: Record<Method, unknown> = {
		getKeys(this: Manager, id: string) {
			// A later layer may have restored this released one after shutdown.
			if (!active) restore("getKeys");
			const keys = base.getKeys.call(this, id);
			return active ? freeKeys(id, keys) : keys;
		},
		matches(this: Manager, data: string, id: string) {
			if (!active) return base.matches.call(this, data, id);
			return this.getKeys(id).some(key => matchesKey(data, key as KeyId));
		},
		getResolvedBindings(this: Manager) {
			const resolved = base.getResolvedBindings.call(this);
			if (!active) return resolved;
			const result: Bindings = {};
			for (const [id, value] of Object.entries(resolved)) {
				const keys = freeKeys(id, Array.isArray(value) ? value : [value]);
				result[id] = keys.length === 1 ? keys[0] : keys;
			}
			return result;
		},
	};
	const restore = (name: Method) => {
		if (target[name] !== wrappers[name]) return;
		const previous = own.get(name);
		if (previous) Object.defineProperty(manager, name, previous);
		else delete target[name];
	};
	const done: Method[] = [];
	try {
		for (const name of METHODS) {
			Object.defineProperty(manager, name, { value: wrappers[name], writable: true, configurable: true, enumerable: false });
			done.push(name);
		}
	} catch {
		for (const name of done) restore(name);
		return undefined;
	}
	return () => {
		// A later wrapper from another extension stays in place; our layer in it just passes through.
		active = false;
		for (const name of METHODS) restore(name);
	};
}

export function installKeybindings(warn: (message: string) => void) {
	let owned: { manager: unknown; release(): void } | undefined;
	const refused = new WeakSet<object>();

	/** True while the live manager is freed. A new manager is checked and wrapped at once; a refused one stays stock. */
	function ensure(): boolean {
		const manager: unknown = getKeybindings();
		if (owned?.manager === manager) return true;
		owned?.release();
		owned = undefined;
		if (typeof manager !== "object" || manager === null || refused.has(manager)) return false;
		const release = compatible(manager) ? wrap(manager) : undefined;
		if (!release) {
			refused.add(manager);
			warn("RQW-predictions could not free Ctrl+E and Ctrl+R from Pi's own actions; the keys stay stock and manual prediction keys are off.");
			return false;
		}
		owned = { manager, release };
		return true;
	}

	return {
		ensure,
		release() {
			owned?.release();
			owned = undefined;
		},
	};
}
