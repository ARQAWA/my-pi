// Hold only startup paints, never terminal input or terminal queries. All state belongs to the
// statusbar instance actually loaded by this session; child factories cannot take over its gate.
import { InteractiveMode, VERSION, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";

type Method = (this: any, ...args: any[]) => any;
type Target = Record<string, any>;
type Owner = { handler: Function; gates: Set<Gate> };
type Gate = { release(): void; own: number };
type Registry = {
	owners: Set<Owner>; contexts: WeakMap<object, Gate>;
	original: PropertyDescriptor; wrapper: Method;
};
const KEY = Symbol.for("rqw-statusbar/startup/1.4.0");
const HOST_METHODS = ["createExtensionUIContext", "showError", "showExtensionError", "showManagedToolStatus"];
const UI_RELEASE = ["select", "confirm", "input", "editor", "custom", "notify", "setEditorComponent", "setFooter"];

function descriptor(target: object, name: string): PropertyDescriptor | undefined {
	for (let at: object | null = target; at; at = Object.getPrototypeOf(at)) {
		const found = Object.getOwnPropertyDescriptor(at, name);
		if (found) return found;
	}
	return undefined;
}
function replaceable(target: Target, name: string): boolean {
	const d = descriptor(target, name);
	return !!d && typeof d.value === "function" && d.configurable === true && d.writable === true && Object.isExtensible(target);
}
function wrap(target: Target, name: string, make: (original: Method) => Method, undo: (() => void)[]): void {
	const own = Object.getOwnPropertyDescriptor(target, name);
	const wrapper = make(target[name]);
	Object.defineProperty(target, name, { configurable: true, writable: true, value: wrapper });
	undo.push(() => {
		if (target[name] !== wrapper) return;
		if (own) Object.defineProperty(target, name, own);
		else delete target[name];
	});
}

function hold(host: Target, owner: Owner, registry: Registry): Gate | undefined {
	const screen = host.renderer;
	if (!screen || host.isInitialized || HOST_METHODS.some(name => !replaceable(host, name))
		|| ["doRender", "start", "stop", "showOverlay", "requestRender"].some(name => !replaceable(screen, name))) return;
	const undo: (() => void)[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;
	let released = false;
	const gate: Gate = {
		own: 0,
		release() {
			if (released) return;
			released = true;
			clearTimeout(timer);
			for (const restore of undo.reverse()) restore();
			owner.gates.delete(gate);
			screen.requestRender(true);
		},
	};
	owner.gates.add(gate);
	try {
		wrap(screen, "doRender", () => function() {}, undo);
		wrap(screen, "start", original => function(...args) {
			timer ??= setTimeout(() => gate.release(), 1000);
			timer.unref?.();
			return original.apply(this, args);
		}, undo);
		for (const name of ["stop", "showOverlay"]) wrap(screen, name, original => function(...args) {
			gate.release();
			return original.apply(this, args);
		}, undo);
		for (const name of HOST_METHODS.slice(1)) wrap(host, name, original => function(...args) {
			gate.release();
			return original.apply(this, args);
		}, undo);
		wrap(host, "createExtensionUIContext", original => function(...args) {
			const ui = original.apply(this, args);
			if (!ui || UI_RELEASE.some(name => !replaceable(ui, name))) { gate.release(); return ui; }
			for (const name of UI_RELEASE) wrap(ui, name, method => function(...values) {
				if (!gate.own) gate.release();
				return method.apply(this, values);
			}, undo);
			// ExtensionRunner copies the context, but preserves the setFooter function.
			registry.contexts.set(ui.setFooter, gate);
			return ui;
		}, undo);
	} catch { gate.release(); return; }
	return gate;
}

/** The command handler keeps its identity through Pi's loader, unlike wrapped event handlers. */
export function installStartup(handler: Function): { begin(ui: ExtensionUIContext): () => void; dispose(): void } {
	const global = globalThis as unknown as Record<symbol, Registry | undefined>;
	let registry = global[KEY];
	const proto = InteractiveMode.prototype as unknown as Target;
	if (!registry) {
		const original = Object.getOwnPropertyDescriptor(proto, "init");
		if (VERSION !== "1.4.0" || !replaceable(proto, "init") || !original) return { begin: () => () => {}, dispose() {} };
		const state: Registry = { owners: new Set(), contexts: new WeakMap(), original, wrapper: async function(...args) {
			let owner: Owner | undefined;
			try {
				const extensions = this.session.resourceLoader.getExtensions().extensions;
				owner = [...state.owners].find(candidate => extensions.some((extension: Target) =>
					extension.commands?.get("statusbar")?.handler === candidate.handler));
			} catch { /* Unknown resource shape stays stock. */ }
			const gate = owner && hold(this, owner, state);
			try { return await original.value.apply(this, args); }
			finally { gate?.release(); }
		} };
		Object.defineProperty(proto, "init", { ...original, value: state.wrapper });
		global[KEY] = registry = state;
	}
	const state = registry;
	const owner: Owner = { handler, gates: new Set() };
	state.owners.add(owner);
	return {
		begin(ui) {
			const gate = state.contexts.get(ui.setFooter);
			if (!gate) return () => {};
			gate.own++;
			return () => { gate.own--; gate.release(); };
		},
		dispose() {
			for (const gate of owner.gates) gate.release();
			state.owners.delete(owner);
			if (state.owners.size) return;
			if (proto.init === state.wrapper) Object.defineProperty(proto, "init", state.original);
			if (global[KEY] === state) delete global[KEY];
		},
	};
}
