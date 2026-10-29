// One-time application of the shared install profile (setup-profile.json) to the global Pi settings.
// A runtime bridge on the resource loader applies it after the extensions and themes are known and before
// Pi builds its UI, so theme and padding take effect on the first start. Marker `rqwSetupVersion` keeps later
// owner changes. Only the listed keys and the marker are written; credentials and packages are never touched.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { INNER, joinChain, leaveChain, type Link } from "./cache-warming.ts";

export const SETUP_MARKER = "rqwSetupVersion";
const METHOD = "updateThemesFromPaths";
const STATE = Symbol.for("rqw-settings/setup-bridge/1.4.0");
const DIR = dirname(fileURLToPath(import.meta.url));
const OWN_ENTRY = resolve(DIR, "index.ts");

type Json = Record<string, unknown>;
type Profile = { setupVersion: number; settings: Json };
type Loader = {
	settingsManager: Manager;
	getExtensions(): { extensions: { path: string }[] };
	getThemes(): { themes: { name?: string }[] };
};
type Storage = { withLock(scope: "global" | "project", fn: (current: string | undefined) => string | undefined): void };
type Manager = {
	storage: Storage;
	globalSettings: Json;
	settings: Json;
	globalSettingsLoadError: unknown;
	getGlobalSettings(): Json;
	getProjectSettings(): Json;
	applyOverrides(overrides: Json): void;
};
type State = { current?: Link; pending: Set<string> };

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function stateOf(): State {
	const registry = globalThis as unknown as Record<symbol, State | undefined>;
	return registry[STATE] ??= { pending: new Set() };
}

/** Leaf paths of the profile, so nested objects merge key by key and keep their other keys. */
function leaves(value: Json, prefix: string[] = []): { path: string[]; value: unknown }[] {
	return Object.entries(value).flatMap(([key, item]) =>
		isObject(item) ? leaves(item, [...prefix, key]) : [{ path: [...prefix, key], value: item }]);
}

function setPath(target: Json, path: string[], value: unknown): void {
	let node = target;
	for (const key of path.slice(0, -1)) {
		if (!isObject(node[key])) node[key] = {};
		node = node[key] as Json;
	}
	node[path[path.length - 1]!] = value;
}

function real(path: string): string {
	try { return realpathSync(path); } catch { return resolve(path); }
}

function readProfile(): Profile {
	const profile = JSON.parse(readFileSync(resolve(DIR, "setup-profile.json"), "utf8")) as Profile;
	if (!Number.isInteger(profile.setupVersion) || !isObject(profile.settings)) throw new Error("invalid setup-profile.json");
	return profile;
}

function managerShapeOk(manager: unknown): manager is Manager {
	const m = manager as Partial<Manager> | undefined;
	return !!m && typeof m.storage?.withLock === "function" && isObject(m.globalSettings) && isObject(m.settings)
		&& typeof m.getGlobalSettings === "function" && typeof m.getProjectSettings === "function"
		&& typeof m.applyOverrides === "function";
}

/** Whether every extension of this package and the profile's theme are loaded; names what is missing. */
function missingParts(loader: Loader, profile: Profile): string[] | undefined {
	if (typeof loader?.getExtensions !== "function" || typeof loader.getThemes !== "function") throw new Error("Pi resource loader shape changed");
	const extensions = loader.getExtensions()?.extensions;
	const themes = loader.getThemes()?.themes;
	if (!Array.isArray(extensions) || !extensions.every(extension => typeof extension?.path === "string")
		|| !Array.isArray(themes) || !themes.every(item => isObject(item) && (item.name === undefined || typeof item.name === "string"))) {
		throw new Error("Pi resource loader shape changed");
	}
	const loaded = new Set(extensions.map(extension => real(extension.path)));
	if (!loaded.has(real(OWN_ENTRY))) return undefined;
	const root = resolve(DIR, "..", "..");
	const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { pi?: { extensions?: string[] } };
	const missing = (manifest.pi?.extensions ?? []).filter(entry => !loaded.has(real(resolve(root, entry))));
	const theme = profile.settings.theme;
	if (typeof theme === "string" && !themes.some(item => item.name === theme)) missing.push(`theme ${theme}`);
	return missing;
}

