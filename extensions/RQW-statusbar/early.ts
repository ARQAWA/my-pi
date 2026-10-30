import { homedir } from "node:os";
import { InteractiveMode, VERSION, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { editorBorder, modelRow, placeLayout, placeOf, topBorder, type BarState } from "./render.ts";
import { scratchRoots, themePaint } from "./index.ts";

type Target = Record<string, any>;
type Owner = { handler: Function; enabled: () => boolean };
type Binding = { owner?: Owner; restore: () => void; freeze: () => void };
type Registry = { owners: Set<Owner>; hosts: Map<Target, Binding>; undo: (() => void)[] };
const KEY = Symbol.for("rqw-statusbar/early/1.4.0");
function cleanup(registry: Registry): void {
	if (registry.owners.size || registry.hosts.size) return;
	for (const restore of registry.undo.reverse()) restore();
	const global = globalThis as unknown as Record<symbol, Registry | undefined>;
	if (global[KEY] === registry) delete global[KEY];
}

function wrap(target: Target, name: string, make: (original: Function) => Function, undo: (() => void)[]): boolean {
	let holder: any = target;
	while (holder && !Object.hasOwn(holder, name)) holder = Object.getPrototypeOf(holder);
	const descriptor = holder && Object.getOwnPropertyDescriptor(holder, name);
	if (!descriptor || typeof descriptor.value !== "function" || !descriptor.configurable || !descriptor.writable || !Object.isExtensible(target)) return false;
	const own = Object.getOwnPropertyDescriptor(target, name);
	const original = target[name];
	const replacement = make(original);
	Object.defineProperty(target, name, { configurable: true, writable: true, value: replacement });
	undo.push(() => { if (target[name] === replacement) { if (own) Object.defineProperty(target, name, own); else delete target[name]; } });
	return true;
}

function bind(host: Target, registry: Registry): void {
	let owner: Owner | undefined;
	try {
		const extensions = host.session.resourceLoader.getExtensions().extensions;
		owner = [...registry.owners].find(candidate => extensions.some((extension: Target) => extension.commands?.get("statusbar")?.handler === candidate.handler));
	} catch { registry.hosts.get(host)?.restore(); registry.hosts.delete(host); return; }
	const old = registry.hosts.get(host);
	if (!owner || !owner.enabled()) { old?.restore(); registry.hosts.delete(host); return; }
	if (old?.owner === owner) return;
	old?.restore();
	const editor = host.defaultEditor, footer = host.footer, screen = host.renderer;
	if (!editor || !footer || !screen || !host.sessionManager || typeof host.createExtensionUIContext !== "function") return;
	let ui: ExtensionUIContext;
	try { ui = host.createExtensionUIContext(); if (!ui.theme || typeof ui.theme.fg !== "function" || typeof ui.theme.getThinkingBorderColor !== "function") return; } catch { return; }
	let snapshot: { id: string; name?: string; cwd: string; model: BarState["model"]; thinking?: string };
	const read = () => ({ id: host.sessionManager.getSessionId(), name: host.sessionManager.getSessionName(), cwd: host.sessionManager.getCwd(), model: host.session.model, thinking: host.session.thinkingLevel });
	try { snapshot = read(); } catch { return; }
	let live = true;
	const roots = scratchRoots();
	const current = () => live ? read() : snapshot;
	const undo: (() => void)[] = [];
	const binding: Binding = { owner, freeze() { const { id, name, cwd } = read(); snapshot = { id, name, cwd, model: undefined }; live = false; }, restore() { for (const restore of undo.reverse()) restore(); } };
	try {
		const ok = wrap(editor, "renderTopBorder", () => function(width: number, hidden: number) {
			const s = current(); return topBorder(width, s.id, undefined, hidden, themePaint(ui.theme), s.name);
		}, undo) && wrap(editor, "renderBottomBorder", () => function(width: number, hidden: number) {
			return editorBorder(undefined, hidden, width, themePaint(ui.theme));
		}, undo) && wrap(footer, "render", () => function(width: number) {
			const s = current(); const paint = themePaint(ui.theme);
			const state: BarState = { model: s.model, thinkingLevel: s.thinking, place: placeOf({ cwd: s.cwd, home: homedir(), scratchRoots: roots }), statuses: [] };
			const place = placeLayout(state, width, paint);
			return [modelRow(state, width, paint), place.first(), ...place.rest];
		}, undo);
		if (!ok) { binding.restore(); return; }
		registry.hosts.set(host, binding);
	} catch { binding.restore(); }
}

export function installEarly(handler: Function, enabled: () => boolean) {
	const global = globalThis as unknown as Record<symbol, Registry | undefined>;
	let registry = global[KEY];
	if (!registry) {
		if (VERSION !== "1.4.0") return { freeze(_ui?: ExtensionUIContext, _factory?: unknown, _footer?: unknown) {}, disable(_ui?: ExtensionUIContext, _factory?: unknown, _footer?: unknown) {}, enable() {}, canInstallFooter(_footer?: unknown) { return true; }, dispose() {} };
		const state: Registry = { owners: new Set(), hosts: new Map(), undo: [] };
		const proto = InteractiveMode.prototype as unknown as Target;
		try {
			for (const name of ["init", "rebindCurrentSession", "renderSessionEntries"]) {
				if (!wrap(proto, name, original => function(this: Target, ...args: any[]) { bind(this, state); return original.apply(this, args); }, state.undo)) throw new Error("unsupported host");
			}
			if (!wrap(proto, "stop", original => function(this: Target, ...args: any[]) {
				try { return original.apply(this, args); } finally { state.hosts.get(this)?.restore(); state.hosts.delete(this); cleanup(state); }
			}, state.undo)) throw new Error("unsupported stop");
		} catch { for (const restore of state.undo.reverse()) restore(); return { freeze(_ui?: ExtensionUIContext, _factory?: unknown, _footer?: unknown) {}, disable(_ui?: ExtensionUIContext, _factory?: unknown, _footer?: unknown) {}, enable() {}, canInstallFooter(_footer?: unknown) { return true; }, dispose() {} }; }
		global[KEY] = registry = state;
	}
	const state = registry;
	const owner = { handler, enabled };
	state.owners.add(owner);
	const inactive = new Set<Target>();
	return {
		freeze(ui: ExtensionUIContext, factory: unknown, footer: unknown) {
			for (const [host, binding] of state.hosts) if (binding.owner === owner) {
				binding.freeze(); binding.owner = undefined;
				if (ui.getEditorComponent() === factory) ui.setEditorComponent(undefined);
				if (footer && host.customFooter === footer) ui.setFooter(undefined);
			}
		},
		disable(ui: ExtensionUIContext, factory: unknown, footer: unknown) {
			for (const [host, binding] of state.hosts) if (binding.owner === owner) {
				binding.restore(); state.hosts.delete(host); inactive.add(host);
				if (ui.getEditorComponent() === factory) ui.setEditorComponent(undefined);
				if (footer && host.customFooter === footer) ui.setFooter(undefined);
			}
		},
		enable() { for (const host of inactive) bind(host, state); inactive.clear(); },
		canInstallFooter(previous: unknown) {
			for (const [host, binding] of state.hosts) if (binding.owner === owner) return !host.customFooter || host.customFooter === previous;
			return true;
		},
		dispose() { inactive.clear(); state.owners.delete(owner); cleanup(state); },
	};
}
