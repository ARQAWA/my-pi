// Early transcript binding. The resolver identifies the factory belonging to the host's current runtime.
import { InteractiveMode, VERSION, type Theme } from "@earendil-works/pi-coding-agent";
import type { Folds } from "./fold.ts";
import type { ToolUi } from "./render.ts";

const SLOT = Symbol.for("rqw-tool-ui.host-hooks");
type Host = any;
type Owner = {
	ui: ToolUi;
	folds: Folds;
	host?: Host;
	session?: object;
	runtime?: object;
	stopped: boolean;
};
type Glue = { init(host: Host): void; prepare(host: Host): void; stopped(host: Host): void };
type Hub = { owners: WeakMap<Function, Owner>; hosts: WeakMap<object, Owner>; count: number; run?: Glue; restore?: () => void };

function resources(host: Host): { session: any; runtime: object; extensions: any[] } | undefined {
	try {
		const session = host.session;
		const result = session?.resourceLoader?.getExtensions?.();
		if (!session || !result?.runtime || !Array.isArray(result.extensions)) return;
		return { session, runtime: result.runtime, extensions: result.extensions };
	} catch { return; }
}

function ownerFor(hub: Hub, host: Host): Owner | undefined {
	const r = resources(host);
	if (!r) return;
	for (const ext of r.extensions) {
		if (!Array.isArray(ext?.toolRenderers)) continue;
		for (const resolver of ext.toolRenderers) {
			if (typeof resolver !== "function") continue;
			const owner = hub.owners.get(resolver);
			if (owner) return owner;
		}
	}
}

function forget(owner: Owner): void {
	owner.folds.detach();
	owner.ui.shutdown();
	owner.host = owner.session = owner.runtime = undefined;
}

function prepare(hub: Hub, host: Host): void {
	const old = hub.hosts.get(host);
	const owner = ownerFor(hub, host);
	const r = resources(host);
	if (old && (old !== owner || old.session !== r?.session || old.runtime !== r?.runtime)) {
		forget(old);
		hub.hosts.delete(host);
		hub.count--;
	}
	if (!owner || !r || owner.stopped) return;
	if (owner.session === r.session && owner.runtime === r.runtime && owner.host === host) return;
	if (owner.host && owner.host !== host && owner.session) {
		if (hub.hosts.delete(owner.host)) hub.count--;
		forget(owner);
	}
	try {
		const manager = host.sessionManager;
		const ui = host.createExtensionUIContext();
		const theme = Object.getOwnPropertyDescriptor(ui, "theme")?.get;
		const currentTheme = theme?.call(ui);
		if (!manager || typeof manager.getBranch !== "function" || typeof manager.getCwd !== "function" || !theme || typeof currentTheme?.fg !== "function" || !host.chatContainer) return;
		owner.host = host;
		owner.session = r.session;
		owner.runtime = r.runtime;
		owner.ui.start(manager);
		owner.folds.start(() => theme() as Theme);
		owner.folds.attach(host);
		if (!hub.hosts.has(host)) hub.count++;
		hub.hosts.set(host, owner);
	} catch {
		forget(owner);
	}
}

/** What the process-wide hooks run. The newest module instance owns it, so /reload applies new code. */
const glue = (hub: Hub): Glue => ({
	init(host) {
		const owner = ownerFor(hub, host);
		if (owner) owner.host = host;
	},
	prepare: (host) => prepare(hub, host),
	stopped(host) {
		const owner = hub.hosts.get(host);
		if (owner) forget(owner);
		if (hub.hosts.delete(host)) hub.count--;
		if (hub.count === 0) hub.restore?.();
	},
});

function install(): Hub | undefined {
	const global = globalThis as Record<symbol, unknown>;
	const existing = global[SLOT] as Hub | undefined;
	if (existing) {
		// A hub of an earlier release has no glue and keeps its own code until a restart.
		if (existing.run) existing.run = glue(existing);
		return existing;
	}
	const proto = InteractiveMode.prototype as any;
	const names = ["init", "renderSessionEntries", "addMessageToChat", "stop"] as const;
	const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(proto, name));
	if (VERSION !== "1.5.0" || descriptors.some((d) => !d || typeof d.value !== "function" || !d.writable || !d.configurable)) return;
	const hub: Hub = { owners: new WeakMap(), hosts: new WeakMap(), count: 0 };
	hub.run = glue(hub);
	const [init, render, add, stop] = descriptors.map((d) => d!.value);
	proto.init = function (this: Host, ...args: unknown[]) {
		hub.run?.init(this);
		return init.apply(this, args);
	};
	proto.renderSessionEntries = function (this: Host, ...args: unknown[]) {
		hub.run?.prepare(this);
		return render.apply(this, args);
	};
	proto.addMessageToChat = function (this: Host, ...args: unknown[]) {
		const owner = hub.hosts.get(this);
		const before = this.chatContainer?.children?.length ?? 0;
		const result = add.apply(this, args);
		owner?.folds.message(this, args[0], before);
		return result;
	};
	proto.stop = function (this: Host, ...args: unknown[]) {
		try { return stop.apply(this, args); }
		finally { hub.run?.stopped(this); }
	};
	const wrappers = names.map((name) => proto[name]);
	hub.restore = () => {
		if (!names.every((name, i) => proto[name] === wrappers[i])) return;
		for (let i = 0; i < names.length; i++) Object.defineProperty(proto, names[i], descriptors[i]!);
		if (global[SLOT] === hub) delete global[SLOT];
	};
	global[SLOT] = hub;
	return hub;
}

export function registerHost(resolver: Function, ui: ToolUi, folds: Folds): { prepare(): void; stop(): void } {
	const owner: Owner = { ui, folds, stopped: false };
	const hub = install();
	hub?.owners.set(resolver, owner);
	return {
		prepare() {
			if (owner.stopped || !owner.host || !hub) return;
			const current = resources(owner.host);
			if (current && current.session === owner.session && current.runtime === owner.runtime) return;
			prepare(hub, owner.host);
		},
		stop() {
			owner.stopped = true;
			owner.ui.freeze();
			owner.folds.freeze();
			owner.host = owner.session = owner.runtime = undefined;
		},
	};
}