function applyProfile(loader: Loader, profile: Profile, warn: (message: string) => void): void {
	const manager = loader.settingsManager;
	const migrate = (SettingsManager as unknown as { migrateSettings?: (settings: Json) => Json }).migrateSettings;
	if (!managerShapeOk(manager) || typeof migrate !== "function") return warn("Pi settings shape changed; the my-pi setup profile was not applied.");
	if (Number(manager.getGlobalSettings()[SETUP_MARKER]) >= profile.setupVersion) return;
	if (manager.globalSettingsLoadError) return warn("Pi settings.json is not valid JSON; the my-pi setup profile was not applied.");
	let missing: string[] | undefined;
	try { missing = missingParts(loader, profile); }
	catch { return warn("Pi resource loader shape changed; the my-pi setup profile was not applied."); }
	if (!missing) return;
	if (missing.length > 0) {
		return warn(`The my-pi setup profile was not applied: ${missing.join(", ")} is switched off or filtered. Install the package without resource filters, then restart Pi.`);
	}
	const entries = leaves(profile.settings);
	const result: { outcome: "applied" | "existing" | "invalid"; settings?: Json } = { outcome: "invalid" };
	try {
		manager.storage.withLock("global", current => {
			let file: unknown = {};
			if (current) {
				try { file = JSON.parse(current.replace(/^\uFEFF/, "")); } catch { file = undefined; }
				if (!isObject(file)) { result.outcome = "invalid"; return undefined; }
			}
			if (!isObject(file)) return undefined;
			if (Number(file[SETUP_MARKER]) >= profile.setupVersion) {
				result.outcome = "existing";
				result.settings = file;
				return undefined;
			}
			for (const { path, value } of entries) setPath(file, path, value);
			file[SETUP_MARKER] = profile.setupVersion;
			result.outcome = "applied";
			result.settings = file;
			return JSON.stringify(file, null, 2);
		});
		if (result.outcome === "invalid") return warn("Pi settings.json is not valid JSON; the my-pi setup profile was not applied.");
		// Refresh the same manager the UI reads, including a concurrent writer's choices.
		const next = migrate(structuredClone(result.settings!));
		manager.globalSettings = next;
		manager.settings = structuredClone(next);
		manager.applyOverrides(manager.getProjectSettings());
	} catch (error) {
		warn(`The my-pi setup profile was not applied: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Installs the bridge; shape or version mismatch leaves Pi stock and reports a warning at session start. */
export function installSetupBridge(pi: ExtensionAPI): () => void {
	const state = stateOf();
	pi.on("session_start", (_event, ctx) => {
		for (const message of state.pending) {
			if (ctx.hasUI) ctx.ui.notify(message, "warning");
			else console.error(message);
		}
		state.pending.clear();
	});
	const proto = DefaultResourceLoader.prototype as unknown as Record<string, unknown>;
	const method = Object.getOwnPropertyDescriptor(proto, METHOD);
	let profile: Profile;
	try {
		if (VERSION !== "1.4.0" || typeof method?.value !== "function" || !method.configurable) {
			throw new Error("incompatible Pi resource loader");
		}
		profile = readProfile();
	} catch (error) {
		state.pending.add(`The my-pi setup profile is off: ${error instanceof Error ? error.message : String(error)}.`);
		return () => {};
	}
	// A newer load replaces an older layer of ours, so exactly one layer exists.
	if (state.current) leaveChain(proto, METHOD, state);
	const warn = (message: string) => { state.pending.add(message); };
	const layer = function(this: Loader, ...args: unknown[]) {
		const result = ((layer as unknown as Record<symbol, (...a: unknown[]) => unknown>)[INNER] as (...a: unknown[]) => unknown).apply(this, args);
		if (state.current === layer) applyProfile(this, profile, warn);
		return result;
	} as unknown as Link;
	joinChain(proto, METHOD, state, layer);
	state.current = layer;
	return () => {
		if (state.current !== layer) return;
		state.current = undefined;
		leaveChain(proto, METHOD, state);
	};
}
